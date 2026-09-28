// signature.js
//
// Fill & Sign: making a signature (or initials) to place on the page — drawn
// with the mouse, pen or finger, typed in a handwriting face, or taken from a
// photo or scan of a signature on paper — and keeping the ones made, so the
// next document is signed with a click. Kept in this browser only
// (localStorage), never sent anywhere.
//
// pickSignature(kind) resolves { data: PNG data URL, format: "png", w, h }
// trimmed to the ink, with a transparent background; or null when cancelled.

import { openDialog, toast } from "./ui.js";
import { icon, hydrateIcons } from "./icons.js";

const STORE_KEY = "pdfViewerSignatures";
const MAX_SAVED = 6;
const INKS = [["Black", "#111827"], ["Blue", "#1d3fa8"], ["Navy", "#0b1f4d"]];
const FONTS = [
  ['"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive', "Script"],
  ['"Lucida Handwriting", "Apple Chancery", "URW Chancery L", cursive', "Chancery"],
  ['"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive', "Hand"],
  ['"Brush Script MT", "Brush Script Std", cursive', "Brush"],
];

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; } catch { return {}; }
}
function saveStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch { return false; }
}
export function savedSignatures(kind) { return (loadStore()[kind] || []).slice(); }
function remember(kind, sig) {
  const s = loadStore();
  const list = (s[kind] || []).filter((x) => x.data !== sig.data);
  list.unshift({ id: Date.now().toString(36), data: sig.data, w: sig.w, h: sig.h });
  s[kind] = list.slice(0, MAX_SAVED);
  if (!saveStore(s)) toast("This signature could not be kept for next time (browser storage is full or blocked).", { kind: "error" });
}
function forget(kind, id) {
  const s = loadStore();
  s[kind] = (s[kind] || []).filter((x) => x.id !== id);
  saveStore(s);
}

/** Trim a canvas to its ink (non-transparent pixels) plus a small margin. */
function trimToInk(canvas, pad = 6) {
  const ctx = canvas.getContext("2d");
  const { width: W, height: H } = canvas;
  const px = ctx.getImageData(0, 0, W, H).data;
  let x1 = W, y1 = H, x2 = -1, y2 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x; if (x > x2) x2 = x;
        if (y < y1) y1 = y; if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return null;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad);
  x2 = Math.min(W - 1, x2 + pad); y2 = Math.min(H - 1, y2 + pad);
  const out = document.createElement("canvas");
  out.width = x2 - x1 + 1;
  out.height = y2 - y1 + 1;
  out.getContext("2d").drawImage(canvas, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return { data: out.toDataURL("image/png"), format: "png", w: out.width, h: out.height };
}

