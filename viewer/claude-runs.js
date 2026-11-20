// The owner's Claude workflow runs on Home (pwa/app-web.js, "Home: Claude
// runs"). The owner (2026-11-19): "I'd like to have the dashboard display
// include the current status of any claude run going."
//
// PDF+ cannot reach the Claude extension, so the extension tells it: its
// worker (src/pdfplusstatus.js there) sends each run going, or ended in the
// last 18 hours, and every other matter's most recent run of the last 90 days
// (the owner, 2026-11-20: "the status of the current or most recent claude
// run for each case (but only if there was one)"), to the E-Court Suite's
// native host, which writes
// CLAUDE_RUNS_FILE into Downloads — the same road the briefing takes. Each run
// is { id, name (the matter: the case folder's name, its date), template (the
// workflow), caseNumber, runDate, status (pending | waiting | running | paused
// | error | done | canceled), phase, progress (the extension's own words),
// step, total, at (its last move), startedAt, finishedAt, held, error, url
// (the chat it last worked in) }. The file is written whenever a run changes
// and every five minutes while one is going, so a file older than QUIET_MS
// with a run "running" means the extension has gone quiet (Chrome closed, the
// computer asleep), and Home says so rather than showing it still working.
// Pure; tested in node by test-claude-runs.mjs.

export const CLAUDE_RUNS_FILE = "Claude Run Status.json";
export const QUIET_MS = 15 * 60 * 1000;
const GOING = new Set(["pending", "waiting", "running", "paused", "error"]);
const STATUSES = new Set([...GOING, "done", "canceled"]);

/** The file's runs: { written, runs }, or { written: 0, runs: [] } where it is not that file. */
export function parseClaudeRuns(text) {
  let data;
  try { data = JSON.parse(String(text || "")); } catch { return { written: 0, runs: [], workflows: [] }; }
  if (!data || !Array.isArray(data.runs)) return { written: 0, runs: [], workflows: [] };
  const runs = data.runs.filter((r) => r && typeof r.id === "string" && STATUSES.has(r.status)).map((r) => ({
    id: r.id, name: String(r.name || "Untitled run"), template: String(r.template || ""), caseNumber: String(r.caseNumber || "").toUpperCase(),
    runDate: String(r.runDate || ""), status: r.status, phase: String(r.phase || ""), progress: String(r.progress || ""),
    step: Number(r.step) || 0, total: Number(r.total) || 0, at: Number(r.at) || 0, startedAt: Number(r.startedAt) || 0,
    finishedAt: Number(r.finishedAt) || 0, held: String(r.held || ""), error: String(r.error || ""),
    url: /^https:\/\/claude\.ai\//.test(String(r.url || "")) ? r.url : "",
    steps: (Array.isArray(r.steps) ? r.steps : []).slice(0, 30).filter((x) => x && typeof x === "object").map((x) => ({
      label: String(x.label || ""), chat: String(x.chat || ""), pause: !!x.pause,
      state: ["done", "here", "next", "failed", "todo"].includes(x.state) ? x.state : "todo",
      ms: Number.isFinite(x.ms) ? x.ms : null,
    })),
  }));
  // The workflows the Claude extension has, for the Claude button's menu (the
  // owner, 2026-11-20: "change the claude run button to a drop down menu that
  // lets me select the workflow to run"); an older extension sends none.
  const workflows = (Array.isArray(data.workflows) ? data.workflows : [])
    .filter((w) => w && typeof w.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(w.id))
    .map((w) => ({ id: w.id, name: String(w.name || "").replace(/\s+/g, " ").trim() || "(untitled)" }))
    .slice(0, 60);
  return { written: Number(data.written) || 0, runs, workflows };
}

/** Whether a run is going (or stopped and waiting on the owner), not over. */
export const isGoing = (r) => !!r && GOING.has(r.status);

/**
 * The runs of a hearing's case: by case number where both say one, else
 * where the run's name holds the case folder's name. Going first, newest move
 * first.
 */
export function runsForHearing(hg, runs, folderName = "") {
  const num = String((hg && hg.caseNumber) || "").toUpperCase();
  const folder = String(folderName || "").trim().toLowerCase();
  const mine = (runs || []).filter((r) => (num && r.caseNumber ? r.caseNumber === num : !!folder && folder.length >= 4 && r.name.toLowerCase().includes(folder)));
  return mine.sort((a, b) => (isGoing(b) - isGoing(a)) || b.at - a.at);
}

