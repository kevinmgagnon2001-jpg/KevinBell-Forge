//! The applications installed on this computer, for the screen in Forge's world (Devices.tsx's
//! sibling, DeviceScreen.tsx). Pick one there and Forge opens it and steps aside; open Forge again
//! to carry on where you were.
//!
//! Only apps this module found itself can be opened: the page passes an id from `list()`, and
//! `open()` looks it up again in a fresh list, so the page can never start an arbitrary program.
//!
//!   Linux    .desktop entries (XDG data dirs, Flatpak and Snap exports), started from their Exec line
//!   macOS    .app bundles in /Applications, /System/Applications and ~/Applications, via `open`
//!   Windows  Start menu shortcuts (.lnk), via Explorer
//!
//! No dependencies beyond std, so `rustc --edition 2021 --test src-tauri/src/apps.rs` tests it alone.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// (id, name). The id is the path of the entry, bundle or shortcut.
pub type App = (String, String);

const MAX_APPS: usize = 600;

/// The apps on this machine, sorted by name, one per name.
pub fn list() -> Vec<App> {
    let mut apps = platform_list();
    apps.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()).then(a.0.cmp(&b.0)));
    apps.dedup_by(|a, b| a.1.eq_ignore_ascii_case(&b.1));
    apps.truncate(MAX_APPS);
    apps
}

/// Open the app with this id, if it is one `list()` reports.
pub fn open(id: &str) -> Result<(), String> {
    if !platform_list().iter().any(|(known, _)| known == id) {
        return Err("that is not an app installed on this computer".into());
    }
    launch(Path::new(id))
}

fn walk(dir: &Path, depth: u32, ext: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let matches = path.extension().map(|e| e.eq_ignore_ascii_case(ext)).unwrap_or(false);
        if matches {
            out.push(path);
        } else if is_dir && depth > 0 {
            walk(&path, depth - 1, ext, out);
        }
    }
}

#[allow(dead_code)] // used on macOS and Windows
fn stem(path: &Path) -> String {
    path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

fn detached(mut command: Command) -> Result<(), String> {
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    command.spawn().map(|_| ()).map_err(|e| format!("could not start it: {e}"))
}

// ---------- Linux (and other XDG desktops) ----------

/// The parts of a .desktop file Forge needs.
#[derive(Debug, PartialEq)]
pub struct DesktopEntry {
    pub name: String,
    pub exec: String,
}

/// Read the [Desktop Entry] group. None for anything not meant to be shown as an app.
pub fn parse_desktop(text: &str) -> Option<DesktopEntry> {
    let mut in_entry = false;
    let (mut name, mut exec, mut kind) = (None, None, None);
    let (mut hidden, mut terminal) = (false, false);
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let (key, value) = (key.trim(), value.trim());
        match key {
            "Name" if name.is_none() => name = Some(value.to_string()),
            "Exec" if exec.is_none() => exec = Some(value.to_string()),
            "Type" => kind = Some(value.to_string()),
            "NoDisplay" | "Hidden" if value.eq_ignore_ascii_case("true") => hidden = true,
            "Terminal" if value.eq_ignore_ascii_case("true") => terminal = true,
            _ => {}
        }
    }
    let (name, exec) = (name?, exec?);
    if kind.as_deref() != Some("Application") || hidden || terminal || name.is_empty() || exec.is_empty() {
        return None;
    }
    Some(DesktopEntry { name, exec })
}

/// An Exec line as arguments: quotes and escapes undone, field codes (%f, %U, ...) dropped, %c the
/// app's name, %k the entry's path, %% a percent sign.
pub fn exec_args(exec: &str, name: &str, path: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut started = false;
    let mut quoted = false;
    let mut chars = exec.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            '\\' if quoted => {
                if let Some(next) = chars.next() {
                    word.push(next);
                }
            }
            c if c.is_whitespace() && !quoted => {
                if started || !word.is_empty() {
                    words.push(std::mem::take(&mut word));
                }
                started = false;
            }
            c => {
                word.push(c);
                started = true;
            }
        }
    }
    if started || !word.is_empty() {
        words.push(word);
    }
    let mut out = Vec::new();
    for w in words {
        match w.as_str() {
            "%f" | "%F" | "%u" | "%U" | "%d" | "%D" | "%n" | "%N" | "%v" | "%m" | "%i" => continue,
            "%c" => out.push(name.to_string()),
            "%k" => out.push(path.to_string()),
            _ => out.push(w.replace("%%", "%")),
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn xdg_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut roots: Vec<PathBuf> = Vec::new();
    match std::env::var_os("XDG_DATA_HOME") {
        Some(dir) if !dir.is_empty() => roots.push(PathBuf::from(dir)),
        _ => roots.extend(home.iter().map(|h| h.join(".local/share"))),
    }
    let shared = std::env::var("XDG_DATA_DIRS").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    roots.extend(shared.split(':').filter(|s| !s.is_empty()).map(PathBuf::from));
    roots.push(PathBuf::from("/var/lib/flatpak/exports/share"));
    roots.extend(home.iter().map(|h| h.join(".local/share/flatpak/exports/share")));
    let mut dirs: Vec<PathBuf> = roots.into_iter().map(|r| r.join("applications")).collect();
    dirs.push(PathBuf::from("/var/lib/snapd/desktop/applications"));
    dirs
}

#[cfg(target_os = "linux")]
fn platform_list() -> Vec<App> {
    let mut files = Vec::new();
    for dir in xdg_dirs() {
        walk(&dir, 2, "desktop", &mut files);
    }
    files
        .into_iter()
        .filter_map(|path| {
            let entry = parse_desktop(&std::fs::read_to_string(&path).ok()?)?;
            Some((path.to_string_lossy().into_owned(), entry.name))
        })
        .collect()
}

#[cfg(target_os = "linux")]
fn launch(path: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let entry = parse_desktop(&text).ok_or("that app cannot be opened from here")?;
    let args = exec_args(&entry.exec, &entry.name, &path.to_string_lossy());
    let (program, rest) = args.split_first().ok_or("that app has no command")?;
    let mut command = Command::new(program);
    command.args(rest);
    detached(command)
}

// ---------- macOS ----------

#[cfg(target_os = "macos")]
fn platform_list() -> Vec<App> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/Applications/Utilities"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    let mut bundles = Vec::new();
    for dir in dirs {
        // Bundles are directories ending in .app; do not look inside them.
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "app").unwrap_or(false) {
                bundles.push(path);
            }
        }
    }
    bundles.into_iter().map(|p| (p.to_string_lossy().into_owned(), stem(&p))).collect()
}

