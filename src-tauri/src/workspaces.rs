//! Saved workspace layouts (`~/.partty/workspaces/*.toml`).

use crate::prefs::{ensure_config_dir, validate_workspace_name};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PaneNodeSerde {
    Leaf { id: String },
    Split {
        dir: String,
        ratio: f64,
        a: Box<PaneNodeSerde>,
        b: Box<PaneNodeSerde>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FloatingPaneSerde {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaneThemeSerde {
    pub ui_theme: String,
    #[serde(default)]
    pub ui_theme_variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutSection {
    #[serde(default = "default_version")]
    pub v: u32,
    pub tree: PaneNodeSerde,
    pub focused_id: String,
    #[serde(default)]
    pub floating: HashMap<String, FloatingPaneSerde>,
    #[serde(default)]
    pub pane_themes: HashMap<String, PaneThemeSerde>,
    #[serde(default)]
    pub pane_names: HashMap<String, String>,
    #[serde(default)]
    pub pane_cwds: HashMap<String, String>,
    #[serde(default)]
    pub pane_profile_ids: HashMap<String, String>,
    #[serde(default)]
    pub startup_commands: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFile {
    #[serde(default = "default_version", alias = "v")]
    pub version: u32,
    pub id: String,
    pub name: String,
    pub tab_name: String,
    pub layout: LayoutSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub tab_name: String,
    pub layout: LayoutDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDto {
    pub v: u32,
    pub tree: PaneNodeDto,
    pub focused_id: String,
    #[serde(default)]
    pub floating: HashMap<String, FloatingPaneDto>,
    #[serde(default)]
    pub pane_themes: HashMap<String, PaneThemeDto>,
    #[serde(default)]
    pub pane_names: HashMap<String, String>,
    #[serde(default)]
    pub pane_cwds: HashMap<String, String>,
    #[serde(default)]
    pub pane_profile_ids: HashMap<String, String>,
    #[serde(default)]
    pub startup_commands: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum PaneNodeDto {
    Leaf { id: String },
    Split {
        dir: String,
        ratio: f64,
        a: Box<PaneNodeDto>,
        b: Box<PaneNodeDto>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingPaneDto {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneThemeDto {
    pub ui_theme: String,
    #[serde(default)]
    pub ui_theme_variant: String,
}

fn workspaces_dir() -> Result<PathBuf, String> {
    let dir = ensure_config_dir()
        .ok_or_else(|| "could not resolve home dir".to_string())?
        .join("workspaces");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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

fn pane_node_to_dto(n: &PaneNodeSerde) -> PaneNodeDto {
    match n {
        PaneNodeSerde::Leaf { id } => PaneNodeDto::Leaf { id: id.clone() },
        PaneNodeSerde::Split { dir, ratio, a, b } => PaneNodeDto::Split {
            dir: dir.clone(),
            ratio: *ratio,
            a: Box::new(pane_node_to_dto(a)),
            b: Box::new(pane_node_to_dto(b)),
        },
    }
}

fn pane_node_from_dto(n: &PaneNodeDto) -> PaneNodeSerde {
    match n {
        PaneNodeDto::Leaf { id } => PaneNodeSerde::Leaf { id: id.clone() },
        PaneNodeDto::Split { dir, ratio, a, b } => PaneNodeSerde::Split {
            dir: dir.clone(),
            ratio: *ratio,
            a: Box::new(pane_node_from_dto(a)),
            b: Box::new(pane_node_from_dto(b)),
        },
    }
}

impl From<&WorkspaceFile> for WorkspaceDto {
    fn from(w: &WorkspaceFile) -> Self {
        let layout = &w.layout;
        Self {
            version: w.version,
            id: w.id.clone(),
            name: w.name.clone(),
            tab_name: w.tab_name.clone(),
            layout: LayoutDto {
                v: layout.v,
                tree: pane_node_to_dto(&layout.tree),
                focused_id: layout.focused_id.clone(),
                floating: layout
                    .floating
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            FloatingPaneDto {
                                x: v.x,
                                y: v.y,
                                width: v.width,
                                height: v.height,
                                z: v.z,
                            },
                        )
                    })
                    .collect(),
                pane_themes: layout
                    .pane_themes
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            PaneThemeDto {
                                ui_theme: v.ui_theme.clone(),
                                ui_theme_variant: v.ui_theme_variant.clone(),
                            },
                        )
                    })
                    .collect(),
                pane_names: layout.pane_names.clone(),
                pane_cwds: layout.pane_cwds.clone(),
                pane_profile_ids: layout.pane_profile_ids.clone(),
                startup_commands: layout.startup_commands.clone(),
            },
        }
    }
}

impl From<&WorkspaceDto> for WorkspaceFile {
    fn from(w: &WorkspaceDto) -> Self {
        let layout = &w.layout;
        Self {
            version: w.version.max(1),
            id: w.id.clone(),
            name: w.name.clone(),
            tab_name: w.tab_name.clone(),
            layout: LayoutSection {
                v: layout.v.max(1),
                tree: pane_node_from_dto(&layout.tree),
                focused_id: layout.focused_id.clone(),
                floating: layout
                    .floating
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            FloatingPaneSerde {
                                x: v.x,
                                y: v.y,
                                width: v.width,
                                height: v.height,
                                z: v.z,
                            },
                        )
                    })
                    .collect(),
                pane_themes: layout
                    .pane_themes
                    .iter()
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            PaneThemeSerde {
                                ui_theme: v.ui_theme.clone(),
                                ui_theme_variant: v.ui_theme_variant.clone(),
                            },
                        )
                    })
                    .collect(),
                pane_names: layout.pane_names.clone(),
                pane_cwds: layout.pane_cwds.clone(),
                pane_profile_ids: layout.pane_profile_ids.clone(),
                startup_commands: layout.startup_commands.clone(),
            },
        }
    }
}

pub fn load_workspace(name: &str) -> Result<WorkspaceDto, String> {
    validate_workspace_name(name)?;
    let path = workspaces_dir()?.join(format!("{name}.toml"));
    let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut w: WorkspaceFile = toml::from_str(&s).map_err(|e| e.to_string())?;
    if w.id.is_empty() {
        w.id = name.to_string();
    }
    if w.name.is_empty() {
        w.name = name.to_string();
    }
    Ok(WorkspaceDto::from(&w))
}

pub fn save_workspace(workspace: &WorkspaceDto) -> Result<(), String> {
    validate_workspace_name(&workspace.id)?;
    let file = WorkspaceFile::from(workspace);
    let path = workspaces_dir()?.join(format!("{}.toml", file.id));
    let bytes = toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
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
pub fn read_workspace(name: String) -> Result<WorkspaceDto, String> {
    load_workspace(&name)
}

#[tauri::command]
pub fn write_workspace(workspace: WorkspaceDto) -> Result<(), String> {
    save_workspace(&workspace)
}

#[tauri::command]
pub fn delete_workspace(name: String) -> Result<(), String> {
    remove_workspace(&name)
}
