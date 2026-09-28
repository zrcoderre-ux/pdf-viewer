// Node-runnable tests for password protection (viewer/pdf-crypt.js).
//
// The ciphers are checked against published test vectors and Node's own
// crypto; then a document is protected and opened again with the user
// password, the owner password and a wrong one. When Python's pikepdf is on
// the machine, files it encrypts (RC4 40/128, AES-128, AES-256) are opened
// here, and a file protected here is opened by it — the check that another
// reader agrees with this one. Without pikepdf that section is skipped.
//
// Run: node test-pdf-crypt.mjs

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PDFDocument, StandardFonts } from "./viewer/vendor/pdf-lib/pdf-lib.esm.min.js";
import {
  md5, rc4, aesCbcEncrypt, aesCbcDecrypt, aesEcbEncryptBlock,
  detectEncryption, decryptPdf, encryptPdf, PasswordError,
  permissionBits, describePermissions,
} from "./viewer/pdf-crypt.js";

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
function ok(label, cond) { check(label, !!cond, true); }
const hex = (b) => Buffer.from(b).toString("hex");
const fromHex = (h) => new Uint8Array(Buffer.from(h, "hex"));
const utf8 = (s) => new TextEncoder().encode(s);

async function sampleBytes() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    doc.addPage([612, 792]).drawText(`Confidential page ${i}`, { x: 72, y: 700, size: 14, font });
  }
  doc.setTitle("Privileged memo");
  return doc.save();
}
async function pageText(bytes) {
  // pdf-lib does not extract text; the title and page count stand in for
  // "the document opened and its strings decrypted".
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return { pages: doc.getPageCount(), title: doc.getTitle() };
}

