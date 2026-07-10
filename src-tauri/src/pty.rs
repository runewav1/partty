use crate::prefs::Prefs;
use crate::profiles::{ConnectionProfile, ProfileKind};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const SHELL_INTEGRATION_PWSH: &str = include_str!("../scripts/partty-shell-integration.ps1");
const SHELL_INTEGRATION_BASH: &str = include_str!("../scripts/partty-shell-integration.bash");
const SHELL_INTEGRATION_ZSH: &str = include_str!("../scripts/partty-shell-integration.zsh");
const PTY_OUTPUT_BATCH_BYTES: usize = 128 * 1024;
const PTY_OUTPUT_BATCH_MS: u64 = 3;
const PTY_REPLAY_BUFFER_BYTES: usize = 4 * 1024 * 1024;
/// While the main webview is torn down — or recreated but not yet unlocked for
/// output — the emitter holds accumulated PTY bytes. Cap so a long dismissal
/// can't grow unbounded; oldest bytes are dropped first. On-screen history is
/// recovered from the SerializeAddon stash on resummon; held bytes are only
/// post-hide catch-up.
const PTY_PENDING_HOLD_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
pub struct PtyExitEvent {
    pub pane_id: String,
}

/// CWD change extracted by the Rust-side OSC parser.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyCwdEvent {
    pub pane_id: String,
    pub cwd: String,
}

/// Shell-integration lifecycle event extracted from OSC 133 / 633.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ShellEventKind {
    PromptStart,
    PromptEnd,
    PreExec,
    CommandDone { exit_code: Option<i32> },
    CommandLine { text: String },
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyShellEvent {
    pub pane_id: String,
    #[serde(flatten)]
    pub event: ShellEventKind,
}

// ────────────────────────────────────────────────────────────────────────────
// Rust-side OSC sequence stripper
//
// Processes raw PTY bytes before emission.  Strips OSC 7 (cwd), OSC 133 and
// OSC 633 (shell integration) from the output stream and returns structured
// side-channel events so the frontend can skip character-by-character JS
// parsing entirely for these common sequences.
//
// All other OSC sequences (OSC 8 hyperlinks, OSC 10/11 colours, etc.) are
// passed through unchanged for xterm.js to handle.
// ────────────────────────────────────────────────────────────────────────────

enum OscSideEvent {
    Cwd(String),
    PromptStart,
    PromptEnd,
    PreExec,
    CommandDone(Option<i32>),
    CommandLine(String),
}

struct OscStripper {
    /// Bytes held over from the previous chunk that ended mid-sequence.
    partial: Vec<u8>,
    /// Reusable scratch buffer for the cleaned output.
    scratch: Vec<u8>,
    /// Shell-integration properties (e.g. `IsWindows`, `Cwd`) set via OSC 633 P.
    properties: HashMap<String, String>,
}

impl OscStripper {
    fn new() -> Self {
        Self {
            partial: Vec::new(),
            scratch: Vec::with_capacity(16 * 1024),
            properties: HashMap::new(),
        }
    }

    /// Process one chunk.  Returns `(cleaned_bytes, side_events)`.
    fn process(&mut self, input: &[u8]) -> (Vec<u8>, Vec<OscSideEvent>) {
        if self.partial.is_empty() {
            self.process_slice(input)
        } else {
            self.partial.extend_from_slice(input);
            let combined = std::mem::take(&mut self.partial);
            self.process_slice(&combined)
        }
    }

    fn process_slice(&mut self, buf: &[u8]) -> (Vec<u8>, Vec<OscSideEvent>) {
        let mut events = Vec::new();
        self.scratch.clear();
        let mut i = 0;

        while i < buf.len() {
            // ESC ] → OSC start
            if i + 1 < buf.len() && buf[i] == 0x1b && buf[i + 1] == 0x5d {
                match osc_find_end(buf, i + 2) {
                    Some((payload_end, seq_end)) => {
                        let payload = &buf[i + 2..payload_end];
                        if !self.dispatch_osc(payload, &mut events) {
                            // Unknown OSC: pass through for xterm.js
                            self.scratch.extend_from_slice(&buf[i..seq_end]);
                        }
                        i = seq_end;
                    }
                    None => {
                        // Incomplete: carry remainder to next chunk
                        self.partial.extend_from_slice(&buf[i..]);
                        return (std::mem::take(&mut self.scratch), events);
                    }
                }
            } else if buf[i] == 0x1b && i + 1 == buf.len() {
                // Lone ESC at end — might be ESC ] split across chunks
                self.partial.push(0x1b);
                return (std::mem::take(&mut self.scratch), events);
            } else {
                self.scratch.push(buf[i]);
                i += 1;
            }
        }

        (std::mem::take(&mut self.scratch), events)
    }

    /// Returns `true` if the OSC was recognised and should be stripped.
    fn dispatch_osc(&mut self, payload: &[u8], events: &mut Vec<OscSideEvent>) -> bool {
        let s = match std::str::from_utf8(payload) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let (osc_num, rest) = match s.find(';') {
            Some(pos) => (&s[..pos], &s[pos + 1..]),
            None => (s, ""),
        };
        match osc_num {
            "7" => {
                if let Some(cwd) = osc7_parse_cwd(rest) {
                    events.push(OscSideEvent::Cwd(cwd));
                }
                true
            }
            "133" | "633" => {
                self.handle_shell_integration(rest, events);
                true
            }
            _ => false,
        }
    }

