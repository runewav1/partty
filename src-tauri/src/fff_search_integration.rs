//! File search powered by fff-search — git-aware fuzzy matching with
//! background indexing and content grep.

use std::collections::HashMap;
use std::path::PathBuf;
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
    /// Detailed match lines — only present for files with ≤20 matches,
    /// and capped at 50 total across all results. None for name search.
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

/// Search file contents (grep with fff). Includes match details for
/// files with ≤20 matches, capped at 50 total detail entries.
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
            page_limit: 50,
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
        entry.1.push(MatchDetail {
            line: m.line_number as u32,
            col: m.col as u32,
            line_content: m.line_content.clone(),
            match_ranges: vec![(m.col as u32, (m.col + query.len()) as u32)],
        });
    }

    // Sort by match count descending, then by path.
    let mut paths: Vec<String> = by_path.keys().cloned().collect();
    paths.sort_by(|a, b| {
        let ca = by_path[a].0;
        let cb = by_path[b].0;
        cb.cmp(&ca).then_with(|| a.cmp(b))
    });

    // Build results with a global detail cap.
    const MAX_DETAILS_PER_FILE: u32 = 20;
    const MAX_TOTAL_DETAILS: usize = 50;
    let mut total_details = 0usize;
    let mut results = Vec::with_capacity(paths.len());

    for path in paths {
        let (count, details) = &by_path[&path];
        let include_details = *count <= MAX_DETAILS_PER_FILE && total_details < MAX_TOTAL_DETAILS;
        let included = if include_details {
            let take = ((MAX_TOTAL_DETAILS - total_details) as u32).min(*count);
            total_details += take as usize;
            if take == *count {
                Some(details.clone())
            } else {
                Some(details[..take as usize].to_vec())
            }
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
