// toa.js
//
// Shared "Table of Authorities" panel. Used by the PDF viewer (static import)
// and the claude.ai content script (dynamic import). Self-contained: it injects
// its own CSS and persists the minimized state + custom size to
// chrome.storage.local, so both contexts get an identical panel.
//
//   const panel = createToaPanel({ providerLabel });
//   panel.render(authorities, provider);   // authorities: [{ key, kind, url }]
//   panel.setEnabled(bool);                // honor the user's options toggle
//
// authorities should already be deduplicated; the panel groups them into
// Cases / Statutes / Rules and renders each as a plain blue hyperlink.

const STYLE_ID = "__toa_style";
const PANEL_ID = "__cl_toa";
const GROUPS = [
  ["case", "Cases"],
  ["statute", "Statutes"],
  ["rule", "Rules"],
];

const CSS = `
#${PANEL_ID} {
  position: fixed;
  top: 80px;
  right: 12px;
  width: 420px;
  min-width: 220px;
  height: 460px;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  background: #ffffff;
  color: #1f2328;
  border: 1px solid #d7dbe0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  z-index: 2147483600;
  overflow: hidden;
  container-type: inline-size;
}
#${PANEL_ID}.cl-toa-minimized { height: auto !important; }
@media (prefers-color-scheme: dark) {
  #${PANEL_ID} {
    background: #1f2024;
    color: #e6e6e6;
    border-color: #3a3c42;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
}
#${PANEL_ID} .cl-toa-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #e6e8eb;
}
@media (prefers-color-scheme: dark) {
  #${PANEL_ID} .cl-toa-header { border-bottom-color: #34363c; }
}
#${PANEL_ID} .cl-toa-title {
  font-weight: 600;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PANEL_ID} .cl-toa-count {
  min-width: 20px;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 11px;
  border-radius: 9px;
  background: #1a73e8;
  color: #fff;
}
#${PANEL_ID}[data-provider="lexis"] .cl-toa-count { background: #c8102e; }
#${PANEL_ID} .cl-toa-toggle {
  all: unset;
  cursor: pointer;
  width: 20px;
  height: 20px;
  line-height: 18px;
  text-align: center;
  border-radius: 4px;
  font-size: 16px;
  color: inherit;
}
#${PANEL_ID} .cl-toa-toggle:hover { background: rgba(127, 127, 127, 0.18); }
#${PANEL_ID} .cl-toa-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 6px 12px 12px;
  overflow-y: auto;
  font-size: clamp(13px, 3.5cqi, 18px);
}
#${PANEL_ID}.cl-toa-minimized .cl-toa-body { display: none; }
#${PANEL_ID}.cl-toa-minimized .cl-toa-header { border-bottom: none; }
#${PANEL_ID}.cl-toa-minimized .cl-toa-resize { display: none; }
#${PANEL_ID} .cl-toa-resize {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nesw-resize;
  touch-action: none;
  background: linear-gradient(45deg, transparent 0 4px, currentColor 4px 5px, transparent 5px 8px, currentColor 8px 9px, transparent 9px);
  opacity: 0.35;
}
#${PANEL_ID} .cl-toa-resize:hover { opacity: 0.7; }
#${PANEL_ID} .cl-toa-group {
  margin: 1.2em 0 0.4em;
  font-size: 0.82em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
}
#${PANEL_ID} .cl-toa-group:first-child { margin-top: 2px; }
#${PANEL_ID} .cl-toa-link {
  display: block;
  margin: 0 0 1.35em;
  color: #1a0dab;
  text-decoration: underline;
  line-height: 1.35;
  word-break: break-word;
}
#${PANEL_ID} .cl-toa-link:last-child { margin-bottom: 0; }
#${PANEL_ID} .cl-toa-link:visited { color: #6c2bd9; }
#${PANEL_ID} .cl-toa-link:hover { color: #0b53c0; }
@media (prefers-color-scheme: dark) {
  #${PANEL_ID} .cl-toa-link { color: #8ab4f8; }
  #${PANEL_ID} .cl-toa-link:visited { color: #c58af9; }
  #${PANEL_ID} .cl-toa-link:hover { color: #aecbfa; }
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

export function createToaPanel({ providerLabel } = {}) {
  injectStyle();
  const label = providerLabel || ((p) => (p === "westlaw" ? "Westlaw" : "Lexis+"));

  let el = null, bodyEl = null, countEl = null;
  let minimized = false, width = null, height = null;
  let enabled = true;
  let lastSig = "";

  // Restore persisted minimize state + custom size.
  chrome.storage.local.get(
    { toaMinimized: false, toaWidth: null, toaHeight: null },
    (s) => {
      minimized = !!s.toaMinimized;
      width = s.toaWidth || null;
      height = s.toaHeight || null;
      if (el) {
        if (width) el.style.width = `${width}px`;
        if (height) el.style.height = `${height}px`;
        applyMinimized();
      }
    }
  );

  function ensure() {
    if (el && el.isConnected) return el;
    el = document.createElement("div");
    el.id = PANEL_ID;

    const header = document.createElement("div");
    header.className = "cl-toa-header";
    header.title = "Click to minimize / maximize";

    const title = document.createElement("span");
    title.className = "cl-toa-title";
    title.textContent = "Table of Authorities";

    countEl = document.createElement("span");
    countEl.className = "cl-toa-count";

    const toggle = document.createElement("button");
    toggle.className = "cl-toa-toggle";
    toggle.type = "button";

    header.append(title, countEl, toggle);

    bodyEl = document.createElement("div");
    bodyEl.className = "cl-toa-body";

    el.append(header, bodyEl);

    if (width) el.style.width = `${width}px`;
    if (height) el.style.height = `${height}px`;

    const grip = document.createElement("div");
    grip.className = "cl-toa-resize";
    grip.title = "Drag to resize";
    el.appendChild(grip);
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const r = el.getBoundingClientRect();
      const startW = r.width, startH = r.height;
      grip.setPointerCapture(e.pointerId);
      const onMove = (ev) => {
        const w = Math.max(220, Math.min(startW + (startX - ev.clientX), window.innerWidth - 24));
        const h = Math.max(140, Math.min(startH + (ev.clientY - startY), window.innerHeight - 24));
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
      };
      const onUp = () => {
        grip.removeEventListener("pointermove", onMove);
        grip.removeEventListener("pointerup", onUp);
        width = Math.round(el.getBoundingClientRect().width);
        height = Math.round(el.getBoundingClientRect().height);
        chrome.storage.local.set({ toaWidth: width, toaHeight: height });
      };
      grip.addEventListener("pointermove", onMove);
      grip.addEventListener("pointerup", onUp);
    });

    header.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      minimized = !minimized;
      applyMinimized();
      chrome.storage.local.set({ toaMinimized: minimized });
    });

    document.documentElement.appendChild(el);
    return el;
  }

  function applyMinimized() {
    if (!el) return;
    el.classList.toggle("cl-toa-minimized", minimized);
    const t = el.querySelector(".cl-toa-toggle");
    if (t) {
      t.textContent = minimized ? "+" : "–";
      t.title = minimized ? "Maximize" : "Minimize";
    }
  }

  function render(authorities, provider) {
    if (!enabled || !authorities || !authorities.length) {
      if (el) el.style.display = "none";
      lastSig = "";
      return;
    }
    ensure();
    el.style.display = "";
    el.dataset.provider = provider;
    applyMinimized();

    // Rebuild only when the set (or provider) changed, to avoid flicker / lost
    // scroll position on incremental updates.
    const sig = provider + "|" + authorities.map((a) => a.kind + ":" + a.key).join("||");
    if (sig === lastSig) return;
    lastSig = sig;

    countEl.textContent = String(authorities.length);
    bodyEl.textContent = "";

    for (const [kind, grpLabel] of GROUPS) {
      const items = authorities
        .filter((a) => a.kind === kind)
        .sort((a, b) => a.key.localeCompare(b.key));
      if (!items.length) continue;

      const g = document.createElement("div");
      g.className = "cl-toa-group";
      g.textContent = grpLabel;
      bodyEl.appendChild(g);

      for (const a of items) {
        const lnk = document.createElement("a");
        lnk.className = "cl-toa-link";
        lnk.href = a.url;
        lnk.target = "_blank";
        lnk.rel = "noopener noreferrer";
        lnk.textContent = a.key;
        lnk.title = `Open in ${label(provider)}`;
        bodyEl.appendChild(lnk);
      }
    }
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled && el) {
      el.style.display = "none";
      lastSig = "";
    }
  }

  return { render, setEnabled };
}
