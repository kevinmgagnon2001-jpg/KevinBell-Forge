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
    pub const REGS: usize = 0x400;
    pub const PC: usize = 0x300;
    pub const FLAGS: usize = 0x308;
    pub const FUEL: usize = 0x320;
    pub const CODE: usize = 0x328;
    pub const FAULT: usize = 0x330;
    /// Translated code range that stores are checked against; the module writes it when run() starts.
    pub const CODE_LO: usize = 0x340;
    pub const CODE_HI: usize = 0x348;
    pub const NULL_PAGE: u64 = 0x1000;
    pub const NREG: usize = 106;
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
                0 => "read", 1 => "write", 2 => "open", 3 => "close", 5 => "fstat", 8 => "lseek", 9 => "mmap", 10 => "mprotect",
                11 => "munmap", 12 => "brk", 13 => "rt_sigaction", 14 => "rt_sigprocmask", 16 => "ioctl", 20 => "writev",
                21 => "access", 22 => "pipe", 28 => "madvise", 32 => "dup", 33 => "dup2", 39 => "getpid", 60 => "exit",
                63 => "uname", 72 => "fcntl", 83 => "mkdir", 84 => "rmdir", 87 => "unlink", 89 => "readlink",
                102 => "getuid", 104 => "getgid", 107 => "geteuid", 108 => "getegid", 158 => "arch_prctl", 186 => "gettid",
                201 => "time", 217 => "getdents64", 218 => "set_tid_address", 228 => "clock_gettime", 231 => "exit_group",
                257 => "openat", 258 => "mkdirat", 262 => "newfstatat", 263 => "unlinkat", 267 => "readlinkat", 269 => "faccessat",
                273 => "set_robust_list", 292 => "dup3", 293 => "pipe2", 302 => "prlimit64", 318 => "getrandom", 334 => "rseq",
                _ => "",
            },
            Arch::Aarch64 => match nr {
                23 => "dup", 24 => "dup3", 25 => "fcntl", 29 => "ioctl", 34 => "mkdirat", 35 => "unlinkat", 48 => "faccessat",
                56 => "openat", 57 => "close", 59 => "pipe2", 61 => "getdents64", 62 => "lseek", 63 => "read", 64 => "write", 66 => "writev",
                78 => "readlinkat", 79 => "newfstatat", 80 => "fstat", 93 => "exit", 94 => "exit_group", 96 => "set_tid_address",
                99 => "set_robust_list", 113 => "clock_gettime", 134 => "rt_sigaction", 135 => "rt_sigprocmask", 160 => "uname",
                172 => "getpid", 174 => "getuid", 175 => "geteuid", 176 => "getgid", 177 => "getegid", 178 => "gettid",
                214 => "brk", 215 => "munmap", 222 => "mmap", 226 => "mprotect", 233 => "madvise", 261 => "prlimit64",
                278 => "getrandom", 293 => "rseq",
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
const EEXIST: i64 = -17;
const EISDIR: i64 = -21;
const EINVAL: i64 = -22;
const EMFILE: i64 = -24;
const ENOTTY: i64 = -25;
const ENOSPC: i64 = -28;
const ENAMETOOLONG: i64 = -36;
const ENOSYS: i64 = -38;

fn page_up(v: u64) -> u64 {
    v.wrapping_add(0xfff) & !0xfff
}

// ---------- files (work item N7) ----------

/// A guest program's files: a private in-memory tree the host hands over, the standard streams, pipes
/// and the open descriptors. Only paths in the tree exist. Same rules as GuestFiles in
/// src/engine/guest/files.ts (read its header for the model); keep the two in step.
pub mod files {
    use super::{EBADF, EEXIST, EINVAL, EISDIR, EMFILE, ENOENT, ENOSPC};
    use std::collections::{BTreeMap, BTreeSet, VecDeque};
    use std::sync::{Arc, Mutex, MutexGuard};

    const EAGAIN: i64 = -11;
    const EBUSY: i64 = -16;
    const ENOTDIR: i64 = -20;
    const ESPIPE: i64 = -29;
    const EPIPE: i64 = -32;
    const ENOTEMPTY: i64 = -39;

    pub const O_ACCMODE: u64 = 3;
    pub const O_WRONLY: u64 = 1;
    pub const O_RDWR: u64 = 2;
    pub const O_CREAT: u64 = 0x40;
    pub const O_EXCL: u64 = 0x80;
    pub const O_TRUNC: u64 = 0x200;
    pub const O_APPEND: u64 = 0x400;
    /// The x86-64 value. The shim translates AArch64's (0x4000) to this.
    pub const O_DIRECTORY: u64 = 0x10000;
    pub const O_CLOEXEC: u64 = 0x80000;
    pub const AT_FDCWD: i64 = -100;
    pub const AT_REMOVEDIR: u64 = 0x200;
    pub const MAX_TREE_BYTES: usize = 64 * 1024 * 1024;
    /// Most descriptors open at once besides the three standard ones.
    pub const MAX_OPEN: usize = 256;
    pub const MAX_FILES: usize = 4096;
    /// Highest descriptor number + 1.
    pub const FD_LIMIT: i64 = 1024;
    pub const PIPE_BYTES: usize = 65536;
    const SINK_BYTES: usize = 64 * 1024 * 1024;

    /// "/a/./b/../c" and "a//c" both become "/a/c". ".." never climbs above the root.
    pub fn normalize(path: &str) -> String {
        let mut parts: Vec<&str> = Vec::new();
        for part in path.split('/') {
            match part {
                "" | "." => {}
                ".." => {
                    parts.pop();
                }
                p => parts.push(p),
            }
        }
        format!("/{}", parts.join("/"))
    }

    fn parent(path: &str) -> String {
        match path.rfind('/') {
            Some(0) | None => "/".to_string(),
            Some(i) => path[..i].to_string(),
        }
    }

    fn lk<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
        m.lock().unwrap_or_else(|e| e.into_inner())
    }

    type Node = Arc<Mutex<Vec<u8>>>;
    type PipeRef = Arc<Mutex<VecDeque<u8>>>;

    /// An open file description: what dup'd descriptors share.
    enum Desc {
        File { node: Node, pos: usize, read: bool, write: bool, append: bool },
        Dir { path: String, pos: usize },
        Pipe { pipe: PipeRef, write: bool },
        Stream(u8),
    }

    struct Slot {
        desc: Arc<Mutex<Desc>>,
        cloexec: bool,
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Kind {
        File,
        Dir,
        Fifo,
    }

    #[derive(Debug, PartialEq, Eq)]
    pub struct Stat {
        pub kind: Kind,
        pub size: usize,
    }

    pub struct GuestFiles {
        tree: BTreeMap<String, Node>,
        /// Every directory, root included.
        dirs: BTreeSet<String>,
        fds: BTreeMap<i64, Slot>,
        total: usize,
        stdin: Vec<u8>,
        stdin_at: usize,
        pub stdout: Vec<u8>,
        pub stderr: Vec<u8>,
    }

    impl GuestFiles {
        /// Paths ending in "/" are empty directories.
        pub fn new(files: BTreeMap<String, Vec<u8>>, stdin: Vec<u8>) -> GuestFiles {
            let mut out = GuestFiles {
                tree: BTreeMap::new(),
                dirs: BTreeSet::from(["/".to_string()]),
                fds: BTreeMap::new(),
                total: 0,
                stdin,
                stdin_at: 0,
                stdout: Vec::new(),
                stderr: Vec::new(),
            };
            for (path, data) in files {
                let key = normalize(&path);
                if key == "/" {
                    continue;
                }
                if path.ends_with('/') {
                    if !out.tree.contains_key(&key) {
                        out.add_dir(&key);
                    }
                    continue;
                }
                if out.dirs.contains(&key) {
                    continue;
                }
                out.add_dir(&parent(&key));
                out.total += data.len();
                if let Some(old) = out.tree.insert(key, Arc::new(Mutex::new(data))) {
                    out.total -= lk(&old).len();
                }
            }
            for s in 0..3u8 {
                out.fds.insert(s as i64, Slot { desc: Arc::new(Mutex::new(Desc::Stream(s))), cloexec: false });
            }
            out
        }

        /// Adds a directory and its parents, dropping any file in the way (host trees only).
        fn add_dir(&mut self, path: &str) {
            let mut p = path.to_string();
            while p != "/" && !self.dirs.contains(&p) {
                if let Some(file) = self.tree.remove(&p) {
                    self.total -= lk(&file).len();
                }
                self.dirs.insert(p.clone());
                p = parent(&p);
            }
        }

        /// Resolves a path the way Linux walks one (see files.ts `walk`).
        fn walk(&self, dirfd: i64, raw: &str) -> Result<String, i64> {
            let mut stack: Vec<String> = Vec::new();
            if !raw.starts_with('/') && dirfd != AT_FDCWD {
                let slot = self.fds.get(&dirfd).ok_or(EBADF)?;
                match &*lk(&slot.desc) {
                    Desc::Dir { path, .. } => stack.extend(path.split('/').filter(|p| !p.is_empty()).map(String::from)),
                    _ => return Err(ENOTDIR),
                }
            }
            let parts: Vec<&str> = raw.split('/').filter(|p| !p.is_empty() && *p != ".").collect();
            for (i, part) in parts.iter().enumerate() {
                if *part == ".." {
                    stack.pop();
                } else {
                    stack.push(part.to_string());
                }
                if i + 1 == parts.len() {
                    break;
                }
                let at = format!("/{}", stack.join("/"));
                if self.tree.contains_key(&at) {
                    return Err(ENOTDIR);
                }
                if !self.dirs.contains(&at) {
                    return Err(ENOENT);
                }
            }
            Ok(format!("/{}", stack.join("/")))
        }

        fn lowest_free(&self, min: i64) -> Option<i64> {
            if self.fds.len() >= MAX_OPEN + 3 {
                return None;
            }
            (min..FD_LIMIT).find(|fd| !self.fds.contains_key(fd))
        }

        fn install(&mut self, desc: Arc<Mutex<Desc>>, cloexec: bool, min: i64) -> i64 {
            match self.lowest_free(min) {
                Some(fd) => {
                    self.fds.insert(fd, Slot { desc, cloexec });
                    fd
                }
                None => EMFILE,
            }
        }

        fn desc(&self, fd: i64) -> Option<Arc<Mutex<Desc>>> {
            self.fds.get(&fd).map(|s| s.desc.clone())
        }

        /// Is any descriptor open on this end of the pipe? (No description lock may be held.)
        fn pipe_end_open(&self, pipe: &PipeRef, write: bool) -> bool {
            self.fds.values().any(|s| matches!(&*lk(&s.desc), Desc::Pipe { pipe: p, write: w } if Arc::ptr_eq(p, pipe) && *w == write))
        }

        pub fn open(&mut self, raw: &str, flags: u64) -> i64 {
            self.open_at(AT_FDCWD, raw, flags)
        }

        pub fn open_at(&mut self, dirfd: i64, raw: &str, flags: u64) -> i64 {
            let path = match self.walk(dirfd, raw) {
                Ok(p) => p,
                Err(e) => return e,
            };
            let acc = flags & O_ACCMODE;
            if acc == O_ACCMODE {
                return EINVAL;
            }
            let write = acc == O_WRONLY || acc == O_RDWR;
            let cloexec = flags & O_CLOEXEC != 0;
            if self.dirs.contains(&path) {
                if flags & O_CREAT != 0 && flags & O_EXCL != 0 {
                    return EEXIST;
                }
                if write || flags & O_CREAT != 0 {
                    return EISDIR;
                }
                return self.install(Arc::new(Mutex::new(Desc::Dir { path, pos: 0 })), cloexec, 0);
            }
            let existing = self.tree.get(&path).cloned();
            if flags & O_DIRECTORY != 0 {
                return if existing.is_some() { ENOTDIR } else { ENOENT };
            }
            let node = match existing {
                Some(n) => {
                    if flags & O_CREAT != 0 && flags & O_EXCL != 0 {
                        return EEXIST;
                    }
                    n
                }
                None => {
                    if flags & O_CREAT == 0 {
                        return ENOENT;
                    }
                    if self.tree.len() + self.dirs.len() >= MAX_FILES {
                        return ENOSPC;
                    }
                    if self.lowest_free(0).is_none() {
                        return EMFILE;
                    }
                    let n: Node = Arc::new(Mutex::new(Vec::new()));
                    self.tree.insert(path, n.clone());
                    n
                }
            };
            let desc = Desc::File { node: node.clone(), pos: 0, read: acc != O_WRONLY, write, append: flags & O_APPEND != 0 };
            let fd = self.install(Arc::new(Mutex::new(desc)), cloexec, 0);
            if fd >= 0 && flags & O_TRUNC != 0 && write {
                let mut d = lk(&node);
                self.total -= d.len();
                d.clear();
            }
            fd
        }

        pub fn close(&mut self, fd: i64) -> i64 {
            if self.fds.remove(&fd).is_some() { 0 } else { EBADF }
        }

        pub fn read(&mut self, fd: i64, max: usize) -> Result<Vec<u8>, i64> {
            let desc = self.desc(fd).ok_or(EBADF)?;
            let mut g = lk(&desc);
            match &mut *g {
                Desc::Stream(0) => {
                    let n = max.min(self.stdin.len() - self.stdin_at);
                    let out = self.stdin[self.stdin_at..self.stdin_at + n].to_vec();
                    self.stdin_at += n;
                    Ok(out)
                }
                Desc::Stream(_) => Err(EBADF),
                Desc::Dir { .. } => Err(EISDIR),
                Desc::Pipe { write: true, .. } => Err(EBADF),
                Desc::Pipe { pipe, .. } => {
                    let pipe = pipe.clone();
                    drop(g);
                    let mut p = lk(&pipe);
                    if p.is_empty() {
                        drop(p);
                        return if max > 0 && self.pipe_end_open(&pipe, true) { Err(EAGAIN) } else { Ok(Vec::new()) };
                    }
                    let n = max.min(p.len());
                    Ok(p.drain(..n).collect())
                }
                Desc::File { read: false, .. } => Err(EBADF),
                Desc::File { node, pos, .. } => {
                    let d = lk(node);
                    let n = max.min(d.len().saturating_sub(*pos));
                    let start = (*pos).min(d.len());
                    let out = d[start..start + n].to_vec();
                    *pos += n;
                    Ok(out)
                }
            }
        }

        pub fn write(&mut self, fd: i64, data: &[u8]) -> i64 {
            let Some(desc) = self.desc(fd) else { return EBADF };
            let mut g = lk(&desc);
            match &mut *g {
                Desc::Stream(0) => EBADF,
                Desc::Stream(s) => {
                    let sink = if *s == 1 { &mut self.stdout } else { &mut self.stderr };
                    if sink.len() < SINK_BYTES {
                        sink.extend_from_slice(data);
                    }
                    data.len() as i64
                }
                Desc::Dir { .. } => EBADF,
                Desc::Pipe { write: false, .. } => EBADF,
                Desc::Pipe { pipe, .. } => {
                    let pipe = pipe.clone();
                    drop(g);
                    if !self.pipe_end_open(&pipe, false) {
                        return EPIPE;
                    }
                    if data.is_empty() {
                        return 0;
                    }
                    let mut p = lk(&pipe);
                    let n = data.len().min(PIPE_BYTES - p.len());
                    if n == 0 {
                        return EAGAIN;
                    }
                    p.extend(&data[..n]);
                    n as i64
                }
                Desc::File { write: false, .. } => EBADF,
                Desc::File { node, pos, append, .. } => {
                    let mut d = lk(node);
                    if *append {
                        *pos = d.len();
                    }
                    let end = *pos + data.len();
                    let added = end.saturating_sub(d.len());
                    if self.total + added > MAX_TREE_BYTES {
                        return ENOSPC;
                    }
                    if end > d.len() {
                        d.resize(end, 0);
                    }
                    d[*pos..end].copy_from_slice(data);
                    self.total += added;
                    *pos = end;
                    data.len() as i64
                }
            }
        }

        pub fn lseek(&mut self, fd: i64, offset: i64, whence: u64) -> i64 {
            let Some(desc) = self.desc(fd) else { return EBADF };
            let mut g = lk(&desc);
            let (pos, size) = match &mut *g {
                Desc::Pipe { .. } | Desc::Stream(_) => return ESPIPE,
                Desc::Dir { pos, .. } => (pos, None),
                Desc::File { node, pos, .. } => {
                    let size = lk(node).len() as i64;
                    (pos, Some(size))
                }
            };
            let base = match (whence, size) {
                (0, _) => 0,
                (1, _) => *pos as i64,
                (2, Some(size)) => size,
                _ => return EINVAL,
            };
            let at = base.saturating_add(offset);
            if at < 0 || at > MAX_TREE_BYTES as i64 {
                return EINVAL;
            }
            *pos = at as usize;
            at
        }

        /// The standard streams have no file behind them here (-ENOENT); libc then falls back to its defaults.
        pub fn stat_fd(&self, fd: i64) -> Result<Stat, i64> {
            let desc = self.desc(fd).ok_or(EBADF)?;
            let g = lk(&desc);
            match &*g {
                Desc::Stream(_) => Err(ENOENT),
                Desc::Dir { .. } => Ok(Stat { kind: Kind::Dir, size: 4096 }),
                Desc::Pipe { .. } => Ok(Stat { kind: Kind::Fifo, size: 0 }),
                Desc::File { node, .. } => Ok(Stat { kind: Kind::File, size: lk(node).len() }),
            }
        }

        pub fn stat_path(&self, raw: &str) -> Result<Stat, i64> {
            self.stat_at(AT_FDCWD, raw)
        }

        pub fn stat_at(&self, dirfd: i64, raw: &str) -> Result<Stat, i64> {
            let path = self.walk(dirfd, raw)?;
            if let Some(n) = self.tree.get(&path) {
                return Ok(Stat { kind: Kind::File, size: lk(n).len() });
            }
            if self.dirs.contains(&path) { Ok(Stat { kind: Kind::Dir, size: 4096 }) } else { Err(ENOENT) }
        }

        pub fn mkdir_at(&mut self, dirfd: i64, raw: &str) -> i64 {
            let path = match self.walk(dirfd, raw) {
                Ok(p) => p,
                Err(e) => return e,
            };
            if self.dirs.contains(&path) || self.tree.contains_key(&path) {
                return EEXIST;
            }
            if self.tree.len() + self.dirs.len() >= MAX_FILES {
                return ENOSPC;
            }
            self.dirs.insert(path);
            0
        }

        pub fn unlink(&mut self, raw: &str) -> i64 {
            self.unlink_at(AT_FDCWD, raw, 0)
        }

        /// unlink, or rmdir with AT_REMOVEDIR.
        pub fn unlink_at(&mut self, dirfd: i64, raw: &str, flags: u64) -> i64 {
            let path = match self.walk(dirfd, raw) {
                Ok(p) => p,
                Err(e) => return e,
            };
            if flags & AT_REMOVEDIR != 0 {
                if path == "/" {
                    return EBUSY;
                }
                if self.tree.contains_key(&path) {
                    return ENOTDIR;
                }
                if !self.dirs.contains(&path) {
                    return ENOENT;
                }
                let prefix = format!("{path}/");
                if self.tree.keys().chain(self.dirs.iter()).any(|k| k.starts_with(&prefix)) {
                    return ENOTEMPTY;
                }
                self.dirs.remove(&path);
                return 0;
            }
            match self.tree.remove(&path) {
                // Descriptors already open keep the contents, as on Linux.
                Some(n) => {
                    self.total -= lk(&n).len();
                    0
                }
                None => {
                    if self.dirs.contains(&path) { EISDIR } else { ENOENT }
                }
            }
        }

        /// ".", "..", then the directory's entries by name: (name, is a directory).
        fn entries(&self, path: &str) -> Vec<(String, bool)> {
            if !self.dirs.contains(path) {
                return Vec::new(); // removed while open: Linux lists nothing
            }
            let prefix = if path == "/" { "/".to_string() } else { format!("{path}/") };
            let direct = |k: &String| k.len() > prefix.len() && k.starts_with(&prefix) && !k[prefix.len()..].contains('/');
            let mut out: Vec<(String, bool)> = self.tree.keys().filter(|k| direct(k)).map(|k| (k[prefix.len()..].to_string(), false)).collect();
            out.extend(self.dirs.iter().filter(|k| direct(k)).map(|k| (k[prefix.len()..].to_string(), true)));
            out.sort();
            let mut all = vec![(".".to_string(), true), ("..".to_string(), true)];
            all.extend(out);
            all
        }

        /// getdents64: as many struct linux_dirent64 records as fit in `max` bytes.
        pub fn getdents(&mut self, fd: i64, max: usize) -> Result<Vec<u8>, i64> {
            let desc = self.desc(fd).ok_or(EBADF)?;
            let mut g = lk(&desc);
            let Desc::Dir { path, pos } = &mut *g else { return Err(ENOTDIR) };
            let list = self.entries(path);
            let mut out = Vec::new();
            while *pos < list.len() {
                let (name, dir) = &list[*pos];
                let reclen = (19 + name.len() + 1 + 7) & !7;
                if out.len() + reclen > max {
                    if out.is_empty() {
                        return Err(EINVAL);
                    }
                    break;
                }
                let mut rec = vec![0u8; reclen];
                rec[0..8].copy_from_slice(&(*pos as u64 + 1000).to_le_bytes()); // d_ino: stable per position, never 0
                rec[8..16].copy_from_slice(&(*pos as i64 + 1).to_le_bytes()); // d_off: where the next call resumes
                rec[16..18].copy_from_slice(&(reclen as u16).to_le_bytes());
                rec[18] = if *dir { 4 } else { 8 }; // DT_DIR, DT_REG
                rec[19..19 + name.len()].copy_from_slice(name.as_bytes());
                out.extend(rec);
                *pos += 1;
            }
            Ok(out)
        }

        pub fn dup(&mut self, fd: i64, min: i64, cloexec: bool) -> i64 {
            let Some(desc) = self.desc(fd) else { return EBADF };
            if !(0..FD_LIMIT).contains(&min) {
                return EINVAL;
            }
            self.install(desc, cloexec, min)
        }

        pub fn dup3(&mut self, old: i64, new: i64, flags: u64) -> i64 {
            if flags & !O_CLOEXEC != 0 {
                return EINVAL;
            }
            let Some(desc) = self.desc(old) else { return EBADF };
            if old == new {
                return EINVAL;
            }
            if !(0..FD_LIMIT).contains(&new) {
                return EBADF;
            }
            if !self.fds.contains_key(&new) && self.fds.len() >= MAX_OPEN + 3 {
                return EMFILE;
            }
            self.fds.insert(new, Slot { desc, cloexec: flags & O_CLOEXEC != 0 });
            new
        }

        pub fn dup2(&mut self, old: i64, new: i64) -> i64 {
            if old == new {
                return if self.fds.contains_key(&old) { new } else { EBADF };
            }
            self.dup3(old, new, 0)
        }

        pub fn fcntl(&mut self, fd: i64, cmd: u64, arg: u64) -> i64 {
            if !self.fds.contains_key(&fd) {
                return EBADF;
            }
            if cmd == 0 || cmd == 1030 {
                // F_DUPFD, F_DUPFD_CLOEXEC
                return if (0..FD_LIMIT).contains(&(arg as i64)) { self.dup(fd, arg as i64, cmd == 1030) } else { EINVAL };
            }
            let Some(slot) = self.fds.get_mut(&fd) else { return EBADF };
            match cmd {
                1 => slot.cloexec as i64, // F_GETFD
                2 => {
                    slot.cloexec = arg & 1 != 0; // F_SETFD
                    0
                }
                3 => match &*lk(&slot.desc) {
                    // F_GETFL
                    Desc::File { read, write, append, .. } => {
                        (if *read && *write { O_RDWR } else if *write { O_WRONLY } else { 0 } | if *append { O_APPEND } else { 0 }) as i64
                    }
                    Desc::Pipe { write, .. } => if *write { O_WRONLY as i64 } else { 0 },
                    Desc::Dir { .. } => 0,
                    Desc::Stream(_) => O_RDWR as i64,
                },
                4 => {
                    // F_SETFL: only O_APPEND is honoured (O_NONBLOCK changes nothing here)
                    if let Desc::File { append, .. } = &mut *lk(&slot.desc) {
                        *append = arg & O_APPEND != 0;
                    }
                    0
                }
                _ => EINVAL,
            }
        }

        /// pipe2: (read end, write end), or an errno.
        pub fn pipe(&mut self, flags: u64) -> Result<(i64, i64), i64> {
            if flags & !(O_CLOEXEC | 0x800) != 0 {
                return Err(EINVAL); // O_NONBLOCK is accepted: nothing here blocks
            }
            if self.fds.len() + 2 > MAX_OPEN + 3 {
                return Err(EMFILE);
            }
            let pipe: PipeRef = Arc::new(Mutex::new(VecDeque::new()));
            let cloexec = flags & O_CLOEXEC != 0;
            let r = self.install(Arc::new(Mutex::new(Desc::Pipe { pipe: pipe.clone(), write: false })), cloexec, 0);
            let w = self.install(Arc::new(Mutex::new(Desc::Pipe { pipe, write: true })), cloexec, 0);
            Ok((r, w))
        }

        /// The tree as it stands, path -> contents. Directories appear as "path/" with no contents.
        pub fn snapshot(&self) -> BTreeMap<String, Vec<u8>> {
            let mut out: BTreeMap<String, Vec<u8>> = self.tree.iter().map(|(k, n)| (k.clone(), lk(n).clone())).collect();
            for d in self.dirs.iter().filter(|d| *d != "/") {
                out.insert(format!("{d}/"), Vec::new());
            }
            out
        }
    }
}

// ---------- the shim ----------

/// A descriptor argument: the low 32 bits, signed, as the kernel reads an int.
fn fd(v: u64) -> i64 {
    v as u32 as i32 as i64
}

pub struct Shim {
    pub arch: Arch,
    pub counts: BTreeMap<String, u32>,
    pub unsupported: BTreeSet<String>,
    pub exit_code: Option<i32>,
    brk_base: u64,
    brk: u64,
    mmap_top: u64,
    seed: u64,
    pub files: files::GuestFiles,
}

pub enum Flow {
    Continue,
    Exit,
}

impl Shim {
    pub fn new(arch: Arch, brk_base: u64, mmap_top: u64, stdin: Vec<u8>, tree: BTreeMap<String, Vec<u8>>) -> Shim {
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9e37_79b9_7f4a_7c15);
        Shim {
            arch,
            counts: BTreeMap::new(),
            unsupported: BTreeSet::new(),
            exit_code: None,
            brk_base,
            brk: brk_base,
            mmap_top,
            seed,
            files: files::GuestFiles::new(tree, stdin),
        }
    }

    /// A NUL-terminated path from guest memory.
    fn path(mem: &[u8], addr: u64) -> Result<String, i64> {
        let mut bytes = Vec::new();
        for i in 0..4096u64 {
            let r = range(mem, addr.wrapping_add(i), 1).ok_or(EFAULT)?;
            let b = mem[r.start];
            if b == 0 {
                return Ok(String::from_utf8_lossy(&bytes).into_owned());
            }
            bytes.push(b);
        }
        Err(ENAMETOOLONG)
    }

    /// A path argument: empty paths do not name anything.
    fn path_arg(mem: &[u8], addr: u64) -> Result<String, i64> {
        let p = Self::path(mem, addr)?;
        if p.is_empty() { Err(ENOENT) } else { Ok(p) }
    }

    /// O_DIRECTORY is 0x4000 on AArch64 (where 0x10000 is O_DIRECT); GuestFiles takes the x86-64 bits.
    fn open_flags(&self, flags: u64) -> u64 {
        let mut f = flags & 0xffff_ffff;
        if self.arch == Arch::Aarch64 {
            let dir = f & 0x4000 != 0;
            f &= !(0x4000 | 0x10000);
            if dir {
                f |= files::O_DIRECTORY;
            }
        }
        f
    }

    /// Copies bytes the shim produced into guest memory and returns their count.
    fn give(mem: &mut [u8], addr: u64, got: Result<Vec<u8>, i64>) -> i64 {
        match got {
            Err(e) => e,
            Ok(data) if data.is_empty() => 0,
            Ok(data) => match range(mem, addr, data.len() as u64) {
                Some(r) => {
                    mem[r].copy_from_slice(&data);
                    data.len() as i64
                }
                None => EFAULT,
            },
        }
    }

    /// struct stat for this architecture (x86-64, or the generic layout AArch64 uses).
    fn stat(&self, mem: &mut [u8], buf: u64, st: Result<files::Stat, i64>) -> i64 {
        let st = match st {
            Ok(s) => s,
            Err(e) => return e,
        };
        let mut out = vec![0u8; if self.arch == Arch::X86_64 { 144 } else { 128 }];
        let mode: u32 = match st.kind {
            files::Kind::Dir => 0o40755,
            files::Kind::Fifo => 0o10600,
            files::Kind::File => 0o100644,
        };
        out[8..16].copy_from_slice(&(st.size as u64 + 2).to_le_bytes()); // st_ino
        if self.arch == Arch::X86_64 {
            out[16..24].copy_from_slice(&1u64.to_le_bytes()); // st_nlink
            out[24..28].copy_from_slice(&mode.to_le_bytes());
            out[56..64].copy_from_slice(&4096i64.to_le_bytes()); // st_blksize
        } else {
            out[16..20].copy_from_slice(&mode.to_le_bytes());
            out[20..24].copy_from_slice(&1u32.to_le_bytes()); // st_nlink
            out[56..60].copy_from_slice(&4096i32.to_le_bytes()); // st_blksize
        }
        out[48..56].copy_from_slice(&(st.size as i64).to_le_bytes()); // st_size: same offset on both
        out[64..72].copy_from_slice(&(st.size.div_ceil(512) as i64).to_le_bytes()); // st_blocks
        match range(mem, buf, out.len() as u64) {
            Some(r) => {
                mem[r].copy_from_slice(&out);
                0
            }
            None => EFAULT,
        }
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
                        self.files.write(fd(a[0]), &data)
                    }
                    None => EFAULT,
                }
            }
            "writev" => {
                let mut total = 0i64;
                let mut ret = 0i64;
                for i in 0..a[2].min(1024) {
                    let Some(r) = range(mem, a[1] + i * 16, 16) else { ret = if total > 0 { total } else { EFAULT }; break };
                    let base = rd64(mem, r.start);
                    let len = rd64(mem, r.start + 8) & 0x7fff_ffff;
                    let Some(d) = range(mem, base, len) else { ret = if total > 0 { total } else { EFAULT }; break };
                    let data = mem[d].to_vec();
                    let n = self.files.write(fd(a[0]), &data);
                    if n < 0 {
                        ret = if total > 0 { total } else { n };
                        break;
                    }
                    total += n;
                    ret = total;
                    if (n as u64) < len {
                        break;
                    }
                }
                ret
            }
            "read" => {
                let got = self.files.read(fd(a[0]), a[2].min(0x7fff_ffff) as usize);
                Self::give(mem, a[1], got)
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
            "munmap" | "mprotect" | "madvise" | "rt_sigaction" | "rt_sigprocmask" | "set_robust_list" => 0,
            "close" => self.files.close(fd(a[0])),
            "openat" | "open" => {
                let (dirfd, at, flags) = if name == "open" { (files::AT_FDCWD, a[0], a[1]) } else { (fd(a[0]), a[1], a[2]) };
                let flags = self.open_flags(flags);
                match Self::path_arg(mem, at) {
                    Ok(p) => self.files.open_at(dirfd, &p, flags),
                    Err(e) => e,
                }
            }
            "lseek" => self.files.lseek(fd(a[0]), a[1] as i64, a[2] & 0xffff_ffff),
            "fstat" => {
                let st = self.files.stat_fd(fd(a[0]));
                self.stat(mem, a[1], st)
            }
            "newfstatat" => match Self::path(mem, a[1]) {
                Err(e) => e,
                // fstat(fd) arrives as newfstatat(fd, "", buf, AT_EMPTY_PATH).
                Ok(p) if p.is_empty() => {
                    if a[3] & 0x1000 != 0 {
                        let st = self.files.stat_fd(fd(a[0]));
                        self.stat(mem, a[2], st)
                    } else {
                        ENOENT
                    }
                }
                Ok(p) => {
                    let st = self.files.stat_at(fd(a[0]), &p);
                    self.stat(mem, a[2], st)
                }
            },
            "access" | "faccessat" => {
                let (dirfd, at) = if name == "access" { (files::AT_FDCWD, a[0]) } else { (fd(a[0]), a[1]) };
                match Self::path_arg(mem, at).and_then(|p| self.files.stat_at(dirfd, &p)) {
                    Ok(_) => 0,
                    Err(e) => e,
                }
            }
            "unlink" | "rmdir" | "unlinkat" => {
                let (dirfd, at, flags) = match name.as_str() {
                    "unlinkat" => (fd(a[0]), a[1], a[2]),
                    "rmdir" => (files::AT_FDCWD, a[0], files::AT_REMOVEDIR),
                    _ => (files::AT_FDCWD, a[0], 0),
                };
                if flags & !files::AT_REMOVEDIR != 0 {
                    EINVAL
                } else {
                    match Self::path_arg(mem, at) {
                        Ok(p) => self.files.unlink_at(dirfd, &p, flags),
                        Err(e) => e,
                    }
                }
            }
            "mkdir" | "mkdirat" => {
                let (dirfd, at) = if name == "mkdir" { (files::AT_FDCWD, a[0]) } else { (fd(a[0]), a[1]) };
                match Self::path_arg(mem, at) {
                    Ok(p) => self.files.mkdir_at(dirfd, &p),
                    Err(e) => e,
                }
            }
            "getdents64" => {
                let got = self.files.getdents(fd(a[0]), a[2].min(0x7fff_ffff) as usize);
                Self::give(mem, a[1], got)
            }
            "dup" => self.files.dup(fd(a[0]), 0, false),
            "dup2" => self.files.dup2(fd(a[0]), fd(a[1])),
            "dup3" => self.files.dup3(fd(a[0]), fd(a[1]), a[2] & 0xffff_ffff),
            "fcntl" => self.files.fcntl(fd(a[0]), a[1] & 0xffff_ffff, a[2]),
            "pipe" | "pipe2" => match self.files.pipe(if name == "pipe" { 0 } else { a[1] & 0xffff_ffff }) {
                Err(e) => e,
                Ok((r, w)) => match range(mem, a[0], 8) {
                    Some(at) => {
                        mem[at.start..at.start + 4].copy_from_slice(&(r as i32).to_le_bytes());
                        mem[at.start + 4..at.start + 8].copy_from_slice(&(w as i32).to_le_bytes());
                        0
                    }
                    None => {
                        self.files.close(r);
                        self.files.close(w);
                        EFAULT
                    }
                },
            },
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
            "readlinkat" | "readlink" => ENOENT, // no symbolic links in the tree
            "prlimit64" | "rseq" => ENOSYS, // known, deliberately not provided: libc falls back
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
        // ir.ts: STATE = { regs: 0x400, pc: 0x300, flags: 0x308, fuel: 0x320, code: 0x328, fault: 0x330, codeLo: 0x340, codeHi: 0x348 }, NREG = 106
        assert!(layout::REGS >= layout::CODE_HI + 8 && layout::REGS + layout::NREG * 8 <= layout::NULL_PAGE as usize);
        assert_eq!((layout::PC, layout::FLAGS, layout::FUEL, layout::CODE, layout::FAULT), (0x300, 0x308, 0x320, 0x328, 0x330));
        assert_eq!((layout::CODE_LO, layout::CODE_HI), (0x340, 0x348));
    }

    #[test]
    fn write_then_exit_on_both_architectures() {
        for (arch, write, exit) in [(Arch::X86_64, 1, 60), (Arch::Aarch64, 64, 93)] {
            let mut mem = vec![0u8; MEM];
            mem[0x2000..0x2005].copy_from_slice(b"hello");
            let mut vm = Script { mem, steps: vec![Box::new(syscall(arch, write, &[1, 0x2000, 5])), Box::new(syscall(arch, exit, &[7]))], at: 0 };
            let mut shim = Shim::new(arch, 0x10000, 0x80000, vec![], BTreeMap::new());
            let mut budget = 1_000;
            assert_eq!(drive(&mut vm, &mut shim, &mut budget, 1_000, 10), Event::Exit(7));
            assert_eq!(shim.files.stdout, b"hello");
            assert_eq!(shim.counts.get("write"), Some(&1));
        }
    }

    #[test]
    fn the_null_page_and_out_of_range_buffers_are_refused() {
        let mut mem = vec![0u8; MEM];
        let mut shim = Shim::new(Arch::X86_64, 0x10000, 0x80000, vec![], BTreeMap::new());
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
        assert!(shim.files.stdout.is_empty());
    }

    #[test]
    fn stdin_brk_mmap_and_tls() {
        let mut mem = vec![0u8; MEM];
        let mut shim = Shim::new(Arch::X86_64, 0x20000, 0x80000, b"abc".to_vec(), BTreeMap::new());
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
        let mut shim = Shim::new(Arch::Aarch64, 0x10000, 0x80000, vec![], BTreeMap::new());
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
        let mut shim = Shim::new(Arch::X86_64, 0x10000, 0x80000, vec![], BTreeMap::new());
        let mut budget = 250;
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::Yield);
        assert_eq!(budget, 150);
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::Yield);
        assert_eq!(drive(&mut vm, &mut shim, &mut budget, 100, 10), Event::Stopped { code: stop::FUEL, pc: 0, fault: 0 });
    }
    #[test]
    fn files_open_read_write_seek_stat_unlink_on_both_architectures() {
        // Same calls as fixtures/linux/files.c, with the numbers each architecture uses.
        for (arch, openat, read, write, close, lseek, fstat, unlinkat) in
            [(Arch::X86_64, 257, 0, 1, 3, 8, 5, 263), (Arch::Aarch64, 56, 63, 64, 57, 62, 80, 35)]
        {
            let mut tree = BTreeMap::new();
            tree.insert("in.txt".to_string(), b"abcdef".to_vec());
            let mut shim = Shim::new(arch, 0x40000, 0x80000, vec![], tree);
            let mut mem = vec![0u8; MEM];
            mem[0x2000..0x2007].copy_from_slice(b"in.txt\0");
            mem[0x2100..0x2108].copy_from_slice(b"out.txt\0");
            mem[0x2200..0x2203].copy_from_slice(b"xyz");
            mem[0x2300..0x2306].copy_from_slice(b"../..\0");
            let call = |shim: &mut Shim, mem: &mut Vec<u8>, nr: u64, args: &[u64]| {
                set_reg(mem, arch.nr_reg(), nr);
                for (i, v) in args.iter().enumerate() {
                    set_reg(mem, arch.arg_regs()[i], *v);
                }
                shim.handle(mem);
                reg(mem, arch.ret_reg()) as i64
            };
            let cwd = -100i64 as u64;
            let fd = call(&mut shim, &mut mem, openat, &[cwd, 0x2000, 0, 0]) as u64;
            assert_eq!(fd, 3);
            assert_eq!(call(&mut shim, &mut mem, read, &[fd, 0x3000, 4]), 4);
            assert_eq!(&mem[0x3000..0x3004], b"abcd");
            assert_eq!(call(&mut shim, &mut mem, write, &[fd, 0x2200, 3]), EBADF, "read-only");
            assert_eq!(call(&mut shim, &mut mem, fstat, &[fd, 0x4000]), 0);
            assert_eq!(rd64(&mem, 0x4000 + 48), 6, "st_size at byte 48 on both");
            let out = call(&mut shim, &mut mem, openat, &[cwd, 0x2100, (files::O_RDWR | files::O_CREAT) as u64, 0o644]) as u64;
            assert_eq!(out, 4);
            assert_eq!(call(&mut shim, &mut mem, lseek, &[out, 4, 0]), 4);
            assert_eq!(call(&mut shim, &mut mem, write, &[out, 0x2200, 3]), 3);
            assert_eq!(call(&mut shim, &mut mem, lseek, &[out, (-100i64) as u64, 1]), EINVAL);
            assert_eq!(call(&mut shim, &mut mem, openat, &[cwd, 0x2100, (files::O_WRONLY | files::O_CREAT | files::O_EXCL) as u64, 0]), EEXIST);
            assert_eq!(call(&mut shim, &mut mem, openat, &[cwd, 0x2300, files::O_WRONLY, 0]), EISDIR, ".. stays at the root");
            assert_eq!(call(&mut shim, &mut mem, openat, &[7, 0x2000, 0, 0]), EBADF, "7 is not open");
            assert_eq!(call(&mut shim, &mut mem, close, &[fd]), 0);
            assert_eq!(call(&mut shim, &mut mem, close, &[fd]), EBADF);
            assert_eq!(call(&mut shim, &mut mem, unlinkat, &[cwd, 0x2000, 0]), 0);
            assert_eq!(call(&mut shim, &mut mem, openat, &[cwd, 0x2000, 0, 0]), ENOENT);
            let snap = shim.files.snapshot();
            assert_eq!(snap.keys().collect::<Vec<_>>(), vec!["/out.txt"]);
            assert_eq!(snap["/out.txt"], b"\0\0\0\0xyz", "a hole before the write reads as zeros");
            assert!(shim.unsupported.is_empty());
        }
    }

    #[test]
    fn directories_dup_and_pipes_on_both_architectures() {
        // The numbers fixtures/linux/dirs.c uses on each architecture.
        for (arch, openat, read, write, close, mkdirat, getdents64, dup, dup3, pipe2, o_directory) in
            [(Arch::X86_64, 257, 0, 1, 3, 258, 217, 32, 292, 293, 0x10000), (Arch::Aarch64, 56, 63, 64, 57, 34, 61, 23, 24, 59, 0x4000)]
        {
            let mut shim = Shim::new(arch, 0x40000, 0x80000, vec![], BTreeMap::new());
            let mut mem = vec![0u8; MEM];
            mem[0x2000..0x2002].copy_from_slice(b"d\0");
            mem[0x2100..0x2106].copy_from_slice(b"f.txt\0");
            mem[0x2200..0x2204].copy_from_slice(b"ping");
            let call = |shim: &mut Shim, mem: &mut Vec<u8>, nr: u64, args: &[u64]| {
                set_reg(mem, arch.nr_reg(), nr);
                for (i, v) in args.iter().enumerate() {
                    set_reg(mem, arch.arg_regs()[i], *v);
                }
                shim.handle(mem);
                reg(mem, arch.ret_reg()) as i64
            };
            let cwd = -100i64 as u64;
            assert_eq!(call(&mut shim, &mut mem, mkdirat, &[cwd, 0x2000, 0o755]), 0);
            let d = call(&mut shim, &mut mem, openat, &[cwd, 0x2000, o_directory, 0]) as u64;
            assert_eq!(d, 3);
            let f = call(&mut shim, &mut mem, openat, &[d, 0x2100, files::O_WRONLY | files::O_CREAT, 0o644]) as u64;
            assert_eq!(f, 4, "created relative to the directory descriptor");
            assert_eq!(call(&mut shim, &mut mem, dup3, &[f, 1, 0]), 1, "stdout now goes to d/f.txt");
            assert_eq!(call(&mut shim, &mut mem, write, &[1, 0x2200, 4]), 4);
            assert!(shim.files.stdout.is_empty());
            let n = call(&mut shim, &mut mem, getdents64, &[d, 0x3000, 4096]) as usize;
            let mut names = Vec::new();
            let mut at = 0x3000;
            while at < 0x3000 + n {
                let reclen = u16::from_le_bytes([mem[at + 16], mem[at + 17]]) as usize;
                let name: Vec<u8> = mem[at + 19..].iter().take_while(|b| **b != 0).copied().collect();
                names.push((String::from_utf8(name).unwrap(), mem[at + 18]));
                at += reclen;
            }
            assert_eq!(names, vec![(".".into(), 4), ("..".into(), 4), ("f.txt".into(), 8)]);
            assert_eq!(call(&mut shim, &mut mem, pipe2, &[0x4000, 0]), 0);
            let (r, w) = (rd64(&mem, 0x4000) & 0xffff_ffff, rd64(&mem, 0x4000) >> 32);
            assert_eq!((r, w), (5, 6));
            let w2 = call(&mut shim, &mut mem, dup, &[w]) as u64;
            assert_eq!(call(&mut shim, &mut mem, write, &[w2, 0x2200, 4]), 4);
            assert_eq!(call(&mut shim, &mut mem, close, &[w]), 0);
            assert_eq!(call(&mut shim, &mut mem, read, &[r, 0x5000, 2]), 2);
            assert_eq!(call(&mut shim, &mut mem, close, &[w2]), 0);
            assert_eq!(call(&mut shim, &mut mem, read, &[r, 0x5000, 10]), 2, "the rest, then end of file");
            assert_eq!(call(&mut shim, &mut mem, read, &[r, 0x5000, 10]), 0);
            assert_eq!(&mem[0x5000..0x5002], b"ng");
            let snap = shim.files.snapshot();
            assert_eq!(snap.keys().collect::<Vec<_>>(), vec!["/d/", "/d/f.txt"]);
            assert_eq!(snap["/d/f.txt"], b"ping");
            assert!(shim.unsupported.is_empty());
        }
    }
}
