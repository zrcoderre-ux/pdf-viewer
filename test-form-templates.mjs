// Node-runnable tests for court forms read against PDF-Linker's blanks
// (viewer/form-templates.js, the data in viewer/form-templates/ that
// build-form-templates.mjs makes).
// Run: node test-form-templates.mjs   (from the repo root)
//
// Every name and number below is invented; the form ids, their revisions and
// the blanks' printed words are the public forms'.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as FT from "./viewer/form-templates.js";
import { pdfRows, pdfFace } from "./viewer/pdfsync.js";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(REPO, "viewer", "form-templates");
const SIBLING = path.join(REPO, "..", "PDF-Linker", "Form Templates");

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
const readJson = async (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), "utf8"));
const library = () => FT.templateLibrary(readJson);
const index = JSON.parse(fs.readFileSync(path.join(DATA, "index.json"), "utf8"));
const files = Object.values(index.keys).flat().filter((v, i, a) => a.indexOf(v) === i).sort();
const pageOf = async (file, n) => FT.prepareFile(await readJson(file), file).pages.find((p) => p.n === n);

console.log("form ids folded as a scan reads them (pdf_linker.py, _template_form_key)");
check("a digit read in the letters, a letter in the number", FT.formKey("P0S-O40(P)"), FT.formKey("POS-040(P)"));
check("…and that key", FT.formKey("POS-040(P)"), "pos040p");
check("the l a scan reads for the I of PLD-PI-001", FT.formKey("PLD-Pl-001(2)"), FT.formKey("PLD-PI-001(2)"));
check("the EX suffix a run of its own: a misread 5 still folds", FT.formKey("MC-3S0EX"), "mc350ex");
check("every Los Angeles local prefix one form", [FT.formKey("LASC CIV 109"), FT.formKey("SCLAC CIV 109"), FT.formKey("LACIV 109")], ["iascciv109", "iascciv109", "iascciv109"]);
check("one letter of the prefix misread is near; another number is not", [FT.keyNear("mg050", "mc050"), FT.keyNear("mc051", "mc050"), FT.keyNear("civ10", "cvv10")], [true, false, false]);

console.log("the footer's own id and revision");
check("the id the footer prints bare, not the one it names in prose", FT.footerFormId("Instead of Form MC-350\nMC-350EX [Rev. January 1, 2021]"), "MC-350EX");
check("an id inside a URL is no id", FT.footerFormId("see https://example.test/forms/ERR-354.pdf"), "");
check("a revision folded", FT.revisionOf("CIV-110 [Rev. January 1, 2025]"), "january12025");
check("…a local form's, as pdf.js spaces it", FT.revisionOf("SCLAC CIV 109 Rev. 0 4 /2 6 CIVIL CASE COVER SHEET"), "0426");
check("the footer read bottom up: instructions naming forms above it do not win", FT.pageFormKeys("PLD-050 [Rev. January 1, 2024]\n(such as form POS-020, POS-030, or POS-040)")[0], "pid050");

