// ui.js
//
// The small pieces of interface every tool uses: anchored menus, toasts, and
// dialogs built on the fly. Kept apart from viewer.js so the features that
// grew around it (signatures, passwords, export, properties…) can open a
// dialog with one call instead of each carrying its own markup in
// viewer.html.

import { icon, hydrateIcons } from "./icons.js";

// ── Menus ────────────────────────────────────────────────────────────────────
// One menu open at a time. A menu is positioned under its anchor, kept inside
// the window, and closed by a click outside it, Escape, a scroll of the page,
// or picking an item.

let openMenuEl = null;
let openAnchor = null;
let cleanupMenu = null;

export function closeMenus() {
  if (!openMenuEl) return;
  openMenuEl.hidden = true;
  if (openAnchor) openAnchor.setAttribute("aria-expanded", "false");
  if (cleanupMenu) cleanupMenu();
  openMenuEl = null;
  openAnchor = null;
  cleanupMenu = null;
}

export function menuIsOpen() { return !!openMenuEl; }

/** Open `menuEl` under `anchorEl`; a second call with the same menu closes it. */
export function toggleMenu(menuEl, anchorEl, { align = "start", x, y } = {}) {
  if (openMenuEl === menuEl) { closeMenus(); return false; }
  closeMenus();
  menuEl.hidden = false;
  hydrateIcons(menuEl);
  const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  let left, top;
  if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    left = align === "end" ? r.right - mw : align === "center" ? r.left + r.width / 2 - mw / 2 : r.left;
    top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  } else {
    left = x || 0;
    top = y || 0;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, window.innerHeight - mh - 8);
  }
  left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
  menuEl.style.left = `${Math.round(left)}px`;
  menuEl.style.top = `${Math.round(top)}px`;
  if (anchorEl) anchorEl.setAttribute("aria-expanded", "true");
  openMenuEl = menuEl;
  openAnchor = anchorEl || null;

  const onDown = (e) => {
    if (menuEl.contains(e.target) || (anchorEl && anchorEl.contains(e.target))) return;
    closeMenus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closeMenus(); anchorEl?.focus(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...menuEl.querySelectorAll(".menu-item:not([disabled]):not([hidden])")];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items[next].focus();
    }
  };
  const onClick = (e) => {
    const item = e.target.closest(".menu-item");
    if (item && !item.dataset.keepOpen) setTimeout(closeMenus, 0);
  };
  const onResize = () => closeMenus();
  setTimeout(() => {
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
  }, 0);
  document.addEventListener("keydown", onKey, true);
  menuEl.addEventListener("click", onClick);
  cleanupMenu = () => {
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", onResize);
    menuEl.removeEventListener("click", onClick);
  };
  return true;
}

/** Build a transient menu from items and open it at a point (context menus). */
export function contextMenu(x, y, items) {
  let el = document.getElementById("ctx-menu-dyn");
  if (!el) {
    el = document.createElement("div");
    el.id = "ctx-menu-dyn";
    el.className = "menu";
    el.setAttribute("role", "menu");
    el.hidden = true;
    document.body.appendChild(el);
  }
  closeMenus();
  el.innerHTML = "";
  for (const it of items) {
    if (it === "-") { const s = document.createElement("div"); s.className = "menu-sep"; el.appendChild(s); continue; }
    const b = document.createElement("button");
    b.className = "menu-item" + (it.danger ? " danger" : "");
    b.setAttribute("role", "menuitem");
    b.innerHTML = `${it.icon ? icon(it.icon) : '<span class="no-icon"></span>'}<span></span>${it.kbd ? `<kbd>${it.kbd}</kbd>` : ""}`;
    b.querySelector("span:not(.no-icon)").textContent = it.label;
    if (it.swatch) {
      const sw = document.createElement("span");
      sw.className = "ctx-swatch";
      sw.style.cssText = `width:12px;height:12px;border-radius:3px;flex:none;background:${it.swatch};box-shadow:inset 0 0 0 1px rgba(0,0,0,.2)`;
      b.insertBefore(sw, b.firstChild.nextSibling);
    }
    if (it.disabled) b.disabled = true;
    b.addEventListener("click", () => { closeMenus(); it.action && it.action(); });
    el.appendChild(b);
  }
  toggleMenu(el, null, { x, y });
}

// ── Toasts ───────────────────────────────────────────────────────────────────