    fn handle_shell_integration(&mut self, rest: &str, events: &mut Vec<OscSideEvent>) {
        let sep = rest.find(';');
        let letter = sep.map(|p| &rest[..p]).unwrap_or(rest);
        let data = sep.map(|p| &rest[p + 1..]).unwrap_or("");

        match letter {
            "A" => events.push(OscSideEvent::PromptStart),
            "B" => events.push(OscSideEvent::PromptEnd),
            "C" => events.push(OscSideEvent::PreExec),
            "D" => {
                let code = data.trim().parse::<i32>().ok();
                events.push(OscSideEvent::CommandDone(code));
            }
            "E" => events.push(OscSideEvent::CommandLine(osc_unescape(data))),
            "P" => {
                if let Some(eq) = data.find('=') {
                    let key = &data[..eq];
                    let value = osc_unescape(&data[eq + 1..]);
                    self.properties.insert(key.to_string(), value.clone());
                    if key == "Cwd" {
                        let cwd = osc633_normalize_cwd(&value, &self.properties);
                        if !cwd.is_empty() {
                            events.push(OscSideEvent::Cwd(cwd));
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// Scan `buf` starting at `from` for an OSC terminator.
/// Returns `(payload_end, seq_end)` on success.
fn osc_find_end(buf: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut i = from;
    while i < buf.len() {
        match buf[i] {
            0x07 => return Some((i, i + 1)), // BEL
            0x1b if i + 1 < buf.len() && buf[i + 1] == 0x5c => {
                return Some((i, i + 2)); // ESC \
            }
            _ => i += 1,
        }
    }
    None
}

/// Decode `\xHH` and `\\` escapes used in OSC payloads.
fn osc_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.peek().copied() {
                Some('x') | Some('X') => {
                    chars.next();
                    let h1 = chars.next().and_then(|c| c.to_digit(16));
                    let h2 = chars.next().and_then(|c| c.to_digit(16));
                    if let (Some(a), Some(b)) = (h1, h2) {
                        if let Some(ch) = char::from_u32(a * 16 + b) {
                            out.push(ch);
                            continue;
                        }
                    }
                    out.push('\\');
                }
                Some('\\') => {
                    chars.next();
                    out.push('\\');
                }
                _ => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Extract a local path from an OSC 7 `file://` payload.
fn osc7_parse_cwd(payload: &str) -> Option<String> {
    let raw = payload.trim();
    if raw.is_empty() {
        return None;
    }
    let path = if let Some(rest) = raw
        .strip_prefix("file://")
        .or_else(|| raw.strip_prefix("FILE://"))
    {
        if rest.starts_with('/') {
            // file:///C:/path  or  file:///posix/path
            let trimmed = rest.trim_start_matches('/');
            let decoded = percent_decode(trimmed)?;
            if decoded.len() >= 2 && decoded.as_bytes()[1] == b':' {
                // Windows drive letter
                decoded.replace('/', "\\")
            } else {
                // POSIX absolute
                format!("/{}", decoded)
            }
        } else {
            // file://server/share  →  UNC
            let decoded = percent_decode(rest)?;
            format!("\\\\{}", decoded).replace('/', "\\")
        }
    } else {
        raw.to_string()
    };
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

/// Simple percent-decoder for OSC 7 URIs (ASCII-safe; UTF-8 sequences decoded as bytes).
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16)?;
            let lo = (bytes[i + 2] as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Common Unix absolute roots that must never be treated as MSYS `/x/...` drives.
fn looks_like_unix_root(path: &str) -> bool {
    const ROOTS: &[&str] = &[
        "/home/", "/usr/", "/etc/", "/var/", "/tmp/", "/opt/", "/mnt/", "/root/", "/dev/",
        "/proc/", "/sys/", "/bin/", "/lib/", "/sbin/", "/boot/", "/media/", "/run/", "/snap/",
        "/home", "/usr", "/etc", "/var", "/tmp", "/opt", "/mnt", "/root", "/dev", "/proc",
        "/sys", "/bin", "/lib", "/sbin", "/boot", "/media", "/run", "/snap",
    ];
    ROOTS.iter().any(|r| path == *r || path.starts_with(r))
}

/// Normalise a `Cwd=` value from OSC 633 P to a Windows absolute path when possible.
fn osc633_normalize_cwd(value: &str, properties: &HashMap<String, String>) -> String {
    let raw = value.trim();
    if raw.is_empty() {
        return String::new();
    }
    let is_windows = properties
        .get("IsWindows")
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(true); // default to Windows since that's the target platform

    if !is_windows {
        return raw.to_string();
    }

    // Already an absolute Windows path: C:\... or C:/...
    if raw.len() >= 2 && raw.as_bytes()[1] == b':' {
        return raw.replace('/', "\\");
    }
    // UNC: \\server\share or //server/share (incl. \\wsl$\Distro\...)
    if let Some(rest) = raw.strip_prefix("//").or_else(|| raw.strip_prefix("\\\\")) {
        return format!("\\\\{}", rest.replace('/', "\\"));
    }
    // /C:/ or /C:\ style (from some shells)
    if raw.starts_with('/') && raw.len() >= 4 && raw.as_bytes()[2] == b':' {
        return raw[1..].replace('/', "\\");
    }
    // WSL /mnt/x/... → X:\... (must run before MSYS single-letter conversion)
    if let Some(rest) = raw.strip_prefix("/mnt/") {
        let mut ch = rest.chars();
        if let Some(drive) = ch.next() {
            if drive.is_ascii_alphabetic() && rest.as_bytes().get(1) == Some(&b'/') {
                return format!(
                    "{}:\\{}",
                    drive.to_ascii_uppercase(),
                    &rest[2..].replace('/', "\\")
                );
            }
        }
    }
    // MSYS /x/path → X:\path (never rewrite /home, /usr, …)
    if raw.starts_with('/') && !looks_like_unix_root(raw) {
        let rest = &raw[1..];
        let mut chars = rest.chars();
        if let Some(drive) = chars.next() {
            if drive.is_ascii_alphabetic() {
                match chars.next() {
                    Some('/') => {
                        return format!(
                            "{}:\\{}",
                            drive.to_ascii_uppercase(),
                            chars.as_str().replace('/', "\\")
                        );
                    }
                    None => {
                        return format!("{}:\\", drive.to_ascii_uppercase());
                    }
                    Some(_) => {}
                }
            }
        }
    }
    // file:// URI fallback
    if raw.contains("://") {
        if let Some(p) = osc7_parse_cwd(raw) {
            return p;
        }
    }
    raw.to_string()
}

pub struct PtySession {
    master: Arc<parking_lot::Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
    child: Arc<parking_lot::Mutex<Option<Box<dyn Child + Send + Sync>>>>,
    /// Root shell process (pwsh/cmd/…); used to query real cwd (with pwsh, OSC 7 is also injected on each prompt).
    shell_pid: Option<u32>,
    stop: Arc<AtomicBool>,
    replay_buffer: Arc<parking_lot::Mutex<String>>,
    /// Emitted on `pty-output` / `pty-exit` for multi-pane routing.
    /// Stored behind a Mutex so that pre-warmed sessions can be adopted
    /// by a real pane without restarting the reader/emitter threads.
    pub pane_id: Arc<parking_lot::Mutex<String>>,
    _reader: JoinHandle<()>,
    _emitter: JoinHandle<()>,
}

impl PtySession {
    pub fn spawn(
        app: AppHandle,
        pane_id: String,
        cols: u16,
        rows: u16,
        prefs: &Prefs,
        initial_cwd: Option<String>,
    ) -> Result<Self, String> {
        Self::spawn_with_profile(app, pane_id, cols, rows, prefs, initial_cwd, None)
    }

    pub fn spawn_with_profile(
        app: AppHandle,
        pane_id: String,
        cols: u16,
        rows: u16,
        prefs: &Prefs,
        initial_cwd: Option<String>,
        profile: Option<&ConnectionProfile>,
    ) -> Result<Self, String> {
        let mut prefs = prefs.clone();
        if let Some(cwd) = initial_cwd {
            prefs.initial_cwd = Some(cwd);
        }
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let cmd = shell_command_for_profile(&prefs, profile)?;
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        let shell_pid = child.process_id();

        let master = pair.master;
        let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = master.take_writer().map_err(|e| e.to_string())?;

        let master = Arc::new(parking_lot::Mutex::new(master));
        let writer = Arc::new(parking_lot::Mutex::new(writer));
        let child = Arc::new(parking_lot::Mutex::new(Some(child)));
        let stop = Arc::new(AtomicBool::new(false));
        let replay_buffer = Arc::new(parking_lot::Mutex::new(String::with_capacity(256 * 1024)));

        let pane_id_arc = Arc::new(parking_lot::Mutex::new(pane_id.clone()));

        let (tx, rx) = sync_channel::<Vec<u8>>(48);
        let stop_reader = Arc::clone(&stop);
        let app_reader = app.clone();
        let pane_id_reader = Arc::clone(&pane_id_arc);
        let _reader = thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            let mut notify_exit = false;
            while !stop_reader.load(Ordering::SeqCst) {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        notify_exit = true;
                        break;
                    }
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        if tx.send(chunk).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        if !stop_reader.load(Ordering::SeqCst) {
                            notify_exit = true;
                        }
                        break;
                    }
                }
            }
            if notify_exit && !stop_reader.load(Ordering::SeqCst) {
                let pid = pane_id_reader.lock().clone();
                let _ = app_reader.emit("pty-exit", PtyExitEvent { pane_id: pid });
            }
        });

        let stop_emitter = Arc::clone(&stop);
        let replay_emitter = Arc::clone(&replay_buffer);
        let app_emit = app.clone();
        let pane_id_emitter = Arc::clone(&pane_id_arc);
        // NOTE: do NOT capture a `WebviewWindow` here.  When
        // `destroy_webview_on_hide` is enabled (the default), the main webview
        // is torn down on hide and rebuilt on summon; a handle captured at PTY
        // spawn time would point at the dead webview and silently lose every
        // `eval` after the first dismiss.  Instead we re-resolve the live
        // "main" window from the `AppHandle` on every batch and, while it is
        // absent, retain `pending` so the live shell process simply back-
        // pressures until the next webview is ready — letting the session
        // transparently reattach on resummon.
        let _emitter = thread::spawn(move || {
            let batch_window = Duration::from_millis(PTY_OUTPUT_BATCH_MS);
            let mut pending = Vec::<u8>::with_capacity(16 * 1024);
            let mut stripper = OscStripper::new();
            while !stop_emitter.load(Ordering::SeqCst) {
                if pending.is_empty() {
                    match rx.recv() {
                        Ok(chunk) => pending.extend_from_slice(&chunk),
                        Err(_) => break,
                    }
                }

                let started = Instant::now();
                let mut disconnected = false;
                while pending.len() < PTY_OUTPUT_BATCH_BYTES {
                    let elapsed = started.elapsed();
                    if elapsed >= batch_window {
                        break;
                    }
                    match rx.recv_timeout(batch_window - elapsed) {
                        Ok(chunk) => pending.extend_from_slice(&chunk),
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => {
                            disconnected = true;
                            break;
                        }
                    }
                }

                if !pending.is_empty() {
                    let pane = pane_id_emitter.lock().clone();

                    // If the main webview is torn down, or it exists but JS has
                    // not finished scrollback rehydration yet, hold the batch.
                    // Emitting early floods empty terminals and races/evicts the
                    // SerializeAddon restore (worse after long hides with a large
                    // pending backlog).
                    let win = app_emit.get_webview_window("main");
                    let unlocked = app_emit
                        .state::<crate::AppState>()
                        .pty_output_unlocked
                        .load(Ordering::SeqCst);
                    if win.is_none() || !unlocked {
                        if pending.len() > PTY_PENDING_HOLD_MAX_BYTES {
                            let excess = pending.len() - PTY_PENDING_HOLD_MAX_BYTES;
                            pending.drain(..excess);
                        }
                        thread::sleep(Duration::from_millis(20));
                        continue;
                    }
                    let win = win.expect("checked above");

                    // Strip OSC 7 / 133 / 633 in Rust; emit side-channel events.
                    let (cleaned_bytes, osc_events) = stripper.process(&pending);
                    pending.clear();

                    let text = match String::from_utf8(cleaned_bytes) {
                        Ok(s) => s,
                        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
                    };
                    append_replay_buffer(&replay_emitter, &text);

                    // Emit CWD and shell-integration side events first (before output).
                    for ev in osc_events {
                        match ev {
                            OscSideEvent::Cwd(cwd) => {
                                let _ = app_emit.emit(
                                    "pty-cwd",
                                    PtyCwdEvent {
                                        pane_id: pane.clone(),
                                        cwd,
                                    },
                                );
                            }
                            OscSideEvent::PromptStart => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        pane_id: pane.clone(),
                                        event: ShellEventKind::PromptStart,
                                    },
                                );
                            }
                            OscSideEvent::PromptEnd => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        pane_id: pane.clone(),
                                        event: ShellEventKind::PromptEnd,
                                    },
                                );
                            }
                            OscSideEvent::PreExec => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        pane_id: pane.clone(),
                                        event: ShellEventKind::PreExec,
                                    },
                                );
                            }
                            OscSideEvent::CommandDone(code) => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        pane_id: pane.clone(),
                                        event: ShellEventKind::CommandDone { exit_code: code },
                                    },
                                );
                            }
                            OscSideEvent::CommandLine(text_ev) => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        pane_id: pane.clone(),
                                        event: ShellEventKind::CommandLine { text: text_ev },
                                    },
                                );
                            }
                        }
                    }

                    let pane_json = serde_json::to_string(&pane).unwrap();
                    let data_json = serde_json::to_string(&text).unwrap();
                    let _ = win
                        .eval(&format!("window.__partty_out({},{})", pane_json, data_json));
                }

                if disconnected {
                    break;
                }
            }
        });

        Ok(Self {
            master,
            writer,
            child,
            shell_pid,
            stop,
            replay_buffer,
            pane_id: pane_id_arc,
            _reader,
            _emitter,
        })
    }

    /// Best-effort cwd: uses the foreground console process on Windows when nested shells share the PTY.
    pub fn shell_cwd(&self) -> Option<String> {
        let pid = self.cwd_target_pid()?;
        query_cwd_for_pid(pid)
    }

    /// Shell executable token for palette context (nested shell when detectable on Windows).
    pub fn shell_exe_token(&self) -> Option<String> {
        let pid = self.cwd_target_pid()?;
        query_exe_token_for_pid(pid)
    }

    /// PID to query for cwd/exe (ConPTY root or deepest nested shell attached to the same console).
    fn cwd_target_pid(&self) -> Option<u32> {
        let root = self.shell_pid?;
        Some(crate::win_console::effective_cwd_target_pid(root))
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock();
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    pub fn replay_snapshot(&self) -> String {
        self.replay_buffer.lock().clone()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(mut c) = self.child.lock().take() {
            let _ = c.kill();
        }
    }
}

