use crate::clipboard;
use crate::prefs::Prefs;
use crate::profiles::{ConnectionProfile, ProfileKind};
use parking_lot::Mutex as ParkingMutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{RecvTimeoutError, sync_channel};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::Foundation::{DUPLICATE_SAME_ACCESS, DuplicateHandle, HANDLE};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, INFINITE, WaitForSingleObject};

const SHELL_INTEGRATION_PWSH: &str = include_str!("../scripts/partty-shell-integration.ps1");
const SHELL_INTEGRATION_BASH: &str = include_str!("../scripts/partty-shell-integration.bash");
const SHELL_INTEGRATION_ZSH: &str = include_str!("../scripts/partty-shell-integration.zsh");
const PTY_OUTPUT_BATCH_BYTES: usize = 128 * 1024;
const PTY_OUTPUT_BATCH_MS: u64 = 3;
const PTY_REPLAY_BUFFER_BYTES: usize = 4 * 1024 * 1024;
/// Cap held PTY bytes while the webview is gone or output is gated for restore.
const PTY_PENDING_HOLD_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitEvent {
    pub session_id: String,
}

/// CWD change extracted by the Rust-side OSC parser.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyCwdEvent {
    pub session_id: String,
    pub cwd: String,
    /// `IsWindows` from OSC 633 P when known (remote shell integration).
    pub remote_is_windows: Option<bool>,
}

/// Shell-integration lifecycle event extracted from OSC 133 / 633.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum ShellEventKind {
    PromptStart,
    PromptEnd,
    PreExec,
    CommandDone { exit_code: Option<i32> },
    CommandLine { text: String },
}

/// Terminal title change extracted from OSC 0 / 1 / 2.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyTitleEvent {
    pub session_id: String,
    pub title: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyShellEvent {
    pub session_id: String,
    #[serde(flatten)]
    pub event: ShellEventKind,
}

// ────────────────────────────────────────────────────────────────────────────
// Rust-side OSC stripper: strips OSC 7 (cwd), 133/633 (shell integration),
// and dead/legacy numbers (50, 1337-1339) from the PTY stream, emitting
// structured side-channel events instead so the frontend skips JS parsing
// for them. Everything else passes through for xterm.js. OSCs whose tracked
// span exceeds `MAX_OSC_LEN` are dropped, not buffered: once the cap is hit
// the stripper discards until the next BEL/ST, so a runaway unterminated
// OSC can never grow memory without bound.
// ────────────────────────────────────────────────────────────────────────────

const MAX_OSC_LEN: usize = 64 * 1024;

enum OscSideEvent {
    Cwd(String),
    Title(String),
    PromptStart,
    PromptEnd,
    PreExec,
    CommandDone(Option<i32>),
    CommandLine(String),
    /// OSC 52 set: base64-encoded clipboard text to write.
    Osc52Set(String),
    /// OSC 52 query: selection to echo back in the reply.
    Osc52Query(String),
}

/// A cleaned output batch that could not be delivered yet (webview down or
/// channel not subscribed).  `replayed` marks batches already appended to the
/// replay buffer — batches are appended *before* sending so a failed delivery
/// can be reconstructed from the replay tail instead of cloning the buffer.
struct HeldBatch {
    bytes: Vec<u8>,
    replayed: bool,
}

/// Fixed-slot shell-integration properties set via OSC 633 P. Only `IsWindows`
/// is ever read back (during Cwd normalization), so it lives in a dedicated
/// slot; anything else is kept in a tiny ordered list with overwrite-on-dup
/// semantics — no HashMap on the per-prompt hot path.
#[derive(Default)]
struct OscProperties {
    is_windows: Option<String>,
    extra: Vec<(String, String)>,
}

impl OscProperties {
    fn insert(&mut self, key: String, value: String) {
        if key == "IsWindows" {
            self.is_windows = Some(value);
            return;
        }
        if let Some(entry) = self.extra.iter_mut().find(|(k, _)| *k == key) {
            entry.1 = value;
        } else {
            self.extra.push((key, value));
        }
    }
}

struct OscStripper {
    /// Bytes held over from a chunk that ended mid-sequence.
    partial: Vec<u8>,
    /// Reusable cleaned-output buffer.
    scratch: Vec<u8>,
    properties: OscProperties,
    /// Dropping an oversized OSC until the next BEL/ST.
    discarding: bool,
}

impl OscStripper {
    fn new() -> Self {
        Self {
            partial: Vec::new(),
            scratch: Vec::with_capacity(16 * 1024),
            properties: OscProperties::default(),
            discarding: false,
        }
    }

    /// Takes ownership so escape-free chunks pass through untouched.
    fn process(&mut self, input: Vec<u8>) -> (Vec<u8>, Vec<OscSideEvent>) {
        if !self.discarding && self.partial.is_empty() && !input.contains(&0x1b) {
            return (input, Vec::new());
        }
        if self.partial.is_empty() {
            self.process_slice(&input)
        } else {
            self.partial.extend_from_slice(&input);
            let combined = std::mem::take(&mut self.partial);
            self.process_slice(&combined)
        }
    }

    fn process_slice(&mut self, buf: &[u8]) -> (Vec<u8>, Vec<OscSideEvent>) {
        // `partial` is always empty here (folded into `buf` by `process`), so
        // the cap applies to the whole combined span with a fixed budget.
        let mut events = Vec::new();
        self.scratch.clear();
        let mut run_start = 0; // start of the current plain run
        let mut search_from = 0;

        while search_from < buf.len() {
            if self.discarding {
                match memchr::memchr2(0x07, 0x1b, &buf[search_from..]) {
                    Some(off) => {
                        let pos = search_from + off;
                        if let Some(seq_len) = osc_terminator_end(buf, pos) {
                            self.discarding = false;
                            let seq_end = pos + seq_len;
                            run_start = seq_end;
                            search_from = seq_end;
                        } else {
                            search_from = pos + 1;
                        }
                    }
                    None => return (std::mem::take(&mut self.scratch), events),
                }
                continue;
            }

            let Some(esc) = memchr::memchr(0x1b, &buf[search_from..]) else {
                break;
            };
            let esc = search_from + esc;
            self.scratch.extend_from_slice(&buf[run_start..esc]);

            if esc + 1 < buf.len() && buf[esc + 1] == 0x5d {
                match osc_scan(buf, esc + 2, MAX_OSC_LEN) {
                    OscScan::Ended(payload_end, seq_end) => {
                        let payload = &buf[esc + 2..payload_end];
                        if !self.dispatch_osc(payload, &mut events) {
                            self.scratch.extend_from_slice(&buf[esc..seq_end]);
                        }
                        run_start = seq_end;
                        search_from = seq_end;
                        continue;
                    }
                    OscScan::Incomplete => {
                        let tail = &buf[esc..];
                        if tail.len() > MAX_OSC_LEN {
                            self.partial.clear();
                            self.discarding = true;
                        } else {
                            self.partial.extend_from_slice(tail);
                        }
                        return (std::mem::take(&mut self.scratch), events);
                    }
                    OscScan::Oversized => {
                        self.partial.clear();
                        self.discarding = true;
                        search_from = esc + 1;
                        continue;
                    }
                }
            }
            if esc + 1 == buf.len() {
                // Lone ESC at end — maybe `ESC ]` split across chunks.
                self.partial.push(0x1b);
                return (std::mem::take(&mut self.scratch), events);
            }
            run_start = esc;
            search_from = esc + 1;
        }

        self.scratch.extend_from_slice(&buf[run_start..]);
        (std::mem::take(&mut self.scratch), events)
    }

    /// Returns `true` if the OSC was recognised and should be stripped.
    fn dispatch_osc(&mut self, payload: &[u8], events: &mut Vec<OscSideEvent>) -> bool {
        let s = match std::str::from_utf8(payload) {
            Ok(s) => s,
            Err(_) => return false,
        };
        let (osc_num, rest) = match s.find(';') {
            Some(pos) => (&s[..pos], &s[pos + 1..]),
            None => (s, ""),
        };
        match osc_num {
            "0" | "1" | "2" => {
                let title = rest.trim().to_string();
                if !title.is_empty() {
                    events.push(OscSideEvent::Title(title));
                }
                true
            }
            "7" => {
                if let Some(cwd) = osc7_parse_cwd(rest) {
                    events.push(OscSideEvent::Cwd(cwd));
                }
                true
            }
            "133" | "633" => {
                self.handle_shell_integration(rest, events);
                true
            }
            "52" => {
                self.handle_osc52(rest, events);
                true
            }
            // Dead/legacy sequences xterm.js would parse and discard: strip
            // them for the renderer's benefit (and kill the OSC 50 query
            // echoback vector).
            "50" | "1337" | "1338" | "1339" => true,
            // Numberless payload (`ESC ]` / `ESC ];...`): malformed noise,
            // carried no meaning for any terminal — drop it.
            "" => true,
            _ => false,
        }
    }

    fn handle_shell_integration(&mut self, rest: &str, events: &mut Vec<OscSideEvent>) {
        let sep = rest.find(';');
        let letter = sep.map(|p| &rest[..p]).unwrap_or(rest);
        let data = sep.map(|p| &rest[p + 1..]).unwrap_or("");

        match letter {
            "A" => events.push(OscSideEvent::PromptStart),
            "B" => events.push(OscSideEvent::PromptEnd),
            "C" => events.push(OscSideEvent::PreExec),
            "D" => {
                let code = data.trim().parse::<i32>().ok();
                events.push(OscSideEvent::CommandDone(code));
            }
            "E" => events.push(OscSideEvent::CommandLine(osc_unescape(data))),
            "P" => {
                if let Some(eq) = data.find('=') {
                    let key = &data[..eq];
                    let value = osc_unescape(&data[eq + 1..]);
                    if key == "Cwd" {
                        let cwd =
                            osc633_normalize_cwd(&value, self.properties.is_windows.as_deref());
                        if !cwd.is_empty() {
                            events.push(OscSideEvent::Cwd(cwd));
                        }
                    } else {
                        self.properties.insert(key.to_string(), value);
                    }
                }
            }
            _ => {}
        }
    }

    /// Parse an OSC 52 payload (`Pc;Pd`). The set form carries base64-encoded
    /// clipboard text; the query form (`Pd` == `?`) asks us to reply with the
    /// current clipboard contents. Both are stripped from the stream and
    /// delivered as events — the emitter loop performs the actual clipboard
    /// work. Windows has a single system clipboard, so the selection is only
    /// used to decide whether the sequence is one we act on at all: standard
    /// values are `0` (clipboard), `1` (primary), `2` (secondary), `3`
    /// (highlight), plus the letter aliases `c`/`s`/`p` and comma lists like
    /// `0,s`. Unsupported selections are still stripped, just not acted on.
    fn handle_osc52(&self, rest: &str, events: &mut Vec<OscSideEvent>) {
        let (selection, data) = match rest.split_once(';') {
            Some((pc, pd)) => (pc, pd),
            None => (rest, ""),
        };
        if !selection
            .chars()
            .any(|c| matches!(c, '0' | 'c' | 's' | 'p'))
        {
            return;
        }
        let payload = data.trim();
        if payload == "?" {
            events.push(OscSideEvent::Osc52Query(selection.to_string()));
        } else {
            events.push(OscSideEvent::Osc52Set(payload.to_string()));
        }
    }
}

