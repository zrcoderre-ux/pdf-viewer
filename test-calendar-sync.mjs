// Tests for the hearings sheet kept up to date from eCourt's calendar
// (viewer/calendar-sync.js) and for notes written into the sheet
// (hearing-sheet.js, setHearingNote): what the calendar says the sheet lacks,
// where a day's rows go as the owner's paste lays them out (a date row of its
// own, the date in the first case, or in every case; the blank rows between),
// rows moved down under them with every reference, the eCourt link, Undo, and
// a note beside a date that keeps the date.
//
// Run: node test-calendar-sync.mjs   (from the repo root). Node only; every
// name and number is invented.

import { makeZip } from "./viewer/zip.js";
import { zipEntries, readEntry } from "./viewer/xlsx-read.js";
import { readHearings, setHearingNote, splitNoteLead, dateToSerial, serialToDate, parseBriefingFile } from "./viewer/hearing-sheet.js";
import { planCalendar, addCalendarRows, removeCalendarRow, sameCase, changeKey, shiftRef, shiftRows, shiftBlocker, sheetLayout, changeText, dayAt } from "./viewer/calendar-sync.js";

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
const NOW = new Date(2026, 10, 19, 10, 0).getTime(); // Thu Nov 19, 2026
const S = (y, m, d) => dateToSerial(day(y, m, d));