fn append_replay_buffer(buf: &Arc<parking_lot::Mutex<String>>, text: &str) {
    let mut replay = buf.lock();
    replay.push_str(text);
    if replay.len() <= PTY_REPLAY_BUFFER_BYTES {
        return;
    }
    let excess = replay.len() - PTY_REPLAY_BUFFER_BYTES;
    let mut drain_to = excess;
    while drain_to < replay.len() && !replay.is_char_boundary(drain_to) {
        drain_to += 1;
    }
    replay.drain(..drain_to);
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

fn query_cwd_for_pid(pid: u32) -> Option<String> {
    if let Some(cwd) = crate::peb_cwd_windows::cwd_from_pid(pid) {
        return Some(cwd);
    }
    query_cwd_for_pid_sysinfo(pid)
}

fn query_cwd_for_pid_sysinfo(pid: u32) -> Option<String> {
    use std::sync::Mutex;
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    static SYS: Mutex<Option<System>> = Mutex::new(None);
    let mut sys_opt = SYS.lock().unwrap();
    let sys = sys_opt.get_or_insert_with(System::new);
    let p = Pid::from_u32(pid);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[p]),
        false,
        ProcessRefreshKind::nothing().with_cwd(UpdateKind::Always),
    );
    sys.process(p)
        .and_then(|proc| proc.cwd())
        .map(|path| path.to_string_lossy().into_owned())
}

