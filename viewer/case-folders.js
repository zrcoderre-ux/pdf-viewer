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

// A run with nothing written for this long may be a dead one. The ETA marker
// alone is not that sign: PDF-Linker rewrites it only after each PDF, and
// before the first it OCRs the whole folder (`_pre_ocr_folder`), so a large
// folder, or one long scanned filing, leaves it untouched for an hour or more
// while the run narrates every file into pdf_linker.log. So a run is
// "stalled" only where neither the marker nor the log has been written for
// RUN_STALE_MS AND the finish the marker projects is RUN_STALE_MS past
// (runLooksStalled). The reader's run bar asks the same (text-reader.js).
// A PDF-Linker since 2026-11-03 re-stamps the marker's time every two minutes
// while the run lives (its `_eta_heartbeat_on`), whatever it is doing, so a
// live run's marker never reaches this age; the log and the projected finish
// are for an older PDF-Linker, which stamps it only after each PDF.
export const RUN_STALE_MS = 30 * 60000;

/**
 * The finish an ETA marker projects, in ms, or 0 where it names no clock
 * ("(estimating...)"). `label` is runMarker's ("~6:04 PM (6 of 13)"), `at`
 * the marker's time; the clock has no date, so it is the first such clock
 * from the marker on (PDF-Linker drops the seconds, so a minute before it
 * counts as the same).
 */
export function projectedFinish(label, at) {
  const m = /(\d{1,2}):(\d{2}) ?(AM|PM)/i.exec(String(label || ""));
  if (!m || typeof at !== "number") return 0;
  let h = Number(m[1]) % 12;
  if (/pm/i.test(m[3])) h += 12;
  const d = new Date(at);
  d.setHours(h, Number(m[2]), 0, 0);
  if (d.getTime() < at - 60000) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Whether a run whose newest ETA marker is `eta` ({ label, at }) looks dead
 * at `now`: neither the marker nor pdf_linker.log (`logAt`, ms, 0 unknown)
 * written for RUN_STALE_MS, and the finish the marker projects, if any,
 * RUN_STALE_MS past.
 */
export function runLooksStalled(eta, logAt, now) {
  if (!eta) return false;
  if (now - Math.max(eta.at || 0, logAt || 0) <= RUN_STALE_MS) return false;
  const finish = projectedFinish(eta.label, eta.at);
  return !(finish && now <= finish + RUN_STALE_MS);
}

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
 *   "running"  an ETA marker newer than any DONE stamp
 *   "stalled"  the same, but the run looks dead (runLooksStalled): nothing
 *              written for RUN_STALE_MS and past its projected finish
 *   "done"     a DONE stamp newer than any ETA marker
 *   "ran"      no marker, but a key or a log: an earlier run's, its stamp gone
 *   "new"      nothing a run leaves: not run yet
 * `label` is the marker's own words ("~6:04 PM (6 of 13)"), `at` the time of
 * the trace the state was read from (with a run going, `alive` is the newer
 * of the marker and the log). Markers count only when empty, as
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
    const logAt = log && log.at > eta.at ? log.at : 0;
    return {
      ...base, state: runLooksStalled(eta, logAt, now) ? "stalled" : "running",
      label: eta.label, at: eta.at, alive: Math.max(eta.at, logAt),
    };
  }
  if (done) return { ...base, state: "done", label: done.label, at: done.at };
  if (key || log) return { ...base, state: "ran", label: "", at: Math.max((key && key.at) || 0, (log && log.at) || 0) };
  return { ...base, state: "new", label: "", at: 0 };
}

// A run the reader's Re-run PDF-Linker has just started (text-reader.js
// rerunLinker posts "textreader:run" the moment PDF-Linker takes the request).
// The folder's own traces say so only once PDF-Linker writes its ETA marker,
// and until then Home went on showing the last run's finish: the owner, "there
// is a bit of a lag on the home screen between when the case folder closes and
// when it recognizes that a re-run has started". So Home says it has started,
// and gives way to the folder's own status once a marker newer than the start
// is there — an ETA, or a DONE for a run quicker than a look. A start the
// folder never confirms is let go after RUN_START_WAIT_MS.
export const RUN_START_WAIT_MS = 10 * 60000;
// The ETA marker may be written a moment before the reader hears the request
// was taken (it looks every half second), so an ETA this much older counts.
const RUN_START_SLACK_MS = 60000;

