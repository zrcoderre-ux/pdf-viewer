// The never-fake list (viewer/never-fake-words.js): the module is the committed
// "Never Fake Words.txt", and that is PDF-Linker's list where its checkout
// stands beside this one.
// Run: node test-never-fake-words.mjs

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { moduleFor } from "./build-never-fake-words.mjs";
import { isNeverFakeWord, NEVER_FAKE_COUNT } from "./viewer/never-fake-words.js";

let fails = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
    fails++;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(here, "Never Fake Words.txt"), "utf8");
check("the module is built from the committed list",
  readFileSync(join(here, "viewer", "never-fake-words.js"), "utf8") === moduleFor(text), true);
const words = text.split("\n").filter((l) => l && !l.startsWith("#"));
check("its count", NEVER_FAKE_COUNT, words.length);
check("one lower-case word a line, sorted, once each",
  words.every((w, i) => w === w.toLowerCase() && !/\s/.test(w) && (i === 0 || words[i - 1] < w)), true);
check("ordinary English is on it", ["provision", "Provision", "PROVISION", "contractors"].map(isNeverFakeWord), [true, true, true, true]);
check("a surname is not", isNeverFakeWord("smith"), false);

const linker = join(here, "..", "PDF-Linker", "Word Lists", "Never Fake Words.txt");
if (existsSync(linker)) {
  check("the copy is PDF-Linker's list (run node build-never-fake-words.mjs)",
    readFileSync(linker, "utf8") === text, true);
} else console.log("  SKIP  no PDF-Linker checkout beside this one");

if (fails) { console.log(`\n${fails} failing`); process.exit(1); }
console.log("\nall passed");