console.log("the data");
check("every blank in the index has a file and at least one page", files.every((f) => fs.existsSync(path.join(DATA, f))), true);
{
  const pages = [];
  for (const f of files) pages.push(...FT.prepareFile(await readJson(f), f).pages);
  check("106 template pages, as PDF-Linker indexes the committed blanks", pages.length, 106);
  check("every page names its form and has label words to fit on", pages.filter((p) => !p.form || p.words.length < FT.MIN_MATCHED).map((p) => `${p.file}#${p.n}`), []);
  // Each blank, its own items handed in as a page's, is recognised as ITSELF
  // and no other page: what a born-digital copy of the form would read as.
  const lib = library();
  const wrong = [];
  for (const p of pages) {
    const got = await FT.recognise(lib, p.items.map((it) => ({ ...it, font: "x" })), { w: p.width, h: p.height });
    if (!got || got.tpl.file !== p.file || got.tpl.n !== p.n) wrong.push(`${p.file}#${p.n} → ${got ? `${got.tpl.file}#${got.tpl.n}` : "none"}`);
    else if (Math.abs(got.fit.sx - 1) > 0.01 || Math.abs(got.fit.sy - 1) > 0.01 || Math.abs(got.fit.tx) > 2 || Math.abs(got.fit.ty) > 2) wrong.push(`${p.file}#${p.n} fit ${JSON.stringify(got.fit)}`);
  }
  check("every template page is recognised as itself, at the identity fit", wrong, []);
  // The faces it names are faces the reader draws in (pdfsync.pdfFace).
  const faceless = new Set();
  for (const f of files) for (const [name, generic] of (await readJson(f)).faces) if (!pdfFace(name, generic) && !/symbol|zapf|dingbat/i.test(name)) faceless.add(name);
  check("every font a blank sets its text in is a face the reader can draw", [...faceless], []);
}

// ── a scan of a filled CIV-110 ──────────────────────────────────────────────
// The blank's items as an OCR layer reads a scan of it: a word to an item, the
// page shrunk 3% and moved, every size rounded to a whole point and the label
// beside a value set in the value's (a recogniser sizes a line's words alike),
// one label word in eight misread, in an invisible font — and typed values in
// the attorney's name field and the case number field.
const civ = await pageOf("CIV-110 Request for Dismissal.json", 1);
const FIT = { sx: 0.97, sy: 0.97, tx: 11.5, ty: 18.5 };
const MISREAD = { ATTORNEY: "ATTORNFY", NUMBER: "NUMBFR:", Dismissal: "Dismlssal", WITHOUT: "WlTHOUT", court: "courf" };
function scanOf(tpl, { fit = FIT, values = [], drop = () => false } = {}) {
  const out = [];
  let n = 0;
  for (const it of tpl.items) {
    if (drop(it)) continue;
    for (const m of String(it.str).matchAll(/\S+/g)) {
      const w = it.w * m[0].length / Math.max(1, it.str.length), x = it.x + it.w * m.index / Math.max(1, it.str.length);
      let str = m[0];
      if (MISREAD[str.replace(/[^A-Za-z]/g, "")] && n++ % 2 === 0) str = MISREAD[str.replace(/[^A-Za-z]/g, "")];
      const h = Math.round(it.h * fit.sy);
      out.push({ str, x: fit.sx * x + fit.tx, top: fit.sy * (it.top + it.h) + fit.ty - h, w: fit.sx * w, h, font: "ocr" });
    }
  }
  for (const v of values) out.push({ ...v, font: "ocr" });
  return out;
}
console.log("a scan of a filled CIV-110");
{
  // The attorney's name field: the widest field on NAME:'s row.
  const nameLabel = civ.items.find((it) => it.str === "NAME:");
  const nameField = civ.fields.filter((f) => f.box[1] <= nameLabel.top + nameLabel.h && f.box[3] >= nameLabel.top).sort((a, b) => (b.box[2] - b.box[0]) - (a.box[2] - a.box[0]))[0];
  const caseLabel = civ.items.find((it) => it.str === "CASE NUMBER:");
  const caseField = civ.fields.filter((f) => f.box[1] >= caseLabel.top - 2 && f.box[1] <= caseLabel.top + 30 && f.box[0] >= caseLabel.x - 5).sort((a, b) => a.box[1] - b.box[1])[0];
  check("the blank names the size its name field sets a value in", [!!nameField, nameField && nameField.size, !!caseField], [true, 9, true]);
  const valueAt = (f, str) => {
    const [x0, , , y1] = FT.mapBox(f.box, FIT);
    const h = 8; // the OCR's size for it, not the field's
    return { str, x: x0 + 3, top: y1 - 3 - h, w: str.length * 4.4, h };
  };
  const scan = scanOf(civ, { values: [valueAt(nameField, "Dana Q. Ellery"), valueAt(caseField, "24STCV01234")] });
  const got = await FT.recognise(library(), scan, { w: 612, h: 792 });
  check("recognised as CIV-110 page 1", got && [got.tpl.form, got.tpl.n], ["CIV-110", 1]);
  check("…at the scan's own fit, to a point", got && [Math.abs(got.fit.sx - FIT.sx) < 0.005, Math.abs(got.fit.sy - FIT.sy) < 0.005, Math.abs(got.fit.tx - FIT.tx) < 1, Math.abs(got.fit.ty - FIT.ty) < 1], [true, true, true, true]);
  const typed = FT.formItems(got.tpl, got.fit, scan, (k) => `tpl#${k}`);
  const faces = got.tpl.faces;
  const faceOf = (it) => (it.font && it.font.startsWith("tpl#") ? faces[+it.font.slice(4)][0] : it.font);
  const heading = typed.find((it) => it.str === "REQUEST FOR DISMISSAL");
  check("the heading is the blank's: 9-point Arial bold, where the scan has it", heading && [Math.round(heading.h / FIT.sy * 10) / 10, faceOf(heading), Math.round(heading.x - (FIT.sx * civ.items.find((i) => i.str === "REQUEST FOR DISMISSAL").x + FIT.tx))], [9, "Arial-BoldMT", 0]);
  const label = typed.find((it) => it.str === "NAME:");
  check("a 6-point label is 6-point Arial, not the 8 the OCR gave its line", label && [Math.round(label.h / FIT.sy * 10) / 10, faceOf(label)], [6, "ArialMT"]);
  check("no misread label word is left standing beside the blank's", typed.filter((it) => Object.values(MISREAD).some((m) => it.str.includes(m))).map((it) => it.str), []);
  const value = typed.find((it) => it.str === "Dana Q. Ellery");
  check("the typed value kept, one run, at its field's 9-point Arial on its own baseline", value && [Math.round(value.h / FIT.sy * 10) / 10, faceOf(value), Math.round((value.top + value.h) * 10) / 10],
    [9, "ArialMT", Math.round((valueAt(nameField, "").top + 8) * 10) / 10]);
  check("…and the case number", typed.some((it) => it.str === "24STCV01234"), true);
  // A court's e-filing stamp set over the scan in a face of its own, in the
  // name field and over a label: the page's own type, passed through as it is.
  const stamp = [{ ...valueAt(nameField, "Electronically FILED"), font: "Helvetica", x: FT.mapBox(nameField.box, FIT)[0] + 100, h: 7 },
    { ...scan.find((it) => it.str === "NAME:"), str: "NAME:", font: "Helvetica", h: 7 }];
  const stamped = FT.formItems(got.tpl, got.fit, [...scan, ...stamp], (k) => `tpl#${k}`, { isOcr: (it) => it.font === "ocr" });
  check("a stamp set in a face of its own over the scan passes through untouched, in a field or over a label",
    stamp.map((st) => stamped.some((it) => it.str === st.str && it.font === "Helvetica" && it.h === 7 && it.x === st.x && it.top === st.top)), [true, true]);
  // The rows the reader groups them into are the form's rows: the label's row
  // as tall as the form's type, not the OCR's.
  const rows = pdfRows(typed, { w: 612, h: 792 });
  const row = rows.find((r) => r.items.some((it) => it.str === "REQUEST FOR DISMISSAL"));
  check("the heading's row is the blank's 9 points tall", row && Math.round(row.height / FIT.sy), 9);
}

console.log("what is not this form");
{
  // A declaration whose footer carries a form id, and prose: refused, in a
  // fraction of the time a fit takes.
  const prose = [];
  for (let k = 0; k < 30; k++) prose.push({ str: `Declarant Quillon Brakesman states the matter number ${k} is pending before the court.`, x: 72, top: 100 + k * 20, w: 420, h: 12, font: "ocr" });
  prose.push({ str: "POS-010", x: 36, top: 760, w: 30, h: 6, font: "ocr" });
  check("a page naming POS-010 in its footer but printing none of it is not POS-010", await FT.recognise(library(), prose, { w: 612, h: 792 }), null);
  // Another form's scan: CIV-110's words under SUM-100's id.
  const sum = scanOf(civ, { drop: (it) => /CIV-110/.test(it.str) });
  sum.push({ str: "SUM-100", x: 36, top: 760, w: 30, h: 6, font: "ocr" });
  check("CIV-110's page footed SUM-100 is neither", await FT.recognise(library(), sum, { w: 612, h: 792 }), null);
  // A revision the footer plainly reads otherwise is another layout.
  const old = scanOf(civ).map((it) => (it.str === "2025]" ? { ...it, str: "2009]" } : it.str === "January" ? { ...it, str: "July" } : it));
  check("a footer reading another revision is refused", await FT.recognise(library(), old, { w: 612, h: 792 }), null);
}

console.log("a form's next page, its id lost to the scan");
{
  const p1 = await pageOf("POS-040 Proof of Service - Civil.json", 1);
  const p2 = await pageOf("POS-040 Proof of Service - Civil.json", 2);
  const lib = library();
  const first = await FT.recognise(lib, scanOf(p1), { w: 612, h: 792 });
  check("page 1 recognised", first && [first.tpl.form, first.tpl.n], ["POS-040", 1]);
  const noId = scanOf(p2, { drop: (it) => /POS-040/.test(it.str) });
  check("page 2 with no id it can read is not recognised alone", await FT.recognise(lib, noId, { w: 612, h: 792 }), null);
  const second = await FT.recognise(lib, noId, { w: 612, h: 792 }, { seq: first });
  check("…but is, after page 1, as POS-040 page 2", second && [second.tpl.form, second.tpl.n], ["POS-040", 2]);
}

console.log("the data is PDF-Linker's blanks as they stand");
if (!fs.existsSync(SIBLING)) console.log(`  SKIP  no PDF-Linker checkout beside this one (${SIBLING})`);
else {
  const sums = {};
  for (const f of fs.readdirSync(SIBLING).filter((f) => /\.pdf$/i.test(f)).sort()) sums[f] = crypto.createHash("sha256").update(fs.readFileSync(path.join(SIBLING, f))).digest("hex").slice(0, 16);
  const stale = [...Object.keys(sums).filter((f) => index.blanks[f] !== sums[f]), ...Object.keys(index.blanks).filter((f) => !(f in sums))];
  check("every blank in PDF-Linker's Form Templates is in viewer/form-templates, the same copy (else: node build-form-templates.mjs)", stale, []);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
