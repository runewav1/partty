use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeybindsFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub unbind: Vec<String>,
    #[serde(default)]
    pub bind: HashMap<String, String>,
}

fn default_version() -> u32 {
    1
}

fn default_binds_map() -> HashMap<String, String> {
    DEFAULTS
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

const DEFAULTS: &[(&str, &str)] = &[
    ("pane.split_down", "Alt+H"),
    ("pane.split_right", "Alt+V"),
    ("pane.close", "Ctrl+Shift+W"),
    ("pane.float_toggle", "Ctrl+Shift+O"),
    ("pane.focus_left", "Ctrl+ArrowLeft"),
    ("pane.focus_right", "Ctrl+ArrowRight"),
    ("pane.focus_up", "Ctrl+ArrowUp"),
    ("pane.focus_down", "Ctrl+ArrowDown"),
    ("pane.swap_left", "Ctrl+Shift+ArrowLeft"),
    ("pane.swap_right", "Ctrl+Shift+ArrowRight"),
    ("pane.swap_up", "Ctrl+Shift+ArrowUp"),
    ("pane.swap_down", "Ctrl+Shift+ArrowDown"),
    ("pane.move_to_tab", "Ctrl+Shift+{n}"),
    ("tab.switch", "Alt+{n}"),
    ("window.toggle", "Alt+Shift+T"),
    ("window.move_next_monitor", "Alt+Shift+ArrowRight"),
    ("window.move_prev_monitor", "Alt+Shift+ArrowLeft"),
    ("window.maximize", "Alt+Shift+ArrowUp"),
    ("window.restore", "Alt+Shift+ArrowDown"),
    ("settings.open", "Ctrl+,"),
    ("palette.open", "Ctrl+Shift+P"),
    ("palette.chord", "Ctrl+Shift+P"),
    ("help.toggle", "Ctrl+Shift+/"),
    ("file_tree.toggle", "Ctrl+Shift+E"),
    ("focus.file_tree", "Alt+ArrowLeft"),
    ("focus.terminal", "Alt+ArrowRight"),
    ("focus.pane_up", "Alt+ArrowUp"),
    ("focus.pane_down", "Alt+ArrowDown"),
    ("terminal.newline", "Shift+Enter"),
    ("terminal.copy", "Ctrl+C"),
    ("dev.toggle", "Ctrl+Shift+D"),
];

pub fn keybinds_path() -> Option<std::path::PathBuf> {
    let dir = super::prefs::ensure_config_dir()?;
    Some(dir.join("keybinds.toml"))
}

pub fn load_keybinds() -> KeybindsFile {
    let Some(path) = keybinds_path() else {
        return KeybindsFile::default();
    };
    let Ok(s) = fs::read_to_string(&path) else {
        // No file → pure defaults
        return KeybindsFile::default();
    };
    let mut kb: KeybindsFile = toml::from_str(&s).unwrap_or_default();

    let defaults = default_binds_map();
    for (action, binding) in defaults {
        kb.bind.entry(action).or_insert(binding);
    }
    for action in &kb.unbind {
        kb.bind.remove(action);
    }
    kb
}

pub fn save_keybinds(kb: &KeybindsFile) {
    let Some(path) = keybinds_path() else {
        return;
    };
    let defaults = default_binds_map();
    let mut overrides: HashMap<String, String> = HashMap::new();
    for (action, binding) in &kb.bind {
        if defaults.get(action) != Some(binding) {
            overrides.insert(action.clone(), binding.clone());
        }
    }
    let has_overrides = !overrides.is_empty() || !kb.unbind.is_empty();
    if !has_overrides {
        let _ = fs::remove_file(&path);
        return;
    }
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let delta = KeybindsFile {
        version: kb.version,
        unbind: kb.unbind.clone(),
        bind: overrides,
    };
    if let Ok(bytes) = toml::to_string_pretty(&delta) {
        let _ = fs::write(path, bytes);
    }
}

impl Default for KeybindsFile {
    fn default() -> Self {
        Self {
            version: 1,
            unbind: Vec::new(),
            bind: default_binds_map(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeybindsSnapshot {
    pub bind: HashMap<String, String>,
}

impl From<&KeybindsFile> for KeybindsSnapshot {
    fn from(kb: &KeybindsFile) -> Self {
        let mut bind = kb.bind.clone();
        for action in &kb.unbind {
            bind.remove(action);
        }
        Self { bind }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_keybinds() -> KeybindsSnapshot {
    let kb = load_keybinds();
    KeybindsSnapshot::from(&kb)
}

#[tauri::command]
pub fn set_keybind(action: String, binding: String) -> Result<(), String> {
    if action.is_empty() {
        return Err("action is required".into());
    }
    if !DEFAULTS.iter().any(|(a, _)| *a == action) {
        return Err(format!("unknown action: {action}"));
    }
    let binding = binding.trim().to_string();
    let mut kb = load_keybinds();
    if binding.is_empty() {
        kb.bind.remove(&action);
        kb.unbind.push(action);
    } else {
        kb.unbind.retain(|a| a != &action);
        kb.bind.insert(action, binding);
    }
    save_keybinds(&kb);
    Ok(())
}

#[tauri::command]
pub fn reset_keybinds() -> Result<(), String> {
    if let Some(path) = keybinds_path() {
        let _ = fs::remove_file(&path);
    }
    Ok(())
}
