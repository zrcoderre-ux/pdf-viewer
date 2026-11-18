// Moving a case folder from Home into another folder (pwa/app-web.js, "Home:
// folders"): the owner (2026-11-18), "I want to add the ability to drag and
// drop them into another folder straight from the hearings menu".
//
// A page cannot move a folder. Chrome's FileSystemHandle.move() moves FILES on
// the computer's disk (Chrome 111 on), but not folders: directory moves were
// left out of that launch, and MDN's data marks Chrome's move() partial for
// that reason. So a folder is moved the way File Explorer moves one across
// drives: a folder of the same name is made at the target (or the one a move
// stopped part-way left there is used again), each file is moved into it
// (on one drive, a rename), each subfolder the same way, and the emptied
// folder is removed. Nothing is copied and then deleted: a file is in one
// place or the other at every moment.
//
// PDF-Linker's launcher records the folder's place (textdoc.js, "THE RE-RUN
// BUTTON"), which the reader's Re-run and Home's Take over send to PDF-Linker,
// so a moved folder's launcher is rewritten to name its new place where PDF+
// can learn it (retargetLauncher).

import * as TD from "./textdoc.js";
import { folderPathOfToken } from "./run-request.js";

/** A folder path as a launcher's token (PDF-Linker's `_launcher_folder_token`: unpadded base64url of its UTF-8). */
export function tokenOfPath(p) {
  const bytes = new TextEncoder().encode(String(p || ""));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A launcher's text with the folder's old place (`oldPath`) changed to
 * `newPath`: the token line (LAUNCHER_FOLDER_TAG) and every other mention of
 * the old path, as the batch file writes it (backslashes, or forward ones, in
 * any case on Windows), where it is the whole path and not the start of a
 * longer one ("…\\Case A" is not "…\\Case A2"). The rest is left as it was.
 */
export function retargetLauncher(text, oldPath, newPath) {
  let out = String(text == null ? "" : text);
  const oldToken = TD.launcherFolderToken(out);
  if (oldToken) out = out.split(oldToken).join(tokenOfPath(newPath));
  if (oldPath) {
    const win = /^[A-Za-z]:[\\/]|^\\\\/.test(oldPath);
    for (const [from, to] of [[oldPath, newPath], [oldPath.replace(/\\/g, "/"), newPath.replace(/\\/g, "/")]]) {
      const re = new RegExp(escapeRe(from) + "(?=[\\\\/\"'\\s]|$)", win ? "gim" : "gm");
      out = out.replace(re, () => to);
    }
  }
  return out;
}

/** The folder path a launcher's text records, or "" (an older PDF-Linker's records none). */
export function launcherPath(text) {
  return folderPathOfToken(TD.launcherFolderToken(text));
}

/**
 * Why a case folder may not be moved now, or "": a run going in it
 * (folderStatus's state), or a reader tab holding it.
 */
export function moveBlocker({ state = "", inReader = false } = {}) {
  if (/^(running|starting)$/.test(state)) return "PDF-Linker is running on it: wait for the run to finish.";
  if (state === "stalled") return "a PDF-Linker run looks stopped part-way in it: Take over or end the run first.";
  if (inReader) return "it is open in a reader tab: close that tab first.";
  return "";
}

/** Every file under `dir`, as [{ path: ["sub", "name.pdf"], handle }]; each subfolder as { path, dir: true } before its files. */
export async function walk(dir, at = []) {
  const out = [];
  const subs = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind === "file") out.push({ path: [...at, name], handle: h });
    else subs.push([name, h]);
  }
  for (const [name, h] of subs) {
    out.push({ path: [...at, name], dir: true, handle: h });
    out.push(...(await walk(h, [...at, name])));
  }
  return out;
}

async function has(dir, path, kind) {
  let d = dir;
  for (let i = 0; i < path.length - 1; i++) {
    try { d = await d.getDirectoryHandle(path[i]); } catch { return false; }
  }
  const last = path[path.length - 1];
  try { if (kind === "file") await d.getFileHandle(last); else await d.getDirectoryHandle(last); return true; }
  catch { return false; }
}

/**
 * The names a move of `src` into `target` would land on that `target` already
 * has a FILE at ("Text Files/Decl.txt"): a move refuses to start where there
 * is any. A same-named folder already there (one a move stopped part-way
 * left, say) is not one: the files go into it.
 */
export async function collisions(src, target) {
  let there;
  try { there = await target.getDirectoryHandle(src.name); } catch { return []; }
  const out = [];
  for (const f of await walk(src)) if (!f.dir && (await has(there, f.path, "file"))) out.push(f.path.join("/"));
  return out;
}

/**
 * Move folder `src` into folder `target`, file by file (see the top), then
 * take the emptied `src` away: through `parent` (the folder holding it) where
 * that is known, else its own remove() where the browser has one. Returns
 * { dir: the folder at its new place, moved: files, left: whether the empty
 * folder stayed behind }. `onFile(i, n)` is told as each file goes. Throws
 * before moving anything where a file would land on another, or where the
 * target is the folder itself or inside it.
 */
export async function moveFolder(src, target, { parent = null, onFile = () => {} } = {}) {
  if (await src.isSameEntry(target)) throw new Error("a folder cannot be moved into itself");
  if (typeof target.resolve === "function") {
    let inside = null;
    try { inside = await src.resolve(target); } catch { inside = null; }
    if (inside) throw new Error("a folder cannot be moved into a folder inside it");
  }
  if (parent && (await parent.isSameEntry(target))) throw new Error(`it is already in ${target.name}`);
  const clash = await collisions(src, target);
  if (clash.length) throw new Error(`${target.name} already has ${src.name}/${clash[0]}${clash.length > 1 ? ` and ${clash.length - 1} more` : ""}`);
  const all = await walk(src);
  const files = all.filter((f) => !f.dir);
  if (files.some((f) => typeof f.handle.move !== "function")) throw new Error("this browser cannot move files");
  const dest = await target.getDirectoryHandle(src.name, { create: true });
  const dirs = new Map([["", dest]]);
  const dirAt = async (path) => {
    const key = path.join("/");
    if (dirs.has(key)) return dirs.get(key);
    const up = await dirAt(path.slice(0, -1));
    const d = await up.getDirectoryHandle(path[path.length - 1], { create: true });
    dirs.set(key, d);
    return d;
  };
  let i = 0;
  for (const f of files) {
    const into = await dirAt(f.path.slice(0, -1));
    await f.handle.move(into);
    onFile(++i, files.length);
  }
  // The emptied subfolders, deepest first, then the folder itself.
  const subs = all.filter((f) => f.dir).sort((a, b) => b.path.length - a.path.length);
  for (const d of subs) {
    let holder = src;
    for (const p of d.path.slice(0, -1)) holder = await holder.getDirectoryHandle(p);
    try { await holder.removeEntry(d.path[d.path.length - 1]); } catch { /* not empty: left */ }
  }
  let left = false;
  try {
    if (parent) await parent.removeEntry(src.name);
    else if (typeof src.remove === "function") await src.remove();
    else left = true;
  } catch { left = true; }
  return { dir: dest, moved: files.length, left };
}
