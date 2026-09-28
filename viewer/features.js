// features.js
//
// The document-level tools that each open a dialog and produce a new version
// of the file (or a new file): password security, inserting, extracting and
// cropping pages, page numbers, removing hidden information, flattening,
// exporting to Word / text / images, compressing, comparing two versions,
// and document properties — plus presentation mode, read aloud and the
// keyboard shortcut sheet.
//
// viewer.js owns the document; this module reaches it only through the
// context handed to createFeatures(), so what a tool may touch is listed in
// one place:
//
//   getBytes()        the plain (decrypted) bytes the viewer works on
//   getSourceBytes()  the file exactly as it arrived
//   getDoc()          the pdf.js document
//   fileName()        "Name.pdf" to save under
//   writeOut(bytes, name, { inPlace })  save (in place = the document itself)
//   reload(bytes, plan, opts)           show a new version of the document
//   bake()            the bytes with the current annotations written in
//   status(msg)       the toolbar's status line
//   currentPage(), numPages(), scrollToPage(pn), rotations()
//   getInfo(), getSecurity(), setSecurity(s), pickFiles(opts), markSaved()

import * as pdfjsLib from "../pdfjs/build/pdf.mjs";
import { openDialog, confirmDialog, toast, formatBytes, esc } from "./ui.js";
import { icon, hydrateIcons } from "./icons.js";
import { fontDocument, fontCanvas } from "./pdf-fonts.js";
import {
  applyPagePlan, insertBlankPages, cropPages, stampHeaderFooter, setMetadata,
  sanitizePdf, flattenPdf, readAttachment,
} from "./pdf-edit.js";
import { decryptPdf, encryptPdf, detectEncryption, fileKey, describePermissions, permissionBits, PasswordError } from "./pdf-crypt.js";
import { linesFromItems, paragraphsFromLines, plainText, buildDocx, tokenize, compareHunks } from "./textlayout.js";
import { makeZip } from "./zip.js";
import {
  PDFDocument, PDFName, PDFRawStream, PDFNumber, PDFRef, PDFArray, PDFDict, PDFStream, decodePDFRawStream,
} from "./vendor/pdf-lib/pdf-lib.esm.min.js";

const PAGE_SIZES = { letter: [612, 792], legal: [612, 1008], a4: [595.28, 841.89], tabloid: [792, 1224] };

/** "1-3, 5, 8-" → sorted unique page numbers within 1..total (empty → []). */
export function parsePageList(str, total) {
  const out = new Set();
  for (const tok of String(str || "").split(",")) {
    const t = tok.trim();
    if (!t) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(t);
    let a, b;
    if (m) { a = m[1] ? parseInt(m[1], 10) : 1; b = m[2] ? parseInt(m[2], 10) : total; }
    else if (/^\d+$/.test(t)) a = b = parseInt(t, 10);
    else continue;
    if (a > b) [a, b] = [b, a];
    for (let p = Math.max(1, a); p <= Math.min(total, b); p++) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Save a non-PDF file: the save picker where there is one, a download where not. */
async function saveFile(blob, name, types) {
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({ suggestedName: name, types });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return false;
    }
  }
  download(blob, name);
  return true;
}

