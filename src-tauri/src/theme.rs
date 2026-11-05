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
    #[serde(default)]
    pub family: String,
    #[serde(default)]
    pub variants: Vec<ThemeVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeVariant {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub colors: HashMap<String, String>,
    #[serde(default)]
    pub prefs: Option<toml::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeVariantInfo {
    pub id: String,
    pub name: String,
    pub colors: HashMap<String, String>,
    pub prefs: Option<Prefs>,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize)]
pub struct ThemeInfo {
    pub name: String,
    pub family: String,
    pub colors: HashMap<String, String>,
    pub prefs: Option<Prefs>,
    pub variants: Vec<ThemeVariantInfo>,
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

fn resolve_theme_prefs(base: &Prefs, overlay_val: toml::Value) -> Result<Prefs, String> {
    let base_config = ConfigToml::from(base);
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
    resolve_theme_info(&name, theme, &prefs::load_prefs())
}

fn resolve_theme_info(slug: &str, theme: ThemeToml, base: &Prefs) -> Result<ThemeInfo, String> {
    let mut ids = std::collections::HashSet::new();
    let mut variants = Vec::with_capacity(theme.variants.len());
    for variant in theme.variants {
        prefs::validate_custom_theme_name(&variant.id)?;
        if !ids.insert(variant.id.clone()) {
            return Err(format!("duplicate theme variant: {}", variant.id));
        }
        let mut colors = theme.colors.clone();
        colors.extend(variant.colors);
        let overlay = match (theme.prefs.clone(), variant.prefs) {
            (Some(base), Some(overlay)) => Some(merge_toml_values(base, overlay)),
            (base, overlay) => overlay.or(base),
        };
        variants.push(ThemeVariantInfo {
            id: variant.id.clone(),
            name: if variant.name.is_empty() {
                variant.id
            } else {
                variant.name
            },
            colors,
            prefs: overlay
                .map(|overlay| resolve_theme_prefs(base, overlay))
                .transpose()?,
        });
    }
    Ok(ThemeInfo {
        name: theme.name,
        family: if theme.family.trim().is_empty() {
            slug.to_string()
        } else {
            theme.family
        },
        colors: theme.colors,
        prefs: theme
            .prefs
            .map(|overlay| resolve_theme_prefs(base, overlay))
            .transpose()?,
        variants,
    })
}

#[cfg(test)]
mod tests {
    use super::merge_toml_values;
    use toml::Value;

    #[test]
    fn resource_presets_are_valid_colors_only_themes() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources/themes");
        let mut count = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|s| s.to_str()) != Some("toml") {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            let theme: super::ThemeToml = toml::from_str(&text).unwrap();
            let value: Value = toml::from_str(&text).unwrap();
            assert!(
                value.as_table().unwrap().keys().all(|k| matches!(
                    k.as_str(),
                    "version" | "name" | "colors" | "family" | "variants"
                )),
                "{}",
                path.display()
            );
            assert_eq!(theme.version, 1);
            assert!(theme.prefs.is_none());
            let info =
                super::resolve_theme_info("fixture", theme, &super::Prefs::default()).unwrap();
            let palettes: Vec<_> = if info.variants.is_empty() {
                vec![&info.colors]
            } else {
                info.variants
                    .iter()
                    .map(|v| {
                        assert!(v.prefs.is_none());
                        &v.colors
                    })
                    .collect()
            };
            for colors in palettes {
                assert!(colors.contains_key("--term-bg"));
                assert_eq!(
                    colors
                        .keys()
                        .filter(|k| k.starts_with("--term-ansi-"))
                        .count(),
                    16
                );
                count += 1;
            }
        }
        assert_eq!(count, 31);
        assert_eq!(super::Prefs::default().ui_theme, "partty");
    }

    fn parse(text: &str) -> Value {
        toml::from_str::<Value>(text).unwrap()
    }

    #[test]
    fn family_variants_keep_order_and_inherit_colors_and_prefs() {
        let theme = toml::from_str::<super::ThemeToml>(
            r##"
name = "Favorites"
family = "favorites"
[colors]
"--term-bg" = "#161616"
[prefs.font]
size = 17.0
[[variants]]
id = "warm"
name = "Warm"
[variants.colors]
"--term-fg" = "#ffffff"
[[variants]]
id = "cool"
[variants.colors]
"--term-bg" = "#000000"
[variants.prefs.font]
size = 19.0
"##,
        )
        .unwrap();
        let info =
            super::resolve_theme_info("test", theme.clone(), &super::Prefs::default()).unwrap();
        assert_eq!(info.family, "favorites");
        assert_eq!(info.variants[0].id, "warm");
        assert_eq!(info.variants[1].id, "cool");
        assert_eq!(info.variants[0].colors["--term-bg"], "#161616");
        assert_eq!(info.variants[1].colors["--term-bg"], "#000000");
        assert!(info.variants[0].prefs.is_some());
        assert_eq!(
            info.variants[0].prefs.as_ref().unwrap().terminal_font_size,
            17.0
        );
        assert_eq!(
            info.variants[1].prefs.as_ref().unwrap().terminal_font_size,
            19.0
        );
        let mut duplicate = theme;
        duplicate.variants[1].id = "warm".into();
        assert!(super::resolve_theme_info("test", duplicate, &super::Prefs::default()).is_err());
    }

    #[test]
    fn merge_recurses_and_overlay_wins_per_key() {
        let base = parse("[a]\nx = 1\n[a.b]\ny = 2\nz = 3\n[c]\nk = 1\n");
        let overlay = parse("[a]\nx = 9\n[a.b]\ny = 8\nnew = 7\n[c]\nk = \"s\"\n");
        let merged = merge_toml_values(base, overlay);
        // Overlay scalars win while untouched base keys survive.
        assert_eq!(merged["a"]["x"].as_integer(), Some(9));
        assert_eq!(merged["a"]["b"]["y"].as_integer(), Some(8));
        assert_eq!(merged["a"]["b"]["z"].as_integer(), Some(3));
        assert_eq!(merged["a"]["b"]["new"].as_integer(), Some(7));
        // A type change is a replacement, not a merge.
        assert_eq!(merged["c"]["k"].as_str(), Some("s"));
    }

    #[test]
    fn non_table_overlay_replaces_the_base_value() {
        let merged = merge_toml_values(parse("a = 1\nb = 2\n"), parse("a = [1, 2, 3]\n"));
        assert_eq!(merged["a"].as_array().map(Vec::len), Some(3));
        assert_eq!(merged["b"].as_integer(), Some(2));
    }
}