/** Load an image file, whiten→transparent (a photographed signature), trim. */
async function fromImageFile(file, { dropWhite = true } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const max = 1400;
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, c.width, c.height);
    if (dropWhite) {
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        // Paper goes; ink stays, with its edges softened rather than cut.
        if (lum > 200) p[i + 3] = 0;
        else if (lum > 150) p[i + 3] = Math.round(p[i + 3] * (200 - lum) / 50);
      }
      ctx.putImageData(d, 0, 0);
    }
    return trimToInk(c, 4);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function pickSignature(kind = "signature") {
  return new Promise((resolve) => {
    const label = kind === "initials" ? "initials" : "signature";
    let result = null;
    let tab = "draw";
    let ink = INKS[0][1];
    let font = FONTS[0][0];
    let uploaded = null;
    const saved = savedSignatures(kind);

    const body = document.createElement("div");
    body.innerHTML = `
      ${saved.length ? `<div class="modal-section">Your saved ${label}${saved.length === 1 ? "" : "s"}</div><div class="sig-saved"></div>` : ""}
      <div class="modal-section">${saved.length ? `Make a new ${label}` : `Make your ${label}`}</div>
      <div class="seg-tabs" role="tablist">
        <button role="tab" data-tab="draw" aria-selected="true">Draw</button>
        <button role="tab" data-tab="type" aria-selected="false">Type</button>
        <button role="tab" data-tab="upload" aria-selected="false">Image</button>
      </div>
      <div data-pane="draw">
        <div class="sig-pad"><canvas></canvas><div class="sig-baseline"></div><div class="sig-hint">Sign above the line</div></div>
      </div>
      <div data-pane="type" hidden>
        <input type="text" class="sig-name" placeholder="Type your ${kind === "initials" ? "initials" : "full name"}" style="width:100%">
        <div class="sig-typed" style="margin-top:8px"></div>
        <div class="sig-fonts"></div>
      </div>
      <div data-pane="upload" hidden>
        <label class="sig-upload"><input type="file" accept="image/*" hidden>${icon("upload", { size: 22 })}<span>Choose a photo or scan of your ${label}</span><small>The paper is made transparent; the ink is kept.</small></label>
      </div>
      <div class="sig-ink"><span>Ink</span></div>
      <label class="modal-check"><input type="checkbox" class="sig-remember" checked> Keep for next time (in this browser only)</label>`;

    // Saved ones: a click places it.
    const savedEl = body.querySelector(".sig-saved");
    if (savedEl) {
      for (const sig of saved) {
        const item = document.createElement("div");
        item.className = "sig-saved-item";
        item.tabIndex = 0;
        item.title = `Use this ${label}`;
        item.innerHTML = `<img alt=""><button class="sig-del" title="Delete" aria-label="Delete">${icon("trash", { size: 13 })}</button>`;
        item.querySelector("img").src = sig.data;
        item.addEventListener("click", (e) => {
          if (e.target.closest(".sig-del")) return;
          result = { data: sig.data, format: "png", w: sig.w, h: sig.h };
          remember(kind, result);
          dlg.close("ok");
        });
        item.querySelector(".sig-del").addEventListener("click", () => { forget(kind, sig.id); item.remove(); });
        savedEl.appendChild(item);
      }
    }

    // Tabs.
    const panes = body.querySelectorAll("[data-pane]");
    const tabs = body.querySelectorAll("[data-tab]");
    for (const t of tabs) t.addEventListener("click", () => {
      tab = t.dataset.tab;
      for (const x of tabs) x.setAttribute("aria-selected", String(x === t));
      for (const p of panes) p.hidden = p.dataset.pane !== tab;
      body.querySelector(".sig-ink").hidden = tab === "upload";
      if (tab === "type") body.querySelector(".sig-name").focus();
      if (tab === "draw") sizePad();
    });

    // Ink colours.
    const inkRow = body.querySelector(".sig-ink");
    for (const [name, hex] of INKS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch";
      b.title = name;
      b.style.background = hex;
      b.setAttribute("aria-checked", String(hex === ink));
      b.addEventListener("click", () => {
        ink = hex;
        for (const x of inkRow.querySelectorAll(".swatch")) x.setAttribute("aria-checked", String(x === b));
        redrawStrokes();
        renderTyped();
      });
      inkRow.appendChild(b);
    }

    // Draw.
    const pad = body.querySelector(".sig-pad canvas");
    const strokes = [];
    let dpr = 1;
    function sizePad() {
      const r = pad.getBoundingClientRect();
      if (!r.width) return;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      pad.width = Math.round(r.width * dpr);
      pad.height = Math.round(r.height * dpr);
      redrawStrokes();
    }
    function drawStroke(ctx, pts) {
      if (!pts.length) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x * dpr, pts[0].y * dpr);
      if (pts.length === 1) ctx.lineTo(pts[0].x * dpr + 0.1, pts[0].y * dpr);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x * dpr, pts[i].y * dpr, mx * dpr, my * dpr);
      }
      if (pts.length > 1) ctx.lineTo(pts[pts.length - 1].x * dpr, pts[pts.length - 1].y * dpr);
      ctx.stroke();
    }
    function redrawStrokes() {
      const ctx = pad.getContext("2d");
      ctx.clearRect(0, 0, pad.width, pad.height);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.4 * dpr;
      for (const s of strokes) drawStroke(ctx, s);
    }
    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      const r = pad.getBoundingClientRect();
      const s = [{ x: e.clientX - r.left, y: e.clientY - r.top }];
      strokes.push(s);
      const move = (ev) => {
        for (const ce of ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev]) s.push({ x: ce.clientX - r.left, y: ce.clientY - r.top });
        redrawStrokes();
      };
      const up = () => { pad.removeEventListener("pointermove", move); pad.removeEventListener("pointerup", up); redrawStrokes(); };
      pad.addEventListener("pointermove", move);
      pad.addEventListener("pointerup", up);
    });

    // Type.
    const nameInput = body.querySelector(".sig-name");
    const typed = body.querySelector(".sig-typed");
    const fontsRow = body.querySelector(".sig-fonts");
    function renderTyped() {
      typed.textContent = nameInput.value || (kind === "initials" ? "J.D." : "Jane Doe");
      typed.style.fontFamily = font;
      typed.style.color = ink;
      typed.style.opacity = nameInput.value ? "1" : "0.35";
      typed.style.fontSize = kind === "initials" ? "54px" : "44px";
      for (const b of fontsRow.querySelectorAll("button")) b.style.color = ink;
    }
    for (const [fam, name] of FONTS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = name;
      b.style.fontFamily = fam;
      b.setAttribute("aria-pressed", String(fam === font));
      b.addEventListener("click", () => {
        font = fam;
        for (const x of fontsRow.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
        renderTyped();
      });
      fontsRow.appendChild(b);
    }
    nameInput.addEventListener("input", renderTyped);
    renderTyped();

    // Image.
    const fileInput = body.querySelector(".sig-upload input");
    const uploadBox = body.querySelector(".sig-upload");
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      uploaded = await fromImageFile(f);
      if (!uploaded) { toast("No signature found in that image.", { kind: "error" }); return; }
      uploadBox.innerHTML = "";
      const img = document.createElement("img");
      img.src = uploaded.data;
      uploadBox.appendChild(img);
      uploadBox.appendChild(fileInput);
    });

    function make() {
      if (tab === "draw") {
        if (!strokes.length) { toast(`Draw your ${label} first.`); return null; }
        return trimToInk(pad, 8);
      }
      if (tab === "type") {
        const text = nameInput.value.trim();
        if (!text) { toast(`Type your ${label} first.`); nameInput.focus(); return null; }
        const c = document.createElement("canvas");
        const size = 120;
        const ctx = c.getContext("2d");
        ctx.font = `${size}px ${font}`;
        const w = Math.ceil(ctx.measureText(text).width) + size;
        c.width = w;
        c.height = Math.round(size * 1.8);
        ctx.font = `${size}px ${font}`;
        ctx.fillStyle = ink;
        ctx.textBaseline = "middle";
        ctx.fillText(text, size / 2, c.height / 2);
        return trimToInk(c, 10);
      }
      if (!uploaded) { toast("Choose an image first."); return null; }
      return uploaded;
    }

    const dlg = openDialog({
      title: kind === "initials" ? "Initials" : "Signature",
      icon: kind === "initials" ? "initials" : "signature",
      width: "wide",
      body,
      actions: [
        { label: "Cancel" },
        {
          label: `Place ${label}`,
          kind: "primary",
          onClick: () => {
            const sig = make();
            if (!sig) return false;
            result = sig;
            if (body.querySelector(".sig-remember").checked) remember(kind, sig);
            return true;
          },
        },
      ],
      onClose: () => resolve(result),
      initialFocus: ".seg-tabs button",
    });
    hydrateIcons(body);
    requestAnimationFrame(sizePad);
  });
}

/** An image file chosen by the user, as a data URL ready to place. */
export async function pickImage() {
  const file = await new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
    input.addEventListener("change", () => resolve(input.files && input.files[0]));
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
  if (!file) return null;
  const type = (file.type || "").toLowerCase();
  const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = data; });
  if (type === "image/jpeg" || type === "image/png") {
    return { data, format: type === "image/jpeg" ? "jpg" : "png", w: img.naturalWidth, h: img.naturalHeight };
  }
  // Anything else the browser can draw becomes a PNG (pdf-lib embeds JPEG and PNG).
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  return { data: c.toDataURL("image/png"), format: "png", w: c.width, h: c.height };
}
