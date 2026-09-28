// annotations.js
//
// Commenting and markup on the page: the tools that make annotations, the
// layer that draws them over each page, selection, moving and resizing,
// sticky-note popups, the Comments panel, and undo/redo. The model lives here
// in PDF user space (see annot-pdf.js for its shape), so a zoom or a rotation
// only redraws it; annot-pdf.js turns it into real PDF annotations on save.
//
// viewer.js hands in a host at init — how to find a page's viewport, wrapper
// and text layer, how to pick an image or a signature, where to report — and
// calls attachPage() as it builds each page. Everything else is driven from
// the tools panel's [data-tool] buttons and the floating properties bar.

import { icon, hydrateIcons } from "./icons.js";
import { contextMenu, toast, promptDialog } from "./ui.js";
import {
  quadForRect, quadBox, markupEdge, arrowHead, lineRect, inkRect,
  uprightSize, FREETEXT_PAD, LINE_HEIGHT,
} from "./annot-pdf.js";
import { layoutEdit, SUP_SCALE, SUP_RISE } from "./pdf-text-edit.js";

// ── Tools ────────────────────────────────────────────────────────────────────

const PALETTE = ["#ffd400", "#fb923c", "#f43f5e", "#ec4899", "#a855f7", "#2563eb", "#06b6d4", "#22c55e", "#111827", "#ffffff"];

// props: which controls the properties bar shows for the tool (and for an
// annotation of the type it makes). `sticky` tools stay on after use; the rest
// hand back to selection once they have placed something, as Acrobat does.
const TOOLS = {
  highlight:   { label: "Highlight", type: "highlight", markup: true, sticky: true, props: ["color", "opacity"], hint: "Drag across text to highlight it" },
  underline:   { label: "Underline", type: "underline", markup: true, sticky: true, props: ["color"], hint: "Drag across text to underline it" },
  strikeout:   { label: "Strikethrough", type: "strikeout", markup: true, sticky: true, props: ["color"], hint: "Drag across text to strike it through" },
  note:        { label: "Sticky note", type: "note", props: ["color"], hint: "Click where the note belongs" },
  freetext:    { label: "Text box", type: "freetext", props: ["color", "fontSize", "font", "fill", "width"], hint: "Click, or drag a box, then type" },
  typewriter:  { label: "Add text", type: "typewriter", props: ["color", "fontSize", "font"], hint: "Click where the text goes, then type" },
  ink:         { label: "Draw", type: "ink", sticky: true, props: ["color", "width", "opacity"], hint: "Draw on the page · Done when finished" },
  square:      { label: "Rectangle", type: "square", props: ["color", "width", "fill", "opacity"], hint: "Drag to draw · Shift for a square" },
  circle:      { label: "Ellipse", type: "circle", props: ["color", "width", "fill", "opacity"], hint: "Drag to draw · Shift for a circle" },
  line:        { label: "Line", type: "line", props: ["color", "width", "opacity"], hint: "Drag to draw · Shift snaps to 45°" },
  arrow:       { label: "Arrow", type: "arrow", props: ["color", "width", "opacity"], hint: "Drag to draw · Shift snaps to 45°" },
  stamp:       { label: "Stamp", type: "stamp", props: ["stamp", "color", "opacity"], hint: "Click to stamp, or drag to size it" },
  signature:   { label: "Signature", type: "image", props: [], hint: "Click where you sign" },
  initials:    { label: "Initials", type: "image", props: [], hint: "Click where your initials go" },
  check:       { label: "Checkmark", type: "symbol", symbol: "check", props: ["color"], hint: "Click to place a checkmark" },
  cross:       { label: "Cross", type: "symbol", symbol: "cross", props: ["color"], hint: "Click to place a cross" },
  date:        { label: "Date", type: "typewriter", props: ["color", "fontSize", "font"], hint: "Click to place today's date" },
  image:       { label: "Image", type: "image", props: [], hint: "Click to place the image, or drag to size it" },
  whiteout:    { label: "Whiteout", type: "whiteout", props: [], hint: "Drag over what should be covered" },
  edittext:    { label: "Edit text", type: "textedit", sticky: true, props: [], hint: "Click a paragraph to edit it · Ctrl+B bold · Ctrl+I italic · Esc when done" },
  link:        { label: "Link", type: "link", props: [], hint: "Drag a box over what should be clickable" },
};
const TYPE_LABEL = {
  highlight: "Highlight", underline: "Underline", strikeout: "Strikethrough", note: "Note", freetext: "Text box",
  typewriter: "Text", ink: "Drawing", square: "Rectangle", circle: "Ellipse", whiteout: "Whiteout", line: "Line",
  arrow: "Arrow", stamp: "Stamp", symbol: "Mark", image: "Image", link: "Link", textedit: "Edited text",
};
const TYPE_PROPS = {
  highlight: ["color", "opacity"], underline: ["color"], strikeout: ["color"], note: ["color"],
  freetext: ["color", "fontSize", "font", "fill", "width"], typewriter: ["color", "fontSize", "font"],
  ink: ["color", "width", "opacity"], square: ["color", "width", "fill", "opacity"],
  circle: ["color", "width", "fill", "opacity"], whiteout: [], line: ["color", "width", "opacity"],
  arrow: ["color", "width", "opacity"], stamp: ["color", "opacity"], symbol: ["color"], image: ["opacity"], link: [],
  textedit: ["style", "color", "fontSize", "font"],
};
const DEFAULTS = {
  highlight: { color: "#ffd400", opacity: 1 },
  underline: { color: "#2563eb" },
  strikeout: { color: "#e11d48" },
  note: { color: "#ffd400" },
  freetext: { color: "#111827", fontSize: 12, font: "sans", fill: false, width: 1 },
  typewriter: { color: "#111827", fontSize: 12, font: "sans" },
  date: { color: "#111827", fontSize: 12, font: "sans" },
  ink: { color: "#e11d48", width: 2, opacity: 1 },
  square: { color: "#e11d48", width: 2, fill: false, opacity: 1 },
  circle: { color: "#e11d48", width: 2, fill: false, opacity: 1 },
  line: { color: "#e11d48", width: 2, opacity: 1 },
  arrow: { color: "#e11d48", width: 2, opacity: 1 },
  stamp: { color: "", opacity: 1, stamp: "APPROVED" },
  check: { color: "#111827" },
  cross: { color: "#111827" },
};
const STAMP_COLORS = {
  "APPROVED": "#15803d", "COMPLETED": "#15803d", "FINAL": "#15803d", "REVIEWED": "#15803d", "RECEIVED": "#15803d",
  "NOT APPROVED": "#b91c1c", "VOID": "#b91c1c", "CONFIDENTIAL": "#b91c1c", "SIGN HERE": "#b91c1c",
  "DRAFT": "#1d4ed8", "FOR COMMENT": "#1d4ed8",
};
const FONT_CSS = {
  sans: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  serif: '"Times New Roman", Times, "Liberation Serif", serif',
  mono: '"Courier New", Courier, "Liberation Mono", monospace',
};

// ── State ────────────────────────────────────────────────────────────────────

const annots = new Map();        // id -> model
let importedRefs = new Set();    // pdf.js ids of annotations read from the file
let selectedId = null;
let tool = null;                 // key of TOOLS, or null
let pendingImage = null;         // { data, format, w, h, role } waiting to be placed
let inkSession = null;           // { id, page } strokes drawn in this tool session
let editingId = null;            // freetext (or text edit) being typed into
const blockCache = new Map();    // page -> { blocks, promise }: its paragraphs, for Edit text
const scanNoticeShown = new Set();
const history = [];
const future = [];
let editSeq = 0, savedSeq = 0;
let seq = 1;
let host = null;
const pages = new Map();         // page -> { wrapper, layer }
const listeners = new Set();
let prefs = loadPrefs();
let author = loadAuthor();
let lastPropPush = { key: "", t: 0 };

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem("pdfViewerAnnotPrefs") || "{}") || {}; } catch { return {}; }
}
function savePrefs() {
  try { localStorage.setItem("pdfViewerAnnotPrefs", JSON.stringify(prefs)); } catch { /* storage blocked */ }
}
function loadAuthor() {
  try { return localStorage.getItem("pdfViewerAuthor") || ""; } catch { return ""; }
}
function toolPref(name, key) {
  const p = prefs[name];
  if (p && p[key] !== undefined) return p[key];
  const d = DEFAULTS[name] || {};
  return d[key];
}
function setToolPref(name, key, value) {
  if (!name) return;
  prefs[name] = { ...(prefs[name] || {}), [key]: value };
  savePrefs();
}

const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── Colours ──────────────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(c) {
  if (!c) return "#000000";
  return "#" + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
}
const css = (c, a = 1) => (c ? `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})` : "transparent");
const tint = (c, k = 0.82) => (c ? c.map((v) => v + (1 - v) * k) : null);

// ── Geometry ─────────────────────────────────────────────────────────────────

function vp(pn) { return host.getViewport(pn); }
function viewBox(pn, rect) {
  const v = vp(pn);
  if (!v) return { left: 0, top: 0, width: 0, height: 0 };
  const [x1, y1, x2, y2] = v.convertToViewportRectangle(rect);
  return { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}
function viewPt(pn, x, y) { return vp(pn).convertToViewportPoint(x, y); }
function pdfPt(pn, x, y) { return vp(pn).convertToPdfPoint(x, y); }
function pdfRect(pn, l, t, r, b) {
  const [ax, ay] = pdfPt(pn, l, t);
  const [bx, by] = pdfPt(pn, r, b);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}
function rotationOf(pn) { const v = vp(pn); return v ? ((v.rotation % 360) + 360) % 360 : 0; }
function scaleOf(pn) { const v = vp(pn); return v ? v.scale : 1; }
function layerPoint(e, layer) {
  const r = layer.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function translate(a, dx, dy) {
  const mv = (arr) => arr.map((v, i) => v + (i % 2 ? dy : dx));
  a.rect = mv(a.rect);
  if (a.quads) a.quads = a.quads.map(mv);
  if (a.inkList) a.inkList = a.inkList.map(mv);
  if (a.line) a.line = mv(a.line);
}
function scaleInto(a, nr) {
  const [ox1, oy1, ox2, oy2] = a.rect;
  const sx = (nr[2] - nr[0]) / ((ox2 - ox1) || 1), sy = (nr[3] - nr[1]) / ((oy2 - oy1) || 1);
  const map = (arr) => arr.map((v, i) => (i % 2 ? nr[1] + (v - oy1) * sy : nr[0] + (v - ox1) * sx));
  if (a.inkList) a.inkList = a.inkList.map(map);
  a.rect = nr;
}

// ── Model changes, history ───────────────────────────────────────────────────

function clone(a) {
  const c = { ...a };
  for (const k of ["rect", "color", "fill", "borderColor", "line", "orig"]) if (Array.isArray(a[k])) c[k] = a[k].slice();
  if (a.runs) c.runs = a.runs.map((r) => ({ ...r }));
  if (a.quads) c.quads = a.quads.map((q) => q.slice());
  if (a.inkList) c.inkList = a.inkList.map((p) => p.slice());
  return c;
}
function snapshot() { return [...annots.values()].map(clone); }
function pushHistory() {
  history.push(snapshot());
  if (history.length > 150) history.shift();
  future.length = 0;
}
function restore(list) {
  annots.clear();
  for (const a of list) annots.set(a.id, a);
  if (selectedId && !annots.has(selectedId)) selectedId = null;
  changed({ all: true });
}
function changed({ page = null, all = false } = {}) {
  editSeq++;
  if (all) paintAll(); else if (page) paintPage(page);
  syncBar();
  for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } }
}
function touch(a) {
  if (a.origRef) a.dirty = true;
  a.modified = Date.now();
}
function add(a) {
  a.id = a.id || newId();
  a.created = a.created || Date.now();
  a.modified = Date.now();
  a.author = a.author ?? author;
  annots.set(a.id, a);
  return a;
}