/// Length of the OSC terminator at `pos` (1 for BEL, 2 for `ESC \`), else None.
fn osc_terminator_end(buf: &[u8], pos: usize) -> Option<usize> {
    match buf.get(pos).copied() {
        Some(0x07) => Some(1),
        Some(0x1b) if buf.get(pos + 1) == Some(&0x5c) => Some(2),
        _ => None,
    }
}

enum OscScan {
    Ended(usize, usize), // (payload_end, seq_end)
    Incomplete,          // terminator in a later chunk
    Oversized,           // span exceeds the cap
}

/// Scan `buf` from `from` (first byte after `ESC ]`) for a terminator,
/// bounded to `budget` bytes. The cap is a memory bound, approximate to
/// within a few bytes (introducer and terminator count toward it) — not a
/// byte-exact contract.
fn osc_scan(buf: &[u8], from: usize, budget: usize) -> OscScan {
    let limit = from.saturating_add(budget).min(buf.len());
    let mut i = from;
    while i < limit {
        match memchr::memchr2(0x07, 0x1b, &buf[i..limit]) {
            Some(off) => {
                let pos = i + off;
                if let Some(seq_len) = osc_terminator_end(buf, pos) {
                    return OscScan::Ended(pos, pos + seq_len);
                }
                i = pos + 1;
            }
            None => break,
        }
    }
    if limit < buf.len() {
        OscScan::Oversized
    } else {
        OscScan::Incomplete
    }
}

#[cfg(test)]
mod stripper_tests {
    use super::*;

    // ─── Spec-based whole-stream oracle ─────────────────────────────────────
    // Written as a separate, deliberately naive algorithm: no chunk state, no
    // scratch buffer, no run tracking. It walks the stream, finds complete
    // `ESC ]` sequences, and drops exactly the ones whose OSC number the
    // stripper must remove. Independent from the implementation's structure
    // so the two cannot share the same bug.

    const STRIPPED_OSC_NUMBERS: [&str; 11] = [
        "0", "1", "2", "7", "50", "52", "133", "633", "1337", "1338", "1339",
    ];

    /// Naive terminator search: BEL or `ESC \`. Returns (payload_end, seq_end).
    fn oracle_terminator(buf: &[u8], from: usize) -> Option<(usize, usize)> {
        let mut i = from;
        while i < buf.len() {
            if buf[i] == 0x07 {
                return Some((i, i + 1));
            }
            if buf[i] == 0x1b && i + 1 < buf.len() && buf[i + 1] == 0x5c {
                return Some((i, i + 2));
            }
            i += 1;
        }
        None
    }

    /// True when the payload's OSC number is one the stripper must remove.
    /// Numberless payloads (`ESC ]` / `ESC ];...`) are malformed and stripped.
    fn oracle_should_strip(payload: &[u8]) -> bool {
        let Ok(s) = std::str::from_utf8(payload) else {
            return false;
        };
        let number = s.split(';').next().unwrap_or("");
        STRIPPED_OSC_NUMBERS.contains(&number) || number.is_empty()
    }

    /// Whole-stream reference: kept bytes plus the payloads of every OSC the
    /// stripper must remove, in stream order.
    fn oracle_strip(stream: &[u8]) -> (Vec<u8>, Vec<&[u8]>) {
        let mut out = Vec::with_capacity(stream.len());
        let mut stripped_payloads = Vec::new();
        let mut i = 0;
        while i < stream.len() {
            if stream[i] == 0x1b
                && i + 1 < stream.len()
                && stream[i + 1] == 0x5d
                && let Some((payload_end, seq_end)) = oracle_terminator(stream, i + 2)
            {
                let payload = &stream[i + 2..payload_end];
                if oracle_should_strip(payload) {
                    stripped_payloads.push(payload);
                    i = seq_end;
                    continue;
                }
                // Unknown OSC: pass the whole sequence through untouched.
                out.extend_from_slice(&stream[i..seq_end]);
                i = seq_end;
                continue;
            }
            out.push(stream[i]);
            i += 1;
        }
        (out, stripped_payloads)
    }

    // ─── Implementation runner ──────────────────────────────────────────────

    fn event_key(ev: &OscSideEvent) -> String {
        match ev {
            OscSideEvent::Cwd(s) => format!("Cwd({s})"),
            OscSideEvent::Title(s) => format!("Title({s})"),
            OscSideEvent::PromptStart => "PromptStart".into(),
            OscSideEvent::PromptEnd => "PromptEnd".into(),
            OscSideEvent::PreExec => "PreExec".into(),
            OscSideEvent::CommandDone(c) => format!("CommandDone({c:?})"),
            OscSideEvent::CommandLine(s) => format!("CommandLine({s})"),
            OscSideEvent::Osc52Set(s) => format!("Osc52Set({s})"),
            OscSideEvent::Osc52Query(s) => format!("Osc52Query({s})"),
        }
    }

    /// Feed `chunks` through the real stripper and return the fully flushed
    /// result (cleaned bytes + event keys). Deferred tail bytes (dangling ESC
    /// / incomplete OSC) are passthrough by contract, so they are flushed
    /// before returning, making results comparable to the whole-stream oracle.
    fn run_impl(chunks: &[&[u8]]) -> (Vec<u8>, Vec<String>) {
        let mut s = OscStripper::new();
        let mut acc = Vec::new();
        let mut keys = Vec::new();
        for c in chunks {
            let (clean, events) = s.process(c.to_vec());
            acc.extend_from_slice(&clean);
            for e in events {
                keys.push(event_key(&e));
            }
        }
        acc.extend_from_slice(&s.partial);
        (acc, keys)
    }

    // ─── Properties ─────────────────────────────────────────────────────────

    /// Cleaned output must be a byte-exact subsequence of the stream: nothing
    /// dropped except stripped sequences, nothing reordered, nothing invented.
    fn is_subsequence(sub: &[u8], of: &[u8]) -> bool {
        let mut j = 0;
        for &b in of {
            if j < sub.len() && sub[j] == b {
                j += 1;
            }
        }
        j == sub.len()
    }

    /// No *complete* OSC with a stripped number may survive in cleaned output.
    /// Incomplete (dangling) sequences are allowed — they are deferred state.
    fn no_complete_stripped_osc_survives(cleaned: &[u8]) {
        let mut i = 0;
        while i < cleaned.len() {
            if cleaned[i] == 0x1b
                && i + 1 < cleaned.len()
                && cleaned[i + 1] == 0x5d
                && let Some((payload_end, seq_end)) = oracle_terminator(cleaned, i + 2)
            {
                assert!(
                    !oracle_should_strip(&cleaned[i + 2..payload_end]),
                    "complete recognized OSC survived in cleaned output",
                );
                i = seq_end;
                continue;
            }
            i += 1;
        }
    }

    // ─── Deterministic generator ────────────────────────────────────────────

    struct Gen {
        seed: u64,
    }