fn query_exe_token_for_pid(pid: u32) -> Option<String> {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[p]),
        false,
        ProcessRefreshKind::nothing().with_exe(UpdateKind::Always),
    );
    sys.process(p).map(|proc| {
        let name = proc.name().to_string_lossy();
        normalize_shell_exe_token(&name)
    })
}

fn normalize_shell_exe_token(name: &str) -> String {
    let n = name.trim();
    let n = n.rsplit(['/', '\\']).next().unwrap_or(n);
    let n = n.strip_suffix(".exe").unwrap_or(n);
    n.to_lowercase()
}

fn has_exe_on_path(name: &str) -> bool {
    let mut c = std::process::Command::new("where.exe");
    c.arg(name)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    crate::subprocess::hide_console_window(&mut c);
    c.status().map(|s| s.success()).unwrap_or(false)
}

/// First absolute path from `where.exe`, if any.
fn where_exe_first_line(name: &str) -> Option<PathBuf> {
    let mut c = std::process::Command::new("where.exe");
    c.arg(name)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    crate::subprocess::hide_console_window(&mut c);
    let out = c.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(PathBuf::from)
}

fn pwsh_standard_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        v.push(
            PathBuf::from(pf)
                .join("PowerShell")
                .join("7")
                .join("pwsh.exe"),
        );
    }
    if let Ok(pfx86) = std::env::var("ProgramFiles(x86)") {
        v.push(
            PathBuf::from(pfx86)
                .join("PowerShell")
                .join("7")
                .join("pwsh.exe"),
        );
    }
    if let Ok(la) = std::env::var("LOCALAPPDATA") {
        v.push(
            PathBuf::from(la)
                .join("Microsoft")
                .join("WindowsApps")
                .join("pwsh.exe"),
        );
    }
    v
}

