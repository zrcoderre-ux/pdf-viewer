// Tests for where a case folder is on the computer (desktop/folder-place.js),
// the answer behind Home's Claude button: the path the folder's PDF-Linker
// launcher records, a folder under Downloads or another known folder, and a
// search by name, each believed only where a file of the folder is there at its
// size, and never where two places would both do.
//
// Run: node test-folder-place.mjs   (from the repo root). Node only; it builds
// folders in a temporary directory. Every name is invented.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { placeFolder, checkRequest } = require("./desktop/folder-place.js");

let fails = 0, passes = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log(`        got : ${JSON.stringify(got)}`); console.log(`        want: ${JSON.stringify(want)}`); }
}

const top = fs.mkdtempSync(path.join(os.tmpdir(), "folder-place-"));
const mk = (...parts) => { const p = path.join(top, ...parts); fs.mkdirSync(p, { recursive: true }); return p; };
const put = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);
const downloads = mk("Downloads");
const acme = mk("Downloads", "25STCV12345 ACME");
put(acme, "Demurrer.pdf", "%PDF demurrer 123");
const filed = mk("OneDrive", "Cases", "November");
const doe = mk("OneDrive", "Cases", "November", "24STCV00777 Doe");
put(doe, "MSJ.pdf", "%PDF msj");
const copy = mk("Desktop", "25STCV12345 ACME");
put(copy, "Demurrer.pdf", "%PDF demurrer 123");
const probe = (name, text) => ({ name, size: Buffer.byteLength(text) });

try {
  console.log("1. the request");
  check("a folder name, a chain, a file", !!checkRequest({ root: "Downloads", chain: ["25STCV12345 ACME"], launcher: probe("Demurrer.pdf", "x") }), true);
  check("no climbing out", checkRequest({ root: "Downloads", chain: [".."], launcher: probe("a", "x") }), null);
  check("no separators", checkRequest({ root: "Down/loads", chain: [], launcher: probe("a", "x") }), null);

  console.log("2. under Downloads (the folder Home is linked to)");
  let got = await placeFolder({ root: "Downloads", chain: ["25STCV12345 ACME"], launcher: probe("Demurrer.pdf", "%PDF demurrer 123") }, { downloads });
  check("found, with no folder remembered", got, { path: acme, how: "known" });
  got = await placeFolder({ root: "Downloads", chain: ["25STCV12345 ACME"], launcher: probe("Demurrer.pdf", "something else") }, { downloads });
  check("a file of another size there: no answer", got, { path: "", how: "none" });

  console.log("3. the launcher's own record");
  got = await placeFolder({ root: "24STCV00777 Doe", chain: [], launcher: probe("MSJ.pdf", "%PDF msj"), hint: doe });
  check("believed where the folder's file is there", got, { path: doe, how: "launcher" });
  got = await placeFolder({ root: "24STCV00777 Doe", chain: [], launcher: probe("MSJ.pdf", "%PDF msj"), hint: path.join(top, "Gone", "24STCV00777 Doe") });
  check("a place it names that is gone: not believed", got.path, "");
  got = await placeFolder({ root: "24STCV00777 Doe", chain: [], launcher: probe("MSJ.pdf", "%PDF msj"), hint: filed });
  check("a place of another name: not believed", got.path, "");

  console.log("4. under a folder of the Folders list, and found by name");
  const known = (name) => (name === "November" ? [filed] : []);
  got = await placeFolder({ root: "November", chain: ["24STCV00777 Doe"], launcher: probe("MSJ.pdf", "%PDF msj") }, { known });
  check("under a remembered folder", got, { path: doe, how: "known" });
  const search = async (name) => [mk("OneDrive", "Cases", "November")].filter((p) => path.basename(p) === name);
  got = await placeFolder({ root: "November", chain: ["24STCV00777 Doe"], launcher: probe("MSJ.pdf", "%PDF msj") }, { search });
  check("…or under one found by its name", got, { path: doe, how: "search" });
  got = await placeFolder({ root: "24STCV00777 Doe", chain: [], launcher: probe("MSJ.pdf", "%PDF msj") }, { search: async () => [doe] });
  check("the case folder itself found by its name", got, { path: doe, how: "search" });

  console.log("5. never where two places would both do");
  got = await placeFolder({ root: "25STCV12345 ACME", chain: [], launcher: probe("Demurrer.pdf", "%PDF demurrer 123") }, { search: async () => [acme, copy] });
  check("two copies of the folder: no answer", got, { path: "", how: "ambiguous" });
} finally {
  fs.rmSync(top, { recursive: true, force: true });
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
