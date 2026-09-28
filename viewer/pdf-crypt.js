// pdf-crypt.js
//
// PDF password security (the Standard security handler, ISO 32000 §7.6):
// opening encrypted documents so they can be edited, and protecting documents
// with a password.
//
// pdf.js can DISPLAY an encrypted PDF, but everything that writes one here goes
// through pdf-lib, which cannot read one — so a password-protected filing (and
// many court PDFs carry an owner password even with no open password) could be
// read but never annotated, organized or stamped. decryptPdf() produces the
// plain document from the password the reader typed (or the empty password),
// and encryptPdf() protects one with AES-256 (revision 6, the scheme Acrobat X
// and later write by default).
//
// Decryption covers RC4 40–128 bit (revisions 2–4), AES-128 (V4 AESV2) and
// AES-256 (revisions 5 and 6). The bulk ciphers are implemented here in plain,
// synchronous JavaScript because the object streams of an encrypted file have
// to be decrypted in the middle of pdf-lib's (synchronous) parse; the
// password hashes for revision 6 use WebCrypto's SHA-2.

import {
  PDFDocument,
  PDFParser,
  PDFName,
  PDFString,
  PDFHexString,
  PDFDict,
  PDFArray,
  PDFRawStream,
  PDFStream,
  PDFRef,
  PDFNumber,
  PDFBool,
  ParseSpeeds,
} from "./vendor/pdf-lib/pdf-lib.esm.min.js";

// ── Bytes ────────────────────────────────────────────────────────────────────

