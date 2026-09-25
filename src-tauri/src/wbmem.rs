//! One-shot WebView memory reclamation after terminal lifecycle changes.
//!
//! These are best-effort DevTools hints, not a persistent policy change (unlike
//! `MemoryUsageTargetLevel::LOW`). `HeapProfiler.collectGarbage` forces a V8 GC on
//! the page target so discarded terminal buffers/objects are reclaimed immediately
//! instead of at the next natural collection; `Memory.simulatePressureNotification`
//! then nudges Chromium to trim caches. Both act on the whole WebView, which is a
//! single page/isolate, so there is no way to scope either to one terminal.
//!
//! `Memory.forciblyPurgeJavaScriptMemory` is deliberately not used: current
//! Chromium does not implement it in the browser Memory handler, and it would be
//! a whole-isolate purge anyway. The command returns `false` where unsupported so
//! the frontend stops asking.

#[cfg(windows)]
const HINTS: &[(&str, &str)] = &[
    ("HeapProfiler.collectGarbage", "{}"),
    (
        "Memory.simulatePressureNotification",
        r#"{"level":"moderate"}"#,
    ),
];

#[tauri::command]
pub async fn reclaim_wbmem(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let mut ok = false;
        let mut err = None;
        for (method, params) in HINTS {
            match hint(&window, method, params).await {
                Ok(()) => ok = true,
                Err(e) => err = Some(e),
            }
        }
        if ok {
            Ok(true)
        } else {
            Err(err.unwrap_or_else(|| "unsupported".to_string()))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        Ok(false)
    }
}

#[cfg(windows)]
async fn hint(
    window: &tauri::WebviewWindow,
    method: &'static str,
    params: &'static str,
) -> Result<(), String> {
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    window
        .with_webview(move |webview| {
            let result = (|| {
                let core = unsafe { webview.controller().CoreWebView2() }?;
                let cb_tx = tx.clone();
                let cb = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result, _response| {
                        let _ = cb_tx.try_send(result.map_err(|e| e.to_string()));
                        Ok(())
                    },
                ));
                let method = CoTaskMemPWSTR::from(method);
                let params = CoTaskMemPWSTR::from(params);
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
    rx.recv()
        .await
        .ok_or_else(|| "WebView closed before reclamation completed".to_string())?
}
