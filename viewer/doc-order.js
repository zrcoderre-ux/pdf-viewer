// doc-order.js — the order a case folder's documents are read in, set by the
// operator and kept across sessions (text-reader.js, "THE FOLDER'S ORDER").
//
// The owner (2026-11-05): "Add the ability to rearrange the documents in the
// case folder, with a drag and drop and up and down arrows in pdf viewer for
// both PDF mode and Text mode. This would change the order in which they are
// displayed and when they appear when using continuous scroll. These
// preferences should outlast the current session."
//
// Two lists, one order: the Documents list (the exports, Text mode) and PDF
// mode's list (the PDFs). A move in either is carried to the other through
// the reader's own export ↔ PDF matching (`carryOrder`), so an export and its
// PDF stand at the same place in both. Each is stored by name, per case
// folder, in localStorage (ORDER_KEY), for the ORDER_FOLDERS folders set
// last. A name the folder no longer has is dropped as the order is read; a
// document the order does not name yet (a new filing) goes after the ones it
// does, in the order the folder lists them (`applyOrder`).

export const ORDER_KEY = "textReader.docOrder";
export const ORDER_FOLDERS = 60;

/**
 * `items` in the stored order `names` (by `nameOf`): the items `names` holds,
 * in its order, then the rest as `items` had them. `pinned(item)` keeps an
 * item at the top whatever the order says (the combined file). Returns a new
 * array, or `items` itself where nothing moved.
 */
export function applyOrder(items, names, nameOf = (x) => x.name, pinned = () => false) {
  if (!Array.isArray(names) || !names.length) return items;
  const at = new Map();
  names.forEach((n, i) => { if (!at.has(n)) at.set(n, i); });
  const top = items.filter(pinned);
  const rest = items.filter((x) => !pinned(x));
  const known = rest.filter((x) => at.has(nameOf(x))).sort((a, b) => at.get(nameOf(a)) - at.get(nameOf(b)));
  const fresh = rest.filter((x) => !at.has(nameOf(x)));
  const out = top.concat(known, fresh);
  return out.every((x, i) => x === items[i]) ? items : out;
}

/** `list` with the item at `from` moved to `to` (indexes of the list as it stands). A new array. */
export function moveItem(list, from, to) {
  const out = list.slice();
  if (from < 0 || from >= out.length) return out;
  const t = Math.max(0, Math.min(out.length - 1, to));
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x);
  return out;
}

/**
 * The other list put in the order of `lead`: each item of `other` that
 * `match(item)` ties to an item of `lead` takes that item's place; one tied
 * to none keeps its place behind the item it stood behind before. Stable, a
 * new array. `pinned` as in applyOrder.
 */
export function carryOrder(other, lead, match, pinned = () => false) {
  const leadAt = new Map(lead.map((x, i) => [x, i]));
  let last = -1;
  const ranked = other.map((x, i) => {
    const m = pinned(x) ? null : match(x);
    const r = m != null && leadAt.has(m) ? leadAt.get(m) : null;
    if (pinned(x)) return { x, k: [-2, i] };
    if (r != null) { last = r; return { x, k: [r, 0, i] }; }
    return { x, k: [last, 1, i] };
  });
  ranked.sort((a, b) => {
    for (let j = 0; j < Math.max(a.k.length, b.k.length); j++) {
      const d = (a.k[j] ?? -2) - (b.k[j] ?? -2);
      if (d) return d;
    }
    return 0;
  });
  const out = ranked.map((r) => r.x);
  return out.every((x, i) => x === other[i]) ? other : out;
}

/** The stored orders of every folder: { [folder]: { docs, pdfs, when } }. */
export function readOrders(get) {
  const all = get(ORDER_KEY, {});
  return all && typeof all === "object" ? all : {};
}

/** The stored order of `folder`, { docs: [names], pdfs: [names] } (either may be empty). */
export function orderOf(get, folder) {
  const o = folder ? readOrders(get)[folder] : null;
  return { docs: (o && Array.isArray(o.docs) ? o.docs : []), pdfs: (o && Array.isArray(o.pdfs) ? o.pdfs : []) };
}

/** Keep `folder`'s order, the newest ORDER_FOLDERS folders' only. */
export function saveOrder(get, set, folder, { docs, pdfs }, now = Date.now()) {
  if (!folder) return;
  const all = readOrders(get);
  delete all[folder];
  all[folder] = { docs: docs || [], pdfs: pdfs || [], when: now };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - ORDER_FOLDERS))) delete all[k];
  set(ORDER_KEY, all);
}

/**
 * Make the rows of `listEl` (its element children, one per item, in order)
 * draggable, each with ↑ ↓ buttons. `movable(i)` says whether row i may move
 * and be passed (the combined file may not); `onMove(from, to)` is told the
 * move as indexes of the list as it stood. Drop marks show where it lands.
 */
export function wireReorder(listEl, { movable = () => true, onMove, label = (i) => `item ${i + 1}` }) {
  const rows = [...listEl.children];
  const first = rows.findIndex((_r, i) => movable(i));
  let dragFrom = -1;
  const clearMarks = () => { for (const r of rows) r.classList.remove("drop-before", "drop-after", "dragging"); };
  rows.forEach((row, i) => {
    if (!movable(i)) return;
    row.draggable = true;
    row.classList.add("reorderable");
    const box = document.createElement("span");
    box.className = "reorder-btns";
    const btn = (text, dir, disabled, what) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "reorder-btn";
      b.textContent = text;
      b.title = `Move ${label(i)} ${what}`;
      b.setAttribute("aria-label", b.title);
      b.disabled = disabled;
      b.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); onMove(i, i + dir); });
      b.addEventListener("mousedown", (e) => e.stopPropagation());
      return b;
    };
    box.appendChild(btn("↑", -1, i <= first, "up"));
    box.appendChild(btn("↓", 1, i >= rows.length - 1, "down"));
    row.appendChild(box);
    row.addEventListener("dragstart", (e) => {
      dragFrom = i;
      row.classList.add("dragging");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); } catch { /* fine */ }
    });
    row.addEventListener("dragend", () => { dragFrom = -1; clearMarks(); });
  });
  rows.forEach((row, i) => {
    row.addEventListener("dragover", (e) => {
      if (dragFrom < 0 || i < first || !movable(i)) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      for (const x of rows) x.classList.remove("drop-before", "drop-after");
      row.classList.add(after ? "drop-after" : "drop-before");
    });
    row.addEventListener("drop", (e) => {
      if (dragFrom < 0 || i < first || !movable(i)) return;
      e.preventDefault();
      const after = row.classList.contains("drop-after");
      let to = after ? i + 1 : i;
      if (dragFrom < to) to -= 1;
      const from = dragFrom;
      dragFrom = -1;
      clearMarks();
      if (to !== from) onMove(from, to);
    });
  });
}
