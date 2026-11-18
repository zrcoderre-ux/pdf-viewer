// Tests for Home's Hearings list (viewer/hearing-sheet.js): the owner's
// hearings workbook read for its Date, Motion Type, Case Name and Date
// Submitted columns, the green (done) and red (off calendar) marks off each
// row's fill, the eCourt link off the case name's hyperlink, and each hearing
// matched to its case folder by case number (or, without one, by name).
//
// Run: node test-hearing-sheet.mjs   (from the repo root)
//
// The browser part (Home's list in the site pwa/build-site.sh assembles, over
// an OPFS stand-in for Downloads) needs Playwright (/opt/node-tools), Chromium
// (/opt/pw-browsers/chromium) and a free port in 8130-8199, and is skipped
// where any is missing. Every name and number in it is invented.

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeZip } from "./viewer/zip.js";
import {
  readHearings, caseNumbersIn, caseNumberOfUrl, markOfColor, serialToDate, textToDate, headerColumns,
  hyperlinkOfFormula, dateNote, namesMatch, markHearing, looseFileCounts, placeMatches, findPlace, placeText, upcoming, dayText, shortDate, hearingForPlace, nameWords,
} from "./viewer/hearing-sheet.js";

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
const day = (y, m, d) => new Date(y, m - 1, d).getTime();
const NOW = new Date(2026, 10, 18, 10, 0).getTime();

console.log("1. case numbers");
check("year-first and legacy", caseNumbersIn("25STCV12345 ACME v. Roe; BC654321"), ["25STCV12345", "BC654321"]);
check("spaced and dashed, lower case", caseNumbersIn("Doe 25 stcv 12345 / 24-STLC-01234"), ["25STCV12345", "24STLC01234"]);
check("not inside a longer word", caseNumbersIn("X25STCV12345Y"), []);
check("off an eCourt link", caseNumberOfUrl("https://civil.lacourt.org/ecourt/ecms/case?id=99&caseNumber=25STCV12345"), "25STCV12345");
check("a link with no number", caseNumberOfUrl("https://civil.lacourt.org/ecourt/ecms/case?id=99"), "");

console.log("2. the marks");
check("Excel's Good fill is done", markOfColor("FFC6EFCE"), "done");
check("standard green is done", markOfColor("FF00B050"), "done");
check("light green is done", markOfColor("FF92D050"), "done");
check("red is off", markOfColor("FFFF0000"), "off");
check("Excel's Bad fill is off", markOfColor("FFFFC7CE"), "off");
check("yellow is neither", markOfColor("FFFFFF00"), "");
check("orange is neither", markOfColor("FFFFC000"), "");
check("grey is neither", markOfColor("FFD9D9D9"), "");
check("white is neither", markOfColor("FFFFFFFF"), "");
check("theme green lightened 60% is still done", markOfColor("70AD47", 0.5999938962981048), "done");

console.log("3. dates and headers");
check("serial 46346 is Nov 20, 2026", serialToDate(46346), day(2026, 11, 20));
check("the 1904 system", serialToDate(44884, true), day(2026, 11, 20));
check("11/20/2026", textToDate("11/20/2026", NOW), day(2026, 11, 20));
check("11/20/26", textToDate("11/20/26", NOW), day(2026, 11, 20));
check("1/8 with no year, in November, is next January", textToDate("1/8", NOW), day(2027, 1, 8));
check("Friday, November 20, 2026", textToDate("Friday, November 20, 2026", NOW), day(2026, 11, 20));
check("not a date", textToDate("TBD", NOW), 0);
check("the four columns", headerColumns(["Date", "Motion Type", "Case Name", "Date Submitted"]), { date: 0, motion: 1, caseName: 2, submitted: 3 });
check("in another order, with a blank first", headerColumns(["", "Case Name", "Date", "Motion", "Submitted"]), { date: 2, motion: 3, caseName: 1, submitted: 4 });
check("HYPERLINK formula", hyperlinkOfFormula('HYPERLINK("https://civil.lacourt.org/ecourt/ecms/case?id=7","Doe")'), "https://civil.lacourt.org/ecourt/ecms/case?id=7");

console.log("4. a workbook");
const shared = ["Hearings", "Date", "Motion Type", "Case Name", "Date Submitted",
  "Demurrer", "25STCV12345 ACME HOLDINGS, LP vs TAYLOR ROE",
  "MSJ", "24STCV00777 Doe v. Globex", "Motion to Compel", "Jane Doe v. Initech Corp.",
  "Motion to Strike", "23STCV04444 Roe v. Umbrella", "Fee Motion", "BC654321 Smith v. Wayne", "11/25/2026", "TBD",
  "Check POS", "20STCV02020 Note v. Case", "Continued to 12/4/2026", "21STCV03030 Moved v. Later"];