const te = new TextEncoder();
function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function latin1(bytes) {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return s;
}
function fromLatin1(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
function int32le(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]); }
function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
function eq(a, b, n = Math.min(a.length, b.length)) {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── MD5 (RFC 1321) ───────────────────────────────────────────────────────────

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = new Int32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;

export function md5(data) {
  const len = data.length;
  const padLen = ((len + 8) >> 6) + 1 << 6;
  const buf = new Uint8Array(padLen);
  buf.set(data);
  buf[len] = 0x80;
  const bitLen = len * 8;
  buf[padLen - 8] = bitLen & 0xff; buf[padLen - 7] = (bitLen >>> 8) & 0xff;
  buf[padLen - 6] = (bitLen >>> 16) & 0xff; buf[padLen - 5] = (bitLen >>> 24) & 0xff;
  buf[padLen - 4] = Math.floor(bitLen / 0x100000000) & 0xff;
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let j = 0; j < 16; j++) {
      const k = off + j * 4;
      M[j] = buf[k] | (buf[k + 1] << 8) | (buf[k + 2] << 16) | (buf[k + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      const tmp = D;
      D = C;
      C = B;
      const x = (A + F + MD5_K[i] + M[g]) | 0;
      B = (B + ((x << MD5_S[i]) | (x >>> (32 - MD5_S[i])))) | 0;
      A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => { out[i * 4] = v & 0xff; out[i * 4 + 1] = (v >>> 8) & 0xff; out[i * 4 + 2] = (v >>> 16) & 0xff; out[i * 4 + 3] = (v >>> 24) & 0xff; });
  return out;
}

// ── RC4 ──────────────────────────────────────────────────────────────────────

export function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

// ── AES (FIPS 197), table-driven ─────────────────────────────────────────────

const SBOX = new Uint8Array(256), INV = new Uint8Array(256);
const T0 = new Uint32Array(256), T1 = new Uint32Array(256), T2 = new Uint32Array(256), T3 = new Uint32Array(256);
const D0 = new Uint32Array(256), D1 = new Uint32Array(256), D2 = new Uint32Array(256), D3 = new Uint32Array(256);
(function initAes() {
  const gmul = (a, b) => {
    let p = 0;
    for (let i = 0; i < 8; i++) {
      if (b & 1) p ^= a;
      const hi = a & 0x80;
      a = (a << 1) & 0xff;
      if (hi) a ^= 0x1b;
      b >>= 1;
    }
    return p;
  };
  // Multiplicative inverses in GF(2^8) via log/antilog tables over generator 3.
  const exp = new Uint8Array(256), log = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x = gmul(x, 3); }
  const inv = (x) => (x ? exp[(255 - log[x]) % 255] : 0);
  for (let x = 0; x < 256; x++) {
    const i = inv(x);
    let s = i, r = i;
    for (let k = 0; k < 4; k++) { r = ((r << 1) | (r >> 7)) & 0xff; s ^= r; }
    s ^= 0x63;
    SBOX[x] = s;
    INV[s] = x;
  }
  for (let x = 0; x < 256; x++) {
    const s = SBOX[x];
    const t = ((gmul(s, 2) << 24) | (s << 16) | (s << 8) | gmul(s, 3)) >>> 0;
    T0[x] = t; T1[x] = ((t >>> 8) | (t << 24)) >>> 0; T2[x] = ((t >>> 16) | (t << 16)) >>> 0; T3[x] = ((t >>> 24) | (t << 8)) >>> 0;
    const v = INV[x];
    const u = ((gmul(v, 14) << 24) | (gmul(v, 9) << 16) | (gmul(v, 13) << 8) | gmul(v, 11)) >>> 0;
    D0[x] = u; D1[x] = ((u >>> 8) | (u << 24)) >>> 0; D2[x] = ((u >>> 16) | (u << 16)) >>> 0; D3[x] = ((u >>> 24) | (u << 8)) >>> 0;
  }
})();

const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

function expandKey(key) {
  const nk = key.length / 4;
  const rounds = nk + 6;
  const w = new Uint32Array(4 * (rounds + 1));
  for (let i = 0; i < nk; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  for (let i = nk; i < w.length; i++) {
    let t = w[i - 1];
    if (i % nk === 0) {
      t = ((SBOX[(t >>> 16) & 0xff] << 24) | (SBOX[(t >>> 8) & 0xff] << 16) | (SBOX[t & 0xff] << 8) | SBOX[t >>> 24]) >>> 0;
      t = (t ^ (RCON[i / nk - 1] << 24)) >>> 0;
    } else if (nk > 6 && i % nk === 4) {
      t = ((SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 0xff] << 16) | (SBOX[(t >>> 8) & 0xff] << 8) | SBOX[t & 0xff]) >>> 0;
    }
    w[i] = (w[i - nk] ^ t) >>> 0;
  }
  // Decryption schedule: rounds reversed, inner rounds through InvMixColumns.
  const dw = new Uint32Array(w.length);
  for (let r = 0; r <= rounds; r++) {
    for (let c = 0; c < 4; c++) {
      const v = w[(rounds - r) * 4 + c];
      dw[r * 4 + c] = r === 0 || r === rounds ? v
        : (D0[SBOX[v >>> 24]] ^ D1[SBOX[(v >>> 16) & 0xff]] ^ D2[SBOX[(v >>> 8) & 0xff]] ^ D3[SBOX[v & 0xff]]) >>> 0;
    }
  }
  return { w, dw, rounds };
}

function encBlock(ks, inp, io, out, oo) {
  const { w, rounds } = ks;
  let s0 = (((inp[io] << 24) | (inp[io + 1] << 16) | (inp[io + 2] << 8) | inp[io + 3]) ^ w[0]) >>> 0;
  let s1 = (((inp[io + 4] << 24) | (inp[io + 5] << 16) | (inp[io + 6] << 8) | inp[io + 7]) ^ w[1]) >>> 0;
  let s2 = (((inp[io + 8] << 24) | (inp[io + 9] << 16) | (inp[io + 10] << 8) | inp[io + 11]) ^ w[2]) >>> 0;
  let s3 = (((inp[io + 12] << 24) | (inp[io + 13] << 16) | (inp[io + 14] << 8) | inp[io + 15]) ^ w[3]) >>> 0;
  let k = 4;
  for (let r = 1; r < rounds; r++) {
    const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 0xff] ^ T2[(s2 >>> 8) & 0xff] ^ T3[s3 & 0xff] ^ w[k];
    const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 0xff] ^ T2[(s3 >>> 8) & 0xff] ^ T3[s0 & 0xff] ^ w[k + 1];
    const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 0xff] ^ T2[(s0 >>> 8) & 0xff] ^ T3[s1 & 0xff] ^ w[k + 2];
    const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 0xff] ^ T2[(s1 >>> 8) & 0xff] ^ T3[s2 & 0xff] ^ w[k + 3];
    s0 = t0 >>> 0; s1 = t1 >>> 0; s2 = t2 >>> 0; s3 = t3 >>> 0;
    k += 4;
  }
  const f = (a, b, c, d, kw) => ((SBOX[a >>> 24] << 24) | (SBOX[(b >>> 16) & 0xff] << 16) | (SBOX[(c >>> 8) & 0xff] << 8) | SBOX[d & 0xff]) ^ kw;
  const r0 = f(s0, s1, s2, s3, w[k]), r1 = f(s1, s2, s3, s0, w[k + 1]), r2 = f(s2, s3, s0, s1, w[k + 2]), r3 = f(s3, s0, s1, s2, w[k + 3]);
  for (const [j, v] of [[0, r0], [4, r1], [8, r2], [12, r3]]) {
    out[oo + j] = (v >>> 24) & 0xff; out[oo + j + 1] = (v >>> 16) & 0xff; out[oo + j + 2] = (v >>> 8) & 0xff; out[oo + j + 3] = v & 0xff;
  }
}

