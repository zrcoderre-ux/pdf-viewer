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
import { zipEntries, readEntry } from "./viewer/xlsx-read.js";
import {
  readHearings, parseStyles, caseNumbersIn, caseNumberOfUrl, markOfColor, serialToDate, textToDate, headerColumns,
  hyperlinkOfFormula, dateNote, namesMatch, parseBriefing, briefingFor, briefingChips, BRIEFING_FILE, parseBriefingFile, refreshText, markHearing, looseFileCounts, placeMatches, findPlace, placeText, upcoming, dayText, shortDate, hearingForPlace, nameWords,
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

console.log("4b. Done, Off calendar and On calendar, written into the sheet");
/** Each cell's mark in a row of sheet 1, by column letter: { A: "done" | "off" | "", … }. */
async function cellMarks(b, rowN) {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer());
  const ents = zipEntries(u8);
  const part = async (n) => readEntry(u8, ents.find((e) => e.name === n));
  const st = parseStyles(await part("xl/styles.xml"));
  const row = new RegExp(`<row r="${rowN}"[^>]*>([\\s\\S]*?)</row>`).exec(await part("xl/worksheets/sheet1.xml"))[1];
  const out = {};
  for (const m of row.matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*?\ss="(\d+)")?/g)) {
    const f = st[Number(m[2] || 0)] && st[Number(m[2] || 0)].fill;
    out[m[1]] = f ? markOfColor(f.hex, f.tint) : "";
  }
  return out;
}
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
// The owner: Done turns "the hearing type and case name cells green"; Off calendar "only those cells red".
check("Off calendar: the Motion Type and Case Name cells only", await cellMarks(offBytes, 3), { A: "", B: "off", C: "off" });
const doneBytes = await markHearing(bytes, h(3), "done");
check("Done: the Motion Type and Case Name cells green, and only they", await cellMarks(doneBytes, 3), { A: "", B: "done", C: "done" });
check("…the row reads as done, its date still a date", [at(await after(doneBytes), 3).mark, at(await after(doneBytes), 3).date], ["done", h(3).date]);
check("Done over Off calendar: green where it was red", await cellMarks(await markHearing(offBytes, h(3), "done"), 3), { A: "", B: "done", C: "done" });
check("Not done: the green off again", await cellMarks(await markHearing(doneBytes, h(3), ""), 3), { A: "", B: "", C: "" });
check("Off calendar over a row green by hand: the green elsewhere in the row taken off", await cellMarks(await markHearing(bytes, h(4), "off"), 4), { B: "off", C: "off", D: "" });
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

