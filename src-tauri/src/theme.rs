use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;

use super::prefs::{self, ConfigToml, Prefs};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeToml {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub colors: HashMap<String, String>,
    #[serde(default)]
    pub prefs: Option<toml::Value>,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeInfo {
    pub name: String,
    pub colors: HashMap<String, String>,
    pub prefs: Option<Prefs>,
}

fn themes_dir() -> Result<std::path::PathBuf, String> {
    prefs::custom_themes_dir()
}

pub fn list_theme_names() -> Result<Vec<String>, String> {
    let dir = themes_dir()?;
    let mut out = Vec::new();
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().into_owned();
        if let Some(stem) = name.strip_suffix(".toml") {
            out.push(stem.to_string());
        }
    }
    out.sort();
    Ok(out)
}

pub fn load_theme(name: &str) -> Result<ThemeToml, String> {
    prefs::validate_custom_theme_name(name)?;
    let path = themes_dir()?.join(format!("{name}.toml"));
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut t: ThemeToml = toml::from_str(&s).map_err(|e| e.to_string())?;
    if t.name.is_empty() {
        t.name = name.to_string();
    }
    Ok(t)
}

pub fn save_theme(name: &str, colors: HashMap<String, String>, prefs: Option<toml::Value>) -> Result<(), String> {
    prefs::validate_custom_theme_name(name)?;
    let path = themes_dir()?.join(format!("{name}.toml"));
    let t = ThemeToml {
        version: 1,
        name: name.to_string(),
        colors,
        prefs,
    };
    let bytes = toml::to_string_pretty(&t).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

pub fn remove_theme(name: &str) -> Result<(), String> {
    prefs::validate_custom_theme_name(name)?;
    let path = themes_dir()?.join(format!("{name}.toml"));
    fs::remove_file(path).map_err(|e| e.to_string())
}

fn merge_toml_values(base: toml::Value, overlay: toml::Value) -> toml::Value {
    match (base, overlay) {
        (toml::Value::Table(mut base_table), toml::Value::Table(overlay_table)) => {
            for (key, value) in overlay_table {
                match base_table.get_mut(&key) {
                    Some(existing) => {
                        *existing = merge_toml_values(existing.clone(), value);
                    }
                    None => {
                        base_table.insert(key, value);
                    }
                }
            }
            toml::Value::Table(base_table)
        }
        (_, overlay) => overlay,
    }
}

pub fn resolve_theme_prefs(theme_name: &str) -> Result<Prefs, String> {
    let theme = load_theme(theme_name)?;
    let Some(overlay_val) = theme.prefs else {
        return Ok(prefs::load_prefs());
    };
    let base_config = ConfigToml::from(&prefs::load_prefs());
    let base_val = toml::Value::try_from(&base_config).map_err(|e| e.to_string())?;
    let merged_val = merge_toml_values(base_val, overlay_val);
    let merged_config: ConfigToml = toml::Value::try_into(merged_val).map_err(|e| e.to_string())?;
    Ok(Prefs::from(merged_config))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_themes() -> Result<Vec<String>, String> {
    list_theme_names()
}

#[tauri::command]
pub fn read_theme(name: String) -> Result<ThemeInfo, String> {
    let theme = load_theme(&name)?;
    let prefs = if theme.prefs.is_some() {
        Some(resolve_theme_prefs(&name)?)
    } else {
        None
    };
    Ok(ThemeInfo {
        name: theme.name,
        colors: theme.colors,
        prefs,
    })
}

#[tauri::command]
pub fn write_theme(name: String, colors: HashMap<String, String>) -> Result<(), String> {
    let existing_prefs = load_theme(&name).ok().and_then(|t| t.prefs);
    save_theme(&name, colors, existing_prefs)
}

#[tauri::command]
pub fn delete_theme(name: String) -> Result<(), String> {
    remove_theme(&name)
}

#[tauri::command]
pub fn get_theme_effective_prefs(theme_name: String) -> Result<Prefs, String> {
    resolve_theme_prefs(&theme_name)
}
