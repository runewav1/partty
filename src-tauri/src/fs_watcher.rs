use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Clone, serde::Serialize)]
pub struct FsChangeEvent {
    pub paths: Vec<String>,
}

pub struct FsWatcher {
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
    watched_path: PathBuf,
}

impl FsWatcher {
    pub fn watched_path(&self) -> &PathBuf {
        &self.watched_path
    }
}

pub type WatcherHandle = Arc<Mutex<Option<FsWatcher>>>;

pub fn create_watcher_handle() -> WatcherHandle {
    Arc::new(Mutex::new(None))
}

pub fn start_watching(
    handle: &WatcherHandle,
    app: AppHandle,
    path: String,
) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err("path must be an absolute directory".into());
    }

    {
        let guard = handle.lock();
        if let Some(w) = guard.as_ref() {
            if w.watched_path == dir {
                return Ok(());
            }
        }
    }

    let app_clone = app.clone();
    let debouncer = new_debouncer(Duration::from_millis(300), move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
        match res {
            Ok(events) => {
                let paths: Vec<String> = events
                    .iter()
                    .filter(|e| e.kind == DebouncedEventKind::Any)
                    .map(|e| e.path.to_string_lossy().into_owned())
                    .collect();
                if !paths.is_empty() {
                    let _ = app_clone.emit("fs-changed", FsChangeEvent { paths });
                }
            }
            Err(e) => {
                eprintln!("fs watcher error: {e}");
            }
        }
    }).map_err(|e| e.to_string())?;

    let mut d = debouncer;
    d.watcher()
        .watch(&dir, notify::RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let watcher = FsWatcher {
        _debouncer: d,
        watched_path: dir,
    };
    *handle.lock() = Some(watcher);
    Ok(())
}

pub fn stop_watching(handle: &WatcherHandle) {
    *handle.lock() = None;
}
