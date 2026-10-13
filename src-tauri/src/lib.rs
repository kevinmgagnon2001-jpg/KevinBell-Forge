//! Forge desktop host.
//!
//! The window shows the existing web UI. Untrusted WebAssembly runs here, natively, in wasmtime:
//! no imports are provided (so a module cannot reach files, network or the OS), and every call
//! runs on a fuel budget so an infinite loop stops instead of hanging the app.

pub mod sandbox {
    use wasmtime::{Config, Engine, Instance, Module, Store};

    /// Instructions-ish of work a single call may do before it is stopped.
    pub const DEFAULT_FUEL: u64 = 50_000_000;
    /// Largest module accepted from the UI.
    pub const MAX_MODULE_BYTES: usize = 16 * 1024 * 1024;

    pub fn run_i32(bytes: &[u8], export: &str, arg: i32, fuel: u64) -> Result<i32, String> {
        if bytes.len() > MAX_MODULE_BYTES {
            return Err("module is too large".into());
        }
        let mut config = Config::new();
        config.consume_fuel(true);
        let engine = Engine::new(&config).map_err(|e| e.to_string())?;
        let module = Module::new(&engine, bytes).map_err(|e| format!("invalid module: {e}"))?;
        // Capability rule: this entry point grants nothing. A module that needs imports must
        // come through a host that grants them explicitly.
        if module.imports().len() > 0 {
            return Err("module requests imports; this sandbox grants none".into());
        }
        let mut store = Store::new(&engine, ());
        store.set_fuel(fuel).map_err(|e| e.to_string())?;
        let instance = Instance::new(&mut store, &module, &[]).map_err(|e| e.to_string())?;
        let func = instance
            .get_typed_func::<i32, i32>(&mut store, export)
            .map_err(|e| format!("export `{export}` (i32) -> i32 not found: {e}"))?;
        func.call(&mut store, arg).map_err(|e| format!("trapped: {e}"))
    }
}

pub mod guest;

/// Native runner for lifted Linux programs (work item N1). The page lifts and lowers; this runs.
pub mod native_guest {
    use crate::guest::{self, Arch, Event, Shim, Vm};
    use serde::Serialize;
    use std::collections::{BTreeMap, HashMap};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;
    use wasmtime::{Config, Engine, Instance, Memory, Module, Store, TypedFunc};

    /// Backstop on WebAssembly instructions per `run` call. Guest fuel (dispatches) is the real
    /// meter and is handed out in slices; this only catches a module that never yields.
    const HOST_FUEL_PER_RUN: u64 = 20_000_000_000;
    /// Guest dispatches per slice before control returns to the host.
    const SLICE: i64 = 5_000_000;
    pub const MAX_MEMORY: usize = 256 * 1024 * 1024;

    pub struct WasmVm {
        store: Store<()>,
        memory: Memory,
        run: TypedFunc<(), i32>,
    }

    impl WasmVm {
        pub fn new(engine: &Engine, bytes: &[u8]) -> Result<WasmVm, String> {
            if bytes.len() > crate::sandbox::MAX_MODULE_BYTES {
                return Err("module is too large".into());
            }
            let module = Module::new(engine, bytes).map_err(|e| format!("invalid module: {e}"))?;
            // The lowered guest module must be self-contained. Anything that asks for imports is refused.
            if module.imports().len() > 0 {
                return Err("guest module asks for imports; it gets none".into());
            }
            let mut store = Store::new(engine, ());
            store.set_fuel(HOST_FUEL_PER_RUN).map_err(|e| e.to_string())?;
            let instance = Instance::new(&mut store, &module, &[]).map_err(|e| e.to_string())?;
            let memory = instance.get_memory(&mut store, "mem").ok_or("module exports no memory")?;
            if memory.data_size(&store) > MAX_MEMORY {
                return Err("guest memory is larger than the host allows".into());
            }
            let run = instance
                .get_typed_func::<(), i32>(&mut store, "run")
                .map_err(|e| format!("module exports no run(): {e}"))?;
            Ok(WasmVm { store, memory, run })
        }
    }

