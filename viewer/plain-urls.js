// Web addresses written out in a PDF's text (https://…, http://…, www.…) made
// clickable, as Acrobat does, when the PDF itself carries no link annotation
// over them. The PDF's own links (placeNativeLinksForPage in viewer.js) win:
// an address already under one is left to it.
//
// The address is read off the page's text layer, one span per pdf.js text
// item. An address can run on past its span in two ways, and only those two:
//   - into the next span on the same line with no gap between them (a change
//     of font or a kerning break splits one word into two items);
//   - onto the next line, where a long address is wrapped. That is taken only
//     where the break itself says the address goes on — the line ends in a
//     "/", "-", "_", "=", "&", "?", "#", "%", "~" or ":" and the next line
//     opens with address characters — or where the next line's first word is
//     plainly the rest of a path (it holds a "/" or ends in .pdf, .html …).
//     A line ending in "." is the end of a sentence far more often than the
//     middle of a host name, so it goes on only for a "/" in the next word.
// The pure part (findPlainUrls) takes the spans' texts and a callback that
// says how span i meets span i + 1, so it is tested without a page
// (test-plain-urls.mjs).

const START = /\b(?:https?:\/\/|www\.)/gi;
// What an address is made of (RFC 3986's characters, less the ones a
// document puts around one: quotes, angle brackets, whitespace).
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/;
const WRAP_ENDS = "/-_=&?#%~:";
const PATH_WORD = /\/|\.(?:pdf|html?|aspx?|php|jsp|cfm|docx?|xlsx?)(?:[?#]|$)/i;
const TRAILING = /[.,;:!?'"’”]$/;

function unbalanced(s, open, close) {
  let n = 0;
  for (const ch of s) { if (ch === open) n++; else if (ch === close) n--; }
  return n < 0;
}

/** The address a match reads as, with the punctuation the sentence put after it taken off. */
function trimUrl(s) {
  for (;;) {
    if (TRAILING.test(s)) { s = s.slice(0, -1); continue; }
    if (s.endsWith(")") && unbalanced(s, "(", ")")) { s = s.slice(0, -1); continue; }
    if (s.endsWith("]") && unbalanced(s, "[", "]")) { s = s.slice(0, -1); continue; }
    return s;
  }
}

/** The link an address names, or null when what was read is no address. */
export function hrefFor(text) {
  const m = /^(https?:\/\/)?(www\.)?([^/?#:]+)/i.exec(text);
  if (!m) return null;
  const host = (m[2] || "") + m[3];
  // A host has a dot in it (localhost aside) and no empty label: "www." or
  // "https://" alone, or "www..", is not an address.
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(host) && !/^localhost$/i.test(host)) return null;
  if (!/[A-Za-z]/.test(host.split(".").pop())) {
    // A dotted number is an IP address only with a scheme in front of it.
    if (!m[1]) return null;
  }
  return m[1] ? text : `https://${text}`;
}

/**
 * The addresses in a page's text.
 *   texts — each span's text, in the text layer's order
 *   meet(i) — how span i meets span i + 1: "join" (same line, no gap),
 *             "wrap" (the next line) or null (anything else)
 * Returns [{ href, text, pieces: [{ span, start, end }] }], each piece a run
 * of one span's characters, the address being the pieces end to end.
 */
export function findPlainUrls(texts, meet) {
  const found = [];
  // The scan's place: span i, from character `from` on.
  let i = 0, from = 0;
  while (i < texts.length) {
    const t = texts[i] || "";
    START.lastIndex = from;
    const m = START.exec(t);
    if (!m) { i++; from = 0; continue; }
    from = m.index + m[0].length;
    // Not the "www." inside an address already read (https://www.…).
    if (m.index > 0 && /[A-Za-z0-9/.:@-]/.test(t[m.index - 1])) continue;
    const head = URL_CHARS.exec(t.slice(m.index));
    if (!head) continue;
    const pieces = [{ span: i, start: m.index, end: m.index + head[0].length }];
    let text = head[0];
    // On into the following spans while the address reaches its span's end.
    for (let j = i; pieces[pieces.length - 1].end === (texts[j] || "").length && j + 1 < texts.length; j++) {
      const how = meet(j);
      if (!how) break;
      const next = texts[j + 1] || "";
      const lead = how === "wrap" ? next.replace(/^\s+/, "") : next;
      const rest = URL_CHARS.exec(lead);
      if (!rest) break;
      if (how === "wrap") {
        const last = text[text.length - 1];
        const goesOn = (WRAP_ENDS.includes(last) && (last !== ":" || /^\/\//.test(rest[0])))
          || (last === "." ? /\//.test(rest[0]) : PATH_WORD.test(trimUrl(rest[0])));
        if (!goesOn) break;
      }
      const skip = next.length - lead.length;
      pieces.push({ span: j + 1, start: skip, end: skip + rest[0].length });
      text += rest[0];
    }
    const trimmed = trimUrl(text);
    const href = hrefFor(trimmed);
    if (!href) continue;
    // Take the trimmed characters back off the pieces, last first.
    for (let cut = text.length - trimmed.length; cut > 0;) {
      const p = pieces[pieces.length - 1];
      const n = Math.min(cut, p.end - p.start);
      p.end -= n; cut -= n;
      if (p.end === p.start) pieces.pop();
    }
    found.push({ href, text: trimmed, pieces });
    // Carry on after the address, in the span it ended in.
    const tail = pieces[pieces.length - 1];
    i = tail.span; from = tail.end;
  }
  return found;
}

// ── on the page ──────────────────────────────────────────────────────────────

/** How text span a meets the span b after it (see findPlainUrls's meet). */
function spansMeet(a, b) {
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const h = Math.max(ra.height, 1);
  // The next line: wholly below, and not so far below that it is another
  // paragraph or the foot of the page.
  if (rb.top >= ra.bottom - 0.3 * h) return rb.top - ra.bottom < 1.5 * h ? "wrap" : null;
  // The same line, the next span starting where this one ends.
  const sameLine = Math.abs((rb.top + rb.bottom) / 2 - (ra.top + ra.bottom) / 2) < 0.3 * h;
  const gap = rb.left - ra.right;
  return sameLine && gap > -0.15 * h && gap < 0.12 * h ? "join" : null;
}

function overlapArea(a, b) {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Links over the addresses in a page's text layer, put in `layerDiv` (the
 * page's .pdfLinkLayer, beside the PDF's own links and drawn as they are).
 * Returns how many addresses were linked.
 */
export function placePlainUrls(textLayerDiv, layerDiv) {
  // The innermost spans only: pdf.js puts the text straight in each.
  const spans = Array.from(textLayerDiv.querySelectorAll("span"))
    .filter((s) => !s.querySelector("span") && s.firstChild && s.firstChild.nodeType === Node.TEXT_NODE);
  if (!spans.length) return 0;
  const texts = spans.map((s) => s.firstChild.data);
  // Nothing that could start an address: no layout read at all.
  if (!texts.some((t) => /https?:\/\/|www\./i.test(t))) return 0;
  const urls = findPlainUrls(texts, (i) => spansMeet(spans[i], spans[i + 1]));
  if (!urls.length) return 0;

  const layerRect = layerDiv.getBoundingClientRect();
  const owned = Array.from(layerDiv.querySelectorAll("a.pdf-link")).map((el) => ({
    left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight,
  }));
  let placed = 0;
  for (const u of urls) {
    const rects = [];
    for (const p of u.pieces) {
      const node = spans[p.span].firstChild;
      const range = document.createRange();
      try {
        range.setStart(node, p.start);
        range.setEnd(node, p.end);
      } catch {
        continue;
      }
      for (const cr of range.getClientRects()) {
        if (cr.width <= 0.5 || cr.height <= 0.5) continue;
        rects.push({ left: cr.left - layerRect.left, top: cr.top - layerRect.top, width: cr.width, height: cr.height });
      }
    }
    if (!rects.length) continue;
    // The PDF's own link already over it: that one is what the author meant.
    const area = rects.reduce((n, r) => n + r.width * r.height, 0);
    const covered = rects.reduce((n, r) => n + owned.reduce((m, o) => m + overlapArea(r, o), 0), 0);
    if (covered > 0.5 * area) continue;
    for (const r of rects) {
      const el = document.createElement("a");
      el.className = "pdf-link plain-url";
      el.style.left = `${r.left}px`;
      el.style.top = `${r.top}px`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      el.href = u.href;
      el.target = "_blank";
      el.rel = "noopener noreferrer";
      el.title = u.href;
      layerDiv.appendChild(el);
    }
    placed++;
  }
  return placed;
}