// ── Painting ─────────────────────────────────────────────────────────────────

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function place(el, b) {
  el.style.left = `${b.left}px`;
  el.style.top = `${b.top}px`;
  el.style.width = `${Math.max(1, b.width)}px`;
  el.style.height = `${Math.max(1, b.height)}px`;
}
/** A child box that holds upright content inside a rotated annotation. */
function uprightBox(el, a, pn) {
  const delta = (((rotationOf(pn) - (a.rotate || 0)) % 360) + 360) % 360;
  const inner = document.createElement("div");
  const s = scaleOf(pn);
  const [W, H] = uprightSize(a.rect, a.rotate || 0);
  inner.style.position = "absolute";
  inner.style.width = `${W * s}px`;
  inner.style.height = `${H * s}px`;
  if (delta) {
    inner.style.left = "50%";
    inner.style.top = "50%";
    inner.style.transform = `translate(-50%, -50%) rotate(${delta}deg)`;
  } else {
    inner.style.left = "0";
    inner.style.top = "0";
  }
  el.appendChild(inner);
  return { inner, W, H, s };
}

let measureCtx = null;
function textWidth(str, font) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = font;
  return measureCtx.measureText(str).width;
}

function renderAnnot(a, pn) {
  const s = scaleOf(pn);
  const el = document.createElement("div");
  el.className = `annot ${a.type}`;
  el.dataset.id = a.id;
  const box = viewBox(pn, a.rect);
  place(el, box);
  const op = a.opacity ?? 1;

  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout": {
      el.classList.add("markup");
      const R = rotationOf(pn);
      const edge = markupEdge((a.textRot || 0) - R);
      for (const q of a.quads) {
        const qb = viewBox(pn, quadBox(q));
        const d = document.createElement("div");
        d.style.position = "absolute";
        if (a.type === "highlight") {
          d.style.left = `${qb.left - box.left}px`;
          d.style.top = `${qb.top - box.top}px`;
          d.style.width = `${qb.width}px`;
          d.style.height = `${qb.height}px`;
          d.style.background = css(a.color);
          d.style.opacity = String(op * 0.55);
          d.style.mixBlendMode = "multiply";
        } else {
          const vertical = edge === "left" || edge === "right";
          const thick = Math.max(1, (vertical ? qb.width : qb.height) * 0.07);
          d.style.background = css(a.color);
          if (a.type === "strikeout") {
            if (vertical) { d.style.left = `${qb.left - box.left + qb.width / 2 - thick / 2}px`; d.style.top = `${qb.top - box.top}px`; d.style.width = `${thick}px`; d.style.height = `${qb.height}px`; }
            else { d.style.left = `${qb.left - box.left}px`; d.style.top = `${qb.top - box.top + qb.height / 2 - thick / 2}px`; d.style.width = `${qb.width}px`; d.style.height = `${thick}px`; }
          } else if (edge === "bottom" || edge === "top") {
            d.style.left = `${qb.left - box.left}px`;
            d.style.top = `${qb.top - box.top + (edge === "bottom" ? qb.height - thick * 2.2 : thick * 1.2)}px`;
            d.style.width = `${qb.width}px`;
            d.style.height = `${thick}px`;
          } else {
            d.style.top = `${qb.top - box.top}px`;
            d.style.left = `${qb.left - box.left + (edge === "right" ? qb.width - thick * 2.2 : thick * 1.2)}px`;
            d.style.height = `${qb.height}px`;
            d.style.width = `${thick}px`;
          }
        }
        el.appendChild(d);
      }
      break;
    }
    case "note": {
      const ic = document.createElement("div");
      ic.className = "note-icon";
      ic.style.background = css(a.color || [1, 0.83, 0]);
      ic.innerHTML = icon("message", { size: Math.max(10, Math.round(box.width * 0.62)), stroke: 2 });
      el.appendChild(ic);
      el.title = a.contents ? a.contents.slice(0, 300) : "Double-click to open the note";
      break;
    }
    case "freetext":
    case "typewriter": {
      const { inner } = uprightBox(el, a, pn);
      const body = document.createElement("div");
      body.className = "ft-body";
      const pad = (FREETEXT_PAD[a.type] ?? 4) * s;
      const bw = a.type === "freetext" && a.borderColor && a.width > 0 ? a.width * s : 0;
      body.style.padding = `${pad + bw}px`;
      body.style.fontSize = `${(a.fontSize || 12) * s}px`;
      body.style.lineHeight = String(LINE_HEIGHT);
      body.style.fontFamily = FONT_CSS[a.font] || FONT_CSS.sans;
      body.style.color = css(a.color || [0, 0, 0]);
      if (a.fill) body.style.background = css(a.fill);
      if (bw) body.style.boxShadow = `inset 0 0 0 ${bw}px ${css(a.borderColor)}`;
      if (a.type === "typewriter") body.style.whiteSpace = "pre";
      body.style.opacity = String(op);
      body.textContent = a.text || "";
      inner.appendChild(body);
      break;
    }
    case "ink": {
      const svg = svgEl("svg");
      svg.setAttribute("overflow", "visible");
      const g = svgEl("g", { fill: "none", stroke: css(a.color || [0, 0, 0]), "stroke-width": String((a.width || 1) * s), "stroke-linecap": "round", "stroke-linejoin": "round", opacity: String(op) });
      for (const p of a.inkList) {
        const pts = [];
        for (let i = 0; i + 1 < p.length; i += 2) {
          const [x, y] = viewPt(pn, p[i], p[i + 1]);
          pts.push(`${(x - box.left).toFixed(1)},${(y - box.top).toFixed(1)}`);
        }
        if (pts.length === 1) pts.push(pts[0]);
        g.appendChild(svgEl("polyline", { points: pts.join(" ") }));
      }
      svg.appendChild(g);
      el.appendChild(svg);
      break;
    }
    case "square":
    case "circle":
    case "whiteout": {
      const svg = svgEl("svg");
      const w = a.color && a.width > 0 ? a.width * s : 0;
      const attrs = {
        fill: a.fill ? css(a.fill) : "none",
        stroke: w ? css(a.color) : "none",
        "stroke-width": String(w),
        opacity: String(op),
      };
      if (a.type === "circle") {
        svg.appendChild(svgEl("ellipse", { ...attrs, cx: box.width / 2, cy: box.height / 2, rx: Math.max(0, box.width / 2 - w / 2), ry: Math.max(0, box.height / 2 - w / 2) }));
      } else {
        svg.appendChild(svgEl("rect", { ...attrs, x: w / 2, y: w / 2, width: Math.max(0, box.width - w), height: Math.max(0, box.height - w) }));
      }
      el.appendChild(svg);
      if (a.type === "whiteout") el.title = "Whiteout";
      break;
    }
    case "line":
    case "arrow": {
      const svg = svgEl("svg");
      svg.setAttribute("overflow", "visible");
      const [x0, y0] = viewPt(pn, a.line[0], a.line[1]);
      const [x1, y1] = viewPt(pn, a.line[2], a.line[3]);
      const g = svgEl("g", { fill: "none", stroke: css(a.color || [0, 0, 0]), "stroke-width": String((a.width || 1) * s), "stroke-linecap": "round", "stroke-linejoin": "round", opacity: String(op) });
      g.appendChild(svgEl("line", { x1: x0 - box.left, y1: y0 - box.top, x2: x1 - box.left, y2: y1 - box.top }));
      if (a.type === "arrow") {
        const [[ax, ay], [bx, by]] = arrowHead(x0, y0, x1, y1, (a.width || 1) * s);
        g.appendChild(svgEl("polyline", { points: `${ax - box.left},${ay - box.top} ${x1 - box.left},${y1 - box.top} ${bx - box.left},${by - box.top}` }));
      }
      // A fat invisible stroke so a thin line is easy to click.
      const hit = svgEl("line", { x1: x0 - box.left, y1: y0 - box.top, x2: x1 - box.left, y2: y1 - box.top, stroke: "transparent", "stroke-width": "12" });
      svg.append(g, hit);
      el.appendChild(svg);
      el.style.pointerEvents = "none";
      hit.style.pointerEvents = "stroke";
      hit.style.cursor = "pointer";
      break;
    }
    case "stamp": {
      const { inner, W, H } = uprightBox(el, a, pn);
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
      svg.style.opacity = String(op);
      const c = css(a.color || [0.75, 0.1, 0.1]);
      const bw = Math.max(1.5, Math.min(W, H) * 0.07);
      svg.appendChild(svgEl("rect", { x: bw / 2, y: bw / 2, width: W - bw, height: H - bw, rx: Math.min(W, H) * 0.18, fill: "none", stroke: c, "stroke-width": bw }));
      const label = a.label || "STAMP";
      const w1 = textWidth(label, "bold 100px Helvetica, Arial, sans-serif") / 100 || 1;
      const size = Math.max(4, Math.min(H * 0.56, (W - bw * 2 - H * 0.3) / w1));
      const t = svgEl("text", { x: W / 2, y: H / 2 + size * 0.36, "text-anchor": "middle", fill: c, "font-family": "Helvetica, Arial, sans-serif", "font-weight": "700", "font-size": size });
      t.textContent = label;
      svg.appendChild(t);
      inner.appendChild(svg);
      break;
    }
    case "symbol": {
      const { inner, W, H } = uprightBox(el, a, pn);
      const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}` });
      const c = css(a.color || [0, 0, 0]);
      const sz = Math.min(W, H), lw = Math.max(0.8, sz * 0.12);
      // SVG y runs down; the PDF appearance's y runs up.
      const Y = (v) => H - v;
      if (a.symbol === "dot") svg.appendChild(svgEl("circle", { cx: W / 2, cy: H / 2, r: sz * 0.3, fill: c }));
      else if (a.symbol === "cross") {
        const g = svgEl("g", { stroke: c, "stroke-width": lw, "stroke-linecap": "round" });
        g.append(svgEl("line", { x1: W * 0.18, y1: Y(H * 0.18), x2: W * 0.82, y2: Y(H * 0.82) }), svgEl("line", { x1: W * 0.18, y1: Y(H * 0.82), x2: W * 0.82, y2: Y(H * 0.18) }));
        svg.appendChild(g);
      } else {
        svg.appendChild(svgEl("polyline", { points: `${W * 0.14},${Y(H * 0.52)} ${W * 0.4},${Y(H * 0.22)} ${W * 0.88},${Y(H * 0.84)}`, fill: "none", stroke: c, "stroke-width": lw, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      }
      inner.appendChild(svg);
      break;
    }
    case "image": {
      const { inner } = uprightBox(el, a, pn);
      const img = document.createElement("img");
      img.src = a.image.data;
      img.alt = a.role === "signature" ? "Signature" : a.role === "initials" ? "Initials" : "Image";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.opacity = String(op);
      img.draggable = false;
      inner.appendChild(img);
      break;
    }
    case "link":
      el.title = a.url ? a.url : a.destPage ? `Go to page ${a.destPage}` : "Link";
      break;
    case "textedit": {
      const { inner } = uprightBox(el, a, pn);
      inner.classList.add("te-body");
      paintTextLines(inner, a, s);
      break;
    }
  }

  if (a.id === selectedId) {
    el.classList.add("selected");
    if (el.classList.contains("markup")) {
      for (const q of a.quads) {
        const qb = viewBox(pn, quadBox(q));
        const d = document.createElement("div");
        d.className = "annot-mark-sel";
        d.style.left = `${qb.left - box.left - 2}px`;
        d.style.top = `${qb.top - box.top - 2}px`;
        d.style.width = `${qb.width + 4}px`;
        d.style.height = `${qb.height + 4}px`;
        el.appendChild(d);
      }
    } else addHandles(el, a, pn, box);
  }
  wireAnnot(el, a, pn);
  return el;
}

const RESIZABLE = new Set(["freetext", "typewriter", "square", "circle", "whiteout", "stamp", "symbol", "image", "link", "ink", "textedit"]);
function addHandles(el, a, pn, box) {
  if (a.type === "line" || a.type === "arrow") {
    const [x0, y0] = viewPt(pn, a.line[0], a.line[1]);
    const [x1, y1] = viewPt(pn, a.line[2], a.line[3]);
    for (const [h, x, y] of [["p0", x0, y0], ["p1", x1, y1]]) {
      const d = document.createElement("div");
      d.className = "annot-handle";
      d.dataset.h = h;
      d.style.left = `${x - box.left}px`;
      d.style.top = `${y - box.top}px`;
      el.appendChild(d);
    }
    return;
  }
  if (!RESIZABLE.has(a.type)) return;
  const hs = a.type === "typewriter" || a.type === "textedit" ? ["e", "w"] : ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  for (const h of hs) {
    const d = document.createElement("div");
    d.className = "annot-handle";
    d.dataset.h = h;
    d.style.left = `${h.includes("w") ? 0 : h.includes("e") ? box.width : box.width / 2}px`;
    d.style.top = `${h.includes("n") ? 0 : h.includes("s") ? box.height : box.height / 2}px`;
    el.appendChild(d);
  }
}

export function paintPage(pn) {
  const p = pages.get(pn);
  if (!p || !p.layer.isConnected || !vp(pn)) return;
  // A note's open popup and a text box being typed in stay put across a
  // repaint: taking a focused box out of the page would end the typing.
  const live = editingId && p.editingEl && p.editingEl.isConnected ? p.editingEl : null;
  for (const child of [...p.layer.children]) {
    if (child === live) continue;
    if (child.classList.contains("note-popup") && annots.has(child.dataset.id)) continue;
    child.remove();
  }
  const first = p.layer.firstChild;
  for (const a of annots.values()) {
    if (a.page !== pn) continue;
    if (live && a.id === editingId) continue;
    p.layer.insertBefore(renderAnnot(a, pn), first);
  }
  // An edited paragraph's old words are hidden on screen until the save
  // takes them out of the file.
  for (const a of annots.values()) {
    if (a.page !== pn || a.type !== "textedit") continue;
    const c = document.createElement("div");
    c.className = "te-cover";
    place(c, viewBox(pn, a.orig));
    p.layer.insertBefore(c, p.layer.firstChild);
  }
  if (tool === "edittext") paintBlocks(pn);
}
export function paintAll() { for (const pn of pages.keys()) paintPage(pn); }

// ── Page wiring ──────────────────────────────────────────────────────────────

/** Called by the viewer for each page it (re)builds. */
export function attachPage(pn, wrapper, layer) {
  pages.set(pn, { wrapper, layer, editingEl: null });
  layer.dataset.page = String(pn);
  layer.addEventListener("pointerdown", (e) => onLayerDown(e, pn, layer));
  layer.addEventListener("pointermove", (e) => {
    if (tool !== "edittext") return;
    const pt = layerPoint(e, layer);
    const [x, y] = pdfPt(pn, pt.x, pt.y);
    const b = blockAt(pn, x, y);
    for (const d of layer.querySelectorAll(".te-block")) d.classList.toggle("hover", d.__block === b);
  });
  // A click on a markup (which never takes the pointer itself, so the text
  // under it stays selectable) selects it, when it is a click and not a drag.
  let down = null;
  wrapper.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  wrapper.addEventListener("click", (e) => {
    if (tool || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 3) return;
    if (e.target.closest(".annot:not(.markup), .note-popup, .annot-handle, a")) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const pt = layerPoint(e, layer);
    const hit = markupAt(pn, pt.x, pt.y);
    if (hit) select(hit.id);
    else if (selectedId) select(null);
  });
  paintPage(pn);
}

export function detachAll() {
  // A zoom rebuilds every page: text being typed is kept, not dropped.
  if (editingId) finishEditing();
  pages.clear();
}

function markupAt(pn, x, y) {
  const list = [...annots.values()].filter((a) => a.page === pn && a.quads).reverse();
  for (const a of list) {
    for (const q of a.quads) {
      const b = viewBox(pn, quadBox(q));
      if (x >= b.left - 1 && x <= b.left + b.width + 1 && y >= b.top - 1 && y <= b.top + b.height + 1) return a;
    }
  }
  return null;
}

/** The markup under a client point on a page, for the right-click menu. */
export function annotAtClient(pn, clientX, clientY) {
  const p = pages.get(pn);
  if (!p) return null;
  const r = p.layer.getBoundingClientRect();
  return markupAt(pn, clientX - r.left, clientY - r.top);
}

// ── Select, move, resize ─────────────────────────────────────────────────────

export function select(id, { scroll = false } = {}) {
  if (editingId && editingId !== id) finishEditing();
  const prev = selectedId ? annots.get(selectedId) : null;
  selectedId = id && annots.has(id) ? id : null;
  const cur = selectedId ? annots.get(selectedId) : null;
  if (prev) paintPage(prev.page);
  if (cur && (!prev || prev.page !== cur.page)) paintPage(cur.page);
  document.body.classList.toggle("annot-editing", !!(selectedId || tool));
  syncBar();
  for (const fn of listeners) { try { fn({ selection: true }); } catch { /* listener */ } }
  if (cur && scroll) {
    host.scrollToPage(cur.page, { smooth: false });
    requestAnimationFrame(() => {
      const el = pages.get(cur.page)?.layer.querySelector(`.annot[data-id="${cur.id}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}
export function selected() { return selectedId ? annots.get(selectedId) : null; }

function wireAnnot(el, a, pn) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // A drawing tool draws over whatever is there; markup tools select. In
    // Edit text an edited paragraph is clicked into (or dragged, or resized).
    if (tool && !TOOLS[tool].markup && !(tool === "edittext" && a.type === "textedit")) return;
    const handle = e.target.closest(".annot-handle");
    if (editingId === a.id && !handle) return; // clicks inside the text being typed
    e.stopPropagation();
    e.preventDefault();
    if (selectedId !== a.id) select(a.id);
    startDrag(e, a, pn, handle ? handle.dataset.h : null);
  });
  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (a.type === "freetext" || a.type === "typewriter" || a.type === "textedit") startEditing(a.id, { clientX: e.clientX, clientY: e.clientY });
    else if (a.type === "note") openNotePopup(a.id);
    else if (a.type === "link") editLink(a);
    else if (a.type === "stamp") editStampLabel(a);
    else openNotePopup(a.id);
  });
}