function decBlock(ks, inp, io, out, oo) {
  const { dw: w, rounds } = ks;
  let s0 = (((inp[io] << 24) | (inp[io + 1] << 16) | (inp[io + 2] << 8) | inp[io + 3]) ^ w[0]) >>> 0;
  let s1 = (((inp[io + 4] << 24) | (inp[io + 5] << 16) | (inp[io + 6] << 8) | inp[io + 7]) ^ w[1]) >>> 0;
  let s2 = (((inp[io + 8] << 24) | (inp[io + 9] << 16) | (inp[io + 10] << 8) | inp[io + 11]) ^ w[2]) >>> 0;
  let s3 = (((inp[io + 12] << 24) | (inp[io + 13] << 16) | (inp[io + 14] << 8) | inp[io + 15]) ^ w[3]) >>> 0;
  let k = 4;
  for (let r = 1; r < rounds; r++) {
    const t0 = D0[s0 >>> 24] ^ D1[(s3 >>> 16) & 0xff] ^ D2[(s2 >>> 8) & 0xff] ^ D3[s1 & 0xff] ^ w[k];
    const t1 = D0[s1 >>> 24] ^ D1[(s0 >>> 16) & 0xff] ^ D2[(s3 >>> 8) & 0xff] ^ D3[s2 & 0xff] ^ w[k + 1];
    const t2 = D0[s2 >>> 24] ^ D1[(s1 >>> 16) & 0xff] ^ D2[(s0 >>> 8) & 0xff] ^ D3[s3 & 0xff] ^ w[k + 2];
    const t3 = D0[s3 >>> 24] ^ D1[(s2 >>> 16) & 0xff] ^ D2[(s1 >>> 8) & 0xff] ^ D3[s0 & 0xff] ^ w[k + 3];
    s0 = t0 >>> 0; s1 = t1 >>> 0; s2 = t2 >>> 0; s3 = t3 >>> 0;
    k += 4;
  }
  const f = (a, b, c, d, kw) => ((INV[a >>> 24] << 24) | (INV[(b >>> 16) & 0xff] << 16) | (INV[(c >>> 8) & 0xff] << 8) | INV[d & 0xff]) ^ kw;
  const r0 = f(s0, s3, s2, s1, w[k]), r1 = f(s1, s0, s3, s2, w[k + 1]), r2 = f(s2, s1, s0, s3, w[k + 2]), r3 = f(s3, s2, s1, s0, w[k + 3]);
  for (const [j, v] of [[0, r0], [4, r1], [8, r2], [12, r3]]) {
    out[oo + j] = (v >>> 24) & 0xff; out[oo + j + 1] = (v >>> 16) & 0xff; out[oo + j + 2] = (v >>> 8) & 0xff; out[oo + j + 3] = v & 0xff;
  }
}

