//! Hide console windows for helper processes (PATH probes, git, cmd wrappers).
//! GUI apps on Windows otherwise flash a console for each `std::process::Command` without this flag.

use std::os::windows::process::CommandExt;

/// `CREATE_NO_WINDOW` — child process gets no console window (Win32).
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn hide_console_window(cmd: &mut std::process::Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}