    impl Gen {
        fn next_u64(&mut self) -> u64 {
            self.seed = self
                .seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.seed
        }
        fn below(&mut self, n: usize) -> usize {
            (self.next_u64() % n.max(1) as u64) as usize
        }
        fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
            &xs[self.below(xs.len())]
        }
    }

    const OSC_NUMS: [&str; 7] = ["0", "1", "2", "7", "52", "133", "633"];
    const UNKNOWN_OSC_NUMS: [&str; 6] = ["4", "8", "12", "48", "100", "1000"];
    const PLAIN_BYTES: &[u8] = b"abcXYZ0123 _-.,!?()/\\:~=#*\t\r\n";
    const UTF8_FRAG: &[u8] = "caf\u{e9} \u{3c0} \u{1f680} \u{5927}".as_bytes();

    fn gen_stream(g: &mut Gen, len_hint: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(len_hint);
        while out.len() < len_hint {
            match g.below(12) {
                0..=3 => {
                    // Plain run; occasionally laced with adversarial bytes.
                    let n = 1 + g.below(24);
                    for _ in 0..n {
                        match g.below(12) {
                            0 => out.push(0x1b), // stray ESC
                            1 => out.push(0x07), // stray BEL
                            _ => out.push(*g.pick(PLAIN_BYTES)),
                        }
                    }
                }
                4..=5 => {
                    // CSI passthrough (ESC [ ...).
                    out.push(0x1b);
                    out.push(0x5b);
                    let n = 1 + g.below(4);
                    for _ in 0..n {
                        out.push(*g.pick(b"0123456789;?:"))
                    }
                    out.push(*g.pick(b"mHhJAnlfsu"));
                }
                6..=9 => {
                    // OSC sequence.
                    out.push(0x1b);
                    out.push(0x5d);
                    out.extend_from_slice(g.pick(&OSC_NUMS).as_bytes());
                    if g.below(3) != 0 {
                        out.push(b';');
                        let n = 1 + g.below(10);
                        for _ in 0..n {
                            if g.below(3) == 0 {
                                out.extend_from_slice(UTF8_FRAG);
                            } else {
                                out.push(*g.pick(PLAIN_BYTES));
                            }
                        }
                    }
                    // Terminator: BEL, ST, ESC alone (resolved next chunk), or
                    // none at all (dangling incomplete OSC).
                    match g.below(4) {
                        0 => out.push(0x07),
                        1 => {
                            out.push(0x1b);
                            out.push(0x5c);
                        }
                        2 => out.push(0x1b),
                        _ => {}
                    }
                }
                10 => {
                    // Unknown OSC (must pass through).
                    out.push(0x1b);
                    out.push(0x5d);
                    out.extend_from_slice(g.pick(&UNKNOWN_OSC_NUMS).as_bytes());
                    out.push(b';');
                    out.extend_from_slice(UTF8_FRAG);
                    out.push(0x07);
                }
                11 => {
                    // Raw binary blob (may be invalid UTF-8, may contain ESC).
                    let n = 1 + g.below(48);
                    for _ in 0..n {
                        out.push(g.next_u64() as u8);
                    }
                }
                _ => unreachable!(),
            }
        }
        out
    }

    fn chunk_random<'a>(g: &mut Gen, stream: &'a [u8], cuts: usize) -> Vec<&'a [u8]> {
        let mut pts = vec![0usize];
        for _ in 0..cuts {
            pts.push(1 + g.below(stream.len().saturating_sub(1)));
        }
        pts.push(stream.len());
        pts.sort_unstable();
        pts.dedup();
        pts.windows(2).map(|w| &stream[w[0]..w[1]]).collect()
    }

    fn chunk_thin(stream: &[u8]) -> Vec<&[u8]> {
        stream.chunks(3).collect()
    }

    // ─── Verification driver ────────────────────────────────────────────────

    fn verify_stream(stream: &[u8], g: &mut Gen) {
        // Spec oracle over the whole stream.
        let (expected_clean, expected_payloads) = oracle_strip(stream);
        let mut oracle_stripper = OscStripper::new();
        let mut expected_keys = Vec::new();
        for payload in &expected_payloads {
            let mut evs = Vec::new();
            let stripped = oracle_stripper.dispatch_osc(payload, &mut evs);
            assert!(
                stripped,
                "oracle marked a payload stripped that dispatch rejects"
            );
            for e in evs {
                expected_keys.push(event_key(&e));
            }
        }

        // Implementation on the whole stream.
        let (impl_clean, impl_keys) = run_impl(&[stream]);

        // Property: bytes are conserved (subsequence, order preserved).
        assert!(
            is_subsequence(&impl_clean, stream),
            "impl dropped or reordered bytes",
        );
        // Property: no complete recognized OSC survives.
        no_complete_stripped_osc_survives(&impl_clean);
        // Property: stripping is idempotent — a second pass is a byte-identical
        // no-op and produces no events.
        let (again, again_keys) = run_impl(&[&impl_clean]);
        assert_eq!(again, impl_clean, "strip is not idempotent");
        assert!(
            again_keys.is_empty(),
            "second strip produced events: {again_keys:?}"
        );

        // The impl must match the spec oracle exactly.
        assert_eq!(
            impl_clean, expected_clean,
            "cleaned bytes differ from oracle"
        );
        assert_eq!(impl_keys, expected_keys, "events differ from oracle");

        // Property: chunk-boundary invariance — any chunking yields the same
        // flushed result and the same events.
        for cuts in [1usize, 3, 9, 31] {
            let chunks = chunk_random(g, stream, cuts);
            let (c_clean, c_keys) = run_impl(&chunks);
            assert_eq!(c_clean, impl_clean, "chunking diverges (cuts={cuts})");
            assert_eq!(c_keys, impl_keys, "chunked events diverge (cuts={cuts})");
        }
        let thin = chunk_thin(stream);
        let (t_clean, t_keys) = run_impl(&thin);
        assert_eq!(t_clean, impl_clean, "3-byte chunking diverges");
        assert_eq!(t_keys, impl_keys, "3-byte chunked events diverge");
    }

    #[test]
    fn stripper_matches_spec_and_properties() {
        let mut g = Gen { seed: 0x5DEECE66D };
        for i in 0..384u64 {
            let mut g2 = Gen {
                seed: g.seed.wrapping_add(i.wrapping_mul(0x9E3779B97F4A7C15)),
            };
            let len = 8 + g2.below(2000);
            let stream = gen_stream(&mut g2, len);
            verify_stream(&stream, &mut g2);
        }
        // Large streams exercise long no-ESC runs and big batches.
        for _ in 0..8 {
            let len = 16 * 1024 + g.below(16 * 1024);
            let stream = gen_stream(&mut g, len);
            verify_stream(&stream, &mut g);
        }
        // Hand-crafted adversarial cases.
        let fixed: Vec<Vec<u8>> = vec![
            b"\x1b\x1b".to_vec(),
            b"\x1b]0;x\x1b\x1b]1;y\x07".to_vec(),
            b"\x1b]7;\x07".to_vec(),
            b"\x1b]133;\x07".to_vec(),
            b"\x1b];\x07".to_vec(),
            b"\x1b]".to_vec(),
            b"\x1b\x1b]0;t\x1b\\".to_vec(),
            b"\x1b]633;P;Cwd=C:\\x\x07".to_vec(),
            b"\x1b]0;a\x07\x1b]0;b\x07".to_vec(),
            b"a\x1b]2;\x1b\\b".to_vec(),
            b"\x1b]0;partial".to_vec(),
            b"\x1b]0;t\x07\x1b".to_vec(),
            b"\x1b]8;;https://x\x07link".to_vec(),
            b"\x1b]52;0;SGVsbG8=\x07".to_vec(),
            b"\x1b]52;c;?\x1b\\".to_vec(),
            b"\x1b]52;1;AAAA\x07".to_vec(),
            b"\x1b]52;0;sensitive\x1b\\".to_vec(),
            b"\x1b[31mred\x1b[0m".to_vec(),
            b"\x1b\x1b[K".to_vec(),
        ];
        for s in &fixed {
            verify_stream(s, &mut g);
        }
    }

    // ─── Adversarial / challenge-derived tests ──────────────────────────────
    // Written as challenges to break the stripper, then folded in as
    // permanent coverage: exhaustive split invariance, oversized-sequence
    // discard semantics, and degenerate input.

    // Every possible chunk split of a stream must yield the same flushed
    // result as the whole stream — the exhaustive-boundary form of the
    // property the random-cut tests above sample.

    /// Every possible chunk split of `stream` must yield the same flushed
    /// result as the whole stream (the exhaustive-boundary form of the
    /// property the random-cut tests sample).
    fn assert_split_invariant(stream: &[u8]) {
        let (whole, whole_keys) = run_impl(&[stream]);
        let n = stream.len();
        let mut mask: Vec<u8> = vec![0; n];
        for split in 1..n {
            mask[split] = 1;
            let mut chunks = Vec::new();
            let mut start = 0;
            for (idx, &is_cut) in mask.iter().enumerate() {
                if is_cut != 0 {
                    chunks.push(&stream[start..idx]);
                    start = idx;
                }
            }
            chunks.push(&stream[start..]);
            let (got, got_keys) = run_impl(&chunks);
            assert_eq!(got, whole, "split at byte {split} diverged (len {n})");
            assert_eq!(
                got_keys, whole_keys,
                "split at byte {split} diverged events"
            );
            mask[split] = 0;
        }
    }

    #[test]
    fn split_invariant_exhaustive_coverage() {
        // A stream exercising every stripper feature; every byte boundary
        // must be chunk-safe.
        let stream = concat!(
            "plain \x1b]0;title\x07 text \x1b[31mred\x1b[0m ",
            "\x1b]7;file:///c:/x\x07 \x1b]633;A\x07 \x1b]133;D;0\x07 ",
            "\x1b]8;;https://x\x07link\x1b]8;;\x07 \x1b]1337;base64;\x07",
            "\x1b]50;?\x07 \x1b]2;t2\x1b\\ tail",
        );
        assert_split_invariant(stream.as_bytes());
    }

    #[test]
    fn split_invariant_utf8_and_terminators() {
        // Multibyte UTF-8 inside payloads + both terminator kinds, split
        // at every byte.
        let stream =
            "\x1b]7;/home/caf\u{e9}\u{1f680}\x1b\\\x1b]633;P;Cwd=\u{5927}\x07\x1b]0;\u{3c0}\x07"
                .as_bytes();
        assert_split_invariant(stream);
    }

    #[test]
    fn strips_legacy_and_dead_osc_numbers() {
        let stream = b"a\x1b]50;?\x07b\x1b]1337;X\x07c\x1b]1338;\x07d\x1b]1339;1\x1b\\e";
        let (clean, payloads) = oracle_strip(stream);
        assert_eq!(
            std::str::from_utf8(&clean).unwrap(),
            "abcde",
            "50/1337/1338/1339 must be stripped"
        );
        assert_eq!(payloads.len(), 4);
        let (got, _) = run_impl(&[stream]);
        assert_eq!(got, clean);
        assert_split_invariant(stream);
    }

    #[test]
    fn strips_osc50_both_forms() {
        // The query form is the echoback vector; both forms must vanish.
        for stream in [
            b"\x1b]50;?\x07".as_slice(),
            b"\x1b]50;#aabbcc\x07".as_slice(),
            b"\x1b]50;?\x1b\\".as_slice(),
            b"x\x1b]50;\x07y".as_slice(),
        ] {
            let (clean, _) = run_impl(&[stream]);
            assert!(!clean.contains(&0x1b), "OSC 50 leaked: {clean:?}");
            assert_split_invariant(stream);
        }
    }

    #[test]
    fn osc52_handling() {
        // Set form (selections `0`, `c`, comma list `0,s`) → Osc52Set, stripped.
        // Empty payload clears the clipboard. Query form → Osc52Query, stripped.
        // Unsupported selection (1) → stripped with no event.
        let stream = b"a\x1b]52;0;SGVsbG8=\x07b\x1b]52;c;?\x1b\\c\x1b]52;1;QUFB\x07d";
        let (clean, keys) = run_impl(&[stream]);
        assert_eq!(clean, b"abcd", "OSC 52 must be stripped");
        assert_eq!(keys, vec!["Osc52Set(SGVsbG8=)", "Osc52Query(c)"]);
        assert_split_invariant(stream);

        let (clean, keys) = run_impl(&[b"\x1b]52;c;\x07\x1b]52;0,s;Zg==\x07"]);
        assert!(!clean.contains(&0x1b), "OSC 52 leaked: {clean:?}");
        assert_eq!(keys, vec!["Osc52Set()", "Osc52Set(Zg==)"]);
        assert_split_invariant(b"\x1b]52;c;\x07\x1b]52;0,s;Zg==\x07");
    }

    #[test]
    fn oversized_unterminated_osc_discarded() {
        // Unterminated OSC far beyond the cap: everything up to the stream
        // end must be discarded, and memory must stay bounded (the stripper
        // must not buffer it).
        let big = vec![b'x'; MAX_OSC_LEN + 4096];
        let mut stream = b"head \x1b]0;".to_vec();
        stream.extend_from_slice(&big);
        let (clean, _) = run_impl(&[&stream]);
        assert_eq!(clean, b"head ".to_vec());
        // Chunked in a pathological way: 1-byte chunks.
        let chunks: Vec<&[u8]> = stream.iter().map(std::slice::from_ref).collect();
        let (clean2, _) = run_impl(&chunks);
        assert_eq!(clean2, b"head ".to_vec(), "1-byte chunking must agree");
    }

    #[test]
    fn oversized_osc_with_late_terminator() {
        // The cap is exceeded, but a BEL eventually arrives: everything up
        // to and including the BEL is discarded, then normal processing
        // resumes.
        let mut stream = b"a\x1b]7;".to_vec();
        stream.extend_from_slice(&vec![b'y'; MAX_OSC_LEN]);
        stream.extend_from_slice(b"\x07after\x1b]133;A\x07z");
        let (clean, _) = run_impl(&[&stream]);
        assert_eq!(clean, b"aafterz".to_vec());
        // Split so the BEL straddles chunk boundaries (cuts must stay in
        // bounds; the BEL sits at MAX_OSC_LEN + 5).
        for cut in [MAX_OSC_LEN, MAX_OSC_LEN + 1, MAX_OSC_LEN + 4] {
            let (a, b) = stream.split_at(cut);
            let (clean2, _) = run_impl(&[a, b]);
            assert_eq!(clean2, b"aafterz".to_vec(), "cut at {cut}");
        }
    }

    #[test]
    fn oversized_then_sequences_resume_same_chunk() {
        // After the oversized discard ends, further sequences in the SAME
        // chunk must still be processed normally.
        let mut stream = b"\x1b]0;".to_vec();
        stream.extend_from_slice(&vec![b'p'; MAX_OSC_LEN]);
        stream.extend_from_slice(b"\x1b\\text\x1b]133;D;42\x07tail");
        let (clean, keys) = run_impl(&[&stream]);
        assert_eq!(clean, b"texttail".to_vec());
        assert!(keys.iter().any(|k| k == "CommandDone(Some(42))"));
    }

    #[test]
    fn oversized_osc_split_accumulation() {
        // The cap must also hold when the payload accumulates across many
        // small chunks (the partial-buffer growth path). The payload must
        // actually exceed the cap; chunked and whole-stream runs must agree.
        let mut chunks = vec![b"\x1b]0;".as_slice()];
        let payload = vec![b'q'; MAX_OSC_LEN + 4096];
        chunks.extend(payload.chunks(1024));
        let (clean, _) = run_impl(&chunks);
        assert!(clean.is_empty(), "partial must not leak: {clean:?}");
        let (clean2, _) = run_impl(&[chunks.concat().as_slice()]);
        assert_eq!(clean2, clean);
    }

    #[test]
    fn strips_empty_and_degenerate_oscs() {
        for stream in [
            b"\x1b]0;\x1b\\".as_slice(),
            b"\x1b]7;\x07".as_slice(),
            b"\x1b]133;\x07".as_slice(),
            b"\x1b]133\x07".as_slice(),
            b"\x1b]\x07".as_slice(),
            b"\x1b]50\x07".as_slice(),
        ] {
            let (clean, _) = run_impl(&[stream]);
            assert!(!clean.contains(&0x1b), "degenerate OSC leaked: {clean:?}");
            assert_split_invariant(stream);
        }
    }

    #[test]
    fn esc_runs_and_adjacent_sequences() {
        // Exact expected outputs. Note: `ESC ] ESC ...` is ONE malformed OSC
        // whose payload contains an ESC (only ST terminates an OSC — same
        // state-machine semantics as xterm), so it passes through whole.
        let cases: Vec<(Vec<u8>, Vec<u8>, Vec<&str>)> = vec![
            (
                b"\x1b\x1b]0;t\x07".to_vec(),
                b"\x1b".to_vec(),
                vec!["Title(t)"],
            ),
            (
                b"\x1b\x1b\x1b]7;x\x07".to_vec(),
                b"\x1b\x1b".to_vec(),
                vec!["Cwd(x)"],
            ),
            (
                b"\x1b]0;a\x07\x1b]133;A\x07\x1b]8;;u\x07".to_vec(),
                b"\x1b]8;;u\x07".to_vec(),
                vec!["Title(a)", "PromptStart"],
            ),
            // Nested ESC: single OSC with payload `A ESC ]133;B` — the number
            // still parses as 133, so it is stripped (no event); only when
            // the ESC lands inside the *number* does the sequence become
            // unrecognized and pass through (xterm's state machine agrees).
            (b"\x1b]133;A\x1b]133;B\x07".to_vec(), b"".to_vec(), vec![]),
            (
                b"\x1b]\x1b]7;x\x07".to_vec(),
                b"\x1b]\x1b]7;x\x07".to_vec(),
                vec![],
            ),
        ];
        for (stream, expected, expected_keys) in &cases {
            assert_split_invariant(stream);
            let (clean, keys) = run_impl(&[stream]);
            assert_eq!(clean, *expected, "stream {stream:?}");
            assert_eq!(keys, *expected_keys, "stream {stream:?}");
        }
    }

    #[test]
    fn control_bytes_inside_payloads() {
        // CAN/SUB/other control bytes inside an OSC payload must not break
        // terminator detection (BEL/ST still win).
        for stream in [
            b"\x1b]0;a\x18b\x07".as_slice(),
            b"\x1b]7;c\x1ac\x1b\\".as_slice(),
            b"\x1b]50;\x18\x1a?\x07".as_slice(),
        ] {
            let (clean, _) = run_impl(&[stream]);
            assert!(
                !clean.contains(&0x1b),
                "control-laced OSC leaked: {clean:?}"
            );
            assert_split_invariant(stream);
        }
    }

    #[test]
    fn invalid_utf8_passthrough_unchanged() {
        // Non-UTF-8 payloads are not ours to interpret: the complete
        // sequence passes through byte-for-byte (and chunking must agree).
        let stream = b"\x1b]0;\xff\xfe\x80\x07".as_slice();
        let (clean, keys) = run_impl(&[stream]);
        assert_eq!(clean, stream);
        assert!(keys.is_empty());
        assert_split_invariant(stream);
        // Same for a recognized-number OSC with non-UTF-8 payload.
        let stream2 = b"\x1b]7;\xff\x07".as_slice();
        let (clean2, _) = run_impl(&[stream2]);
        assert_eq!(clean2, stream2);
    }

    #[test]
    fn matches_oracle_on_adversarial_cases() {
        // Reference-vs-impl over a grab-bag of adversarial fragments.
        let cases: Vec<Vec<u8>> = vec![
            b"\x1b]0;x\x1b\x1b]1;y\x07".to_vec(),
            b"\x1b]7;\x07".to_vec(),
            b"\x1b]133;\x07".to_vec(),
            b"\x1b];\x07".to_vec(),
            b"\x1b]".to_vec(),
            b"\x1b\x1b]0;t\x1b\\".to_vec(),
            b"a\x1b]2;\x1b\\b".to_vec(),
            b"\x1b]0;partial".to_vec(),
            b"\x1b]0;t\x07\x1b".to_vec(),
            b"\x1b[31mred\x1b[0m".to_vec(),
            b"\x1b]50;?\x07x\x1b]1337;\x07".to_vec(),
            b"\x1b]8;;https://x\x07link".to_vec(),
        ];
        for case in &cases {
            let (expected, _) = oracle_strip(case);
            let (got, _) = run_impl(&[case]);
            assert_eq!(got, expected, "case {case:?}");
        }
    }
}