/** AES-CBC encrypt. `pad`: PKCS#7-pad first (strings and streams); off for the key-wrapping steps. */
export function aesCbcEncrypt(key, iv, data, pad = true) {
  const ks = expandKey(key);
  let src = data;
  if (pad) {
    const p = 16 - (data.length % 16);
    src = new Uint8Array(data.length + p);
    src.set(data);
    src.fill(p, data.length);
  } else if (data.length % 16) throw new Error("AES: data not block aligned");
  const out = new Uint8Array(src.length);
  const prev = Uint8Array.from(iv.subarray(0, 16));
  const blk = new Uint8Array(16);
  for (let o = 0; o < src.length; o += 16) {
    for (let i = 0; i < 16; i++) blk[i] = src[o + i] ^ prev[i];
    encBlock(ks, blk, 0, out, o);
    prev.set(out.subarray(o, o + 16));
  }
  return out;
}
/** AES-CBC decrypt, stripping PKCS#7 padding when `pad` (tolerant of bad padding, as readers are). */
export function aesCbcDecrypt(key, iv, data, pad = true) {
  const n = data.length - (data.length % 16);
  if (!n) return new Uint8Array(0);
  const ks = expandKey(key);
  const out = new Uint8Array(n);
  let prev = iv;
  for (let o = 0; o < n; o += 16) {
    decBlock(ks, data, o, out, o);
    for (let i = 0; i < 16; i++) out[o + i] ^= prev[i];
    prev = data.subarray(o, o + 16);
  }
  if (!pad) return out;
  const p = out[n - 1];
  if (p >= 1 && p <= 16) return out.subarray(0, n - p);
  return out;
}
export function aesEcbEncryptBlock(key, block) {
  const out = new Uint8Array(16);
  encBlock(expandKey(key), block, 0, out, 0);
  return out;
}

// ── A small reader for the encryption dictionary ─────────────────────────────
// The /Encrypt dictionary is never in an object stream (§7.5.7), so it can be
// read straight out of the file before anything else is parsed.