const si = shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("");
// Fills: 0 none, 1 gray125, 2 Good green (rgb), 3 red (rgb), 4 theme accent6 tinted, 5 yellow.
// cellXfs: 0 default, 1 date (14), 2 green, 3 red, 4 theme green, 5 green date, 6 yellow.
const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor theme="9" tint="0.59999389629810485"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>
<cellXfs count="7"><xf numFmtId="0" fillId="0"/><xf numFmtId="14" fillId="0" applyNumberFormat="1"/><xf numFmtId="0" fillId="2"/>
<xf numFmtId="0" fillId="3"/><xf numFmtId="0" fillId="4"/><xf numFmtId="14" fillId="2"/><xf numFmtId="0" fillId="5"/></cellXfs></styleSheet>`;
const c = (ref, v, { s = 0, t = null, f = null } = {}) =>
  `<c r="${ref}"${s ? ` s="${s}"` : ""}${t ? ` t="${t}"` : ""}>${f ? `<f>${f}</f>` : ""}<v>${v}</v></c>`;
const S = (i) => shared.indexOf(i);
const sheet1 = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>
<row r="1">${c("A1", S("Hearings"), { t: "s" })}</row>
<row r="2">${c("A2", S("Date"), { t: "s" })}${c("B2", S("Motion Type"), { t: "s" })}${c("C2", S("Case Name"), { t: "s" })}${c("D2", S("Date Submitted"), { t: "s" })}</row>
<row r="3">${c("A3", 46346, { s: 1 })}${c("B3", S("Demurrer"), { t: "s" })}${c("C3", S("25STCV12345 ACME HOLDINGS, LP vs TAYLOR ROE"), { t: "s" })}</row>
<row r="4">${c("B4", S("MSJ"), { t: "s" })}${c("C4", S("24STCV00777 Doe v. Globex"), { t: "s", s: 2 })}${c("D4", 46338, { s: 5 })}</row>
<row r="5">${c("A5", 46347, { s: 1 })}${c("B5", S("Motion to Compel"), { t: "s" })}<c r="C5" t="str"><f>HYPERLINK("https://civil.lacourt.org/ecourt/ecms/case?id=555&amp;caseNumber=26STCV09999","Jane Doe v. Initech Corp.")</f><v>Jane Doe v. Initech Corp.</v></c></row>
<row r="6">${c("A6", 46348, { s: 3 })}${c("B6", S("Motion to Strike"), { t: "s", s: 3 })}${c("C6", S("23STCV04444 Roe v. Umbrella"), { t: "s", s: 3 })}</row>
<row r="7" s="4" customFormat="1">${c("A7", S("11/25/2026"), { t: "s" })}${c("B7", S("Fee Motion"), { t: "s" })}${c("C7", S("BC654321 Smith v. Wayne"), { t: "s" })}</row>
<row r="8">${c("A8", 46300, { s: 1 })}${c("B8", S("Demurrer"), { t: "s", s: 6 })}${c("C8", S("Jane Doe v. Initech Corp."), { t: "s" })}</row>
<row r="9">${c("A9", S("Check POS"), { t: "s" })}${c("B9", S("MSJ"), { t: "s" })}${c("C9", S("20STCV02020 Note v. Case"), { t: "s" })}</row>
<row r="10">${c("A10", S("Continued to 12/4/2026"), { t: "s" })}${c("B10", S("Demurrer"), { t: "s" })}${c("C10", S("21STCV03030 Moved v. Later"), { t: "s" })}</row>
</sheetData><hyperlinks><hyperlink ref="C3" r:id="rId1"/><hyperlink ref="C4" r:id="rId2"/></hyperlinks></worksheet>`;
const sheet1Rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://civil.lacourt.org/ecourt/ecms/case?id=111" TargetMode="External"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://civil.lacourt.org/ecourt/ecms/case?id=222" TargetMode="External"/></Relationships>`;
const sheet2 = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1">${c("A1", S("Date"), { t: "s" })}${c("B1", S("Case Name"), { t: "s" })}</row>
<row r="2">${c("A2", 46346, { s: 1 })}${c("B2", S("23STCV04444 Roe v. Umbrella"), { t: "s" })}</row></sheetData></worksheet>`;
const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets>
<sheet name="Calendar" sheetId="1" r:id="rId1"/><sheet name="Old" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`;
const wbRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="x/styles" Target="styles.xml"/></Relationships>`;
const bytes = await makeZip([
  { name: "xl/workbook.xml", data: workbook },
  { name: "xl/_rels/workbook.xml.rels", data: wbRels },
  { name: "xl/sharedStrings.xml", data: `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${si}</sst>` },
  { name: "xl/styles.xml", data: styles },
  { name: "xl/worksheets/sheet1.xml", data: sheet1 },
  { name: "xl/worksheets/_rels/sheet1.xml.rels", data: sheet1Rels },
  { name: "xl/worksheets/sheet2.xml", data: sheet2 },
]);
const { hearings, sheets } = await readHearings(bytes, NOW);
check("the visible sheet only", sheets, ["Calendar"]);
check("eight hearings under the header", hearings.length, 8);
const h = (row) => hearings.find((x) => x.row === row);
check("row 3: date, motion, number, link, no mark", (({ date, motion, caseNumber, url, mark }) => ({ date, motion, caseNumber, url, mark }))(h(3)),
  { date: day(2026, 11, 20), motion: "Demurrer", caseNumber: "25STCV12345", url: "https://civil.lacourt.org/ecourt/ecms/case?id=111", mark: "" });
check("row 4: the date above it, submitted, green", (({ date, submitted, mark, url }) => ({ date, submitted, mark, url }))(h(4)),
  { date: day(2026, 11, 20), submitted: day(2026, 11, 12), mark: "done", url: "https://civil.lacourt.org/ecourt/ecms/case?id=222" });
check("row 5: the HYPERLINK formula's link and its caseNumber", [h(5).url, h(5).caseNumber],
  ["https://civil.lacourt.org/ecourt/ecms/case?id=555&caseNumber=26STCV09999", "26STCV09999"]);
check("row 6: red is off", h(6).mark, "off");
check("row 7: the row's own theme-green fill, a date typed as text", [h(7).mark, h(7).date, h(7).caseNumber], ["done", day(2026, 11, 25), "BC654321"]);
check("row 8: a yellow cell is no mark", h(8).mark, "");
check("row 9: words in the Date cell are a note; the date is the one above", [h(9).note, h(9).date], ["Check POS", h(8).date]);
check("row 10: a note naming a date keeps it", [h(10).note, h(10).date], ["Continued to 12/4/2026", day(2026, 12, 4)]);
check("a plain date is no note", [h(3).note, h(7).note], ["", ""]);
check("dates in words are no note", ["Fri, Nov 20, 2026", "November 20th", "11/20", "TBD", "Check POS 11/20"].map(dateNote), ["", "", "", "TBD", "Check POS 11/20"]);

console.log("4b. Off calendar and On calendar, written into the sheet");
const after = async (b) => (await readHearings(b, NOW)).hearings;
const at = (list, row) => list.find((x) => x.row === row);
const offBytes = await markHearing(bytes, h(3), "off");
let list = await after(offBytes);
check("Off calendar: the row reads as off", at(list, 3).mark, "off");
check("…its date still a date, its link still its link", [at(list, 3).date, at(list, 3).url], [h(3).date, h(3).url]);
check("…no other row changed", list.filter((x) => x.row !== 3).map((x) => x.mark), hearings.filter((x) => x.row !== 3).map((x) => x.mark));
const onBytes = await markHearing(offBytes, at(list, 3), "");
list = await after(onBytes);
check("On calendar: the red is off again", at(list, 3).mark, "");
check("…and the date is still a date", at(list, 3).date, h(3).date);
list = await after(await markHearing(bytes, h(6), ""));
check("On calendar on a row marked red by hand", at(list, 6).mark, "");
list = await after(await markHearing(bytes, h(4), "off"));
check("Off calendar over a green row", at(list, 4).mark, "off");
list = await after(await markHearing(bytes, h(8), "off"));
check("Off calendar on a row with a yellow highlight", at(list, 8).mark, "off");
const yellowBack = await after(await markHearing(await markHearing(bytes, h(8), "off"), h(8), ""));
check("…On calendar again leaves the yellow motion cell as it was", at(yellowBack, 8).mark, "");
list = await after(await markHearing(bytes, h(7), "off"));
check("Off calendar on a row styled green as a whole", at(list, 7).mark, "off");
let moved = null;
try { await markHearing(bytes, { ...h(3), caseName: "Nobody v. Nothing" }, "off"); } catch (e) { moved = e.message; }
check("a row no longer in the sheet is refused", moved, "the row for Nobody v. Nothing is no longer in the sheet");
check("a row found by its case and date where it moved", (await after(await markHearing(bytes, { ...h(5), row: 99 }, "off"))).find((x) => x.row === 5).mark, "off");
// A workbook with no red anywhere gets one added.
const noRed = await makeZip([
  { name: "xl/workbook.xml", data: workbook.replace('<sheet name="Old" sheetId="2" state="hidden" r:id="rId2"/>', "") },
  { name: "xl/_rels/workbook.xml.rels", data: wbRels },
  { name: "xl/sharedStrings.xml", data: `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${si}</sst>` },
  { name: "xl/styles.xml", data: styles.replace('<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>', '<fill><patternFill patternType="solid"><fgColor rgb="FF0000FF"/></patternFill></fill>') },
  { name: "xl/worksheets/sheet1.xml", data: sheet1 },
  { name: "xl/worksheets/_rels/sheet1.xml.rels", data: sheet1Rels },
]);
const noRedOff = await markHearing(noRed, (await after(noRed)).find((x) => x.row === 3), "off");
check("a sheet with no red of its own gets one", at(await after(noRedOff), 3).mark, "off");

console.log("5. matching a hearing to its folder");
check("a folder named by its number", placeMatches(h(3), { name: "25STCV12345 ACME v Roe" }), true);
check("a folder named another number", placeMatches(h(3), { name: "25STCV12346 ACME v Roe" }), false);
check("a folder whose Register of Actions carries the number", placeMatches(h(3), { name: "ACME demurrer", numbers: ["25STCV12345"] }), true);
const noNum = { caseName: "Jane Doe v. Initech Corp.", caseNumber: "" };
check("no number: the folder's words in the case name", placeMatches(noNum, { name: "Doe Initech" }), true);
check("…one word is not enough", placeMatches(noNum, { name: "Doe" }), false);
check("…a word the case name lacks", placeMatches(noNum, { name: "Doe Globex" }), false);
check("…a folder with a number the sheet does not give: by its words", placeMatches(noNum, { name: "24STCV00777 Doe Initech" }), true);
// On 0.2.88 a folder named for its parties matched no hearing that had a number.
check("a hearing with a number, a folder named for its parties", placeMatches(h(3), { name: "ACME v Roe" }), true);
check("…a folder named for one party and the motion", placeMatches(h(3), { name: "ACME Demurrer" }), true);
check("…another case's party with the motion is not it", placeMatches(h(3), { name: "Globex Demurrer" }), false);
check("…nor a folder carrying another case's number, whatever its words", placeMatches(h(3), { name: "25STCV99999 ACME v Roe" }), false);
check("…nor a short word alone", placeMatches({ caseName: "Roe v. Doe", motion: "", caseNumber: "25STCV12345" }, { name: "Roe" }), false);
check("…nor a loose Register of Actions for a case the sheet numbers not", placeMatches(noNum, { name: "Register of Actions 24STCV00777.pdf" }), false);
check("filler words left out", nameWords("ACME HOLDINGS, LP, et al. vs TAYLOR ROE 25STCV12345"), ["acme", "holdings", "taylor", "roe"]);
const places = [
  { name: "25STCV12345.zip", kind: "zip" },
  { name: "Register of Actions 25STCV12345.pdf", kind: "file" },
  { name: "25STCV12345 ACME", kind: "folder" },
];
check("a folder ahead of a zip and loose files", findPlace(h(3), places).kind, "folder");
check("a zip ahead of loose files", findPlace(h(3), places.slice(0, 2)).kind, "zip");
check("none", findPlace(h(6), places), null);
const DAY = 86400000;
check("an Order Template Input sheet from today counts", looseFileCounts("Order_Template_Input_25STCV12345.xlsx", NOW - 3600000, NOW), true);
check("…one two days old still does", looseFileCounts("Order_Template_Input_25STCV12345 (1).xlsx", NOW - 2 * DAY, NOW), true);
check("…one older is left over from an earlier motion in the case", looseFileCounts("Order_Template_Input_25STCV12345.xlsx", NOW - 2 * DAY - 60000, NOW), false);
check("…as is one whose time could not be read", looseFileCounts("Order_Template_Input_25STCV12345.xlsx", 0, NOW), false);
check("any other loose file counts, however old", looseFileCounts("Register of Actions 25STCV12345.pdf", NOW - 30 * DAY, NOW), true);
check("said: not downloaded", placeText(null).text, "Not downloaded");
check("said: downloaded", [placeText({ name: "x", kind: "folder" }).text, placeText({ name: "x", kind: "folder" }).tone], ["Downloaded", "ok"]);

console.log("6. the list");
check("upcoming, unmarked, by date", upcoming(hearings, NOW).map((x) => x.row), [3, 5, 10]);
check("every one from today on", upcoming(hearings, NOW, { all: true }).map((x) => x.row), [3, 4, 5, 6, 7, 10]);
check("days said", [dayText(day(2026, 11, 18), NOW), dayText(day(2026, 11, 19), NOW), dayText(day(2027, 1, 8), NOW).includes("2027")], ["Today", "Tomorrow", true]);
check("Date Submitted said short", [shortDate(day(2026, 11, 12), NOW), shortDate(day(2025, 11, 12), NOW)], ["11/12", "11/12/25"]);
check("a folder's hearing: the next one for its case", hearingForPlace(hearings, { name: "Jane Doe Initech", numbers: ["26STCV09999"] }, NOW).row, 5);
check("…else the latest past one", hearingForPlace(hearings, { name: "Doe Initech", numbers: ["99STCV99999"] }, NOW).row, 8);

// ---- the list on Home -----------------------------------------------------------

const REPO = path.dirname(fileURLToPath(import.meta.url));
const PW = "/opt/node-tools/node_modules/playwright/index.mjs";
const CHROME = "/opt/pw-browsers/chromium";
const portFree = (port) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.once("error", () => resolve(false));
  srv.once("listening", () => srv.close(() => resolve(true)));
  srv.listen(port, "127.0.0.1");
});
async function startServer(cwd) {
  let port = 0;
  for (let p = 8130; p <= 8199; p++) if (await portFree(p)) { port = p; break; }
  if (!port) return null;
  const proc = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd, stdio: "ignore" });
  for (let k = 0; k < 80; k++) {
    const up = await new Promise((resolve) => { const s = net.connect(port, "127.0.0.1", () => { s.end(); resolve(true); }); s.on("error", () => resolve(false)); });
    if (up) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base: `http://127.0.0.1:${port}`, stop: () => { try { proc.kill("SIGTERM"); } catch { /* gone */ } } };
}

