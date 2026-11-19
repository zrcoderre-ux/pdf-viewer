// The owner's Claude workflow runs on Home (pwa/app-web.js, "Home: Claude
// runs"). The owner (2026-11-19): "I'd like to have the dashboard display
// include the current status of any claude run going."
//
// PDF+ cannot reach the Claude extension, so the extension tells it: its
// worker (src/pdfplusstatus.js there) sends each run going, or ended in the
// last 18 hours, to the E-Court Suite's native host, which writes
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
  try { data = JSON.parse(String(text || "")); } catch { return { written: 0, runs: [] }; }
  if (!data || !Array.isArray(data.runs)) return { written: 0, runs: [] };
  const runs = data.runs.filter((r) => r && typeof r.id === "string" && STATUSES.has(r.status)).map((r) => ({
    id: r.id, name: String(r.name || "Untitled run"), template: String(r.template || ""), caseNumber: String(r.caseNumber || "").toUpperCase(),
    runDate: String(r.runDate || ""), status: r.status, phase: String(r.phase || ""), progress: String(r.progress || ""),
    step: Number(r.step) || 0, total: Number(r.total) || 0, at: Number(r.at) || 0, startedAt: Number(r.startedAt) || 0,
    finishedAt: Number(r.finishedAt) || 0, held: String(r.held || ""), error: String(r.error || ""),
    url: /^https:\/\/claude\.ai\//.test(String(r.url || "")) ? r.url : "",
  }));
  return { written: Number(data.written) || 0, runs };
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
