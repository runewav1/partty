//! Best-effort reclamation for the main WebView. A retained, hidden WebView
//! can trim caches without suspending scripts (the PTY reader must keep
//! running). A WebView about to be destroyed needs neither policy nor GC.

use tauri::WebviewWindow;

#[cfg(windows)]
mod windows {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::time::{Duration, Instant};
    use tauri::WebviewWindow;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        ICoreWebView2_19,
    };
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};
    use windows_core::Interface;

    const HIDDEN_SETTLE: Duration = Duration::from_secs(5);
    const GC_GAP: Duration = Duration::from_secs(30);
    const GC_TIMEOUT: Duration = Duration::from_secs(5);

    // Only the main window uses these. The epoch invalidates delayed work
    // across rapid hide/show and WebView destruction.
    static EPOCH: AtomicU64 = AtomicU64::new(0);
    static LOW: AtomicBool = AtomicBool::new(false);
    static LAST_GC: parking_lot::Mutex<Option<Instant>> = parking_lot::Mutex::new(None);

    fn epoch() -> u64 {
        EPOCH.load(Ordering::Relaxed)
    }

    pub(super) fn hidden(window: &WebviewWindow, retained: bool) {
        let generation = EPOCH.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        if !retained {
            return;
        }
        let window = window.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(HIDDEN_SETTLE).await;
            if epoch() != generation {
                return;
            }
            let target = window.clone();
            let _ = window.with_webview(move |webview| {
                if epoch() != generation
                    || LOW.load(Ordering::Relaxed)
                    || !matches!(target.is_visible(), Ok(false))
                {
                    return;
                }
                // Older runtimes may not expose ICoreWebView2_19. Leave them
                // on their default policy rather than force GC as a fallback.
                let result = unsafe {
                    webview.controller().CoreWebView2().and_then(|core| {
                        core.cast::<ICoreWebView2_19>()?
                            .SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW)
                    })
                };
                if result.is_ok() {
                    LOW.store(true, Ordering::Relaxed);
                }
            });
        });
    }

    pub(super) fn showing(window: &WebviewWindow) {
        EPOCH.fetch_add(1, Ordering::Relaxed);
        // No COM work on the show path unless LOW was actually set. Check
        // on the UI thread, ordered after any already-running LOW transition.
        let _ = window.with_webview(|webview| {
            if !LOW.load(Ordering::Relaxed) {
                return;
            }
            let result = unsafe {
                webview.controller().CoreWebView2().and_then(|core| {
                    core.cast::<ICoreWebView2_19>()?
                        .SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL)
                })
            };
            if result.is_ok() {
                LOW.store(false, Ordering::Relaxed);
            }
        });
    }

    pub(super) async fn reclaim(window: &WebviewWindow) -> Result<bool, String> {
        let generation = epoch();
        if window.label() != "main" {
            return Ok(true);
        }
        let target = window.clone();
        let (tx, mut rx) = tauri::async_runtime::channel(1);
        window
            .with_webview(move |webview| {
                if tx.is_closed()
                    || epoch() != generation
                    || !matches!(target.is_visible(), Ok(true))
                    || !matches!(target.is_minimized(), Ok(false))
                {
                    return;
                }
                {
                    let mut last = LAST_GC.lock();
                    let now = Instant::now();
                    if last.is_some_and(|last| now.duration_since(last) < GC_GAP) {
                        let _ = tx.try_send(Ok(()));
                        return;
                    }
                    *last = Some(now);
                }
                let result = (|| {
                    let core = unsafe { webview.controller().CoreWebView2() }?;
                    let cb_tx = tx.clone();
                    let cb = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        move |result, _response| {
                            let _ = cb_tx.try_send(result.map_err(|e| e.to_string()));
                            Ok(())
                        },
                    ));
                    let method = CoTaskMemPWSTR::from("HeapProfiler.collectGarbage");
                    let params = CoTaskMemPWSTR::from("{}");
                    unsafe {
                        core.CallDevToolsProtocolMethod(
                            *method.as_ref().as_pcwstr(),
                            *params.as_ref().as_pcwstr(),
                            &cb,
                        )
                    }
                })();
                if let Err(e) = result {
                    let _ = tx.try_send(Err(e.to_string()));
                }
            })
            .map_err(|e| e.to_string())?;
        // A closing or unresponsive renderer must not wedge the scheduler.
        match tokio::time::timeout(GC_TIMEOUT, rx.recv()).await {
            Ok(Some(result)) => result.map(|()| true),
            Ok(None) => Ok(true), // The requested lifecycle changed before dispatch.
            Err(_) => Err("WebView memory reclamation timed out".into()),
        }
    }
}

pub fn hidden(_window: &WebviewWindow, _retained: bool) {
    #[cfg(windows)]
    windows::hidden(_window, _retained);
}

pub fn showing(_window: &WebviewWindow) {
    #[cfg(windows)]
    windows::showing(_window);
}

#[tauri::command]
pub async fn reclaim_wbmem(window: WebviewWindow) -> Result<bool, String> {
    #[cfg(windows)]
    return windows::reclaim(&window).await;
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(false)
    }
}