/// Resolve PowerShell 7+ for GUI apps where `PATH` may omit the install directory.
/// Prefer well-known install paths before `where.exe` (fewer subprocesses, works when PATH is wrong).
fn resolve_pwsh_executable() -> Option<PathBuf> {
    for p in pwsh_standard_paths() {
        if p.is_file() {
            return Some(p);
        }
    }
    where_exe_first_line("pwsh.exe").filter(|p| p.is_file())
}

fn resolve_windows_bash_executable() -> Result<CommandBuilder, String> {
    if has_exe_on_path("bash.exe") {
        if let Some(p) = where_exe_first_line("bash.exe") {
            if p.is_file() {
                return Ok(CommandBuilder::new(p));
            }
        }
        return Ok(CommandBuilder::new("bash.exe"));
    }
    for pf_var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(pf) = std::env::var(pf_var) {
            let p = PathBuf::from(&pf).join("Git").join("bin").join("bash.exe");
            if p.is_file() {
                return Ok(CommandBuilder::new(p));
            }
        }
    }
    Err("bash.exe not found. Install Git Bash or set prefs.shell to a full path.".to_string())
}

#[derive(serde::Serialize, Clone)]
pub struct DetectedShell {
    pub name: String,
    pub path: String,
}

fn push_shell_unique(shells: &mut Vec<DetectedShell>, name: &str, path: String) {
    if shells.iter().any(|s| s.name.eq_ignore_ascii_case(name)) {
        return;
    }
    shells.push(DetectedShell {
        name: name.to_string(),
        path,
    });
}

pub fn detect_available_shells() -> Vec<DetectedShell> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    const TTL: Duration = Duration::from_secs(45);
    static CACHE: Mutex<Option<(Instant, Vec<DetectedShell>)>> = Mutex::new(None);

    if let Ok(guard) = CACHE.lock() {
        if let Some((at, shells)) = guard.as_ref() {
            if at.elapsed() < TTL {
                return shells.clone();
            }
        }
    }

    let shells = detect_available_shells_uncached();
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), shells.clone()));
    }
    shells
}

fn detect_available_shells_uncached() -> Vec<DetectedShell> {
    // Collect env vars before spawning threads (avoids repeated env lookups and
    // keeps thread closures free of env-access races on Windows).
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    let pf = std::env::var("ProgramFiles").ok();
    let pf_x86 = std::env::var("ProgramFiles(x86)").ok();

    // Run all five shell detections concurrently. Each may spawn a `where.exe`
    // child process; running them in parallel cuts total wall time from
    // O(n × process-spawn-overhead) down to O(1 × slowest-detection).
    let (pwsh_result, powershell_result, cmd_result, bash_result, wsl_result) =
        std::thread::scope(|s| {
            // PowerShell 7 (pwsh)
            let pwsh =
                s.spawn(|| resolve_pwsh_executable().map(|p| p.to_string_lossy().into_owned()));

            // Windows PowerShell (powershell.exe)
            let ps_system_path = PathBuf::from(&sys_root)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe");
            let powershell = s.spawn(move || -> Option<String> {
                if ps_system_path.is_file() {
                    return Some(ps_system_path.to_string_lossy().into_owned());
                }
                if has_exe_on_path("powershell.exe") {
                    return Some(
                        where_exe_first_line("powershell.exe")
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "powershell.exe".into()),
                    );
                }
                None
            });

            // cmd.exe
            let cmd = s.spawn(move || -> Option<String> {
                if Path::new(&comspec).is_file() {
                    return Some(comspec);
                }
                if has_exe_on_path("cmd.exe") {
                    return Some(
                        where_exe_first_line("cmd.exe")
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "cmd.exe".into()),
                    );
                }
                None
            });

            // bash (Git Bash via ProgramFiles, then PATH fallback)
            let bash = s.spawn(move || -> Option<String> {
                for base in [pf.as_deref(), pf_x86.as_deref()].into_iter().flatten() {
                    let p = PathBuf::from(base).join("Git").join("bin").join("bash.exe");
                    if p.is_file() {
                        return Some(p.to_string_lossy().into_owned());
                    }
                }
                if has_exe_on_path("bash.exe") {
                    return Some(
                        where_exe_first_line("bash.exe")
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "bash.exe".into()),
                    );
                }
                None
            });

            // WSL
            let wsl = s.spawn(|| -> Option<String> {
                if has_exe_on_path("wsl.exe") {
                    return Some(
                        where_exe_first_line("wsl.exe")
                            .map(|p| p.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "wsl.exe".into()),
                    );
                }
                None
            });

            (
                pwsh.join().unwrap_or(None),
                powershell.join().unwrap_or(None),
                cmd.join().unwrap_or(None),
                bash.join().unwrap_or(None),
                wsl.join().unwrap_or(None),
            )
        });

    let mut shells: Vec<DetectedShell> = Vec::new();
    if let Some(p) = pwsh_result {
        push_shell_unique(&mut shells, "pwsh", p);
    }
    if let Some(p) = powershell_result {
        push_shell_unique(&mut shells, "powershell", p);
    }
    if let Some(p) = cmd_result {
        push_shell_unique(&mut shells, "cmd", p);
    }
    if let Some(p) = bash_result {
        push_shell_unique(&mut shells, "bash", p);
    }
    if let Some(p) = wsl_result {
        push_shell_unique(&mut shells, "wsl", p);
    }
    shells
}

fn normalize_shell_token(raw: &str) -> String {
    raw.trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_lowercase()
}

fn strip_exe_suffix(s: &mut String) {
    if s.len() > 4 && s.ends_with(".exe") {
        s.truncate(s.len() - 4);
    }
}