function startDrag(e, a, pn, handle) {
  const p = pages.get(pn);
  if (!p) return;
  const start = layerPoint(e, p.layer);
  const orig = clone(a);
  const origBox = viewBox(pn, a.rect);
  const aspect = origBox.width / (origBox.height || 1);
  let moved = false;
  const onMove = (ev) => {
    const cur = layerPoint(ev, p.layer);
    const dxp = cur.x - start.x, dyp = cur.y - start.y;
    if (!moved && Math.hypot(dxp, dyp) < 3) return;
    if (!moved) { moved = true; pushHistory(); }
    const target = annots.get(a.id);
    if (!target) return;
    Object.assign(target, clone(orig));
    if (!handle) {
      const [x0, y0] = pdfPt(pn, start.x, start.y);
      const [x1, y1] = pdfPt(pn, cur.x, cur.y);
      translate(target, x1 - x0, y1 - y0);
    } else if (handle === "p0" || handle === "p1") {
      let [px, py] = pdfPt(pn, cur.x, cur.y);
      if (ev.shiftKey) {
        const [ox, oy] = handle === "p0" ? [orig.line[2], orig.line[3]] : [orig.line[0], orig.line[1]];
        [px, py] = snap45(ox, oy, px, py);
      }
      if (handle === "p0") { target.line[0] = px; target.line[1] = py; } else { target.line[2] = px; target.line[3] = py; }
      target.rect = lineRect(target.line, target.width || 1, target.type === "arrow");
    } else {
      let { left, top, width, height } = origBox;
      let r = left + width, b = top + height;
      if (handle.includes("w")) left = Math.min(r - 8, left + dxp);
      if (handle.includes("e")) r = Math.max(left + 8, r + dxp);
      if (handle.includes("n")) top = Math.min(b - 8, top + dyp);
      if (handle.includes("s")) b = Math.max(top + 8, b + dyp);
      if ((target.type === "image" || target.type === "symbol" || ev.shiftKey) && handle.length === 2) {
        // Corners keep the shape of a picture (and of anything, with Shift).
        const w = r - left, h = b - top;
        if (w / h > aspect) { const nw = h * aspect; if (handle.includes("w")) left = r - nw; else r = left + nw; }
        else { const nh = w / aspect; if (handle.includes("n")) top = b - nh; else b = top + nh; }
      }
      const nr = pdfRect(pn, left, top, r, b);
      if (target.type === "ink") scaleInto(target, nr); else target.rect = nr;
    }
    touch(target);
    paintPage(pn);
  };
  const onUp = (ev) => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    if (moved) {
      const t = annots.get(a.id);
      if (t && (t.type === "freetext") && handle && handle !== "p0" && handle !== "p1") fitTextHeight(t, pn);
      if (t && t.type === "textedit") relayout(t);
      changed({ page: pn });
    } else if (a.type === "textedit" && tool === "edittext" && !handle) {
      startEditing(a.id, { clientX: ev.clientX, clientY: ev.clientY });
    }
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
}

function snap45(ox, oy, x, y) {
  const ang = Math.atan2(y - oy, x - ox);
  const step = Math.PI / 4;
  const a = Math.round(ang / step) * step;
  const len = Math.hypot(x - ox, y - oy);
  return [ox + Math.cos(a) * len, oy + Math.sin(a) * len];
}

// ── Creating ─────────────────────────────────────────────────────────────────

function currentColor(t) {
  const hex = toolPref(t, "color");
  if (t === "stamp" && !hex) return hexToRgb(STAMP_COLORS[toolPref("stamp", "stamp")] || "#b91c1c");
  return hexToRgb(hex || "#111827");
}

function onLayerDown(e, pn, layer) {
  if (!tool || e.button !== 0) return;
  const def = TOOLS[tool];
  if (def.markup) return;
  e.preventDefault();
  e.stopPropagation();
  const start = layerPoint(e, layer);
  const s = scaleOf(pn);
  const R = rotationOf(pn);

  if (tool === "edittext") { editTextAt(e, pn, start); return; }
  if (tool === "ink") { drawInk(e, pn, layer, start); return; }

  const click = new Set(["note", "typewriter", "date", "check", "cross", "signature", "initials"]);
  if (click.has(tool)) { placeAt(pn, start, R, s); return; }

  // Drag tools: square, circle, whiteout, link, line, arrow, freetext, stamp, image.
  const draft = document.createElement("div");
  draft.className = "annot-draft";
  const svg = svgEl("svg");
  svg.setAttribute("overflow", "visible");
  draft.appendChild(svg);
  layer.appendChild(draft);
  const isLine = tool === "line" || tool === "arrow";
  let cur = start;
  const col = css(currentColor(tool));
  const paint = (ev) => {
    cur = layerPoint(ev, layer);
    if (isLine && ev && ev.shiftKey) {
      const [sx, sy] = snap45(start.x, -start.y, cur.x, -cur.y);
      cur = { x: sx, y: -sy };
    }
    let l = Math.min(start.x, cur.x), t = Math.min(start.y, cur.y), w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    if (!isLine && ev && ev.shiftKey && (tool === "square" || tool === "circle")) { const m = Math.max(w, h); w = h = m; if (cur.x < start.x) l = start.x - m; if (cur.y < start.y) t = start.y - m; }
    draft.style.left = "0"; draft.style.top = "0"; draft.style.width = "100%"; draft.style.height = "100%";
    svg.textContent = "";
    const sw = Math.max(1, (toolPref(tool, "width") || 1) * s);
    if (isLine) svg.appendChild(svgEl("line", { x1: start.x, y1: start.y, x2: cur.x, y2: cur.y, stroke: col, "stroke-width": sw, "stroke-linecap": "round" }));
    else if (tool === "circle") svg.appendChild(svgEl("ellipse", { cx: l + w / 2, cy: t + h / 2, rx: w / 2, ry: h / 2, fill: "none", stroke: col, "stroke-width": sw }));
    else svg.appendChild(svgEl("rect", { x: l, y: t, width: w, height: h, fill: tool === "whiteout" ? "#fff" : "rgba(37,99,235,0.06)", stroke: tool === "whiteout" ? "#94a3b8" : (tool === "square" ? col : "#2563eb"), "stroke-width": tool === "square" ? sw : 1, "stroke-dasharray": tool === "square" ? "" : "4 3" }));
    draft.__box = { l, t, w, h };
  };
  paint(e);
  const onMove = (ev) => paint(ev);
  const onUp = async (ev) => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    draft.remove();
    const bx = draft.__box || { l: start.x, t: start.y, w: 0, h: 0 };
    const dragged = bx.w > 4 || bx.h > 4;
    if (isLine) {
      if (!dragged) { placeAt(pn, start, R, s, { line: true }); return; }
      const [x0, y0] = pdfPt(pn, start.x, start.y);
      const [x1, y1] = pdfPt(pn, cur.x, cur.y);
      const w = toolPref(tool, "width") || 2;
      pushHistory();
      const a = add({ page: pn, type: tool, line: [x0, y0, x1, y1], color: currentColor(tool), width: w, opacity: toolPref(tool, "opacity") ?? 1 });
      a.rect = lineRect(a.line, w, tool === "arrow");
      afterCreate(a);
      return;
    }
    if (!dragged) { placeAt(pn, start, R, s); return; }
    await createBox(pn, pdfRect(pn, bx.l, bx.t, bx.l + bx.w, bx.t + bx.h), R, s);
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
}