/// Decode `\xHH` and `\\` escapes used in OSC payloads.
fn osc_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.peek().copied() {
                Some('x') | Some('X') => {
                    chars.next();
                    let h1 = chars.next().and_then(|c| c.to_digit(16));
                    let h2 = chars.next().and_then(|c| c.to_digit(16));
                    if let (Some(a), Some(b)) = (h1, h2)
                        && let Some(ch) = char::from_u32(a * 16 + b)
                    {
                        out.push(ch);
                        continue;
                    }
                    out.push('\\');
                }
                Some('\\') => {
                    chars.next();
                    out.push('\\');
                }
                _ => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Extract a local path from an OSC 7 `file://` payload.
fn osc7_parse_cwd(payload: &str) -> Option<String> {
    let raw = payload.trim();
    if raw.is_empty() {
        return None;
    }
    let path = if let Some(rest) = raw
        .strip_prefix("file://")
        .or_else(|| raw.strip_prefix("FILE://"))
    {
        if rest.starts_with('/') {
            // file:///C:/path  or  file:///posix/path
            let trimmed = rest.trim_start_matches('/');
            let decoded = percent_decode(trimmed)?;
            if decoded.len() >= 2 && decoded.as_bytes()[1] == b':' {
                // Windows drive letter
                decoded.replace('/', "\\")
            } else {
                // POSIX absolute
                format!("/{}", decoded)
            }
        } else {
            // file://server/share  →  UNC
            let decoded = percent_decode(rest)?;
            format!("\\\\{}", decoded).replace('/', "\\")
        }
    } else {
        raw.to_string()
    };
    if path.is_empty() { None } else { Some(path) }
}

/// Simple percent-decoder for OSC 7 URIs (ASCII-safe; UTF-8 sequences decoded as bytes).
fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16)?;
            let lo = (bytes[i + 2] as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Common Unix absolute roots that must never be treated as MSYS `/x/...` drives.
fn looks_like_unix_root(path: &str) -> bool {
    const ROOTS: &[&str] = &[
        "/home", "/usr", "/etc", "/var", "/tmp", "/opt", "/mnt", "/root", "/dev", "/proc", "/sys",
        "/bin", "/lib", "/sbin", "/boot", "/media", "/run", "/snap",
    ];
    ROOTS.iter().any(|root| {
        path == *root
            || path
                .strip_prefix(root)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

/// Normalise a `Cwd=` value from OSC 633 P to a Windows absolute path when possible.
fn osc633_normalize_cwd(value: &str, is_windows: Option<&str>) -> String {
    let raw = value.trim();
    if raw.is_empty() {
        return String::new();
    }
    let is_windows = is_windows
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(true); // default to Windows since that's the target platform

    if !is_windows {
        return raw.to_string();
    }

    // Already an absolute Windows path: C:\... or C:/...
    if raw.len() >= 2 && raw.as_bytes()[1] == b':' {
        return raw.replace('/', "\\");
    }
    // UNC: \\server\share or //server/share (incl. \\wsl$\Distro\...)
    if let Some(rest) = raw.strip_prefix("//").or_else(|| raw.strip_prefix("\\\\")) {
        return format!("\\\\{}", rest.replace('/', "\\"));
    }
    // /C:/ or /C:\ style (from some shells)
    if raw.starts_with('/') && raw.len() >= 4 && raw.as_bytes()[2] == b':' {
        return raw[1..].replace('/', "\\");
    }
    // WSL /mnt/x/... → X:\... (must run before MSYS single-letter conversion)
    if let Some(rest) = raw.strip_prefix("/mnt/") {
        let mut ch = rest.chars();
        if let Some(drive) = ch.next()
            && drive.is_ascii_alphabetic()
            && rest.as_bytes().get(1) == Some(&b'/')
        {
            return format!(
                "{}:\\{}",
                drive.to_ascii_uppercase(),
                rest[2..].replace('/', "\\")
            );
        }
    }
    // MSYS /x/path → X:\path (never rewrite /home, /usr, …)
    if raw.starts_with('/') && !looks_like_unix_root(raw) {
        let rest = &raw[1..];
        let mut chars = rest.chars();
        if let Some(drive) = chars.next()
            && drive.is_ascii_alphabetic()
        {
            match chars.next() {
                Some('/') => {
                    return format!(
                        "{}:\\{}",
                        drive.to_ascii_uppercase(),
                        chars.as_str().replace('/', "\\")
                    );
                }
                None => {
                    return format!("{}:\\", drive.to_ascii_uppercase());
                }
                Some(_) => {}
            }
        }
    }
    // file:// URI fallback
    if raw.contains("://")
        && let Some(p) = osc7_parse_cwd(raw)
    {
        return p;
    }
    raw.to_string()
}

pub struct PtySession {
    master: Arc<parking_lot::Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<parking_lot::Mutex<Box<dyn Write + Send>>>,
    child: Arc<parking_lot::Mutex<Option<Box<dyn Child + Send + Sync>>>>,
    stop: Arc<AtomicBool>,
    replay_buffer: Arc<parking_lot::Mutex<Vec<u8>>>,
    /// Live binary output channel.  Swapped on each `pty_ensure` so a rebuilt
    /// webview re-subscribes without restarting the reader/emitter threads.
    output_channel: Arc<parking_lot::Mutex<Option<Channel<InvokeResponseBody>>>>,
    /// Emitted on `pty-output` / `pty-exit` for multi-pane routing.
    /// Stored behind a Mutex so that pre-warmed sessions can be adopted
    /// by a real pane without restarting the reader/emitter threads.
    pub session_id: Arc<parking_lot::Mutex<String>>,
    _reader: JoinHandle<()>,
    _emitter: JoinHandle<()>,
    _waiter: JoinHandle<()>,
}

impl PtySession {
    pub fn spawn(
        app: AppHandle,
        session_id: String,
        cols: u16,
        rows: u16,
        prefs: &Prefs,
        initial_cwd: Option<String>,
    ) -> Result<Self, String> {
        Self::spawn_with_profile(app, session_id, cols, rows, prefs, initial_cwd, None)
    }

    pub fn spawn_with_profile(
        app: AppHandle,
        session_id: String,
        cols: u16,
        rows: u16,
        prefs: &Prefs,
        initial_cwd: Option<String>,
        profile: Option<&ConnectionProfile>,
    ) -> Result<Self, String> {
        let mut prefs = prefs.clone();
        if let Some(cwd) = initial_cwd {
            prefs.initial_cwd = Some(cwd);
        }
        // Opt-in sideloaded OpenConsole host (see `terminal.experimental`.
        // sideload_openconsole). Must be set before the first PsuedoCon.
        portable_pty::win::set_sideload_openconsole(prefs.terminal_sideload_openconsole);
        let system = native_pty_system();
        let pair = system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let cmd = shell_command_for_profile(&prefs, profile)?;
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let master = pair.master;
        let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = master.take_writer().map_err(|e| e.to_string())?;

        let master = Arc::new(parking_lot::Mutex::new(master));
        let writer = Arc::new(parking_lot::Mutex::new(writer));
        let child = Arc::new(parking_lot::Mutex::new(Some(child)));
        let stop = Arc::new(AtomicBool::new(false));
        let replay_buffer = Arc::new(parking_lot::Mutex::new(Vec::with_capacity(256 * 1024)));
        let output_channel = Arc::new(parking_lot::Mutex::new(None));

        let session_id_arc = Arc::new(parking_lot::Mutex::new(session_id.clone()));

        let (tx, rx) = sync_channel::<Vec<u8>>(48);
        let stop_reader = Arc::clone(&stop);
        let _reader = thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 65536];
            while !stop_reader.load(Ordering::SeqCst) {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        if tx.send(chunk).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        break;
                    }
                }
            }
        });

        let stop_emitter = Arc::clone(&stop);
        let replay_emitter = Arc::clone(&replay_buffer);
        let app_emit = app.clone();
        let session_id_emitter = Arc::clone(&session_id_arc);
        let output_channel_emitter = Arc::clone(&output_channel);
        // OSC 52 replies write back into the PTY; clone the writer for the
        // emitter thread (the `PtySession::write` path locks the same mutex).
        let writer_osc = Arc::clone(&writer);
        let osc52 = prefs.osc52;
        // NOTE: do NOT capture a `WebviewWindow` here.  When
        // `destroy_webview_on_hide` is enabled (the default), the main webview
        // is torn down on hide and rebuilt on summon; a handle captured at PTY
        // spawn time would point at the dead webview and silently lose every
        // `eval` after the first dismiss.  Instead the frontend re-subscribes
        // an output `Channel` on every `pty_ensure` and, while no live channel
        // is attached, `pending` is retained so the live shell process simply
        // back-pressures until the next subscription is ready — letting the
        // session transparently reattach on resummon.
        let _emitter = thread::spawn(move || {
            let batch_window = Duration::from_millis(PTY_OUTPUT_BATCH_MS);
            let mut pending = Vec::<u8>::with_capacity(16 * 1024);
            let mut stripper = OscStripper::new();
            // Batch that was stripped but could not be delivered (webview down
            // or channel not subscribed yet); retried on the next iteration.
            let mut held: Option<HeldBatch> = None;
            while !stop_emitter.load(Ordering::SeqCst) {
                // Whether the batch held from the previous iteration was
                // already appended to the replay buffer.
                let held_replayed = held.as_ref().is_some_and(|h| h.replayed);
                if let Some(h) = held.take() {
                    pending = h.bytes;
                }
                if pending.is_empty() {
                    match rx.recv() {
                        Ok(chunk) => pending.extend_from_slice(&chunk),
                        Err(_) => break,
                    }
                }

                let started = Instant::now();
                let mut disconnected = false;
                // Interactive fast-path: probe for queued chunks first. When the
                // channel is empty (single-chunk echo from a keystroke), flush
                // immediately instead of waiting out the batch window; once a
                // second chunk arrives we know it's a stream and fall back to
                // windowed batching.
                let mut idle_probe = true;
                while pending.len() < PTY_OUTPUT_BATCH_BYTES {
                    let elapsed = started.elapsed();
                    if elapsed >= batch_window {
                        break;
                    }
                    let wait = if idle_probe {
                        Duration::ZERO
                    } else {
                        batch_window - elapsed
                    };
                    match rx.recv_timeout(wait) {
                        Ok(chunk) => {
                            pending.extend_from_slice(&chunk);
                            idle_probe = false;
                        }
                        Err(RecvTimeoutError::Timeout) => break,
                        Err(RecvTimeoutError::Disconnected) => {
                            disconnected = true;
                            break;
                        }
                    }
                }

                if !pending.is_empty() {
                    let sid = session_id_emitter.lock().clone();

                    // Hold while JS has not finished scrollback restore.
                    let unlocked = app_emit
                        .state::<crate::AppState>()
                        .pty_output_unlocked
                        .load(Ordering::SeqCst);
                    if !unlocked {
                        if pending.len() > PTY_PENDING_HOLD_MAX_BYTES {
                            let excess = pending.len() - PTY_PENDING_HOLD_MAX_BYTES;
                            pending.drain(..excess);
                        }
                        thread::sleep(Duration::from_millis(20));
                        continue;
                    }

                    // Strip OSC 7 / 133 / 633 in Rust; emit side-channel events.
                    // `process` takes ownership of the batch: escape-free
                    // batches come back untouched (zero-copy fast path).
                    let (cleaned_bytes, osc_events) =
                        stripper.process(std::mem::take(&mut pending));

                    for ev in osc_events {
                        match ev {
                            OscSideEvent::Cwd(cwd) => {
                                let remote_is_windows = stripper
                                    .properties
                                    .is_windows
                                    .as_deref()
                                    .map(|v| v.eq_ignore_ascii_case("true"));
                                let _ = app_emit.emit(
                                    "pty-cwd",
                                    PtyCwdEvent {
                                        session_id: sid.clone(),
                                        cwd,
                                        remote_is_windows,
                                    },
                                );
                            }
                            OscSideEvent::Title(title) => {
                                let _ = app_emit.emit(
                                    "pty-title",
                                    PtyTitleEvent {
                                        session_id: sid.clone(),
                                        title,
                                    },
                                );
                            }
                            OscSideEvent::PromptStart => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        session_id: sid.clone(),
                                        event: ShellEventKind::PromptStart,
                                    },
                                );
                            }
                            OscSideEvent::PromptEnd => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        session_id: sid.clone(),
                                        event: ShellEventKind::PromptEnd,
                                    },
                                );
                            }
                            OscSideEvent::PreExec => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        session_id: sid.clone(),
                                        event: ShellEventKind::PreExec,
                                    },
                                );
                            }
                            OscSideEvent::CommandDone(code) => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        session_id: sid.clone(),
                                        event: ShellEventKind::CommandDone { exit_code: code },
                                    },
                                );
                            }
                            OscSideEvent::CommandLine(text_ev) => {
                                let _ = app_emit.emit(
                                    "pty-shell-event",
                                    PtyShellEvent {
                                        session_id: sid.clone(),
                                        event: ShellEventKind::CommandLine { text: text_ev },
                                    },
                                );
                            }
                            OscSideEvent::Osc52Set(payload) => {
                                if !osc52 {
                                    continue;
                                }
                                if let Some(decoded) = clipboard::base64_decode(&payload) {
                                    let text = String::from_utf8_lossy(&decoded);
                                    let _ = clipboard::write_text(&text);
                                }
                            }
                            OscSideEvent::Osc52Query(selection) => {
                                if !osc52 {
                                    continue;
                                }
                                if let Ok(text) = clipboard::read_text() {
                                    let encoded = clipboard::base64_encode(text.as_bytes());
                                    let reply = format!("\x1b]52;{selection};{encoded}\x1b\\");
                                    let mut w = writer_osc.lock();
                                    let _ = w.write_all(reply.as_bytes());
                                    let _ = w.flush();
                                }
                            }
                        }
                    }

                    // Deliver raw bytes over the live output channel.  When no
                    // channel is attached (webview torn down / not yet
                    // subscribed) or the send fails, hold the cleaned batch
                    // and retry so no output is lost across a rebuild.
                    let channel: Option<Channel<InvokeResponseBody>> =
                        output_channel_emitter.lock().clone();
                    let Some(ch) = channel else {
                        let mut h = HeldBatch {
                            bytes: cleaned_bytes,
                            replayed: held_replayed,
                        };
                        if h.bytes.len() > PTY_PENDING_HOLD_MAX_BYTES {
                            h.bytes
                                .drain(..(h.bytes.len() - PTY_PENDING_HOLD_MAX_BYTES));
                        }
                        held = Some(h);
                        thread::sleep(Duration::from_millis(20));
                        continue;
                    };
                    // Append to replay before sending, so a failed delivery can
                    // be reconstructed from the replay tail without cloning.
                    if !held_replayed {
                        append_replay_buffer(&replay_emitter, &cleaned_bytes);
                    }
                    let batch_len = cleaned_bytes.len();
                    if ch.send(InvokeResponseBody::Raw(cleaned_bytes)).is_err() {
                        // The batch is exactly the replay tail (it was the last
                        // append); recover it byte-for-byte for the retry.
                        let tail = {
                            let r = replay_emitter.lock();
                            let start = r.len().saturating_sub(batch_len);
                            r[start..].to_vec()
                        };
                        let mut h = HeldBatch {
                            bytes: tail,
                            replayed: true,
                        };
                        if h.bytes.len() > PTY_PENDING_HOLD_MAX_BYTES {
                            h.bytes
                                .drain(..(h.bytes.len() - PTY_PENDING_HOLD_MAX_BYTES));
                        }
                        held = Some(h);
                        thread::sleep(Duration::from_millis(20));
                        continue;
                    }
                    // Fresh accumulator for the next batch (the old one was
                    // moved into the channel).
                    pending = Vec::with_capacity(32 * 1024);
                }

                if disconnected {
                    break;
                }
            }
        });

        // Stock ConPTY never closes the output pipe on its own, so exit
        // detection is a blocking wait on the topmost shell's process object
        // — the kernel signals it exactly when the shell terminates.
        let exit_handle: Option<OwnedHandle> = child
            .lock()
            .as_ref()
            .and_then(|c| c.as_raw_handle())
            .and_then(|h| {
                let mut dup: HANDLE = std::ptr::null_mut();
                let ok = unsafe {
                    DuplicateHandle(
                        GetCurrentProcess(),
                        h as _,
                        GetCurrentProcess(),
                        &mut dup,
                        0,
                        0,
                        DUPLICATE_SAME_ACCESS,
                    )
                };
                (ok != 0).then(|| unsafe { OwnedHandle::from_raw_handle(dup) })
            });
        let stop_waiter = Arc::clone(&stop);
        let app_waiter = app.clone();
        let session_id_waiter = Arc::clone(&session_id_arc);
        let _waiter = thread::spawn(move || {
            let Some(handle) = exit_handle else {
                return;
            };
            unsafe { WaitForSingleObject(handle.as_raw_handle() as _, INFINITE) };
            // One-time grace so the conhost can flush the final output.
            thread::sleep(Duration::from_millis(60));
            if stop_waiter.load(Ordering::SeqCst) {
                return;
            }
            let sid = session_id_waiter.lock().clone();
            let _ = app_waiter.emit("pty-exit", PtyExitEvent { session_id: sid });
        });

        Ok(Self {
            master,
            writer,
            child,
            stop,
            replay_buffer,
            output_channel,
            session_id: session_id_arc,
            _reader,
            _emitter,
            _waiter,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut w = self.writer.lock();
        w.write_all(data).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())
    }

    /// Attach (or replace) the live output channel.  Called on every
    /// `pty_ensure` so a freshly built webview re-subscribes.
    pub fn set_output_channel(&self, channel: Channel<InvokeResponseBody>) {
        *self.output_channel.lock() = Some(channel);
    }

    pub fn replay_snapshot(&self) -> Vec<u8> {
        self.replay_buffer.lock().clone()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(mut c) = self.child.lock().take() {
            let _ = c.kill();
        }
    }
}

