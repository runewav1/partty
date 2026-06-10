import { invoke } from "@tauri-apps/api/core";
import type { ShellIntegrationEvent } from "./shellIntegration";

export type CommandHistoryPrefs = {
  command_history_enabled?: boolean;
  command_history_flush_interval_sec?: number;
  command_history_flush_on_command_end?: boolean;
  command_history_max_records_per_pane?: number;
  command_history_capture_output?: boolean;
  command_history_max_output_bytes?: number;
  command_history_flush_on_hide?: boolean;
  command_history_include_commands?: string[] | string;
  command_history_exclude_commands?: string[] | string;
};

export type CommandHistoryRecord = {
  id: string;
  pane_id: string;
  command: string;
  output: string;
  exit_code: number | null;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  cwd: string | null;
};

type ActiveCommand = {
  id: string;
  command: string;
  output: string;
  rawOutput: string;
  startedAt: number;
  cwd: string | null;
};

const DEFAULT_EXCLUDED_COMMANDS = [
  "nvim",
  "vim",
  "vi",
  "nano",
  "emacs",
  "less",
  "more",
  "man",
  "top",
  "htop",
  "btop",
  "btm",
  "opencode",
  "lazygit",
  "tig",
  "fzf",
];

function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[P_X^][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[\x80-\x9f]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export function stripAnsi(value: string): string {
  return stripTerminalControls(value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?m/g, "")
    .replace(/\[(?:\d{1,3}(?:;\d{1,3})*)?[hl]/g, ""));
}

function normalizeHistoryOutput(value: string): string {
  return renderTerminalText(value).replace(/\n{4,}/g, "\n\n\n");
}

function renderTerminalText(value: string): string {
  const lines: string[][] = [[]];
  let row = 0;
  let col = 0;

  const ensure = (r: number): void => {
    while (lines.length <= r) lines.push([]);
  };
  const put = (ch: string): void => {
    ensure(row);
    const line = lines[row]!;
    while (line.length < col) line.push(" ");
    line[col++] = ch;
  };
  const newline = (): void => {
    row++;
    col = 0;
    ensure(row);
  };

  for (let i = 0; i < value.length;) {
    const code = value.charCodeAt(i);
    if (code === 0x1b) {
      const next = value[i + 1];
      if (next === "]") {
        const endBell = value.indexOf("\x07", i + 2);
        const endSt = value.indexOf("\x1b\\", i + 2);
        const ends = [endBell >= 0 ? endBell + 1 : -1, endSt >= 0 ? endSt + 2 : -1].filter((x) => x >= 0);
        if (!ends.length) break;
        i = Math.min(...ends);
        continue;
      }
      if (next === "[") {
        const m = value.slice(i).match(/^\x1b\[([0-9;?]*)([@-~])/);
        if (m) {
          const nums = (m[1] || "").replace(/\?/g, "").split(";").filter(Boolean).map((n) => Number.parseInt(n, 10));
          const n = nums[0] || 1;
          const cmd = m[2];
          if (cmd === "C") col += n;
          else if (cmd === "D") col = Math.max(0, col - n);
          else if (cmd === "G") col = Math.max(0, n - 1);
          else if (cmd === "K") {
            ensure(row);
            if ((nums[0] ?? 0) === 1) lines[row]!.splice(0, col);
            else if ((nums[0] ?? 0) === 2) lines[row] = [];
            else lines[row]!.length = col;
          }
          i += m[0].length;
          continue;
        }
      }
      i += 2;
      continue;
    }
    if (value.startsWith("\r\n", i)) {
      newline();
      i += 2;
      continue;
    }
    const ch = value[i]!;
    if (ch === "\r") {
      col = 0;
      i++;
      continue;
    }
    if (ch === "\n") {
      newline();
      i++;
      continue;
    }
    if (ch === "\t") {
      const nextTab = col + (8 - (col % 8));
      while (col < nextTab) put(" ");
      i++;
      continue;
    }
    if (code >= 0x20 && code !== 0x7f) put(ch);
    i++;
  }

  return lines.map((line) => stripAnsi(line.join("")).replace(/[ \t]+$/g, "")).join("\n").trimEnd();
}

function normalizeHistoryCommand(value: string): string {
  return stripTerminalControls(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

function commandExe(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  const m = trimmed.match(/^(["'])(.*?)\1|^(\S+)/);
  const raw = (m?.[2] || m?.[3] || "").toLowerCase();
  return raw.replace(/\\/g, "/").split("/").pop()?.replace(/\.(exe|cmd|bat|ps1)$/i, "") ?? raw;
}

function listPref(value: string[] | string | undefined, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  return fallback;
}

function matchesCommandPattern(command: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  const full = command.toLowerCase();
  const exe = commandExe(command);
  if (p.includes("*")) {
    const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
    return re.test(exe) || re.test(full);
  }
  return exe === p || full === p || full.startsWith(`${p} `);
}

function entersAlternateScreen(output: string): boolean {
  return /\x1b\[\?((1049)|(47)|(1047))h/.test(output);
}

export class CommandHistoryStore {
  private active = new Map<string, ActiveCommand>();
  private pending = new Map<string, CommandHistoryRecord[]>();
  private inputBuffers = new Map<string, string>();
  private lastSubmitted = new Map<string, string>();
  private flushTimer = 0;

  constructor(
    private prefs: CommandHistoryPrefs,
    private onChanged?: (paneIds: string[]) => void,
  ) {
    this.reschedule();
  }

  updatePrefs(prefs: CommandHistoryPrefs): void {
    this.prefs = prefs;
    this.reschedule();
  }

  isEnabled(): boolean {
    return this.prefs.command_history_enabled === true;
  }

  hasActive(paneId: string): boolean {
    return this.isEnabled() && this.active.has(paneId);
  }

  private shouldTrackCommand(command: string): boolean {
    const normalized = normalizeHistoryCommand(command);
    if (!normalized) return false;
    const include = listPref(this.prefs.command_history_include_commands);
    if (include.some((p) => matchesCommandPattern(normalized, p))) return true;
    const exclude = listPref(this.prefs.command_history_exclude_commands, DEFAULT_EXCLUDED_COMMANDS);
    if (exclude.some((p) => matchesCommandPattern(normalized, p))) return false;
    return true;
  }

  observeInput(paneId: string, data: string): void {
    if (!this.isEnabled()) return;
    let buf = this.inputBuffers.get(paneId) ?? "";
    const input = data.length === 1 && data >= " " && data !== "\x7f" ? data : stripTerminalControls(data);
    for (const ch of input) {
      if (ch === "\r" || ch === "\n") {
        const cmd = normalizeHistoryCommand(buf);
        if (cmd && this.shouldTrackCommand(cmd)) {
          this.lastSubmitted.set(paneId, cmd);
          const active = this.active.get(paneId);
          if (!active) this.active.set(paneId, this.newActive(cmd, null));
          else if (!active.command) active.command = cmd;
        } else {
          this.lastSubmitted.delete(paneId);
          this.active.delete(paneId);
        }
        buf = "";
      } else if (ch === "\b" || ch === "\x7f") {
        buf = buf.slice(0, -1);
      } else if (ch >= " " && ch !== "\x7f") {
        buf += ch;
      }
    }
    this.inputBuffers.set(paneId, buf);
  }

  process(paneId: string, events: ShellIntegrationEvent[], cleanedOutput: string, cwd: string | null): void {
    if (!this.isEnabled()) return;
    for (const ev of events) {
      if (ev.kind === "command-line") {
        const command = normalizeHistoryCommand(ev.text);
        if (command && !this.shouldTrackCommand(command)) {
          this.active.delete(paneId);
          continue;
        }
        const prior = this.active.get(paneId);
        if (prior && command) {
          prior.command = command;
          prior.cwd = cwd ?? prior.cwd;
        }
        else if (command) this.active.set(paneId, this.newActive(command, cwd));
      } else if (ev.kind === "pre-exec") {
        const submitted = this.lastSubmitted.get(paneId) ?? "";
        if (!this.active.has(paneId) && this.shouldTrackCommand(submitted)) this.active.set(paneId, this.newActive(submitted, cwd));
      }
    }
    if (cleanedOutput && this.prefs.command_history_capture_output !== false) {
      const active = this.active.get(paneId);
      if (active) {
        if (entersAlternateScreen(cleanedOutput)) {
          this.active.delete(paneId);
          return;
        }
        active.rawOutput = this.trimOutput(active.rawOutput + cleanedOutput);
      }
    }
    for (const ev of events) {
      if (ev.kind === "command-done") {
        this.finish(paneId, ev.exitCode);
      } else if (ev.kind === "prompt-start" && this.active.has(paneId)) {
        this.finish(paneId, null);
      }
    }
  }

  finishActive(paneId: string, exitCode: number | null = null): void {
    this.finish(paneId, exitCode);
  }

  finishAllActive(exitCode: number | null = null): void {
    for (const paneId of [...this.active.keys()]) this.finish(paneId, exitCode);
  }

  async flush(): Promise<void> {
    if (!this.isEnabled()) return;
    const maxRecords = Math.max(50, Math.min(50_000, this.prefs.command_history_max_records_per_pane ?? 2000));
    const entries = [...this.pending.entries()].filter(([, records]) => records.length > 0);
    this.pending.clear();
    const changed: string[] = [];
    await Promise.all(entries.map(([paneId, records]) =>
      invoke("append_command_history_records", { paneId, records, maxRecords }).then(() => {
        changed.push(paneId);
      }).catch((e) => {
        const existing = this.pending.get(paneId) ?? [];
        this.pending.set(paneId, [...records, ...existing]);
        console.warn("append_command_history_records", e);
      }),
    ));
    if (changed.length) this.onChanged?.(changed);
  }

  remapPendingPaneId(fromPaneId: string, toPaneId: string): void {
    if (fromPaneId === toPaneId) return;
    const records = this.pending.get(fromPaneId);
    if (!records?.length) return;
    this.pending.delete(fromPaneId);
    const existing = this.pending.get(toPaneId) ?? [];
    this.pending.set(toPaneId, [...existing, ...records]);
  }

  dispose(): void {
    if (this.flushTimer) window.clearInterval(this.flushTimer);
    this.flushTimer = 0;
  }

  private newActive(command: string, cwd: string | null): ActiveCommand {
    return { id: crypto.randomUUID(), command, output: "", rawOutput: "", startedAt: Date.now(), cwd };
  }

  private finish(paneId: string, exitCode: number | null): void {
    const active = this.active.get(paneId);
    if (!active) return;
    this.active.delete(paneId);
    const command = normalizeHistoryCommand(active.command);
    if (!command || !this.shouldTrackCommand(command)) return;
    const endedAt = Date.now();
    const record: CommandHistoryRecord = {
      id: active.id,
      pane_id: paneId,
      command,
      output: normalizeHistoryOutput(active.rawOutput || active.output),
      exit_code: exitCode,
      started_at: active.startedAt,
      ended_at: endedAt,
      duration_ms: Math.max(0, endedAt - active.startedAt),
      cwd: active.cwd,
    };
    const records = this.pending.get(paneId) ?? [];
    records.push(record);
    this.pending.set(paneId, records);
    if (this.prefs.command_history_flush_on_command_end !== false) void this.flush();
  }

  private trimOutput(output: string): string {
    const max = Math.max(4096, Math.min(10_485_760, this.prefs.command_history_max_output_bytes ?? 262_144));
    if (output.length <= max) return output;
    return output.slice(output.length - max);
  }

  private reschedule(): void {
    if (this.flushTimer) window.clearInterval(this.flushTimer);
    this.flushTimer = 0;
    const sec = this.prefs.command_history_flush_interval_sec ?? 0;
    if (!this.isEnabled() || sec <= 0) return;
    this.flushTimer = window.setInterval(() => void this.flush(), Math.max(0.25, sec) * 1000);
  }
}

export async function loadCommandHistory(paneId: string, limit = 500): Promise<CommandHistoryRecord[]> {
  return invoke<CommandHistoryRecord[]>("get_command_history", { paneId, limit });
}

export async function deleteCommandHistory(paneId: string): Promise<void> {
  return invoke("delete_command_history", { paneId });
}

export async function deleteCommandHistoryRecord(paneId: string, recordId: string): Promise<void> {
  return invoke("delete_command_history_record", { paneId, recordId });
}

export async function deleteCommandHistoriesWithPrefix(prefix: string, keep: string[]): Promise<void> {
  return invoke("delete_command_histories_with_prefix", { prefix, keep });
}