#[cfg(target_os = "macos")]
fn launch(path: &Path) -> Result<(), String> {
    let mut command = Command::new("open");
    command.arg(path);
    detached(command)
}

// ---------- Windows ----------

#[cfg(target_os = "windows")]
fn platform_list() -> Vec<App> {
    let mut files = Vec::new();
    for var in ["ProgramData", "APPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            walk(&PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs"), 3, "lnk", &mut files);
        }
    }
    files
        .into_iter()
        .map(|p| (p.to_string_lossy().into_owned(), stem(&p)))
        .filter(|(_, name)| !name.to_lowercase().contains("uninstall"))
        .collect()
}

#[cfg(target_os = "windows")]
fn launch(path: &Path) -> Result<(), String> {
    let mut command = Command::new("explorer");
    command.arg(path);
    detached(command)
}

// ---------- anything else (phones list their apps from the Android side) ----------

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn platform_list() -> Vec<App> {
    Vec::new()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn launch(_path: &Path) -> Result<(), String> {
    Err("opening apps from here is not supported on this system".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_entries_are_read_and_hidden_ones_skipped() {
        let firefox = "[Desktop Entry]\nName=Firefox\nName[de]=Feuerfuchs\nExec=firefox %u\nType=Application\n\n[Desktop Action new-window]\nName=New Window\nExec=firefox --new-window %u\n";
        assert_eq!(parse_desktop(firefox), Some(DesktopEntry { name: "Firefox".into(), exec: "firefox %u".into() }));
        assert_eq!(parse_desktop("[Desktop Entry]\nName=Helper\nExec=helper\nType=Application\nNoDisplay=true\n"), None);
        assert_eq!(parse_desktop("[Desktop Entry]\nName=Top\nExec=top\nType=Application\nTerminal=true\n"), None);
        assert_eq!(parse_desktop("[Desktop Entry]\nName=Link\nURL=https://example.com\nType=Link\n"), None);
        assert_eq!(parse_desktop("[Desktop Entry]\nName=Broken\nType=Application\n"), None);
        assert_eq!(parse_desktop("# comment\n[Desktop Entry]\n# Name=Wrong\nName = Spaced \nExec = spaced --flag\nType=Application\n").map(|e| e.name), Some("Spaced".into()));
    }

    #[test]
    fn exec_lines_become_arguments() {
        assert_eq!(exec_args("firefox %u", "Firefox", "/f.desktop"), vec!["firefox"]);
        assert_eq!(exec_args("\"/opt/My App/run\" --name %c %F", "My App", "/m.desktop"), vec!["/opt/My App/run", "--name", "My App"]);
        assert_eq!(exec_args("env A=1 tool --pct 100%% %k", "T", "/t.desktop"), vec!["env", "A=1", "tool", "--pct", "100%", "/t.desktop"]);
        assert_eq!(exec_args("sh -c \"echo \\\"hi\\\"\"", "S", "/s.desktop"), vec!["sh", "-c", "echo \"hi\""]);
        assert_eq!(exec_args("  spaced   out  ", "S", "/s"), vec!["spaced", "out"]);
        assert_eq!(exec_args("app \"\"", "S", "/s"), vec!["app", ""]);
    }

    #[test]
    fn only_listed_apps_can_be_opened() {
        assert!(open("/bin/sh").is_err());
        assert!(open("rm -rf /").is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn an_installed_app_is_found_and_opened() {
        let dir = std::env::temp_dir().join(format!("forge-apps-{}", std::process::id()));
        let apps_dir = dir.join("applications");
        std::fs::create_dir_all(&apps_dir).unwrap();
        let marker = dir.join("opened");
        std::fs::write(
            apps_dir.join("forge-test.desktop"),
            format!("[Desktop Entry]\nName=Forge Test App\nExec=touch \"{}\" %U\nType=Application\n", marker.display()),
        )
        .unwrap();
        std::env::set_var("XDG_DATA_HOME", &dir);
        let found = list().into_iter().find(|(_, name)| name == "Forge Test App").expect("listed");
        open(&found.0).unwrap();
        for _ in 0..50 {
            if marker.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(marker.exists(), "the app ran");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn listing_is_sorted_and_unique() {
        let apps = list();
        assert!(apps.windows(2).all(|w| w[0].1.to_lowercase() <= w[1].1.to_lowercase()));
        assert!(apps.windows(2).all(|w| !w[0].1.eq_ignore_ascii_case(&w[1].1)));
    }
}
