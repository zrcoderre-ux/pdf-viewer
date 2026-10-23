// Chromium for the browser tests: each context a fresh profile ON DISK.
//
// Playwright's browser.newContext() makes an off-the-record profile, and in
// one the Chromium these tests run on (Chrome for Testing 153, Linux) stops
// its browser process on a CHECK (SIGTRAP) reading a folder handle back out
// of IndexedDB. The reader keeps every folder it is shown there
// (viewer/text-reader.js, readDirRecords), so every test that showed it an
// OPFS case folder twice, or asked which folder it had met, died with "Target
// page, context or browser has been closed": test-folder-save, test-raw-edit,
// test-stale-writes and test-typed-cites every run, others now and then. An
// on-disk profile reads the same handle back whole (eight lines of page script
// put and got one: off the record it crashed every time, on disk never).
//
// So `newContext` launches a persistent context on a new temporary profile:
// its own storage and OPFS, as a new context's always were, and the blank page
// it opens with left alone (a test opens its own). `close` closes every one
// and removes the profiles, as process exit does for a test that never gets
// there. A test takes it in place of chromium.launch:
//
//   import { launchBrowser } from "./browser-for-tests.mjs";
//   browser = await launchBrowser(chromium, CHROME);
//   const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function launchBrowser(chromium, executablePath) {
  const open = [], profiles = [];
  const removeProfiles = () => {
    for (const dir of profiles.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left for the OS */ }
    }
  };
  process.once("exit", removeProfiles);
  return {
    async newContext(options = {}) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfplus-test-profile-"));
      profiles.push(dir);
      const context = await chromium.launchPersistentContext(dir, { executablePath, ...options });
      open.push(context);
      return context;
    },
    async close() {
      for (const context of open.splice(0)) await context.close().catch(() => {});
      removeProfiles();
    },
  };
}
