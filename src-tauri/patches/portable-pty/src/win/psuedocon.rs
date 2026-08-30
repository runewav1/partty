use super::WinChild;
use crate::cmdbuilder::CommandBuilder;
use crate::win::procthreadattr::ProcThreadAttributeList;
use anyhow::{bail, ensure, Error};
use filedescriptor::{FileDescriptor, OwnedHandle};
use std::ffi::OsString;
use std::io::Error as IoError;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::{mem, ptr};
use windows_sys::core::HRESULT;
use windows_sys::Win32::Foundation::{HANDLE, INVALID_HANDLE_VALUE, S_OK};
use windows_sys::Win32::System::Console::COORD;
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
use windows_sys::Win32::System::Threading::{
    CreateProcessW, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, PROCESS_INFORMATION,
    STARTF_USESTDHANDLES, STARTUPINFOEXW,
};

// `HPCON` intentionally mirrors the Windows SDK typedef name.
#[allow(clippy::upper_case_acronyms)]
pub type HPCON = HANDLE;

pub const PSUEDOCONSOLE_INHERIT_CURSOR: u32 = 0x1;
pub const PSEUDOCONSOLE_RESIZE_QUIRK: u32 = 0x2;
pub const PSEUDOCONSOLE_WIN32_INPUT_MODE: u32 = 0x4;
#[allow(dead_code)]
pub const PSEUDOCONSOLE_PASSTHROUGH_MODE: u32 = 0x8;

/// ConPTY entry points loaded dynamically from a `conpty.dll` (kernel32 by
/// default, or a sideloaded Windows Terminal host).
struct ConPtyFuncs {
    create: unsafe extern "system" fn(COORD, HANDLE, HANDLE, u32, *mut HPCON) -> HRESULT,
    resize: unsafe extern "system" fn(HPCON, COORD) -> HRESULT,
    close: unsafe extern "system" fn(HPCON),
}

impl ConPtyFuncs {
    /// Load the entry points from `path`. The module is intentionally never
    /// unloaded (matches the previous shared_library wrapper).
    fn open(path: &Path) -> Option<ConPtyFuncs> {
        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let module = unsafe { LoadLibraryW(wide.as_ptr()) };
        if module.is_null() {
            return None;
        }
        let get = |name: &[u8]| unsafe { GetProcAddress(module, name.as_ptr()) };
        // SAFETY: transmuting between function pointer types of the same
        // size; the exported signatures are fixed by the ConPTY API.
        let create = unsafe {
            std::mem::transmute::<
                unsafe extern "system" fn() -> isize,
                unsafe extern "system" fn(COORD, HANDLE, HANDLE, u32, *mut HPCON) -> HRESULT,
            >(get(b"CreatePseudoConsole\0")?)
        };
        let resize = unsafe {
            std::mem::transmute::<
                unsafe extern "system" fn() -> isize,
                unsafe extern "system" fn(HPCON, COORD) -> HRESULT,
            >(get(b"ResizePseudoConsole\0")?)
        };
        let close = unsafe {
            std::mem::transmute::<
                unsafe extern "system" fn() -> isize,
                unsafe extern "system" fn(HPCON),
            >(get(b"ClosePseudoConsole\0")?)
        };
        Some(ConPtyFuncs {
            create,
            resize,
            close,
        })
    }
}

/// Opt-in sideloading of a `conpty.dll` / `OpenConsole.exe` host (the
/// Windows Terminal approach), which forwards DCS/APC/unknown sequences the
/// inbox conhost filters out. Set before the first PTY is spawned; the host
/// is pinned at first use.
static SIDELOAD_OPENCONSOLE: AtomicBool = AtomicBool::new(false);

/// Enable (or disable) preferring a sideloaded conpty.dll host.
pub fn set_sideload_openconsole(enabled: bool) {
    SIDELOAD_OPENCONSOLE.store(enabled, Ordering::SeqCst);
}

fn load_conpty() -> ConPtyFuncs {
    // If the kernel doesn't export these functions then their system is
    // too old and we cannot run.
    let kernel = ConPtyFuncs::open(Path::new("kernel32.dll")).expect(
        "this system does not support conpty.  Windows 10 October 2018 or newer is required",
    );

    // Sideloading is opt-in: only when enabled do we prefer a conpty.dll
    // (which hosts its own OpenConsole.exe) deployed alongside the app.
    if !SIDELOAD_OPENCONSOLE.load(Ordering::SeqCst) {
        return kernel;
    }

    // Look next to the executable first (works regardless of CWD), then CWD.
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("conpty.dll"));
        }
    }
    candidates.push(PathBuf::from("conpty.dll"));

    for candidate in candidates {
        if let Some(sideloaded) = ConPtyFuncs::open(&candidate) {
            return sideloaded;
        }
    }
    kernel
}

