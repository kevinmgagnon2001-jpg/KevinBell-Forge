//! Native side of Forge's Linux layer: the system-call shim and the run loop.
//!
//! The page lifts x86-64 or AArch64 machine code to guest IR and lowers it to one WebAssembly module
//! with no imports (src/engine/guest/wasm.ts). That module keeps the CPU state in the guest's null
//! page and returns to the host whenever it needs something: a system call, more fuel, or an address
//! it has no translation for. This file answers those events. It depends only on `std`, so it is
//! unit-tested without wasmtime (`rustc --edition 2021 --test src/guest.rs`); `lib.rs` plugs in the
//! wasmtime engine through the `Vm` trait.
//!
//! Keep this file in step with `LinuxShim` in src/engine/guest/linux.ts and the layout in ir.ts.

use std::collections::{BTreeMap, BTreeSet};

/// CPU state layout inside guest memory (ir.ts STATE).
pub mod layout {
    pub const REGS: usize = 0;
    pub const PC: usize = 0x300;
    pub const FLAGS: usize = 0x308;
    pub const FUEL: usize = 0x320;
    pub const CODE: usize = 0x328;
    pub const FAULT: usize = 0x330;
    pub const NULL_PAGE: u64 = 0x1000;
    pub const NREG: usize = 72;
    /// Thread pointer (x86 fs base, ARM tpidr_el0).
    pub const TP: usize = 36;
}

/// Stop codes returned by the module's `run` (ir.ts Stop).
pub mod stop {
    pub const SYSCALL: i32 = 1;
    pub const FUEL: i32 = 2;
    pub const UNMAPPED: i32 = 3;
    pub const GAP: i32 = 4;
    pub const FAULT: i32 = 5;
    pub const DIV0: i32 = 6;
    pub const SMC: i32 = 7;
    pub const UNSUPPORTED: i32 = 8;
    pub const HALT: i32 = 9;

    pub fn name(code: i32) -> &'static str {
        match code {
            SYSCALL => "syscall",
            FUEL => "out of fuel",
            UNMAPPED => "jumped to an address with no translation",
            GAP => "reached bytes the map does not know (not executed)",
            FAULT => "memory fault",
            DIV0 => "divide by zero",
            SMC => "program tried to modify its own code",
            UNSUPPORTED => "unsupported operation",
            HALT => "halted",
            _ => "stopped",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Arch {
    X86_64,
    Aarch64,
}

impl Arch {
    pub fn parse(text: &str) -> Option<Arch> {
        match text {
            "x86_64" => Some(Arch::X86_64),
            "aarch64" => Some(Arch::Aarch64),
            _ => None,
        }
    }
    fn nr_reg(self) -> usize {
        match self {
            Arch::X86_64 => 0,
            Arch::Aarch64 => 8,
        }
    }
    fn arg_regs(self) -> [usize; 6] {
        match self {
            Arch::X86_64 => [7, 6, 2, 10, 8, 9],
            Arch::Aarch64 => [0, 1, 2, 3, 4, 5],
        }
    }
    fn ret_reg(self) -> usize {
        0
    }
    fn label(self) -> &'static str {
        match self {
            Arch::X86_64 => "x86_64",
            Arch::Aarch64 => "aarch64",
        }
    }
    /// System-call number to name, same table as linux.ts.
    pub fn syscall_name(self, nr: u64) -> String {
        let name = match self {
            Arch::X86_64 => match nr {
                0 => "read", 1 => "write", 2 => "open", 3 => "close", 5 => "fstat", 9 => "mmap", 10 => "mprotect",
                11 => "munmap", 12 => "brk", 13 => "rt_sigaction", 14 => "rt_sigprocmask", 16 => "ioctl", 20 => "writev",
                21 => "access", 28 => "madvise", 39 => "getpid", 60 => "exit", 63 => "uname", 89 => "readlink",
                102 => "getuid", 104 => "getgid", 107 => "geteuid", 108 => "getegid", 158 => "arch_prctl", 186 => "gettid",
                201 => "time", 218 => "set_tid_address", 228 => "clock_gettime", 231 => "exit_group", 257 => "openat",
                262 => "newfstatat", 267 => "readlinkat", 269 => "faccessat", 273 => "set_robust_list", 302 => "prlimit64",
                318 => "getrandom",
                _ => "",
            },
            Arch::Aarch64 => match nr {
                29 => "ioctl", 48 => "faccessat", 56 => "openat", 57 => "close", 63 => "read", 64 => "write", 66 => "writev",
                78 => "readlinkat", 79 => "newfstatat", 80 => "fstat", 93 => "exit", 94 => "exit_group", 96 => "set_tid_address",
                99 => "set_robust_list", 113 => "clock_gettime", 134 => "rt_sigaction", 135 => "rt_sigprocmask", 160 => "uname",
                172 => "getpid", 174 => "getuid", 175 => "geteuid", 176 => "getgid", 177 => "getegid", 178 => "gettid",
                214 => "brk", 215 => "munmap", 222 => "mmap", 226 => "mprotect", 233 => "madvise", 261 => "prlimit64",
                278 => "getrandom",
                _ => "",
            },
        };
        if name.is_empty() { format!("#{nr}") } else { name.to_string() }
    }
}

// ---------- raw state access ----------

fn rd64(mem: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&mem[at..at + 8]);
    u64::from_le_bytes(b)
}
fn wr64(mem: &mut [u8], at: usize, v: u64) {
    mem[at..at + 8].copy_from_slice(&v.to_le_bytes());
}