function parseObjectAt(s, pos) {
  const ws = /[\s\0]/;
  const skip = () => {
    for (;;) {
      while (pos < s.length && ws.test(s[pos])) pos++;
      if (s[pos] === "%") { while (pos < s.length && s[pos] !== "\n" && s[pos] !== "\r") pos++; continue; }
      break;
    }
  };
  const obj = () => {
    skip();
    const c = s[pos];
    if (c === "<" && s[pos + 1] === "<") {
      pos += 2;
      const d = {};
      for (;;) {
        skip();
        if (s[pos] === ">" && s[pos + 1] === ">") { pos += 2; return { t: "dict", v: d }; }
        const k = obj();
        const v = obj();
        if (!k || k.t !== "name") throw new Error("bad dict");
        d[k.v] = v;
      }
    }
    if (c === "<") {
      pos++;
      let h = "";
      while (s[pos] !== ">") { if (!ws.test(s[pos])) h += s[pos]; pos++; }
      pos++;
      if (h.length % 2) h += "0";
      const b = new Uint8Array(h.length / 2);
      for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
      return { t: "str", v: b };
    }
    if (c === "(") {
      pos++;
      let depth = 1;
      const out = [];
      while (pos < s.length) {
        const ch = s[pos++];
        if (ch === "\\") {
          const e = s[pos++];
          const map = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
          if (e in map) out.push(map[e]);
          else if (/[0-7]/.test(e)) {
            let o = e;
            for (let i = 0; i < 2 && /[0-7]/.test(s[pos]); i++) o += s[pos++];
            out.push(parseInt(o, 8) & 0xff);
          } else if (e === "\r") { if (s[pos] === "\n") pos++; }
          else if (e === "\n") { /* line continuation */ }
          else out.push(e.charCodeAt(0));
          continue;
        }
        if (ch === "(") depth++;
        else if (ch === ")") { depth--; if (!depth) break; }
        out.push(ch.charCodeAt(0) & 0xff);
      }
      return { t: "str", v: Uint8Array.from(out) };
    }
    if (c === "/") {
      pos++;
      let n = "";
      while (pos < s.length && !/[\s\0/<>\[\]()%{}]/.test(s[pos])) n += s[pos++];
      return { t: "name", v: n.replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === "[") {
      pos++;
      const a = [];
      for (;;) { skip(); if (s[pos] === "]") { pos++; return { t: "arr", v: a }; } a.push(obj()); }
    }
    const m = /^(true|false|null|[+-]?\d*\.?\d+)/.exec(s.slice(pos, pos + 40));
    if (m) {
      pos += m[1].length;
      if (m[1] === "true" || m[1] === "false") return { t: "bool", v: m[1] === "true" };
      if (m[1] === "null") return { t: "null", v: null };
      // An indirect reference: "12 0 R".
      const r = /^\s+(\d+)\s+R\b/.exec(s.slice(pos, pos + 20));
      if (r && /^\d+$/.test(m[1])) { pos += r[0].length; return { t: "ref", v: [Number(m[1]), Number(r[1])] }; }
      return { t: "num", v: Number(m[1]) };
    }
    throw new Error(`unexpected ${JSON.stringify(s.slice(pos, pos + 10))}`);
  };
  return obj();
}

/**
 * Whether `bytes` is an encrypted PDF, and if so the pieces needed to open it:
 * { enc (the dictionary, parsed), id0 (first file ID), ref ([num, gen] of the
 * dictionary, or null when it is direct) }. Null for a plain PDF.
 */
export function detectEncryption(bytes) {
  const s = latin1(bytes);
  const at = s.lastIndexOf("/Encrypt");
  if (at < 0) return null;
  let enc = null, ref = null;
  try {
    const val = parseObjectAt(s, at + 8);
    if (val.t === "dict") enc = val.v;
    else if (val.t === "ref") {
      ref = val.v;
      const re = new RegExp(`(?:^|[^0-9])${ref[0]}\\s+${ref[1]}\\s+obj`, "g");
      let m, last = null;
      while ((m = re.exec(s))) last = m;
      if (!last) return null;
      const o = parseObjectAt(s, last.index + last[0].length);
      if (o.t === "dict") enc = o.v;
    }
  } catch { return null; }
  if (!enc || !enc.Filter || enc.Filter.v !== "Standard") return enc ? { enc, id0: new Uint8Array(0), ref, unsupported: true } : null;
  let id0 = new Uint8Array(0);
  const idAt = s.lastIndexOf("/ID");
  if (idAt >= 0) {
    try {
      const idv = parseObjectAt(s, idAt + 3);
      if (idv.t === "arr" && idv.v[0] && idv.v[0].t === "str") id0 = idv.v[0].v;
    } catch { /* no usable ID */ }
  }
  return { enc, id0, ref };
}

// ── Keys ─────────────────────────────────────────────────────────────────────

const PAD = fromLatin1("\x28\xBF\x4E\x5E\x4E\x75\x8A\x41\x64\x00\x4E\x56\xFF\xFA\x01\x08\x2E\x2E\x00\xB6\xD0\x68\x3E\x80\x2F\x0C\xA9\xFE\x64\x53\x69\x7A");

function padPassword(pw) {
  const b = fromLatin1(String(pw || "")).subarray(0, 32);
  return concat(b, PAD.subarray(0, 32 - b.length));
}
function utf8Password(pw) {
  return te.encode(String(pw || "").normalize("NFKC")).subarray(0, 127);
}
const val = (d, k, def) => (d[k] ? d[k].v : def);

async function sha(alg, data) {
  return new Uint8Array(await globalThis.crypto.subtle.digest(alg, data));
}
/** Revision 6's password hash (ISO 32000-2 §7.6.4.3.4, algorithm 2.B). */
async function hash2B(pw, salt, udata = new Uint8Array(0)) {
  let K = await sha("SHA-256", concat(pw, salt, udata));
  for (let round = 0; ; round++) {
    const one = concat(pw, K, udata);
    const K1 = new Uint8Array(one.length * 64);
    for (let i = 0; i < 64; i++) K1.set(one, i * one.length);
    const E = aesCbcEncrypt(K.subarray(0, 16), K.subarray(16, 32), K1, false);
    let mod = 0;
    for (let i = 0; i < 16; i++) mod += E[i];
    mod %= 3;
    K = await sha(mod === 0 ? "SHA-256" : mod === 1 ? "SHA-384" : "SHA-512", E);
    if (round >= 63 && E[E.length - 1] <= round - 32) break;
  }
  return K.subarray(0, 32);
}

function computeKeyR4(pwPadded, enc, id0) {
  const R = val(enc, "R", 2);
  const len = R === 2 ? 5 : Math.floor(val(enc, "Length", 40) / 8);
  const O = val(enc, "O", new Uint8Array(32)).subarray(0, 32);
  const P = val(enc, "P", 0);
  const parts = [pwPadded, O, int32le(P), id0];
  if (R >= 4 && enc.EncryptMetadata && enc.EncryptMetadata.v === false) parts.push(new Uint8Array([255, 255, 255, 255]));
  let h = md5(concat(...parts));
  if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, len));
  return h.subarray(0, len);
}
function userHashR4(key, enc, id0) {
  const R = val(enc, "R", 2);
  if (R === 2) return rc4(key, PAD);
  let x = rc4(key, md5(concat(PAD, id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return x;
}

/**
 * The file key for `password`, tried as the user password and then as the
 * owner password. Returns { key, owner, R, V, method, encryptMetadata, P } or
 * null when the password opens neither.
 */
export async function fileKey(det, password) {
  const { enc, id0 } = det;
  const V = val(enc, "V", 0), R = val(enc, "R", 2);
  const P = val(enc, "P", 0);
  const encryptMetadata = !(enc.EncryptMetadata && enc.EncryptMetadata.v === false);
  let method = "rc4";
  if (V === 4 || V === 5) {
    const cf = enc.CF && enc.CF.v;
    const name = enc.StmF ? enc.StmF.v : "Identity";
    const f = cf && cf[name] && cf[name].v;
    const cfm = f && f.CFM ? f.CFM.v : "None";
    method = cfm === "AESV2" ? "aes128" : cfm === "AESV3" ? "aes256" : cfm === "V2" ? "rc4" : name === "Identity" ? "none" : "rc4";
  }
  const base = { R, V, method, encryptMetadata, P };
  if (R >= 5) {
    const pw = utf8Password(password);
    const O = val(enc, "O", new Uint8Array(48)), U = val(enc, "U", new Uint8Array(48));
    const OE = val(enc, "OE", new Uint8Array(32)), UE = val(enc, "UE", new Uint8Array(32));
    const h = R === 5 ? (p, salt, u = new Uint8Array(0)) => sha("SHA-256", concat(p, salt, u)) : hash2B;
    const zero = new Uint8Array(16);
    if (eq(await h(pw, O.subarray(32, 40), U.subarray(0, 48)), O, 32)) {
      const k = await h(pw, O.subarray(40, 48), U.subarray(0, 48));
      return { ...base, key: aesCbcDecrypt(k, zero, OE.subarray(0, 32), false), owner: true };
    }
    if (eq(await h(pw, U.subarray(32, 40)), U, 32)) {
      const k = await h(pw, U.subarray(40, 48));
      return { ...base, key: aesCbcDecrypt(k, zero, UE.subarray(0, 32), false), owner: false };
    }
    return null;
  }
  // Revisions 2–4: the user password first…
  const U = val(enc, "U", new Uint8Array(32));
  let key = computeKeyR4(padPassword(password), enc, id0);
  if (eq(userHashR4(key, enc, id0), U, R === 2 ? 32 : 16)) return { ...base, key, owner: false };
  // …then the owner password, which unlocks the user password from /O.
  const len = R === 2 ? 5 : Math.floor(val(enc, "Length", 40) / 8);
  let h = md5(padPassword(password));
  if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const okey = h.subarray(0, len);
  let userPw = val(enc, "O", new Uint8Array(32)).subarray(0, 32);
  if (R === 2) userPw = rc4(okey, userPw);
  else for (let i = 19; i >= 0; i--) userPw = rc4(okey.map((b) => b ^ i), userPw);
  key = computeKeyR4(userPw, enc, id0);
  if (eq(userHashR4(key, enc, id0), U, R === 2 ? 32 : 16)) return { ...base, key, owner: true };
  return null;
}

function objectKey(k, num, gen) {
  if (k.method === "aes256") return k.key;
  const parts = [k.key, new Uint8Array([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff])];
  if (k.method === "aes128") parts.push(fromLatin1("sAlT"));
  return md5(concat(...parts)).subarray(0, Math.min(k.key.length + 5, 16));
}
function decryptBytes(k, okey, data) {
  if (k.method === "none") return data;
  if (k.method === "rc4") return rc4(okey, data);
  if (data.length < 16) return new Uint8Array(0);
  return aesCbcDecrypt(okey, data.subarray(0, 16), data.subarray(16), true);
}

// ── Decrypting a document ────────────────────────────────────────────────────

function decryptObject(obj, k, okey, seen = new Set()) {
  if (!obj || seen.has(obj)) return obj;
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    const raw = obj.asBytes();
    const plain = decryptBytes(k, okey, raw);
    return PDFHexString.of(Array.from(plain, (b) => b.toString(16).padStart(2, "0")).join(""));
  }
  seen.add(obj);
  if (obj instanceof PDFDict) {
    for (const [key, v] of obj.entries()) {
      const nv = decryptObject(v, k, okey, seen);
      if (nv !== v) obj.set(key, nv);
    }
    return obj;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i);
      const nv = decryptObject(v, k, okey, seen);
      if (nv !== v) obj.set(i, nv);
    }
    return obj;
  }
  if (obj instanceof PDFRawStream) {
    decryptObject(obj.dict, k, okey, seen);
    return PDFRawStream.of(obj.dict, decryptBytes(k, okey, obj.contents));
  }
  return obj;
}
// pdf-lib's parser, taught to decrypt each top-level object the moment it is
// read — before an object stream is unpacked, which is the one point that
// cannot wait. Only a parser carrying __pdfvDecrypt is affected.
const origHeader = PDFParser.prototype.parseIndirectObjectHeader;
const origParse = PDFParser.prototype.parseObject;
PDFParser.prototype.parseIndirectObjectHeader = function () {
  const ref = origHeader.call(this);
  if (this.__pdfvDecrypt) this.__pdfvRef = ref;
  return ref;
};
PDFParser.prototype.parseObject = function () {
  const d = this.__pdfvDecrypt;
  if (!d) return origParse.call(this);
  this.__pdfvDepth = (this.__pdfvDepth || 0) + 1;
  let obj;
  try { obj = origParse.call(this); } finally { this.__pdfvDepth--; }
  if (this.__pdfvDepth === 0 && this.__pdfvRef) {
    const ref = this.__pdfvRef;
    this.__pdfvRef = null;
    const isEncDict = d.encRef && ref.objectNumber === d.encRef[0] && ref.generationNumber === d.encRef[1];
    const type = obj instanceof PDFRawStream ? obj.dict.get(PDFName.of("Type")) : null;
    const isXref = type === PDFName.of("XRef");
    const isMeta = type === PDFName.of("Metadata") && !d.key.encryptMetadata;
    if (!isEncDict && !isXref && !isMeta) obj = decryptObject(obj, d.key, objectKey(d.key, ref.objectNumber, ref.generationNumber));
  }
  return obj;
};