fn append_replay_buffer(buf: &Arc<parking_lot::Mutex<Vec<u8>>>, bytes: &[u8]) {
    let mut replay = buf.lock();
    if replay.len() + bytes.len() > PTY_REPLAY_BUFFER_BYTES {
        let excess = replay.len() + bytes.len() - PTY_REPLAY_BUFFER_BYTES;
        let mut drain_to = excess.min(replay.len());
        // Never cut a UTF-8 sequence in half at the start of the buffer.
        while drain_to < replay.len() && (replay[drain_to] & 0xC0) == 0x80 {
            drain_to += 1;
        }
        replay.drain(..drain_to);
    }
    replay.extend_from_slice(bytes);
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

fn pwsh_standard_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        v.push(
            PathBuf::from(pf)
                .join("PowerShell")
                .join("7")
                .join("pwsh.exe"),
        );
    }
    if let Ok(pfx86) = std::env::var("ProgramFiles(x86)") {
        v.push(
            PathBuf::from(pfx86)
                .join("PowerShell")
                .join("7")
                .join("pwsh.exe"),
        );
    }
    if let Ok(la) = std::env::var("LOCALAPPDATA") {
        v.push(
            PathBuf::from(la)
                .join("Microsoft")
                .join("WindowsApps")
                .join("pwsh.exe"),
        );
    }
    v
}

