export type ShellIntegrationState = {
  properties: Map<string, string>;
  parserRemainder: string;
};

export function createShellIntegrationState(): ShellIntegrationState {
  return {
    properties: new Map(),
    parserRemainder: "",
  };
}

function unescapeOsc(s: string): string {
  return s
    .replace(/\\x3b/gi, ";")
    .replace(/\\x([0-9a-fA-F]{2})/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\\\/g, "\\");
}

export type OscCwdCallback = (path: string) => void;

export type ShellIntegrationEvent =
  | { kind: "prompt-start" }
  | { kind: "prompt-end" }
  | { kind: "pre-exec" }
  | { kind: "command-done"; exitCode: number | null }
  | { kind: "command-line"; text: string }
  | { kind: "property"; key: string; value: string }
  | { kind: "cwd"; path: string };

type ProcessResult = {
  cleaned: string;
  events: ShellIntegrationEvent[];
};

function toWindowsAbsPath(input: string): string {
  let raw = input.trim();
  if (!raw) return raw;
  // Strip file:// scheme prefix when URL parsing failed and input is still a URI
  raw = raw.replace(/^file:\/+(\/+)?/i, "");
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return raw.replace(/\//g, "\\");
  if (/^[a-zA-Z]:\//.test(raw)) return raw.replace(/\//g, "\\");
  if (/^\\\\[^\\]+\\[^\\]+/.test(raw)) return raw.replace(/\//g, "\\");
  if (/^\/[a-zA-Z]:\//.test(raw)) return raw.slice(1).replace(/\//g, "\\");
  const msys = raw.match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) return `${msys[1]!.toUpperCase()}:\\${msys[2]!.replace(/\//g, "\\")}`;
  const cyg = raw.match(/^\/cygdrive\/([a-zA-Z])\/(.*)$/);
  if (cyg) return `${cyg[1]!.toUpperCase()}:\\${cyg[2]!.replace(/\//g, "\\")}`;
  const wsl = raw.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (wsl) return `${wsl[1]!.toUpperCase()}:\\${wsl[2]!.replace(/\//g, "\\")}`;
  return raw.replace(/\//g, "\\");
}

function normalizeCwdPath(value: string, properties: Map<string, string>): string {
  const isWindows = (properties.get("IsWindows") ?? "").toLowerCase() === "true";
  if (isWindows) return toWindowsAbsPath(value);
  return value.trim();
}

function uriToLocalPath(payload: string, properties: Map<string, string>): string | null {
  const raw = payload.trim();
  if (!raw) return null;
  const isWindows = (properties.get("IsWindows") ?? "").toLowerCase() === "true";
  try {
    const href = raw.includes("://") ? raw : `file:///${raw.replace(/^\/+/, "")}`;
    const u = new URL(href);
    if (u.protocol !== "file:") return null;
    let p = decodeURIComponent(u.pathname);
    if (isWindows) {
      if (u.hostname) {
        const unc = `\\\\${u.hostname}${p}`.replace(/\//g, "\\");
        return unc || null;
      }
      if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
      return toWindowsAbsPath(p);
    }
    return p || null;
  } catch {
    if (!isWindows) return null;
    // URL constructor failed (e.g. unencoded spaces). Try to recover the path.
    let cleaned = raw;
    try { cleaned = decodeURIComponent(cleaned); } catch { /* raw is fine */ }
    return toWindowsAbsPath(cleaned) || null;
  }
}

function findOscTerminator(input: string, from: number): { payloadEnd: number; nextIndex: number } | null {
  for (let i = from; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    if (ch === 0x07) {
      return { payloadEnd: i, nextIndex: i + 1 };
    }
    if (ch === 0x1b) {
      if (i + 1 >= input.length) return null;
      if (input.charCodeAt(i + 1) === 0x5c) {
        return { payloadEnd: i, nextIndex: i + 2 };
      }
    }
  }
  return null;
}

export function processShellIntegration(
  raw: string,
  state: ShellIntegrationState,
  onCwd?: OscCwdCallback,
  options?: { commandEvents?: boolean },
): ProcessResult {
  const events: ShellIntegrationEvent[] = [];
  const commandEvents = options?.commandEvents !== false;
  let cleaned = "";
  const input = state.parserRemainder + raw;
  state.parserRemainder = "";

  for (let i = 0; i < input.length;) {
    const ch = input.charCodeAt(i);
    if (ch === 0x1b && i + 1 < input.length && input.charCodeAt(i + 1) === 0x5d) {
      const termInfo = findOscTerminator(input, i + 2);
      if (!termInfo) {
        state.parserRemainder = input.slice(i);
        break;
      }
      const payload = input.slice(i + 2, termInfo.payloadEnd);
      const parts = payload.split(";");
      const osc = parts[0] ?? "";

      if (osc === "633" || osc === "133") {
        const letter = parts[1] ?? "";
        switch (letter) {
          case "A": {
            if (commandEvents) events.push({ kind: "prompt-start" });
            break;
          }
          case "B": {
            if (commandEvents) events.push({ kind: "prompt-end" });
            break;
          }
          case "C": {
            if (commandEvents) events.push({ kind: "pre-exec" });
            break;
          }
          case "D": {
            const exitStr = parts[2]?.trim();
            const parsed = exitStr ? parseInt(exitStr, 10) : null;
            const exitCode = Number.isFinite(parsed) ? parsed : null;
            if (commandEvents) events.push({ kind: "command-done", exitCode });
            break;
          }
          case "E": {
            const cmdLine = unescapeOsc(parts.slice(2).join(";"));
            if (commandEvents) events.push({ kind: "command-line", text: cmdLine });
            break;
          }
          case "P": {
            const propStr = parts.slice(2).join(";");
            const eqIdx = propStr.indexOf("=");
            if (eqIdx > 0) {
              const key = propStr.slice(0, eqIdx);
              const value = unescapeOsc(propStr.slice(eqIdx + 1));
              state.properties.set(key, value);
              events.push({ kind: "property", key, value });
              if (key === "Cwd") {
                const cwd = normalizeCwdPath(value, state.properties);
                if (cwd) {
                  onCwd?.(cwd);
                  events.push({ kind: "cwd", path: cwd });
                }
              }
            }
            break;
          }
          default:
            cleaned += input.slice(i, termInfo.nextIndex);
            break;
        }
      } else if (osc === "7") {
        const path = uriToLocalPath(parts.slice(1).join(";"), state.properties);
        if (path) {
          onCwd?.(path);
          events.push({ kind: "cwd", path });
        }
      } else {
        cleaned += input.slice(i, termInfo.nextIndex);
      }

      i = termInfo.nextIndex;
      continue;
    }

    if (ch === 0x1b && i === input.length - 1) {
      state.parserRemainder = input.slice(i);
      break;
    }

    cleaned += input[i];
    i++;
  }

  return { cleaned, events };
}

export function processCwdShellIntegration(
  raw: string,
  state: ShellIntegrationState,
  onCwd?: OscCwdCallback,
): ProcessResult {
  return processShellIntegration(raw, state, onCwd, { commandEvents: false });
}
