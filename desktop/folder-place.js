"use strict";

// Where a case folder is on this computer, for Home (main.js,
// "pdfplus:folder-path"): Home's Claude button, and a moved folder's PDF-Linker
// launcher. A page holds a folder by handle and is never told its path; what
// it can say is the folder's name, where it sits under a folder it knows
// (Downloads, a folder on the Folders list: FileSystemDirectoryHandle.resolve),
// the path its PDF-Linker launcher records, and one of its files (name and
// size). This answers with a place only where that file is there at that size.
//
// The owner (2026-11-19): "it didn't work even when I opened the folder ... if
// it already has the ability to open the case folder, doesn't it already have
// the folder location, or at least have the ability to get that information?"
// It had relied on the folders the user had given the app leave to read
// (the session's permission handler), which a folder opened from Downloads
// never passes through. Now, in order:
//
//   1. `hint`: the path the folder's PDF-Linker launcher records, where its
//      last part is the folder's name;
//   2. `root` + `chain`: the chain under each place known by `root`'s name
//      (the folders remembered, and Downloads where `root` is its name);
//   3. the same under every folder named `root` found by `search` (Downloads,
//      Desktop, Documents, OneDrive, home: main.js, findFoldersNamed).
//
// Two different places that both pass are no answer ("ambiguous"): a page is
// never told a path it cannot be sure of. Plain node; test-folder-place.mjs.

const fsp = require("node:fs/promises");
const path = require("node:path");

const isPart = (x) => typeof x === "string" && x !== "" && x !== "." && x !== ".." && !/[\\/\0]/.test(x);
const pathKey = (p, platform = process.platform) => {
  const r = path.resolve(p);
  return platform === "win32" ? r.toLowerCase() : r;
};
const sameName = (a, b, platform = process.platform) => (platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/** The request, checked: { root, chain, probe: { name, size }, hint } or null. */
function checkRequest(req) {
  if (!req || typeof req !== "object") return null;
  const root = req.root, chain = Array.isArray(req.chain) ? req.chain : [];
  const probe = req.launcher && typeof req.launcher === "object" ? req.launcher : null;
  if (!isPart(root) || chain.length > 8 || !chain.every(isPart) || !probe || !isPart(probe.name) || !Number.isFinite(Number(probe.size))) return null;
  const hint = typeof req.hint === "string" && path.isAbsolute(req.hint) ? req.hint : "";
  return { root, chain, probe: { name: probe.name, size: Number(probe.size) }, hint };
}

/** Whether `p` is a folder holding the probe file at its size. */
async function holds(p, probe) {
  try {
    if (!(await fsp.stat(p)).isDirectory()) return false;
    const st = await fsp.stat(path.join(p, probe.name));
    return st.isFile() && st.size === probe.size;
  } catch { return false; }
}

/**
 * Where the folder is: { path, how: "launcher" | "known" | "search" } or
 * { path: "", how: "none" | "ambiguous" | "bad" }.
 *   known(name)  the remembered folders of that name;
 *   downloads    the Downloads folder's path;
 *   search(name) folders of that name found on the computer.
 */
async function placeFolder(req, { known = () => [], downloads = "", search = async () => [], platform = process.platform } = {}) {
  const r = checkRequest(req);
  if (!r) return { path: "", how: "bad" };
  const leaf = r.chain.length ? r.chain[r.chain.length - 1] : r.root;
  if (r.hint && sameName(path.basename(r.hint), leaf, platform) && (await holds(r.hint, r.probe))) return { path: r.hint, how: "launcher" };
  const tryRoots = async (roots) => {
    const hits = [];
    for (const base of roots) {
      const p = path.join(base, ...r.chain);
      if (hits.some((x) => pathKey(x, platform) === pathKey(p, platform))) continue;
      if (await holds(p, r.probe)) hits.push(p);
    }
    return hits;
  };
  const roots = [...known(r.root)];
  if (downloads && sameName(path.basename(downloads), r.root, platform)) roots.push(downloads);
  let hits = await tryRoots(roots);
  if (hits.length === 1) return { path: hits[0], how: "known" };
  if (hits.length > 1) return { path: "", how: "ambiguous" };
  hits = await tryRoots(await search(r.root));
  if (hits.length === 1) return { path: hits[0], how: "search" };
  return { path: "", how: hits.length > 1 ? "ambiguous" : "none" };
}

module.exports = { placeFolder, checkRequest, holds, isPart };
