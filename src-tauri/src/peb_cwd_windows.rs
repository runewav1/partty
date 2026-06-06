//! Resolve a process current directory from the PEB (`RTL_USER_PROCESS_PARAMETERS.CurrentDirectory.DosPath`),
//! same approach as psutil on Windows and sysinfo’s internal implementation.
//! Layouts: `ntapi` (Apache-2.0/MIT). See also psutil `psutil/arch/windows/process_info.c` (BSD-3-Clause).

use ntapi::ntrtl::RTL_USER_PROCESS_PARAMETERS;
use ntapi::ntwow64::{PEB32, RTL_USER_PROCESS_PARAMETERS32};
use std::ffi::c_void;
use std::ffi::OsString;
use std::mem::{size_of, MaybeUninit};
use std::os::windows::ffi::OsStringExt;
use windows_sys::Wdk::System::Threading::{
    NtQueryInformationProcess, ProcessBasicInformation, ProcessWow64Information,
};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, NTSTATUS};
use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
use windows_sys::Win32::System::Threading::{
    OpenProcess, PEB, PROCESS_BASIC_INFORMATION, PROCESS_QUERY_INFORMATION,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
};

pub fn cwd_from_pid(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    let handle = unsafe { open_process_for_cwd(pid)? };
    let cwd = unsafe { cwd_from_handle(handle) };
    unsafe {
        CloseHandle(handle);
    }
    cwd
}

unsafe fn open_process_for_cwd(pid: u32) -> Option<HANDLE> {
    let full = PROCESS_QUERY_INFORMATION | PROCESS_VM_READ;
    let h = OpenProcess(full, 0, pid);
    if !h.is_null() {
        return Some(h);
    }
    let lim = PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ;
    let h = OpenProcess(lim, 0, pid);
    if !h.is_null() {
        return Some(h);
    }
    None
}

unsafe fn cwd_from_handle(handle: HANDLE) -> Option<String> {
    let mut wow_peb = MaybeUninit::<usize>::uninit();
    if NtQueryInformationProcess(
        handle,
        ProcessWow64Information,
        wow_peb.as_mut_ptr().cast(),
        size_of::<usize>() as u32,
        core::ptr::null_mut(),
    ) != status_success()
    {
        return None;
    }
    let wow_peb = wow_peb.assume_init();
    if wow_peb == 0 {
        cwd_native64(handle)
    } else {
        cwd_wow64(handle, wow_peb)
    }
}

unsafe fn cwd_native64(handle: HANDLE) -> Option<String> {
    let mut pbi = MaybeUninit::<PROCESS_BASIC_INFORMATION>::uninit();
    if NtQueryInformationProcess(
        handle,
        ProcessBasicInformation,
        pbi.as_mut_ptr().cast(),
        size_of::<PROCESS_BASIC_INFORMATION>() as u32,
        core::ptr::null_mut(),
    ) != status_success()
    {
        return None;
    }
    let pbi = pbi.assume_init();
    let peb_ptr = pbi.PebBaseAddress;
    if peb_ptr.is_null() {
        return None;
    }

    let mut peb = MaybeUninit::<PEB>::uninit();
    let mut br = 0usize;
    if ReadProcessMemory(
        handle,
        peb_ptr.cast(),
        peb.as_mut_ptr().cast(),
        size_of::<PEB>(),
        &mut br,
    ) == 0
    {
        return None;
    }
    let peb = peb.assume_init();
    let params_ptr = peb.ProcessParameters;
    if params_ptr.is_null() {
        return None;
    }

    let mut params = MaybeUninit::<RTL_USER_PROCESS_PARAMETERS>::uninit();
    let mut br = 0usize;
    if ReadProcessMemory(
        handle,
        params_ptr.cast(),
        params.as_mut_ptr().cast(),
        size_of::<RTL_USER_PROCESS_PARAMETERS>(),
        &mut br,
    ) == 0
    {
        return None;
    }
    let params = params.assume_init();
    cwd_from_nt_params(handle, &params)
}

unsafe fn cwd_wow64(handle: HANDLE, peb32_remote: usize) -> Option<String> {
    let mut peb32 = MaybeUninit::<PEB32>::uninit();
    let mut br = 0usize;
    if ReadProcessMemory(
        handle,
        peb32_remote as *const c_void,
        peb32.as_mut_ptr().cast(),
        size_of::<PEB32>(),
        &mut br,
    ) == 0
    {
        return None;
    }
    let peb32 = peb32.assume_init();
    let params_remote = peb32.ProcessParameters as usize;
    if params_remote == 0 {
        return None;
    }

    let mut params = MaybeUninit::<RTL_USER_PROCESS_PARAMETERS32>::uninit();
    let mut br = 0usize;
    if ReadProcessMemory(
        handle,
        params_remote as *const c_void,
        params.as_mut_ptr().cast(),
        size_of::<RTL_USER_PROCESS_PARAMETERS32>(),
        &mut br,
    ) == 0
    {
        return None;
    }
    let params = params.assume_init();
    cwd_from_nt_params32(handle, &params)
}

unsafe fn cwd_from_nt_params(
    handle: HANDLE,
    params: &RTL_USER_PROCESS_PARAMETERS,
) -> Option<String> {
    let us = &params.CurrentDirectory.DosPath;
    let len = us.Length as usize;
    let buf = us.Buffer;
    if buf.is_null() || len == 0 {
        return None;
    }
    read_remote_utf16_path(handle, buf.cast(), len)
}

unsafe fn cwd_from_nt_params32(
    handle: HANDLE,
    params: &RTL_USER_PROCESS_PARAMETERS32,
) -> Option<String> {
    let us = &params.CurrentDirectory.DosPath;
    let len = us.Length as usize;
    let buf = us.Buffer as usize;
    if buf == 0 || len == 0 {
        return None;
    }
    read_remote_utf16_path(handle, buf as *const c_void, len)
}

unsafe fn read_remote_utf16_path(
    handle: HANDLE,
    remote: *const c_void,
    byte_len: usize,
) -> Option<String> {
    if remote.is_null() || byte_len == 0 || byte_len % 2 != 0 {
        return None;
    }
    let n_chars = byte_len / 2;
    let mut buf = vec![0u16; n_chars];
    let mut read = 0usize;
    if ReadProcessMemory(handle, remote, buf.as_mut_ptr().cast(), byte_len, &mut read) == 0 {
        return None;
    }
    if read != byte_len {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let slice = &buf[..end];
    if slice.is_empty() {
        return None;
    }
    let os = OsString::from_wide(slice);
    let s = os.to_string_lossy();
    if s.is_empty() {
        return None;
    }
    Some(s.into_owned())
}

#[inline]
fn status_success() -> NTSTATUS {
    0
}