/**
 * How far a run has got as a fraction (the owner, 2026-11-20: "replace the
 * lights with the number out of blank like a fraction"): { done, total } —
 * the steps done out of the run's steps, pauses not counted — or null where
 * the run says no total.
 */
export function stepFraction(r) {
  const steps = ((r && r.steps) || []).filter((x) => !x.pause);
  if (steps.length) return { done: steps.filter((x) => x.state === "done").length, total: steps.length };
  const total = Number(r && r.total) || 0;
  if (!total) return null;
  return { done: r.status === "done" ? total : Math.max(0, Math.min(total, (Number(r.step) || 1) - 1)), total };
}

/** "4m 12s", "1h 05m", "38s". */
export function durationText(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
/** "3:10 PM" today, "Nov 18, 3:10 PM" another day. */
export function clockText(at, now = Date.now()) {
  const d = new Date(at);
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return new Date(now).toDateString() === d.toDateString() ? t : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${t}`;
}
/** The step a run is on (its label, "2A"), or "". */
function currentLabel(r) {
  const s = (r.steps || []).find((x) => x.state === "here" || x.state === "failed" || x.state === "next");
  return s ? s.label : r.step ? String(r.step) : "";
}
/**
 * A run's history as the case's row says it, like the runs list in the
 * extension's Options: one line a step ("1 · Chat A — done, 4m 12s").
 */
export function stepLines(r) {
  const word = { done: "done", here: "running now", next: "next", failed: "failed here", todo: "to come" };
  return (r.steps || []).map((x) => `${x.label} · ${x.pause ? "pause" : x.chat || "step"} — ${word[x.state]}${x.ms != null ? ", " + durationText(x.ms) : ""}`);
}
/**
 * How a run reads on its case's row: { tone, line } — what step it is on, or
 * when it finished — beside its steps.
 */
export function runLine(r, written, now = Date.now()) {
  const st = runState(r, written, now);
  const at = currentLabel(r);
  const total = r.total || (r.steps || []).length;
  let line;
  if (st.tone === "quiet") line = `No word since ${clockText(written, now)}`;
  else if (r.status === "running") line = at ? `Running step ${at}` : "Running";
  else if (r.status === "done") line = r.finishedAt ? `Finished ${clockText(r.finishedAt, now)}` : "Finished";
  else if (r.status === "error") line = at ? `Failed at step ${at}` : "Failed";
  else if (r.status === "waiting") line = r.held ? `Held: ${r.held}` : "Held";
  else if (r.status === "paused") line = at ? `Paused before ${at}` : "Paused";
  else if (r.status === "pending") line = "Queued";
  else line = r.finishedAt ? `Canceled ${clockText(r.finishedAt, now)}` : "Canceled";
  return { tone: st.tone, line };
}

/**
 * How a run reads at a glance: { tone, short, text, title }. `tone`: run,
 * queued, held, paused, error, done, canceled, or quiet (the file says
 * running, but nothing has come from the extension in QUIET_MS).
 */
export function runState(r, written, now = Date.now()) {
  const steps = r.total ? `${Math.max(1, Math.min(r.step || 1, r.total))}/${r.total}` : "";
  const progress = r.progress || "";
  if (r.status === "running") {
    if (written && now - written > QUIET_MS) {
      return { tone: "quiet", short: "No word", text: progress, title: `The Claude extension last said this run was going ${minutesAgo(written, now)}: is Chrome open? ${progress}` };
    }
    return { tone: "run", short: steps ? `Step ${steps}` : "Running", text: progress, title: progress };
  }
  if (r.status === "pending") return { tone: "queued", short: "Queued", text: progress, title: progress || "Queued: it starts on its trigger." };
  if (r.status === "waiting") return { tone: "held", short: "Held", text: r.held ? `Held: ${r.held}` : progress, title: `Held${r.held ? ": " + r.held : ""}. ${progress}` };
  if (r.status === "paused") return { tone: "paused", short: "Paused", text: progress, title: progress };
  if (r.status === "error") return { tone: "error", short: "Failed", text: r.error ? `${progress}: ${r.error}` : progress, title: `${progress}${r.error ? ": " + r.error : ""}. Open it in the Claude extension's Options to fix and continue.` };
  if (r.status === "done") return { tone: "done", short: "Done", text: progress, title: progress };
  return { tone: "canceled", short: "Canceled", text: progress, title: progress };
}

function minutesAgo(at, now) {
  const m = Math.round((now - at) / 60000);
  return m < 60 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
}