console.log("5b. the briefing E-Court Suite reports");
const bday = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const slot = (state, note = "", extra = {}) => ({ due: day(2026, 11, 1), filed: state === "filed" || state === "late" ? day(2026, 11, 2) : null, state, note, manual: false, ...extra });
const entries = parseBriefing(JSON.stringify({ version: 1, entries: [
  { caseNumber: "25STCV12345", day: bday(2026, 11, 20), motionType: "Demurrer", kind: "motion", motion: slot("filed"), opp: slot("late"), reply: slot("missing", "Not Filed"), at: 1 },
  { caseNumber: "25STCV12345", day: bday(2026, 11, 20), motionType: "Motion to Strike", kind: "motion", motion: slot("filed"), opp: slot("pending"), reply: slot("pending"), at: 2 },
  { caseNumber: "23STCV04444", day: bday(2026, 11, 22), motionType: "OSC Re: Default Judgment", kind: "osc", osc: { text: "⚠ Default Not Entered", state: "warn" }, at: 3 },
  { caseNumber: "bad" }, { day: "2026-11-20" },
] }));
check("the file's entries, the malformed left out", entries.length, 3);
check("not that file: none", [parseBriefing("not json"), parseBriefing("{}")], [[], []]);
check("a hearing's entry by case and day", briefingFor({ caseNumber: "23STCV04444", date: day(2026, 11, 22) }, entries).kind, "osc");
check("two motions that day: the one its Motion Type names", [briefingFor({ caseNumber: "25STCV12345", date: day(2026, 11, 20), motion: "Demurrer" }, entries).motionType, briefingFor({ caseNumber: "25STCV12345", date: day(2026, 11, 20), motion: "Motion to Strike Portions" }, entries).motionType], ["Demurrer", "Motion to Strike"]);
check("…another day, or no case number: none", [briefingFor({ caseNumber: "25STCV12345", date: day(2026, 11, 21) }, entries), briefingFor({ caseNumber: "", date: day(2026, 11, 20) }, entries)], [null, null]);
const chips = briefingChips(entries[0]);
check("chips as the case page colours them", chips.map((c) => [c.label, c.state, c.mark]), [["Mot", "filed", "✓"], ["Opp", "late", "!"], ["Rep", "missing", "✗"]]);
check("…each one's hover says what and when", [chips[1].title, chips[2].title], ["Opposition: filed late, due 11/1, filed 11/2", "Reply: not filed, due 11/1"]);
check("not posted yet is unsure, not missing", briefingChips({ kind: "motion", reply: slot("pending", "Not Posted Yet") }).map((c) => [c.state, c.mark]), [["unposted", "?"]]);
check("timely only if served personally", briefingChips({ kind: "motion", motion: slot("personal") })[0].state, "personal");
check("a paper picked by hand says so", briefingChips({ kind: "motion", opp: slot("filed", "", { manual: true }) })[0].title.endsWith("(picked by hand in E-Court Suite)"), true);
check("an OSC is one chip", briefingChips(entries[2]).map((c) => [c.label, c.state, c.mark]), [["Defaults", "missing", "!"]]);
check("the file's name", BRIEFING_FILE, "E-Court Briefing Status.json");
const rAt = new Date(2026, 10, 18, 9, 5).getTime();
check("the last check, off the file", parseBriefingFile(JSON.stringify({ entries: [], refresh: { at: rAt, state: "done", cases: 12, how: "hourly" } })).refresh.cases, 12);
check("…none in an older file", parseBriefingFile(JSON.stringify({ entries: [] })).refresh, null);
check("said: checked, when", refreshText({ at: rAt, state: "done", cases: 12 }, NOW).text, "Briefing checked " + new Date(rAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
check("said: a sign-in wanted, as a warning", [refreshText({ at: rAt, state: "failed", reason: "signin" }, NOW).text, refreshText({ at: rAt, state: "failed", reason: "signin" }, NOW).tone], ["Briefing not checked: eCourt sign-in needed", "warn"]);
check("said: no eCourt tab open", refreshText({ at: rAt, state: "skipped", reason: "notab" }, NOW).text, "Briefing not checked: no eCourt tab open");
check("said: checking", refreshText({ at: rAt, state: "running" }, NOW).tone, "run");

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
    await shell.waitForFunction(() => document.querySelectorAll("#hearing-list .hearing-item").length === 5, null, { timeout: 10000 });
    const rows = () => shell.$$eval("#hearing-list .hearing-item", (bs) => bs.map((b) => ({
      name: b.querySelector(".ri-name").textContent, where: b.querySelector(".ci-where").textContent, status: b.querySelector(".ci-status").textContent,
    })));
    // A case's buttons open under it once it is selected (a click on the row).
    const pick = async (row) => { if (!(await row.evaluate((r) => r.classList.contains("selected")))) await row.locator(".ci-where").click(); await row.locator(".hearing-tools").waitFor({ timeout: 5000 }); };
    let got = await rows();
    check("the hearings from today on, by date, the one off calendar left out", got.map((r) => r.name.slice(0, 11)), ["25STCV12345", "24STCV00777", "26STCV09999", "23STCV04444", "22STCV05555"]);
    check("a case downloaded says what PDF-Linker has done in it; the rest where the case stands", got.map((r) => r.status.replace(/^Finished .*/, "Finished")),
      ["Finished", "Not downloaded", "Not run yet", "Not run yet", "Zip in Downloads"]);
    check("the one done carries a ✓, and only it", await shell.$$eval("#hearing-list .hearing-row", (rs) => rs.map((r) => !!r.querySelector(".ci-done-mark"))), [false, false, false, true, false]);
    check("no row shows buttons until it is selected", await shell.$$eval("#hearing-list .ci-done, #hearing-list .ci-ecourt, #hearing-list .ci-cal", (bs) => bs.length), 0);
    const roeRow = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("23STCV04444"))');
    await pick(roeRow);
    check("…selected, the done one's Done button is pressed", await roeRow.locator(".ci-done").getAttribute("aria-pressed"), "true");
    check("…the buttons say what they do", await roeRow.locator(".hearing-tools").evaluate((t) => [...t.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 4)), ["Open case folder", "Not done", "Off calendar"]);
    check("…only that row has them", await shell.$$eval("#hearing-list .hearing-tools", (t) => t.length), 1);
    await shell.keyboard.press("Escape");
    check("…and Escape closes them", await shell.$$eval("#hearing-list .hearing-tools", (t) => t.length), 0);
    check("…an Order Template Input sheet three days old is no sign of Doe v. Globex", got[1].status, "Not downloaded");
    check("…a folder in Downloads, by its name", got[0].where, "Demurrer · 25STCV12345 ACME");
    check("…a folder opened elsewhere, by its Register of Actions", got[2].where, "Motion to Compel · Initech compel");
    check("grouped under their days", await shell.$$eval("#hearing-list .hearing-day", (d) => d.length), 3);
    check("the summary", await shell.textContent("#hearings-summary"), "4 to work up2 downloaded2 not downloaded1 done");
    // The owner: "The finished time takes up too much space ... expand to give that detail when pressed".
    const acmePill = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("25STCV12345 ACME HOLDINGS, LP vs TAYLOR ROE")) .ci-status');
    check("PDF-Linker's status is a dot; where the case stands keeps its words", await shell.$$eval("#hearing-list .ci-status", (ps) => ps.map((p) => p.classList.contains("compact"))), [true, false, true, true, false]);
    check("…the dot is small", (await acmePill.boundingBox()).width <= 24, true);
    await acmePill.click();
    check("a press opens it to its words", [await acmePill.evaluate((p) => p.classList.contains("expanded")), (await acmePill.boundingBox()).width > 60], [true, true]);
    check("…and opens nothing else", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), 0);
    await acmePill.click();
    check("a second press closes it", await acmePill.evaluate((p) => p.classList.contains("expanded")), false);
    const buttons = async () => {
      const out = [];
      const n = await shell.locator("#hearing-list .hearing-row").count();
      for (let i = 0; i < n; i++) {
        const row = shell.locator("#hearing-list .hearing-row").nth(i);
        await pick(row);
        out.push(await row.evaluate((r) => ({ ecourt: !!r.querySelector(".hearing-tools .ci-ecourt"), open: r.querySelector(".hearing-tools .ht-open").textContent })));
      }
      await shell.keyboard.press("Escape");
      return out;
    };
    check("selected: eCourt where the sheet links the case; Open where its folder is found, else Find its folder", await buttons(),
      [{ ecourt: true, open: "Open case folder" }, { ecourt: true, open: "Find its folder…" }, { ecourt: true, open: "Open case folder" }, { ecourt: false, open: "Open case folder" }, { ecourt: false, open: "Find its folder…" }]);

    console.log("9. Case folders: only the folders no hearing on the list claims, above the hearings");
    const caseNames = () => shell.$$eval("#case-list .case-item .ri-name", (x) => x.map((e) => e.textContent).sort());
    await shell.waitForFunction(() => !document.getElementById("case-folders").hidden && document.querySelectorAll("#case-list .case-item").length === 1, null, { timeout: 10000 });
    // The owner: "cases that are done and off don't need to be shown in the Case Folders rows".
    check("Case Zeta only: the folder whose hearing is done is on that hearing's row", await caseNames(), ["Case Zeta"]);
    check("the list stands above the hearings", await shell.evaluate(() => !!(document.getElementById("case-folders").compareDocumentPosition(document.getElementById("hearings")) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
    check("the sheet and Downloads links are in the settings menu", await shell.evaluate(() => !!document.querySelector("#home-settings-menu #case-downloads") && !!document.querySelector("#home-settings-menu #hearings-link")), true);
    await shell.click("#home-settings");
    check("…which opens on its button", await shell.isVisible("#home-settings-menu #hearings-link"), true);
    await shell.keyboard.press("Escape");
    check("…and closes on Escape", await shell.isVisible("#home-settings-menu"), false);

    console.log("9a. the bar: no open buttons; PDF from images in the strip");
    check("the bar holds the title and the settings only", await shell.evaluate(() => [!!document.querySelector(".home-top #open-file, .home-top #open-case, .home-top #combine-files, .home-top #images-to-pdf"), !!document.querySelector(".home-top #home-settings")]), [false, true]);
    check("PDF from images stands beside Case folder in the strip", await shell.evaluate(() => { const b = document.querySelector("#tabstrip #images-to-pdf"); return !!b && b.previousElementSibling.id === "open-case-tab"; }), true);

    console.log("9a2. the sidebar's foot: how Home works, and PDF+'s updates and app files");
    // As an older PDF+'s shim did: its box at the end of Home's main column.
    await shell.evaluate(() => {
      const box = document.createElement("section");
      box.className = "pdfplus-about";
      box.innerHTML = '<div class="pa-row"><span class="pa-version">PDF+ 0.2.99</span><button class="link-btn pa-check">Check for updates</button></div><div class="pa-source"><div class="pa-row"><span>App files:</span></div></div>';
      document.querySelector("#dropzone .home-inner").appendChild(box);
    });
    await shell.waitForFunction(() => !!document.querySelector("#home-foot .pdfplus-about"), null, { timeout: 5000 });
    check("PDF+'s version, updates and app files move to the sidebar's foot", await shell.evaluate(() => [!!document.querySelector("#home-foot .pdfplus-about .pa-check"), !document.querySelector(".home-inner .pdfplus-about")]), [true, true]);
    check("…with How Home's lists work", await shell.evaluate(() => !!document.querySelector("#home-foot .home-more")), true);
    await shell.setViewportSize({ width: 1920, height: 1000 }); await shell.waitForTimeout(300);
    const foot = await shell.evaluate(() => { const r = document.getElementById("home-foot").getBoundingClientRect(); return [Math.round(r.left), Math.round(r.bottom)]; });
    check("…at the bottom left corner", [foot[0] < 40, foot[1] > 900], [true, true]);
    await shell.click("#home-foot .home-more summary");
    const panel = await shell.evaluate(() => { const b = document.querySelector("#home-foot .home-more-body").getBoundingClientRect(); return [Math.round(b.left), b.width > 400]; });
    check("the help opens as a panel beside the sidebar", [panel[0] >= 268, panel[1]], [true, true]);
    await shell.keyboard.press("Escape");
    check("…and Escape closes it", await shell.evaluate(() => document.querySelector("#home-foot .home-more").open), false);
    await shell.setViewportSize({ width: 1200, height: 1000 }); await shell.waitForTimeout(300);

    console.log("9b. Home as a workspace, on a large monitor");
    await shell.setViewportSize({ width: 2560, height: 1400 }); await shell.waitForTimeout(400);
    const lay = await shell.evaluate(() => {
      const xs = (sel) => [...document.querySelectorAll(sel)].map((e) => Math.round(e.getBoundingClientRect().left));
      const tree = document.getElementById("folder-tree").getBoundingClientRect();
      const hear = document.getElementById("hearings").getBoundingClientRect();
      const cases = document.getElementById("case-folders").getBoundingClientRect();
      return {
        name: parseFloat(getComputedStyle(document.querySelector("#hearing-list .ci-case")).fontSize),
        // The name of a row done stands after its ✓.
        names: new Set([...document.querySelectorAll("#hearing-list .ci-case")].filter((e) => !e.previousElementSibling.classList.contains("ci-done-mark")).map((e) => Math.round(e.getBoundingClientRect().left))).size,
        nums: new Set(xs("#hearing-list .ci-num")).size,
        rightMargin: Math.round(window.innerWidth - hear.right),
        chips: new Set(xs("#hearing-list .ci-status-col")).size,
        sidebar: [Math.round(tree.left), Math.round(tree.top), Math.round(tree.height) >= 1300],
        beside: cases.left > hear.right && Math.abs(cases.top - hear.top) < 40,
      };
    });
    check("the case names read at 15px or more", lay.name >= 15, true);
    check("case numbers, names and the status each in one column", [lay.nums, lay.names, lay.chips], [1, 1, 1]);
    check("a margin left on the right", lay.rightMargin >= 64, true);
    check("the Folders list runs the window's height from its left edge", [lay.sidebar[0], lay.sidebar[2]], [0, true]);
    check("Case folders beside Hearings, where the screen has room", lay.beside, true);
    await shell.setViewportSize({ width: 1200, height: 1000 }); await shell.waitForTimeout(300);

    console.log("10. eCourt, and a case folder's buttons on its hearing's row");
    await pick(shell.locator("#hearing-list .hearing-row:nth-of-type(3)"));
    await shell.click("#hearing-list .hearing-row:nth-of-type(3) .ci-ecourt");
    check("eCourt opens the sheet's link", await shell.evaluate(() => window.__opened), ["https://civil.lacourt.org/ecourt/ecms/case?id=222"]);
    // The owner: a click on a case not downloaded "should let me try to locate the file".
    await shell.evaluate(async () => {
      const top = await navigator.storage.getDirectory();
      const papers = await (await top.getDirectoryHandle("Elsewhere", { create: true })).getDirectoryHandle("Globex papers", { create: true });
      const w = await (await papers.getFileHandle("MSJ.pdf", { create: true })).createWritable(); await w.write("%PDF msj"); await w.close();
      const acme = await (await top.getDirectoryHandle("Downloads")).getDirectoryHandle("25STCV12345 ACME");
      window.__picks = [acme, papers];
      window.showDirectoryPicker = async () => window.__picks.shift();
    });
    const doeLoc = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("24STCV00777 Doe v. Globex"))');
    await pick(doeLoc);
    await doeLoc.locator(".ht-open").click();
    await shell.waitForFunction(() => /is not 24STCV00777 Doe v\. Globex's folder/.test(document.getElementById("shell-toast").textContent), null, { timeout: 10000 });
    check("a click on it asks for its folder; one carrying another case's number is refused", await shell.textContent("#shell-toast"), "25STCV12345 ACME is not 24STCV00777 Doe v. Globex's folder: it carries 25STCV12345, not 24STCV00777.");
    check("…and eCourt is not opened by the click", await shell.evaluate(() => window.__opened.length), 1);
    await doeLoc.locator(".hearing-item").dblclick();
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.textContent.includes("24STCV00777") && r.textContent.includes("Globex papers")), null, { timeout: 10000 });
    check("the folder picked is that hearing's, whatever its name", [await doeLoc.locator(".ci-where").textContent(), await doeLoc.locator(".ci-status").textContent()], ["MSJ · Globex papers", "Not run yet"]);
    check("…its buttons under it, still selected", await doeLoc.locator(".hearing-tools .ci-done").count(), 1);
    // Prioritize is offered on a run going: one starts in ACME.
    const etaIn = (on) => shell.evaluate(async (on) => {
      const acme = await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads")).getDirectoryHandle("25STCV12345 ACME");
      if (on) { const w = await (await acme.getFileHandle("ETA ~6.04PM (1 of 2).txt", { create: true })).createWritable(); await w.close(); }
      else await acme.removeEntry("ETA ~6.04PM (1 of 2).txt");
      window.dispatchEvent(new Event("focus"));
    }, on);
    await pick(shell.locator("#hearing-list .hearing-row:nth-of-type(2)"));
    check("no Prioritize on a case whose run is not going", await shell.$$eval("#hearing-list .hearing-row:nth-of-type(2) .ci-line-add", (b) => b.length), 0);
    await etaIn(true);
    await shell.waitForSelector("#hearing-list .hearing-row:nth-of-type(2) .ci-line-add", { timeout: 10000 });
    await shell.click("#hearing-list .hearing-row:nth-of-type(2) .ci-line-add");
    await shell.waitForFunction(() => document.querySelector("#hearing-list .hearing-row:nth-of-type(2) .ci-place"), null, { timeout: 10000 });
    check("Prioritize on the hearing puts its folder first in line", await shell.textContent("#hearing-list .hearing-row:nth-of-type(2) .ci-place"), "1st");
    await etaIn(false);
    await shell.waitForFunction(() => /^Finished /.test(document.querySelector("#hearing-list .hearing-row:nth-of-type(2) .ci-status").textContent), null, { timeout: 10000 });
    check("…and it keeps its place once the run is no longer going", await shell.textContent("#hearing-list .hearing-row:nth-of-type(2) .ci-place"), "1st");
    check("…written into the folder", await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const f = await (await (await dl.getDirectoryHandle("25STCV12345 ACME")).getFileHandle("PDF-Linker Priority.json")).getFile();
      return JSON.parse(await f.text()).rank;
    }), 1);

    console.log("11. Show off calendar");
    check("the button counts them", await shell.textContent("#hearings-all"), "Show off calendar (1)");
    await shell.click("#hearings-all");
    await shell.waitForFunction(() => document.querySelectorAll("#hearing-list .hearing-item").length === 6, null, { timeout: 10000 });
    got = await rows();
    check("red says Off calendar", got.filter((r) => /Off/.test(r.status)).map((r) => r.status), ["Off calendar"]);
    check("…set apart", await shell.$$eval("#hearing-list .hearing-row.mark-off", (x) => x.length), 1);
    await shell.waitForFunction(() => document.querySelectorAll("#case-list .case-item").length === 1, null, { timeout: 10000 });
    check("the Case folders list unchanged", await caseNames(), ["Case Zeta"]);

    console.log("12. every folder on a hearing: no Case folders list");
    await shell.evaluate(async () => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      await dl.removeEntry("Case Zeta", { recursive: true });
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForFunction(() => document.getElementById("case-folders").hidden, null, { timeout: 10000 });
    check("the list is hidden", await shell.evaluate(() => document.getElementById("case-folders").hidden), true);

    console.log("13. a sticky note on every row: filled where the Date cell has a note");
    const doeRow = '#hearing-list .hearing-row:has(.ri-name:has-text("24STCV00777 Doe v. Globex"))';
    const doe = shell.locator(doeRow);
    check("every row has one", await shell.$$eval("#hearing-list .hearing-row", (rs) => rs.every((r) => r.querySelectorAll(".ci-note").length === 1)), true);
    check("filled only on Doe v. Globex", await shell.$$eval("#hearing-list .ci-note.has", (x) => x.map((n) => n.closest(".hearing-row").querySelector(".ri-name").textContent.includes("Doe v. Globex"))), [true]);
    const opened = (await shell.evaluate(() => window.__opened.length));
    await doe.locator(".ci-note").click();
    check("a click opens the note under the row, to read and change", await shell.evaluate(() => { const n = [...document.querySelectorAll(".hearing-note")].find((x) => !x.hidden); return n ? n.querySelector("textarea").value : null; }), "Check POS");
    check("…and opens nothing else", await shell.evaluate(() => window.__opened.length), opened);
    await doe.locator(".ci-note").click();
    check("a second click closes it", await shell.evaluate(() => [...document.querySelectorAll(".hearing-note")].every((x) => x.hidden)), true);
    // A note written on a row that has none, then taken off again.
    const bare = shell.locator('#hearing-list .hearing-row:not(.mark-off):has(.ci-note:not(.has))').first();
    const bareName = (await bare.locator(".ri-name").getAttribute("title"));
    const noteOf = async (name) => {
      const bytes = await shell.evaluate(async () => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle("Hearings.xlsx")).getFile()).arrayBuffer())]);
      const h = (await readHearings(new Uint8Array(bytes))).hearings.find((x) => x.caseName === name);
      return h ? [h.note, new Date(h.date).getDate()] : null;
    };
    const dayBefore = (await noteOf(bareName))[1];
    await bare.locator(".ci-note").click();
    await shell.locator(".hearing-note:not([hidden]) textarea").fill("Tentative posted");
    await shell.locator(".hearing-note:not([hidden]) .note-save").click();
    for (let k = 0; k < 100 && (await noteOf(bareName))[0] !== "Tentative posted"; k++) await new Promise((r) => setTimeout(r, 100));
    check("Save writes it into the sheet's Date cell, the date kept", await noteOf(bareName), ["Tentative posted", dayBefore]);
    await shell.waitForFunction((n) => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.querySelector(".ri-name").title === n && r.querySelector(".ci-note.has")), bareName, { timeout: 10000 });
    check("…and the note fills in", true, true);
    await shell.locator(`#hearing-list .hearing-row:has(.ci-note.has) .ri-name[title="${bareName}"]`).first().locator("xpath=ancestor::*[contains(@class,'hearing-row')]").locator(".ci-note").click();
    await shell.locator(".hearing-note:not([hidden]) .note-remove").click();
    for (let k = 0; k < 100 && (await noteOf(bareName))[0] !== ""; k++) await new Promise((r) => setTimeout(r, 100));
    check("Remove note takes it out, the date as it was", await noteOf(bareName), ["", dayBefore]);

    console.log("14. Off calendar and On calendar, written into the sheet");
    const sheetNow = async () => {
      const bytes = await shell.evaluate(async () => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle("Hearings.xlsx")).getFile()).arrayBuffer())]);
      return (await readHearings(new Uint8Array(bytes))).hearings.find((x) => x.caseName.startsWith("24STCV00777"));
    };
    await pick(doe);
    check("the row offers Off calendar", await doe.locator(".ci-cal").getAttribute("aria-label"), "Off calendar");
    await doe.locator(".ci-cal").click();
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.textContent.includes("24STCV00777") && r.querySelector(".ci-cal").getAttribute("aria-label") === "On calendar"), null, { timeout: 10000 });
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
    check("while Excel holds it: shown on calendar here, and said to be waiting", [await doe.locator(".ci-cal").getAttribute("aria-label"), await doe.locator(".ci-status.waiting").count() === 1], ["Off calendar", true]);
    check("…the sheet not yet changed", (await sheetNow()).mark, "off");
    await shell.evaluate(() => { FileSystemFileHandle.prototype.createWritable = window.__realWritable; window.dispatchEvent(new Event("focus")); });
    await shell.waitForFunction(() => !/waiting to be written/.test(document.getElementById("hearings-summary").textContent), null, { timeout: 10000 });
    check("once Excel lets go, the next look writes it: the red is off", (await sheetNow()).mark, "");

    console.log("14b. Done: a ✓ here, the Motion Type and Case Name cells green in the sheet");
    const vanceRow = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("22STCV05555 Vance v. Stark"))');
    const vanceNow = async () => {
      const bytes = await shell.evaluate(async () => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle("Hearings.xlsx")).getFile()).arrayBuffer())]);
      return (await readHearings(new Uint8Array(bytes))).hearings.find((x) => x.caseName.startsWith("22STCV05555"));
    };
    await pick(vanceRow);
    check("the row offers Done", await vanceRow.locator(".ci-done").getAttribute("aria-label"), "Done");
    await vanceRow.locator(".ci-done").click();
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.textContent.includes("22STCV05555") && r.querySelector(".ci-done-mark")), null, { timeout: 10000 });
    check("…a ✓ before its name, and it stays listed", [await vanceRow.locator(".ci-done-mark").count(), await vanceRow.locator(".ci-done").getAttribute("aria-pressed")], [1, "true"]);
    check("…the sheet's row reads as done", (await vanceNow()).mark, "done");
    check("…its Zip in Downloads pill gone: a done case says nothing of being downloaded", await vanceRow.locator(".ci-status").isVisible(), false);
    await vanceRow.locator(".ci-done").click();
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.textContent.includes("22STCV05555") && !r.querySelector(".ci-done-mark")), null, { timeout: 10000 });
    check("pressed again: not done, here and in the sheet", [await vanceRow.locator(".ci-done-mark").count(), (await vanceNow()).mark], [0, ""]);
    check("…and the pill back", await vanceRow.locator(".ci-status").textContent(), "Zip in Downloads");

    console.log("14c. the briefing E-Court Suite reports, on each hearing's row");
    const iso = (at) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
    const st = (state, note = "") => ({ due: inDays(-2), filed: state === "filed" || state === "late" ? inDays(-3) : null, state, note, manual: false });
    const putBriefing = (entries, refresh = null) => shell.evaluate(async ({ entries, refresh }) => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const w = await (await dl.getFileHandle("E-Court Briefing Status.json", { create: true })).createWritable();
      await w.write(JSON.stringify({ version: 1, written: Date.now(), refresh, entries })); await w.close();
      window.dispatchEvent(new Event("focus"));
    }, { entries, refresh });
    const acmeRowB = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("25STCV12345 ACME"))');
    const doeRowB = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("24STCV00777 Doe"))');
    const janeRowB = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("26STCV09999 Jane Doe"))');
    const chipsOf = (row) => row.locator(".ci-chip").evaluateAll((cs) => cs.map((c) => [c.textContent, c.className.replace("ci-chip st-", "")]));
    await putBriefing([
      { caseNumber: "25STCV12345", day: iso(inDays(2)), motionType: "Demurrer", key: "a", kind: "motion", motion: st("filed"), opp: st("filed"), reply: st("missing", "Not Filed"), at: Date.now() },
      { caseNumber: "24STCV00777", day: iso(inDays(2)), motionType: "MSJ", key: "b", kind: "motion", motion: st("filed"), opp: st("pending", "Not Posted Yet"), reply: null, at: Date.now() },
    ]);
    await shell.waitForFunction(() => document.querySelectorAll("#hearing-list .ci-chip").length >= 5, null, { timeout: 15000 });
    check("each hearing's Motion, Opposition and Reply, as the case page colours them", await chipsOf(acmeRowB), [["Mot ✓", "filed"], ["Opp ✓", "filed"], ["Rep ✗", "missing"]]);
    check("…an opposition not posted yet is unsure, not missing", await chipsOf(doeRowB), [["Mot ✓", "filed"], ["Opp ?", "unposted"]]);
    check("…a hearing the extension has not reported: a dash that says how to get it", [await janeRowB.locator(".ci-brief").textContent(), /open the case in eCourt/.test(await janeRowB.locator(".ci-brief").getAttribute("title"))], ["—", true]);
    await shell.setViewportSize({ width: 2560, height: 1400 }); await shell.waitForTimeout(300);
    check("…the briefing in one column down the list, whatever the status beside it", await shell.$$eval("#hearing-list .ci-brief", (bs) => new Set(bs.map((b) => Math.round(b.getBoundingClientRect().left))).size), 1);
    await shell.setViewportSize({ width: 1200, height: 1000 }); await shell.waitForTimeout(300);
    check("…and the summary counts the briefing not filed", /1 with briefing not filed/.test(await shell.textContent("#hearings-summary")), true);
    // The case page works the reply out again: it is in.
    await putBriefing([
      { caseNumber: "25STCV12345", day: iso(inDays(2)), motionType: "Demurrer", key: "a", kind: "motion", motion: st("filed"), opp: st("filed"), reply: st("filed"), at: Date.now() },
    ]);
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .ci-chip")].some((c) => c.textContent === "Rep ✓"), null, { timeout: 15000 });
    check("updated: the file written again, the row says so on the next look", await chipsOf(acmeRowB), [["Mot ✓", "filed"], ["Opp ✓", "filed"], ["Rep ✓", "filed"]]);
    check("…and the count goes", /briefing not filed/.test(await shell.textContent("#hearings-summary")), false);

    console.log("14d. the background refresh, and Refresh briefing");
    await putBriefing([
      { caseNumber: "25STCV12345", day: iso(inDays(2)), motionType: "Demurrer", key: "a", kind: "motion", motion: st("filed"), opp: st("filed"), reply: st("filed"), at: Date.now() },
    ], { at: Date.now(), state: "done", cases: 9, how: "hourly" });
    await shell.waitForFunction(() => /Briefing checked/.test(document.getElementById("hearings-summary").textContent), null, { timeout: 15000 });
    check("the summary says when E-Court Suite last checked", await shell.$eval("#hearings-summary .hs-refresh", (e) => [e.textContent.startsWith("Briefing checked "), /9 hearings on the next five court days/.test(e.title)]), [true, true]);
    await putBriefing([], { at: Date.now(), state: "failed", reason: "signin", how: "hourly" });
    await shell.waitForFunction(() => /sign-in needed/.test(document.getElementById("hearings-summary").textContent), null, { timeout: 15000 });
    check("…and when it could not: eCourt sign-in needed, as a warning", await shell.$eval("#hearings-summary .hs-refresh", (e) => [e.textContent, e.classList.contains("tone-warn")]), ["Briefing not checked: eCourt sign-in needed", true]);
    const before = await shell.evaluate(() => window.__opened.length);
    await shell.click("#briefing-refresh");
    check("Refresh briefing opens the eCourt page E-Court Suite answers", (await shell.evaluate(() => window.__opened)).slice(before), ["https://civil.lacourt.org/#lac-refresh-briefing"]);

    console.log("14e. a Claude workflow run for the case, from PDF+");
    const acmeC = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("25STCV12345 ACME"))');
    await pick(acmeC);
    check("in a browser there is no Claude button: no path to give", await shell.$$eval("#hearing-list .ci-claude", (b) => b.length), 0);
    // As PDF+'s bridge answers where a folder is.
    await shell.evaluate(() => {
      window.pdfplusNative = { folderPath: async (req) => { window.__asked = req; return "C:\\Users\\Clerk\\Downloads\\" + [...req.chain].join("\\"); } };
      window.dispatchEvent(new Event("focus"));
    });
    await shell.waitForFunction(() => document.querySelectorAll("#hearing-list .ci-claude").length > 0, null, { timeout: 15000 });
    const claudeOnAcme = await acmeC.locator(".ci-claude").getAttribute("aria-label");
    await pick(shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("22STCV05555"))'));
    const claudeOnVance = await shell.$$eval('#hearing-list .hearing-row', (rs) => rs.filter((r) => /22STCV05555/.test(r.textContent)).map((r) => !!r.querySelector(".ci-claude")));
    check("in PDF+, a Claude button on each hearing that carries its folder", [claudeOnAcme, claudeOnVance], ["Claude run", [false]]);
    await pick(acmeC);
    const opened0 = await shell.evaluate(() => window.__opened.length);
    await acmeC.locator(".ci-claude").click();
    await shell.waitForFunction((n) => window.__opened.length > n, opened0, { timeout: 10000 });
    const req = await shell.evaluate(async () => JSON.parse(await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads")).getFileHandle("Claude Run Request.json")).getFile()).text()));
    check("the request left in Downloads: the case, its hearing, the folder and its place", [req.version, req.caseNumber, req.motion, req.hearingDate === iso(inDays(2)), req.folderName, req.folderPath], [1, "25STCV12345", "Demurrer", true, "25STCV12345 ACME", "C:\\Users\\Clerk\\Downloads\\25STCV12345 ACME"]);
    check("…the place asked of PDF+ by the folder's own file", await shell.evaluate(() => [window.__asked.root, window.__asked.chain, typeof window.__asked.launcher.size]), ["Downloads", ["25STCV12345 ACME"], "number"]);
    check("claude.ai opened with the marker only, never the case", (await shell.evaluate(() => window.__opened)).slice(opened0), ["https://claude.ai/#cum-pdfplus-run"]);
    await shell.evaluate(() => { delete window.pdfplusNative; });

    console.log("14f. the calendar E-Court Suite read, written into the sheet, with Undo");
    const putCalendar = (calendar) => shell.evaluate(async (calendar) => {
      const dl = await (await navigator.storage.getDirectory()).getDirectoryHandle("Downloads");
      const w = await (await dl.getFileHandle("E-Court Briefing Status.json", { create: true })).createWritable();
      await w.write(JSON.stringify({ version: 1, written: Date.now(), refresh: null, entries: [], calendar })); await w.close();
      window.dispatchEvent(new Event("focus"));
    }, calendar);
    const sheetRows = async () => {
      const bytes = await shell.evaluate(async () => [...new Uint8Array(await (await (await (await navigator.storage.getDirectory()).getFileHandle("Hearings.xlsx")).getFile()).arrayBuffer())]);
      return (await readHearings(new Uint8Array(bytes))).hearings;
    };
    const NEWURL = "https://civil.lacourt.org/ecourt/ecms/case?id=777";
    await putCalendar({ at: Date.now(), windowDays: 10, days: [
      { day: iso(inDays(2)), state: "ok", rows: [
        { motion: "Demurrer", caseText: "25STCV12345 ACME HOLDINGS, LP vs TAYLOR ROE", caseId: "111", url: "https://civil.lacourt.org/ecourt/ecms/case?id=111" },
        { motion: "MSJ", caseText: "24STCV00777 Doe v. Globex", caseId: "222", url: "https://civil.lacourt.org/ecourt/ecms/case?id=222" }] },
      { day: iso(inDays(3)), state: "ok", rows: [
        { motion: "Motion to Compel", caseText: "26STCV09999 Jane Doe v. Initech", caseId: "333", url: "https://civil.lacourt.org/ecourt/ecms/case?id=333" },
        { motion: "Motion to Strike", caseText: "23STCV04444 Roe v. Umbrella", caseNumber: "23STCV04444" },
        { motion: "Motion to Quash Service of Summons", caseText: "26STCV07070 NEW v. ARRIVAL", caseId: "777", url: NEWURL }] },
      { day: iso(inDays(4)), state: "failed" },
      { day: iso(inDays(5)), state: "ok", rows: [] }],
      gone: [{ day: iso(inDays(5)), caseText: "22STCV05555 Vance v. Stark", caseNumber: "22STCV05555", reason: "off", status: "Not Held - Vacated by Court" }] });
    for (let k = 0; k < 150 && !(await sheetRows()).some((h) => h.caseName === "26STCV07070 NEW v. ARRIVAL"); k++) await new Promise((r) => setTimeout(r, 100));
    let rowsNow = await sheetRows();
    const added = rowsNow.find((h) => h.caseName === "26STCV07070 NEW v. ARRIVAL");
    check("the new hearing written into the sheet, on its day, linked to eCourt", added ? [iso(added.date), added.motion, added.url, added.mark] : null, [iso(inDays(3)), "Motion to Quash Service of Summons", NEWURL, ""]);
    check("the vacated one marked off calendar (red)", rowsNow.find((h) => h.caseName === "22STCV05555 Vance v. Stark").mark, "off");
    check("the rows already there left as they were", rowsNow.filter((h) => h.caseName !== "26STCV07070 NEW v. ARRIVAL").length, 7);
    await shell.waitForFunction(() => !document.getElementById("calendar-changes").hidden && document.querySelectorAll("#calendar-changes .cal-item").length >= 2, null, { timeout: 15000 });
    check("each change listed at the top of Hearings", await shell.$$eval("#calendar-changes .cal-item .cal-text", (x) => x.map((t) => t.textContent.replace(/,.*$/, "").replace(/ \(.*$/, "").replace(/:.*$/, ""))).then((l) => l.sort()), ["Added 26STCV07070 NEW v. ARRIVAL", "Off calendar " + new Date(inDays(5)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).split(",")[0]].sort());
    await shell.waitForFunction(() => [...document.querySelectorAll("#hearing-list .hearing-row")].some((r) => r.textContent.includes("NEW v. ARRIVAL")), null, { timeout: 15000 });
    check("…and the new hearing is on the list", true, true);
    check("a case folder still in Downloads is marked so", await acmeRowB.evaluate((r) => [r.classList.contains("in-downloads"), !!r.querySelector(".ci-dl-chip")]), [true, true]);
    check("…one not in Downloads is not", await janeRowB.evaluate((r) => r.classList.contains("in-downloads")), false);
    // Undo: the row taken back out, and not added again on the next look.
    await shell.locator("#calendar-changes .cal-item.k-added button", { hasText: "Undo" }).click();
    for (let k = 0; k < 100 && (await sheetRows()).some((h) => h.caseName === "26STCV07070 NEW v. ARRIVAL"); k++) await new Promise((r) => setTimeout(r, 100));
    check("Undo takes the added row out of the sheet", (await sheetRows()).some((h) => h.caseName === "26STCV07070 NEW v. ARRIVAL"), false);
    await shell.evaluate(() => window.dispatchEvent(new Event("focus")));
    await shell.waitForTimeout(1500);
    check("…and the next look does not add it again", (await sheetRows()).some((h) => h.caseName === "26STCV07070 NEW v. ARRIVAL"), false);
    check("…the list says it was undone", await shell.$$eval("#calendar-changes .cal-item.k-added.undone", (x) => x.length), 1);
    await shell.locator("#calendar-changes .cal-item.k-off button", { hasText: "Undo" }).click();
    for (let k = 0; k < 100 && (await sheetRows()).find((h) => h.caseName === "22STCV05555 Vance v. Stark").mark; k++) await new Promise((r) => setTimeout(r, 100));
    check("Undo of an off calendar takes the red off", (await sheetRows()).find((h) => h.caseName === "22STCV05555 Vance v. Stark").mark, "");
    await putCalendar(null);

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
    const acmeRow = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("25STCV12345 ACME HOLDINGS, LP vs TAYLOR ROE"))');
    check("a hearing that carries its folder can be dragged; one that has none cannot", await shell.$$eval("#hearing-list .hearing-row", (rs) => rs.filter((r) => /24STCV00777|22STCV05555/.test(r.textContent)).map((r) => r.draggable)), [true, false]);
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
    await pick(acmeRow);
    check("…with its status and its buttons", [/^Finished /.test(await acmeRow.locator(".ci-status").textContent()), await acmeRow.locator(".ci-line").count()], [true, 1]);
    check("…and the case folder shows in the list, closed", await shell.$$eval("#tree-list .tree-node.leaf .tree-name", (x) => x.map((e) => e.textContent)), ["25STCV12345 ACME"]);
    await shell.click("#move-bar .mb-cancel");

    console.log("15b. several folders at once, dropped from File Explorer");
    // A drop from the computer hands its folders as handles; the test hands
    // the same through a stand-in for the browser's DataTransfer.
    await shell.evaluate(async () => {
      const top = await navigator.storage.getDirectory();
      const mk = async (n) => { try { await top.removeEntry(n, { recursive: true }); } catch { /* none */ } return top.getDirectoryHandle(n, { create: true }); };
      const a = await mk("Judge A"), b = await mk("Judge B");
      const filed = await top.getDirectoryHandle("Filed");
      const file = await top.getFileHandle("Hearings.xlsx");
      const item = (h) => ({ kind: "file", getAsFileSystemHandle: async () => h });
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"], items: [item(a), item(b), item(filed), item(file)], files: [] } });
      document.getElementById("folder-tree").dispatchEvent(ev);
    });
    await shell.waitForFunction(() => document.querySelectorAll("#tree-list .tree-node.root").length === 4, null, { timeout: 10000 });
    check("each folder dropped is on the list, once", await shell.$$eval("#tree-list .tree-node.root .tree-name", (x) => x.map((e) => e.textContent)), ["Downloads", "Filed", "Judge A", "Judge B"]);
    check("…and it says so", await shell.textContent("#shell-toast"), "Added 2 folders: Judge A, Judge B. Filed was on the list already. 1 file left out (only folders go on the list).");
    check("…no tab opened for the file dropped with them", await shell.evaluate(() => document.querySelectorAll("iframe.tab-view").length), 0);

    console.log("16. a move refused while a run goes in the folder");
    await shell.evaluate(async () => {
      const top = await navigator.storage.getDirectory();
      const init = await (await top.getDirectoryHandle("Elsewhere")).getDirectoryHandle("Initech compel");
      const w = await (await init.getFileHandle("ETA ~6.04PM (1 of 3).txt", { create: true })).createWritable(); await w.close();
      window.dispatchEvent(new Event("focus"));
    });
    const initRow = shell.locator('#hearing-list .hearing-row:has(.ri-name:has-text("26STCV09999 Jane Doe v. Initech"))');
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