fn is_pwsh_alias(shell: &str) -> bool {
    matches!(
        shell,
        "pwsh"
            | "pwsh-preview"
            | "powershell-core"
            | "powershellcore"
            | "powershell_7"
            | "powershell7"
            | "powershell-7"
            | "ps7"
    )
}

fn apply_cwd(mut cmd: CommandBuilder, prefs: &Prefs) -> Result<CommandBuilder, String> {
    if let Some(dir) = prefs.initial_cwd.as_deref() {
        if Path::new(dir).is_dir() {
            cmd.cwd(dir);
        }
    }
    Ok(cmd)
}

/// ConPTY session always starts the Windows host shell (`COMSPEC`, usually `cmd.exe`), then we
/// launch the resolved interactive shell directly so integration is active on the first prompt.
fn shell_command(prefs: &Prefs) -> Result<CommandBuilder, String> {
    windows_shell_command(prefs)
}

/// Build a PTY command for a connection profile (local shell, WSL distro, SSH).
pub fn shell_command_for_profile(
    prefs: &Prefs,
    profile: Option<&ConnectionProfile>,
) -> Result<CommandBuilder, String> {
    match profile.map(|p| &p.kind) {
        Some(ProfileKind::Wsl) => {
            let distro = profile
                .and_then(|p| p.wsl_distro.as_deref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "WSL profile is missing wsl_distro".to_string())?;
            wsl_distro_command(prefs, distro)
        }
        Some(ProfileKind::Ssh) => {
            let p = profile.ok_or_else(|| "SSH profile missing".to_string())?;
            ssh_profile_command(p)
        }
        Some(ProfileKind::Local) | None => shell_command(prefs),
    }
}

/// Launch an installed WSL distribution (`wsl.exe -d <name>`), injecting bash/zsh
/// shell integration when the distro's login shell supports it.
fn wsl_distro_command(prefs: &Prefs, distro: &str) -> Result<CommandBuilder, String> {
    let mut c = CommandBuilder::new("wsl.exe");
    c.arg("-d");
    c.arg(distro);
    if let Some(dir) = prefs
        .initial_cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // WSL accepts Windows or Linux paths via --cd (same as Windows Terminal).
        c.arg("--cd");
        c.arg(dir);
    }

    let version = env!("CARGO_PKG_VERSION");
    c.env("TERM_PROGRAM", "partty");
    c.env("TERM_PROGRAM_VERSION", version);

    match detect_wsl_login_shell(distro) {
        WslLoginShell::Zsh => {
            let script = write_shell_integration_script(
                "partty-shell-integration.zsh",
                SHELL_INTEGRATION_ZSH,
            )?;
            let script_wsl = windows_path_to_wsl_mnt(&script)?;
            let zdot = ensure_zsh_zdot(&script_wsl)?;
            let zdot_wsl = windows_path_to_wsl_mnt(&zdot)?;
            // Pass ZDOTDIR inside Linux via `env` (Windows env is not forwarded by default).
            c.arg("--exec");
            c.arg("env");
            c.arg(format!("ZDOTDIR={zdot_wsl}"));
            c.arg("PARTTY_ORIGINAL_ZDOTDIR=");
            c.arg("TERM_PROGRAM=partty");
            c.arg(format!("TERM_PROGRAM_VERSION={version}"));
            c.arg("PARTTY_SHELL_INTEGRATION=1");
            c.arg("zsh");
            c.arg("-i");
            c.env("PARTTY_SHELL_INTEGRATION", "1");
        }
        WslLoginShell::Bash | WslLoginShell::Unknown => {
            // Prefer bash injection; Unknown falls back to bash (default on most distros).
            let script = write_shell_integration_script(
                "partty-shell-integration.bash",
                SHELL_INTEGRATION_BASH,
            )?;
            let script_wsl = windows_path_to_wsl_mnt(&script)?;
            let init = write_shell_integration_script(
                "partty-wsl-bash-init.sh",
                &format!(
                    r#"# Partty WSL bash init — login-style rc cascade, then integrate.
if [[ -f ~/.bash_profile ]]; then
  . ~/.bash_profile
elif [[ -f ~/.bash_login ]]; then
  . ~/.bash_login
elif [[ -f ~/.profile ]]; then
  . ~/.profile
elif [[ -f ~/.bashrc ]]; then
  . ~/.bashrc
fi
source "{script_wsl}"
"#
                ),
            )?;
            let init_wsl = windows_path_to_wsl_mnt(&init)?;
            c.arg("--exec");
            c.arg("bash");
            c.arg("--init-file");
            c.arg(init_wsl);
            c.arg("-i");
            c.env("PARTTY_SHELL_INTEGRATION", "1");
        }
        WslLoginShell::Other => {
            // fish / csh / etc. — launch default shell without injection.
            c.env("PARTTY_SHELL_INTEGRATION", "0");
        }
    }

    Ok(c)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WslLoginShell {
    Bash,
    Zsh,
    Other,
    Unknown,
}

/// Probe the distro's login shell (`getent passwd`). Cached for the process lifetime.
fn detect_wsl_login_shell(distro: &str) -> WslLoginShell {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<HashMap<String, WslLoginShell>>> = Mutex::new(None);

    let key = distro.to_ascii_lowercase();
    if let Ok(guard) = CACHE.lock() {
        if let Some(map) = guard.as_ref() {
            if let Some(kind) = map.get(&key) {
                return *kind;
            }
        }
    }

    let kind = detect_wsl_login_shell_uncached(distro);
    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(key, kind);
    }
    kind
}

