/**
 * In-theme modal alert dialog. Escape dismissal is handled by the shared
 * overlay stack, so dialogs stack correctly with any other open chrome.
 */

import { mouseCursorForceVisible } from "./mouseCursor";
import { pushOverlay } from "./overlayStack";

function showAlertDialog(message: string, title: string): Promise<void> {
  return new Promise((resolve) => {
    mouseCursorForceVisible(true);

    let host = document.getElementById("partty-dialog-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "partty-dialog-host";
      host.className = "partty-dialog-host";
      document.body.appendChild(host);
    }

    const backdrop = document.createElement("div");
    backdrop.className = "partty-dialog-backdrop";
    const panel = document.createElement("div");
    panel.className = "partty-dialog-panel";
    panel.setAttribute("role", "alertdialog");

    const titleEl = document.createElement("h2");
    titleEl.className = "partty-dialog-title";
    titleEl.textContent = title;
    const msg = document.createElement("p");
    msg.className = "partty-dialog-msg";
    msg.textContent = message;
    panel.append(titleEl, msg);

    const actions = document.createElement("div");
    actions.className = "partty-dialog-actions";
    panel.appendChild(actions);

    const finish = (): void => {
      overlay.release();
      backdrop.remove();
      mouseCursorForceVisible(false);
      resolve();
    };
    const overlay = pushOverlay(finish);

    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "partty-dialog-btn partty-dialog-btn--primary";
    ok.textContent = "OK";
    ok.addEventListener("click", finish);
    actions.appendChild(ok);

    backdrop.appendChild(panel);
    host.appendChild(backdrop);
    ok.focus();
  });
}

export function showAlert(message: string, title = "Partty"): Promise<void> {
  return showAlertDialog(message, title);
}