/** A one-sheet workbook of `rows` ({ date (ms) or note (words in the Date cell), motion, name, link?, fill? "green" | "red" }), as Excel writes one. */
async function workbookOf(rows) {
  const strs = [];
  const S = (t) => { let i = strs.indexOf(t); if (i < 0) { i = strs.length; strs.push(t); } return i; };
  const serial = (at) => { const d = new Date(at); return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000; };
  const xs = { green: 2, red: 3 };
  let body = `<row r="1"><c r="A1" t="s"><v>${S("Date")}</v></c><c r="B1" t="s"><v>${S("Motion Type")}</v></c><c r="C1" t="s"><v>${S("Case Name")}</v></c><c r="D1" t="s"><v>${S("Date Submitted")}</v></c></row>`;
  const links = [], rels = [];
  rows.forEach((r, i) => {
    const n = i + 2, st = xs[r.fill] || 0;
    const dateCell = r.note ? `<c r="A${n}" t="s"${st ? ` s="${st}"` : ""}><v>${S(r.note)}</v></c>` : `<c r="A${n}" s="${st || 1}"><v>${serial(r.date)}</v></c>`;
    body += `<row r="${n}">${dateCell}<c r="B${n}" t="s"${st ? ` s="${st}"` : ""}><v>${S(r.motion)}</v></c><c r="C${n}" t="s"${st ? ` s="${st}"` : ""}><v>${S(r.name)}</v></c></row>`;
    if (r.link) { links.push(`<hyperlink ref="C${n}" r:id="rId${n}"/>`); rels.push(`<Relationship Id="rId${n}" Type="h" Target="${r.link.replace(/&/g, "&amp;")}" TargetMode="External"/>`); }
  });
  const ns = `xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
  return makeZip([
    { name: "xl/workbook.xml", data: `<workbook ${ns}><sheets><sheet name="Hearings" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<Relationships><Relationship Id="rId1" Type="w" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/sharedStrings.xml", data: `<sst>${strs.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>` },
    { name: "xl/styles.xml", data: `<styleSheet><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill></fills><cellXfs count="4"><xf numFmtId="0" fillId="0"/><xf numFmtId="14" fillId="0"/><xf numFmtId="14" fillId="2"/><xf numFmtId="14" fillId="3"/></cellXfs></styleSheet>` },
    { name: "xl/worksheets/sheet1.xml", data: `<worksheet ${ns}><sheetData>${body}</sheetData>${links.length ? `<hyperlinks>${links.join("")}</hyperlinks>` : ""}</worksheet>` },
    { name: "xl/worksheets/_rels/sheet1.xml.rels", data: `<Relationships>${rels.join("")}</Relationships>` },
  ]);
}

