// Home's Case folders list (pwa/app-web.js, "Home: case folders"): which
// folders to show, and what PDF-Linker is doing in each. Pure: the shell reads
// each folder into a listing and hands it here, so the rules are tested in
// node (test-case-folders.mjs) without a file system.
//
// A LISTING is what one look at a folder found:
//   { files: [{ name, size, at }], dirs: [name], held }
// `files` are the folder's own files (`at` its lastModified, ms), `dirs` its
// subfolders' names, `held` how many exports in its Text Files folder are
// quarantined (`*.txt.LEAK`). The shell gets `size` and `at` only for the
// files that say something (signalFile), since every getFile is a trip to
// the disk; the others carry only their name.

import { runMarker, isKeyName, isExportName, TEXT_SUBFOLDER } from "./textdoc.js";

// An ETA marker PDF-Linker has not rewritten for this long may be a dead run's
// (it is rewritten after every PDF). The reader's run bar says so at the same
// age (text-reader.js, RUN_STALE_MS).
export const RUN_STALE_MS = 30 * 60000;

const LOG_FILE = "pdf_linker.log";
const LEAKS_FILE = "leaks.xlsx";
const RUN_RECORD_FILE = "pdf-linker run record.json";
const isDocName = (n) => /\.(pdf|docx?)$/i.test(n);

/**
 * Whether a file's size and time are worth reading: the run's markers, its
 * log, run record, key and worksheet, and the documents themselves (a folder
 * downloaded today and not run yet says so only by them).
 */
export function signalFile(name) {
  const low = String(name || "").toLowerCase();
  return !!runMarker(name) || low === LOG_FILE || low === LEAKS_FILE || low === RUN_RECORD_FILE
    || isKeyName(name) || isDocName(name);
}

/** Whether a listing is a case folder: documents to run, or a run's traces. */
export function isCaseListing(listing) {
  if (!listing) return false;
  const files = listing.files || [];
  if (files.some((f) => isDocName(f.name) || isKeyName(f.name) || runMarker(f.name)
    || f.name.toLowerCase() === LOG_FILE)) return true;
  if (files.some((f) => isExportName(f.name))) return true;
  return (listing.dirs || []).some((d) => d.toLowerCase() === TEXT_SUBFOLDER.toLowerCase());
}

/** Midnight that began the local day `now` falls in. */
export function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The newest time any signal file in the listing was written, or 0. */
export function lastActivity(listing) {
  let at = 0;
  for (const f of (listing && listing.files) || []) if (typeof f.at === "number" && f.at > at) at = f.at;
  return at;
}

/**
 * Whether a folder in Downloads belongs to today: a file in it written today,
 * or a .zip of the folder's name that came down today (Windows' Extract All
 * keeps the times the files had in the zip, so a case extracted this morning
 * can carry last week's dates). `zipsToday` is the lower-cased stems of the
 * zips in Downloads written today.
 */
export function isToday(name, listing, now, zipsToday = new Set()) {
  if (lastActivity(listing) >= startOfDay(now)) return true;
  return zipsToday.has(String(name || "").toLowerCase());
}

/**
 * What PDF-Linker is doing in the folder, read off its traces:
 *   { state, label, at, leaks, held, key }
 * state is
 *   "running"  an ETA marker newer than any DONE stamp, rewritten lately
 *   "stalled"  the same, but untouched for RUN_STALE_MS: a run that stopped part-way
 *   "done"     a DONE stamp newer than any ETA marker
 *   "ran"      no marker, but a key or a log: an earlier run's, its stamp gone
 *   "new"      nothing a run leaves: not run yet
 * `label` is the marker's own words ("~6:04 PM (6 of 13)"), `at` the time of
 * the trace the state was read from. Markers count only when empty, as
 * PDF-Linker scopes its own (`_marker_mtime`) and the reader does
 * (runMarkersIn): a file the operator named "ETA notes.txt" is not one.
 */