/// Resolve PowerShell 7+ for GUI apps where `PATH` may omit the install directory.
/// Prefer well-known install paths before scanning `PATH` (works when PATH is wrong).
fn resolve_pwsh_executable() -> Option<PathBuf> {
    for p in pwsh_standard_paths() {
        if p.is_file() {
            return Some(p);
        }
    }
    resolve_on_path("pwsh.exe")
}

/// Standard Git for Windows `bin\bash.exe` locations (not `sh.exe`).
fn git_bash_standard_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    for pf_var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(pf) = std::env::var(pf_var) {
            v.push(PathBuf::from(&pf).join("Git").join("bin").join("bash.exe"));
        }
    }
    if let Ok(la) = std::env::var("LOCALAPPDATA") {
        v.push(
            PathBuf::from(la)
                .join("Programs")
                .join("Git")
                .join("bin")
                .join("bash.exe"),
        );
    }
    v
}

pub fn resolve_git_bash_executable() -> Option<PathBuf> {
    git_bash_standard_paths().into_iter().find(|p| p.is_file())
}

fn is_git_bash_path(path: &Path) -> bool {
    let Some(path_str) = path.to_str() else {
        return false;
    };
    let normalized = path_str.replace('/', "\\").to_ascii_lowercase();
    normalized.contains("\\git\\bin\\bash.exe") || normalized.contains("\\git\\usr\\bin\\bash.exe")
}

fn is_wsl_bash_shim(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|n| n.eq_ignore_ascii_case("bash.exe"))
        && path
            .parent()
            .and_then(|p| p.file_name())
            .is_some_and(|n| n.eq_ignore_ascii_case("System32"))
}

fn is_bash_executable_path(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("bash.exe"))
}

fn resolve_bash_executable(prefs: &Prefs) -> Result<CommandBuilder, String> {
    let trimmed = prefs.shell.trim().trim_matches(|c| c == '"' || c == '\'');
    if !trimmed.is_empty() {
        let path = Path::new(trimmed);
        if (trimmed.contains('\\') || trimmed.contains('/') || trimmed.ends_with(".exe"))
            && is_bash_executable_path(path)
        {
            return Ok(CommandBuilder::new(path));
        }
    }
    if let Some(p) = resolve_git_bash_executable() {
        return Ok(CommandBuilder::new(p));
    }
    if let Some(p) = resolve_on_path("bash.exe") {
        if !is_wsl_bash_shim(&p) {
            return Ok(CommandBuilder::new(p));
        }
        return Ok(CommandBuilder::new("bash.exe"));
    }
    Err("bash.exe not found. Set the profile `shell` to a full path.".to_string())
}

#[derive(serde::Serialize, Clone)]
pub struct DetectedShell {
    pub name: String,
    pub path: String,
}

pub fn detected_shell_profile_field(name: &str, path: &str) -> String {
    if is_git_bash_path(Path::new(path)) {
        path.to_string()
    } else {
        name.to_string()
    }
}

fn push_shell_unique(shells: &mut Vec<DetectedShell>, name: &str, path: String) {
    if shells.iter().any(|s| s.name.eq_ignore_ascii_case(name)) {
        return;
    }
    shells.push(DetectedShell {
        name: name.to_string(),
        path,
    });
}

pub fn detect_available_shells() -> Vec<DetectedShell> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    const TTL: Duration = Duration::from_secs(45);
    static CACHE: Mutex<Option<(Instant, Vec<DetectedShell>)>> = Mutex::new(None);

    if let Ok(guard) = CACHE.lock()
        && let Some((at, shells)) = guard.as_ref()
        && at.elapsed() < TTL
    {
        return shells.clone();
    }

    let shells = detect_available_shells_uncached();
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some((Instant::now(), shells.clone()));
    }
    shells
}

fn detect_available_shells_uncached() -> Vec<DetectedShell> {
    // Collect env vars before spawning threads (avoids repeated env lookups and
    // keeps thread closures free of env-access races on Windows).
    let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());

    // Run shell detections concurrently.
    let (pwsh_result, powershell_result, cmd_result, bash_result, wsl_result) =
        std::thread::scope(|s| {
            // PowerShell 7 (pwsh)
            let pwsh =
                s.spawn(|| resolve_pwsh_executable().map(|p| p.to_string_lossy().into_owned()));

            // Windows PowerShell (powershell.exe)
            let ps_system_path = PathBuf::from(&sys_root)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe");
            let powershell = s.spawn(move || -> Option<String> {
                if ps_system_path.is_file() {
                    return Some(ps_system_path.to_string_lossy().into_owned());
                }
                resolve_on_path("powershell.exe").map(|p| p.to_string_lossy().into_owned())
            });

            // cmd.exe
            let cmd = s.spawn(move || -> Option<String> {
                if Path::new(&comspec).is_file() {
                    return Some(comspec);
                }
                resolve_on_path("cmd.exe").map(|p| p.to_string_lossy().into_owned())
            });

            // bash — Git for Windows install only (not PATH / WSL shim / sh.exe).
            let bash =
                s.spawn(|| resolve_git_bash_executable().map(|p| p.to_string_lossy().into_owned()));

            // WSL
            let wsl = s.spawn(|| -> Option<String> {
                resolve_on_path("wsl.exe").map(|p| p.to_string_lossy().into_owned())
            });

            (
                pwsh.join().unwrap_or(None),
                powershell.join().unwrap_or(None),
                cmd.join().unwrap_or(None),
                bash.join().unwrap_or(None),
                wsl.join().unwrap_or(None),
            )
        });

    let mut shells: Vec<DetectedShell> = Vec::new();
    if let Some(p) = pwsh_result {
        push_shell_unique(&mut shells, "pwsh", p);
    }
    if let Some(p) = powershell_result {
        push_shell_unique(&mut shells, "powershell", p);
    }
    if let Some(p) = cmd_result {
        push_shell_unique(&mut shells, "cmd", p);
    }
    if let Some(p) = bash_result {
        push_shell_unique(&mut shells, "bash", p);
    }
    if let Some(p) = wsl_result {
        push_shell_unique(&mut shells, "wsl", p);
    }
    shells
}

fn normalize_shell_token(raw: &str) -> String {
    raw.trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_lowercase()
}

fn strip_exe_suffix(s: &mut String) {
    if s.len() > 4 && s.ends_with(".exe") {
        s.truncate(s.len() - 4);
    }
}

fn is_pwsh_alias(shell: &str) -> bool {
    matches!(
        shell,
        "pwsh"
            | "pwsh-preview"
            | "powershell-core"
            | "powershellcore"
            | "powershell_7"
            | "powershell7"
            | "powershell-7"
            | "ps7"
    )
}

fn apply_cwd(mut cmd: CommandBuilder, prefs: &Prefs) -> Result<CommandBuilder, String> {
    if let Some(dir) = prefs.initial_cwd.as_deref()
        && Path::new(dir).is_dir()
    {
        cmd.cwd(dir);
    }
    Ok(cmd)
}

