//! Native terminal bell; no decoder or audio assets are bundled.

#[cfg(windows)]
pub fn ring(path: &str) {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Media::Audio::{
        PlaySoundW, SND_ALIAS, SND_ASYNC, SND_FILENAME, SND_NODEFAULT, SND_SENTRY,
    };

    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    if last.is_some_and(|t| now.duration_since(t) < Duration::from_millis(200)) {
        return;
    }
    *last = Some(now);
    let flags = SND_ASYNC | SND_SENTRY | SND_NODEFAULT;
    // PlaySound owns file loading/playback; only local configuration supplies paths.
    if !path.is_empty() && !path.contains('\0') {
        let path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        if unsafe { PlaySoundW(path.as_ptr(), std::ptr::null_mut(), flags | SND_FILENAME) } != 0 {
            return;
        }
    }
    unsafe {
        PlaySoundW(
            windows_sys::w!("SystemHand"),
            std::ptr::null_mut(),
            flags | SND_ALIAS,
        )
    };
}

#[cfg(not(windows))]
pub fn ring(_path: &str) {}
