//! Windows-only: find the process that actually owns the interactive prompt in a ConPTY session.
//!
//! The PTY child we spawn (e.g. pwsh) may launch nested shells (`cmd`, another pwsh, etc.). Those
//! processes attach to the same console; `GetConsoleProcessList` (after `AttachConsole`) lists
//! them. We pick the **deepest descendant** of the root shell PID in that set so `cwd` / exe match
//! the foreground shell, not only the parent process.

#[cfg(windows)]
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
#[cfg(windows)]
use windows_sys::Win32::System::Console::{AttachConsole, FreeConsole, GetConsoleProcessList};

/// PID used for OS cwd / exe queries: nested shell when detectable, otherwise the PTY root.
#[cfg(windows)]
pub fn effective_cwd_target_pid(root_shell_pid: u32) -> u32 {
    foreground_pid_for_console_session(root_shell_pid).unwrap_or(root_shell_pid)
}

#[cfg(not(windows))]
pub fn effective_cwd_target_pid(root_shell_pid: u32) -> u32 {
    root_shell_pid
}

#[cfg(windows)]
fn foreground_pid_for_console_session(root_shell_pid: u32) -> Option<u32> {
    let ids = get_console_process_ids(root_shell_pid)?;
    if ids.is_empty() {
        return None;
    }
    if ids.len() == 1 {
        return Some(ids[0]);
    }
    pick_deepest_descendant(root_shell_pid, &ids)
}

/// Returns PIDs attached to the same console as `root_shell_pid` (in arbitrary order).
#[cfg(windows)]
fn get_console_process_ids(root_shell_pid: u32) -> Option<Vec<u32>> {
    unsafe {
        // Drop our own console handle if present (e.g. `cargo run`), so we can attach elsewhere.
        let _ = FreeConsole();
        if AttachConsole(root_shell_pid) == 0 {
            return None;
        }

        let mut cap = 16u32;
        let list = loop {
            let mut buf = vec![0u32; cap as usize];
            let n = GetConsoleProcessList(buf.as_mut_ptr(), cap);
            if n == 0 {
                let _ = FreeConsole();
                return None;
            }
            if n > cap {
                cap = n;
                continue;
            }
            buf.truncate(n as usize);
            break buf;
        };

        let _ = FreeConsole();
        Some(list)
    }
}

/// Shortest path length from `pid` up to `ancestor`, or `None` if `ancestor` is not on the chain.
#[cfg(windows)]
fn depth_to_ancestor(pid: Pid, ancestor: Pid, sys: &System) -> Option<u32> {
    if pid == ancestor {
        return Some(0);
    }
    let mut cur = pid;
    let mut d = 0u32;
    loop {
        let parent = sys.process(cur)?.parent()?;
        d += 1;
        if parent == ancestor {
            return Some(d);
        }
        cur = parent;
        if d > 4096 {
            return None;
        }
    }
}

/// Among console-attached processes, choose the one deepest under `root_shell_pid`.
#[cfg(windows)]
fn pick_deepest_descendant(root_shell_pid: u32, console_pids: &[u32]) -> Option<u32> {
    let root = Pid::from_u32(root_shell_pid);
    let pids: Vec<Pid> = console_pids.iter().copied().map(Pid::from_u32).collect();
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&pids),
        false,
        ProcessRefreshKind::everything(),
    );

    let mut best: Option<(u32, u64, u32)> = None;
    for &raw in console_pids {
        let pid = Pid::from_u32(raw);
        let Some(depth) = depth_to_ancestor(pid, root, &sys) else {
            continue;
        };
        let start = sys.process(pid).map(|p| p.start_time()).unwrap_or(0);
        let better = match best {
            None => true,
            Some((bd, bs, _)) => depth > bd || (depth == bd && start > bs),
        };
        if better {
            best = Some((depth, start, raw));
        }
    }
    best.map(|(_, _, id)| id)
}