async function browserPart() {
  if (!fs.existsSync(PW) || !fs.existsSync(CHROME)) { console.log("\n(SKIP the app: Playwright or Chromium is missing)"); return; }
  const { chromium } = await import(PW);
  const { launchBrowser } = await import("./browser-for-tests.mjs");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "hearings-site-"));
  execFileSync("bash", [path.join(REPO, "pwa", "build-site.sh"), out], { stdio: "ignore" });
  const site = await startServer(out);
  if (!site) { console.log("\n(SKIP the app: no free port in 8130-8199)"); return; }
  const browser = await launchBrowser(chromium, CHROME);
  try {
    const app = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
    const shell = await app.newPage();
    const errors = [];
    shell.on("pageerror", (e) => errors.push(e.message));
    await shell.goto(site.base + "/index.html");

    console.log("7. Home before the sheet is linked");
    await shell.waitForFunction(() => !document.getElementById("hearings").hidden, null, { timeout: 10000 });
    check("it offers to link the sheet", await shell.textContent("#hearings-link"), "Link hearings sheet…");
    check("…and says what it will list", (await shell.textContent("#hearing-list")).startsWith("Link your Excel sheet"), true);

    console.log("8. the sheet and Downloads linked");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const inDays = (n) => today.getTime() + n * 86400000 + 3600000; // an hour past midnight: a DST day is still that day
    const sheetBytes = [...new Uint8Array(await (await workbookOf([
      { date: inDays(2), motion: "Demurrer", name: "25STCV12345 ACME HOLDINGS, LP vs TAYLOR ROE", link: "https://civil.lacourt.org/ecourt/ecms/case?id=111" },
      { note: "Check POS", motion: "MSJ", name: "24STCV00777 Doe v. Globex", link: "https://civil.lacourt.org/ecourt/ecms/case?id=222" },
      { date: inDays(3), motion: "Motion to Compel", name: "26STCV09999 Jane Doe v. Initech", link: "https://civil.lacourt.org/ecourt/ecms/case?id=333" },
      { date: inDays(3), motion: "Motion to Strike", name: "23STCV04444 Roe v. Umbrella", fill: "green" },
      { date: inDays(4), motion: "Fee Motion", name: "BC654321 Smith v. Wayne", fill: "red" },
      { date: inDays(5), motion: "Demurrer", name: "22STCV05555 Vance v. Stark" },
      { date: inDays(-3), motion: "Demurrer", name: "21STCV01111 Past v. Gone" },
    ])).arrayBuffer())];
    await shell.evaluate(async ({ sheetBytes }) => {
      const top = await navigator.storage.getDirectory();
      for (const n of ["Downloads", "Elsewhere", "Hearings.xlsx"]) { try { await top.removeEntry(n, { recursive: true }); } catch { /* none yet */ } }
      const put = async (d, name, data) => { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); };
      const dl = await top.getDirectoryHandle("Downloads", { create: true });
      const acme = await dl.getDirectoryHandle("25STCV12345 ACME", { create: true });
      await put(acme, "Demurrer.pdf", "%PDF-1.4 stand-in");
      await put(acme, "DONE 2.40PM.txt", "");
      await put(dl, "22STCV05555.zip", "zip stand-in");
      // An Order Template Input sheet from an earlier motion in Doe v. Globex,
      // three days old (OPFS writes now, so its time is given back older).
      await put(dl, "Order_Template_Input_24STCV00777.xlsx", "xlsx stand-in");
      const realGetFile = FileSystemFileHandle.prototype.getFile;
      FileSystemFileHandle.prototype.getFile = async function () {
        const f = await realGetFile.apply(this, arguments);
        return this.name === "Order_Template_Input_24STCV00777.xlsx" ? new File([f], f.name, { lastModified: Date.now() - 3 * 86400000 }) : f;
      };
      // A case folder no hearing on the list claims, and one whose hearing is marked done.
      const zeta = await dl.getDirectoryHandle("Case Zeta", { create: true });
      await put(zeta, "Complaint.pdf", "%PDF-1.4 stand-in");
      const umbrella = await dl.getDirectoryHandle("23STCV04444 Umbrella", { create: true });
      await put(umbrella, "Strike.pdf", "%PDF-1.4 stand-in");
      // A folder opened here, named by no case number: its Register of Actions carries it.
      const elsewhere = await top.getDirectoryHandle("Elsewhere", { create: true });
      const doe = await elsewhere.getDirectoryHandle("Initech compel", { create: true });
      await put(doe, "Register of Actions 26STCV09999.pdf", "%PDF-1.4 stand-in");
      await put(top, "Hearings.xlsx", new Uint8Array(sheetBytes));
      const sheet = await top.getFileHandle("Hearings.xlsx");
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("pdfviewer-folders", 1);
        req.onupgradeneeded = () => { req.result.createObjectStore("folders", { keyPath: "key" }); req.result.createObjectStore("places"); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise((resolve) => {
        const tx = db.transaction(["places", "folders"], "readwrite");
        tx.objectStore("places").put(dl, "downloads");
        tx.objectStore("places").put(sheet, "hearings");
        tx.objectStore("folders").put({ key: "k1", name: doe.name, handle: doe, when: Date.now() - 60000 });
        tx.oncomplete = resolve;
      });
      db.close();
      window.__opened = [];
      window.open = (url) => { window.__opened.push(url); return null; };
      window.dispatchEvent(new Event("focus"));
    }, { sheetBytes });
    await shell.waitForFunction(() => document.querySelectorAll("#hearing-list .hearing-item").length === 4, null, { timeout: 10000 });
    const rows = () => shell.$$eval("#hearing-list .hearing-item", (bs) => bs.map((b) => ({
      name: b.querySelector(".ri-name").textContent, where: b.querySelector(".ci-where").textContent, status: b.querySelector(".ci-status").textContent,
    })));
    let got = await rows();
    check("the unmarked hearings from today on, by date", got.map((r) => r.name.slice(0, 11)), ["25STCV12345", "24STCV00777", "26STCV09999", "22STCV05555"]);
    check("a case downloaded says what PDF-Linker has done in it; the rest where the case stands", got.map((r) => r.status.replace(/^Finished .*/, "Finished")),
      ["Finished", "Not downloaded", "Not run yet", "Zip in Downloads"]);
    check("…an Order Template Input sheet three days old is no sign of Doe v. Globex", got[1].status, "Not downloaded");
    check("…a folder in Downloads, by its name", got[0].where, "Demurrer · 25STCV12345 ACME");
    check("…a folder opened elsewhere, by its Register of Actions", got[2].where, "Motion to Compel · Initech compel");
    check("grouped under their days", await shell.$$eval("#hearing-list .hearing-day", (d) => d.length), 3);
    check("the summary", await shell.textContent("#hearings-summary"), "4 to work up2 downloaded2 not downloaded");
    const buttons = () => shell.$$eval("#hearing-list .hearing-row", (rs) => rs.map((r) => ({
      ecourt: !!r.querySelector(".ci-ecourt:not(.ci-ecourt-gap)"), line: !!r.querySelector(".ci-line"),
    })));
    check("the eCourt buttons stand where the sheet links the case; Prioritize where the case is downloaded", await buttons(),
      [{ ecourt: true, line: true }, { ecourt: true, line: false }, { ecourt: true, line: true }, { ecourt: false, line: false }]);

    console.log("9. Case folders: only the folders no hearing on the list claims, above the hearings");
    const caseNames = () => shell.$$eval("#case-list .case-item .ri-name", (x) => x.map((e) => e.textContent).sort());
    await shell.waitForFunction(() => !document.getElementById("case-folders").hidden && document.querySelectorAll("#case-list .case-item").length === 2, null, { timeout: 10000 });
    check("Case Zeta, and the folder whose hearing is marked done", await caseNames(), ["23STCV04444 Umbrella", "Case Zeta"]);
    check("…which says its hearing", (await shell.$$eval("#case-list .case-item", (bs) => bs.map((b) => b.querySelector(".ci-where").textContent))).some((w) => w.startsWith("Hearing ") && w.includes("(done)")), true);
    check("the list stands above the hearings", await shell.evaluate(() => !!(document.getElementById("case-folders").compareDocumentPosition(document.getElementById("hearings")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    check("the Downloads link is in the Hearings heading", await shell.evaluate(() => !!document.querySelector("#hearings #case-downloads")), true);

    console.log("10. eCourt, and a case folder's buttons on its hearing's row");
    await shell.click("#hearing-list .hearing-row:nth-of-type(3) .ci-ecourt");
    await shell.click("#hearing-list .hearing-row:nth-of-type(3) .hearing-item");
    check("eCourt opens the sheet's link, twice", await shell.evaluate(() => window.__opened), ["https://civil.lacourt.org/ecourt/ecms/case?id=222", "https://civil.lacourt.org/ecourt/ecms/case?id=222"]);
    await shell.click("#hearing-list .hearing-row:nth-of-type(2) .ci-line-add");
    await shell.waitForFunction(() => document.querySelector("#hearing-list .hearing-row:nth-of-type(2) .ci-place"), null, { timeout: 10000 });
    check("Prioritize on the hearing puts its folder first in line", await shell.textContent("#hearing-list .hearing-row:nth-of-type(2) .ci-place"), "1st");
    check("…written into the folder", await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const f = await (await (await dl.getDirectoryHandle("25STCV12345 ACME")).getFileHandle("PDF-Linker Priority.json")).getFile();
      return JSON.parse(await f.text()).rank;
    }), 1);

    console.log("11. Show done and off");
    check("the button counts them", await shell.textContent("#hearings-all"), "Show done and off (2)");
    await shell.click("#hearings-all");
    await shell.waitForFunction(() => document.querySelectorAll("#hearing-list .hearing-item").length === 6, null, { timeout: 10000 });
    got = await rows();
    check("green says Done, red Off calendar", got.filter((r) => /Done|Off/.test(r.status)).map((r) => r.status), ["Done", "Off calendar"]);
    check("…set apart", await shell.$$eval("#hearing-list .hearing-row.mark-done, #hearing-list .hearing-row.mark-off", (x) => x.length), 2);
    await shell.waitForFunction(() => document.querySelectorAll("#case-list .case-item").length === 1, null, { timeout: 10000 });
    check("the done hearing's folder moves onto its row", await caseNames(), ["Case Zeta"]);

    console.log("12. every folder on a hearing: no Case folders list");
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      await dl.removeEntry("Case Zeta", { recursive: true });
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForFunction(() => document.getElementById("case-folders").hidden, null, { timeout: 10000 });
    check("the list is hidden", await shell.evaluate(() => document.getElementById("case-folders").hidden), true);

    console.log("13. a note in the Date cell: a * that opens it");
    const doeRow = '#hearing-list .hearing-row:has(.ri-name:text-is("24STCV00777 Doe v. Globex"))';
    const doe = shell.locator(doeRow);
    check("the note's * stands after the case name, only there", await shell.$$eval("#hearing-list .ci-note-mark", (x) => x.length), 1);
    check("…on Doe v. Globex", await doe.locator(".ci-note-mark").count(), 1);
    const opened = (await shell.evaluate(() => window.__opened.length));
    await doe.locator(".ci-note-mark").click();
    check("a click opens the note under the row", await shell.evaluate(() => { const n = document.querySelector(".hearing-note"); return n && !n.hidden ? n.textContent : null; }), "Check POS");
    check("…and opens nothing else", await shell.evaluate(() => window.__opened.length), opened);
    await doe.locator(".ci-note-mark").click();
    check("a second click closes it", await shell.evaluate(() => document.querySelector(".hearing-note").hidden), true);

    console.log("14. Off calendar and On calendar, written into the sheet");
    const sheetNow = async () => {
      const bytes = await shell.evaluate(async () => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle("Hearings.xlsx")).getFile()).arrayBuffer())]);
      return (await readHearings(new Uint8Array(bytes))).hearings.find((x) => x.caseName.startsWith("24STCV00777"));
    };
    check("the row offers Off calendar", await doe.locator(".ci-cal").textContent(), "Off calendar");
    await doe.locator(".ci-cal").click();
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.textContent.includes("24STCV00777") && r.querySelector(".ci-cal").textContent === "On calendar"), null, { timeout: 10000 });
    check("the sheet's row is filled red", (await sheetNow()).mark, "off");
    check("…its note and link kept", [(await sheetNow()).note, (await sheetNow()).url], ["Check POS", "https://civil.lacourt.org/ecourt/ecms/case?id=222"]);
    check("the row says Off calendar", await doe.locator(".ci-status").textContent(), "Off calendar");
    // Excel holding the workbook: the write is refused.
    await shell.evaluate(() => {
      window.__realWritable = FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable = async function () { if (this.name === "Hearings.xlsx") throw new DOMException("The file is in use", "NoModificationAllowedError"); return window.__realWritable.apply(this, arguments); };
    });
    await doe.locator(".ci-cal").click();
    await shell.waitForFunction(() => /waiting to be written/.test(document.getElementById("hearings-summary").textContent), null, { timeout: 10000 });
    check("while Excel holds it: shown on calendar here, and said to be waiting", [await doe.locator(".ci-cal").textContent(), await doe.locator(".ci-status.waiting").count() === 1], ["Off calendar", true]);
    check("…the sheet not yet changed", (await sheetNow()).mark, "off");
    await shell.evaluate(() => { FileSystemFileHandle.prototype.createWritable = window.__realWritable; window.dispatchEvent(new Event("focus")); });
    await shell.waitForFunction(() => !/waiting to be written/.test(document.getElementById("hearings-summary").textContent), null, { timeout: 10000 });
    check("once Excel lets go, the next look writes it: the red is off", (await sheetNow()).mark, "");

    console.log("15. the Folders list: drag a case onto a folder to move it there");
    check("Downloads stands on the list once linked", await shell.$$eval("#tree-list .tree-node.root .tree-name", (x) => x.map((e) => e.textContent)), ["Downloads"]);
    await shell.evaluate(async () => {
      const top = await navigator.storage.getDirectory();
      try { await top.removeEntry("Filed", { recursive: true }); } catch { /* none */ }
      const filed = await top.getDirectoryHandle("Filed", { create: true });
      await filed.getDirectoryHandle("November", { create: true });
      const db = await new Promise((resolve, reject) => { const req = indexedDB.open("pdfviewer-folders", 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      await new Promise((resolve) => { const tx = db.transaction("places", "readwrite"); tx.objectStore("places").put([filed], "treeRoots"); tx.oncomplete = resolve; });
      db.close();
    });
    await shell.reload();
    await shell.waitForFunction(() => document.querySelectorAll("#tree-list .tree-node.root").length === 2, null, { timeout: 10000 });
    check("…and a folder added beside it", await shell.$$eval("#tree-list .tree-node.root .tree-name", (x) => x.map((e) => e.textContent)), ["Downloads", "Filed"]);
    await shell.click('#tree-list .tree-node:has(.tree-name:text-is("Filed"))');
    await shell.waitForFunction(() => [...document.querySelectorAll("#tree-list .tree-name")].some((e) => e.textContent === "November"), null, { timeout: 10000 });
    check("a click opens a folder, as File Explorer's do", await shell.$$eval("#tree-list .tree-name", (x) => x.map((e) => e.textContent)), ["Downloads", "Filed", "November"]);
    await shell.waitForFunction(() => document.querySelectorAll("#hearing-list .hearing-row.draggable").length >= 2, null, { timeout: 10000 });
    const acmeRow = shell.locator('#hearing-list .hearing-row:has(.ri-name:text-is("25STCV12345 ACME HOLDINGS, LP vs TAYLOR ROE"))');
    check("a hearing that carries its folder can be dragged; one that has none cannot", await shell.$$eval("#hearing-list .hearing-row", (rs) => rs.filter((r) => r.textContent.includes("24STCV00777")).map((r) => r.draggable)), [false]);
    await acmeRow.dragTo(shell.locator('#tree-list .tree-node:has(.tree-name:text-is("November"))'));
    await shell.waitForSelector("#move-bar:not([hidden])", { timeout: 5000 });
    check("the move bar asks first", await shell.textContent("#move-bar .mb-text"), "Move “25STCV12345 ACME” into Filed › November?");
    await shell.click("#move-bar .mb-go");
    await shell.waitForFunction(() => /^Moved /.test(document.querySelector("#move-bar .mb-text").textContent), null, { timeout: 15000 });
    check("it says it moved", (await shell.textContent("#move-bar .mb-text")).startsWith("Moved “25STCV12345 ACME” into November"), true);
    check("on disk: out of Downloads, into Filed › November, every file with it", await shell.evaluate(async () => {
      const top = await navigator.storage.getDirectory();
      const names = async (d) => { const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort(); };
      const dl = await top.getDirectoryHandle("Downloads");
      const nov = await (await top.getDirectoryHandle("Filed")).getDirectoryHandle("November");
      return { dl: (await names(dl)).includes("25STCV12345 ACME"), moved: await names(await nov.getDirectoryHandle("25STCV12345 ACME")) };
    }), { dl: false, moved: ["DONE 2.40PM.txt", "Demurrer.pdf", "PDF-Linker Priority.json"] });
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-item")].some((b) => b.textContent.includes("(in November)")), null, { timeout: 15000 });
    const moved = await acmeRow.locator(".ci-where").textContent();
    check("the hearing still carries its folder, at its new place", moved, "Demurrer · 25STCV12345 ACME (in November)");
    check("…with its status and its buttons", [/^Finished /.test(await acmeRow.locator(".ci-status").textContent()), await acmeRow.locator(".ci-line").count()], [true, 1]);
    check("…and the case folder shows in the list, closed", await shell.$$eval("#tree-list .tree-node.leaf .tree-name", (x) => x.map((e) => e.textContent)), ["25STCV12345 ACME"]);
    await shell.click("#move-bar .mb-cancel");

    console.log("16. a move refused while a run goes in the folder");
    await shell.evaluate(async () => {
      const top = await navigator.storage.getDirectory();
      const init = await (await top.getDirectoryHandle("Elsewhere")).getDirectoryHandle("Initech compel");
      const w = await (await init.getFileHandle("ETA ~6.04PM (1 of 3).txt", { create: true })).createWritable(); await w.close();
      window.dispatchEvent(new Event("focus"));
    });
    const initRow = shell.locator('#hearing-list .hearing-row:has(.ri-name:text-is("26STCV09999 Jane Doe v. Initech"))');
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.textContent.includes("26STCV09999") && /Running/.test(r.textContent)), null, { timeout: 15000 });
    await initRow.dragTo(shell.locator('#tree-list .tree-node:has(.tree-name:text-is("Filed"))'));
    await shell.waitForSelector("#move-bar:not([hidden])", { timeout: 5000 });
    await shell.click("#move-bar .mb-go");
    await shell.waitForFunction(() => /was not moved/.test(document.querySelector("#move-bar .mb-text").textContent), null, { timeout: 10000 });
    check("it says why", await shell.textContent("#move-bar .mb-text"), "“Initech compel” was not moved: PDF-Linker is running on it: wait for the run to finish.");
    check("…and the folder is where it was", await shell.evaluate(async () => { try { await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Elsewhere")).getDirectoryHandle("Initech compel"); return true; } catch { return false; } }), true);
    check("no page errors", errors, []);
  } finally {
    await browser.close();
    site.stop();
    fs.rmSync(out, { recursive: true, force: true });
  }
}
await browserPart();

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