/// ConPTY session always starts the Windows host shell (`COMSPEC`, usually `cmd.exe`), then we
/// launch the resolved interactive shell directly so integration is active on the first prompt.
#[allow(dead_code)]
fn shell_command(prefs: &Prefs) -> Result<CommandBuilder, String> {
    windows_shell_command(prefs, None)
}

fn profile_startup(profile: Option<&ConnectionProfile>) -> Option<&str> {
    profile?
        .startup_command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn append_ps_command(mut command: String, startup: Option<&str>) -> String {
    if let Some(cmd) = startup {
        command.push(';');
        command.push(' ');
        command.push_str(cmd);
    }
    command
}

/// Build a PTY command for a connection profile (local shell, WSL distro, SSH).
pub fn shell_command_for_profile(
    prefs: &Prefs,
    profile: Option<&ConnectionProfile>,
) -> Result<CommandBuilder, String> {
    match profile.map(|p| &p.kind) {
        Some(ProfileKind::Wsl) => {
            let distro = profile
                .and_then(|p| p.wsl_distro.as_deref())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "WSL profile is missing wsl_distro".to_string())?;
            wsl_distro_command(prefs, distro, profile)
        }
        Some(ProfileKind::Ssh) => {
            let p = profile.ok_or_else(|| "SSH profile missing".to_string())?;
            ssh_profile_command(p)
        }
        Some(ProfileKind::Local) | None => windows_shell_command(prefs, profile),
    }
}

/// Launch an installed WSL distribution (`wsl.exe -d <name>`), injecting bash/zsh
/// shell integration when the distro's login shell supports it.
fn wsl_distro_command(
    prefs: &Prefs,
    distro: &str,
    profile: Option<&ConnectionProfile>,
) -> Result<CommandBuilder, String> {
    let startup = profile_startup(profile);
    let mut c = CommandBuilder::new("wsl.exe");
    c.arg("-d");
    c.arg(distro);
    if let Some(dir) = prefs
        .initial_cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // WSL accepts Windows or Linux paths via --cd (same as Windows Terminal).
        c.arg("--cd");
        c.arg(dir);
    }

    let version = env!("CARGO_PKG_VERSION");
    c.env("TERM_PROGRAM", "partty");
    c.env("TERM_PROGRAM_VERSION", version);

    match detect_wsl_login_shell(distro) {
        WslLoginShell::Zsh => {
            let script = write_shell_integration_script(
                "partty-shell-integration.zsh",
                SHELL_INTEGRATION_ZSH,
            )?;
            let script_wsl = windows_path_to_wsl_mnt(&script)?;
            let zdot = ensure_zsh_zdot(&script_wsl, startup)?;
            let zdot_wsl = windows_path_to_wsl_mnt(&zdot)?;
            // Pass ZDOTDIR inside Linux via `env` (Windows env is not forwarded by default).
            c.arg("--exec");
            c.arg("env");
            c.arg(format!("ZDOTDIR={zdot_wsl}"));
            c.arg("PARTTY_ORIGINAL_ZDOTDIR=");
            c.arg("TERM_PROGRAM=partty");
            c.arg(format!("TERM_PROGRAM_VERSION={version}"));
            c.arg("PARTTY_SHELL_INTEGRATION=1");
            c.arg("zsh");
            c.arg("-i");
            c.env("PARTTY_SHELL_INTEGRATION", "1");
        }
        WslLoginShell::Bash | WslLoginShell::Unknown => {
            // Prefer bash injection; Unknown falls back to bash (default on most distros).
            let script = write_shell_integration_script(
                "partty-shell-integration.bash",
                SHELL_INTEGRATION_BASH,
            )?;
            let script_wsl = windows_path_to_wsl_mnt(&script)?;
            let init = write_shell_integration_script(
                "partty-wsl-bash-init.sh",
                &wsl_bash_init_contents(&script_wsl, startup),
            )?;
            let init_wsl = windows_path_to_wsl_mnt(&init)?;
            c.arg("--exec");
            c.arg("bash");
            c.arg("--init-file");
            c.arg(init_wsl);
            c.arg("-i");
            c.env("PARTTY_SHELL_INTEGRATION", "1");
        }
        WslLoginShell::Other => {
            if let Some(cmd) = startup {
                c.arg("--exec");
                c.arg("bash");
                c.arg("-lic");
                c.arg(cmd);
            }
            c.env("PARTTY_SHELL_INTEGRATION", "0");
        }
    }

    Ok(c)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WslLoginShell {
    Bash,
    Zsh,
    Other,
    Unknown,
}

/// Probe the distro's login shell (`getent passwd`). Cached for the process lifetime.
fn detect_wsl_login_shell(distro: &str) -> WslLoginShell {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<HashMap<String, WslLoginShell>>> = Mutex::new(None);

    let key = distro.to_ascii_lowercase();
    if let Ok(guard) = CACHE.lock()
        && let Some(map) = guard.as_ref()
        && let Some(kind) = map.get(&key)
    {
        return *kind;
    }

    let kind = detect_wsl_login_shell_uncached(distro);
    if let Ok(mut guard) = CACHE.lock() {
        let map = guard.get_or_insert_with(HashMap::new);
        map.insert(key, kind);
    }
    kind
}

fn detect_wsl_login_shell_uncached(distro: &str) -> WslLoginShell {
    let mut cmd = std::process::Command::new("wsl.exe");
    cmd.args([
        "-d",
        distro,
        "-e",
        "sh",
        "-c",
        "getent passwd \"$(id -u)\" 2>/dev/null | cut -d: -f7 || echo \"$SHELL\"",
    ]);
    crate::subprocess::hide_console_window(&mut cmd);
    let Ok(out) = cmd.output() else {
        return WslLoginShell::Unknown;
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let shell = text.lines().next().unwrap_or("").trim();
    if shell.is_empty() {
        return WslLoginShell::Unknown;
    }
    let base = Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(shell)
        .to_ascii_lowercase();
    match base.as_str() {
        "bash" => WslLoginShell::Bash,
        "zsh" => WslLoginShell::Zsh,
        "sh" | "dash" => WslLoginShell::Bash, // inject via bash
        "fish" | "csh" | "tcsh" | "ksh" | "pwsh" => WslLoginShell::Other,
        _ => WslLoginShell::Unknown,
    }
}

/// Convert a Windows path to a WSL `/mnt/<drive>/...` path (no `wslpath` round-trip).
fn windows_path_to_wsl_mnt(path: &Path) -> Result<String, String> {
    let raw = path.to_string_lossy();
    let normalized = raw
        .strip_prefix(r"\\?\")
        .unwrap_or(raw.as_ref())
        .replace('\\', "/");
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let drive = normalized.chars().next().unwrap().to_ascii_lowercase();
        let rest = normalized[2..].trim_start_matches('/');
        if rest.is_empty() {
            return Ok(format!("/mnt/{drive}"));
        }
        return Ok(format!("/mnt/{drive}/{rest}"));
    }
    Err(format!(
        "cannot map path to WSL /mnt form: {}",
        path.display()
    ))
}

/// ZDOTDIR wrapper so integration survives interactive zsh startup (user `.zshrc` still loads).
fn host_bash_init_contents(script_unix: &str, startup: Option<&str>) -> String {
    let mut contents = format!(
        r#"[[ -f ~/.bashrc ]] && source ~/.bashrc
source "{script_unix}"
"#
    );
    if let Some(cmd) = startup {
        contents.push('\n');
        contents.push_str(cmd);
        if !cmd.ends_with('\n') {
            contents.push('\n');
        }
    }
    contents
}

fn wsl_bash_init_contents(script_wsl: &str, startup: Option<&str>) -> String {
    let mut contents = format!(
        r#"# Partty WSL bash init — login-style rc cascade, then integrate.
if [[ -f ~/.bash_profile ]]; then
  . ~/.bash_profile
elif [[ -f ~/.bash_login ]]; then
  . ~/.bash_login
elif [[ -f ~/.profile ]]; then
  . ~/.profile
elif [[ -f ~/.bashrc ]]; then
  . ~/.bashrc
fi
source "{script_wsl}"
"#
    );
    if let Some(cmd) = startup {
        contents.push('\n');
        contents.push_str(cmd);
        if !cmd.ends_with('\n') {
            contents.push('\n');
        }
    }
    contents
}

fn ensure_zsh_zdot(
    integration_script_unix: &str,
    startup: Option<&str>,
) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir()
        .join("partty-shell-integration")
        .join("zdot");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zshrc = dir.join(".zshrc");
    let mut contents = format!(
        r#"# Partty zsh ZDOTDIR wrapper — load user rc, then shell integration.
if [[ -n "${{PARTTY_ORIGINAL_ZDOTDIR}}" && -f "${{PARTTY_ORIGINAL_ZDOTDIR}}/.zshrc" ]]; then
  source "${{PARTTY_ORIGINAL_ZDOTDIR}}/.zshrc"
elif [[ -f "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi
source "{integration_script_unix}"
"#
    );
    if let Some(cmd) = startup {
        contents.push('\n');
        contents.push_str(cmd);
        if !cmd.ends_with('\n') {
            contents.push('\n');
        }
    }
    std::fs::write(&zshrc, contents).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Split a Windows-style commandline into executable + args (basic quotes).
fn split_commandline(raw: &str) -> Result<(String, Vec<String>), String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    for c in raw.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if !cur.is_empty() {
                    tokens.push(std::mem::take(&mut cur));
                }
            }
            _ => cur.push(c),
        }
    }
    if !cur.is_empty() {
        tokens.push(cur);
    }
    let mut iter = tokens.into_iter();
    let exe = iter
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "empty commandline".to_string())?;
    Ok((exe, iter.collect()))
}

/// OpenSSH client spawn — Windows Terminal style (`ssh user@host` / structured fields).
fn ssh_profile_command(profile: &ConnectionProfile) -> Result<CommandBuilder, String> {
    if let Some(cl) = profile
        .commandline
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let (exe, args) = split_commandline(cl)?;
        let mut c = CommandBuilder::new(exe);
        for a in args {
            c.arg(a);
        }
        c.env("TERM_PROGRAM", "partty");
        c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        c.env("PARTTY_SHELL_INTEGRATION", "0");
        return Ok(c);
    }

    let host = profile
        .ssh_host
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "SSH profile needs ssh_host or commandline (edit ~/.partty/profiles/*.toml)".to_string()
        })?;

    let mut c = CommandBuilder::new("ssh.exe");
    if let Some(port) = profile.ssh_port {
        c.arg("-p");
        c.arg(port.to_string());
    }
    if let Some(id_file) = profile
        .ssh_identity_file
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        c.arg("-i");
        c.arg(id_file);
    }
    for a in &profile.ssh_args {
        let t = a.trim();
        if !t.is_empty() {
            c.arg(t);
        }
    }

    let target = match profile
        .ssh_user
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(user) if !host.contains('@') => format!("{user}@{host}"),
        _ => host.to_string(),
    };

    if let Some(remote) = profile
        .startup_command
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        // Force a TTY so interactive remotes / remote shells work (WT pattern).
        c.arg("-t");
        c.arg(target);
        c.arg(remote);
    } else {
        c.arg(target);
    }

    c.env("TERM_PROGRAM", "partty");
    c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    c.env("PARTTY_SHELL_INTEGRATION", "0");
    Ok(c)
}

