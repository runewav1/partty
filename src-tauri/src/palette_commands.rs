use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedPaletteCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    pub shell: String,
    #[serde(default)]
    pub cwd_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PaletteCommandsFile {
    version: u32,
    #[serde(default)]
    items: Vec<SavedPaletteCommand>,
}

fn palette_commands_path() -> Option<PathBuf> {
    let mut dir = dirs::data_local_dir()?;
    dir.push("termie");
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("palette_commands.json"))
}

pub fn load_palette_commands_disk() -> Vec<SavedPaletteCommand> {
    let Some(path) = palette_commands_path() else {
        return Vec::new();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<PaletteCommandsFile>(&s).ok())
        .map(|f| f.items)
        .unwrap_or_default()
}

fn save_palette_commands_disk(items: &[SavedPaletteCommand]) -> Result<(), String> {
    let Some(path) = palette_commands_path() else {
        return Err("no local data directory".into());
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let file = PaletteCommandsFile {
        version: 1,
        items: items.to_vec(),
    };
    let bytes = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_palette_commands() -> Vec<SavedPaletteCommand> {
    load_palette_commands_disk()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaletteContext {
    pub shell: String,
    pub cwd: Option<String>,
}

#[tauri::command]
pub fn get_palette_context(state: tauri::State<'_, super::AppState>) -> PaletteContext {
    let shell_from_pty = {
        let panes = state.pty_panes.lock();
        let focus = state.focused_pane_id.lock().clone();
        let id = focus
            .filter(|id| panes.contains_key(id))
            .or_else(|| panes.keys().next().cloned());
        id.and_then(|i| panes.get(&i).and_then(|s| s.shell_exe_token()))
    };
    let shell =
        shell_from_pty.unwrap_or_else(|| state.persisted.lock().prefs.shell.trim().to_string());
    PaletteContext {
        shell,
        cwd: super::effective_cwd_for_ui(&state, None),
    }
}

#[tauri::command]
pub fn upsert_palette_command(cmd: SavedPaletteCommand) -> Result<(), String> {
    if cmd.id.is_empty() || cmd.name.trim().is_empty() {
        return Err("command id and name are required".into());
    }
    let mut items = load_palette_commands_disk();
    if let Some(i) = items.iter().position(|x| x.id == cmd.id) {
        items[i] = cmd;
    } else {
        items.push(cmd);
    }
    save_palette_commands_disk(&items)
}

#[tauri::command]
pub fn delete_palette_command(id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("id required".into());
    }
    let mut items = load_palette_commands_disk();
    let before = items.len();
    items.retain(|x| x.id != id);
    if items.len() != before {
        save_palette_commands_disk(&items)?;
    }
    Ok(())
}
