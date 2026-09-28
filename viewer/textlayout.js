// textlayout.js
//
// A PDF page's text as lines and paragraphs, and what is built from that:
// the Word export (.docx), the plain-text export, and Compare Files' word
// diff. Pure — no DOM, no pdf.js — so the Node tests drive it with plain
// text items shaped like pdf.js's getTextContent() output.

// ── Lines and paragraphs ─────────────────────────────────────────────────────

/**
 * Group pdf.js text items into lines, top to bottom, left to right.
 * Items carry { str, transform:[a,b,c,d,e,f], width, height, hasEOL }; the
 * text is read in the page's own upright frame (e, f in points from the
 * bottom-left). Returns [{ y, x, size, text, right }].
 */
export function linesFromItems(items) {
  const runs = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.transform) continue;
    const [a, b, , d, e, f] = it.transform;
    const size = Math.hypot(b, d) || Math.abs(d) || Math.abs(a) || 10;
    if (!it.str.trim()) continue;
    runs.push({ x: e, y: f, size, text: it.str, width: it.width || it.str.length * size * 0.5 });
  }
  runs.sort((p, q) => (Math.abs(p.y - q.y) > Math.min(p.size, q.size) * 0.4 ? q.y - p.y : p.x - q.x));
  const lines = [];
  for (const r of runs) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(cur.y - r.y) <= Math.min(cur.size, r.size) * 0.4) {
      const gap = r.x - cur.right;
      const sep = gap > r.size * 0.18 && !/\s$/.test(cur.text) && !/^\s/.test(r.text) ? (gap > r.size * 2.5 ? "\t" : " ") : "";
      cur.text += sep + r.text;
      cur.right = Math.max(cur.right, r.x + r.width);
      cur.size = Math.max(cur.size, r.size);
    } else {
      lines.push({ y: r.y, x: r.x, size: r.size, text: r.text, right: r.x + r.width });
    }
  }
  for (const l of lines) l.text = l.text.replace(/[  ]+/g, " ").trim();
  return lines.filter((l) => l.text);
}

/**
 * Lines into paragraphs: a new paragraph where the gap between lines is
 * clearly wider than the line spacing, where the type size changes, or where
 * a line starts indented after a short line. A paragraph noticeably larger
 * than the page's body text is a heading.
 */
export function paragraphsFromLines(lines) {
  if (!lines.length) return [];
  const sizes = lines.map((l) => Math.round(l.size * 2) / 2).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] || 12;
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const sortedGaps = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const typical = sortedGaps[Math.floor(sortedGaps.length / 2)] || body * 1.2;
  const left = Math.min(...lines.map((l) => l.x));
  const maxRight = Math.max(...lines.map((l) => l.right));
  const paras = [];
  let cur = null;
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const gap = prev ? prev.y - l.y : 0;
    const sizeChange = prev && Math.abs(prev.size - l.size) > body * 0.15;
    const indented = prev && l.x - left > body * 1.5 && prev.right < maxRight - body * 3;
    const shortPrev = prev && prev.right < maxRight - body * 6;
    const brk = !cur || gap > typical * 1.45 || gap < 0 || sizeChange || (indented && shortPrev);
    if (brk) {
      cur = { lines: [l], size: l.size, indent: l.x - left };
      paras.push(cur);
    } else cur.lines.push(l);
  });
  return paras.map((p) => {
    // Join lines, mending words hyphenated at the line end.
    let text = "";
    for (const l of p.lines) {
      if (!text) text = l.text;
      else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(l.text)) text = text.slice(0, -1) + l.text;
      else text += " " + l.text;
    }
    const heading = p.size > body * 1.25 && text.length < 200;
    return { text, size: p.size, heading, indent: p.indent > body * 1.5 ? p.indent : 0 };
  });
}

// ── Plain text ───────────────────────────────────────────────────────────────

/**
 * The document as plain text, page by page, in the page-header format the
 * text reader reads (====== Page N ======), so an export opens there as pages.
 */
export function plainText(pages) {
  return pages.map((p, i) => `====== Page ${i + 1} ======\n${p.lines.map((l) => l.text).join("\n")}\n`).join("\n");
}

// ── Word (.docx) ─────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
  // XML 1.0 forbids most control characters.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function runXml(text) {
  return text.split("\t").map((part, i) => (i ? "<w:r><w:tab/></w:r>" : "") + (part ? `<w:r><w:t xml:space="preserve">${esc(part)}</w:t></w:r>` : "")).join("");
}

/**
 * The parts of a .docx for `pages` = [{ paragraphs, widthPts, heightPts }]:
 * one Word page per PDF page (a page break between them), headings as
 * Heading 1/2, body text in the body size the PDF used.
 */
export function buildDocx(pages, { title = "Document" } = {}) {
  const first = pages[0] || { widthPts: 612, heightPts: 792 };
  const allSizes = pages.flatMap((p) => p.paragraphs.map((q) => q.size)).sort((a, b) => a - b);
  const bodySize = Math.round((allSizes[Math.floor(allSizes.length / 2)] || 12) * 2) / 2;
  let body = "";
  pages.forEach((p, i) => {
    for (const para of p.paragraphs) {
      const style = para.heading ? (para.size > bodySize * 1.6 ? "Heading1" : "Heading2") : null;
      const ppr = [
        style ? `<w:pStyle w:val="${style}"/>` : "",
        para.indent ? `<w:ind w:firstLine="${Math.round(Math.min(para.indent, 72) * 20)}"/>` : "",
      ].join("");
      const size = !style && Math.abs(para.size - bodySize) > 0.6 ? `<w:rPr><w:sz w:val="${Math.round(para.size * 2)}"/></w:rPr>` : "";
      const runs = size ? runXml(para.text).replace(/<w:r>/g, `<w:r>${size}`) : runXml(para.text);
      body += `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${runs}</w:p>`;
    }
    if (i < pages.length - 1) body += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  });
  const tw = (pts) => Math.round(pts * 20);
  const sect = `<w:sectPr><w:pgSz w:w="${tw(first.widthPts)}" w:h="${tw(first.heightPts)}"${first.widthPts > first.heightPts ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}${sect}</w:body></w:document>` },
    { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="${Math.round(bodySize * 2)}"/><w:szCs w:val="${Math.round(bodySize * 2)}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(bodySize * 2 * 1.4)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="${Math.round(bodySize * 2 * 1.15)}"/></w:rPr></w:style></w:styles>` },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
  ];
}

