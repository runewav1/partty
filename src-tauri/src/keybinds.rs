use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

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
    ("pane_split_down", "Alt+H"),
    ("pane_split_right", "Alt+V"),
    ("profile_split_down", "Alt+Shift+H"),
    ("profile_split_right", "Alt+Shift+V"),
    ("pane_close", "Ctrl+Shift+W"),
    ("pane_float_toggle", "Ctrl+Shift+O"),
    ("pane_float_new", "Alt+O"),
    ("profile_float_new", "Alt+Shift+O"),
    ("pane_float_follow", "Alt+F"),
    ("pane_focus_left", "Ctrl+ArrowLeft"),
    ("pane_focus_right", "Ctrl+ArrowRight"),
    ("pane_focus_up", "Ctrl+ArrowUp"),
    ("pane_focus_down", "Ctrl+ArrowDown"),
    ("pane_swap_left", "Ctrl+Shift+ArrowLeft"),
    ("pane_swap_right", "Ctrl+Shift+ArrowRight"),
    ("pane_swap_up", "Ctrl+Shift+ArrowUp"),
    ("pane_swap_down", "Ctrl+Shift+ArrowDown"),
    ("pane_move_to_tab", "Ctrl+Shift+{n}"),
    ("tab_switch", "Alt+{n}"),
    ("window_toggle", "Alt+Shift+T"),
    ("window_move_next_monitor", "Alt+Shift+ArrowRight"),
    ("window_move_prev_monitor", "Alt+Shift+ArrowLeft"),
    ("window_maximize", "Alt+Shift+ArrowUp"),
    ("window_restore", "Alt+Shift+ArrowDown"),
    ("settings_open", "Ctrl+,"),
    ("palette_open", "Ctrl+Shift+P"),
    ("palette_chord", "Ctrl+Shift+P"),
    ("help_toggle", "Ctrl+Shift+/"),
    ("focus_terminal", "Alt+ArrowRight"),
    ("focus_pane_up", "Alt+ArrowUp"),
    ("focus_pane_down", "Alt+ArrowDown"),
    ("terminal_newline", "Shift+Enter"),
    ("terminal_copy", "Ctrl+C"),
    ("terminal_paste", "Ctrl+V"),
    ("dev_toggle", "Ctrl+Shift+D"),
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
        return KeybindsFile::default();
    };
    let mut kb: KeybindsFile = toml::from_str::<KeybindsFile>(&s).unwrap_or_default();
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

/// If `key` is a character that requires Shift on a US keyboard (uppercase
/// letters and symbols like > ? !), returns (true, base_key). Otherwise
/// returns (false, key).
fn resolve_shifted_char(key: &str) -> (bool, String) {
    if key.len() == 1 {
        let c = key.chars().next().unwrap();
        match c {
            '>' => return (true, ".".into()),
            '<' => return (true, ",".into()),
            '?' => return (true, "/".into()),
            ':' => return (true, ";".into()),
            '"' => return (true, "'".into()),
            '{' => return (true, "[".into()),
            '}' => return (true, "]".into()),
            '|' => return (true, "\\".into()),
            '~' => return (true, "`".into()),
            '!' => return (true, "1".into()),
            '@' => return (true, "2".into()),
            '#' => return (true, "3".into()),
            '$' => return (true, "4".into()),
            '%' => return (true, "5".into()),
            '^' => return (true, "6".into()),
            '&' => return (true, "7".into()),
            '*' => return (true, "8".into()),
            '(' => return (true, "9".into()),
            ')' => return (true, "0".into()),
            '_' => return (true, "-".into()),
            '+' => return (true, "=".into()),
            _ => {}
        }
    }
    (false, key.to_string())
}

