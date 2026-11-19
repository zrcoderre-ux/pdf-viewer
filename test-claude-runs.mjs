// Tests for the Claude workflow runs on Home (viewer/claude-runs.js): the
// file the Claude extension keeps through the E-Court Suite's native host, read;
// a hearing's runs found by case number or folder name; and how each run reads
// at a glance, a run gone quiet included.
//
// Run: node test-claude-runs.mjs   (from the repo root). Every name is invented.

import { parseClaudeRuns, runsForHearing, runState, runLine, stepLines, durationText, isGoing, QUIET_MS, CLAUDE_RUNS_FILE } from "./viewer/claude-runs.js";

let fails = 0, passes = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) passes++; else fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { console.log(`        got : ${JSON.stringify(got)}`); console.log(`        want: ${JSON.stringify(want)}`); }
}
const NOW = new Date(2026, 10, 19, 14, 0).getTime();
const file = {
  version: 1, written: NOW - 60000, runs: [
    { id: "a", name: "25STCV12345 ACME — 11/20/26", template: "Tentative ruling", caseNumber: "25STCV12345", status: "running", phase: "awaiting-reply", progress: "Step 2 of 3 · Chat B — waiting for Claude", step: 2, total: 3, at: NOW - 120000, url: "https://claude.ai/chat/aaa",
      steps: [{ label: "1", chat: "Chat A", state: "done", ms: 252000 }, { label: "2", chat: "Chat B", state: "here" }, { label: "3", chat: "Chat A", state: "bogus" }] },
    { id: "b", name: "Doe v. Roe papers", template: "Bench memo", caseNumber: "", status: "waiting", held: "usage limit", progress: "Step 1 of 4", step: 1, total: 4, at: NOW - 600000 },
    { id: "c", name: "24STCV00777 Globex", caseNumber: "24STCV00777", status: "done", progress: "Finished all 5 steps", step: 5, total: 5, at: NOW - 3600000, finishedAt: NOW - 3600000, url: "javascript:alert(1)" },
    { id: "d", name: "x", status: "bogus" },
  ],
};

console.log("1. the file");
const got = parseClaudeRuns(JSON.stringify(file));
check("its name", CLAUDE_RUNS_FILE, "Claude Run Status.json");
check("the runs it can say, an unknown status left out", got.runs.map((r) => r.id), ["a", "b", "c"]);
check("only a claude.ai address is kept to open", got.runs.map((r) => r.url), ["https://claude.ai/chat/aaa", "", ""]);
check("not the file: nothing", parseClaudeRuns("{nope").runs, []);
check("going", got.runs.map(isGoing), [true, true, false]);

console.log("2. a hearing's runs");
check("by case number", runsForHearing({ caseNumber: "25STCV12345" }, got.runs).map((r) => r.id), ["a"]);
check("by the case folder's name where the run's name has no number", runsForHearing({ caseNumber: "" }, got.runs, "Doe v. Roe papers").map((r) => r.id), ["b"]);
check("numbers that differ never match by name", runsForHearing({ caseNumber: "26STCV00001" }, got.runs, "25STCV12345 ACME").map((r) => r.id), []);

console.log("3. at a glance");
const [a, b, c] = got.runs;
check("running: its step", [runState(a, got.written, NOW).tone, runState(a, got.written, NOW).short], ["run", "Step 2/3"]);
check("held: why", [runState(b, got.written, NOW).short, runState(b, got.written, NOW).text], ["Held", "Held: usage limit"]);
check("done", runState(c, got.written, NOW).short, "Done");
check("running, but nothing from the extension in a quarter hour: said so", [runState(a, NOW - QUIET_MS - 60000, NOW).tone, /is Chrome open/.test(runState(a, NOW - QUIET_MS - 60000, NOW).title)], ["quiet", true]);
check("failed: the reason", runState({ ...a, status: "error", error: "no reply", progress: "Failed at step 2 of 3" }, got.written, NOW).text, "Failed at step 2 of 3: no reply");

console.log("4. the row's Claude column");
check("its steps read, an unknown state taken as to come", got.runs[0].steps.map((x) => x.state), ["done", "here", "todo"]);
check("running: the step it is on", runLine(a, got.written, NOW).line, "Step 2 of 3");
check("finished: when", runLine({ ...c, steps: [] }, got.written, NOW).line, "Finished " + new Date(NOW - 3600000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
check("held: why", runLine(b, got.written, NOW).line, "Held: usage limit");
check("failed: where", runLine({ ...a, status: "error", steps: [{ label: "1", state: "done" }, { label: "2", state: "failed" }] }, got.written, NOW).line, "Failed at step 2");
check("gone quiet: since when", runLine(a, NOW - QUIET_MS - 60000, NOW).line.startsWith("No word since "), true);
check("the history, a line a step", stepLines(a), ["1 · Chat A — done, 4m 12s", "2 · Chat B — running now", "3 · Chat A — to come"]);
check("durations", [durationText(38000), durationText(252000), durationText(3900000)], ["38s", "4m 12s", "1h 05m"]);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