pub fn reg(mem: &[u8], i: usize) -> u64 {
    rd64(mem, layout::REGS + i * 8)
}
pub fn set_reg(mem: &mut [u8], i: usize, v: u64) {
    wr64(mem, layout::REGS + i * 8, v)
}
pub fn pc(mem: &[u8]) -> u64 {
    rd64(mem, layout::PC)
}
pub fn fuel(mem: &[u8]) -> i64 {
    rd64(mem, layout::FUEL) as i64
}
pub fn set_fuel(mem: &mut [u8], v: i64) {
    wr64(mem, layout::FUEL, v as u64)
}
pub fn fault_addr(mem: &[u8]) -> u64 {
    rd64(mem, layout::FAULT)
}

/// Guest-visible range check: never the null page (CPU state lives there), never past the end.
fn range(mem: &[u8], addr: u64, len: u64) -> Option<std::ops::Range<usize>> {
    let end = addr.checked_add(len)?;
    if addr < layout::NULL_PAGE || end > mem.len() as u64 {
        return None;
    }
    Some(addr as usize..end as usize)
}

const ENOENT: i64 = -2;
const EBADF: i64 = -9;
const ENOMEM: i64 = -12;
const EFAULT: i64 = -14;
const EINVAL: i64 = -22;
const ENOTTY: i64 = -25;
const ENOSYS: i64 = -38;

fn page_up(v: u64) -> u64 {
    v.wrapping_add(0xfff) & !0xfff
}

// ---------- the shim ----------

pub struct Shim {
    pub arch: Arch,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub counts: BTreeMap<String, u32>,
    pub unsupported: BTreeSet<String>,
    pub exit_code: Option<i32>,
    stdin: Vec<u8>,
    stdin_at: usize,
    brk_base: u64,
    brk: u64,
    mmap_top: u64,
    seed: u64,
}

pub enum Flow {
    Continue,
    Exit,
}

