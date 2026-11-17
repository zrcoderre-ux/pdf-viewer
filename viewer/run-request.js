// Asking PDF-Linker to run on a case folder from a page: the text reader's
// "Re-run PDF-Linker" (text-reader.js, rerunLinker) and Home's "Take over" on
// a run that stopped part-way (pwa/app-web.js, takeOverRun) — and, through
// the same link, for a page diagnosis that starts no run (diagnosePage;
// textdoc.js, "PAGE DIAGNOSTICS"). The link and the
// request file's format are textdoc.js's (rerunUrl, runRequestText, "THE
// RE-RUN BUTTON"); this is the part that touches the folder.

import * as TD from "./textdoc.js";

/** The folder's launcher and the folder token it records: { name, token }, or null where it has none. */
export async function folderLauncher(dir) {
  for (const stem of TD.LAUNCHER_STEMS) {
    for (const ext of [".bat", ".command"]) {
      let fh;
      try { fh = await dir.getFileHandle(stem + ext); } catch { continue; }
      try { return { name: stem + ext, token: TD.launcherFolderToken(await (await fh.getFile()).text()) }; }
      catch { return { name: stem + ext, token: "" }; }
    }
  }
  return null;
}

/** The folder path a launcher's token records (PDF-Linker's `_launcher_folder_token`: unpadded base64url of its UTF-8), or "". */
export function folderPathOfToken(token) {
  try {
    const b = String(token || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b + "=".repeat((4 - (b.length % 4)) % 4));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch { return ""; }
}

/** Write the request file: `state` is "go", "cancel" or "takeover" (TD.runRequestText). */
export async function writeRunRequest(dir, nonce, state) {
  const fh = await dir.getFileHandle(TD.RUN_REQUEST_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(TD.runRequestText(nonce, state));
  await w.close();
}

/** Whether the request file is gone: PDF-Linker took it. */
export async function runRequestTaken(dir) {
  try { await dir.getFileHandle(TD.RUN_REQUEST_FILE); return false; }
  catch (e) { return !!(e && e.name === "NotFoundError"); }
}

/**
 * Wait up to `ms` for PDF-Linker to take the request file. True where it
 * did; false where it never came, the file then taken back so a PDF-Linker
 * started later does not act on a request nobody is waiting for.
 */
export async function awaitPickup(dir, ms, poll = 500) {
  const until = Date.now() + ms;
  let taken = false;
  while (!(taken = await runRequestTaken(dir)) && Date.now() < until) await new Promise((r) => setTimeout(r, poll));
  if (taken) return true;
  try { await dir.removeEntry(TD.RUN_REQUEST_FILE); return false; }
  catch (e) { return !!(e && e.name === "NotFoundError"); } // taken at the last moment
}

/** Write the request file for a page diagnosis (TD.diagnosisRequestText). */
export async function writeDiagnosisRequest(dir, nonce, state, fields) {
  const fh = await dir.getFileHandle(TD.RUN_REQUEST_FILE, { create: true });
  const w = await fh.createWritable();
  await w.write(TD.diagnosisRequestText(nonce, state, fields));
  await w.close();
}

/** PDF-Linker's answer to `nonce` in the folder, taken away once read; null where none is there yet. */
export async function takeDiagnosis(dir, nonce) {
  let text;
  try { text = await (await (await dir.getFileHandle(TD.DIAGNOSIS_RESULT_FILE)).getFile()).text(); }
  catch { return null; }
  const res = TD.parseDiagnosisResult(text, nonce);
  if (res) { try { await dir.removeEntry(TD.DIAGNOSIS_RESULT_FILE); } catch { /* gone already */ } }
  return res;
}

/**
 * Wait for PDF-Linker's answer to a page diagnosis: up to `pickupMs` for it
 * to take the request file, then up to `workMs` more for the answer. Returns
 * { taken, result }: taken false where PDF-Linker never came (the request
 * file is then taken back), result null where it took the request and wrote
 * no answer in time (a PDF-Linker from before reads the state as "cancel").
 */
export async function awaitDiagnosis(dir, nonce, pickupMs, workMs, poll = 500) {
  const pause = () => new Promise((r) => setTimeout(r, poll));
  let until = Date.now() + pickupMs;
  let taken = false;
  for (;;) {
    const res = await takeDiagnosis(dir, nonce);
    if (res) return { taken: true, result: res };
    if (!taken && (await runRequestTaken(dir))) { taken = true; until = Date.now() + workMs; }
    if (Date.now() >= until) break;
    await pause();
  }
  if (!taken) {
    try { await dir.removeEntry(TD.RUN_REQUEST_FILE); }
    catch (e) { if (e && e.name === "NotFoundError") return { taken: true, result: await takeDiagnosis(dir, nonce) }; }
    return { taken: false, result: null };
  }
  return { taken: true, result: null };
}
