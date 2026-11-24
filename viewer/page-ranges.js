// page-ranges.js — the page ranges an operator types ("5, 12-18, 7"), read
// and written back. Pure (no DOM). The text reader's page swap (pdfsync.js)
// and the rotate tool's Pages… box (rotation.js) share this one reading, so a
// range means the same thing wherever it is typed.

/**
 * "5, 12-18, 7" → { pages: [5, 7, 12, 13, …, 18], bad: [] } — sorted, unique,
 * within 1..max (a number past `max` is reported in `bad`, not dropped
 * silently). Separators: commas, semicolons, spaces; a range is "a-b" or
 * "a–b" (en dash), either order.
 */
export function parsePageRanges(text, max) {
  const pages = new Set();
  const bad = [];
  const lim = Number.isInteger(max) && max > 0 ? max : Infinity;
  const src = String(text == null ? "" : text).replace(/\s*[-–—]\s*/g, "-");
  for (const tok of src.split(/[,;\s]+/)) {
    if (!tok) continue;
    const m = tok.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) { bad.push(tok); continue; }
    let a = parseInt(m[1], 10), b = m[2] == null ? a : parseInt(m[2], 10);
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > lim || b - a > 5000) { bad.push(tok); continue; }
    for (let n = a; n <= b; n++) pages.add(n);
  }
  return { pages: [...pages].sort((x, y) => x - y), bad };
}

/** [5, 7, 12, 13, 14] → "5, 7, 12-14". */
export function formatPageRanges(pages) {
  const ns = [...new Set((pages || []).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(j > i + 1 ? `${ns[i]}-${ns[j]}` : j === i + 1 ? `${ns[i]}, ${ns[j]}` : String(ns[i]));
    i = j;
  }
  return out.join(", ");
}
