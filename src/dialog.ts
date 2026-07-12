/**
 * In-theme modal dialogs (alert / prompt / confirm) built from one factory.
 * Escape dismissal is handled by the shared overlay stack, so dialogs stack
 * correctly with any other open chrome.
 */

import { mouseCursorForceVisible } from "./mouseCursor";
import { pushOverlay } from "./overlayStack";

type DialogButton = {
  label: string;
  kind?: "primary" | "danger" | "default";
  /** Marks the button whose value is returned on Enter / autofocus target. */
  primaryAction?: boolean;
};

type DialogSpec = {
  title: string;
  message: string;
  role?: string;
  input?: { value: string };
  buttons: DialogButton[];
};

type DialogResult = {
  /** Index into `spec.buttons`; -1 when dismissed (Escape). */
  button: number;
  text: string;
};

function showDialog(spec: DialogSpec): Promise<DialogResult> {
  return new Promise((resolve) => {
    mouseCursorForceVisible(true);

    let host = document.getElementById("termie-dialog-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "termie-dialog-host";
      host.className = "termie-dialog-host";
      document.body.appendChild(host);
    }

    const backdrop = document.createElement("div");
    backdrop.className = "termie-dialog-backdrop";
    const panel = document.createElement("div");
    panel.className = "termie-dialog-panel";
    panel.setAttribute("role", spec.role ?? "dialog");

    const title = document.createElement("h2");
    title.className = "termie-dialog-title";
    title.textContent = spec.title;
    const msg = document.createElement("p");
    msg.className = "termie-dialog-msg";
    msg.textContent = spec.message;
    panel.append(title, msg);

    let input: HTMLInputElement | null = null;
    if (spec.input) {
      input = document.createElement("input");
      input.type = "text";
      input.className = "termie-dialog-input";
      input.spellcheck = false;
      input.value = spec.input.value;
      panel.appendChild(input);
    }

    const actions = document.createElement("div");
    actions.className = "termie-dialog-actions";
    panel.appendChild(actions);

    const finish = (button: number): void => {
      overlay.release();
      backdrop.remove();
      mouseCursorForceVisible(false);
      resolve({ button, text: input?.value ?? "" });
    };
    const overlay = pushOverlay(() => finish(-1));

    let focusTarget: HTMLElement | null = input;
    spec.buttons.forEach((btn, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className =
        btn.kind === "primary"
          ? "termie-dialog-btn termie-dialog-btn--primary"
          : btn.kind === "danger"
            ? "termie-dialog-btn termie-dialog-btn--danger"
            : "termie-dialog-btn";
      el.textContent = btn.label;
      el.addEventListener("click", () => finish(i));
      actions.appendChild(el);
      if (btn.primaryAction) {
        if (!focusTarget) focusTarget = el;
        if (input) {
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish(i);
            }
          });
        }
      }
    });

    backdrop.appendChild(panel);
    host.appendChild(backdrop);
    if (input) input.select();
    focusTarget?.focus();
  });
}

export function showAlert(message: string, title = "Partty"): Promise<void> {
  return showDialog({
    title,
    message,
    role: "alertdialog",
    buttons: [{ label: "OK", kind: "primary", primaryAction: true }],
  }).then(() => undefined);
}

export function showPrompt(
  message: string,
  defaultValue = "",
  title = "Partty",
): Promise<string | null> {
  return showDialog({
    title,
    message,
    input: { value: defaultValue },
    buttons: [
      { label: "Cancel" },
      { label: "OK", kind: "primary", primaryAction: true },
    ],
  }).then((r) => (r.button === 1 ? r.text.trim() || null : null));
}

export function showConfirm(
  message: string,
  title = "Partty",
  confirmLabel = "OK",
  danger = false,
): Promise<boolean> {
  return showDialog({
    title,
    message,
    buttons: [
      { label: "Cancel" },
      {
        label: confirmLabel,
        kind: danger ? "danger" : "primary",
        primaryAction: true,
      },
    ],
  }).then((r) => r.button === 1);
}