// ---- a workbook ----------------------------------------------------------------
const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/></patternFill></fill></fills>
<cellXfs count="5"><xf numFmtId="0" fillId="0"/><xf numFmtId="14" fillId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0"/>
<xf numFmtId="0" fontId="1" fillId="2"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1"/></cellXfs></styleSheet>`;
const t = (ref, text, s = 0) => `<c r="${ref}"${s ? ` s="${s}"` : ""} t="inlineStr"><is><t>${text}</t></is></c>`;
const n = (ref, v, s = 0) => `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${v}</v></c>`;
const e = (ref, s) => `<c r="${ref}" s="${s}"/>`;
async function book(rowsXml, { links = [], extra = "", rels = true } = {}) {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:D30"/><sheetViews><sheetView workbookViewId="0"><selection activeCell="C9" sqref="C9"/></sheetView></sheetViews><sheetData>${rowsXml}</sheetData>${extra}${links.length ? `<hyperlinks>${links.map(([ref, id]) => `<hyperlink ref="${ref}" r:id="${id}"/>`).join("")}</hyperlinks>` : ""}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  const parts = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Hearings" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ];
  if (rels) parts.push({ name: "xl/worksheets/_rels/sheet1.xml.rels", data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map(([, id, url]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${url.replace(/&/g, "&amp;")}" TargetMode="External"/>`).join("")}</Relationships>` });
  const z = await makeZip(parts);
  return z instanceof Uint8Array ? z : new Uint8Array(await z.arrayBuffer());
}
async function part(bytes, name) { if (bytes && typeof bytes.arrayBuffer === "function" && !(bytes instanceof Uint8Array)) bytes = new Uint8Array(await bytes.arrayBuffer()); const en = zipEntries(bytes).find((x) => x.name === name); return en ? readEntry(bytes, en) : null; }
const header = `<row r="1">${t("A1", "Date")}${t("B1", "Motion Type")}${t("C1", "Case Name")}${t("D1", "Date Submitted")}</row>`;
const URL = (id) => `https://civil.lacourt.org/ecourt/ecms/case?id=${id}`;

// Layout "heading": a date row, then each case with a blank row after it.
const headingRows = header
  + `<row r="2" ht="30" customHeight="1">${n("A2", S(2026, 11, 20), 1)}</row>`
  + `<row r="3" ht="28" customHeight="1">${e("A3", 2)}${t("B3", "Demurrer", 2)}${t("C3", "25STCV00001 ACME v. GLOBEX", 3)}${e("D3", 2)}</row>`
  + `<row r="4">${e("B4", 4)}</row>`
  + `<row r="5" ht="28" customHeight="1">${e("A5", 2)}${t("B5", "Motion to Compel", 2)}${t("C5", "25STCV00002 DOE v. ROE", 2)}${e("D5", 2)}</row>`
  + `<row r="6">${e("B6", 4)}</row>`
  + `<row r="7"/>`
  + `<row r="8" ht="30" customHeight="1">${n("A8", S(2026, 11, 23), 1)}</row>`
  + `<row r="9" ht="28" customHeight="1">${e("A9", 2)}${t("B9", "MSJ", 2)}${t("C9", "24STCV00003 ROE v. INITECH", 2)}${e("D9", 2)}</row>`
  + `<row r="10">${e("B10", 4)}</row>`
  + `<row r="11">${e("A11", 2)}${e("B11", 2)}</row>` + `<row r="12">${e("A12", 2)}</row>`;
const headingLinks = [["C3", "rId1", URL(11)], ["C5", "rId2", URL(12)], ["C9", "rId3", URL(13)]];

console.log("1. one case, as the calendar and the sheet each say it");
check("by eCourt id", sameCase({ caseName: "anything", url: URL(5), caseNumber: "" }, { caseText: "else", caseId: "5" }), true);
check("different ids", sameCase({ caseName: "25STCV00001 X", url: URL(5) }, { caseText: "25STCV00001 X", caseId: "6" }), false);
check("by case number", sameCase({ caseName: "25STCV00001 ACME", caseNumber: "25STCV00001" }, { caseText: "25STCV00001 Acme Corp v. Globex" }), true);
check("by name alone", sameCase({ caseName: "Jane Doe v. Initech Corp.", caseNumber: "" }, { caseText: "JANE DOE vs INITECH CORP" }), true);
check("names that only share one word", sameCase({ caseName: "Doe v. Initech", caseNumber: "" }, { caseText: "Doe v. Globex" }), false);
check("the key", changeKey("2026-11-20", { caseText: "x", caseId: "77" }), "2026-11-20|id:77");

console.log("2. the plan");
let { hearings } = await readHearings(await book(headingRows, { links: headingLinks }), NOW);
check("the sheet as read", hearings.map((h) => [h.row, new Date(h.date).getDate(), h.caseNumber]), [[3, 20, "25STCV00001"], [5, 20, "25STCV00002"], [9, 23, "24STCV00003"]]);
const cal = {
  days: [
    { day: "2026-11-18", state: "ok", rows: [{ caseText: "Old v. Past", motion: "MSJ" }] },
    { day: "2026-11-20", state: "ok", rows: [
      { motion: "Demurrer", caseText: "25STCV00001 ACME v. GLOBEX", caseId: "11", url: URL(11) },
      { motion: "Motion to Strike", caseText: "25STCV00009 NEW v. CASE", caseId: "19", url: URL(19) }] },
    { day: "2026-11-23", state: "ok", rows: [] },
    { day: "2026-11-24", state: "failed" },
    { day: "2026-11-25", state: "ok", rows: [{ motion: "Demurrer", caseText: "25STCV00010 LATER v. DAY", caseId: "20", url: URL(20) }] },
  ],
  gone: [{ day: "2026-11-20", caseId: "12", caseText: "25STCV00002 DOE v. ROE", reason: "moved", status: "Not Held - Continued - Court's Motion", newDay: "2026-12-18" }],
};
let plan = planCalendar({ hearings, calendar: cal, now: NOW });
check("adds: the new case on the 20th, and the 25th", plan.adds.map((a) => [a.day, a.caseText]), [["2026-11-20", "25STCV00009 NEW v. CASE"], ["2026-11-25", "25STCV00010 LATER v. DAY"]]);
check("off: the continued one", plan.offs.map((o) => [o.day, o.hg.caseNumber, o.reason, o.newDay]), [["2026-11-20", "25STCV00002", "moved", "2026-12-18"]]);
check("held: gone from the 23rd with no word why", plan.held.map((o) => [o.day, o.hg.caseNumber, o.reason]), [["2026-11-23", "24STCV00003", "unknown"]]);
check("the days looked at: from today, read", plan.days, ["2026-11-20", "2026-11-23", "2026-11-25"]);
plan = planCalendar({ hearings, calendar: cal, now: NOW, log: [{ key: "2026-11-20|id:19", kind: "added" }, { key: "2026-11-20|id:12", kind: "off" }, { key: "2026-11-23|id:13", kind: "kept" }] });
check("nothing done twice: added, marked off, kept", [plan.adds.length, plan.offs.length, plan.held.length], [1, 0, 0]);
check("a marked row is left alone", planCalendar({ hearings: hearings.map((h) => (h.row === 9 ? { ...h, mark: "done" } : h)), calendar: cal, now: NOW }).held.length, 0);
check("no calendar, no plan", planCalendar({ hearings, calendar: null }).adds.length, 0);
check("the file's calendar passes through", parseBriefingFile(JSON.stringify({ entries: [], calendar: cal })).calendar.days.length, 5);

console.log("3. the layout read off the sheet");
let bytes = await book(headingRows, { links: headingLinks });
let xml = await part(bytes, "xl/worksheets/sheet1.xml");
const { parseSheetCells } = await import("./viewer/hearing-sheet.js");
let lay = sheetLayout(hearings, parseSheetCells(xml, [], new Map()).cells, "Hearings");
check("a date row, one blank between cases and two between days", [lay.mode, lay.gapWithin, lay.gapBetween], ["heading", 1, 2]);
check("the rows to copy", lay.tpl, { hearing: 9, heading: 8, blank: 10 });

console.log("4. references moved");
check("a cell below", shiftRef("C12", 10, 3), "C15");
check("a cell above", shiftRef("C9", 10, 3), "C9");
check("a range across", shiftRef("A2:D12", 10, 3), "A2:D15");
check("absolute", shiftRef("$A$12", 10, 1), "$A$13");
check("whole columns", shiftRef("A:D", 10, 1), "A:D");
check("the row taken out", shiftRef("C10", 10, -1), null);
check("a range losing a row", shiftRef("A10:D12", 10, -1), "A10:D11");
check("a formula below blocks", shiftBlocker(`<sheetData><row r="12"><c r="A12"><f>SUM(B1:B3)</f></c></row></sheetData>`, 10), "the sheet has formulas below");
check("a HYPERLINK formula does not", shiftBlocker(`<sheetData><row r="12"><c r="A12"><f>HYPERLINK("https://x?id=1","Doe")</f></c></row></sheetData>`, 10), "");
check("a table blocks", shiftBlocker(`<sheetData/><tableParts count="1"><tablePart r:id="rId9"/></tableParts>`, 10), "the sheet holds an Excel table");
const moved = shiftRows(`<worksheet><dimension ref="A1:D12"/><sheetData><row r="9"><c r="C9"/></row><row r="10" ht="5"><c r="C10"/></row></sheetData><mergeCells count="1"><mergeCell ref="A10:B10"/></mergeCells><hyperlinks><hyperlink ref="C10" r:id="rId1"/></hyperlinks></worksheet>`, 10, 2);
check("rows, cells, merges, links and the dimension", moved, `<worksheet><dimension ref="A1:D14"/><sheetData><row r="9"><c r="C9"/></row><row r="12" ht="5"><c r="C12"/></row></sheetData><mergeCells count="1"><mergeCell ref="A12:B12"/></mergeCells><hyperlinks><hyperlink ref="C12" r:id="rId1"/></hyperlinks></worksheet>`);

console.log("5. a new day at the end, laid out as the last one");
let res = await addCalendarRows(bytes, [planCalendar({ hearings, calendar: cal, now: NOW }).adds[1]], NOW);
check("placed, nothing refused", [res.placed.map((p) => p.row), res.refused], [[13], []]);
let after = await readHearings(res.bytes, NOW);
check("read back: the 25th, with its link", after.hearings.filter((h) => h.date === day(2026, 11, 25)).map((h) => [h.row, h.motion, h.caseName, h.url, h.mark]), [[13, "Demurrer", "25STCV00010 LATER v. DAY", URL(20), ""]]);
xml = await part(res.bytes, "xl/worksheets/sheet1.xml");
check("two blank rows (the blank's look), the date row (a date), the case", [/<row r="10"><c r="B10" s="4"\/><\/row><row r="11"><c r="B11" s="4"\/><\/row>/.test(xml), /<row r="12" ht="30" customHeight="1"><c r="A12" s="1"><v>46351<\/v><\/c><\/row>/.test(xml), /<row r="13" ht="28" customHeight="1"><c r="A13" s="2"\/><c r="B13" s="2" t="inlineStr"><is><t xml:space="preserve">Demurrer<\/t><\/is><\/c>/.test(xml)], [true, true, true]);
check("the empty styled rows at the end were taken over, not pushed down", !/<row r="1[4-9]"/.test(xml) && (xml.match(/<row r="1[0-3]"/g) || []).length, 4);
check("the link's rel added beside the old ones", ((await part(res.bytes, "xl/worksheets/_rels/sheet1.xml.rels")).match(/<Relationship /g) || []).length, 4);
check("the old rows untouched", after.hearings.filter((h) => h.date !== day(2026, 11, 25)).map((h) => [h.row, h.caseName]), hearings.map((h) => [h.row, h.caseName]));
check("the dimension reaches it", /<dimension ref="A1:D30"\/>/.test(xml), true);

console.log("6. a case added to a day already in the sheet, rows below moved down");
res = await addCalendarRows(bytes, [planCalendar({ hearings, calendar: cal, now: NOW }).adds[0]], NOW);
after = await readHearings(res.bytes, NOW);
check("after the 20th's last case, a blank row first", after.hearings.map((h) => [h.row, new Date(h.date).getDate(), h.caseNumber]), [[3, 20, "25STCV00001"], [5, 20, "25STCV00002"], [7, 20, "25STCV00009"], [11, 23, "24STCV00003"]]);
check("the links below moved with their rows", after.hearings.map((h) => h.url), [URL(11), URL(12), URL(19), URL(13)]);
xml = await part(res.bytes, "xl/worksheets/sheet1.xml");
check("the selection moved too", /activeCell="C11" sqref="C11"/.test(xml), true);
check("the new case's cell copies an unmarked case's look (not the green one)", /<c r="C7" s="2" t="inlineStr">/.test(xml), true);

console.log("7. a new day between two");
res = await addCalendarRows(bytes, [{ key: "k", day: "2026-11-21", motion: "Demurrer", caseText: "26STCV00030 BETWEEN v. DAYS", url: URL(30) }], NOW);
after = await readHearings(res.bytes, NOW);
check("before the 23rd's date row, with its own and the gap after", after.hearings.map((h) => [h.row, new Date(h.date).getDate()]), [[3, 20], [5, 20], [9, 21], [13, 23]]);

console.log("8. Undo of an add");
res = await addCalendarRows(bytes, planCalendar({ hearings, calendar: cal, now: NOW }).adds, NOW);
let undone = await removeCalendarRow(res.bytes, res.placed[0], NOW);
after = await readHearings(undone, NOW);
check("the 20th's added case gone, the blank above it too", after.hearings.map((h) => [h.row, h.caseNumber]), [[3, "25STCV00001"], [5, "25STCV00002"], [9, "24STCV00003"], [13, "25STCV00010"]]);
undone = await removeCalendarRow(undone, { ...res.placed[1], row: 13 }, NOW);
after = await readHearings(undone, NOW);
check("a whole added day gone with its date row", after.hearings.map((h) => h.row), [3, 5, 9]);
xml = await part(undone, "xl/worksheets/sheet1.xml");
check("…and no row left past the old end", !/<row r="1[3-9]"/.test(xml), true);
let missing = "";
try { await removeCalendarRow(bytes, { sheet: "Hearings", caseName: "Nobody", date: day(2026, 11, 20), row: 3 }, NOW); } catch (x) { missing = x.message; }
check("a row no longer there", missing, "the row for Nobody is no longer in the sheet");

console.log("9. the date in the first case's cell, and in every case's");
const firstRows = header
  + `<row r="2">${n("A2", S(2026, 11, 20), 1)}${t("B2", "Demurrer")}${t("C2", "25STCV00001 ACME v. GLOBEX")}</row><row r="3"/>`
  + `<row r="4">${t("B4", "MSJ")}${t("C4", "25STCV00002 DOE v. ROE")}</row><row r="5"/>`;
const firstBook = await book(firstRows);
hearings = (await readHearings(firstBook, NOW)).hearings;
res = await addCalendarRows(firstBook, [
  { key: "a", day: "2026-11-23", motion: "Demurrer", caseText: "26STCV00040 ONE v. TWO", url: URL(40) },
  { key: "b", day: "2026-11-23", motion: "MSJ", caseText: "26STCV00041 THREE v. FOUR", url: "" }], NOW);
after = await readHearings(res.bytes, NOW);
check("first: the date only on the day's first case", after.hearings.map((h) => [h.row, new Date(h.date).getDate(), h.url]), [[2, 20, ""], [4, 20, ""], [6, 23, URL(40)], [8, 23, ""]]);
xml = await part(res.bytes, "xl/worksheets/sheet1.xml");
check("…the second case's Date cell left empty", /<c r="A8"/.test(xml), false);
check("a sheet with no rels part gets one", !!(await part(res.bytes, "xl/worksheets/_rels/sheet1.xml.rels")), true);
const everyRows = header
  + `<row r="2">${n("A2", S(2026, 11, 20), 1)}${t("B2", "Demurrer")}${t("C2", "25STCV00001 ACME")}</row>`
  + `<row r="3">${n("A3", S(2026, 11, 20), 1)}${t("B3", "MSJ")}${t("C3", "25STCV00002 DOE")}</row>`;
const everyBook = await book(everyRows);
res = await addCalendarRows(everyBook, [{ key: "a", day: "2026-11-20", motion: "Demurrer", caseText: "26STCV00050 X v. Y" }], NOW);
xml = await part(res.bytes, "xl/worksheets/sheet1.xml");
check("every: no blank rows, and the date in the new case's cell", [/<row r="4">/.test(xml), /<c r="A4" s="1"><v>46346<\/v>/.test(xml)], [true, true]);
const noDates = await book(header + `<row r="2">${t("B2", "MSJ")}${t("C2", "25STCV00002 DOE")}</row>`);
res = await addCalendarRows(noDates, [{ key: "a", day: "2026-11-20", motion: "Demurrer", caseText: "X" }], NOW);
check("a sheet with no dated case refuses, saying why", res.refused.map((r) => r.why), ["the sheet has no dated hearing to copy the layout from"]);
const formulaBelow = await book(headingRows.replace(`<row r="12">${e("A12", 2)}</row>`, `<row r="12"><c r="A12"><f>COUNTA(C1:C11)</f><v>3</v></c></row>`), { links: headingLinks });
res = await addCalendarRows(formulaBelow, [{ key: "a", day: "2026-11-20", motion: "X", caseText: "26STCV00060 P v. Q" }], NOW);
check("rows that would move a formula are refused", res.refused.map((r) => r.why), ["the sheet has formulas below, so rows cannot be put in above it"]);
check("…and the workbook is the one given", res.bytes === formulaBelow, true);

console.log("10. notes, written in the Date cell");
check("a note beside a date", splitNoteLead("11/20/2026 · Check POS"), { date: "11/20/2026", note: "Check POS" });
check("the owner's own words read as before", splitNoteLead("12/1 asked to continue"), null);
const noted = await setHearingNote(firstBook, (await readHearings(firstBook, NOW)).hearings[0], "Check POS");
after = await readHearings(noted, NOW);
check("on the row holding the date: the date kept, the rows below keep it", after.hearings.map((h) => [h.row, new Date(h.date).getDate(), h.note]), [[2, 20, "Check POS"], [4, 20, ""]]);
const noted2 = await setHearingNote(noted, after.hearings[1], "Tentative posted");
after = await readHearings(noted2, NOW);
check("on a row under the date: the note alone", after.hearings.map((h) => [h.row, new Date(h.date).getDate(), h.note]), [[2, 20, "Check POS"], [4, 20, "Tentative posted"]]);
const cleared = await setHearingNote(noted2, after.hearings[0], "");
xml = await part(cleared, "xl/worksheets/sheet1.xml");
check("taken off: the date a date again, in its date style", /<c r="A2" s="1"><v>46346<\/v><\/c>/.test(xml), true);
const cleared2 = await setHearingNote(cleared, (await readHearings(cleared, NOW)).hearings[1], "");
check("taken off a row under the date: the cell empty", (await readHearings(cleared2, NOW)).hearings.map((h) => h.note), ["", ""]);
check("and edited", (await readHearings(await setHearingNote(noted, (await readHearings(noted, NOW)).hearings[0], "Check the POS again"), NOW)).hearings[0].note, "Check the POS again");

console.log("11. the words of a change");
check("added", changeText({ kind: "added", day: "2026-11-25", caseText: "26STCV00010 LATER v. DAY" }).text, "Added 26STCV00010 LATER v. DAY, Wed, Nov 25");
check("off, continued", changeText({ kind: "off", day: "2026-11-20", caseText: "DOE v. ROE", reason: "moved", newDay: "2026-12-18" }).text, "Off calendar Fri, Nov 20: DOE v. ROE (continued to Fri, Dec 18)");
check("held", changeText({ kind: "held", day: "2026-11-23", caseText: "ROE v. INITECH" }).text, "Check ROE v. INITECH, Mon, Nov 23: not on that day's agenda");
check("dayAt", dayAt("2026-11-20"), day(2026, 11, 20));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