fn windows_host_shell(prefs: &Prefs) -> Result<CommandBuilder, String> {
    let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
    let c = CommandBuilder::new(comspec);
    apply_cwd(c, prefs)
}

fn write_shell_integration_script(name: &str, contents: &str) -> Result<PathBuf, String> {
    use std::sync::Mutex;
    static CACHE: Mutex<Option<std::collections::HashMap<String, PathBuf>>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap();
    let map = cache.get_or_insert_with(std::collections::HashMap::new);
    let dir = std::env::temp_dir().join("partty-shell-integration");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    // Always rewrite so rebuilt binaries refresh script contents in-process caches.
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    map.insert(name.to_string(), path.clone());
    Ok(path)
}

fn resolve_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    let exts = std::env::var_os("PATHEXT").unwrap_or_else(|| ".EXE".into());
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        for ext in std::env::split_paths(&exts) {
            let with_ext = dir
                .join(name)
                .with_extension(ext.to_str()?.strip_prefix('.')?);
            if with_ext.is_file() {
                return Some(with_ext);
            }
        }
    }
    None
}

fn windows_shell_command(
    prefs: &Prefs,
    profile: Option<&ConnectionProfile>,
) -> Result<CommandBuilder, String> {
    static EXE_CACHE: OnceLock<ParkingMutex<HashMap<String, PathBuf>>> = OnceLock::new();
    fn cached_resolve(key: &str, resolve: impl FnOnce() -> Option<PathBuf>) -> Option<PathBuf> {
        let cache = EXE_CACHE.get_or_init(|| ParkingMutex::new(HashMap::new()));
        if let Some(cached) = cache.lock().get(key) {
            return Some(cached.clone());
        }
        let found = resolve()?;
        cache.lock().insert(key.to_string(), found.clone());
        Some(found)
    }

    let startup = profile_startup(profile);
    let kind = detect_shell_kind(prefs);
    match kind {
        ShellKind::Pwsh | ShellKind::PowerShell => {
            let exe = if matches!(kind, ShellKind::Pwsh) {
                cached_resolve("pwsh", resolve_pwsh_executable)
                    .ok_or_else(|| "PowerShell 7 (pwsh) not found.".to_string())?
            } else {
                cached_resolve("powershell", || resolve_on_path("powershell.exe"))
                    .unwrap_or_else(|| PathBuf::from("powershell.exe"))
            };
            let script = write_shell_integration_script(
                "partty-shell-integration.ps1",
                SHELL_INTEGRATION_PWSH,
            )?;
            let command = append_ps_command(
                format!(". '{}'", script.to_string_lossy().replace('\'', "''")),
                startup,
            );
            let mut c = CommandBuilder::new(exe);
            c.args([
                "-NoLogo".to_string(),
                "-NoExit".to_string(),
                "-Command".to_string(),
                command,
            ]);
            c.env("TERM_PROGRAM", "partty");
            c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
            c.env("PARTTY_SHELL_INTEGRATION", "1");
            apply_cwd(c, prefs)
        }
        ShellKind::Bash => {
            let bash = resolve_bash_executable(prefs)?;
            let script = write_shell_integration_script(
                "partty-shell-integration.bash",
                SHELL_INTEGRATION_BASH,
            )?;
            let script_unix = script.to_string_lossy().replace('\\', "/");
            let init = write_shell_integration_script(
                "partty-bash-init.sh",
                &host_bash_init_contents(&script_unix, startup),
            )?;
            let mut c = bash;
            c.args([
                "--init-file".to_string(),
                init.to_string_lossy().to_string(),
                "-i".to_string(),
            ]);
            c.env("TERM_PROGRAM", "partty");
            c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
            c.env("PARTTY_SHELL_INTEGRATION", "1");
            apply_cwd(c, prefs)
        }
        ShellKind::Zsh => {
            let script = write_shell_integration_script(
                "partty-shell-integration.zsh",
                SHELL_INTEGRATION_ZSH,
            )?;
            // Use forward slashes so zsh (often MSYS-based) can source the script.
            let script_unix = script.to_string_lossy().replace('\\', "/");
            let zdot = ensure_zsh_zdot(&script_unix, startup)?;
            let original_zdot = std::env::var("ZDOTDIR").unwrap_or_default();
            let mut c = CommandBuilder::new("zsh.exe");
            c.arg("-i");
            c.env("ZDOTDIR", zdot.to_string_lossy().as_ref());
            c.env("PARTTY_ORIGINAL_ZDOTDIR", original_zdot);
            c.env("TERM_PROGRAM", "partty");
            c.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
            c.env("PARTTY_SHELL_INTEGRATION", "1");
            apply_cwd(c, prefs)
        }
        ShellKind::Cmd => {
            if let Some(cmd) = startup {
                let comspec = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into());
                let mut c = CommandBuilder::new(comspec);
                c.arg("/k");
                c.arg(cmd);
                return apply_cwd(c, prefs);
            }
            windows_host_shell(prefs)
        }
        ShellKind::Other => {
            let trimmed = prefs.shell.trim().trim_matches(|c| c == '"' || c == '\'');
            if trimmed.is_empty() {
                return windows_host_shell(prefs);
            }
            let path_candidate = Path::new(trimmed);
            let mut builder =
                if (trimmed.contains('\\') || trimmed.contains('/') || trimmed.ends_with(".exe"))
                    && path_candidate.is_file()
                {
                    CommandBuilder::new(path_candidate)
                } else {
                    let exe_with = format!("{}.exe", trimmed);
                    if resolve_on_path(&exe_with).is_some() {
                        CommandBuilder::new(exe_with)
                    } else if resolve_on_path(trimmed).is_some() {
                        CommandBuilder::new(trimmed)
                    } else {
                        return windows_host_shell(prefs);
                    }
                };
            if let Some(startup_cmd) = startup {
                builder.arg("-c");
                builder.arg(startup_cmd);
            }
            apply_cwd(builder, prefs)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellKind {
    Pwsh,
    PowerShell,
    Bash,
    Zsh,
    Cmd,
    Other,
}

fn detect_shell_kind(prefs: &Prefs) -> ShellKind {
    let trimmed = prefs.shell.trim().trim_matches(|c| c == '"' || c == '\'');
    if trimmed.is_empty() {
        return ShellKind::Cmd;
    }
    let path_candidate = Path::new(trimmed);
    let name = if trimmed.contains('\\') || trimmed.contains('/') || trimmed.ends_with(".exe") {
        path_candidate
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase()
    } else {
        let mut s = normalize_shell_token(trimmed);
        strip_exe_suffix(&mut s);
        s
    };
    let name = name.trim_end_matches(".exe");
    if is_pwsh_alias(name) {
        return ShellKind::Pwsh;
    }
    match name {
        "powershell" => ShellKind::PowerShell,
        "bash" | "git-bash" | "gitbash" => ShellKind::Bash,
        "zsh" => ShellKind::Zsh,
        "cmd" => ShellKind::Cmd,
        _ if name.contains("pwsh") => ShellKind::Pwsh,
        _ if name.contains("powershell") => ShellKind::PowerShell,
        _ if name.contains("bash") => ShellKind::Bash,
        _ => ShellKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        detected_shell_profile_field, is_git_bash_path, is_wsl_bash_shim, looks_like_unix_root,
        osc633_normalize_cwd, split_commandline, windows_path_to_wsl_mnt,
    };
    use std::path::{Path, PathBuf};

    #[test]
    fn split_ssh_commandline() {
        let (exe, args) = split_commandline("ssh -J jump user@host").unwrap();
        assert_eq!(exe, "ssh");
        assert_eq!(args, vec!["-J", "jump", "user@host"]);
    }

    #[test]
    fn split_quoted_commandline() {
        let (exe, args) = split_commandline(r#"ssh -i "C:\Users\me\.ssh\id_rsa" host"#).unwrap();
        assert_eq!(exe, "ssh");
        assert_eq!(args, vec!["-i", r"C:\Users\me\.ssh\id_rsa", "host"]);
    }

    fn props_windows() -> Option<&'static str> {
        Some("True")
    }

    #[test]
    fn unix_root_detection_respects_boundaries() {
        assert!(looks_like_unix_root("/home"));
        assert!(looks_like_unix_root("/home/rune"));
        assert!(looks_like_unix_root("/home/"));
        assert!(!looks_like_unix_root("/homebrew"));
        assert!(!looks_like_unix_root("/usrbin"));
    }

    #[test]
    fn osc633_cwd_drive_and_mnt() {
        let p = props_windows();
        assert_eq!(osc633_normalize_cwd("C:/Users/me", p), r"C:\Users\me");
        assert_eq!(osc633_normalize_cwd("/mnt/c/Users/me", p), r"C:\Users\me");
    }

    #[test]
    fn osc633_cwd_does_not_mangle_unix_home() {
        let p = props_windows();
        assert_eq!(osc633_normalize_cwd("/home/rune", p), "/home/rune");
        assert_eq!(osc633_normalize_cwd("/usr/local", p), "/usr/local");
    }

    #[test]
    fn osc633_cwd_unc_wsl() {
        let p = props_windows();
        assert_eq!(
            osc633_normalize_cwd("//wsl$/Ubuntu/home/rune", p),
            r"\\wsl$\Ubuntu\home\rune"
        );
    }

    #[test]
    fn windows_to_wsl_mnt_path() {
        let p = PathBuf::from(r"C:\Users\me\AppData\Local\Temp\partty-shell-integration\x.bash");
        assert_eq!(
            windows_path_to_wsl_mnt(&p).unwrap(),
            "/mnt/c/Users/me/AppData/Local/Temp/partty-shell-integration/x.bash"
        );
    }

    #[test]
    fn git_bash_path_detection() {
        assert!(is_git_bash_path(Path::new(
            r"C:\Program Files\Git\bin\bash.exe"
        )));
        assert!(is_wsl_bash_shim(Path::new(r"C:\Windows\System32\bash.exe")));
        assert!(!is_git_bash_path(Path::new(
            r"C:\Windows\System32\bash.exe"
        )));
    }

    #[test]
    fn detected_bash_profile_shell_field() {
        assert_eq!(
            detected_shell_profile_field("bash", r"C:\Program Files\Git\bin\bash.exe"),
            r"C:\Program Files\Git\bin\bash.exe"
        );
        assert_eq!(
            detected_shell_profile_field("pwsh", r"C:\Tools\pwsh.exe"),
            "pwsh"
        );
    }
}