export class PasswordError extends Error {
  constructor(msg = "Incorrect password") { super(msg); this.code = "password"; }
}

/**
 * The plain document for an encrypted PDF.
 *   → { bytes, needsPassword, owner, permissions (P), method }
 * `needsPassword` says the empty password did not open it (it has an open
 * password). Throws PasswordError when `password` opens neither lock.
 */
export async function decryptPdf(bytes, password = "") {
  const det = detectEncryption(bytes);
  if (!det) return { bytes, encrypted: false };
  if (det.unsupported) throw new Error("This PDF uses a security handler other than password security.");
  let k = await fileKey(det, "");
  const needsPassword = !k || false;
  if (!k || (password && !k.owner)) {
    const k2 = password ? await fileKey(det, password) : null;
    if (k2) k = k2;
    else if (!k) throw new PasswordError();
  }
  const parser = PDFParser.forBytesWithOptions(bytes, ParseSpeeds.Fastest, false, false);
  parser.__pdfvDecrypt = { key: k, encRef: det.ref };
  const context = await parser.parseDocument();
  parser.__pdfvDecrypt = null;
  const encRef = context.trailerInfo.Encrypt;
  context.trailerInfo.Encrypt = undefined;
  if (encRef instanceof PDFRef) context.delete(encRef);
  const doc = new PDFDocument(context, true, false);
  const out = await doc.save({ useObjectStreams: false });
  return { bytes: out, encrypted: true, needsPassword: !!needsPassword, owner: k.owner, permissions: k.P, method: k.method, revision: k.R };
}