export function toast(message, { kind = "info", timeout = 3200, action = null } = {}) {
  const host = document.getElementById("toast-host");
  if (!host || !message) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const ic = kind === "error" ? "alert" : kind === "success" ? "check" : "info";
  el.innerHTML = icon(ic, { size: 16 });
  const span = document.createElement("span");
  span.textContent = message;
  el.appendChild(span);
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = action.label;
    b.addEventListener("click", () => { action.run(); dismiss(); });
    el.appendChild(b);
  }
  host.appendChild(el);
  while (host.children.length > 3) host.firstChild.remove();
  let t = 0;
  function dismiss() {
    clearTimeout(t);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  }
  t = setTimeout(dismiss, timeout);
  return dismiss;
}

// ── Dialogs ──────────────────────────────────────────────────────────────────
//
// openDialog({ title, icon, sub, body, actions, width }) builds a modal in the
// dialog host and returns { root, close, el(id) }. `body` is HTML (trusted —
// only this code writes it) or a Node. Each action is
// { label, kind: "primary"|"danger"|"", id, onClick(ctx) } — an onClick that
// returns false (or a promise of false) keeps the dialog open. Escape and a
// click on the backdrop cancel.

let dialogDepth = 0;
export function dialogOpen() { return dialogDepth > 0; }

export function openDialog({ title, icon: ic = "info", sub = "", body = "", actions = [], width = "", onClose = null, initialFocus = null }) {
  const host = document.getElementById("dialog-host") || document.body;
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = `modal ${width}`;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  const head = document.createElement("div");
  head.className = "modal-head";
  head.innerHTML = `<i data-icon="${ic}"></i><h3></h3>`;
  head.querySelector("h3").textContent = title;
  modal.appendChild(head);
  if (sub) {
    const p = document.createElement("p");
    p.className = "modal-sub";
    p.textContent = sub;
    modal.appendChild(p);
  }
  const bodyEl = document.createElement("div");
  bodyEl.className = "modal-body";
  if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  modal.appendChild(bodyEl);
  const acts = document.createElement("div");
  acts.className = "modal-actions";
  modal.appendChild(acts);
  back.appendChild(modal);
  host.appendChild(back);
  dialogDepth++;

  let closed = false;
  const ctx = {
    root: modal,
    el: (id) => modal.querySelector(`#${id}`),
    close,
    busy(on) { for (const b of acts.querySelectorAll("button")) b.disabled = !!on; },
  };
  function close(result) {
    if (closed) return;
    closed = true;
    dialogDepth--;
    back.remove();
    document.removeEventListener("keydown", onKey, true);
    if (onClose) onClose(result);
  }
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = `btn ${a.kind || ""} ${a.left ? "left" : ""}`.trim();
    b.textContent = a.label;
    if (a.id) b.id = a.id;
    b.addEventListener("click", async () => {
      if (!a.onClick) { close(a.value); return; }
      const r = await a.onClick(ctx);
      if (r !== false) close(a.value);
    });
    acts.appendChild(b);
  }
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(null); }
    else if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") {
      const primary = acts.querySelector(".btn.primary:not([disabled]), .btn.danger:not([disabled])");
      if (primary && modal.contains(e.target)) { e.preventDefault(); primary.click(); }
    }
  };
  document.addEventListener("keydown", onKey, true);
  back.addEventListener("pointerdown", (e) => { if (e.target === back) close(null); });
  hydrateIcons(modal);
  requestAnimationFrame(() => {
    const f = initialFocus ? modal.querySelector(initialFocus) : modal.querySelector("input:not([type=checkbox]):not([type=radio]), select, textarea, .btn.primary");
    if (f) f.focus();
  });
  return ctx;
}

/** A yes/no question. Resolves true for the primary action. */
export function confirmDialog({ title, message, confirm = "OK", danger = false, icon: ic = "alert" }) {
  return new Promise((resolve) => {
    openDialog({
      title, icon: ic, sub: message,
      actions: [
        { label: "Cancel", value: false },
        { label: confirm, kind: danger ? "danger" : "primary", value: true },
      ],
      onClose: (v) => resolve(!!v),
    });
  });
}

/** A single-line text question. Resolves the text, or null when cancelled. */
export function promptDialog({ title, message = "", value = "", placeholder = "", confirm = "OK", icon: ic = "type", type = "text" }) {
  return new Promise((resolve) => {
    let out = null;
    const body = document.createElement("div");
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.placeholder = placeholder;
    input.style.width = "100%";
    body.appendChild(input);
    openDialog({
      title, icon: ic, sub: message, body,
      actions: [
        { label: "Cancel" },
        { label: confirm, kind: "primary", onClick: () => { out = input.value; } },
      ],
      onClose: () => resolve(out),
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  });
}

/** Human-readable size for a byte count. */
export function formatBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/** Escape text for use inside innerHTML built by these dialogs. */
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
