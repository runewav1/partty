/**
 * OSC sequence handler for terminal cwd updates.
 * Handles OSC 7 (file:// URI) and OSC 133/633 (shell integration) sequences.
 */

import type { ShellIntegrationEvent } from "./shellIntegration";

/**
 * Result of processing terminal data for OSC sequences.
 */
export type OscProcessResult = {
  cleaned: string;
  cwdEvents: CwdEvent[];
  shellIntegrationEvents: ShellIntegrationEvent[];
};

/**
 * Cwd change event from OSC sequences.
 */
export type CwdEvent = {
  paneId: string;
  cwd: string;
  source: "osc7" | "osc133" | "osc633" | "heuristic";
  timestamp: number;
};

/**
 * Handler for OSC sequences related to cwd tracking.
 */
export class OscHandler {
  private readonly onCwdDetected: (paneId: string, cwd: string) => void;

  constructor(
    onCwdDetected: (paneId: string, cwd: string) => void,
  ) {
    this.onCwdDetected = onCwdDetected;
  }

  /**
   * Process terminal data for OSC 7 sequences.
   * OSC 7: \x1b]7;file://HOST/PATH\x07 or \x1b]7;file://HOST/PATH\x1b\
   */
  processOsc7(raw: string, paneId: string): { cleaned: string; cwd: string | null } {
    const OSC7_PATTERN = /\x1b\]7;([^\x07\x1b]+)(?:\x1b\\|\x07)/g;
    let cwd: string | null = null;
    let cleaned = raw;

    cleaned = raw.replace(OSC7_PATTERN, (_match, payload: string) => {
      const path = this.parseOsc7Payload(payload);
      if (path) {
        cwd = path;
        this.onCwdDetected(paneId, path);
      }
      return "";
    });

    return { cleaned, cwd };
  }

  /**
   * Parse OSC 7 payload to extract local path.
   */
  private parseOsc7Payload(payload: string): string | null {
    const raw = payload.trim();
    if (!raw) return null;

    try {
      const href = raw.includes("://") ? raw : `file:///${raw.replace(/^\/+/, "")}`;
      const url = new URL(href);
      if (url.protocol !== "file:") return null;

      let path = decodeURIComponent(url.pathname);

      // Handle Windows paths: /C:/path -> C:\path
      if (/^\/[a-zA-Z]:/.test(path)) {
        path = path.slice(1);
      }

      // Handle UNC paths: \\server\share
      if (url.hostname) {
        path = `\\${url.hostname}${path}`;
      }

      path = path.replace(/\//g, "\\");
      return path || null;
    } catch {
      // Fallback: try to parse as raw Windows path
      if (/^[a-zA-Z]:[\\/]/.test(raw)) {
        return raw.replace(/\//g, "\\");
      }
      return null;
    }
  }

  /**
   * Process shell integration events for cwd changes.
   * OSC 133/633 with P property for cwd.
   */
  processShellIntegrationEvents(
    events: ShellIntegrationEvent[],
    paneId: string,
  ): CwdEvent[] {
    const cwdEvents: CwdEvent[] = [];

    for (const event of events) {
      if (event.kind === "cwd") {
        cwdEvents.push({
          paneId,
          cwd: event.path,
          source: "osc133",
          timestamp: Date.now(),
        });
        this.onCwdDetected(paneId, event.path);
      }
    }

    return cwdEvents;
  }
}
