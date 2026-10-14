//! Where the desktop app keeps downloaded model weights, so they survive a restart.
//!
//! The page's model runtime (wllama) normally keeps weights in the browser's Origin Private File
//! System. The Linux desktop WebView has none, so src/engine/model-cache.ts hands the files to this
//! store instead, through the model_store_* commands in lib.rs. Files live in one directory (the
//! app's data directory + "models"). A write goes to "<name>.part" in pieces and becomes visible
//! only when committed, so a download cut short never looks like a complete file.
//!
//! Std only, unit-tested without Tauri: `rustc --edition 2021 --test src/model_store.rs`.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// The largest single file accepted (the biggest models Forge offers are a few GB).
pub const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024 * 1024;
/// The most a single read hands back.
pub const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// A cache key as a file name: letters, digits and '-' stay; every other byte becomes "_xx".
/// The result never contains a path separator or a '.', so it cannot leave the directory and
/// never looks like the ".part" file of another key.
pub fn file_name(key: &str) -> Result<String, String> {
    if key.is_empty() || key.len() > 512 {
        return Err("bad model file name".into());
    }
    let mut out = String::new();
    for b in key.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' {
            out.push(b as char);
        } else {
            out.push_str(&format!("_{b:02x}"));
        }
    }
    Ok(out)
}

/// The key a file name came from (the inverse of `file_name`).
pub fn key_of(name: &str) -> Option<String> {
    let bytes = name.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'_' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub struct ModelStore {
    dir: PathBuf,
}

impl ModelStore {
    pub fn new(dir: impl Into<PathBuf>) -> ModelStore {
        ModelStore { dir: dir.into() }
    }

    fn path(&self, key: &str) -> Result<PathBuf, String> {
        Ok(self.dir.join(file_name(key)?))
    }

    fn part(&self, key: &str) -> Result<PathBuf, String> {
        Ok(self.dir.join(format!("{}.part", file_name(key)?)))
    }

    /// Committed files: (key, size).
    pub fn list(&self) -> Result<Vec<(String, u64)>, String> {
        let mut out = Vec::new();
        let entries = match fs::read_dir(&self.dir) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(e.to_string()),
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.ends_with(".part") {
                continue;
            }
            let Some(key) = key_of(&name) else { continue };
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    out.push((key, meta.len()));
                }
            }
        }
        out.sort();
        Ok(out)
    }

    /// Size of a committed file, or -1.
    pub fn size(&self, key: &str) -> Result<i64, String> {
        match fs::metadata(self.path(key)?) {
            Ok(m) if m.is_file() => Ok(m.len() as i64),
            _ => Ok(-1),
        }
    }

    /// Up to `len` bytes of a committed file from `offset`; empty at or past the end.
    pub fn read(&self, key: &str, offset: u64, len: u64) -> Result<Vec<u8>, String> {
        let mut f = File::open(self.path(key)?).map_err(|e| e.to_string())?;
        let size = f.metadata().map_err(|e| e.to_string())?.len();
        let n = len.min(MAX_READ_BYTES).min(size.saturating_sub(offset));
        let mut out = vec![0u8; n as usize];
        f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        f.read_exact(&mut out).map_err(|e| e.to_string())?;
        Ok(out)
    }

    /// Add `data` at `offset` of the file being written. Offset 0 starts the file over; any other
    /// offset must be where the previous piece ended.
    pub fn write(&self, key: &str, offset: u64, data: &[u8]) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let part = self.part(key)?;
        if offset.saturating_add(data.len() as u64) > MAX_FILE_BYTES {
            return Err("model file is too large".into());
        }
        let mut f = if offset == 0 {
            File::create(&part).map_err(|e| e.to_string())?
        } else {
            let f = OpenOptions::new().append(true).open(&part).map_err(|e| e.to_string())?;
            let have = f.metadata().map_err(|e| e.to_string())?.len();
            if have != offset {
                return Err(format!("write at {offset}, but {have} bytes are written so far"));
            }
            f
        };
        f.write_all(data).map_err(|e| e.to_string())
    }

    /// Make the written file visible under its key (replacing an older copy).
    pub fn commit(&self, key: &str) -> Result<(), String> {
        let part = self.part(key)?;
        if !Path::new(&part).is_file() {
            return Err("nothing was written for this model file".into());
        }
        fs::rename(&part, self.path(key)?).map_err(|e| e.to_string())
    }

    /// Remove a file (and any unfinished write of it).
    pub fn delete(&self, key: &str) -> Result<(), String> {
        for p in [self.path(key)?, self.part(key)?] {
            match fs::remove_file(&p) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> ModelStore {
        let dir = std::env::temp_dir().join(format!("forge-model-store-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = fs::remove_dir_all(&dir);
        ModelStore::new(dir)
    }

    #[test]
    fn names_never_leave_the_directory_and_round_trip() {
        for key in ["model.gguf", "../../etc/passwd", "a/b\\c", ".hidden", "hf_x--y.gguf", "ünï", "m.part"] {
            let name = file_name(key).unwrap();
            assert!(!name.contains('/') && !name.contains('\\') && !name.contains('.'), "{key} -> {name}");
            assert_eq!(key_of(&name).as_deref(), Some(key));
        }
        assert!(file_name("").is_err());
    }

    #[test]
    fn written_in_pieces_visible_only_after_commit() {
        let s = temp();
        assert_eq!(s.list().unwrap(), vec![]);
        s.write("m.gguf", 0, b"hello ").unwrap();
        s.write("m.gguf", 6, b"world").unwrap();
        assert!(s.write("m.gguf", 3, b"x").is_err(), "pieces must follow on");
        assert_eq!(s.size("m.gguf").unwrap(), -1, "not committed yet");
        assert_eq!(s.list().unwrap(), vec![]);
        s.commit("m.gguf").unwrap();
        assert_eq!(s.size("m.gguf").unwrap(), 11);
        assert_eq!(s.list().unwrap(), vec![("m.gguf".to_string(), 11)]);
        assert_eq!(s.read("m.gguf", 6, 100).unwrap(), b"world");
        assert_eq!(s.read("m.gguf", 20, 5).unwrap(), b"");
        // Starting over replaces the old copy only on commit.
        s.write("m.gguf", 0, b"new").unwrap();
        assert_eq!(s.read("m.gguf", 0, 100).unwrap(), b"hello world");
        s.commit("m.gguf").unwrap();
        assert_eq!(s.read("m.gguf", 0, 100).unwrap(), b"new");
        s.delete("m.gguf").unwrap();
        s.delete("m.gguf").unwrap();
        assert_eq!(s.size("m.gguf").unwrap(), -1);
        assert!(s.commit("m.gguf").is_err());
        let _ = fs::remove_dir_all(&s.dir);
    }
}