    impl Vm for WasmVm {
        fn run(&mut self) -> Result<i32, String> {
            self.store.set_fuel(HOST_FUEL_PER_RUN).map_err(|e| e.to_string())?;
            self.run.call(&mut self.store, ()).map_err(|e| format!("trapped: {e}"))
        }
        fn mem(&mut self) -> &mut [u8] {
            self.memory.data_mut(&mut self.store)
        }
    }

    struct Session {
        vm: WasmVm,
        shim: Shim,
        budget: i64,
        start_budget: i64,
    }

    pub struct GuestSessions {
        engine: Engine,
        next: AtomicU32,
        live: Mutex<HashMap<u32, Session>>,
    }

    impl Default for GuestSessions {
        fn default() -> Self {
            let mut config = Config::new();
            config.consume_fuel(true);
            GuestSessions {
                engine: Engine::new(&config).expect("wasmtime engine"),
                next: AtomicU32::new(1),
                live: Mutex::new(HashMap::new()),
            }
        }
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Resume {
        /// "exit" | "needs-code" | "stopped" | "running" | "trap"
        pub status: String,
        pub code: i32,
        pub detail: String,
        pub pc: u64,
        pub fault: u64,
        pub exit_code: Option<i32>,
        /// Only the bytes written since the last resume.
        pub stdout: Vec<u8>,
        pub stderr: Vec<u8>,
        pub syscalls: BTreeMap<String, u32>,
        pub unsupported: Vec<String>,
        pub fuel_used: i64,
    }

    impl GuestSessions {
        #[allow(clippy::too_many_arguments)]
        pub fn start(
            &self,
            module: &[u8],
            arch: &str,
            chunks: Vec<(u64, Vec<u8>)>,
            brk_base: u64,
            mmap_top: u64,
            stdin: Vec<u8>,
            fuel: i64,
        ) -> Result<u32, String> {
            let arch = Arch::parse(arch).ok_or("arch must be x86_64 or aarch64")?;
            let mut vm = WasmVm::new(&self.engine, module)?;
            let mem = vm.mem();
            for (addr, bytes) in chunks {
                let end = (addr as usize).checked_add(bytes.len()).ok_or("chunk overflows")?;
                if end > mem.len() {
                    return Err(format!("chunk at 0x{addr:x} is outside guest memory"));
                }
                mem[addr as usize..end].copy_from_slice(&bytes);
            }
            if brk_base as usize > mem.len() || mmap_top as usize > mem.len() || brk_base > mmap_top {
                return Err("bad heap bounds".into());
            }
            let id = self.next.fetch_add(1, Ordering::Relaxed);
            let session = Session { vm, shim: Shim::new(arch, brk_base, mmap_top, stdin), budget: fuel.max(0), start_budget: fuel.max(0) };
            self.live.lock().map_err(|_| "session lock poisoned")?.insert(id, session);
            Ok(id)
        }

        pub fn resume(&self, id: u32, max_events: usize) -> Result<Resume, String> {
            let mut live = self.live.lock().map_err(|_| "session lock poisoned")?;
            let s = live.get_mut(&id).ok_or("no such guest session")?;
            let event = guest::drive(&mut s.vm, &mut s.shim, &mut s.budget, SLICE, max_events.clamp(1, 1_000_000));
            let (status, code, pc, fault, detail) = match event {
                Event::Exit(c) => ("exit", 0, 0, 0, format!("exited with code {c}")),
                Event::NeedsCode(pc) => ("needs-code", guest::stop::UNMAPPED, pc, 0, String::new()),
                Event::Stopped { code, pc, fault } => ("stopped", code, pc, fault, guest::stop::name(code).to_string()),
                Event::Yield => ("running", 0, 0, 0, String::new()),
                Event::Trap(e) => ("trap", -1, 0, 0, e),
            };
            Ok(Resume {
                status: status.into(),
                code,
                detail,
                pc,
                fault,
                exit_code: s.shim.exit_code,
                stdout: std::mem::take(&mut s.shim.stdout),
                stderr: std::mem::take(&mut s.shim.stderr),
                syscalls: s.shim.counts.clone(),
                unsupported: s.shim.unsupported.iter().cloned().collect(),
                fuel_used: s.start_budget - s.budget,
            })
        }