fn detect_wsl_login_shell_uncached(distro: &str) -> WslLoginShell {
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.args([
        "-d",
        distro,
        "-e",
        "sh",
        "-c",
        "getent passwd \"$(id -u)\" 2>/dev/null | cut -d: -f7 || echo \"$SHELL\"",
    ]);
    crate::subprocess::hide_console_window(&mut cmd);
    let Ok(out) = cmd.output() else {
        return WslLoginShell::Unknown;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let shell = text.lines().next().unwrap_or("").trim();
    if shell.is_empty() {
        return WslLoginShell::Unknown;
    }
    let base = Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(shell)
        .to_ascii_lowercase();
    match base.as_str() {
        "bash" => WslLoginShell::Bash,
        "zsh" => WslLoginShell::Zsh,
        "sh" | "dash" => WslLoginShell::Bash, // inject via bash
        "fish" | "csh" | "tcsh" | "ksh" | "pwsh" => WslLoginShell::Other,
        _ => WslLoginShell::Unknown,
    }
}

/// Convert a Windows path to a WSL `/mnt/<drive>/...` path (no `wslpath` round-trip).
fn windows_path_to_wsl_mnt(path: &Path) -> Result<String, String> {
    let raw = path.to_string_lossy();
    let normalized = raw
        .strip_prefix(r"\\?\")
        .unwrap_or(raw.as_ref())
        .replace('\\', "/");
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let drive = normalized.chars().next().unwrap().to_ascii_lowercase();
        let rest = normalized[2..].trim_start_matches('/');
        if rest.is_empty() {
            return Ok(format!("/mnt/{drive}"));
        }
        return Ok(format!("/mnt/{drive}/{rest}"));
    }
    Err(format!(
        "cannot map path to WSL /mnt form: {}",
        path.display()
    ))
}

/// ZDOTDIR wrapper so integration survives interactive zsh startup (user `.zshrc` still loads).
fn ensure_zsh_zdot(integration_script_unix: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir()
        .join("partty-shell-integration")
        .join("zdot");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zshrc = dir.join(".zshrc");
    let contents = format!(
        r#"# Partty zsh ZDOTDIR wrapper — load user rc, then shell integration.
if [[ -n "${{PARTTY_ORIGINAL_ZDOTDIR}}" && -f "${{PARTTY_ORIGINAL_ZDOTDIR}}/.zshrc" ]]; then
  source "${{PARTTY_ORIGINAL_ZDOTDIR}}/.zshrc"
elif [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi
source "{integration_script_unix}"
"#
    );
    std::fs::write(&zshrc, contents).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Split a Windows-style commandline into executable + args (basic quotes).
fn split_commandline(raw: &str) -> Result<(String, Vec<String>), String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    let mut iter = tokens.into_iter();
    let exe = iter
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "empty commandline".to_string())?;
    Ok((exe, iter.collect()))
}

/// OpenSSH client spawn — Windows Terminal style (`ssh user@host` / structured fields).
fn ssh_profile_command(profile: &ConnectionProfile) -> Result<CommandBuilder, String> {
    if let Some(cl) = profile
        .commandline
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let (exe, args) = split_commandline(cl)?;
        let mut c = CommandBuilder::new(exe);
        for a in args {
            c.arg(a);
        }
        c.env("TERM_PROGRAM", "partty");
        c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        c.env("PARTTY_SHELL_INTEGRATION", "0");
        return Ok(c);
    }

    let host = profile
        .ssh_host
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "SSH profile needs ssh_host or commandline (edit ~/.partty/profiles/*.toml)".to_string()
        })?;

    let mut c = CommandBuilder::new("ssh.exe");
    if let Some(port) = profile.ssh_port {
        c.arg("-p");
        c.arg(port.to_string());
    }
    if let Some(id_file) = profile
        .ssh_identity_file
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        c.arg("-i");
        c.arg(id_file);
    }
    for a in &profile.ssh_args {
        let t = a.trim();
        if !t.is_empty() {
            c.arg(t);
        }
    }

    let target = match profile
        .ssh_user
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(user) if !host.contains('@') => format!("{user}@{host}"),
        _ => host.to_string(),
    };

    if let Some(remote) = profile
        .startup_command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // Force a TTY so interactive remotes / remote shells work (WT pattern).
        c.arg("-t");
        c.arg(target);
        c.arg(remote);
    } else {
        c.arg(target);
    }

    c.env("TERM_PROGRAM", "partty");
    c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    c.env("PARTTY_SHELL_INTEGRATION", "0");
    Ok(c)
}

fn windows_host_shell(prefs: &Prefs) -> Result<CommandBuilder, String> {
    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    let c = CommandBuilder::new(comspec);
    apply_cwd(c, prefs)
}

fn write_shell_integration_script(name: &str, contents: &str) -> Result<PathBuf, String> {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<std::collections::HashMap<String, PathBuf>>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    let map = cache.get_or_insert_with(std::collections::HashMap::new);
    let dir = std::env::temp_dir().join("partty-shell-integration");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    // Always rewrite so rebuilt binaries refresh script contents in-process caches.
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    map.insert(name.to_string(), path.clone());
    Ok(path)
}