/// Parse a keybind string ("Ctrl+Shift+T") into a Tauri global-shortcut (Modifiers, Code).
/// Returns the default Alt+Shift+T if the binding is empty or unsupported.
pub fn parse_global_shortcut(binding: &str) -> (Modifiers, Code) {
    let trimmed = binding.trim();
    if trimmed.is_empty() {
        return (Modifiers::ALT | Modifiers::SHIFT, Code::KeyT);
    }

    let mut mods = Modifiers::empty();
    let lower = trimmed.to_lowercase();
    let mut rem: &str = &lower;
    let mut consumed = 0usize;

    loop {
        if let Some(r) = rem.strip_prefix("ctrl+") {
            mods |= Modifiers::CONTROL;
            consumed += 5;
            rem = r;
        } else if let Some(r) = rem.strip_prefix("alt+") {
            mods |= Modifiers::ALT;
            consumed += 4;
            rem = r;
        } else if let Some(r) = rem.strip_prefix("shift+") {
            mods |= Modifiers::SHIFT;
            consumed += 6;
            rem = r;
        } else if let Some(r) = rem.strip_prefix("meta+") {
            mods |= Modifiers::SUPER;
            consumed += 5;
            rem = r;
        } else {
            break;
        }
    }

    let key_original = trimmed[consumed..].trim();
    let key_lower = key_original.to_lowercase();

    let (shifted, base_key) = resolve_shifted_char(&key_lower);
    let lookup: &str = if shifted {
        mods |= Modifiers::SHIFT;
        &base_key
    } else {
        &key_lower
    };
    let code = match lookup {
        "a" => Code::KeyA,
        "b" => Code::KeyB,
        "c" => Code::KeyC,
        "d" => Code::KeyD,
        "e" => Code::KeyE,
        "f" => Code::KeyF,
        "g" => Code::KeyG,
        "h" => Code::KeyH,
        "i" => Code::KeyI,
        "j" => Code::KeyJ,
        "k" => Code::KeyK,
        "l" => Code::KeyL,
        "m" => Code::KeyM,
        "n" => Code::KeyN,
        "o" => Code::KeyO,
        "p" => Code::KeyP,
        "q" => Code::KeyQ,
        "r" => Code::KeyR,
        "s" => Code::KeyS,
        "t" => Code::KeyT,
        "u" => Code::KeyU,
        "v" => Code::KeyV,
        "w" => Code::KeyW,
        "x" => Code::KeyX,
        "y" => Code::KeyY,
        "z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        "arrowleft" => Code::ArrowLeft,
        "arrowright" => Code::ArrowRight,
        "arrowup" => Code::ArrowUp,
        "arrowdown" => Code::ArrowDown,
        "enter" => Code::Enter,
        "space" => Code::Space,
        "tab" => Code::Tab,
        "backspace" => Code::Backspace,
        "delete" => Code::Delete,
        "escape" => Code::Escape,
        "f1" => Code::F1,
        "f2" => Code::F2,
        "f3" => Code::F3,
        "f4" => Code::F4,
        "f5" => Code::F5,
        "f6" => Code::F6,
        "f7" => Code::F7,
        "f8" => Code::F8,
        "f9" => Code::F9,
        "f10" => Code::F10,
        "f11" => Code::F11,
        "f12" => Code::F12,
        "," | "comma" => Code::Comma,
        "." | "period" => Code::Period,
        "/" | "slash" => Code::Slash,
        "\\" | "backslash" => Code::Backslash,
        "[" | "bracketleft" => Code::BracketLeft,
        "]" | "bracketright" => Code::BracketRight,
        "-" | "minus" => Code::Minus,
        "=" | "equal" => Code::Equal,
        ";" | "semicolon" => Code::Semicolon,
        "'" | "quote" => Code::Quote,
        "`" | "backquote" => Code::Backquote,
        _ => {
            eprintln!(
                "keybinds: unsupported key '{key_lower}' in global shortcut \"{trimmed}\", using Alt+Shift+T"
            );
            return (Modifiers::ALT | Modifiers::SHIFT, Code::KeyT);
        }
    };

    (mods, code)
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
pub fn set_keybind(app: AppHandle, action: String, binding: String) -> Result<(), String> {
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
        kb.unbind.push(action.clone());
    } else {
        kb.unbind.retain(|a| a != &action);
        kb.bind.insert(action.clone(), binding.clone());
    }
    save_keybinds(&kb);

    if action == "window_toggle" && !binding.is_empty() {
        let (mods, code) = parse_global_shortcut(&binding);
        let sc = Shortcut::new(Some(mods), code);
        if let Err(e) = app.global_shortcut().register(sc) {
            eprintln!("[partty] global shortcut re-register failed for \"{binding}\": {e}");
        }
    }

    Ok(())
}

#[tauri::command]
pub fn reset_keybinds() -> Result<(), String> {
    if let Some(path) = keybinds_path() {
        let _ = fs::remove_file(&path);
    }
    Ok(())
}
