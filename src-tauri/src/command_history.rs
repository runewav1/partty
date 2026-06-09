use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug)]
pub struct CommandHistoryStore {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandHistoryRecord {
    pub id: String,
    pub pane_id: String,
    pub command: String,
    pub output: String,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub ended_at: u64,
    pub duration_ms: u64,
    pub cwd: Option<String>,
}

pub fn create_store() -> Result<CommandHistoryStore, String> {
    let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA temp_store = MEMORY;
        PRAGMA journal_mode = MEMORY;
        CREATE TABLE IF NOT EXISTS command_history (
            id TEXT PRIMARY KEY,
            pane_id TEXT NOT NULL,
            command TEXT NOT NULL,
            output TEXT NOT NULL,
            exit_code INTEGER,
            started_at INTEGER NOT NULL,
            ended_at INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            cwd TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_command_history_pane_started
            ON command_history (pane_id, started_at);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(CommandHistoryStore { conn: Mutex::new(conn) })
}

fn u64_to_i64(v: u64) -> i64 {
    i64::try_from(v).unwrap_or(i64::MAX)
}

fn i64_to_u64(v: i64) -> u64 {
    u64::try_from(v).unwrap_or_default()
}

#[tauri::command]
pub fn append_command_history_records(
    state: State<'_, AppState>,
    pane_id: String,
    records: Vec<CommandHistoryRecord>,
    max_records: usize,
) -> Result<(), String> {
    if records.is_empty() {
        return Ok(());
    }
    let cap = max_records.clamp(50, 50_000);
    let mut conn = state.command_history.conn.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                r#"
                INSERT OR REPLACE INTO command_history
                    (id, pane_id, command, output, exit_code, started_at, ended_at, duration_ms, cwd)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
            )
            .map_err(|e| e.to_string())?;
        for rec in records {
            stmt.execute(params![
                rec.id,
                pane_id,
                rec.command,
                rec.output,
                rec.exit_code,
                u64_to_i64(rec.started_at),
                u64_to_i64(rec.ended_at),
                u64_to_i64(rec.duration_ms),
                rec.cwd,
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    tx.execute(
        r#"
        DELETE FROM command_history
        WHERE pane_id = ?1
          AND id IN (
              SELECT id FROM command_history
              WHERE pane_id = ?1
              ORDER BY started_at ASC, ended_at ASC
              LIMIT max((SELECT count(*) FROM command_history WHERE pane_id = ?1) - ?2, 0)
          )
        "#,
        params![pane_id, cap],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_command_history(
    state: State<'_, AppState>,
    pane_id: String,
    limit: Option<usize>,
) -> Result<Vec<CommandHistoryRecord>, String> {
    let limit = limit.unwrap_or(500).clamp(1, 10_000);
    let conn = state.command_history.conn.lock();
    let mut stmt = conn
        .prepare(
            r#"
            SELECT id, pane_id, command, output, exit_code, started_at, ended_at, duration_ms, cwd
            FROM command_history
            WHERE pane_id = ?1
            ORDER BY started_at DESC, ended_at DESC
            LIMIT ?2
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![pane_id, limit], |row| {
            Ok(CommandHistoryRecord {
                id: row.get(0)?,
                pane_id: row.get(1)?,
                command: row.get(2)?,
                output: row.get(3)?,
                exit_code: row.get(4)?,
                started_at: i64_to_u64(row.get::<_, i64>(5)?),
                ended_at: i64_to_u64(row.get::<_, i64>(6)?),
                duration_ms: i64_to_u64(row.get::<_, i64>(7)?),
                cwd: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    out.reverse();
    Ok(out)
}

#[tauri::command]
pub fn delete_command_history(state: State<'_, AppState>, pane_id: String) -> Result<(), String> {
    state
        .command_history
        .conn
        .lock()
        .execute("DELETE FROM command_history WHERE pane_id = ?1", params![pane_id])
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_command_histories_with_prefix(
    state: State<'_, AppState>,
    prefix: String,
    keep: Vec<String>,
) -> Result<(), String> {
    let conn = state.command_history.conn.lock();
    let mut stmt = conn
        .prepare("SELECT DISTINCT pane_id FROM command_history WHERE pane_id LIKE ?1")
        .map_err(|e| e.to_string())?;
    let ids = stmt
        .query_map(params![format!("{}%", prefix)], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let keep: std::collections::HashSet<String> = keep.into_iter().collect();
    for id in ids {
        let id = id.map_err(|e| e.to_string())?;
        if !keep.contains(&id) {
            conn.execute("DELETE FROM command_history WHERE pane_id = ?1", params![id])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