// ── Compare: a word diff ─────────────────────────────────────────────────────

/** Words with the page each came from: [{ w, page }]. */
export function tokenize(pages) {
  const out = [];
  pages.forEach((p, i) => {
    for (const l of p.lines) for (const w of l.text.split(/\s+/)) if (w) out.push({ w, page: i + 1 });
  });
  return out;
}

const norm = (w) => w.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");

/**
 * Myers' O(ND) diff over two word arrays. Returns edit ops in order:
 * [{ op: "eq"|"del"|"ins", a: [i0,i1), b: [j0,j1) }]. Past `maxD` edits the
 * two are too different to align and the whole is reported as replaced.
 */
export function diffWords(A, B, { maxD = 6000 } = {}) {
  const a = A.map((t) => norm(t.w)), b = B.map((t) => norm(t.w));
  // Common prefix and suffix first: most revisions change a little.
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const a2 = a.slice(pre, a.length - suf), b2 = b.slice(pre, b.length - suf);
  const N = a2.length, M = b2.length, MAX = N + M;
  const ops = [];
  if (pre) ops.push({ op: "eq", a: [0, pre], b: [0, pre] });
  let mid = null;
  if (N === 0 && M === 0) mid = [];
  else if (N === 0) mid = [{ op: "ins", a: [pre, pre], b: [pre, pre + M] }];
  else if (M === 0) mid = [{ op: "del", a: [pre, pre + N], b: [pre, pre] }];
  else {
    const off = MAX + 1;
    let V = new Int32Array(2 * MAX + 3);
    const trace = [];
    let found = false;
    for (let D = 0; D <= Math.min(MAX, maxD); D++) {
      trace.push(V.slice());
      for (let k = -D; k <= D; k += 2) {
        let x = k === -D || (k !== D && V[off + k - 1] < V[off + k + 1]) ? V[off + k + 1] : V[off + k - 1] + 1;
        let y = x - k;
        while (x < N && y < M && a2[x] === b2[y]) { x++; y++; }
        V[off + k] = x;
        if (x >= N && y >= M) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) mid = [{ op: "del", a: [pre, pre + N], b: [pre, pre] }, { op: "ins", a: [pre + N, pre + N], b: [pre, pre + M] }];
    else {
      // Walk the trace back into single steps, then merge runs.
      const steps = [];
      let x = N, y = M;
      for (let D = trace.length - 1; D > 0; D--) {
        const Vd = trace[D];
        const k = x - y;
        const prevK = k === -D || (k !== D && Vd[off + k - 1] < Vd[off + k + 1]) ? k + 1 : k - 1;
        const px = Vd[off + prevK], py = px - prevK;
        while (x > px && y > py) { steps.push("eq"); x--; y--; }
        steps.push(x === px ? "ins" : "del");
        x = px; y = py;
      }
      while (x > 0 && y > 0) { steps.push("eq"); x--; y--; }
      steps.reverse();
      mid = [];
      let i = pre, j = pre;
      for (const s of steps) {
        const last = mid[mid.length - 1];
        const ni = s === "ins" ? i : i + 1, nj = s === "del" ? j : j + 1;
        if (last && last.op === s) { last.a[1] = ni; last.b[1] = nj; }
        else mid.push({ op: s, a: [i, ni], b: [j, nj] });
        i = ni; j = nj;
      }
    }
  }
  ops.push(...mid);
  if (suf) ops.push({ op: "eq", a: [a.length - suf, a.length], b: [b.length - suf, b.length] });
  return ops.filter((o) => o.a[1] > o.a[0] || o.b[1] > o.b[0]);
}

/**
 * The changes between two versions, grouped: each hunk has what was taken out
 * of the first (`removed`), what the second put in (`added`), a little context
 * either side, and the page of each version it falls on.
 */
export function compareHunks(A, B, { context = 8 } = {}) {
  const ops = diffWords(A, B);
  const hunks = [];
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.op === "eq") continue;
    let removed = "", added = "", a0 = o.a[0], b0 = o.b[0], a1 = o.a[1], b1 = o.b[1];
    // A replacement is a delete next to an insert: one hunk.
    while (i < ops.length && ops[i].op !== "eq") {
      const p = ops[i];
      if (p.op === "del") removed += (removed ? " " : "") + A.slice(p.a[0], p.a[1]).map((t) => t.w).join(" ");
      else added += (added ? " " : "") + B.slice(p.b[0], p.b[1]).map((t) => t.w).join(" ");
      a1 = p.a[1]; b1 = p.b[1];
      i++;
    }
    i--;
    hunks.push({
      removed, added,
      before: A.slice(Math.max(0, a0 - context), a0).map((t) => t.w).join(" "),
      after: A.slice(a1, a1 + context).map((t) => t.w).join(" "),
      pageA: (A[a0] || A[a0 - 1] || { page: 1 }).page,
      pageB: (B[b0] || B[b0 - 1] || { page: 1 }).page,
      words: { removed: a1 - a0, added: b1 - b0 },
    });
  }
  return hunks;
}