/** A click with a tool that places something of a standard size. */
async function placeAt(pn, pt, R, s, { line = false } = {}) {
  const t = tool;
  const at = (w, h) => pdfRect(pn, pt.x, pt.y, pt.x + w * s, pt.y + h * s);
  const centered = (w, h) => pdfRect(pn, pt.x - (w * s) / 2, pt.y - (h * s) / 2, pt.x + (w * s) / 2, pt.y + (h * s) / 2);
  if (line) {
    const [x0, y0] = pdfPt(pn, pt.x, pt.y);
    const [x1, y1] = pdfPt(pn, pt.x + 120 * s, pt.y);
    const w = toolPref(t, "width") || 2;
    pushHistory();
    const a = add({ page: pn, type: t, line: [x0, y0, x1, y1], color: currentColor(t), width: w, opacity: toolPref(t, "opacity") ?? 1 });
    a.rect = lineRect(a.line, w, t === "arrow");
    afterCreate(a);
    return;
  }
  switch (t) {
    case "note": {
      pushHistory();
      const a = add({ page: pn, type: "note", rect: at(20, 20), color: currentColor("note"), contents: "" });
      afterCreate(a, { openNote: true });
      return;
    }
    case "typewriter":
    case "date": {
      const size = toolPref(t, "fontSize") || 12;
      const text = t === "date" ? new Date().toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
      const h = size * LINE_HEIGHT + 2 * FREETEXT_PAD.typewriter;
      // The click is where the text starts: the box's left edge, with the
      // line centred on the pointer.
      const r = pdfRect(pn, pt.x, pt.y - (h * s) / 2, pt.x + Math.max(12, measureTyped(text || "M", size, toolPref(t, "font")) + 4) * s, pt.y + (h * s) / 2);
      pushHistory();
      const a = add({ page: pn, type: "typewriter", rect: r, text, fontSize: size, font: toolPref(t, "font") || "sans", color: currentColor(t), width: 0, rotate: R });
      afterCreate(a, { edit: t !== "date" });
      return;
    }
    case "check":
    case "cross": {
      pushHistory();
      const a = add({ page: pn, type: "symbol", symbol: t, rect: centered(14, 14), color: currentColor(t), rotate: R });
      afterCreate(a);
      return;
    }
    case "signature":
    case "initials":
    case "image": {
      let img = pendingImage && pendingImage.role === t ? pendingImage : null;
      if (!img) {
        const picked = await host.pickImageFor(t);
        if (!picked) { setTool(null); return; }
        img = { ...picked, role: t };
      }
      const targetW = t === "initials" ? 60 : t === "signature" ? 160 : Math.min(240, img.w * 0.75);
      const ratio = img.h / img.w || 0.4;
      const w = targetW, h = targetW * ratio;
      pushHistory();
      const a = add({ page: pn, type: "image", role: t, image: { data: img.data, format: img.format }, rect: centered(w, h), rotate: R, opacity: 1 });
      pendingImage = null;
      afterCreate(a);
      return;
    }
    case "stamp":
      await createBox(pn, null, R, s, pt);
      return;
    case "freetext": {
      const size = toolPref("freetext", "fontSize") || 12;
      const h = size * LINE_HEIGHT * 2 + 2 * FREETEXT_PAD.freetext + 2;
      await createBox(pn, pdfRect(pn, pt.x, pt.y, pt.x + 200 * s, pt.y + h * s), R, s);
      return;
    }
    case "square":
    case "circle":
      await createBox(pn, centered(100, t === "circle" ? 100 : 70), R, s);
      return;
    case "whiteout":
      await createBox(pn, centered(120, 24), R, s);
      return;
    case "link":
      await createBox(pn, centered(120, 20), R, s);
      return;
    default:
      return;
  }
}

function measureTyped(text, size, font) {
  const lines = String(text).split("\n");
  const f = `${size}px ${FONT_CSS[font] || FONT_CSS.sans}`;
  return Math.max(...lines.map((l) => textWidth(l, f)));
}

async function createBox(pn, rect, R, s, clickPt = null) {
  const t = tool;
  const common = { page: pn, opacity: toolPref(t, "opacity") ?? 1 };
  switch (t) {
    case "square":
    case "circle": {
      const c = currentColor(t);
      pushHistory();
      afterCreate(add({ ...common, type: t, rect, color: c, width: toolPref(t, "width") || 2, fill: toolPref(t, "fill") ? tint(c) : null }));
      return;
    }
    case "whiteout":
      pushHistory();
      afterCreate(add({ page: pn, type: "whiteout", rect, color: null, width: 0, fill: [1, 1, 1] }));
      return;
    case "freetext": {
      const c = currentColor("freetext");
      pushHistory();
      const a = add({
        ...common, type: "freetext", rect, text: "", fontSize: toolPref("freetext", "fontSize") || 12,
        font: toolPref("freetext", "font") || "sans", color: c, borderColor: c, width: toolPref("freetext", "width") ?? 1,
        fill: toolPref("freetext", "fill") ? [1, 1, 1] : null, rotate: R,
      });
      afterCreate(a, { edit: true });
      return;
    }
    case "stamp": {
      let label = toolPref("stamp", "stamp") || "APPROVED";
      if (label === "__custom") {
        label = await promptDialog({ title: "Custom stamp", message: "The words to stamp on the page.", placeholder: "e.g. EXHIBIT A", confirm: "Stamp", icon: "stamp" });
        if (!label) return;
        label = label.toUpperCase().slice(0, 40);
      }
      if (!rect) {
        const h = 34, w = Math.max(80, textWidth(label, "bold 100px Helvetica, Arial, sans-serif") / 100 * h * 0.56 + h * 0.3 + 12);
        rect = pdfRect(pn, clickPt.x - (w * s) / 2, clickPt.y - (h * s) / 2, clickPt.x + (w * s) / 2, clickPt.y + (h * s) / 2);
      }
      const hex = toolPref("stamp", "color") || STAMP_COLORS[label] || "#b91c1c";
      pushHistory();
      afterCreate(add({ ...common, type: "stamp", label, rect, color: hexToRgb(hex), rotate: R }));
      return;
    }
    case "image": {
      const img = (pendingImage && pendingImage.role === "image" ? pendingImage : null) || await host.pickImageFor("image");
      if (!img) { setTool(null); return; }
      pushHistory();
      afterCreate(add({ ...common, type: "image", role: "image", image: { data: img.data, format: img.format }, rect, rotate: R }));
      pendingImage = null;
      return;
    }
    case "link": {
      const target = await askLinkTarget();
      if (!target) return;
      pushHistory();
      afterCreate(add({ page: pn, type: "link", rect, ...target }));
      return;
    }
    default:
      return;
  }
}

async function askLinkTarget(current = null) {
  const v = await promptDialog({
    title: current ? "Edit link" : "Add link",
    message: "A web address (https://…), or a page number in this document.",
    value: current ? (current.url || (current.destPage ? String(current.destPage) : "")) : "https://",
    confirm: current ? "Save" : "Add link",
    icon: "link",
  });
  if (v == null) return null;
  const s = v.trim();
  if (/^\d+$/.test(s)) {
    const n = Math.max(1, Math.min(host.numPages(), parseInt(s, 10)));
    return { destPage: n, url: "" };
  }
  if (!s || s === "https://") return null;
  const url = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  return { url, destPage: null };
}
async function editLink(a) {
  const t = await askLinkTarget(a);
  if (!t) return;
  pushHistory();
  Object.assign(a, t);
  touch(a);
  changed({ page: a.page });
}
async function editStampLabel(a) {
  const v = await promptDialog({ title: "Stamp text", value: a.label || "", confirm: "Save", icon: "stamp" });
  if (!v) return;
  pushHistory();
  a.label = v.toUpperCase().slice(0, 40);
  touch(a);
  changed({ page: a.page });
}

function afterCreate(a, { edit = false, openNote = false } = {}) {
  const def = TOOLS[tool] || {};
  if (!def.sticky) setTool(null, { keepSelection: true });
  selectedId = a.id;
  changed({ page: a.page });
  if (edit) startEditing(a.id);
  if (openNote) openNotePopup(a.id, { focus: true });
}