static CONPTY: OnceLock<ConPtyFuncs> = OnceLock::new();

fn conpty() -> &'static ConPtyFuncs {
    CONPTY.get_or_init(load_conpty)
}

pub struct PsuedoCon {
    con: HPCON,
}

unsafe impl Send for PsuedoCon {}
unsafe impl Sync for PsuedoCon {}

impl Drop for PsuedoCon {
    fn drop(&mut self) {
        unsafe { (conpty().close)(self.con) };
    }
}

impl PsuedoCon {
    pub fn new(size: COORD, input: FileDescriptor, output: FileDescriptor) -> Result<Self, Error> {
        let mut con: HPCON = INVALID_HANDLE_VALUE;
        let result = unsafe {
            (conpty().create)(
                size,
                input.as_raw_handle(),
                output.as_raw_handle(),
                PSUEDOCONSOLE_INHERIT_CURSOR
                    | PSEUDOCONSOLE_RESIZE_QUIRK
                    | PSEUDOCONSOLE_WIN32_INPUT_MODE
                    | PSEUDOCONSOLE_PASSTHROUGH_MODE,
                &mut con,
            )
        };
        ensure!(
            result == S_OK,
            "failed to create psuedo console: HRESULT {}",
            result
        );
        Ok(Self { con })
    }

    pub fn resize(&self, size: COORD) -> Result<(), Error> {
        let result = unsafe { (conpty().resize)(self.con, size) };
        ensure!(
            result == S_OK,
            "failed to resize console to {}x{}: HRESULT: {}",
            size.X,
            size.Y,
            result
        );
        Ok(())
    }

    pub fn spawn_command(&self, cmd: CommandBuilder) -> anyhow::Result<WinChild> {
        let mut si: STARTUPINFOEXW = unsafe { mem::zeroed() };
        si.StartupInfo.cb = mem::size_of::<STARTUPINFOEXW>() as u32;
        // Explicitly set the stdio handles as invalid handles otherwise
        // we can end up with a weird state where the spawned process can
        // inherit the explicitly redirected output handles from its parent.
        // For example, when daemonizing wezterm-mux-server, the stdio handles
        // are redirected to a log file and the spawned process would end up
        // writing its output there instead of to the pty we just created.
        si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        si.StartupInfo.hStdInput = INVALID_HANDLE_VALUE;
        si.StartupInfo.hStdOutput = INVALID_HANDLE_VALUE;
        si.StartupInfo.hStdError = INVALID_HANDLE_VALUE;

        let mut attrs = ProcThreadAttributeList::with_capacity(1)?;
        attrs.set_pty(self.con)?;
        si.lpAttributeList = attrs.as_mut_ptr();

        let mut pi: PROCESS_INFORMATION = unsafe { mem::zeroed() };

        let (mut exe, mut cmdline) = cmd.cmdline()?;
        let cmd_os = OsString::from_wide(&cmdline);

        let cwd = cmd.current_directory();

        let res = unsafe {
            CreateProcessW(
                exe.as_mut_slice().as_mut_ptr(),
                cmdline.as_mut_slice().as_mut_ptr(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
                cmd.environment_block().as_mut_slice().as_mut_ptr() as *const _,
                cwd.as_ref()
                    .map(|c| c.as_slice().as_ptr())
                    .unwrap_or(ptr::null()),
                &si.StartupInfo,
                &mut pi,
            )
        };
        if res == 0 {
            let err = IoError::last_os_error();
            let msg = format!(
                "CreateProcessW `{:?}` in cwd `{:?}` failed: {}",
                cmd_os,
                cwd.as_ref().map(|c| OsString::from_wide(c)),
                err
            );
            log::error!("{}", msg);
            bail!("{}", msg);
        }

        // Make sure we close out the thread handle so we don't leak it;
        // we do this simply by making it owned
        let _main_thread = unsafe { OwnedHandle::from_raw_handle(pi.hThread as _) };
        let proc = unsafe { OwnedHandle::from_raw_handle(pi.hProcess as _) };

        Ok(WinChild {
            proc: Mutex::new(proc),
        })
    }
}