impl Shim {
    pub fn new(arch: Arch, brk_base: u64, mmap_top: u64, stdin: Vec<u8>) -> Shim {
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e37_79b9_7f4a_7c15);
        Shim {
            arch,
            stdout: Vec::new(),
            stderr: Vec::new(),
            counts: BTreeMap::new(),
            unsupported: BTreeSet::new(),
            exit_code: None,
            stdin,
            stdin_at: 0,
            brk_base,
            brk: brk_base,
            mmap_top,
            seed,
        }
    }

    fn out(&mut self, fd: u64, data: &[u8]) -> i64 {
        let sink = match fd {
            1 => &mut self.stdout,
            2 => &mut self.stderr,
            _ => return EBADF,
        };
        if sink.len() < 64 * 1024 * 1024 {
            sink.extend_from_slice(data);
        }
        data.len() as i64
    }

    /// Answer the system call the guest is making.
    pub fn handle(&mut self, mem: &mut [u8]) -> Flow {
        let nr = reg(mem, self.arch.nr_reg());
        let regs = self.arch.arg_regs();
        let a: Vec<u64> = regs.iter().map(|&r| reg(mem, r)).collect();
        let name = self.arch.syscall_name(nr);
        *self.counts.entry(name.clone()).or_insert(0) += 1;
        let ret: i64 = match name.as_str() {
            "write" => {
                let len = a[2].min(0x7fff_ffff);
                match range(mem, a[1], len) {
                    Some(r) => {
                        let data = mem[r].to_vec();
                        self.out(a[0], &data)
                    }
                    None => EFAULT,
                }
            }
            "writev" => {
                let mut total = 0i64;
                let mut ret = 0i64;
                for i in 0..a[2].min(1024) {
                    let Some(r) = range(mem, a[1] + i * 16, 16) else { ret = EFAULT; break };
                    let base = rd64(mem, r.start);
                    let len = rd64(mem, r.start + 8) & 0x7fff_ffff;
                    let Some(d) = range(mem, base, len) else { ret = EFAULT; break };
                    let data = mem[d].to_vec();
                    let n = self.out(a[0], &data);
                    if n < 0 { ret = n; break; }
                    total += n;
                    ret = total;
                }
                ret
            }
            "read" => {
                if a[0] != 0 {
                    EBADF
                } else {
                    let n = (a[2].min(0x7fff_ffff) as usize).min(self.stdin.len() - self.stdin_at);
                    if n == 0 {
                        0
                    } else {
                        match range(mem, a[1], n as u64) {
                            Some(r) => {
                                mem[r].copy_from_slice(&self.stdin[self.stdin_at..self.stdin_at + n]);
                                self.stdin_at += n;
                                n as i64
                            }
                            None => EFAULT,
                        }
                    }
                }
            }
            "exit" | "exit_group" => {
                self.exit_code = Some((a[0] & 0xff) as i32);
                return Flow::Exit;
            }
            "brk" => {
                if a[0] == 0 || a[0] < self.brk_base || a[0] > self.mmap_top {
                    self.brk as i64
                } else {
                    if a[0] > self.brk {
                        mem[self.brk as usize..a[0] as usize].fill(0);
                    }
                    self.brk = a[0];
                    self.brk as i64
                }
            }
            "mmap" => {
                if a[3] & 0x20 == 0 {
                    ENOSYS // only anonymous memory; there are no files
                } else {
                    let size = page_up(a[1]);
                    let next = self.mmap_top.wrapping_sub(size) & !0xfff;
                    if size == 0 || next < page_up(self.brk) || next > self.mmap_top {
                        ENOMEM
                    } else {
                        self.mmap_top = next;
                        mem[next as usize..(next + size) as usize].fill(0);
                        next as i64
                    }
                }
            }
            "arch_prctl" => {
                if a[0] == 0x1002 {
                    set_reg(mem, layout::TP, a[1]);
                    0
                } else {
                    EINVAL
                }
            }
            "munmap" | "mprotect" | "madvise" | "rt_sigaction" | "rt_sigprocmask" | "close" | "set_robust_list" => 0,
            "ioctl" => ENOTTY,
            "getpid" | "gettid" | "getuid" | "geteuid" | "getgid" | "getegid" | "set_tid_address" => 1000,
            "uname" => {
                let mut buf = vec![0u8; 65 * 6];
                for (i, s) in ["Linux", "forge", "6.0.0-forge", "#1 Forge", self.arch.label(), ""].iter().enumerate() {
                    buf[i * 65..i * 65 + s.len()].copy_from_slice(s.as_bytes());
                }
                match range(mem, a[0], buf.len() as u64) {
                    Some(r) => {
                        mem[r].copy_from_slice(&buf);
                        0
                    }
                    None => EFAULT,
                }
            }
            "clock_gettime" => match range(mem, a[1], 16) {
                Some(r) => {
                    mem[r].fill(0); // a fixed clock: always zero, like the page
                    0
                }
                None => EFAULT,
            },
            "getrandom" => {
                let n = a[1].min(256);
                match range(mem, a[0], n) {
                    Some(r) => {
                        for b in &mut mem[r] {
                            // xorshift; not for cryptography (the guest has no keys to protect here)
                            self.seed ^= self.seed << 13;
                            self.seed ^= self.seed >> 7;
                            self.seed ^= self.seed << 17;
                            *b = self.seed as u8;
                        }
                        n as i64
                    }
                    None => EFAULT,
                }
            }
            "readlinkat" | "readlink" | "openat" | "open" | "access" | "faccessat" | "newfstatat" | "fstat" => ENOENT,
            "prlimit64" => ENOSYS,
            other => {
                self.unsupported.insert(other.to_string());
                ENOSYS
            }
        };
        set_reg(mem, self.arch.ret_reg(), ret as u64);
        Flow::Continue
    }
}