// Freehand: strokes of one session on one page are one annotation, the way a
// handwritten word is one mark.
function drawInk(e, pn, layer, start) {
  const s = scaleOf(pn);
  const pts = [start];
  const svg = svgEl("svg");
  svg.setAttribute("overflow", "visible");
  const draft = document.createElement("div");
  draft.className = "annot-draft";
  draft.style.cssText = "left:0;top:0;width:100%;height:100%";
  draft.appendChild(svg);
  layer.appendChild(draft);
  const col = css(currentColor("ink"));
  const width = toolPref("ink", "width") || 2;
  const poly = svgEl("polyline", { fill: "none", stroke: col, "stroke-width": width * s, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: toolPref("ink", "opacity") ?? 1 });
  svg.appendChild(poly);
  const draw = () => poly.setAttribute("points", pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
  draw();
  try { layer.setPointerCapture(e.pointerId); } catch { /* ok */ }
  const onMove = (ev) => {
    const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
    for (const ce of evs) {
      const p = layerPoint(ce, layer);
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1.2) pts.push(p);
    }
    draw();
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    draft.remove();
    const stroke = [];
    for (const p of simplify(pts, 0.6)) { const [x, y] = pdfPt(pn, p.x, p.y); stroke.push(x, y); }
    if (stroke.length < 2) return;
    pushHistory();
    let a = inkSession && inkSession.page === pn ? annots.get(inkSession.id) : null;
    if (a) { a.inkList.push(stroke); touch(a); }
    else {
      a = add({ page: pn, type: "ink", inkList: [stroke], color: currentColor("ink"), width, opacity: toolPref("ink", "opacity") ?? 1 });
      inkSession = { id: a.id, page: pn };
    }
    a.rect = inkRect(a.inkList, a.width);
    changed({ page: pn });
  };
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
}
/** Ramer–Douglas–Peucker, so a slow stroke is not thousands of points. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const d2 = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l = dx * dx + dy * dy;
    let t = l ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
    return x * x + y * y;
  };
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = 0, idx = -1;
    for (let k = i + 1; k < j; k++) { const d = d2(pts[k], pts[i], pts[j]); if (d > max) { max = d; idx = k; } }
    if (max > eps * eps && idx > 0) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ── Edit text: the document's own paragraphs ─────────────────────────────────
//
// In Edit text the page's paragraphs are outlined; a click opens one for
// typing, where it reflows in its box as it would in a word processor. The
// edit is a "textedit" in the set (so undo, moving and resizing work as for
// anything else) and is not an annotation: a save takes the paragraph's old
// glyphs out of the page and writes the new text in (pdf-text-edit.js). The
// lines on screen are laid out by the same function the save uses.

function ensureBlocks(pn) {
  const c = blockCache.get(pn);
  if (c && c.blocks) return Promise.resolve(c.blocks);
  if (c && c.promise) return c.promise;
  const promise = Promise.resolve(host.getTextBlocks ? host.getTextBlocks(pn) : [])
    .catch((e) => { console.warn("[annotations] paragraphs unreadable:", e); return []; })
    .then((blocks) => { blockCache.set(pn, { blocks: blocks || [] }); return blocks || []; });
  blockCache.set(pn, { promise });
  return promise;
}
const overlap = (r, q) => {
  const w = Math.min(r[2], q[2]) - Math.max(r[0], q[0]), h = Math.min(r[3], q[3]) - Math.max(r[1], q[1]);
  return w > 0 && h > 0 ? w * h : 0;
};
const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
function editFor(pn, block) {
  return [...annots.values()].find((a) => a.page === pn && a.type === "textedit" && overlap(a.orig, block.orig) > 0.5 * Math.min(area(a.orig), area(block.orig)));
}
function paintBlocks(pn) {
  const p = pages.get(pn);
  const c = blockCache.get(pn);
  if (!c || !c.blocks) {
    ensureBlocks(pn).then(() => { if (tool === "edittext") paintPage(pn); });
    return;
  }
  for (const b of c.blocks) {
    if (editFor(pn, b)) continue;
    const d = document.createElement("div");
    d.className = "te-block";
    d.__block = b;
    place(d, viewBox(pn, [b.orig[0] - 2, b.orig[1] - 1, b.orig[2] + 2, b.orig[3] + 1]));
    p.layer.appendChild(d);
  }
}
function blockAt(pn, x, y) {
  const c = blockCache.get(pn);
  const list = (c && c.blocks) || [];
  return list.find((b) => x >= b.orig[0] - 2 && x <= b.orig[2] + 2 && y >= b.orig[1] - 1 && y <= b.orig[3] + 1) || null;
}

// Where the baseline sits in a line box of line-height 1, as a share of the
// font size, for a CSS font family — measured once.
const baselineCache = new Map();
function baselineRatio(family) {
  if (baselineCache.has(family)) return baselineCache.get(family);
  const d = document.createElement("div");
  d.style.cssText = `position:absolute;visibility:hidden;left:-9999px;top:0;font-size:100px;line-height:1;white-space:nowrap;font-family:${family}`;
  d.innerHTML = 'Hg<span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
  document.body.appendChild(d);
  const r = d.lastChild.offsetTop / 100 || 0.8;
  d.remove();
  baselineCache.set(family, r);
  return r;
}
function styleSpan(seg, size, s) {
  const sp = document.createElement("span");
  sp.textContent = seg.text;
  if (seg.bold) sp.style.fontWeight = "700";
  if (seg.italic) sp.style.fontStyle = "italic";
  if (seg.sup) {
    sp.style.fontSize = `${size * SUP_SCALE * s}px`;
    sp.style.position = "relative";
    sp.style.top = `${-size * SUP_RISE * s}px`;
  }
  return sp;
}
function paintTextLines(inner, a, s) {
  const L = layoutEdit(a);
  const fam = FONT_CSS[a.font] || FONT_CSS.serif;
  const size = a.fontSize || 12;
  const ratio = baselineRatio(fam);
  inner.style.color = css(a.color || [0, 0, 0]);
  L.lines.forEach((line, i) => {
    const div = document.createElement("div");
    div.className = "te-line";
    const baseY = (a.rect[3] - (L.firstBaseline - i * L.lineHeight)) * s;
    div.style.left = `${line.x * s}px`;
    div.style.top = `${baseY - ratio * size * s}px`;
    div.style.fontFamily = fam;
    div.style.fontSize = `${size * s}px`;
    if (line.wordSpacing) div.style.wordSpacing = `${line.wordSpacing * s}px`;
    for (const seg of line.segs) div.appendChild(styleSpan(seg, size, s));
    inner.appendChild(div);
  });
}
function relayout(a) {
  if (a.type !== "textedit") return;
  a.rect = layoutEdit(a).rect;
}

/** A click in Edit text: into an edit already made, or a new one from the paragraph under it. */
async function editTextAt(e, pn, pt) {
  const [x, y] = pdfPt(pn, pt.x, pt.y);
  const at = { clientX: e.clientX, clientY: e.clientY };
  const here = [...annots.values()].reverse().find((a) => a.page === pn && a.type === "textedit"
    && x >= a.rect[0] && x <= a.rect[2] && y >= a.rect[1] && y <= a.rect[3]);
  if (here) { startEditing(here.id, at); return; }
  if (editingId) finishEditing();
  await ensureBlocks(pn);
  if (tool !== "edittext") return;
  const b = blockAt(pn, x, y);
  if (!b) {
    if (selectedId) select(null);
    const c = blockCache.get(pn);
    if (c && c.blocks && !c.blocks.length && !scanNoticeShown.has(pn)) {
      scanNoticeShown.add(pn);
      host.status("This page has no text of its own to edit — it is a scanned image. Use Whiteout and Add text to change it.");
    }
    return;
  }
  const done = editFor(pn, b);
  if (done) { startEditing(done.id, at); return; }
  const color = host.sampleTextColor ? host.sampleTextColor(pn, b.orig) : null;
  const a = add({
    page: pn, type: "textedit", rect: b.rect.slice(), orig: b.orig.slice(),
    runs: b.runs.map((r) => ({ ...r })), origRuns: JSON.stringify(b.runs),
    font: b.font, fontSize: b.fontSize, lineHeight: b.lineHeight, indent: b.indent, align: b.align,
    color: color || [0, 0, 0], colorAuto: true, fresh: true, origText: b.text,
  });
  relayout(a);
  selectedId = a.id;
  paintPage(pn);
  startEditing(a.id, at);
}

function runsToNodes(runs) {
  const out = [];
  for (const r of runs || []) {
    const parts = String(r.text || "").split("\n");
    parts.forEach((t, i) => {
      if (i) out.push(document.createElement("br"));
      if (!t) return;
      let node = document.createTextNode(t);
      if (r.sup) { const el = document.createElement("sup"); el.appendChild(node); node = el; }
      if (r.italic) { const el = document.createElement("i"); el.appendChild(node); node = el; }
      if (r.bold) { const el = document.createElement("b"); el.appendChild(node); node = el; }
      out.push(node);
    });
  }
  return out;
}
function runsFromEditor(ed) {
  const runs = [];
  let text = "";
  const push = (t, st) => {
    t = t.replace(/ /g, " ").replace(/​/g, "");
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === !!st.bold && !!last.italic === !!st.italic && !!last.sup === !!st.sup) last.text += t;
    else runs.push({ text: t, bold: !!st.bold, italic: !!st.italic, sup: !!st.sup });
    text += t;
  };
  const walk = (node, st) => {
    for (const ch of node.childNodes) {
      if (ch.nodeType === 3) { push(ch.data, st); continue; }
      if (ch.nodeType !== 1) continue;
      const tag = ch.tagName;
      if (tag === "BR") { push("\n", st); continue; }
      const cs = ch.style || {};
      const n = { ...st };
      if (tag === "B" || tag === "STRONG" || cs.fontWeight === "bold" || Number(cs.fontWeight) >= 600) n.bold = true;
      if (cs.fontWeight === "normal" || Number(cs.fontWeight) && Number(cs.fontWeight) < 600) n.bold = false;
      if (tag === "I" || tag === "EM" || cs.fontStyle === "italic") n.italic = true;
      if (cs.fontStyle === "normal") n.italic = false;
      if (tag === "SUP" || cs.verticalAlign === "super") n.sup = true;
      if ((tag === "DIV" || tag === "P") && text && !text.endsWith("\n")) push("\n", st);
      walk(ch, n);
    }
  };
  walk(ed, { bold: false, italic: false, sup: false });
  const last = runs[runs.length - 1];
  if (last && last.text.endsWith("\n")) { last.text = last.text.slice(0, -1); if (!last.text) runs.pop(); }
  return runs;
}
const runsKey = (runs) => JSON.stringify((runs || []).map((r) => [r.text, !!r.bold, !!r.italic, !!r.sup]));

function startTextEditor(a, at) {
  const id = a.id;
  const p = pages.get(a.page);
  if (!p) return;
  if (editingId && editingId !== id) finishEditing();
  if (editingId === id) return;
  selectedId = id;
  paintPage(a.page);
  const el = p.layer.querySelector(`.annot[data-id="${id}"]`);
  const inner = el && el.querySelector(".te-body");
  if (!inner) return;
  editingId = id;
  p.editingEl = el;
  el.classList.add("editing");
  for (const h of el.querySelectorAll(".annot-handle")) h.style.display = "none";
  inner.textContent = "";
  const ed = document.createElement("div");
  ed.className = "te-editor";
  ed.contentEditable = "true";
  ed.spellcheck = true;
  ed.append(...runsToNodes(a.runs));
  inner.appendChild(ed);
  styleTextEditor(a, ed);
  // The caret goes where the click was.
  ed.focus({ preventScroll: true });
  const sel = window.getSelection();
  let range = null;
  if (at && document.caretRangeFromPoint) range = document.caretRangeFromPoint(at.clientX, at.clientY);
  if (!range || !ed.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(ed); range.collapse(false); }
  sel.removeAllRanges();
  sel.addRange(range);
  const before = clone(a);
  let pushed = false;
  const onInput = () => {
    if (!pushed) {
      // Undo takes a new edit away entirely, and an earlier one back to how it was.
      history.push(a.fresh ? snapshot().filter((x) => x.id !== id) : [...snapshot().filter((x) => x.id !== id), before]);
      future.length = 0;
      pushed = true;
    }
    a.runs = runsFromEditor(ed);
    touch(a);
    editSeq++;
  };
  ed.addEventListener("input", onInput);
  ed.__onInput = onInput;
  ed.addEventListener("keydown", (ev) => {
    // Save, print and find are the app's, typing or not.
    if ((ev.ctrlKey || ev.metaKey) && /^[spf]$/i.test(ev.key)) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finishEditing(); return; }
    if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); document.execCommand("insertLineBreak"); }
    else if (ev.key === "Enter") { ev.preventDefault(); finishEditing(); }
    ev.stopPropagation();
  });
  ed.addEventListener("paste", (ev) => {
    ev.preventDefault();
    const t = (ev.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, t.replace(/\r\n?/g, "\n"));
  });
  ed.addEventListener("blur", () => setTimeout(() => {
    const act = document.activeElement;
    if (editingId === id && act !== ed && !(act && act.closest && act.closest("#annot-bar"))) finishEditing();
  }, 0));
  syncBar();
}
/** Size, face and alignment of the editor, with its first baseline on the paragraph's. */
function styleTextEditor(a, ed) {
  const s = scaleOf(a.page);
  const size = a.fontSize || 12;
  Object.assign(ed.style, {
    position: "absolute", left: "0", top: "0",
    width: `${(a.rect[2] - a.rect[0]) * s}px`,
    fontFamily: FONT_CSS[a.font] || FONT_CSS.serif,
    fontSize: `${size * s}px`,
    lineHeight: `${(a.lineHeight || size * 1.2) * s}px`,
    textIndent: `${(a.indent || 0) * s}px`,
    textAlign: a.align === "justify" ? "justify" : a.align || "left",
    color: css(a.color || [0, 0, 0]),
  });
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  ed.insertBefore(probe, ed.firstChild);
  const base = probe.offsetTop;
  probe.remove();
  ed.style.top = `${0.8 * size * s - base}px`;
}
function finishTextEdit(a) {
  const p = pages.get(a.page);
  const ed = p && p.editingEl && p.editingEl.querySelector(".te-editor");
  if (ed) a.runs = runsFromEditor(ed);
  // Opened and left as it was: no edit at all.
  if (a.fresh && runsKey(a.runs) === runsKey(JSON.parse(a.origRuns || "[]")) && !a.restyled) {
    annots.delete(a.id);
    if (selectedId === a.id) selectedId = null;
    changed({ page: a.page });
    return;
  }
  delete a.fresh;
  relayout(a);
  changed({ page: a.page });
}
/** Bold or italic: on the selection while typing, on the whole paragraph otherwise. */
function toggleTextStyle(kind) {
  const a = selected();
  if (!a || a.type !== "textedit") return;
  if (editingId === a.id) {
    const ed = pages.get(a.page)?.editingEl?.querySelector(".te-editor");
    if (!ed) return;
    ed.focus({ preventScroll: true });
    document.execCommand(kind === "bold" ? "bold" : "italic");
    if (ed.__onInput) ed.__onInput();
    syncBar();
    return;
  }
  pushHistory();
  const on = !a.runs.every((r) => !r.text.trim() || r[kind]);
  a.runs = a.runs.map((r) => ({ ...r, [kind]: on }));
  delete a.fresh;
  touch(a);
  relayout(a);
  changed({ page: a.page });
}
function setTextAlign(value) {
  const a = selected();
  if (!a || a.type !== "textedit") return;
  pushHistory();
  a.align = value;
  a.restyled = true;
  touch(a);
  relayout(a);
  if (editingId === a.id) {
    const ed = pages.get(a.page)?.editingEl?.querySelector(".te-editor");
    if (ed) { styleTextEditor(a, ed); ed.focus({ preventScroll: true }); }
    editSeq++;
    syncBar();
  } else changed({ page: a.page });
}

