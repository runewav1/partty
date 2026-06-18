/** In-theme modal alert / prompt (no native `window.alert` styling). */

import { mouseCursorForceVisible } from "./mouseCursor";

function ensureHost(): HTMLElement {
  let el = document.getElementById("termie-dialog-host");
  if (!el) {
    el = document.createElement("div");
    el.id = "termie-dialog-host";
    el.className = "termie-dialog-host";
    document.body.appendChild(el);
  }
  return el;
}

export function showAlert(message: string, title = "Partty"): Promise<void> {
  return new Promise((resolve) => {
    mouseCursorForceVisible(true);
    const host = ensureHost();
    const backdrop = document.createElement("div");
    backdrop.className = "termie-dialog-backdrop";
    const panel = document.createElement("div");
    panel.className = "termie-dialog-panel";
    panel.setAttribute("role", "alertdialog");
    panel.innerHTML = `<h2 class="termie-dialog-title"></h2><p class="termie-dialog-msg"></p><div class="termie-dialog-actions"></div>`;
    panel.querySelector(".termie-dialog-title")!.textContent = title;
    (panel.querySelector(".termie-dialog-msg") as HTMLElement).textContent = message;
    const actions = panel.querySelector(".termie-dialog-actions")!;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "termie-dialog-btn termie-dialog-btn--primary";
    ok.textContent = "OK";
    const close = () => {
      backdrop.remove();
      mouseCursorForceVisible(false);
      resolve();
    };
    ok.addEventListener("click", close);
    actions.appendChild(ok);
    backdrop.appendChild(panel);
    host.appendChild(backdrop);
    ok.focus();
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
  });
}

export function showPrompt(message: string, defaultValue = "", title = "Partty"): Promise<string | null> {
  return new Promise((resolve) => {
    mouseCursorForceVisible(true);
    const host = ensureHost();
    const backdrop = document.createElement("div");
    backdrop.className = "termie-dialog-backdrop";
    const panel = document.createElement("div");
    panel.className = "termie-dialog-panel";
    panel.setAttribute("role", "dialog");
    panel.innerHTML = `<h2 class="termie-dialog-title"></h2><p class="termie-dialog-msg"></p><input type="text" class="termie-dialog-input" spellcheck="false" /><div class="termie-dialog-actions"></div>`;
    panel.querySelector(".termie-dialog-title")!.textContent = title;
    (panel.querySelector(".termie-dialog-msg") as HTMLElement).textContent = message;
    const input = panel.querySelector(".termie-dialog-input") as HTMLInputElement;
    input.value = defaultValue;
    const actions = panel.querySelector(".termie-dialog-actions")!;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "termie-dialog-btn";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "termie-dialog-btn termie-dialog-btn--primary";
    ok.textContent = "OK";
    const finish = (v: string | null) => {
      backdrop.remove();
      mouseCursorForceVisible(false);
      resolve(v);
    };
    cancel.addEventListener("click", () => finish(null));
    ok.addEventListener("click", () => finish(input.value.trim() || null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(input.value.trim() || null);
      }
    });
    actions.appendChild(cancel);
    actions.appendChild(ok);
    backdrop.appendChild(panel);
    host.appendChild(backdrop);
    input.focus();
    input.select();
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });
  });
}

export function showConfirm(
  message: string,
  title = "Partty",
  confirmLabel = "OK",
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    mouseCursorForceVisible(true);
    const host = ensureHost();
    const backdrop = document.createElement("div");
    backdrop.className = "termie-dialog-backdrop";
    const panel = document.createElement("div");
    panel.className = "termie-dialog-panel";
    panel.innerHTML = `<h2 class="termie-dialog-title"></h2><p class="termie-dialog-msg"></p><div class="termie-dialog-actions"></div>`;
    panel.querySelector(".termie-dialog-title")!.textContent = title;
    (panel.querySelector(".termie-dialog-msg") as HTMLElement).textContent = message;
    const actions = panel.querySelector(".termie-dialog-actions")!;
    const no = document.createElement("button");
    no.type = "button";
    no.className = "termie-dialog-btn";
    no.textContent = "Cancel";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = danger ? "termie-dialog-btn termie-dialog-btn--danger" : "termie-dialog-btn termie-dialog-btn--primary";
    yes.textContent = confirmLabel;
    const done = (v: boolean) => {
      backdrop.remove();
      mouseCursorForceVisible(false);
      resolve(v);
    };
    no.addEventListener("click", () => done(false));
    yes.addEventListener("click", () => done(true));
    actions.appendChild(no);
    actions.appendChild(yes);
    backdrop.appendChild(panel);
    host.appendChild(backdrop);
    yes.focus();
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(false);
      }
    });
  });
}