export function createFeatures(ctx) {
  const base = () => ctx.fileName().replace(/\.pdf$/i, "");

  // ── Running an edit ────────────────────────────────────────────────────────
  // Every tool that changes the document goes through here: the current
  // annotations are written in first (so they ride along with pages), the tool
  // makes the new bytes, the result is saved as the document (a Save As for a
  // web PDF) and shown.
  async function applyEdit(label, make, { plan = null, keepPlace = true, success = "Saved" } = {}) {
    try {
      ctx.status(`${label}…`);
      const baked = await ctx.bake();
      const out = await make(baked);
      if (!out) { ctx.status(""); return false; }
      const ok = await ctx.writeOut(out, ctx.fileName(), { inPlace: true });
      if (ok) {
        await ctx.reload(out, plan, { keepPlace });
        ctx.markSaved();
        toast(success, { kind: "success" });
      }
      ctx.status("");
      return ok;
    } catch (e) {
      console.error(`[pdf-viewer] ${label} failed:`, e);
      ctx.status("");
      toast(`${label} failed: ${e.message || e}`, { kind: "error", timeout: 7000 });
      return false;
    }
  }

  // ── Security ───────────────────────────────────────────────────────────────

  function askPassword({ retry = false, name = "" } = {}) {
    return new Promise((resolve) => {
      let out = null;
      const body = document.createElement("div");
      body.innerHTML = `
        <input type="password" class="pw" placeholder="Password" autocomplete="current-password" style="width:100%">
        <div class="modal-error">${retry ? "That password is not right. Try again." : ""}</div>`;
      openDialog({
        title: "Password required",
        icon: "lock",
        sub: `${name ? `“${name}”` : "This document"} is protected. Enter its password to open it.`,
        body,
        actions: [
          { label: "Cancel" },
          { label: "Open", kind: "primary", onClick: (d) => { out = d.root.querySelector(".pw").value; } },
        ],
        onClose: () => resolve(out),
        initialFocus: ".pw",
      });
    });
  }

  function showLocked() {
    const pages = document.getElementById("pages");
    pages.innerHTML = `<div class="panel-empty" style="margin-top:12vh">${icon("lock", { size: 34 })}<div style="font-size:14px;color:var(--c-text);margin-bottom:6px">This document is password-protected.</div><div>Reopen it and enter its password to read it.</div></div>`;
  }

  /**
   * An encrypted document's plain bytes, from the password pdf.js was opened
   * with (or none: many filings carry only an owner password). Null for a
   * document that is not encrypted.
   */
  async function openEncrypted(bytes, password) {
    const det = detectEncryption(bytes);
    if (!det) return null;
    try {
      const r = await decryptPdf(bytes, password || "");
      if (!r.encrypted) return null;
      return {
        bytes: r.bytes,
        security: {
          needsPassword: r.needsPassword,
          password: r.needsPassword ? (password || "") : "",
          owner: r.owner,
          permissions: r.permissions,
          method: r.method,
          revision: r.revision,
          keep: true,
          det,
        },
      };
    } catch (e) {
      console.warn("[pdf-viewer] could not decrypt for editing:", e);
      toast("This document's security prevents editing here; it can still be read and printed.", { kind: "error", timeout: 7000 });
      return null;
    }
  }

  /** What the document's security lets this reader do (everything, when opened with the owner password). */
  function allowed(kind) {
    const s = ctx.getSecurity();
    if (!s || s.owner) return true;
    const p = describePermissions(s.permissions);
    switch (kind) {
      case "annotate": return p.annotate;
      case "fill": return p.fillForms;
      case "assemble": return p.assemble || p.modify;
      case "modify": return p.modify;
      case "print": return p.print;
      case "copy": return p.copy;
      default: return true;
    }
  }
  const KIND_WORDS = { annotate: "commenting", fill: "filling in forms", assemble: "changing its pages", modify: "changes to it", print: "printing", copy: "copying its content" };
  /** allowed(), and if not, say so — with the way to unlock it. */
  function guard(kind) {
    if (allowed(kind)) return true;
    toast(`This document's security settings don't allow ${KIND_WORDS[kind] || "that"}.`, {
      kind: "error", timeout: 8000,
      action: { label: "Unlock…", run: unlockWithOwnerPassword },
    });
    return false;
  }
  async function unlockWithOwnerPassword() {
    const s = ctx.getSecurity();
    if (!s) return;
    const pw = await new Promise((resolve) => {
      let out = null;
      const body = document.createElement("div");
      body.innerHTML = `<input type="password" class="pw" placeholder="Permissions password" style="width:100%"><div class="modal-error"></div>`;
      openDialog({
        title: "Unlock document", icon: "unlock",
        sub: "Enter the permissions (owner) password to allow every change. The protection stays on the file when you save.",
        body,
        actions: [{ label: "Cancel" }, { label: "Unlock", kind: "primary", onClick: (d) => { out = d.root.querySelector(".pw").value; } }],
        onClose: () => resolve(out),
      });
    });
    if (pw == null) return;
    const k = await fileKey(s.det, pw);
    if (!k || !k.owner) { toast("That is not the permissions password.", { kind: "error" }); return; }
    ctx.setSecurity({ ...s, owner: true, ownerPassword: pw });
    toast("Unlocked: every tool is available.", { kind: "success" });
  }

  /** On the way out: a protected document stays protected. */
  async function protectForSave(bytes) {
    const s = ctx.getSecurity();
    if (!s || s.keep === false) return bytes;
    return encryptPdf(bytes, { userPassword: s.needsPassword ? s.password : "", ownerPassword: s.ownerPassword || "", permissions: s.permissions });
  }

  /** Another PDF to merge in: decrypted first (asking for its password if it has one). */
  async function openableBytes(bytes) {
    const det = detectEncryption(bytes);
    if (!det) return bytes;
    try { return (await decryptPdf(bytes, "")).bytes; } catch (e) {
      if (!(e instanceof PasswordError)) throw e;
    }
    for (let retry = false; ; retry = true) {
      const pw = await askPassword({ retry, name: "the file to insert" });
      if (pw == null) throw new Error("A password-protected file was not opened.");
      try { return (await decryptPdf(bytes, pw)).bytes; } catch (e) { if (!(e instanceof PasswordError)) throw e; }
    }
  }

  function protect() {
    if (!ctx.getBytes()) return;
    if (!guard("modify")) return;
    const s = ctx.getSecurity();
    const perms = s ? describePermissions(s.permissions) : { print: true, copy: true, annotate: true, modify: true };
    const body = document.createElement("div");
    body.innerHTML = `
      <label class="modal-check"><input type="checkbox" class="open-on" ${s && s.needsPassword ? "checked" : "checked"}> Require a password to open the document</label>
      <div class="open-fields">
        <label class="modal-row">Password <input type="password" class="pw1" autocomplete="new-password"></label>
        <label class="modal-row">Confirm <input type="password" class="pw2" autocomplete="new-password"></label>
      </div>
      <label class="modal-check"><input type="checkbox" class="perm-on"> Restrict printing and editing</label>
      <div class="perm-fields" hidden>
        <label class="modal-row">Permissions password <input type="password" class="opw" autocomplete="new-password"></label>
        <label class="modal-check"><input type="checkbox" class="p-print" ${perms.print ? "checked" : ""}> Allow printing</label>
        <label class="modal-check"><input type="checkbox" class="p-copy" ${perms.copy ? "checked" : ""}> Allow copying text and images</label>
        <label class="modal-check"><input type="checkbox" class="p-annot" ${perms.annotate ? "checked" : ""}> Allow comments and form filling</label>
        <label class="modal-check"><input type="checkbox" class="p-modify" ${perms.modify ? "checked" : ""}> Allow changes (editing, organizing pages)</label>
      </div>
      <div class="modal-note">Encrypted with 256-bit AES, which Acrobat, Chrome, Preview and every current PDF reader can open. A forgotten password cannot be recovered.</div>
      <div class="modal-error"></div>`;
    const $ = (sel) => body.querySelector(sel);
    const sync = () => {
      $(".open-fields").hidden = !$(".open-on").checked;
      $(".perm-fields").hidden = !$(".perm-on").checked;
    };
    $(".open-on").addEventListener("change", sync);
    $(".perm-on").addEventListener("change", sync);
    sync();
    openDialog({
      title: "Protect with password", icon: "lock", width: "wide", body,
      actions: [
        { label: "Cancel" },
        {
          label: "Protect & save", kind: "primary",
          onClick: async (d) => {
            const err = $(".modal-error");
            const openOn = $(".open-on").checked, permOn = $(".perm-on").checked;
            const pw1 = $(".pw1").value, pw2 = $(".pw2").value, opw = $(".opw").value;
            if (!openOn && !permOn) { err.textContent = "Choose at least one kind of protection."; return false; }
            if (openOn && !pw1) { err.textContent = "Enter a password to open the document."; return false; }
            if (openOn && pw1 !== pw2) { err.textContent = "The two passwords are not the same."; return false; }
            if (permOn && !opw) { err.textContent = "Enter a permissions password."; return false; }
            if (permOn && openOn && opw === pw1) { err.textContent = "The permissions password must differ from the open password."; return false; }
            const permissions = permOn ? {
              print: $(".p-print").checked, printHigh: $(".p-print").checked, copy: $(".p-copy").checked, accessibility: true,
              annotate: $(".p-annot").checked, fillForms: $(".p-annot").checked, modify: $(".p-modify").checked, assemble: $(".p-modify").checked,
            } : {};
            const prev = ctx.getSecurity();
            ctx.setSecurity({ needsPassword: openOn, password: openOn ? pw1 : "", ownerPassword: permOn ? opw : "", permissions: permissionBits(permissions), owner: true, keep: true, det: prev && prev.det });
            d.busy(true);
            const ok = await applyEdit("Protecting", async (baked) => baked, { success: "Protected and saved" });
            if (!ok) ctx.setSecurity(prev);
            return true;
          },
        },
      ],
    });
  }

  async function unprotect() {
    const s = ctx.getSecurity();
    if (!s) { toast("This document has no password."); return; }
    if (!s.owner && describePermissions(s.permissions).modify === false) {
      await unlockWithOwnerPassword();
      if (!ctx.getSecurity() || !ctx.getSecurity().owner) return;
    }
    const ok = await confirmDialog({ title: "Remove password", message: "Save this document without its password and restrictions? Anyone with the file will be able to open and change it.", confirm: "Remove & save", icon: "unlock" });
    if (!ok) return;
    const prev = ctx.getSecurity();
    ctx.setSecurity(null);
    const saved = await applyEdit("Removing the password", async (baked) => baked, { success: "Password removed" });
    if (!saved) ctx.setSecurity(prev);
  }

  // ── Pages ──────────────────────────────────────────────────────────────────

  function askInsertPosition(title, { withSize = false } = {}) {
    return new Promise((resolve) => {
      const n = ctx.numPages(), cur = ctx.currentPage();
      let out = null;
      const body = document.createElement("div");
      body.innerHTML = `
        <label class="modal-row">Insert
          <select class="where">
            <option value="after">After page ${cur}</option>
            <option value="before">Before page ${cur}</option>
            <option value="end">At the end (after page ${n})</option>
            <option value="start">At the beginning</option>
          </select>
        </label>
        ${withSize ? `
        <label class="modal-row">Pages <input type="number" class="count" value="1" min="1" max="500"></label>
        <label class="modal-row">Size
          <select class="size">
            <option value="same">Same as page ${cur}</option>
            <option value="letter">Letter (8.5 × 11 in)</option>
            <option value="legal">Legal (8.5 × 14 in)</option>
            <option value="a4">A4 (210 × 297 mm)</option>
            <option value="tabloid">Tabloid (11 × 17 in)</option>
          </select>
        </label>
        <label class="modal-row">Orientation
          <select class="orient"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
        </label>` : ""}`;
      openDialog({
        title, icon: withSize ? "file-plus" : "files", body,
        actions: [
          { label: "Cancel" },
          {
            label: "Insert", kind: "primary",
            onClick: (d) => {
              const w = d.root.querySelector(".where").value;
              const at = w === "after" ? cur : w === "before" ? cur - 1 : w === "end" ? n : 0;
              out = { at };
              if (withSize) {
                out.count = Math.max(1, Math.min(500, parseInt(d.root.querySelector(".count").value, 10) || 1));
                const sz = d.root.querySelector(".size").value;
                const land = d.root.querySelector(".orient").value === "landscape";
                if (sz === "same") out.size = null;
                else { const [a, b] = PAGE_SIZES[sz]; out.size = land ? [b, a] : [a, b]; }
                out.landscape = land;
              }
            },
          },
        ],
        onClose: () => resolve(out),
      });
    });
  }

  async function insertBlank() {
    if (!ctx.getBytes() || !guard("assemble")) return;
    const where = await askInsertPosition("Insert blank pages", { withSize: true });
    if (!where) return;
    await applyEdit("Inserting pages", (baked) => insertBlankPages({ srcBytes: baked, at: where.at, count: where.count, size: where.size }), { success: `Inserted ${where.count} page${where.count === 1 ? "" : "s"}` });
    ctx.scrollToPage(where.at + 1, { smooth: false });
  }

  function extractPages() {
    if (!ctx.getBytes() || !guard("copy")) return;
    const n = ctx.numPages();
    const body = document.createElement("div");
    body.innerHTML = `
      <label class="modal-row stack">Pages <input type="text" class="ranges" value="${ctx.currentPage()}" placeholder="e.g. 1-3, 7, 10-"></label>
      <p class="modal-preview">Result: <span class="sum"></span></p>
      <label class="modal-check"><input type="checkbox" class="each"> Save each page as a separate file</label>
      <label class="modal-check"><input type="checkbox" class="del"> Delete these pages from this document afterwards</label>`;
    const sum = body.querySelector(".sum"), ranges = body.querySelector(".ranges");
    const upd = () => { const p = parsePageList(ranges.value, n); sum.textContent = p.length ? `${p.length} page${p.length === 1 ? "" : "s"}` : "—"; };
    ranges.addEventListener("input", upd);
    upd();
    openDialog({
      title: "Extract pages", icon: "file-output", body,
      actions: [
        { label: "Cancel" },
        {
          label: "Extract", kind: "primary",
          onClick: async (d) => {
            const pages = parsePageList(ranges.value, n);
            if (!pages.length) { toast("Enter the pages to extract."); return false; }
            const del = body.querySelector(".del").checked;
            if (del && pages.length >= n) { toast("A document must keep at least one page."); return false; }
            d.busy(true);
            try {
              const baked = await ctx.bake();
              const rot = ctx.rotations();
              const planFor = (list) => list.map((p) => ({ srcIndex: p - 1, rotate: rot.get(p) || 0 }));
              if (body.querySelector(".each").checked) {
                const files = [];
                for (const p of pages) files.push({ name: `${base()} p${p}.pdf`, data: await applyPagePlan({ srcBytes: baked, plan: planFor([p]) }), store: true });
                if (window.showDirectoryPicker) {
                  const dir = await window.showDirectoryPicker({ mode: "readwrite" }).catch(() => null);
                  if (!dir) return false;
                  for (const f of files) {
                    const fh = await dir.getFileHandle(f.name, { create: true });
                    const w = await fh.createWritable();
                    await w.write(new Blob([f.data], { type: "application/pdf" }));
                    await w.close();
                  }
                } else for (const f of files) download(new Blob([f.data], { type: "application/pdf" }), f.name);
                toast(`Extracted ${files.length} file${files.length === 1 ? "" : "s"}`, { kind: "success" });
              } else {
                const out = await applyPagePlan({ srcBytes: baked, plan: planFor(pages) });
                const span = pages.length === 1 ? `p${pages[0]}` : `p${pages[0]}-${pages[pages.length - 1]}`;
                if (!(await ctx.writeOut(out, `${base()} (${span}).pdf`, { inPlace: false }))) return false;
                toast(`Extracted ${pages.length} page${pages.length === 1 ? "" : "s"}`, { kind: "success" });
              }
              if (del) {
                const keep = [];
                for (let p = 1; p <= n; p++) if (!pages.includes(p)) keep.push(p);
                const plan = planFor(keep);
                await applyEdit("Deleting the extracted pages", () => applyPagePlan({ srcBytes: baked, plan }), { plan, success: "Pages removed from this document" });
              }
            } catch (e) {
              console.error(e);
              toast(`Extract failed: ${e.message || e}`, { kind: "error" });
            }
            return true;
          },
        },
      ],
    });
  }

  /** How much white there is around each page's content, in points, displayed orientation. */
  async function detectMargins(pages) {
    const doc = ctx.getDoc();
    const result = { top: Infinity, right: Infinity, bottom: Infinity, left: Infinity };
    for (const pn of pages) {
      const page = await doc.getPage(pn);
      const rotation = (((page.rotate + (ctx.rotations().get(pn) || 0)) % 360) + 360) % 360;
      const vp = page.getViewport({ scale: 0.6, rotation });
      const c = fontCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const g = c.getContext("2d", { willReadFrequently: true });
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const { data, width: W, height: H } = g.getImageData(0, 0, c.width, c.height);
      let x1 = W, y1 = H, x2 = -1, y2 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) {
          if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
        }
      }
      c.width = c.height = 0;
      if (x2 < 0) continue;
      const s = 0.6, pad = 6;
      result.left = Math.min(result.left, Math.max(0, x1 / s - pad));
      result.top = Math.min(result.top, Math.max(0, y1 / s - pad));
      result.right = Math.min(result.right, Math.max(0, (W - 1 - x2) / s - pad));
      result.bottom = Math.min(result.bottom, Math.max(0, (H - 1 - y2) / s - pad));
    }
    for (const k of Object.keys(result)) if (!Number.isFinite(result[k])) result[k] = 0;
    return result;
  }

  function cropDialog() {
    if (!ctx.getBytes() || !guard("modify")) return;
    const n = ctx.numPages(), cur = ctx.currentPage();
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="modal-sub" style="margin-top:0">Trims the page edges. The content outside stays in the file, hidden — to remove content for good, use Redact.</p>
      <div class="hf-grid" style="grid-template-columns:auto 1fr auto 1fr">
        <span class="hf-lbl">Top</span><input type="number" class="m-top" value="0" min="0" step="0.05">
        <span class="hf-lbl">Bottom</span><input type="number" class="m-bottom" value="0" min="0" step="0.05">
        <span class="hf-lbl">Left</span><input type="number" class="m-left" value="0" min="0" step="0.05">
        <span class="hf-lbl">Right</span><input type="number" class="m-right" value="0" min="0" step="0.05">
      </div>
      <p class="modal-preview">Margins in inches.</p>
      <label class="modal-row">Apply to
        <select class="scope"><option value="current">Page ${cur}</option><option value="all">All pages</option><option value="range">Pages…</option></select>
      </label>
      <label class="modal-row range-row" hidden>Pages <input type="text" class="ranges" placeholder="1-3, 5"></label>`;
    const $ = (s) => body.querySelector(s);
    $(".scope").addEventListener("change", () => { $(".range-row").hidden = $(".scope").value !== "range"; });
    const pagesChosen = () => $(".scope").value === "all" ? Array.from({ length: n }, (_, i) => i + 1) : $(".scope").value === "range" ? parsePageList($(".ranges").value, n) : [cur];
    openDialog({
      title: "Crop pages", icon: "crop", body, width: "wide",
      actions: [
        {
          label: "Remove white margins", left: true,
          onClick: async (d) => {
            d.busy(true);
            try {
              const m = await detectMargins(pagesChosen().slice(0, 60));
              for (const k of ["top", "bottom", "left", "right"]) $(`.m-${k}`).value = (m[k] / 72).toFixed(2);
            } finally { d.busy(false); }
            return false;
          },
        },
        { label: "Cancel" },
        {
          label: "Crop & save", kind: "primary",
          onClick: async () => {
            const pages = pagesChosen();
            if (!pages.length) { toast("Choose the pages to crop."); return false; }
            const m = {};
            for (const k of ["top", "bottom", "left", "right"]) m[k] = Math.max(0, parseFloat($(`.m-${k}`).value) || 0) * 72;
            if (!m.top && !m.bottom && !m.left && !m.right) { toast("Enter a margin to trim."); return false; }
            await applyEdit("Cropping", (baked) => cropPages({ srcBytes: baked, margins: m, pages: new Set(pages) }), { success: `Cropped ${pages.length} page${pages.length === 1 ? "" : "s"}` });
            return true;
          },
        },
      ],
    });
  }

  function pageNumbers() {
    if (!ctx.getBytes() || !guard("modify")) return;
    const body = document.createElement("div");
    body.innerHTML = `
      <label class="modal-row">Position
        <select class="pos">
          <option value="fc">Bottom center</option><option value="fr">Bottom right</option><option value="fl">Bottom left</option>
          <option value="hc">Top center</option><option value="hr">Top right</option><option value="hl">Top left</option>
        </select>
      </label>
      <label class="modal-row">Format
        <select class="fmt">
          <option value="{n}">1</option><option value="Page {n}">Page 1</option><option value="Page {n} of {N}">Page 1 of 10</option>
          <option value="{n} of {N}">1 of 10</option><option value="- {n} -">- 1 -</option>
        </select>
      </label>
      <label class="modal-row">First number <input type="number" class="start" value="1" min="0"></label>
      <label class="modal-row">Start on page <input type="number" class="from" value="1" min="1" max="${ctx.numPages()}"></label>
      <label class="modal-row">Size <input type="number" class="size" value="10" min="6" max="36"></label>`;
    const $ = (s) => body.querySelector(s);
    openDialog({
      title: "Page numbers", icon: "list-ordered", body,
      actions: [
        { label: "Cancel" },
        {
          label: "Apply & save", kind: "primary",
          onClick: async () => {
            const slots = { [$(".pos").value]: $(".fmt").value };
            await applyEdit("Numbering pages", (baked) => stampHeaderFooter({
              srcBytes: baked, slots, fontSize: Math.max(6, Math.min(36, parseInt($(".size").value, 10) || 10)),
              startAt: parseInt($(".start").value, 10) || 1, fromPage: Math.max(1, parseInt($(".from").value, 10) || 1),
            }), { success: "Page numbers added" });
            return true;
          },
        },
      ],
    });
  }

  // ── Hidden information, flattening ─────────────────────────────────────────

  function sanitize() {
    if (!ctx.getBytes() || !guard("modify")) return;
    const body = document.createElement("div");
    const opts = [
      ["metadata", "Document properties and metadata (author, software, dates)", true],
      ["attachments", "Attached files", true],
      ["scripts", "JavaScript and actions (open actions, form scripts)", true],
      ["comments", "Comments and markup", false],
      ["forms", "Form fields (their entries become part of the page)", false],
      ["bookmarks", "Bookmarks", false],
      ["links", "Links", false],
    ];
    body.innerHTML = opts.map(([k, label, on]) => `<label class="modal-check"><input type="checkbox" data-k="${k}" ${on ? "checked" : ""}> ${esc(label)}</label>`).join("") +
      `<div class="modal-note">For text that must not be recoverable — names, numbers, privileged passages — use Redact, which removes it from the page itself.</div>`;
    openDialog({
      title: "Remove hidden information", icon: "shield-check", body, width: "wide",
      sub: "Take out what a document carries beyond its pages before you send it.",
      actions: [
        { label: "Cancel" },
        {
          label: "Remove & save", kind: "primary",
          onClick: async () => {
            const options = {};
            for (const c of body.querySelectorAll("[data-k]")) options[c.dataset.k] = c.checked;
            let removed = [];
            await applyEdit("Removing hidden information", async (baked) => {
              const r = await sanitizePdf({ srcBytes: baked, options });
              removed = r.removed;
              return r.bytes;
            }, { success: "Hidden information removed" });
            if (removed.length) toast(`Removed: ${removed.join(", ")}`, { timeout: 6000 });
            return true;
          },
        },
      ],
    });
  }

  function flatten() {
    if (!ctx.getBytes() || !guard("modify")) return;
    const body = document.createElement("div");
    body.innerHTML = `
      <label class="modal-check"><input type="checkbox" class="f-annots" checked> Comments, drawings, stamps and signatures</label>
      <label class="modal-check"><input type="checkbox" class="f-forms" checked> Form fields and their entries</label>
      <div class="modal-note">Flattened items become part of the page: they can no longer be selected, moved or deleted — in this viewer or any other.</div>`;
    openDialog({
      title: "Flatten", icon: "layers", body,
      actions: [
        { label: "Cancel" },
        {
          label: "Flatten & save", kind: "primary",
          onClick: async () => {
            const annotations = body.querySelector(".f-annots").checked, forms = body.querySelector(".f-forms").checked;
            if (!annotations && !forms) return false;
            await applyEdit("Flattening", (baked) => flattenPdf({ srcBytes: baked, annotations, forms }), { success: "Flattened" });
            return true;
          },
        },
      ],
    });
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  async function pagesText(doc, onProgress = () => {}) {
    const out = [];
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const page = await doc.getPage(pn);
      const tc = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      const lines = linesFromItems(tc.items);
      out.push({ lines, paragraphs: paragraphsFromLines(lines), widthPts: vp.width, heightPts: vp.height });
      onProgress(pn, doc.numPages);
    }
    return out;
  }

  async function exportWord() {
    if (!ctx.getDoc() || !guard("copy")) return;
    try {
      const pages = await pagesText(ctx.getDoc(), (i, n) => ctx.status(`Reading text… ${i}/${n}`));
      ctx.status("");
      if (!pages.some((p) => p.lines.length)) { toast("This document has no text to export — run Recognize text (OCR) first.", { kind: "error", timeout: 7000 }); return; }
      const zip = await makeZip(buildDocx(pages, { title: base() }));
      const blob = new Blob([zip], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      if (await saveFile(blob, `${base()}.docx`, [{ description: "Word document", accept: { "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] } }])) {
        toast("Exported to Word", { kind: "success" });
      }
    } catch (e) {
      console.error(e);
      ctx.status("");
      toast(`Export failed: ${e.message || e}`, { kind: "error" });
    }
  }

  async function exportText() {
    if (!ctx.getDoc() || !guard("copy")) return;
    try {
      const pages = await pagesText(ctx.getDoc(), (i, n) => ctx.status(`Reading text… ${i}/${n}`));
      ctx.status("");
      const blob = new Blob([plainText(pages)], { type: "text/plain;charset=utf-8" });
      if (await saveFile(blob, `${base()}.txt`, [{ description: "Text", accept: { "text/plain": [".txt"] } }])) toast("Exported to text", { kind: "success" });
    } catch (e) {
      console.error(e);
      ctx.status("");
      toast(`Export failed: ${e.message || e}`, { kind: "error" });
    }
  }

  function exportImages() {
    if (!ctx.getDoc() || !guard("copy")) return;
    const n = ctx.numPages();
    const body = document.createElement("div");
    body.innerHTML = `
      <label class="modal-row">Format <select class="fmt"><option value="png">PNG</option><option value="jpg">JPEG</option></select></label>
      <label class="modal-row">Resolution <select class="dpi"><option value="72">72 dpi (screen)</option><option value="150" selected>150 dpi</option><option value="300">300 dpi (print)</option></select></label>
      <label class="modal-row">Pages <select class="scope"><option value="all">All ${n} pages</option><option value="current">Page ${ctx.currentPage()}</option><option value="range">Pages…</option></select></label>
      <label class="modal-row range-row" hidden>Range <input type="text" class="ranges" placeholder="1-3, 5"></label>
      <label class="modal-check"><input type="checkbox" class="with-annots" checked> Include comments and markup</label>`;
    const $ = (s) => body.querySelector(s);
    $(".scope").addEventListener("change", () => { $(".range-row").hidden = $(".scope").value !== "range"; });
    openDialog({
      title: "Export as images", icon: "images", body,
      actions: [
        { label: "Cancel" },
        {
          label: "Export", kind: "primary",
          onClick: async (d) => {
            const scope = $(".scope").value;
            const pages = scope === "all" ? Array.from({ length: n }, (_, i) => i + 1) : scope === "current" ? [ctx.currentPage()] : parsePageList($(".ranges").value, n);
            if (!pages.length) { toast("Choose the pages to export."); return false; }
            const fmt = $(".fmt").value, dpi = Number($(".dpi").value);
            d.busy(true);
            let tmp = null;
            try {
              const src = $(".with-annots").checked ? await ctx.bake() : ctx.getBytes().slice(0);
              tmp = await pdfjsLib.getDocument({ data: src, ownerDocument: fontDocument() }).promise;
              const files = [];
              for (const pn of pages) {
                ctx.status(`Rendering page ${pn}…`);
                const page = await tmp.getPage(pn);
                const rotation = (((page.rotate + (ctx.rotations().get(pn) || 0)) % 360) + 360) % 360;
                const vp = page.getViewport({ scale: dpi / 72, rotation });
                const c = fontCanvas(Math.round(vp.width), Math.round(vp.height));
                const g = c.getContext("2d");
                g.fillStyle = "#fff";
                g.fillRect(0, 0, c.width, c.height);
                await page.render({ canvasContext: g, viewport: vp, annotationMode: pdfjsLib.AnnotationMode.ENABLE_FORMS }).promise;
                const blob = await new Promise((res) => c.toBlob(res, fmt === "jpg" ? "image/jpeg" : "image/png", 0.92));
                c.width = c.height = 0;
                page.cleanup();
                files.push({ name: `${base()} p${String(pn).padStart(String(n).length, "0")}.${fmt}`, data: new Uint8Array(await blob.arrayBuffer()), store: true, blob });
              }
              ctx.status("");
              if (files.length === 1) {
                await saveFile(files[0].blob, files[0].name, [{ description: "Image", accept: { [fmt === "jpg" ? "image/jpeg" : "image/png"]: [`.${fmt}`] } }]);
              } else if (window.showDirectoryPicker) {
                const dir = await window.showDirectoryPicker({ mode: "readwrite" }).catch(() => null);
                if (!dir) return false;
                for (const f of files) {
                  const fh = await dir.getFileHandle(f.name, { create: true });
                  const w = await fh.createWritable();
                  await w.write(f.blob);
                  await w.close();
                }
              } else {
                download(await makeZip(files), `${base()} (images).zip`);
              }
              toast(`Exported ${files.length} image${files.length === 1 ? "" : "s"}`, { kind: "success" });
            } catch (e) {
              console.error(e);
              toast(`Export failed: ${e.message || e}`, { kind: "error" });
            } finally {
              ctx.status("");
              if (tmp) tmp.destroy();
            }
            return true;
          },
        },
      ],
    });
  }

  // ── Compress ───────────────────────────────────────────────────────────────

  const QUALITY = {
    high: { maxPx: 2400, q: 0.85, label: "High quality" },
    balanced: { maxPx: 1700, q: 0.72, label: "Balanced" },
    small: { maxPx: 1150, q: 0.55, label: "Smallest file" },
  };

  async function recompressImages(doc, preset, onProgress) {
    const ctxObj = doc.context;
    const images = [];
    for (const [ref, obj] of ctxObj.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const d = obj.dict;
      if (d.get(PDFName.of("Subtype")) !== PDFName.of("Image")) continue;
      images.push([ref, obj]);
    }
    let saved = 0, done = 0;
    for (const [ref, obj] of images) {
      onProgress(++done, images.length);
      const d = obj.dict;
      const w = d.get(PDFName.of("Width")), h = d.get(PDFName.of("Height"));
      const W = w instanceof PDFNumber ? w.asNumber() : 0, H = h instanceof PDFNumber ? h.asNumber() : 0;
      if (!W || !H) continue;
      const filter = d.get(PDFName.of("Filter"));
      const filterName = filter instanceof PDFName ? filter.decodeText() : filter instanceof PDFArray && filter.size() === 1 ? filter.get(0).decodeText?.() : null;
      if (d.get(PDFName.of("ImageMask")) || d.get(PDFName.of("Mask")) instanceof PDFArray) continue;
      if (d.get(PDFName.of("Decode"))) continue;
      const bpc = d.get(PDFName.of("BitsPerComponent"));
      const cs = d.get(PDFName.of("ColorSpace"));
      const csName = cs instanceof PDFName ? cs.decodeText() : null;
      const orig = obj.contents.length;
      if (orig < 40 * 1024) continue; // small images are not where the weight is
      let bitmap = null;
      try {
        if (filterName === "DCTDecode") {
          if (csName === "DeviceCMYK") continue; // canvases do not read CMYK JPEGs faithfully
          bitmap = await createImageBitmap(new Blob([obj.contents], { type: "image/jpeg" }));
        } else if (filterName === "FlateDecode" && !d.get(PDFName.of("DecodeParms")) && bpc instanceof PDFNumber && bpc.asNumber() === 8 && (csName === "DeviceRGB" || csName === "DeviceGray")) {
          const raw = decodePDFRawStream(obj).decode();
          const comps = csName === "DeviceRGB" ? 3 : 1;
          if (raw.length < W * H * comps) continue;
          const img = new ImageData(W, H);
          for (let i = 0, j = 0; i < W * H; i++, j += comps) {
            img.data[i * 4] = raw[j];
            img.data[i * 4 + 1] = comps === 3 ? raw[j + 1] : raw[j];
            img.data[i * 4 + 2] = comps === 3 ? raw[j + 2] : raw[j];
            img.data[i * 4 + 3] = 255;
          }
          bitmap = await createImageBitmap(img);
        } else continue;
      } catch { continue; }
      const s = Math.min(1, preset.maxPx / Math.max(W, H));
      const nw = Math.max(1, Math.round(W * s)), nh = Math.max(1, Math.round(H * s));
      const c = document.createElement("canvas");
      c.width = nw; c.height = nh;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, nw, nh);
      g.drawImage(bitmap, 0, 0, nw, nh);
      bitmap.close && bitmap.close();
      const gray = csName === "DeviceGray";
      let blob = await new Promise((res) => c.toBlob(res, "image/jpeg", preset.q));
      c.width = c.height = 0;
      if (!blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (bytes.length >= orig * 0.9) continue; // not worth the loss
      const nd = d.clone(ctxObj);
      nd.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
      nd.set(PDFName.of("Width"), PDFNumber.of(nw));
      nd.set(PDFName.of("Height"), PDFNumber.of(nh));
      nd.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
      nd.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
      nd.set(PDFName.of("Length"), PDFNumber.of(bytes.length));
      nd.delete(PDFName.of("DecodeParms"));
      void gray;
      ctxObj.assign(ref, PDFRawStream.of(nd, bytes));
      saved += orig - bytes.length;
    }
    return saved;
  }

  /** Drop objects nothing points at any more (old revisions, removed pages' leftovers). */
  function collectGarbage(doc) {
    const c = doc.context;
    const seen = new Set();
    const stack = [];
    const push = (o) => { if (o) stack.push(o); };
    push(c.trailerInfo.Root); push(c.trailerInfo.Info); push(c.trailerInfo.Encrypt);
    while (stack.length) {
      const o = stack.pop();
      if (o instanceof PDFRef) {
        const k = o.tag;
        if (seen.has(k)) continue;
        seen.add(k);
        push(c.lookup(o));
      } else if (o instanceof PDFDict) {
        for (const [, v] of o.entries()) push(v);
      } else if (o instanceof PDFArray) {
        for (let i = 0; i < o.size(); i++) push(o.get(i));
      } else if (o instanceof PDFStream) {
        push(o.dict);
      }
    }
    let removed = 0;
    for (const [ref] of c.enumerateIndirectObjects()) {
      if (!seen.has(ref.tag)) { c.delete(ref); removed++; }
    }
    return removed;
  }

  function compress() {
    if (!ctx.getBytes() || !guard("modify")) return;
    const before = (ctx.getSourceBytes() || ctx.getBytes()).byteLength;
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="modal-sub" style="margin-top:0">Now ${formatBytes(before)}. Pictures and scans are resampled and recompressed; text and drawings are not touched.</p>
      ${Object.entries(QUALITY).map(([k, v], i) => `<label class="modal-check"><input type="radio" name="cq" value="${k}" ${i === 1 ? "checked" : ""}> ${v.label}</label>`).join("")}
      <div class="modal-error"></div>`;
    openDialog({
      title: "Compress PDF", icon: "shrink", body,
      actions: [
        { label: "Cancel" },
        {
          label: "Compress & save", kind: "primary",
          onClick: async (d) => {
            const preset = QUALITY[body.querySelector("input[name=cq]:checked").value];
            d.busy(true);
            let result = null;
            await applyEdit("Compressing", async (baked) => {
              const doc = await PDFDocument.load(baked, { updateMetadata: false });
              await recompressImages(doc, preset, (i, n) => ctx.status(`Compressing images… ${i}/${n}`));
              collectGarbage(doc);
              const out = await doc.save({ useObjectStreams: true });
              result = out;
              if (out.byteLength >= before * 0.98) {
                toast(`This PDF is already about as small as it gets (${formatBytes(out.byteLength)}).`, { timeout: 6000 });
                return null;
              }
              return out;
            }, { success: "Compressed" });
            if (result && result.byteLength < before * 0.98) {
              toast(`${formatBytes(before)} → ${formatBytes(result.byteLength)} (${Math.round((1 - result.byteLength / before) * 100)}% smaller)`, { kind: "success", timeout: 7000 });
            }
            return true;
          },
        },
      ],
    });
  }

  // ── Compare ────────────────────────────────────────────────────────────────

  async function compare() {
    if (!ctx.getDoc()) return;
    const files = await ctx.pickFiles({ accept: { "application/pdf": [".pdf"] }, description: "PDF" });
    if (!files || !files[0]) return;
    let other = null;
    try {
      ctx.status("Reading both versions…");
      const bytes = await openableBytes(new Uint8Array(await files[0].arrayBuffer()));
      other = await pdfjsLib.getDocument({ data: bytes, ownerDocument: fontDocument() }).promise;
      const mine = await pagesText(ctx.getDoc(), (i, n) => ctx.status(`Reading this document… ${i}/${n}`));
      const theirs = await pagesText(other, (i, n) => ctx.status(`Reading ${files[0].name}… ${i}/${n}`));
      ctx.status("Comparing…");
      await new Promise((r) => setTimeout(r, 0));
      const A = tokenize(mine), B = tokenize(theirs);
      const hunks = compareHunks(A, B);
      ctx.status("");
      showCompare(files[0].name, hunks, { pagesA: mine.length, pagesB: theirs.length, wordsA: A.length, wordsB: B.length });
    } catch (e) {
      console.error(e);
      ctx.status("");
      toast(`Compare failed: ${e.message || e}`, { kind: "error" });
    } finally {
      if (other) other.destroy();
    }
  }

  function showCompare(otherName, hunks, stats) {
    const ins = hunks.reduce((n, h) => n + h.words.added, 0);
    const del = hunks.reduce((n, h) => n + h.words.removed, 0);
    const body = document.createElement("div");
    body.innerHTML = `
      <p class="modal-sub" style="margin-top:0">This document (${stats.pagesA} pages) against <b></b> (${stats.pagesB} pages). Struck-through words are only in this document; highlighted words are only in the other.</p>
      <div class="compare-summary">
        <div class="compare-stat"><b>${hunks.length}</b><span>change${hunks.length === 1 ? "" : "s"}</span></div>
        <div class="compare-stat"><b>${ins}</b><span>word${ins === 1 ? "" : "s"} added</span></div>
        <div class="compare-stat"><b>${del}</b><span>word${del === 1 ? "" : "s"} removed</span></div>
      </div>
      <div class="compare-list"></div>`;
    body.querySelector("b").textContent = otherName;
    const list = body.querySelector(".compare-list");
    if (!hunks.length) {
      list.innerHTML = `<div class="panel-empty">${icon("check", { size: 26 })}<div>The text of the two documents is the same.</div></div>`;
    }
    const MAX = 500;
    for (const h of hunks.slice(0, MAX)) {
      const el = document.createElement("div");
      el.className = "compare-page";
      el.innerHTML = `<h4></h4><div class="compare-text"><span class="ctx"></span> <del></del> <ins></ins> <span class="ctx"></span></div>`;
      el.querySelector("h4").textContent = `Page ${h.pageA} · other version page ${h.pageB}`;
      const [c1, c2] = el.querySelectorAll(".ctx");
      c1.textContent = h.before ? `…${h.before}` : "";
      c2.textContent = h.after ? `${h.after}…` : "";
      const delEl = el.querySelector("del"), insEl = el.querySelector("ins");
      delEl.textContent = h.removed; if (!h.removed) delEl.remove();
      insEl.textContent = h.added; if (!h.added) insEl.remove();
      el.style.cursor = "pointer";
      el.title = "Go to this page";
      el.addEventListener("click", () => ctx.scrollToPage(h.pageA, { smooth: false }));
      list.appendChild(el);
    }
    if (hunks.length > MAX) {
      const more = document.createElement("div");
      more.className = "compare-page";
      more.textContent = `…and ${hunks.length - MAX} more changes (the report lists the first ${MAX}).`;
      list.appendChild(more);
    }
    const report = () => {
      const lines = [`Comparison: ${ctx.fileName()} against ${otherName}`, `${hunks.length} changes, ${ins} words added, ${del} words removed`, ""];
      for (const h of hunks) {
        lines.push(`Page ${h.pageA} (other: ${h.pageB})`);
        if (h.removed) lines.push(`  - ${h.removed}`);
        if (h.added) lines.push(`  + ${h.added}`);
        lines.push(`  context: …${h.before} [·] ${h.after}…`, "");
      }
      return lines.join("\n");
    };
    openDialog({
      title: "Compare files", icon: "compare", width: "xwide", body,
      actions: [
        { label: "Save report", left: true, onClick: async () => { await saveFile(new Blob([report()], { type: "text/plain" }), `${base()} comparison.txt`, [{ description: "Text", accept: { "text/plain": [".txt"] } }]); return false; } },
        { label: "Close", kind: "primary" },
      ],
    });
  }

  // ── Properties ─────────────────────────────────────────────────────────────

  async function showProperties() {
    const doc = ctx.getDoc();
    if (!doc) return;
    const info = ctx.getInfo() || {};
    let meta = null;
    try { meta = await doc.getMetadata(); } catch { meta = null; }
    const mi = (meta && meta.info) || {};
    const page = await doc.getPage(ctx.currentPage());
    const vp = page.getViewport({ scale: 1 });
    const inch = (v) => (v / 72).toFixed(2).replace(/\.?0+$/, "");
    const named = Object.entries({ Letter: [612, 792], Legal: [612, 1008], A4: [595, 842], Tabloid: [792, 1224] })
      .find(([, [w, h]]) => (Math.abs(vp.width - w) < 3 && Math.abs(vp.height - h) < 3) || (Math.abs(vp.width - h) < 3 && Math.abs(vp.height - w) < 3));
    const src = ctx.getSourceBytes() || ctx.getBytes();
    const header = src ? String.fromCharCode(...src.subarray(0, 8)) : "";
    const version = (/%PDF-(\d\.\d)/.exec(header) || [])[1] || mi.PDFFormatVersion || "—";
    const sec = ctx.getSecurity();
    const secText = !sec ? "None" : [sec.needsPassword ? "Password to open" : "", describePermissions(sec.permissions).modify ? "" : "Changes restricted", describePermissions(sec.permissions).print ? "" : "Printing restricted", describePermissions(sec.permissions).copy ? "" : "Copying restricted"].filter(Boolean).join(" · ") || "Encrypted";
    const date = (t) => (t ? new Date(t).toLocaleString() : "—");
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="modal-section">Description</div>
      <label class="modal-row">Title <input type="text" class="p-title"></label>
      <label class="modal-row">Author <input type="text" class="p-author"></label>
      <label class="modal-row">Subject <input type="text" class="p-subject"></label>
      <label class="modal-row">Keywords <input type="text" class="p-keywords"></label>
      <div class="modal-section">Document</div>
      <dl class="kv">
        <dt>File</dt><dd class="v-file"></dd>
        <dt>Size</dt><dd>${formatBytes(src ? src.byteLength : NaN)}</dd>
        <dt>Pages</dt><dd>${doc.numPages}</dd>
        <dt>Page size</dt><dd>${inch(vp.width)} × ${inch(vp.height)} in${named ? ` (${named[0]})` : ""}</dd>
        <dt>PDF version</dt><dd>${esc(version)}</dd>
        <dt>Created</dt><dd>${esc(date(info.created))}</dd>
        <dt>Modified</dt><dd>${esc(date(info.modified))}</dd>
        <dt>Application</dt><dd class="v-creator"></dd>
        <dt>PDF producer</dt><dd class="v-producer"></dd>
        <dt>Security</dt><dd>${esc(secText)}</dd>
        <dt>Forms</dt><dd>${mi.IsAcroFormPresent ? "Fillable form" : "None"}</dd>
      </dl>
      <div class="modal-section">You</div>
      <label class="modal-row">Your name on comments <input type="text" class="p-me" placeholder="Shown as the author of your comments"></label>`;
    const $ = (s) => body.querySelector(s);
    $(".p-title").value = info.title || mi.Title || "";
    $(".p-author").value = info.author || mi.Author || "";
    $(".p-subject").value = info.subject || mi.Subject || "";
    $(".p-keywords").value = info.keywords || mi.Keywords || "";
    $(".v-file").textContent = ctx.fileName();
    $(".v-creator").textContent = info.creator || mi.Creator || "—";
    $(".v-producer").textContent = info.producer || mi.Producer || "—";
    $(".p-me").value = ctx.getAuthor();
    openDialog({
      title: "Document properties", icon: "info", width: "wide", body,
      actions: [
        { label: "Cancel" },
        {
          label: "Save", kind: "primary",
          onClick: async () => {
            ctx.setAuthor($(".p-me").value);
            const next = { title: $(".p-title").value, author: $(".p-author").value, subject: $(".p-subject").value, keywords: $(".p-keywords").value };
            const cur = { title: info.title || "", author: info.author || "", subject: info.subject || "", keywords: info.keywords || "" };
            if (JSON.stringify(next) === JSON.stringify(cur)) return true;
            if (!guard("modify")) return false;
            await applyEdit("Saving properties", (baked) => setMetadata({ srcBytes: baked, info: next }), { success: "Properties saved" });
            return true;
          },
        },
      ],
    });
  }

  async function saveAttachment(att) {
    try {
      const r = await readAttachment(ctx.getBytes(), att.id);
      if (!r) { toast("That attachment could not be read.", { kind: "error" }); return; }
      await saveFile(new Blob([r.bytes]), r.name || att.name, undefined);
    } catch (e) {
      toast(`Could not save the attachment: ${e.message || e}`, { kind: "error" });
    }
  }

  // ── Presentation mode ──────────────────────────────────────────────────────

  let presenting = null;
  function onPresentKey(e) {
    if (!presenting) return;
    const next = ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n"];
    const prev = ["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"];
    if (next.includes(e.key)) { e.preventDefault(); e.stopPropagation(); ctx.scrollToPage(Math.min(ctx.numPages(), ctx.currentPage() + 1), { smooth: true }); }
    else if (prev.includes(e.key)) { e.preventDefault(); e.stopPropagation(); ctx.scrollToPage(Math.max(1, ctx.currentPage() - 1), { smooth: true }); }
    else if (e.key === "Home") { e.preventDefault(); ctx.scrollToPage(1, { smooth: false }); }
    else if (e.key === "End") { e.preventDefault(); ctx.scrollToPage(ctx.numPages(), { smooth: false }); }
    else if (e.key === "Escape") { e.preventDefault(); stopPresenting(); }
  }
  function onPresentClick(e) {
    if (!presenting || e.target.closest("a")) return;
    const pn = ctx.currentPage();
    ctx.scrollToPage(e.clientX < window.innerWidth / 3 ? Math.max(1, pn - 1) : Math.min(ctx.numPages(), pn + 1), { smooth: true });
  }
  async function startPresenting() {
    if (presenting || !ctx.getDoc()) return;
    const pn = ctx.currentPage();
    presenting = { zoom: ctx.getZoom(), layout: ctx.getLayout(), pn };
    document.documentElement.classList.add("presenting");
    document.body.classList.add("presenting");
    ctx.setLayout("single");
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* windowed is fine */ }
    await new Promise((r) => setTimeout(r, 250));
    await ctx.presentZoom();
    ctx.scrollToPage(pn, { smooth: false });
    document.addEventListener("keydown", onPresentKey, true);
    document.addEventListener("click", onPresentClick, true);
    toast("Presentation mode · arrows or click to turn pages · Esc to leave", { timeout: 3500 });
  }
  async function stopPresenting() {
    if (!presenting) return;
    const p = presenting;
    presenting = null;
    document.removeEventListener("keydown", onPresentKey, true);
    document.removeEventListener("click", onPresentClick, true);
    document.documentElement.classList.remove("presenting");
    document.body.classList.remove("presenting");
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* ok */ } }
    const pn = ctx.currentPage();
    ctx.setLayout(p.layout);
    await ctx.restoreZoom(p.zoom);
    ctx.scrollToPage(pn, { smooth: false });
  }
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && presenting) stopPresenting(); });

  // ── Read aloud ─────────────────────────────────────────────────────────────

  let reading = null;
  async function toggleReadAloud() {
    const btn = document.getElementById("read-aloud-btn");
    if (reading) { reading.stop = true; speechSynthesis.cancel(); reading = null; btn?.setAttribute("aria-pressed", "false"); return; }
    if (!("speechSynthesis" in window)) { toast("This browser cannot read aloud.", { kind: "error" }); return; }
    if (!guard("copy")) return;
    const doc = ctx.getDoc();
    if (!doc) return;
    reading = { stop: false };
    const me = reading;
    btn?.setAttribute("aria-pressed", "true");
    toast("Reading aloud · click Read aloud again to stop", { timeout: 3000 });
    for (let pn = ctx.currentPage(); pn <= doc.numPages && !me.stop; pn++) {
      const page = await doc.getPage(pn);
      const lines = linesFromItems((await page.getTextContent()).items);
      const text = paragraphsFromLines(lines).map((p) => p.text).join("\n");
      if (!text.trim()) continue;
      ctx.scrollToPage(pn, { smooth: true });
      // Utterances of a few sentences each: a very long one is cut off by
      // some voices.
      const chunks = text.match(/[^.!?\n]+[.!?]*[\s\n]*/g) || [text];
      let buf = "";
      const queue = [];
      for (const c of chunks) { if ((buf + c).length > 220 && buf) { queue.push(buf); buf = ""; } buf += c; }
      if (buf.trim()) queue.push(buf);
      for (const q of queue) {
        if (me.stop) break;
        await new Promise((res) => {
          const u = new SpeechSynthesisUtterance(q);
          u.rate = 1;
          u.onend = u.onerror = () => res();
          speechSynthesis.speak(u);
        });
      }
    }
    if (reading === me) { reading = null; btn?.setAttribute("aria-pressed", "false"); }
  }

  // ── Shortcuts ──────────────────────────────────────────────────────────────

  function showShortcuts() {
    const rows = [
      ["Find", "Ctrl F"], ["Print", "Ctrl P"], ["Save", "Ctrl S"], ["Open a file (web app)", "Ctrl O"], ["Undo / Redo", "Ctrl Z / Ctrl Y"],
      ["Zoom in / out", "Ctrl + / Ctrl −"], ["Fit page / Actual size / Fit width", "Ctrl 0 / 1 / 2"],
      ["Zoom with the wheel", "Ctrl + wheel"], ["Next / previous page", "→ / ←"],
      ["Document properties", "Ctrl D"], ["Presentation mode", "Ctrl L"],
      ["Highlight / Underline / Strikethrough", "H / U / K"], ["Sticky note / Text box / Draw", "N / T / D"], ["Edit text", "E"],
      ["Delete the selected comment", "Delete"], ["Nudge the selected item", "Arrows (Shift: ×10)"],
      ["Leave a tool / deselect", "Esc"], ["Rotate page / back", "R / Shift R"],
      ["Auto-scroll on / off", "A"], ["Pause auto-scroll", "Space"],
      ["Box select", "Alt + drag"], ["Open links in the selection", "Shift Space"],
    ];
    const half = Math.ceil(rows.length / 2);
    const table = (list) => `<table class="shortcut-table">${list.map(([a, k]) => `<tr><td>${esc(a)}</td><td>${k.split(" / ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" / ")}</td></tr>`).join("")}</table>`;
    openDialog({
      title: "Keyboard shortcuts", icon: "keyboard", width: "xwide",
      body: `<div class="shortcut-cols">${table(rows.slice(0, half))}${table(rows.slice(half))}</div><p class="modal-preview" style="margin-top:12px">On a Mac, ⌘ stands in for Ctrl.</p>`,
      actions: [{ label: "Close", kind: "primary" }],
    });
  }

  return {
    askPassword, showLocked, openEncrypted, protectForSave, openableBytes, allowed, guard,
    askInsertPosition, protect, unprotect, insertBlank, extractPages, cropDialog, pageNumbers,
    sanitize, flatten, exportWord, exportText, exportImages, compress, compare,
    showProperties, saveAttachment, showShortcuts, toggleReadAloud,
    togglePresentation: () => (presenting ? stopPresenting() : startPresenting()),
    isPresenting: () => !!presenting,
  };
}
