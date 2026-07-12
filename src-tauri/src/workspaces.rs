//! Saved workspace layouts (`~/.partty/workspaces/*.toml`).

use crate::prefs::{ensure_config_dir, validate_workspace_name};
use serde_json::{Map, Value};
use std::fs;
use std::path::PathBuf;

fn workspaces_dir() -> Result<PathBuf, String> {
    let dir = ensure_config_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join("workspaces");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn snake_to_camel_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    let mut upper = false;
    for c in key.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn camel_to_snake_key(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 4);
    for (i, c) in key.char_indices() {
        if c.is_ascii_uppercase() {
            if i > 0 {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

fn rename_keys(v: Value, to_camel: bool) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                let nk = if to_camel {
                    snake_to_camel_key(&k)
                } else {
                    camel_to_snake_key(&k)
                };
                out.insert(nk, rename_keys(v, to_camel));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(|v| rename_keys(v, to_camel)).collect()),
        other => other,
    }
}

fn workspace_id(workspace: &Value) -> Option<&str> {
    workspace
        .get("id")
        .or_else(|| workspace.get("name"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn fill_workspace_defaults(mut workspace: Value, stem: &str) -> Value {
    let Some(obj) = workspace.as_object_mut() else {
        return workspace;
    };
    if obj
        .get("id")
        .and_then(|v| v.as_str())
        .is_none_or(str::is_empty)
    {
        obj.insert("id".into(), Value::String(stem.to_string()));
    }
    if obj
        .get("name")
        .and_then(|v| v.as_str())
        .is_none_or(str::is_empty)
    {
        obj.insert("name".into(), Value::String(stem.to_string()));
    }
    workspace
}

pub fn list_workspace_names() -> Result<Vec<String>, String> {
    let dir = workspaces_dir()?;
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

pub fn load_workspace(name: &str) -> Result<Value, String> {
    validate_workspace_name(name)?;
    let path = workspaces_dir()?.join(format!("{name}.toml"));
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let tom: toml::Value = toml::from_str(&text).map_err(|e| e.to_string())?;
    let json = serde_json::to_value(tom).map_err(|e| e.to_string())?;
    let json = rename_keys(json, true);
    Ok(fill_workspace_defaults(json, name))
}

pub fn save_workspace(workspace: &Value) -> Result<(), String> {
    let id = workspace_id(workspace).ok_or_else(|| "workspace id missing".to_string())?;
    validate_workspace_name(id)?;
    let json = rename_keys(workspace.clone(), false);
    let tom: toml::Value = serde_json::from_value(json).map_err(|e| e.to_string())?;
    let bytes = toml::to_string_pretty(&tom).map_err(|e| e.to_string())?;
    fs::write(
        workspaces_dir()?.join(format!("{id}.toml")),
        bytes,
    )
    .map_err(|e| e.to_string())
}

pub fn remove_workspace(name: &str) -> Result<(), String> {
    validate_workspace_name(name)?;
    let path = workspaces_dir()?.join(format!("{name}.toml"));
    fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_workspaces() -> Result<Vec<String>, String> {
    list_workspace_names()
}

#[tauri::command]
pub fn read_workspace(name: String) -> Result<Value, String> {
    load_workspace(&name)
}

#[tauri::command]
pub fn write_workspace(workspace: Value) -> Result<(), String> {
    save_workspace(&workspace)
}

#[tauri::command]
pub fn delete_workspace(name: String) -> Result<(), String> {
    remove_workspace(&name)
}
