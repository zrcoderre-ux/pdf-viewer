// Asking PDF-Linker to run on a case folder from a page: the text reader's
// "Re-run PDF-Linker" (text-reader.js, rerunLinker) and Home's "Take over" on
// a run that stopped part-way (pwa/app-web.js, takeOverRun). The link and the
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