// ---------- the run loop ----------

/// Anything that can run a lowered guest module: wasmtime in the desktop host, a fake in tests.
pub trait Vm {
    /// Call the module's `run`. Err means the engine trapped (a bug or an exhausted host budget).
    fn run(&mut self) -> Result<i32, String>;
    fn mem(&mut self) -> &mut [u8];
}

#[derive(Debug, PartialEq, Eq)]
pub enum Event {
    /// The program called exit.
    Exit(i32),
    /// The program jumped to `pc`, which has no translation yet. The page lifts more code and swaps in a new module.
    NeedsCode(u64),
    /// The program stopped for good (fault, gap, out of fuel, ...).
    Stopped { code: i32, pc: u64, fault: u64 },
    /// Returned to the host to stay responsive; call `drive` again to continue.
    Yield,
    /// The engine itself failed.
    Trap(String),
}

/// Run until something needs the page, the program ends, or `max_events` host round trips pass.
/// Guest fuel is handed out in slices so a long program keeps returning to the host.
pub fn drive(vm: &mut dyn Vm, shim: &mut Shim, budget: &mut i64, slice: i64, max_events: usize) -> Event {
    for _ in 0..max_events {
        let give = (*budget).min(slice).max(0);
        set_fuel(vm.mem(), give);
        let code = match vm.run() {
            Ok(c) => c,
            Err(e) => return Event::Trap(e),
        };
        let left = fuel(vm.mem());
        *budget -= give - left.max(0);
        match code {
            stop::SYSCALL => {
                if let Flow::Exit = shim.handle(vm.mem()) {
                    return Event::Exit(shim.exit_code.unwrap_or(0));
                }
            }
            stop::FUEL => {
                if *budget <= 0 {
                    let m = vm.mem();
                    return Event::Stopped { code, pc: pc(m), fault: 0 };
                }
                return Event::Yield;
            }
            stop::UNMAPPED => return Event::NeedsCode(pc(vm.mem())),
            _ => {
                let m = vm.mem();
                return Event::Stopped { code, pc: pc(m), fault: fault_addr(m) };
            }
        }
    }
    Event::Yield
}

#[cfg(test)]
mod tests {
    use super::*;

    const MEM: usize = 1 << 20;

    /// A fake engine: each run() performs one scripted step on memory and returns a stop code.
    struct Script {
        mem: Vec<u8>,
        steps: Vec<Box<dyn FnMut(&mut [u8]) -> i32>>,
        at: usize,
    }
    impl Vm for Script {
        fn run(&mut self) -> Result<i32, String> {
            let step = self.steps.get_mut(self.at).ok_or("script ran out")?;
            self.at += 1;
            Ok(step(&mut self.mem))
        }
        fn mem(&mut self) -> &mut [u8] {
            &mut self.mem
        }
    }

    fn syscall(arch: Arch, nr: u64, args: &[u64]) -> impl FnMut(&mut [u8]) -> i32 {
        let args = args.to_vec();
        move |m: &mut [u8]| {
            set_reg(m, arch.nr_reg(), nr);
            for (i, v) in args.iter().enumerate() {
                set_reg(m, arch.arg_regs()[i], *v);
            }
            set_fuel(m, fuel(m) - 10);
            stop::SYSCALL
        }
    }

    #[test]
    fn layout_matches_the_page() {
        // ir.ts: STATE = { regs: 0, pc: 0x300, flags: 0x308, fuel: 0x320, code: 0x328, fault: 0x330 }, NREG = 72
        assert!(layout::REGS + layout::NREG * 8 <= layout::PC);
        assert_eq!((layout::PC, layout::FLAGS, layout::FUEL, layout::CODE, layout::FAULT), (0x300, 0x308, 0x320, 0x328, 0x330));
    }

    #[test]
    fn write_then_exit_on_both_architectures() {
        for (arch, write, exit) in [(Arch::X86_64, 1, 60), (Arch::Aarch64, 64, 93)] {
            let mut mem = vec![0u8; MEM];
            mem[0x2000..0x2005].copy_from_slice(b"hello");
            let mut vm = Script { mem, steps: vec![Box::new(syscall(arch, write, &[1, 0x2000, 5])), Box::new(syscall(arch, exit, &[7]))], at: 0 };
            let mut shim = Shim::new(arch, 0x10000, 0x80000, vec![]);
            let mut budget = 1_000;
            assert_eq!(drive(&mut vm, &mut shim, &mut budget, 1_000, 10), Event::Exit(7));
            assert_eq!(shim.stdout, b"hello");
            assert_eq!(shim.counts.get("write"), Some(&1));
        }
    }

