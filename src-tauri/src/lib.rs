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

    /// Compiled machine code per WebAssembly function, kept for the life of the app. When the page
    /// lifts more of a program and swaps in a new module, every function that did not change comes
    /// from here instead of being compiled again (guest/wasm.ts keeps unchanged chunks byte-identical),
    /// and running the same program twice compiles almost nothing.
    #[derive(Debug, Default)]
    struct CompileCache {
        entries: Mutex<(HashMap<Vec<u8>, Vec<u8>>, usize)>,
    }

    const COMPILE_CACHE_BYTES: usize = 256 * 1024 * 1024;

    impl wasmtime::CacheStore for CompileCache {
        fn get(&self, key: &[u8]) -> Option<std::borrow::Cow<'_, [u8]>> {
            let entries = self.entries.lock().ok()?;
            entries.0.get(key).cloned().map(std::borrow::Cow::Owned)
        }
        fn insert(&self, key: &[u8], value: Vec<u8>) -> bool {
            let Ok(mut entries) = self.entries.lock() else { return false };
            if entries.1 + key.len() + value.len() > COMPILE_CACHE_BYTES {
                // Simple and bounded: start over rather than track recency.
                entries.0.clear();
                entries.1 = 0;
            }
            entries.1 += key.len() + value.len();
            entries.0.insert(key.to_vec(), value);
            true
        }
    }

    impl Default for GuestSessions {
        fn default() -> Self {
            let mut config = Config::new();
            config.consume_fuel(true);
            config
                .enable_incremental_compilation(std::sync::Arc::new(CompileCache::default()))
                .expect("incremental compilation cache");
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
        /// The program's file tree, sent once it has finished (exit, stop or trap).
        pub files: Option<BTreeMap<String, Vec<u8>>>,
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
            files: BTreeMap<String, Vec<u8>>,
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
            let session = Session { vm, shim: Shim::new(arch, brk_base, mmap_top, stdin, files), budget: fuel.max(0), start_budget: fuel.max(0) };
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
            let finished = !matches!(status, "running" | "needs-code");
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
                files: finished.then(|| s.shim.files.snapshot()),
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

/// `invoke("guest_start", { module, arch, chunks, brkBase, mmapTop, stdin, fuel, files })` -> session id
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
    files: Option<std::collections::BTreeMap<String, Vec<u8>>>,
) -> Result<u32, String> {
    sessions.start(&module, &arch, chunks, brk_base, mmap_top, stdin, fuel, files.unwrap_or_default())
}

/// `invoke("guest_resume", { id, maxEvents })`
#[tauri::command]
fn guest_resume(sessions: tauri::State<'_, native_guest::GuestSessions>, id: u32, max_events: usize) -> Result<native_guest::Resume, String> {
    sessions.resume(id, max_events)
}

/// `invoke("guest_swap", moduleBytes, { headers: { "forge-session": id } })`: the module travels as raw
/// bytes (a glibc program's module is megabytes; as a JSON number array it was three times that and slow
/// to encode and parse). `invoke("guest_swap", { id, module })` is still accepted.
#[tauri::command]
fn guest_swap(sessions: tauri::State<'_, native_guest::GuestSessions>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(module) => {
            let id = request
                .headers()
                .get("forge-session")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u32>().ok())
                .ok_or("guest_swap needs a forge-session header")?;
            sessions.swap(id, module)
        }
        tauri::ipc::InvokeBody::Json(args) => {
            let id = args.get("id").and_then(|v| v.as_u64()).ok_or("guest_swap needs an id")? as u32;
            let module: Vec<u8> = serde_json::from_value(args.get("module").cloned().unwrap_or_default()).map_err(|e| e.to_string())?;
            sessions.swap(id, &module)
        }
    }
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
    use tauri::Manager;

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

    /// The real guest_swap command, called the way the page calls it: raw bytes, session in a header.
    #[test]
    fn guest_swap_takes_raw_bytes_with_the_session_in_a_header() {
        use tauri::ipc::{CallbackFn, InvokeBody};
        use tauri::webview::InvokeRequest;
        let app = tauri::test::mock_builder()
            .manage(super::native_guest::GuestSessions::default())
            .invoke_handler(tauri::generate_handler![super::guest_swap])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
        // A minimal guest module: the shape the runner needs (exported memory and run()).
        let module = br#"(module (memory (export "mem") 1 1) (func (export "run") (result i32) i32.const 9))"#;
        let sessions = app.state::<super::native_guest::GuestSessions>();
        let id = sessions.start(module, "x86_64", vec![], 0x2000, 0x8000, vec![], 1000, Default::default()).unwrap();
        let call = |session: Option<String>| {
            let mut headers = tauri::http::HeaderMap::new();
            if let Some(v) = session {
                headers.insert("forge-session", v.parse().unwrap());
            }
            tauri::test::get_ipc_response(
                &webview,
                InvokeRequest {
                    cmd: "guest_swap".into(),
                    callback: CallbackFn(0),
                    error: CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: InvokeBody::Raw(module.to_vec()),
                    headers,
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            )
        };
        assert!(call(Some(id.to_string())).is_ok());
        assert_eq!(call(None).unwrap_err(), serde_json::json!("guest_swap needs a forge-session header"));
        assert_eq!(call(Some("999".into())).unwrap_err(), serde_json::json!("no such guest session"));
    }
}
