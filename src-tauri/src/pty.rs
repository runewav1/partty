use crate::prefs::Prefs;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const SHELL_INTEGRATION_PWSH: &str = include_str!("../scripts/partty-shell-integration.ps1");
const SHELL_INTEGRATION_BASH: &str = include_str!("../scripts/partty-shell-integration.bash");
#[allow(dead_code)]
const SHELL_INTEGRATION_ZSH: &str = include_str!("../scripts/partty-shell-integration.zsh");
const PTY_OUTPUT_BATCH_BYTES: usize = 64 * 1024;
const PTY_OUTPUT_BATCH_MS: u64 = 1;
const PTY_REPLAY_BUFFER_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
pub struct PtyOutputEvent {
    pub pane_id: String,
    pub data: String,
}

#[derive(Clone, serde::Serialize)]
pub struct PtyExitEvent {
    pub pane_id: String,
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
    pub pane_id: String,
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

        let cmd = shell_command(&prefs)?;
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

        let (tx, rx) = sync_channel::<Vec<u8>>(48);
        let stop_reader = Arc::clone(&stop);
        let app_reader = app.clone();
        let pane_reader = pane_id.clone();
        let _reader = thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            // PTY reader ended unexpectedly (child EOF or I/O error) without intentional `stop`.
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
            // Intentional `pty_kill` / Drop sets `stop` before the child dies — do not emit (avoids
            // duplicate restarts and the "session ended" banner during New session).
            if notify_exit && !stop_reader.load(Ordering::SeqCst) {
                let _ = app_reader.emit(
                    "pty-exit",
                    PtyExitEvent {
                        pane_id: pane_reader,
                    },
                );
            }
        });

        let stop_emitter = Arc::clone(&stop);
        let replay_emitter = Arc::clone(&replay_buffer);
        let app_emit = app.clone();
        let pane_emit = pane_id.clone();
        let _emitter = thread::spawn(move || {
            let batch_window = Duration::from_millis(PTY_OUTPUT_BATCH_MS);
            let mut pending = Vec::<u8>::with_capacity(16 * 1024);
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
                    let text = String::from_utf8_lossy(&pending).into_owned();
                    pending.clear();
                    append_replay_buffer(&replay_emitter, &text);
                    let ev = PtyOutputEvent {
                        pane_id: pane_emit.clone(),
                        data: text,
                    };
                    let _ = app_emit.emit("pty-output", ev);
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
            pane_id,
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
    #[cfg(windows)]
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

#[cfg(windows)]
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

/// UTF-16LE script bytes as base64 for `powershell.exe` / `pwsh -EncodedCommand` (non-Windows spawn path).
#[cfg(not(windows))]
fn encode_pwsh_encoded_command(source: &str) -> String {
    let mut bytes = Vec::with_capacity(source.len() * 2);
    for unit in source.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    base64::engine::general_purpose::STANDARD.encode(&bytes)
}

/// Injects OSC 7 cwd, then delegates to the shell's built-in prompt (pwsh vs Windows PowerShell stay distinct).
#[cfg(not(windows))]
const PWSH_OSC7_PROMPT_SCRIPT: &str = r#"$script:__partty_prev_prompt = (Get-Command prompt -CommandType Function).ScriptBlock; function global:prompt { $p=$PWD.Path; $u='file:///'+($p-replace [char]92,[char]47); [Console]::Out.Write([char]27+']7;'+$u+[char]7); & $script:__partty_prev_prompt }"#;

#[cfg(not(windows))]
fn pwsh_powershell_osc7_args() -> Vec<String> {
    vec![
        "-NoLogo".into(),
        "-NoProfile".into(),
        "-NoExit".into(),
        "-EncodedCommand".into(),
        encode_pwsh_encoded_command(PWSH_OSC7_PROMPT_SCRIPT),
    ]
}

#[cfg(not(windows))]
fn resolve_bash_or_fail(shell: &str) -> Result<CommandBuilder, String> {
    if has_exe_on_path("bash.exe") {
        if let Some(p) = where_exe_first_line("bash.exe") {
            if p.is_file() {
                return Ok(CommandBuilder::new(p));
            }
        }
        return Ok(CommandBuilder::new("bash.exe"));
    }
    // Check Git for Windows bash
    let git_bash_paths: Vec<PathBuf> = [
        std::env::var("ProgramFiles")
            .ok()
            .map(|pf| PathBuf::from(pf).join("Git").join("bin").join("bash.exe")),
        std::env::var("ProgramFiles(x86)")
            .ok()
            .map(|pf| PathBuf::from(pf).join("Git").join("bin").join("bash.exe")),
        Some(PathBuf::from(r"C:\Git\bin\bash.exe")),
    ]
    .into_iter()
    .flatten()
    .collect();
    for p in &git_bash_paths {
        if p.is_file() {
            return Ok(CommandBuilder::new(p));
        }
    }
    Err(format!(
        "Shell '{}' not found. Install Git for Windows (includes bash) or set prefs.shell to a full path.",
        shell
    ))
}

/// ConPTY session always starts the Windows host shell (`COMSPEC`, usually `cmd.exe`), then we
/// launch the resolved interactive shell directly so integration is active on the first prompt.
fn shell_command(prefs: &Prefs) -> Result<CommandBuilder, String> {
    #[cfg(windows)]
    {
        return windows_shell_command(prefs);
    }
    #[cfg(not(windows))]
    {
        shell_command_interactive(prefs)
    }
}

#[cfg(windows)]
fn windows_host_shell(prefs: &Prefs) -> Result<CommandBuilder, String> {
    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    let c = CommandBuilder::new(comspec);
    apply_cwd(c, prefs)
}

#[cfg(windows)]
fn write_shell_integration_script(name: &str, contents: &str) -> Result<PathBuf, String> {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<std::collections::HashMap<String, PathBuf>>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    let map = cache.get_or_insert_with(std::collections::HashMap::new);
    if let Some(p) = map.get(name) {
        return Ok(p.clone());
    }
    let dir = std::env::temp_dir().join("partty-shell-integration");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    map.insert(name.to_string(), path.clone());
    Ok(path)
}

#[cfg(windows)]
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
            c.env("PARTTY_SHELL_INTEGRATION", "1");
            apply_cwd(c, prefs)
        }
        ShellKind::Zsh => {
            let script = write_shell_integration_script(
                "partty-shell-integration.zsh",
                SHELL_INTEGRATION_ZSH,
            )?;
            let command = format!(
                "source \"{}\"; exec zsh -i",
                script.to_string_lossy().replace('\\', "/")
            );
            let mut c = CommandBuilder::new("zsh.exe");
            c.args(["-i".to_string(), "-c".to_string(), command]);
            c.env("TERM_PROGRAM", "partty");
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

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellKind {
    Pwsh,
    PowerShell,
    Bash,
    Zsh,
    Cmd,
    Other,
}

#[cfg(windows)]
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

#[cfg(not(windows))]
fn shell_command_interactive(prefs: &Prefs) -> Result<CommandBuilder, String> {
    let trimmed = prefs.shell.trim().trim_matches(|c| c == '"' || c == '\'');
    let path_candidate = Path::new(trimmed);

    // Explicit filesystem path (e.g. state.json copied from another machine)
    if trimmed.contains('\\') || trimmed.contains('/') || trimmed.ends_with(".exe") {
        if let Ok(canonical) = path_candidate.canonicalize() {
            if canonical.is_file() {
                let base = canonical
                    .file_name()
                    .and_then(|s| s.to_str())
                    .map(str::to_owned);
                let mut c = CommandBuilder::new(canonical);
                if base
                    .as_deref()
                    .is_some_and(|n| n.eq_ignore_ascii_case("pwsh.exe"))
                {
                    c.args(pwsh_powershell_osc7_args());
                } else if base
                    .as_deref()
                    .is_some_and(|n| n.eq_ignore_ascii_case("powershell.exe"))
                {
                    c.args(pwsh_powershell_osc7_args());
                }
                return apply_cwd(c, prefs);
            }
        }
        // Non-canonical but exists as given
        if path_candidate.is_file() {
            let mut c = CommandBuilder::new(path_candidate);
            if path_candidate
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n.eq_ignore_ascii_case("pwsh.exe"))
            {
                c.args(pwsh_powershell_osc7_args());
            } else if path_candidate
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n.eq_ignore_ascii_case("powershell.exe"))
            {
                c.args(pwsh_powershell_osc7_args());
            }
            return apply_cwd(c, prefs);
        }
    }

    let mut shell = normalize_shell_token(trimmed);
    strip_exe_suffix(&mut shell);

    let cmd = if is_pwsh_alias(shell.as_str()) {
        let exe = resolve_pwsh_executable().ok_or_else(|| {
            "PowerShell 7 (pwsh) not found. Install from https://aka.ms/powershell or set prefs.shell to the full path to pwsh.exe.".to_string()
        })?;
        let mut c = CommandBuilder::new(exe);
        c.args(pwsh_powershell_osc7_args());
        c
    } else {
        match shell.as_str() {
            "cmd" => {
                let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
                CommandBuilder::new(comspec)
            }
            "powershell" | "powershell_ise" | "windows powershell" | "windowspowershell" => {
                let mut c = CommandBuilder::new("powershell.exe");
                c.args(pwsh_powershell_osc7_args());
                c
            }
            "bash" | "git-bash" | "gitbash" => resolve_bash_or_fail(&shell)?,
            "wsl" | "wsl2" => CommandBuilder::new("wsl.exe"),
            "zsh" | "fish" | "sh" | "dash" | "ash" => {
                // Try to find on PATH (WSL, Git Bash, MSYS2)
                let exe_name = format!("{}.exe", shell);
                if has_exe_on_path(&exe_name) {
                    CommandBuilder::new(exe_name)
                } else if has_exe_on_path(&shell) {
                    CommandBuilder::new(shell.as_str())
                } else {
                    return Err(format!(
                        "Shell '{}' not found on PATH. Install it or set prefs.shell to a full path.",
                        shell
                    ));
                }
            }
            other => {
                let exe_with = format!("{}.exe", other);
                if has_exe_on_path(&exe_with) {
                    CommandBuilder::new(exe_with)
                } else if has_exe_on_path(other) {
                    CommandBuilder::new(other)
                } else {
                    // Fallback: try pwsh
                    if let Some(p) = resolve_pwsh_executable() {
                        let mut c = CommandBuilder::new(p);
                        c.args(pwsh_powershell_osc7_args());
                        c
                    } else {
                        let mut c = CommandBuilder::new("powershell.exe");
                        c.args(pwsh_powershell_osc7_args());
                        c
                    }
                }
            }
        }
    };

    apply_cwd(cmd, prefs)
}