console.log("ciphers");
{
  check("MD5 of nothing", hex(md5(new Uint8Array())), "d41d8cd98f00b204e9800998ecf8427e");
  check("MD5 of abc", hex(md5(utf8("abc"))), "900150983cd24fb0d6963f7d28e17f72");
  const long = crypto.randomBytes(1000);
  check("MD5 of 1000 random bytes matches Node", hex(md5(long)), crypto.createHash("md5").update(long).digest("hex"));
  check("RC4 test vector (Key / Plaintext)", hex(rc4(utf8("Key"), utf8("Plaintext"))), "bbf316e8d940af0ad3");
  const pt = fromHex("00112233445566778899aabbccddeeff");
  check("AES-128 FIPS-197 C.1", hex(aesEcbEncryptBlock(fromHex("000102030405060708090a0b0c0d0e0f"), pt)), "69c4e0d86a7b0430d8cdb78070b4c55a");
  check("AES-256 FIPS-197 C.3", hex(aesEcbEncryptBlock(fromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"), pt)), "8ea2b7ca516745bfeafc49904b496089");
  for (const kl of [16, 32]) {
    const key = crypto.randomBytes(kl), iv = crypto.randomBytes(16), data = crypto.randomBytes(1234);
    const c = crypto.createCipheriv(kl === 16 ? "aes-128-cbc" : "aes-256-cbc", key, iv);
    const ref = Buffer.concat([c.update(data), c.final()]);
    check(`AES-${kl * 8}-CBC encrypts as Node does`, hex(aesCbcEncrypt(key, iv, data, true)), hex(ref));
    check(`AES-${kl * 8}-CBC decrypts Node's output`, hex(aesCbcDecrypt(key, iv, ref, true)), hex(data));
  }
}

console.log("\npermissions");
{
  const all = describePermissions(permissionBits({}));
  ok("by default everything is allowed", Object.values(all).every(Boolean));
  const p = describePermissions(permissionBits({ print: true, copy: false, modify: false }));
  check("no copying, no changes, printing allowed", [p.copy, p.modify, p.print], [false, false, true]);
  check("high-quality printing needs printing", describePermissions(permissionBits({ print: false })).printHigh, false);
  ok("the reserved bits are set, as the spec requires", (permissionBits({}) & 0xfffff0c0) === (0xfffff0c0 | 0));
}

console.log("\nprotect and open again");
{
  const src = await sampleBytes();
  check("a plain file is not encrypted", detectEncryption(src), null);
  const enc = await encryptPdf(src, { userPassword: "s3cret", ownerPassword: "owner", permissions: { copy: false } });
  const det = detectEncryption(enc);
  ok("a protected file is recognized", det);
  check("with AES-256 (V5, R6)", det && [det.enc.V.v, det.enc.R.v], [5, 6]);
  ok("its title is not readable as plain text", !Buffer.from(enc).includes("Privileged memo"));

  let err = null;
  try { await decryptPdf(enc, "wrong"); } catch (e) { err = e; }
  ok("a wrong password is refused", err instanceof PasswordError);

  let asked = null;
  try { await decryptPdf(enc, ""); } catch (e) { asked = e; }
  ok("without a password it asks for one", asked instanceof PasswordError);

  const user = await decryptPdf(enc, "s3cret");
  check("the user password opens it", await pageText(user.bytes), { pages: 2, title: "Privileged memo" });
  check("as the user, not the owner", user.owner, false);
  check("and carries the permissions it was given", describePermissions(user.permissions).copy, false);
  const owner = await decryptPdf(enc, "owner");
  check("the owner password opens it as the owner", owner.owner, true);

  const ownerOnly = await encryptPdf(src, { userPassword: "", permissions: { modify: false } });
  const opened = await decryptPdf(ownerOnly, "");
  ok("with only an owner password it opens without asking", !opened.needsPassword);
  check("and is readable", await pageText(opened.bytes), { pages: 2, title: "Privileged memo" });

  const plain = await decryptPdf(src, "");
  check("a plain file passes through untouched", [plain.encrypted, plain.bytes.length], [false, src.length]);
}

console.log("\nanother reader agrees (pikepdf)");
{
  let hasPike = false;
  try { execFileSync("python3", ["-c", "import pikepdf"], { stdio: "ignore" }); hasPike = true; } catch { /* skip */ }
  if (!hasPike) {
    console.log("  SKIP  pikepdf is not installed");
  } else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfcrypt-"));
    const src = path.join(dir, "src.pdf");
    fs.writeFileSync(src, await sampleBytes());
    const py = (code) => execFileSync("python3", ["-c", code], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const modes = [
      ["RC4 40-bit", "pikepdf.Encryption(user='u', owner='o', R=2, metadata=False, aes=False)"],
      ["RC4 128-bit", "pikepdf.Encryption(user='u', owner='o', R=3, metadata=False, aes=False)"],
      ["AES-128", "pikepdf.Encryption(user='u', owner='o', R=4)"],
      ["AES-256", "pikepdf.Encryption(user='u', owner='o', R=6)"],
    ];
    for (const [label, spec] of modes) {
      const out = path.join(dir, `${label.replace(/\W/g, "")}.pdf`);
      py(`import pikepdf\np=pikepdf.open(${JSON.stringify(src)})\np.save(${JSON.stringify(out)}, encryption=${spec})`);
      const bytes = new Uint8Array(fs.readFileSync(out));
      let got;
      try { got = await pageText((await decryptPdf(bytes, "u")).bytes); } catch (e) { got = String(e); }
      check(`opens a ${label} file`, got, { pages: 2, title: "Privileged memo" });
      let owner = null;
      try { owner = (await decryptPdf(bytes, "o")).owner; } catch (e) { owner = String(e); }
      check(`…and knows its owner password`, owner, true);
    }
    const mine = path.join(dir, "mine.pdf");
    fs.writeFileSync(mine, await encryptPdf(fs.readFileSync(src), { userPassword: "pw", ownerPassword: "own" }));
    const read = py(`import pikepdf\np=pikepdf.open(${JSON.stringify(mine)}, password='pw')\nprint(len(p.pages), str(p.docinfo.get('/Title')), p.is_encrypted)`);
    check("pikepdf opens a file protected here", read, "2 Privileged memo True");
    let refused = false;
    try { py(`import pikepdf\npikepdf.open(${JSON.stringify(mine)}, password='nope')`); } catch { refused = true; }
    ok("…and refuses it without the password", refused);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${"=".repeat(60)}\nFAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
