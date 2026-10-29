//! Per-session PTY output rings in WebView2 shared memory
//! (`CreateSharedBuffer` / `PostSharedBufferToScript`).
//!
//! Layout: the JS read position (a u32 written with `Atomics.store`) at offset
//! 0, then a power-of-two data region at `RING_DATA_OFFSET`, a cache line away
//! from that hot word. Positions are free-running u32 byte counters;
//! `pos & (len - 1)` is the data offset.
//!
//! Rust tells JS how far it has written with a `PostWebMessageAsJson`
//! notification. That message crosses processes, so the data writes are
//! visible before JS reads them; JS never polls shared memory.

use parking_lot::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use webview2_com::CoTaskMemPWSTR;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE, ICoreWebView2_2, ICoreWebView2_17,
    ICoreWebView2Controller, ICoreWebView2Environment12,
};
use windows_core::Interface;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::System::Memory::{
    FILE_MAP_ALL_ACCESS, MEMORY_MAPPED_VIEW_ADDRESS, MapViewOfFile, UnmapViewOfFile,
};

const RING_DATA_BYTES: u32 = 2 * 1024 * 1024;
const RING_DATA_OFFSET: usize = 64;
const RING_TOTAL_BYTES: usize = RING_DATA_OFFSET + RING_DATA_BYTES as usize;

static NEXT_RING_ID: AtomicU32 = AtomicU32::new(1);

pub struct SharedRing {
    id: u32,
    view: MEMORY_MAPPED_VIEW_ADDRESS,
    data_len: u32,
    /// Only the session's emitter thread writes; atomic just to be `Sync`.
    write_pos: AtomicU32,
}

// SAFETY: the view stays mapped until drop, and the mapping is process-wide.
// Only the emitter writes the data region; the read word is accessed
// atomically.
unsafe impl Send for SharedRing {}
unsafe impl Sync for SharedRing {}

impl SharedRing {
    /// Map `section` (a file-mapping handle) as a ring with `data_len` bytes
    /// of data. The view keeps the section alive after its handle is closed.
    fn map(id: u32, section: HANDLE, data_len: u32) -> windows_core::Result<Self> {
        debug_assert!(data_len.is_power_of_two());
        let total = RING_DATA_OFFSET + data_len as usize;
        let view = unsafe { MapViewOfFile(section, FILE_MAP_ALL_ACCESS, 0, 0, total) };
        if view.Value.is_null() {
            return Err(windows_core::Error::from_thread());
        }
        Ok(Self {
            id,
            view,
            data_len,
            write_pos: AtomicU32::new(0),
        })
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    /// Copy as much of `bytes` as fits behind JS's acknowledged read position.
    /// Returns the byte count written and the new write position.
    pub fn write(&self, bytes: &[u8]) -> (usize, u32) {
        let base = self.view.Value.cast::<u8>();
        // SAFETY: the view is page-aligned and outlives `self`.
        let read = unsafe { AtomicU32::from_ptr(base.cast()) }.load(Ordering::Acquire);
        let write = self.write_pos.load(Ordering::Relaxed);
        // A read position past the write position is corrupt; treat it as full
        // until JS resynchronises rather than overwriting unread data.
        let free = self.data_len.saturating_sub(write.wrapping_sub(read)) as usize;
        let n = bytes.len().min(free);
        if n == 0 {
            return (0, write);
        }
        let start = (write & (self.data_len - 1)) as usize;
        let first = n.min(self.data_len as usize - start);
        // SAFETY: `start + first <= data_len` and `n - first <= start`, so both
        // copies stay inside the data region.
        unsafe {
            let data = base.add(RING_DATA_OFFSET);
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), data.add(start), first);
            std::ptr::copy_nonoverlapping(bytes.as_ptr().add(first), data, n - first);
        }
        let next = write.wrapping_add(n as u32);
        self.write_pos.store(next, Ordering::Relaxed);
        (n, next)
    }
}

impl Drop for SharedRing {
    fn drop(&mut self) {
        unsafe { UnmapViewOfFile(self.view) };
    }
}

/// Create a ring for `session_id` and hand it to the main webview's script.
/// Blocks on the UI thread, so it must never be called from it.
pub fn create(app: &AppHandle, session_id: &str) -> Result<Arc<SharedRing>, String> {
    let win = app
        .get_webview_window("main")
        .ok_or("main webview is gone")?;
    let id = NEXT_RING_ID.fetch_add(1, Ordering::Relaxed);
    let announcement = serde_json::json!({
        "parttyRing": id,
        "sessionId": session_id,
        "dataOffset": RING_DATA_OFFSET,
        "dataLength": RING_DATA_BYTES,
    })
    .to_string();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    win.with_webview(move |webview| {
        let _ = tx.send(create_on_ui(&webview.controller(), id, &announcement));
    })
    .map_err(|e| e.to_string())?;
    match rx.recv_timeout(Duration::from_secs(2)) {
        Ok(ring) => ring.map(Arc::new).map_err(|e| e.to_string()),
        Err(_) => Err("timed out creating the shared output ring".into()),
    }
}