fn windows_shell_command(prefs: &Prefs) -> Result<CommandBuilder, String> {
    let kind = detect_shell_kind(prefs);
    match kind {
        ShellKind::Pwsh | ShellKind::PowerShell => {
            let exe = if matches!(kind, ShellKind::Pwsh) {
                resolve_pwsh_executable()
                    .ok_or_else(|| "PowerShell 7 (pwsh) not found.".to_string())?
            } else {
                PathBuf::from("powershell.exe")
            };
            let script = write_shell_integration_script(
                "partty-shell-integration.ps1",
                SHELL_INTEGRATION_PWSH,
            )?;
            let command = format!(". '{}'", script.to_string_lossy().replace('\'', "''"));
            let mut c = CommandBuilder::new(exe);
            c.args([
                "-NoLogo".to_string(),
                "-NoExit".to_string(),
                "-Command".to_string(),
                command,
            ]);
            c.env("TERM_PROGRAM", "partty");
            c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
            c.env("PARTTY_SHELL_INTEGRATION", "1");
            apply_cwd(c, prefs)
        }
        ShellKind::Bash => {
            let bash = resolve_windows_bash_executable()?;
            let script = write_shell_integration_script(
                "partty-shell-integration.bash",
                SHELL_INTEGRATION_BASH,
            )?;
            let init = write_shell_integration_script(
                "partty-bash-init.sh",
                &format!(
                    r#"[[ -f ~/.bashrc ]] && source ~/.bashrc
source "{}"
"#,
                    script.to_string_lossy().replace('\\', "/")
                ),
            )?;
            let mut c = bash;
            c.args([
                "--init-file".to_string(),
                init.to_string_lossy().to_string(),
                "-i".to_string(),
            ]);
            c.env("TERM_PROGRAM", "partty");
            c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
            c.env("PARTTY_SHELL_INTEGRATION", "1");
            apply_cwd(c, prefs)
        }
        ShellKind::Zsh => {
            let script = write_shell_integration_script(
                "partty-shell-integration.zsh",
                SHELL_INTEGRATION_ZSH,
            )?;
            // Use forward slashes so zsh (often MSYS-based) can source the script.
            let script_unix = script.to_string_lossy().replace('\\', "/");
            let zdot = ensure_zsh_zdot(&script_unix)?;
            let original_zdot = std::env::var("ZDOTDIR").unwrap_or_default();
            let mut c = CommandBuilder::new("zsh.exe");
            c.arg("-i");
            c.env("ZDOTDIR", zdot.to_string_lossy().as_ref());
            c.env("PARTTY_ORIGINAL_ZDOTDIR", original_zdot);
            c.env("TERM_PROGRAM", "partty");
            c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
            c.env("PARTTY_SHELL_INTEGRATION", "1");
            apply_cwd(c, prefs)
        }
        ShellKind::Cmd => windows_host_shell(prefs),
        ShellKind::Other => {
            let trimmed = prefs.shell.trim().trim_matches(|c| c == '"' || c == '\'');
            if trimmed.is_empty() {
                return windows_host_shell(prefs);
            }
            let path_candidate = Path::new(trimmed);
            let cmd =
                if (trimmed.contains('\\') || trimmed.contains('/') || trimmed.ends_with(".exe"))
                    && path_candidate.is_file()
                {
                    CommandBuilder::new(path_candidate)
                } else {
                    let exe_with = format!("{}.exe", trimmed);
                    if has_exe_on_path(&exe_with) {
                        CommandBuilder::new(exe_with)
                    } else if has_exe_on_path(trimmed) {
                        CommandBuilder::new(trimmed)
                    } else {
                        return windows_host_shell(prefs);
                    }
                };
            apply_cwd(cmd, prefs)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellKind {
    Pwsh,
    PowerShell,
    Bash,
    Zsh,
    Cmd,
    Other,
}

fn detect_shell_kind(prefs: &Prefs) -> ShellKind {
    let trimmed = prefs.shell.trim().trim_matches(|c| c == '"' || c == '\'');
    if trimmed.is_empty() {
        return ShellKind::Cmd;
    }
    let path_candidate = Path::new(trimmed);
    let name = if trimmed.contains('\\') || trimmed.contains('/') || trimmed.ends_with(".exe") {
        path_candidate
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
    } else {
        let mut s = normalize_shell_token(trimmed);
        strip_exe_suffix(&mut s);
        s
    };
    let name = name.trim_end_matches(".exe");
    if is_pwsh_alias(name) {
        return ShellKind::Pwsh;
    }
    match name {
        "powershell" => ShellKind::PowerShell,
        "bash" | "git-bash" | "gitbash" => ShellKind::Bash,
        "zsh" => ShellKind::Zsh,
        "cmd" => ShellKind::Cmd,
        _ if name.contains("pwsh") => ShellKind::Pwsh,
        _ if name.contains("powershell") => ShellKind::PowerShell,
        _ if name.contains("bash") => ShellKind::Bash,
        _ => ShellKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::{osc633_normalize_cwd, split_commandline, windows_path_to_wsl_mnt};
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn split_ssh_commandline() {
        let (exe, args) = split_commandline("ssh -J jump user@host").unwrap();
        assert_eq!(exe, "ssh");
        assert_eq!(args, vec!["-J", "jump", "user@host"]);
    }

    #[test]
    fn split_quoted_commandline() {
        let (exe, args) =
            split_commandline(r#"ssh -i "C:\Users\me\.ssh\id_rsa" host"#).unwrap();
        assert_eq!(exe, "ssh");
        assert_eq!(args, vec!["-i", r"C:\Users\me\.ssh\id_rsa", "host"]);
    }

    fn props_windows() -> HashMap<String, String> {
        HashMap::from([("IsWindows".into(), "True".into())])
    }

    #[test]
    fn osc633_cwd_drive_and_mnt() {
        let p = props_windows();
        assert_eq!(
            osc633_normalize_cwd("C:/Users/me", &p),
            r"C:\Users\me"
        );
        assert_eq!(
            osc633_normalize_cwd("/mnt/c/Users/me", &p),
            r"C:\Users\me"
        );
    }

    #[test]
    fn osc633_cwd_does_not_mangle_unix_home() {
        let p = props_windows();
        assert_eq!(osc633_normalize_cwd("/home/rune", &p), "/home/rune");
        assert_eq!(osc633_normalize_cwd("/usr/local", &p), "/usr/local");
    }

    #[test]
    fn osc633_cwd_unc_wsl() {
        let p = props_windows();
        assert_eq!(
            osc633_normalize_cwd("//wsl$/Ubuntu/home/rune", &p),
            r"\\wsl$\Ubuntu\home\rune"
        );
    }

    #[test]
    fn windows_to_wsl_mnt_path() {
        let p = PathBuf::from(r"C:\Users\me\AppData\Local\Temp\partty-shell-integration\x.bash");
        assert_eq!(
            windows_path_to_wsl_mnt(&p).unwrap(),
            "/mnt/c/Users/me/AppData/Local/Temp/partty-shell-integration/x.bash"
        );
    }
}
