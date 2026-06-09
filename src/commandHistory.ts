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
  startedAt: number;
  cwd: string | null;
};

function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[P_X^][\s\S]*?\x1b\\/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
    .replace(/[\x80-\x9f]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function normalizeHistoryOutput(value: string): string {
  return stripTerminalControls(value.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
    .replace(/\n{4,}/g, "\n\n\n");
}

function normalizeHistoryCommand(value: string): string {
  return stripTerminalControls(value).replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
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

  hasActive(paneId: string): boolean {
    return this.active.has(paneId);
  }

  observeInput(paneId: string, data: string): void {
    if (this.prefs.command_history_enabled === false) return;
    let buf = this.inputBuffers.get(paneId) ?? "";
    for (const ch of stripTerminalControls(data)) {
      if (ch === "\r" || ch === "\n") {
        const cmd = normalizeHistoryCommand(buf);
        if (cmd) {
          this.lastSubmitted.set(paneId, cmd);
          const active = this.active.get(paneId);
          if (!active) this.active.set(paneId, this.newActive(cmd, null));
          else if (!active.command) active.command = cmd;
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
    if (this.prefs.command_history_enabled === false) return;
    for (const ev of events) {
      if (ev.kind === "command-line") {
        const command = normalizeHistoryCommand(ev.text);
        const prior = this.active.get(paneId);
        if (prior && !prior.command) prior.command = command;
        else if (command) this.active.set(paneId, this.newActive(command, cwd));
      } else if (ev.kind === "pre-exec") {
        const submitted = this.lastSubmitted.get(paneId) ?? "";
        if (!this.active.has(paneId)) this.active.set(paneId, this.newActive(submitted, cwd));
      }
    }
    const output = normalizeHistoryOutput(cleanedOutput);
    if (output && this.prefs.command_history_capture_output !== false) {
      const active = this.active.get(paneId);
      if (active) active.output = this.trimOutput(active.output + output);
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
    if (this.prefs.command_history_enabled === false) return;
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
    return { id: crypto.randomUUID(), command, output: "", startedAt: Date.now(), cwd };
  }

  private finish(paneId: string, exitCode: number | null): void {
    const active = this.active.get(paneId);
    if (!active) return;
    this.active.delete(paneId);
    const command = normalizeHistoryCommand(active.command);
    if (!command) return;
    const endedAt = Date.now();
    const record: CommandHistoryRecord = {
      id: active.id,
      pane_id: paneId,
      command,
      output: active.output,
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
    if (this.prefs.command_history_enabled === false || sec <= 0) return;
    this.flushTimer = window.setInterval(() => void this.flush(), Math.max(0.25, sec) * 1000);
  }
}

export async function loadCommandHistory(paneId: string, limit = 500): Promise<CommandHistoryRecord[]> {
  return invoke<CommandHistoryRecord[]>("get_command_history", { paneId, limit });
}

export async function deleteCommandHistory(paneId: string): Promise<void> {
  return invoke("delete_command_history", { paneId });
}

export async function deleteCommandHistoriesWithPrefix(prefix: string, keep: string[]): Promise<void> {
  return invoke("delete_command_histories_with_prefix", { prefix, keep });
}