fn create_on_ui(
    controller: &ICoreWebView2Controller,
    id: u32,
    announcement: &str,
) -> windows_core::Result<SharedRing> {
    unsafe {
        let core = controller.CoreWebView2()?;
        let env = core
            .cast::<ICoreWebView2_2>()?
            .Environment()?
            .cast::<ICoreWebView2Environment12>()?;
        let buffer = env.CreateSharedBuffer(RING_TOTAL_BYTES as u64)?;
        let mut section: HANDLE = std::ptr::null_mut();
        let ring = buffer
            .FileMappingHandle((&mut section as *mut HANDLE).cast())
            .and_then(|()| SharedRing::map(id, section, RING_DATA_BYTES))
            .and_then(|ring| {
                let announcement = CoTaskMemPWSTR::from(announcement);
                core.cast::<ICoreWebView2_17>()?.PostSharedBufferToScript(
                    &buffer,
                    COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
                    *announcement.as_ref().as_pcwstr(),
                )?;
                Ok(ring)
            });
        let _ = buffer.Close();
        ring
    }
}

/// Ring positions and closures awaiting the next UI-thread flush. Positions
/// keep first-insertion order so a replaced ring's final position reaches JS
/// before its successor's first one.
#[derive(Default)]
struct Pending {
    positions: Vec<(u32, u32)>,
    closed: Vec<u32>,
}

static PENDING: Mutex<Pending> = Mutex::new(Pending {
    positions: Vec::new(),
    closed: Vec::new(),
});
static FLUSH_SCHEDULED: AtomicBool = AtomicBool::new(false);

/// Tell JS that `ring_id` holds data up to `write_pos`. Coalesced across
/// sessions into one web message per UI-thread hop.
pub fn notify(app: &AppHandle, ring_id: u32, write_pos: u32) {
    {
        let mut pending = PENDING.lock();
        match pending.positions.iter_mut().find(|(id, _)| *id == ring_id) {
            Some(entry) => entry.1 = write_pos,
            None => pending.positions.push((ring_id, write_pos)),
        }
    }
    schedule_flush(app);
}

/// Tell JS that no more data will arrive on `ring_id` (session ended).
pub fn close(app: &AppHandle, ring_id: u32) {
    PENDING.lock().closed.push(ring_id);
    schedule_flush(app);
}

fn schedule_flush(app: &AppHandle) {
    if FLUSH_SCHEDULED.swap(true, Ordering::AcqRel) {
        return;
    }
    let posted = app.get_webview_window("main").is_some_and(|win| {
        win.with_webview(|webview| {
            FLUSH_SCHEDULED.store(false, Ordering::Release);
            let pending = std::mem::take(&mut *PENDING.lock());
            if pending.positions.is_empty() && pending.closed.is_empty() {
                return;
            }
            let message = serde_json::json!({
                "parttyRings": pending.positions,
                "parttyRingsClosed": pending.closed,
            })
            .to_string();
            let message = CoTaskMemPWSTR::from(message.as_str());
            unsafe {
                if let Ok(core) = webview.controller().CoreWebView2() {
                    let _ = core.PostWebMessageAsJson(*message.as_ref().as_pcwstr());
                }
            }
        })
        .is_ok()
    });
    if !posted {
        // No webview to deliver to: its rings died with it.
        *PENDING.lock() = Pending::default();
        FLUSH_SCHEDULED.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Memory::{CreateFileMappingW, PAGE_READWRITE};

    fn ring(data_len: u32) -> SharedRing {
        let total = (RING_DATA_OFFSET + data_len as usize) as u32;
        unsafe {
            let section = CreateFileMappingW(
                INVALID_HANDLE_VALUE,
                std::ptr::null(),
                PAGE_READWRITE,
                0,
                total,
                std::ptr::null(),
            );
            assert!(!section.is_null());
            let ring = SharedRing::map(0, section, data_len).unwrap();
            CloseHandle(section);
            ring
        }
    }

    fn set_read(ring: &SharedRing, pos: u32) {
        unsafe { AtomicU32::from_ptr(ring.view.Value.cast()) }.store(pos, Ordering::Release);
    }

    fn data(ring: &SharedRing) -> &[u8] {
        unsafe {
            std::slice::from_raw_parts(
                ring.view.Value.cast::<u8>().add(RING_DATA_OFFSET),
                ring.data_len as usize,
            )
        }
    }

    #[test]
    fn write_stops_at_unacknowledged_data() {
        let ring = ring(16);
        assert_eq!(ring.write(&[1; 10]), (10, 10));
        assert_eq!(ring.write(&[2; 10]), (6, 16));
        assert_eq!(ring.write(&[3; 4]), (0, 16));
        set_read(&ring, 4);
        assert_eq!(ring.write(&[3; 10]), (4, 20));
    }

    #[test]
    fn write_wraps_around_the_data_region() {
        let ring = ring(8);
        ring.write(&[0; 6]);
        set_read(&ring, 6);
        assert_eq!(ring.write(&[1, 2, 3, 4, 5]), (5, 11));
        assert_eq!(data(&ring), &[3, 4, 5, 0, 0, 0, 1, 2]);
    }

    #[test]
    fn positions_survive_u32_wraparound() {
        let ring = ring(8);
        ring.write_pos.store(u32::MAX - 1, Ordering::Relaxed);
        set_read(&ring, u32::MAX - 1);
        assert_eq!(ring.write(&[9; 4]), (4, 2));
        assert_eq!(ring.write(&[9; 8]), (4, 6));
    }

    #[test]
    fn corrupt_read_position_is_treated_as_full() {
        let ring = ring(8);
        ring.write(&[1; 2]);
        set_read(&ring, 5);
        assert_eq!(ring.write(&[1; 4]), (0, 2));
    }
}