/**
 * The status Home shows for a folder whose re-run started at `startedAt`:
 * { status, keep } — `status` folderStatus's own answer once the run's ETA
 * (or a DONE) newer than the start is there, or after RUN_START_WAIT_MS,
 * with `keep` false; until then a "starting" status, `keep` true.
 */
export function withRunStart(st, startedAt, now) {
  if (!startedAt || now - startedAt > RUN_START_WAIT_MS) return { status: st, keep: false };
  // The ETA may be stamped a moment before the start was heard; a DONE never
  // is (the last run's DONE, a minute old, is not this run finishing).
  const since = st && st.state === "done" ? startedAt + 1 : startedAt - RUN_START_SLACK_MS;
  if (st && /^(running|stalled|done)$/.test(st.state) && typeof st.at === "number" && st.at >= since) return { status: st, keep: false };
  const base = st || { leaks: false, held: 0, key: false };
  return { status: { ...base, state: "starting", label: "", at: startedAt }, keep: true };
}

// A case folder whose run has stood finished and clean this long is opened in
// PDF mode (text-reader.js, pdfModeIfSettled): the text has been reviewed, and
// what is left to do is read the PDFs.
export const SETTLED_MS = 60 * 60000;
// …except a run that finished overnight, from 9:00 PM to before 8:00 AM local
// time: nobody has reviewed its text yet, so the folder opens on the text for
// one final review (the owner's decision of Nov 2).
export const OVERNIGHT_FROM = 21;
export const OVERNIGHT_UNTIL = 8;

/** Whether `at` (ms) falls overnight, local time: 9:00 PM to before 8:00 AM. */
export function finishedOvernight(at) {
  const h = new Date(at).getHours();
  return h >= OVERNIGHT_FROM || h < OVERNIGHT_UNTIL;
}

/**
 * Whether a case folder opens in PDF mode rather than the text: its last run
 * finished (a DONE stamp newer than any ETA marker) more than SETTLED_MS ago,
 * in the day (not finishedOvernight), with no LEAKS.xlsx standing and no
 * export held as .LEAK. `st` is folderStatus's answer. A DONE stamp is written
 * again by every run, a --fix-leaks run included, so the hour, and the time of
 * day, are the run's that left the folder clean.
 */
export function opensInPdfMode(st, now) {
  return !!st && st.state === "done" && !st.leaks && !st.held && typeof st.at === "number"
    && now - st.at > SETTLED_MS && !finishedOvernight(st.at);
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
    case "starting":
      return {
        text: "Re-run started — waiting for its ETA",
        title: `Re-run PDF-Linker started the run at ${whenText(st.at, now)}. Its ETA shows here as soon as PDF-Linker writes it.`,
        tone: "run",
      };
    case "running": {
      const logNote = st.alive > st.at ? `, pdf_linker.log ${agoText(now - st.alive)}` : "";
      return {
        text: `Running — ETA ${st.label}`,
        title: `PDF-Linker is running on this folder (its ETA file was updated ${agoText(now - st.at)}${logNote}). Opening it now shows the last run's text, which the run is replacing.`,
        tone: "run",
      };
    }
    case "stalled":
      return {
        text: `Stopped part-way? ETA ${st.label}`,
        title: `Neither the ETA file nor pdf_linker.log has been written for ${agoText(now - (st.alive || st.at)).replace(/ ago$/, "")}${projectedFinish(st.label, st.at) ? ", and the finish it projected has passed" : ""}: a run that stopped part-way leaves its ETA file behind. pdf_linker.log in the folder says how it ended.`,
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
  const rank = (r) => (r.status && /^(running|starting)$/.test(r.status.state) ? 0 : 1);
  const latest = (r) => Math.max(r.opened || 0, (r.status && r.status.at) || 0, r.activity || 0);
  return rows.slice().sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a)
    || String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: "base" }));
}