// ── Typing into a text box ───────────────────────────────────────────────────

export function startEditing(id, at = null) {
  const a = annots.get(id);
  if (a && a.type === "textedit") { startTextEditor(a, at); return; }
  if (!a || (a.type !== "freetext" && a.type !== "typewriter")) return;
  const p = pages.get(a.page);
  if (!p) return;
  if (editingId && editingId !== id) finishEditing();
  selectedId = id;
  paintPage(a.page);
  const el = p.layer.querySelector(`.annot[data-id="${id}"]`);
  const body = el && el.querySelector(".ft-body");
  if (!body) return;
  editingId = id;
  p.editingEl = el;
  const before = clone(a);
  let pushed = false;
  body.contentEditable = "true";
  body.spellcheck = true;
  el.classList.add("editing");
  for (const h of el.querySelectorAll(".annot-handle")) h.style.display = "none";
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  if (a.replaced == null) range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  body.addEventListener("input", () => {
    if (!pushed) {
      history.push([...snapshot().filter((x) => x.id !== id), before]);
      future.length = 0;
      pushed = true;
    }
    a.text = body.innerText.replace(/\n$/, "");
    touch(a);
    growToFit(a, body);
    editSeq++;
  });
  body.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && /^[spf]$/i.test(ev.key)) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finishEditing(); }
    else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finishEditing(); }
    ev.stopPropagation();
  });
  body.addEventListener("paste", (ev) => {
    ev.preventDefault();
    const t = (ev.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, t);
  });
  body.addEventListener("blur", () => setTimeout(() => {
    const act = document.activeElement;
    // The properties bar takes the focus while a size or font is picked; the
    // typing is not over.
    if (editingId === id && act !== body && !(act && act.closest && act.closest("#annot-bar"))) finishEditing();
  }, 0));
}

function growToFit(a, body) {
  const pn = a.page;
  const R = rotationOf(pn);
  if (((R - (a.rotate || 0)) % 360 + 360) % 360) return; // turned since: leave the box alone
  const s = scaleOf(pn);
  const box = viewBox(pn, a.rect);
  let w = box.width, h = box.height;
  if (a.type === "typewriter") {
    const need = Math.max(body.scrollWidth, 12) + 3;
    if (Math.abs(need - w) > 0.5) w = need;
  }
  const needH = body.scrollHeight;
  if (needH > h + 0.5 || (a.type === "typewriter" && Math.abs(needH - h) > 0.5)) h = needH;
  if (w === box.width && h === box.height) return;
  a.rect = pdfRect(pn, box.left, box.top, box.left + w, box.top + h);
  const el = body.closest(".annot");
  place(el, { left: box.left, top: box.top, width: w, height: h });
  const inner = body.parentElement;
  inner.style.width = `${w}px`;
  inner.style.height = `${h}px`;
  void s;
}
function fitTextHeight(a, pn) {
  // After a resize the text may need more (or less) room than the box.
  const s = scaleOf(pn);
  const [W] = uprightSize(a.rect, a.rotate || 0);
  const pad = FREETEXT_PAD[a.type] ?? 4;
  const size = a.fontSize || 12;
  const f = `${size}px ${FONT_CSS[a.font] || FONT_CSS.sans}`;
  let lines = 0;
  for (const para of String(a.text || "").split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "", n = 1;
    for (const w of words) {
      if (line && textWidth((line + w).trimEnd(), f) > W - 2 * pad) { n++; line = w.trim(); } else line += w;
    }
    lines += n;
  }
  const need = lines * size * LINE_HEIGHT + 2 * pad + (a.width || 0) * 2;
  const box = viewBox(pn, a.rect);
  if (need * s > box.height && !(((rotationOf(pn) - (a.rotate || 0)) % 360 + 360) % 360)) {
    a.rect = pdfRect(pn, box.left, box.top, box.left + box.width, box.top + need * s);
  }
}

export function finishEditing() {
  if (!editingId) return;
  const id = editingId;
  editingId = null;
  const a = annots.get(id);
  if (!a) return;
  const p = pages.get(a.page);
  if (a.type === "textedit") { finishTextEdit(a); if (p) p.editingEl = null; paintPage(a.page); syncBar(); return; }
  if (p) p.editingEl = null;
  const empty = !String(a.text || "").trim();
  if (empty) {
    annots.delete(id);
    if (selectedId === id) selectedId = null;
  }
  changed({ page: a.page });
}

// ── Sticky-note popups ───────────────────────────────────────────────────────