        /// Swap in a newly lowered module (after the page lifted more code), keeping memory and CPU state.
        pub fn swap(&self, id: u32, module: &[u8]) -> Result<(), String> {
            let mut live = self.live.lock().map_err(|_| "session lock poisoned")?;
            let s = live.get_mut(&id).ok_or("no such guest session")?;
            let mut next = WasmVm::new(&self.engine, module)?;
            let old = s.vm.mem();
            let new = next.mem();
            if old.len() != new.len() {
                return Err("new module has a different memory size".into());
            }
            new.copy_from_slice(old);
            s.vm = next;
            Ok(())
        }

        pub fn end(&self, id: u32) {
            if let Ok(mut live) = self.live.lock() {
                live.remove(&id);
            }
        }
    }
}

/// `invoke("guest_start", { module, arch, chunks, brkBase, mmapTop, stdin, fuel })` -> session id
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn guest_start(
    sessions: tauri::State<'_, native_guest::GuestSessions>,
    module: Vec<u8>,
    arch: String,
    chunks: Vec<(u64, Vec<u8>)>,
    brk_base: u64,
    mmap_top: u64,
    stdin: Vec<u8>,
    fuel: i64,
) -> Result<u32, String> {
    sessions.start(&module, &arch, chunks, brk_base, mmap_top, stdin, fuel)
}

/// `invoke("guest_resume", { id, maxEvents })`
#[tauri::command]
fn guest_resume(sessions: tauri::State<'_, native_guest::GuestSessions>, id: u32, max_events: usize) -> Result<native_guest::Resume, String> {
    sessions.resume(id, max_events)
}

/// `invoke("guest_swap", { id, module })`
#[tauri::command]
fn guest_swap(sessions: tauri::State<'_, native_guest::GuestSessions>, id: u32, module: Vec<u8>) -> Result<(), String> {
    sessions.swap(id, &module)
}

/// `invoke("guest_end", { id })`
#[tauri::command]
fn guest_end(sessions: tauri::State<'_, native_guest::GuestSessions>, id: u32) {
    sessions.end(id)
}

/// Called from the UI: `invoke("run_wasm", { bytes, seed })`.
#[tauri::command]
fn run_wasm(bytes: Vec<u8>, seed: i32) -> Result<i32, String> {
    sandbox::run_i32(&bytes, "run", seed, sandbox::DEFAULT_FUEL)
}

/// Which machine this host is running on, so the UI can show x86 vs ARM.
#[tauri::command]
fn host_info() -> (String, String) {
    (std::env::consts::OS.to_string(), std::env::consts::ARCH.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(native_guest::GuestSessions::default())
        .invoke_handler(tauri::generate_handler![run_wasm, host_info, guest_start, guest_resume, guest_swap, guest_end])
        .run(tauri::generate_context!())
        .expect("error while running the Forge host");
}

#[cfg(test)]
mod tests {
    use super::sandbox::run_i32;

    /// Produced by src/engine/wasm-backend.ts from: mov x0, 9 ; add x0, x0, 2 ; ret
    const SAMPLE: &[u8] = &[
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f, 0x03, 0x02,
        0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00, 0x0a, 0x14, 0x01, 0x12, 0x01, 0x03, 0x7f,
        0x41, 0x09, 0x21, 0x00, 0x20, 0x00, 0x41, 0x02, 0x6a, 0x21, 0x00, 0x20, 0x00, 0x0f, 0x0b,
    ];

    #[test]
    fn translated_program_runs_natively() {
        assert_eq!(run_i32(SAMPLE, "run", 0, 1_000_000), Ok(11));
    }

    #[test]
    fn junk_is_refused() {
        assert!(run_i32(&[0, 1, 2, 3], "run", 0, 1_000_000).is_err());
    }
}