// ── Encrypting a document ────────────────────────────────────────────────────

/** Permission bits (§7.6.4.2, table 22) from a plain object of flags. */
export function permissionBits({ print = true, printHigh = true, modify = true, copy = true, annotate = true, fillForms = true, accessibility = true, assemble = true } = {}) {
  let p = 0xfffff0c0; // reserved bits set, every permission clear
  if (print) p |= 1 << 2;
  if (modify) p |= 1 << 3;
  if (copy) p |= 1 << 4;
  if (annotate) p |= 1 << 5;
  if (fillForms) p |= 1 << 8;
  if (accessibility) p |= 1 << 9;
  if (assemble) p |= 1 << 10;
  if (printHigh && print) p |= 1 << 11;
  return p | 0;
}
export function describePermissions(P) {
  const has = (bit) => !!(P & (1 << bit));
  return {
    print: has(2), printHigh: has(2) && has(11), modify: has(3), copy: has(4),
    annotate: has(5), fillForms: has(8) || has(5), accessibility: has(9), assemble: has(10),
  };
}

function encryptObject(obj, key, seen = new Set()) {
  if (!obj || seen.has(obj)) return obj;
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    const plain = obj.asBytes();
    const iv = randomBytes(16);
    const c = concat(iv, aesCbcEncrypt(key, iv, plain, true));
    return PDFHexString.of(Array.from(c, (b) => b.toString(16).padStart(2, "0")).join(""));
  }
  seen.add(obj);
  if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) { const nv = encryptObject(v, key, seen); if (nv !== v) obj.set(k, nv); }
    return obj;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) { const v = obj.get(i); const nv = encryptObject(v, key, seen); if (nv !== v) obj.set(i, nv); }
    return obj;
  }
  return obj;
}