export function folderStatus(listing, now) {
  let eta = null, done = null, key = null, log = null, leaks = false;
  for (const f of (listing && listing.files) || []) {
    const m = runMarker(f.name);
    if (m) {
      if (f.size !== 0 || typeof f.at !== "number") continue;
      const hit = { label: m.label, at: f.at };
      if (m.kind === "ETA") { if (!eta || hit.at > eta.at) eta = hit; }
      else if (!done || hit.at > done.at) done = hit;
      continue;
    }
    const low = f.name.toLowerCase();
    if (low === LEAKS_FILE) leaks = true;
    else if (low === LOG_FILE) log = f;
    else if (isKeyName(f.name) && (!key || (f.at || 0) > (key.at || 0))) key = f;
  }
  const held = (listing && listing.held) || 0;
  const base = { leaks, held, key: !!key };
  if (eta && (!done || eta.at > done.at)) {
    return { ...base, state: now - eta.at > RUN_STALE_MS ? "stalled" : "running", label: eta.label, at: eta.at };
  }
  if (done) return { ...base, state: "done", label: done.label, at: done.at };
  if (key || log) return { ...base, state: "ran", label: "", at: Math.max((key && key.at) || 0, (log && log.at) || 0) };
  return { ...base, state: "new", label: "", at: 0 };
}

/** "3:04 PM" today, "Oct 28, 3:04 PM" another day. */
export function whenText(at, now) {
  if (!at) return "";
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at >= startOfDay(now)) return time;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + time;
}

function agoText(ms) {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 1) return "less than a minute ago";
  if (min < 90) return `${min} minute${min === 1 ? "" : "s"} ago`;
  return `${Math.round(min / 60)} hours ago`;
}

/**
 * The status as Home says it: { text, title, tone } — `tone` the pill's
 * colour ("run", "warn", "ok", "idle"), `title` the longer word on hover.
 */
export function statusText(st, now) {
  const extras = [];
  if (st.held) extras.push(`${st.held} held as .LEAK`);
  if (st.leaks) extras.push("LEAKS.xlsx to answer");
  const tail = extras.length ? " · " + extras.join(" · ") : "";
  switch (st.state) {
    case "running":
      return {
        text: `Running — ETA ${st.label}`,
        title: `PDF-Linker is running on this folder (its ETA file was updated ${agoText(now - st.at)}). Opening it now shows the last run's text, which the run is replacing.`,
        tone: "run",
      };
    case "stalled":
      return {
        text: `Stopped part-way? ETA ${st.label}`,
        title: `The ETA file was last updated ${agoText(now - st.at)}: a run that stopped part-way leaves it behind. pdf_linker.log in the folder says whether one is still going.`,
        tone: "warn",
      };
    case "done":
      return {
        text: `Finished ${whenText(st.at, now)}${tail}`,
        title: `PDF-Linker's last run finished at ${whenText(st.at, now)} (its DONE stamp reads ${st.label}).${extras.length ? " " + extras.join("; ") + "." : ""}`,
        tone: extras.length ? "warn" : "ok",
      };
    case "ran":
      return {
        text: `Run ${whenText(st.at, now)}${tail}`,
        title: "PDF-Linker has run on this folder; no DONE stamp is standing, so pdf_linker.log says how its last run ended.",
        tone: extras.length ? "warn" : "idle",
      };
    default:
      return { text: "Not run yet", title: "No key, log or run marker: PDF-Linker has not run on this folder.", tone: "idle" };
  }
}

/**
 * The rows in the order Home lists them: runs going first, then by the
 * latest thing that happened to each (opened here, a run's trace, a file
 * downloaded), newest first. A row is { name, opened, today, status, activity }.
 */
export function sortRows(rows) {
  const rank = (r) => (r.status && (r.status.state === "running") ? 0 : 1);
  const latest = (r) => Math.max(r.opened || 0, (r.status && r.status.at) || 0, r.activity || 0);
  return rows.slice().sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a)
    || String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }));
}
