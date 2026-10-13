//! Test bridge: the desktop host's guest runner (native_guest::GuestSessions, the code behind the
//! guest_* Tauri commands) driven over stdin/stdout, one JSON request per line. It lets
//! scripts/native-guest.test.ts run the page's own protocol code (runLinuxHosted) against real
//! wasmtime without opening a window.
//!
//! Request:  {"cmd": "guest_start", "args": {...same camelCase args as invoke()...}}
//! Response: {"ok": value} or {"err": "message"}

use forge_lib::native_guest::GuestSessions;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

fn field<T: serde::de::DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("{key}: {e}"))
}

fn handle(sessions: &GuestSessions, cmd: &str, args: &Value) -> Result<Value, String> {
    match cmd {
        "guest_start" => {
            let module: Vec<u8> = field(args, "module")?;
            let id = sessions.start(
                &module,
                &field::<String>(args, "arch")?,
                field(args, "chunks")?,
                field(args, "brkBase")?,
                field(args, "mmapTop")?,
                field(args, "stdin")?,
                field(args, "fuel")?,
                field::<Option<_>>(args, "files")?.unwrap_or_default(),
            )?;
            Ok(json!(id))
        }
        "guest_resume" => {
            let r = sessions.resume(field(args, "id")?, field(args, "maxEvents")?)?;
            serde_json::to_value(r).map_err(|e| e.to_string())
        }
        "guest_swap" => {
            let module: Vec<u8> = match args.get("raw").and_then(Value::as_str) {
                // Stands in for Tauri's raw-bytes body: hex here, since this bridge speaks JSON lines.
                Some(hex) => (0..hex.len() / 2)
                    .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).map_err(|e| e.to_string()))
                    .collect::<Result<_, _>>()?,
                None => field(args, "module")?,
            };
            sessions.swap(field(args, "id")?, &module)?;
            Ok(Value::Null)
        }
        "guest_end" => {
            sessions.end(field(args, "id")?);
            Ok(Value::Null)
        }
        other => Err(format!("unknown command {other}")),
    }
}

fn main() {
    let sessions = GuestSessions::default();
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(req) => {
                let cmd = req.get("cmd").and_then(Value::as_str).unwrap_or("");
                match handle(&sessions, cmd, req.get("args").unwrap_or(&Value::Null)) {
                    Ok(v) => json!({ "ok": v }),
                    Err(e) => json!({ "err": e }),
                }
            }
            Err(e) => json!({ "err": format!("bad request: {e}") }),
        };
        if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}