/**
 * Protect a (plain) PDF with AES-256.
 *   userPassword  — needed to open it ("" for none: anyone can open it, and the
 *                   permissions below are what the owner password guards)
 *   ownerPassword — needed to change the security (a random one when empty)
 *   permissions   — see permissionBits()
 */
export async function encryptPdf(bytes, { userPassword = "", ownerPassword = "", permissions = {} } = {}) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const fileKeyBytes = randomBytes(32);
  const P = typeof permissions === "number" ? permissions : permissionBits(permissions);
  const upw = utf8Password(userPassword);
  const opw = utf8Password(ownerPassword || latin1(randomBytes(24)).replace(/[^\x21-\x7e]/g, "x"));
  const zero = new Uint8Array(16);

  const uVal = randomBytes(8), uKey = randomBytes(8);
  const U = concat(await hash2B(upw, uVal), uVal, uKey);
  const UE = aesCbcEncrypt(await hash2B(upw, uKey), zero, fileKeyBytes, false);
  const oVal = randomBytes(8), oKey = randomBytes(8);
  const O = concat(await hash2B(opw, oVal, U), oVal, oKey);
  const OE = aesCbcEncrypt(await hash2B(opw, oKey, U), zero, fileKeyBytes, false);
  const permsBlock = concat(int32le(P), new Uint8Array([0xff, 0xff, 0xff, 0xff]), fromLatin1("Tadb"), randomBytes(4));
  const Perms = aesEcbEncryptBlock(fileKeyBytes, permsBlock);

  // Every string and stream of every object, each with an IV of its own.
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      if (typeof obj.updateDict === "function") { try { obj.updateDict(); } catch { /* raw */ } }
      const type = obj.dict.get(PDFName.of("Type"));
      if (type === PDFName.of("XRef")) continue;
      const contents = obj.getContents();
      encryptObject(obj.dict, fileKeyBytes);
      const iv = randomBytes(16);
      const enc = concat(iv, aesCbcEncrypt(fileKeyBytes, iv, contents, true));
      const dict = obj.dict.clone(ctx);
      dict.set(PDFName.of("Length"), PDFNumber.of(enc.length));
      ctx.assign(ref, PDFRawStream.of(dict, enc));
    } else {
      const nv = encryptObject(obj, fileKeyBytes);
      if (nv !== obj) ctx.assign(ref, nv);
    }
  }

  const hex = (b) => PDFHexString.of(Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""));
  const encDict = ctx.obj({
    Filter: "Standard",
    V: 5,
    R: 6,
    Length: 256,
    P,
    EncryptMetadata: true,
    StmF: "StdCF",
    StrF: "StdCF",
    CF: { StdCF: { AuthEvent: "DocOpen", CFM: "AESV3", Length: 32, Type: "CryptFilter" } },
  });
  encDict.set(PDFName.of("O"), hex(O));
  encDict.set(PDFName.of("U"), hex(U));
  encDict.set(PDFName.of("OE"), hex(OE));
  encDict.set(PDFName.of("UE"), hex(UE));
  encDict.set(PDFName.of("Perms"), hex(Perms));
  encDict.set(PDFName.of("EncryptMetadata"), PDFBool.True);
  ctx.trailerInfo.Encrypt = ctx.register(encDict);
  const id = randomBytes(16);
  ctx.trailerInfo.ID = ctx.obj([hex(id), hex(id)]);
  return doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
}