function openNotePopup(id, { focus = true } = {}) {
  const a = annots.get(id);
  if (!a) return;
  const p = pages.get(a.page);
  if (!p) return;
  for (const old of p.layer.querySelectorAll(".note-popup")) old.remove();
  const box = viewBox(a.page, a.rect);
  const pop = document.createElement("div");
  pop.className = "note-popup";
  pop.dataset.id = id;
  const layerW = p.layer.clientWidth;
  const left = box.left + box.width + 8 + 240 > layerW ? Math.max(4, box.left - 248) : box.left + box.width + 8;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(4, box.top)}px`;
  const when = new Date(a.modified || Date.now()).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  pop.innerHTML = `<div class="np-head"><b></b><span></span><button title="Delete" aria-label="Delete">${icon("trash", { size: 14 })}</button><button title="Close" aria-label="Close">${icon("x", { size: 14 })}</button></div><textarea placeholder="Add a comment…"></textarea>`;
  pop.querySelector("b").textContent = a.author || author || "You";
  pop.querySelector(".np-head span").textContent = when;
  const ta = pop.querySelector("textarea");
  ta.value = a.contents || "";
  const [delBtn, closeBtn] = pop.querySelectorAll("button");
  const before = clone(a);
  let pushed = false;
  ta.addEventListener("input", () => {
    if (!pushed) { history.push([...snapshot().filter((x) => x.id !== id), before]); future.length = 0; pushed = true; }
    a.contents = ta.value;
    touch(a);
    editSeq++;
    for (const fn of listeners) { try { fn({ text: true }); } catch { /* listener */ } }
  });
  ta.addEventListener("keydown", (ev) => { ev.stopPropagation(); if (ev.key === "Escape") close(); });
  pop.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  pop.addEventListener("click", (ev) => ev.stopPropagation());
  closeBtn.addEventListener("click", () => close());
  delBtn.addEventListener("click", () => { pop.remove(); deleteAnnot(id); });
  function close() {
    if (!pop.isConnected) return;
    pop.remove();
    // An empty note is kept: it may have been placed on purpose as a marker,
    // and it is a click to delete.
    changed({ page: a.page });
  }
  pop.__close = close;
  p.layer.appendChild(pop);
  if (focus) requestAnimationFrame(() => ta.focus());
}

// ── Deleting, properties ─────────────────────────────────────────────────────

export function deleteAnnot(id) {
  const a = annots.get(id);
  if (!a) return;
  if (a.type === "textedit") {
    // Deleting an edited paragraph deletes the paragraph: its old words still
    // go from the file, and nothing is written in their place. (Restore
    // original text, on the right-click menu, takes the edit back instead.)
    if (editingId === id) finishEditing();
    const t = annots.get(id);
    if (!t) return;
    pushHistory();
    t.runs = [];
    delete t.fresh;
    touch(t);
    relayout(t);
    changed({ page: t.page });
    return;
  }
  pushHistory();
  annots.delete(id);
  if (selectedId === id) selectedId = null;
  if (editingId === id) editingId = null;
  if (inkSession && inkSession.id === id) inkSession = null;
  changed({ page: a.page });
}
export function deleteSelected() { if (selectedId) deleteAnnot(selectedId); }
/** Take an edited paragraph's edit back: the page shows (and keeps) what it had. */
export function restoreOriginal(id) {
  const a = annots.get(id);
  if (!a || a.type !== "textedit") return;
  if (editingId === id) { editingId = null; const p = pages.get(a.page); if (p) p.editingEl = null; }
  pushHistory();
  annots.delete(id);
  if (selectedId === id) selectedId = null;
  changed({ page: a.page });
}

function applyProp(key, value) {
  const a = selected();
  const t = tool || (a ? toolKeyFor(a) : null);
  if (t) setToolPref(t, key, key === "color" && typeof value !== "string" ? rgbToHex(value) : value);
  if (!a) return;
  const now = Date.now();
  if (lastPropPush.key !== `${a.id}:${key}` || now - lastPropPush.t > 800) pushHistory();
  lastPropPush = { key: `${a.id}:${key}`, t: now };
  switch (key) {
    case "color": {
      const c = hexToRgb(value);
      if (a.type === "freetext" && a.borderColor) a.borderColor = c;
      a.color = c;
      if ((a.type === "square" || a.type === "circle") && a.fill) a.fill = tint(c);
      break;
    }
    case "width":
      a.width = Number(value);
      if (a.type === "freetext" && a.width > 0 && !a.borderColor) a.borderColor = a.color;
      if (a.line) a.rect = lineRect(a.line, a.width, a.type === "arrow");
      if (a.inkList) a.rect = inkRect(a.inkList, a.width);
      break;
    case "opacity": a.opacity = Number(value) / 100; break;
    case "fontSize": {
      const next = Number(value);
      if (a.type === "textedit" && a.fontSize) a.lineHeight = (a.lineHeight || a.fontSize * 1.2) * (next / a.fontSize);
      a.fontSize = next;
      if (a.type === "freetext") fitTextHeight(a, a.page);
      break;
    }
    case "font": a.font = value; break;
    case "fill":
      a.fill = value ? (a.type === "freetext" ? [1, 1, 1] : tint(a.color || [0, 0, 0])) : null;
      break;
    case "stamp":
      if (a.type === "stamp" && value !== "__custom") { a.label = value; if (STAMP_COLORS[value]) a.color = hexToRgb(STAMP_COLORS[value]); }
      break;
  }
  if (a.type === "textedit") {
    if (key === "color") a.colorAuto = false;
    a.restyled = true;
    relayout(a);
    if (editingId === a.id) {
      touch(a);
      editSeq++;
      const ed = pages.get(a.page)?.editingEl?.querySelector(".te-editor");
      if (ed) { styleTextEditor(a, ed); ed.focus({ preventScroll: true }); }
      syncBar();
      return;
    }
  }
  touch(a);
  changed({ page: a.page });
  if (editingId === a.id) restyleEditing(a);
}
/** The text box being typed in is not redrawn, so a property change is applied to it in place. */
function restyleEditing(a) {
  const p = pages.get(a.page);
  const el = p && p.editingEl;
  const body = el && el.querySelector(".ft-body");
  if (!body) return;
  const s = scaleOf(a.page);
  body.style.fontSize = `${(a.fontSize || 12) * s}px`;
  body.style.fontFamily = FONT_CSS[a.font] || FONT_CSS.sans;
  body.style.color = css(a.color || [0, 0, 0]);
  body.style.background = a.fill ? css(a.fill) : "";
  const bw = a.type === "freetext" && a.borderColor && a.width > 0 ? a.width * s : 0;
  body.style.boxShadow = bw ? `inset 0 0 0 ${bw}px ${css(a.borderColor)}` : "";
  growToFit(a, body);
  body.focus();
}
function toolKeyFor(a) {
  if (a.type === "symbol") return a.symbol === "cross" ? "cross" : "check";
  if (a.type === "image") return null;
  if (a.type === "whiteout") return null;
  return a.type;
}

// ── The properties bar ───────────────────────────────────────────────────────

let bar = null;
function barEls() {
  if (bar) return bar;
  const $ = (id) => document.getElementById(id);
  bar = {
    root: $("annot-bar"), label: $("annot-bar-label"), colors: $("annot-colors"),
    width: $("annot-width"), widthWrap: $("annot-width-wrap"),
    opacity: $("annot-opacity"), opacityWrap: $("annot-opacity-wrap"),
    size: $("annot-fontsize"), sizeWrap: $("annot-size-wrap"),
    font: $("annot-font"), fontWrap: $("annot-font-wrap"),
    fill: $("annot-fill"), fillWrap: $("annot-fill-wrap"),
    stamp: $("annot-stamp"), stampWrap: $("annot-stamp-wrap"),
    hint: $("annot-hint"), del: $("annot-delete"), done: $("annot-done"),
    styleWrap: $("annot-style-wrap"), bold: $("annot-bold"), italic: $("annot-italic"), align: $("annot-align"),
  };
  if (!bar.root) return bar;
  for (const hex of PALETTE) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = hex;
    b.dataset.color = hex;
    b.title = hex;
    b.setAttribute("role", "radio");
    b.addEventListener("click", () => { applyProp("color", hex); syncBar(); });
    bar.colors.appendChild(b);
  }
  const custom = document.createElement("label");
  custom.className = "swatch custom";
  custom.title = "Custom color";
  const ci = document.createElement("input");
  ci.type = "color";
  ci.addEventListener("input", () => { applyProp("color", ci.value); });
  ci.addEventListener("change", () => syncBar());
  custom.appendChild(ci);
  bar.colors.appendChild(custom);
  bar.width.addEventListener("input", () => applyProp("width", bar.width.value));
  bar.opacity.addEventListener("input", () => applyProp("opacity", bar.opacity.value));
  bar.size.addEventListener("change", () => applyProp("fontSize", bar.size.value));
  bar.font.addEventListener("change", () => applyProp("font", bar.font.value));
  bar.fill.addEventListener("change", () => applyProp("fill", bar.fill.checked));
  bar.stamp.addEventListener("change", () => {
    applyProp("stamp", bar.stamp.value);
    if (tool === "stamp") setToolPref("stamp", "color", "");
    syncBar();
  });
  bar.del.addEventListener("click", () => deleteSelected());
  if (bar.bold) {
    // These keep the focus (and the selection) in the text being typed.
    for (const [btn, kind] of [[bar.bold, "bold"], [bar.italic, "italic"]]) {
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => toggleTextStyle(kind));
    }
    bar.align.addEventListener("change", () => setTextAlign(bar.align.value));
  }
  bar.done.addEventListener("click", () => { finishEditing(); setTool(null); select(null); });
  bar.root.addEventListener("pointerdown", (e) => e.stopPropagation());
  return bar;
}

function syncBar() {
  const b = barEls();
  if (!b.root) return;
  const a = selected();
  const t = tool;
  if (!t && !a) { b.root.hidden = true; return; }
  b.root.hidden = false;
  // In Edit text, a paragraph being edited shows its own properties.
  const own = a && (!t || (t === "edittext" && a.type === "textedit"));
  const props = own ? (TYPE_PROPS[a.type] || []) : TOOLS[t].props;
  b.label.textContent = own ? TYPE_LABEL[a.type] || "Annotation" : TOOLS[t].label;
  b.hint.textContent = !own ? TOOLS[t].hint
    : a.type === "textedit" ? (editingId === a.id ? "Ctrl+B bold · Ctrl+I italic · Esc when done" : t ? "Click to edit · drag an edge to rewrap" : "Double-click to edit · drag an edge to rewrap")
    : a.type === "freetext" || a.type === "typewriter" ? "Double-click to edit the text" : a.type === "note" ? "Double-click to open" : "";
  b.hint.hidden = !b.hint.textContent;
  const has = (k) => props.includes(k);
  b.colors.hidden = !has("color");
  b.widthWrap.hidden = !has("width");
  b.opacityWrap.hidden = !has("opacity");
  b.sizeWrap.hidden = !has("fontSize");
  b.fontWrap.hidden = !has("font");
  b.fillWrap.hidden = !has("fill");
  b.stampWrap.hidden = !has("stamp");
  if (b.styleWrap) {
    b.styleWrap.hidden = !has("style");
    if (a && a.type === "textedit") {
      let bold = false, italic = false;
      const sel = window.getSelection();
      if (editingId === a.id && sel && sel.rangeCount) {
        bold = document.queryCommandState("bold");
        italic = document.queryCommandState("italic");
      } else {
        const words = (a.runs || []).filter((r) => r.text.trim());
        bold = words.length > 0 && words.every((r) => r.bold);
        italic = words.length > 0 && words.every((r) => r.italic);
      }
      b.bold.setAttribute("aria-pressed", String(bold));
      b.italic.setAttribute("aria-pressed", String(italic));
      b.align.value = a.align || "left";
    }
  }
  b.del.hidden = !a;
  let color, width, opacity, size, font, fill, stamp;
  if (a) {
    color = rgbToHex(a.type === "freetext" && a.borderColor ? a.borderColor : a.color);
    width = a.width ?? 1; opacity = Math.round((a.opacity ?? 1) * 100);
    size = a.fontSize || 12; font = a.font || "sans"; fill = !!a.fill; stamp = a.label;
  } else {
    color = t === "stamp" ? (toolPref("stamp", "color") || STAMP_COLORS[toolPref("stamp", "stamp")] || "#b91c1c") : (toolPref(t, "color") || "#111827");
    width = toolPref(t, "width") ?? 2; opacity = Math.round((toolPref(t, "opacity") ?? 1) * 100);
    size = toolPref(t, "fontSize") || 12; font = toolPref(t, "font") || "sans"; fill = !!toolPref(t, "fill"); stamp = toolPref("stamp", "stamp") || "APPROVED";
  }
  for (const sw of b.colors.querySelectorAll(".swatch[data-color]")) sw.setAttribute("aria-checked", String(sw.dataset.color.toLowerCase() === String(color).toLowerCase()));
  b.width.value = String(width);
  b.opacity.value = String(opacity);
  if (![...b.size.options].some((o) => o.value === String(size))) {
    const o = document.createElement("option"); o.textContent = String(size); b.size.appendChild(o);
  }
  b.size.value = String(size);
  b.font.value = font;
  b.fill.checked = fill;
  if (stamp && [...b.stamp.options].some((o) => o.value === stamp)) b.stamp.value = stamp;
}

// ── Tools on and off ─────────────────────────────────────────────────────────

export async function setTool(name, { keepSelection = false } = {}) {
  if (name === tool) name = null;
  // The document's security may not allow this kind of change.
  if (name && host && host.canUse && !host.canUse(name)) return;
  if (editingId) finishEditing();
  if (tool === "ink" || name !== "ink") inkSession = null;
  const prevTool = tool;
  tool = name && TOOLS[name] ? name : null;
  if (!keepSelection && tool) select(null);
  document.body.classList.toggle("annot-drawing", !!tool && !TOOLS[tool].markup);
  document.body.classList.toggle("annot-markup", !!tool && !!TOOLS[tool].markup);
  document.body.classList.toggle("annot-editing", !!(selectedId || tool));
  if (tool) document.body.dataset.annotTool = tool; else delete document.body.dataset.annotTool;
  if (tool === "edittext" || prevTool === "edittext") paintAll();
  for (const btn of document.querySelectorAll("[data-tool]")) btn.setAttribute("aria-pressed", String(btn.dataset.tool === tool));
  syncBar();
  for (const fn of listeners) { try { fn({ tool: true }); } catch { /* listener */ } }
  // A picture tool asks for its picture first; the click then places it.
  if ((tool === "image" || tool === "signature" || tool === "initials") && !(pendingImage && pendingImage.role === tool)) {
    const want = tool;
    const img = await host.pickImageFor(want);
    if (tool !== want) return; // the reader moved on while the dialog was up
    if (!img) { setTool(null); return; }
    pendingImage = { ...img, role: want };
  }
}
export function currentTool() { return tool; }
/** The markup kind a text selection turns into right now, or null. */
export function markupKind() { return tool && TOOLS[tool].markup ? TOOLS[tool].type : null; }

// ── Text markup from a selection ─────────────────────────────────────────────

/**
 * Make a highlight/underline/strikeout from the client rects of a text
 * selection on page `pn`. Rects on one line are merged into one quad, so a line
 * the text layer split into a dozen spans is still one quad.
 */
export function createMarkup(pn, clientRects, kind = "highlight", quote = "") {
  const p = pages.get(pn);
  if (!p || !vp(pn)) return null;
  const lr = p.layer.getBoundingClientRect();
  const pageH = lr.height;
  const rects = [];
  for (const cr of clientRects) {
    if (cr.width < 0.5 || cr.height < 0.5 || cr.height > pageH * 0.25) continue;
    rects.push({ l: cr.left - lr.left, t: cr.top - lr.top, r: cr.right - lr.left, b: cr.bottom - lr.top });
  }
  if (!rects.length) return null;
  rects.sort((a, b) => (Math.abs(a.t - b.t) > Math.min(a.b - a.t, b.b - b.t) * 0.5 ? a.t - b.t : a.l - b.l));
  const lines = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    const h = r.b - r.t;
    if (last && Math.abs((last.t + last.b) / 2 - (r.t + r.b) / 2) < Math.min(h, last.b - last.t) * 0.5 && r.l - last.r < h * 2.5) {
      last.l = Math.min(last.l, r.l); last.r = Math.max(last.r, r.r);
      last.t = Math.min(last.t, r.t); last.b = Math.max(last.b, r.b);
    } else lines.push({ ...r });
  }
  const R = rotationOf(pn);
  const quads = lines.map((l) => quadForRect(pdfRect(pn, l.l, l.t, l.r, l.b), R));
  const boxes = quads.map(quadBox);
  const rect = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  const t = kind === "underline" ? "underline" : kind === "strikeout" ? "strikeout" : "highlight";
  pushHistory();
  const a = add({
    page: pn, type: t, rect, quads, textRot: R, quote: String(quote || "").replace(/\s+/g, " ").trim().slice(0, 500),
    color: hexToRgb(toolPref(t, "color") || DEFAULTS[t].color), opacity: t === "highlight" ? (toolPref("highlight", "opacity") ?? 1) : 1,
  });
  changed({ page: pn });
  return a;
}

// ── Loading, saving ──────────────────────────────────────────────────────────

/** Replace the set with what was read from a newly opened file. */
export function load(list = []) {
  annots.clear();
  blockCache.clear();
  importedRefs = new Set();
  for (const a of list) {
    const m = { ...a, id: a.id || newId(), dirty: false };
    if (m.origRef) importedRefs.add(m.origRef);
    if (annots.has(m.id)) m.id = newId();
    annots.set(m.id, m);
  }
  selectedId = null;
  editingId = null;
  inkSession = null;
  history.length = 0;
  future.length = 0;
  editSeq = savedSeq = 0;
  paintAll();
  syncBar();
  for (const fn of listeners) { try { fn({ load: true }); } catch { /* listener */ } }
}
export function clear() { load([]); }

/** What a save writes: the whole set, and which of the file's own to take out. */
export function saveData() {
  const keep = new Set();
  for (const a of annots.values()) if (a.origRef && !a.dirty) keep.add(a.origRef);
  const removeRefs = new Set([...importedRefs].filter((r) => !keep.has(r)));
  return { annots: [...annots.values()].map(clone), removeRefs };
}
/** True when there is anything to write: an annotation added, changed or removed. */
export function hasChanges() {
  if ([...annots.values()].some((a) => !a.origRef || a.dirty)) return true;
  return saveData().removeRefs.size > 0;
}
export function hasUnsaved() { return editSeq !== savedSeq && hasChanges(); }
export function markSaved() { savedSeq = editSeq; }
export function all() { return [...annots.values()]; }
export function count() { return [...annots.values()].filter((a) => a.type !== "textedit").length; }
/** The paragraphs edited and not yet saved. */
export function textEditCount() { return [...annots.values()].filter((a) => a.type === "textedit").length; }
export function refsToHide() { return [...importedRefs]; }

export function undo() {
  if (!history.length) return false;
  finishEditing();
  future.push(snapshot());
  restore(history.pop());
  return true;
}
export function redo() {
  if (!future.length) return false;
  finishEditing();
  history.push(snapshot());
  restore(future.pop());
  return true;
}
export function canUndo() { return history.length > 0; }
export function canRedo() { return future.length > 0; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function getAuthor() { return author; }
export function setAuthor(name) {
  author = String(name || "").trim();
  try { localStorage.setItem("pdfViewerAuthor", author); } catch { /* storage blocked */ }
}

// ── Keyboard and the right-click menu ────────────────────────────────────────

function typing(t) {
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}
function onKey(e) {
  if (typing(e.target)) return;
  const a = selected();
  if (e.key === "Escape") {
    if (tool) { e.preventDefault(); e.stopPropagation(); setTool(null); return; }
    if (a) { e.preventDefault(); e.stopPropagation(); select(null); return; }
    return;
  }
  if (!a) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
  if (e.key === "Enter" && (a.type === "freetext" || a.type === "typewriter" || a.type === "textedit")) { e.preventDefault(); startEditing(a.id); return; }
  if (/^Arrow/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey && !a.quads) {
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1;
    const s = scaleOf(a.page);
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    const [x0, y0] = pdfPt(a.page, 0, 0);
    const [x1, y1] = pdfPt(a.page, dx * s, dy * s);
    if (lastPropPush.key !== `${a.id}:nudge` || Date.now() - lastPropPush.t > 800) pushHistory();
    lastPropPush = { key: `${a.id}:nudge`, t: Date.now() };
    translate(a, x1 - x0, y1 - y0);
    touch(a);
    changed({ page: a.page });
  }
}

function onContextMenu(e) {
  const wrapper = e.target.closest && e.target.closest(".page-wrapper");
  if (!wrapper) return;
  const pn = Number(wrapper.dataset.pageNumber);
  let a = null;
  const el = e.target.closest(".annot");
  if (el && !el.classList.contains("markup")) a = annots.get(el.dataset.id);
  if (!a) {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the text menu has this one
    a = annotAtClient(pn, e.clientX, e.clientY);
  }
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  select(a.id);
  const items = [];
  if (a.type === "textedit") {
    items.push({ label: "Edit text", icon: "text-cursor", action: () => startEditing(a.id) });
    items.push({ label: "Restore original text", icon: "undo", action: () => restoreOriginal(a.id) });
    items.push("-");
    items.push({ label: "Delete paragraph", icon: "trash", danger: true, kbd: "Del", action: () => deleteAnnot(a.id) });
    contextMenu(e.clientX, e.clientY, items);
    return;
  }
  if (a.type === "freetext" || a.type === "typewriter") items.push({ label: "Edit text", icon: "type", action: () => startEditing(a.id) });
  if (a.type === "link") items.push({ label: "Edit link…", icon: "link", action: () => editLink(a) });
  if (a.type === "stamp") items.push({ label: "Change stamp text…", icon: "stamp", action: () => editStampLabel(a) });
  items.push({ label: a.contents ? "Edit comment" : "Add comment", icon: "message", action: () => openNotePopup(a.id) });
  if (a.quote) items.push({ label: "Copy text", icon: "copy", action: () => navigator.clipboard?.writeText(a.quote).catch(() => {}) });
  if (a.quads) {
    items.push("-");
    for (const k of ["highlight", "underline", "strikeout"]) {
      if (k !== a.type) items.push({ label: `Change to ${TYPE_LABEL[k].toLowerCase()}`, icon: k === "highlight" ? "highlighter" : k === "underline" ? "underline" : "strikethrough", action: () => { pushHistory(); a.type = k; a.color = hexToRgb(toolPref(k, "color") || DEFAULTS[k].color); touch(a); changed({ page: a.page }); } });
    }
  }
  if (TYPE_PROPS[a.type] && TYPE_PROPS[a.type].includes("color")) {
    items.push("-");
    for (const [name, hex] of [["Yellow", "#ffd400"], ["Green", "#22c55e"], ["Blue", "#2563eb"], ["Red", "#e11d48"], ["Black", "#111827"]]) {
      items.push({ label: name, swatch: hex, action: () => applyProp("color", hex) });
    }
  }
  items.push("-");
  if (!a.quads) items.push({ label: "Duplicate", icon: "copy", action: () => duplicate(a) });
  items.push({ label: "Delete", icon: "trash", danger: true, kbd: "Del", action: () => deleteAnnot(a.id) });
  contextMenu(e.clientX, e.clientY, items);
}

function duplicate(a) {
  pushHistory();
  const c = clone(a);
  c.id = newId();
  delete c.origRef;
  c.dirty = false;
  translate(c, 12, -12);
  add(c);
  selectedId = c.id;
  changed({ page: c.page });
}

// ── Comments panel ───────────────────────────────────────────────────────────

/** Draw the Comments list into `listEl`, filtered by `query`. */
export function renderComments(listEl, query = "") {
  if (!listEl) return;
  const q = query.trim().toLowerCase();
  const items = [...annots.values()]
    .filter((a) => a.type !== "link" && a.type !== "textedit")
    .filter((a) => !q || [a.contents, a.text, a.quote, a.label, a.author, TYPE_LABEL[a.type]].some((v) => v && String(v).toLowerCase().includes(q)))
    .sort((a, b) => a.page - b.page || b.rect[3] - a.rect[3] || a.rect[0] - b.rect[0]);
  listEl.textContent = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "panel-empty";
    empty.innerHTML = `${icon("message", { size: 26 })}<div></div>`;
    empty.querySelector("div").textContent = annots.size && q ? "No comment matches." : "No comments yet. Pick a tool under Comment to highlight, add notes, or draw on the page.";
    listEl.appendChild(empty);
    return;
  }
  let lastPage = 0;
  for (const a of items) {
    if (a.page !== lastPage) {
      const h = document.createElement("div");
      h.className = "comment-page-label";
      h.textContent = `Page ${a.page}`;
      listEl.appendChild(h);
      lastPage = a.page;
    }
    const card = document.createElement("div");
    card.className = "comment-card" + (a.id === selectedId ? " selected" : "");
    card.tabIndex = 0;
    card.dataset.id = a.id;
    const swatch = a.type === "image" || a.type === "whiteout" ? [0.6, 0.6, 0.6] : a.type === "freetext" && a.borderColor ? a.borderColor : a.color || [0.6, 0.6, 0.6];
    const when = a.modified ? new Date(a.modified).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    card.innerHTML = `<span class="cc-swatch"></span><div class="cc-body"><div class="cc-top"><span class="cc-kind"></span><span class="cc-author"></span><span class="cc-date"></span></div><div class="cc-quote"></div><div class="cc-text"></div></div>`;
    card.querySelector(".cc-swatch").style.background = css(swatch);
    card.querySelector(".cc-kind").textContent = a.type === "image" && a.role === "signature" ? "Signature" : a.type === "image" && a.role === "initials" ? "Initials" : TYPE_LABEL[a.type];
    card.querySelector(".cc-author").textContent = a.author ? `· ${a.author}` : "";
    card.querySelector(".cc-date").textContent = when;
    const quote = a.quote ? `“${a.quote}”` : a.type === "stamp" ? a.label : (a.type === "freetext" || a.type === "typewriter") ? a.text : "";
    card.querySelector(".cc-quote").textContent = quote || "";
    if (!quote) card.querySelector(".cc-quote").remove();
    card.querySelector(".cc-text").textContent = a.contents || "";
    if (a.id === selectedId) {
      const ta = document.createElement("textarea");
      ta.placeholder = "Add a comment…";
      ta.value = a.contents || "";
      let pushed = false;
      ta.addEventListener("input", () => {
        if (!pushed) { pushHistory(); pushed = true; }
        a.contents = ta.value;
        touch(a);
        editSeq++;
        const t = card.querySelector(".cc-text");
        if (t) t.textContent = "";
      });
      ta.addEventListener("keydown", (ev) => ev.stopPropagation());
      ta.addEventListener("click", (ev) => ev.stopPropagation());
      ta.addEventListener("blur", () => { if (pushed) changed({ page: a.page }); });
      card.querySelector(".cc-body").appendChild(ta);
      card.querySelector(".cc-text").remove();
    }
    card.addEventListener("click", () => select(a.id, { scroll: true }));
    card.addEventListener("keydown", (ev) => { if (ev.key === "Enter") select(a.id, { scroll: true }); });
    listEl.appendChild(card);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function init(h) {
  host = h;
  barEls();
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("contextmenu", onContextMenu, true);
  // Clicking the page outside any annotation clears the selection; clicking
  // outside a text box being typed in finishes it.
  document.addEventListener("pointerdown", (e) => {
    // A note's popup closes when the reader clicks anywhere else.
    for (const pop of document.querySelectorAll(".note-popup")) {
      if (pop.contains(e.target)) continue;
      if (e.target.closest && e.target.closest(`.annot[data-id="${pop.dataset.id}"]`)) continue;
      if (pop.__close) pop.__close(); else pop.remove();
    }
    if (editingId) {
      const el = e.target.closest && e.target.closest(`.annot[data-id="${editingId}"]`);
      if (!el && !e.target.closest("#annot-bar")) finishEditing();
    }
    if (!selectedId || tool) return;
    if (e.target.closest && e.target.closest(".annot, #annot-bar, .note-popup, .menu, #thumbnail-panel, .modal-backdrop, #hl-ctx-menu")) return;
    if (e.target.closest && e.target.closest(".page-wrapper")) {
      // The page's own click handler decides (a markup under the pointer
      // selects instead); a drag starting here just clears.
      return;
    }
    select(null);
  }, true);
  for (const btn of document.querySelectorAll("[data-tool]")) {
    btn.addEventListener("click", () => {
      if (btn.dataset.tool === "signature" || btn.dataset.tool === "initials") pendingImage = null;
      setTool(btn.dataset.tool);
    });
  }
  hydrateIcons(document.getElementById("annot-bar") || document);
}

export const TOOL_KEYS = Object.keys(TOOLS);
