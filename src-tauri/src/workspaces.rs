//! Read-only workspace layouts from `%USERPROFILE%/.partty/workspaces/*.toml`.
//!
//! Workspace files are user-authored configuration. ParTTY reads and validates
//! them, but never creates, changes, deletes, or watches them.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

const WORKSPACE_VERSION: u32 = 1;
const MAX_ID_LEN: usize = 64;
const MAX_NAME_LEN: usize = 128;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceFile {
    version: u32,
    id: String,
    name: String,
    #[serde(default)]
    tab_name: Option<String>,
    layout: WorkspaceLayoutFile,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceLayoutFile {
    tree: PaneNodeFile,
    focused_id: String,
    #[serde(default)]
    floating: HashMap<String, FloatingPaneStateFile>,
    #[serde(default)]
    pane_themes: HashMap<String, PaneThemePrefsFile>,
    #[serde(default)]
    pane_cwds: HashMap<String, String>,
    #[serde(default)]
    pane_profile_ids: HashMap<String, String>,
    #[serde(default)]
    startup_commands: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
enum PaneNodeFile {
    #[serde(rename = "leaf")]
    Leaf { id: String },
    #[serde(rename = "split")]
    Split {
        dir: String,
        ratio: f64,
        a: Box<PaneNodeFile>,
        b: Box<PaneNodeFile>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct FloatingPaneStateFile {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z: f64,
    #[serde(default)]
    follow: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct PaneThemePrefsFile {
    ui_theme: String,
    ui_theme_variant: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub tab_name: Option<String>,
    pub layout: WorkspaceLayoutDto,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLayoutDto {
    pub tree: PaneNodeDto,
    pub focused_id: String,
    pub floating: HashMap<String, FloatingPaneStateDto>,
    pub pane_themes: HashMap<String, PaneThemePrefsDto>,
    pub pane_cwds: HashMap<String, String>,
    pub pane_profile_ids: HashMap<String, String>,
    pub startup_commands: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum PaneNodeDto {
    #[serde(rename = "leaf")]
    Leaf { id: String },
    #[serde(rename = "split")]
    Split {
        dir: String,
        ratio: f64,
        a: Box<PaneNodeDto>,
        b: Box<PaneNodeDto>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct FloatingPaneStateDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z: f64,
    pub follow: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct PaneThemePrefsDto {
    pub ui_theme: String,
    pub ui_theme_variant: String,
}

fn workspaces_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .ok_or_else(|| "could not resolve home directory".to_string())?;
    Ok(PathBuf::from(home).join(".partty").join("workspaces"))
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return Err(format!("workspace id must be 1-{MAX_ID_LEN} characters"));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(
            "workspace id may contain only letters, numbers, dashes, and underscores".into(),
        );
    }
    Ok(())
}

fn validate_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_NAME_LEN {
        return Err(format!(
            "workspace name must be 1-{MAX_NAME_LEN} characters"
        ));
    }
    Ok(())
}

fn collect_leaf_ids(node: &PaneNodeFile, ids: &mut Vec<String>) -> Result<(), String> {
    match node {
        PaneNodeFile::Leaf { id } => {
            if id.trim().is_empty() {
                return Err("workspace layout contains an empty pane id".into());
            }
            ids.push(id.clone());
        }
        PaneNodeFile::Split { dir, ratio, a, b } => {
            if dir != "h" && dir != "v" {
                return Err(format!(
                    "workspace layout has invalid split direction `{dir}`"
                ));
            }
            if !ratio.is_finite() || !(0.05..=0.95).contains(ratio) {
                return Err("workspace layout split ratio must be between 0.05 and 0.95".into());
            }
            collect_leaf_ids(a, ids)?;
            collect_leaf_ids(b, ids)?;
        }
    }
    Ok(())
}

fn validate_layout(layout: &WorkspaceLayoutFile) -> Result<(), String> {
    let mut ids = Vec::new();
    collect_leaf_ids(&layout.tree, &mut ids)?;
    let id_set: HashSet<&str> = ids.iter().map(String::as_str).collect();
    if id_set.len() != ids.len() {
        return Err("workspace layout contains duplicate pane ids".into());
    }
    if !id_set.contains(layout.focused_id.as_str()) {
        return Err("workspace focused_id must refer to a pane in the layout".into());
    }

    for (pane_id, state) in &layout.floating {
        validate_pane_map_key(pane_id, &id_set, "floating")?;
        if !state.x.is_finite()
            || !state.y.is_finite()
            || !state.width.is_finite()
            || !state.height.is_finite()
            || !state.z.is_finite()
            || state.width <= 0.0
            || state.height <= 0.0
        {
            return Err(format!(
                "workspace floating state for `{pane_id}` is invalid"
            ));
        }
    }

    for pane_id in layout.pane_themes.keys() {
        validate_pane_map_key(pane_id, &id_set, "pane_themes")?;
    }
    for pane_id in layout.pane_cwds.keys() {
        validate_pane_map_key(pane_id, &id_set, "pane_cwds")?;
    }
    for pane_id in layout.pane_profile_ids.keys() {
        validate_pane_map_key(pane_id, &id_set, "pane_profile_ids")?;
    }
    for (pane_id, command) in &layout.startup_commands {
        validate_pane_map_key(pane_id, &id_set, "startup_commands")?;
        if command.trim().is_empty() {
            return Err(format!(
                "workspace startup command for `{pane_id}` is empty"
            ));
        }
    }

    Ok(())
}

fn validate_pane_map_key(pane_id: &str, ids: &HashSet<&str>, map_name: &str) -> Result<(), String> {
    if ids.contains(pane_id) {
        Ok(())
    } else {
        Err(format!(
            "workspace {map_name} contains unknown pane `{pane_id}`"
        ))
    }
}

fn validate_workspace(workspace: &WorkspaceFile, file_id: &str) -> Result<(), String> {
    validate_id(file_id)?;
    if workspace.version != WORKSPACE_VERSION {
        return Err(format!(
            "unsupported workspace version {}; expected {WORKSPACE_VERSION}",
            workspace.version
        ));
    }
    if workspace.id != file_id {
        return Err(format!(
            "workspace id `{}` does not match filename `{file_id}`",
            workspace.id
        ));
    }
    validate_id(&workspace.id)?;
    validate_name(&workspace.name)?;
    if let Some(tab_name) = &workspace.tab_name {
        validate_name(tab_name)?;
    }
    validate_layout(&workspace.layout)
}

fn pane_node_dto(node: &PaneNodeFile) -> PaneNodeDto {
    match node {
        PaneNodeFile::Leaf { id } => PaneNodeDto::Leaf { id: id.clone() },
        PaneNodeFile::Split { dir, ratio, a, b } => PaneNodeDto::Split {
            dir: dir.clone(),
            ratio: *ratio,
            a: Box::new(pane_node_dto(a)),
            b: Box::new(pane_node_dto(b)),
        },
    }
}

impl From<WorkspaceFile> for WorkspaceDto {
    fn from(workspace: WorkspaceFile) -> Self {
        let layout = workspace.layout;
        Self {
            version: workspace.version,
            id: workspace.id,
            name: workspace.name.trim().to_string(),
            tab_name: workspace.tab_name.map(|name| name.trim().to_string()),
            layout: WorkspaceLayoutDto {
                tree: pane_node_dto(&layout.tree),
                focused_id: layout.focused_id,
                floating: layout
                    .floating
                    .into_iter()
                    .map(|(id, state)| {
                        (
                            id,
                            FloatingPaneStateDto {
                                x: state.x,
                                y: state.y,
                                width: state.width,
                                height: state.height,
                                z: state.z,
                                follow: state.follow,
                            },
                        )
                    })
                    .collect(),
                pane_themes: layout
                    .pane_themes
                    .into_iter()
                    .map(|(id, theme)| {
                        (
                            id,
                            PaneThemePrefsDto {
                                ui_theme: theme.ui_theme,
                                ui_theme_variant: theme.ui_theme_variant,
                            },
                        )
                    })
                    .collect(),
                pane_cwds: layout.pane_cwds,
                pane_profile_ids: layout.pane_profile_ids,
                startup_commands: layout.startup_commands,
            },
        }
    }
}

pub fn list_workspace_ids() -> Result<Vec<String>, String> {
    let dir = workspaces_dir()?;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(format!("could not list {}: {error}", dir.display())),
    };

    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("toml") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) {
            ids.push(stem.to_string());
        }
    }
    ids.sort_unstable();
    Ok(ids)
}

pub fn load_workspace(id: &str) -> Result<WorkspaceDto, String> {
    validate_id(id)?;
    let dir = workspaces_dir()?;
    let path = dir.join(format!("{id}.toml"));
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    let workspace: WorkspaceFile = toml::from_str(&text)
        .map_err(|error| format!("could not parse {}: {error}", path.display()))?;
    validate_workspace(&workspace, id)
        .map_err(|error| format!("invalid workspace `{id}`: {error}"))?;
    Ok(workspace.into())
}

#[tauri::command]
pub fn list_workspaces() -> Result<Vec<String>, String> {
    list_workspace_ids()
}

#[tauri::command]
pub fn read_workspace(id: String) -> Result<WorkspaceDto, String> {
    load_workspace(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(tree: PaneNodeFile) -> WorkspaceLayoutFile {
        WorkspaceLayoutFile {
            tree,
            focused_id: "root".into(),
            floating: HashMap::new(),
            pane_themes: HashMap::new(),
            pane_cwds: HashMap::new(),
            pane_profile_ids: HashMap::new(),
            startup_commands: HashMap::new(),
        }
    }

    #[test]
    fn rejects_duplicate_pane_ids() {
        let tree = PaneNodeFile::Split {
            dir: "h".into(),
            ratio: 0.5,
            a: Box::new(PaneNodeFile::Leaf { id: "root".into() }),
            b: Box::new(PaneNodeFile::Leaf { id: "root".into() }),
        };
        assert!(validate_layout(&layout(tree)).is_err());
    }

    #[test]
    fn accepts_a_single_pane_layout() {
        let tree = PaneNodeFile::Leaf { id: "root".into() };
        assert!(validate_layout(&layout(tree)).is_ok());
    }
}
