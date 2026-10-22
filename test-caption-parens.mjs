// Browser test for a caption boxed with `)`s (textdoc.captionParens,
// rules.js dressLines/markParen): the column of `)`s down a pleading's caption
// is drawn as the box's side, straight down every row whatever the party
// names' widths, the underscore line under the parties as the box's foot, and
// the file's text — every `)` and underscore — unchanged underneath.
//
// Run: node test-caption-parens.mjs   (from the repo root)
//
// Needs Playwright (/opt/node-tools), Chromium (/opt/pw-browsers/chromium)
// and a free port in 8130-8199 for python3's http.server; exits 0 with SKIP
// where any is missing. Every name in it is invented.

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";

function skip(why) { console.log(`SKIP: ${why}`); process.exit(0); }
if (!fs.existsSync(PW)) skip("Playwright is not installed at " + PW);
if (!fs.existsSync(CHROME)) skip("Chromium is not installed at " + CHROME);
const { chromium } = await import(PW);

let fails = 0, passes = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got : ${JSON.stringify(got)}`);
    console.log(`        want: ${JSON.stringify(want)}`);
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
async function startServer() {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) skip("no free port in 8130-8199");
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: REPO, stdio: "ignore" });
  for (let t = 0; t < 80; t++) {
    const up = await new Promise((resolve) => { const c = net.connect(port, "127.0.0.1", () => { c.end(); resolve(true); }); c.on("error", () => resolve(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

// Pleading paper, and the same caption off it; the `)` on line 14 slipped a
// character, as a run's text sometimes pushes it.
const NUMBERED = [
  "====== Page 1 ======",
  " 1  DANA WHITAKER (SBN 123456)",
  " 2  Attorneys for Plaintiff",
  " 3                SUPERIOR COURT OF THE STATE OF CALIFORNIA",
  " 4  TOBIAS WRENFIELD, an individual,       )  Case No. 23STCV01234",
  " 5                                         )",
  " 6                Plaintiff,               )  PLAINTIFF'S NOTICE OF MOTION",
  " 7        vs.                               )  (Hon. Dana Whitaker)",
  " 8  QUARROW MOTORS, INC., a California     )  Date:  January 5, 2027",
  " 9                Defendants.              )  Dept.: 15",
  "10  _______________________________________)",
  "11",
  "12  TO ALL PARTIES AND THEIR ATTORNEYS OF RECORD:",
].join("\n") + "\n";
const PLAIN = NUMBERED.replace(/^[ \d]{2}(?=  |$)/gm, (m, i) => (i ? "" : m)).replace(/^  /gm, "");

async function load(page, text) {
  await page.evaluate((t) => window.__textReaderLoadLocal(new File([t], "Motion.txt", { type: "text/plain" }), null), text);
  await page.waitForFunction(() => document.querySelectorAll("#pages .tpage .page-body .line").length > 3);
  await page.waitForTimeout(1200);
}
async function read(page) {
  return page.evaluate(async () => {
    const TD = await import("/viewer/textdoc.js");
    const lines = [...document.querySelectorAll("#pages .tpage .page-body > .line")];
    return {
      rows: lines.map((l) => l.classList.contains("rl")),
      bars: lines.filter((l) => l.querySelector(".rb.paren")).map((l) => Math.round(l.querySelector(".rb.paren").getBoundingClientRect().left)),
      foot: lines.filter((l) => l.querySelector(".rc.hf > .rh")).map((l) => l.querySelector(".rb.paren").dataset.v),
      text: lines.map((l) => TD.serializeNodes(l)),
    };
  });
}

const srv = await startServer();
const browser = await chromium.launch({ executablePath: CHROME });
try {
  for (const [title, text] of [["pleading paper", NUMBERED], ["no line numbers", PLAIN]]) {
    console.log(`a caption boxed with ) — ${title}`);
    const page = await (await browser.newContext({ viewport: { width: 1300, height: 1000 } })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(srv.base + "/viewer/text-reader.html");
    await page.waitForFunction(() => !!window.__textReaderLoadLocal);
    await load(page, text);
    const got = await read(page);
    check("the caption's seven rows are a box, nothing else is", got.rows, [false, false, false, true, true, true, true, true, true, true, false, false]);
    check("its side stands in one column down every row", new Set(got.bars).size, 1);
    check("…the underscore line is its foot, the side stopping there", got.foot, ["up"]);
    check("the file reads back unchanged", got.text.join("\n"), text.trimEnd().split("\n").slice(1).join("\n"));
    check("no page errors", errors, []);
    await page.context().close();
  }
} finally {
  await browser.close();
  srv.stop();
}
console.log(fails ? `\n${fails} FAILED, ${passes} passed` : `\nall ${passes} passed`);
process.exit(fails ? 1 : 0);