    #[test]
    fn the_null_page_and_out_of_range_buffers_are_refused() {
        let mut mem = vec![0u8; MEM];
        let mut shim = Shim::new(Arch::X86_64, 0x10000, 0x80000, vec![]);
        set_reg(&mut mem, 0, 1);
        set_reg(&mut mem, 7, 1);
        set_reg(&mut mem, 6, 0x10); // inside the null page, where CPU state lives
        set_reg(&mut mem, 2, 4);
        shim.handle(&mut mem);
        assert_eq!(reg(&mem, 0) as i64, EFAULT);
        set_reg(&mut mem, 0, 1);
        set_reg(&mut mem, 6, (MEM - 2) as u64);
        shim.handle(&mut mem);
        assert_eq!(reg(&mem, 0) as i64, EFAULT);
        assert!(shim.stdout.is_empty());
    }

    #[test]
    fn stdin_brk_mmap_and_tls() {
        let mut mem = vec![0u8; MEM];
        let mut shim = Shim::new(Arch::X86_64, 0x20000, 0x80000, b"abc".to_vec());
        let call = |shim: &mut Shim, mem: &mut Vec<u8>, nr: u64, args: &[u64]| {
            set_reg(mem, 0, nr);
            for (i, v) in args.iter().enumerate() {
                set_reg(mem, [7, 6, 2, 10, 8, 9][i], *v);
            }
            shim.handle(mem);
            reg(mem, 0) as i64
        };
        assert_eq!(call(&mut shim, &mut mem, 0, &[0, 0x3000, 10]), 3);
        assert_eq!(&mem[0x3000..0x3003], b"abc");
        assert_eq!(call(&mut shim, &mut mem, 0, &[0, 0x3000, 10]), 0, "end of input");
        assert_eq!(call(&mut shim, &mut mem, 12, &[0]), 0x20000);
        assert_eq!(call(&mut shim, &mut mem, 12, &[0x24000]), 0x24000);
        let m = call(&mut shim, &mut mem, 9, &[0, 0x2000, 3, 0x22]);
        assert_eq!(m, 0x7e000);
        assert_eq!(call(&mut shim, &mut mem, 9, &[0, 0x2000, 3, 0x02]), ENOSYS, "file-backed mmap is refused");
        assert_eq!(call(&mut shim, &mut mem, 158, &[0x1002, 0x55000]), 0);
        assert_eq!(reg(&mem, layout::TP), 0x55000);
        assert_eq!(call(&mut shim, &mut mem, 999, &[]), ENOSYS);
        assert!(shim.unsupported.contains("#999"));
    }

    #[test]
    fn untranslated_code_and_faults_go_back_to_the_page() {
        let mut vm = Script {
            mem: vec![0u8; MEM],
            steps: vec![
                Box::new(|m: &mut [u8]| {
                    wr64(m, layout::PC, 0x401000);
                    stop::UNMAPPED
                }),
                Box::new(|m: &mut [u8]| {
                    wr64(m, layout::PC, 0x401004);
                    wr64(m, layout::FAULT, 0x8);
                    stop::FAULT
                }),
            ],
            at: 0,
        };
        let mut shim = Shim::new(Arch::Aarch64, 0x10000, 0x80000, vec![]);
        let mut budget = 100;
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::NeedsCode(0x401000));
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::Stopped { code: stop::FAULT, pc: 0x401004, fault: 0x8 });
    }

    #[test]
    fn fuel_is_handed_out_in_slices_and_runs_out() {
        let burn = |m: &mut [u8]| {
            set_fuel(m, -1);
            stop::FUEL
        };
        let mut vm = Script { mem: vec![0u8; MEM], steps: vec![Box::new(burn), Box::new(burn), Box::new(burn)], at: 0 };
        let mut shim = Shim::new(Arch::X86_64, 0x10000, 0x80000, vec![]);
        let mut budget = 250;
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::Yield);
        assert_eq!(budget, 150);
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::Yield);
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::Stopped { code: stop::FUEL, pc: 0, fault: 0 });
    }
}
