//! File search powered by fff-search — git-aware fuzzy matching with
//! background indexing and content grep.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use fff_search::{
    file_picker::FilePicker, shared::SharedFilePicker,
    FilePickerOptions, FFFMode, FuzzySearchOptions, GrepConfig, GrepSearchOptions,
    PaginationArgs, QueryParser,
};

/// A single match line from a content search.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MatchDetail {
    pub line: u32,
    pub col: u32,
    pub line_content: String,
    /// (start_byte, end_byte) ranges within line_content.
    pub match_ranges: Vec<(u32, u32)>,
}

/// Result from a file search operation.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    /// For name search: always 1 (matches the file). For content: match count.
    pub matches: u32,
    /// Detailed match lines. Content search includes at most the first 20
    /// lines for result files in the first 50-result snippet window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_details: Option<Vec<MatchDetail>>,
}

/// Lazily-initialized pickers keyed by workspace root.
static PICKERS: Mutex<Option<HashMap<PathBuf, SharedFilePicker>>> = Mutex::new(None);

fn get_or_init_picker(root: &PathBuf) -> Result<SharedFilePicker, String> {
    let mut guard = PICKERS.lock().map_err(|e| e.to_string())?;
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some(picker) = map.get(root) {
        return Ok(picker.clone());
    }
    let shared = SharedFilePicker::default();
    FilePicker::new_with_shared_state(
        shared.clone(),
        Default::default(),
        FilePickerOptions {
            base_path: root.to_string_lossy().into_owned(),
            mode: FFFMode::Ai,
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    shared.wait_for_scan(Duration::from_secs(10));
    map.insert(root.clone(), shared.clone());
    Ok(shared)
}

/// Search files by name (fuzzy, git-aware, frecency-ranked).
pub fn search_files_root(root: String, query: String) -> Result<Vec<SearchResult>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Err("root must be an absolute directory".into());
    }
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let shared = get_or_init_picker(&root_path)?;
    let guard = shared.read().map_err(|e| e.to_string())?;
    let picker = guard.as_ref().ok_or("picker not initialized")?;

    let parser = QueryParser::default();
    let parsed = parser.parse(q);
    let results = picker.fuzzy_search(
        &parsed,
        None,
        FuzzySearchOptions {
            max_threads: 0,
            current_file: None,
            pagination: PaginationArgs { offset: 0, limit: 100 },
            ..Default::default()
        },
    );

    Ok(results
        .items
        .iter()
        .map(|item| SearchResult {
            path: item.relative_path(picker).to_string(),
            matches: 1,
            match_details: None,
        })
        .collect())
}

const MAX_DETAILS_PER_FILE: usize = 20;
const MAX_DETAIL_RESULT_FILES: usize = 50;

fn detail_from_grep_match(m: &fff_search::grep::GrepMatch) -> MatchDetail {
    MatchDetail {
        line: m.line_number as u32,
        col: m.col as u32,
        line_content: m.line_content.clone(),
        match_ranges: m
            .match_byte_offsets
            .iter()
            .map(|range| (range.0, range.1))
            .collect(),
    }
}

/// Search file contents (grep with fff). Includes match details for the first
/// 50 result files only, with each file capped at 20 snippet lines.
pub fn search_file_contents(root: String, query: String) -> Result<Vec<SearchResult>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Err("root must be an absolute directory".into());
    }
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let shared = get_or_init_picker(&root_path)?;
    let guard = shared.read().map_err(|e| e.to_string())?;
    let picker = guard.as_ref().ok_or("picker not initialized")?;

    let parser = QueryParser::new(GrepConfig::default());
    let parsed = parser.parse(q);
    let grep_result = picker.grep(
        &parsed,
        &GrepSearchOptions {
            page_limit: 1000,
            file_offset: 0,
            max_file_size: 10 * 1024 * 1024,
            max_matches_per_file: 100,
            smart_case: true,
            time_budget_ms: 0,
            ..Default::default()
        },
    );

    // Group matches by file path, collecting details.
    let mut by_path: HashMap<String, (u32, Vec<MatchDetail>)> = HashMap::new();
    for m in &grep_result.matches {
        let path = grep_result.files[m.file_index].relative_path(picker).to_string();
        let entry = by_path.entry(path).or_insert((0, Vec::new()));
        entry.0 += 1;
        if entry.1.len() < MAX_DETAILS_PER_FILE {
            entry.1.push(detail_from_grep_match(m));
        }
    }

    // Sort by match count descending, then by path.
    let mut paths: Vec<String> = by_path.keys().cloned().collect();
    paths.sort_by(|a, b| {
        let ca = by_path[a].0;
        let cb = by_path[b].0;
        cb.cmp(&ca).then_with(|| a.cmp(b))
    });

    // Build results with a global result-file snippet window.
    let mut results = Vec::with_capacity(paths.len());

    for (idx, path) in paths.into_iter().enumerate() {
        let (count, details) = &by_path[&path];
        let included = if idx < MAX_DETAIL_RESULT_FILES {
            Some(details.clone())
        } else {
            None
        };
        results.push(SearchResult {
            path,
            matches: *count,
            match_details: included,
        });
    }

    Ok(results)
}

/// Search a single file on demand for snippet display. This intentionally avoids
/// a repository-wide grep when an expanded result fell outside the initial
/// first-50 snippet window.
pub fn search_file_content_details(
    root: String,
    path: String,
    query: String,
) -> Result<Vec<MatchDetail>, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_absolute() || !root_path.is_dir() {
        return Err("root must be an absolute directory".into());
    }

    let file_path = PathBuf::from(&path);
    if !file_path.is_absolute() || !file_path.is_file() {
        return Err("path must be an absolute file".into());
    }

    let root_canon = root_path.canonicalize().map_err(|e| e.to_string())?;
    let file_canon = file_path.canonicalize().map_err(|e| e.to_string())?;
    if !file_canon.starts_with(&root_canon) {
        return Err("path must be inside root".into());
    }

    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    search_single_file_literal(&file_canon, q)
}

fn search_single_file_literal(path: &Path, query: &str) -> Result<Vec<MatchDetail>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("file is too large to search".into());
    }
    let text = String::from_utf8_lossy(&bytes);
    let smart_case_sensitive = query.chars().any(|ch| ch.is_uppercase());
    let needle = if smart_case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };

    let mut details = Vec::new();
    for (line_idx, line) in text.lines().enumerate() {
        let haystack = if smart_case_sensitive {
            line.to_string()
        } else {
            line.to_lowercase()
        };
        let mut ranges = Vec::new();
        let mut offset = 0usize;
        while let Some(pos) = haystack[offset..].find(&needle) {
            let start = offset + pos;
            let end = start + needle.len();
            ranges.push((start as u32, end as u32));
            offset = end.max(start + 1);
            if ranges.len() >= 16 {
                break;
            }
        }
        if !ranges.is_empty() {
            details.push(MatchDetail {
                line: (line_idx + 1) as u32,
                col: ranges[0].0,
                line_content: line.chars().take(500).collect(),
                match_ranges: ranges,
            });
            if details.len() >= MAX_DETAILS_PER_FILE {
                break;
            }
        }
    }
    Ok(details)
}
