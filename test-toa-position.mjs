// Node-runnable tests: a saved Table of Authorities position never puts the
// panel off screen.
// Run: node test-toa-position.mjs
//
// The panel's position is persisted as offsets from the window's top-right
// corner, measured in whatever window the drag happened in. Restored verbatim
// into a NARROWER window — a smaller display, a resized window, a second
// monitor left behind — those offsets place the panel entirely outside the
// viewport. The panel is enabled, rendering, and counting authorities; it is
// simply nowhere the user can see it, which reads as the Table of Authorities
// having switched itself off while its setting is still on.
//
// clampPanelPosition is the fix: the saved offsets stay saved, and only what
// is written to the element is clamped, so widening the window again restores
// the placement the user chose instead of stranding it in a corner.

import { clampPanelPosition } from "./viewer/toa.js";

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

// A 420-wide panel (the default) in a 1280x720 window.
const W = 420, WIN = { winW: 1280, winH: 720 };
const at = (right, top, extra = {}) =>
  clampPanelPosition({ right, top, width: W, ...WIN, ...extra });

console.log("\n--- a position already on screen is left alone ---");
check("the default corner", at(12, 80), { right: 12, top: 80 });
check("dragged to the middle", at(500, 300), { right: 500, top: 300 });
check("flush against the right edge", at(0, 0), { right: 0, top: 0 });
check(
  "flush against the left edge",
  at(1280 - W, 200),
  { right: 1280 - W, top: 200 }
);

console.log("\n--- a position saved in a bigger window is pulled back in ---");
check(
  "parked left of a wider monitor",
  at(1600, 120),
  { right: 1280 - W, top: 120 }      // as far left as it goes, still fully visible
);
check(
  "parked below a taller monitor",
  at(20, 1300),
  { right: 20, top: 720 - 32 }       // header bar still in view
);
check("both offsets out of range", at(4000, 4000), { right: 860, top: 688 });

console.log("\n--- degenerate windows and values ---");
check(
  "a window narrower than the panel",
  clampPanelPosition({ right: 900, top: 40, width: W, winW: 300, winH: 500 }),
  { right: 0, top: 40 }
);
check(
  "a window shorter than the header",
  clampPanelPosition({ right: 10, top: 900, width: W, winW: 1280, winH: 20 }),
  { right: 10, top: 0 }
);
check("negative offsets", at(-50, -50), { right: 0, top: 0 });
check(
  "no width measured yet",
  clampPanelPosition({ right: 5000, top: 10, width: 0, ...WIN }),
  { right: 1280, top: 10 }
);

console.log("\n--- an unset offset stays unset (CSS default placement) ---");
check(
  "neither saved",
  clampPanelPosition({ right: null, top: null, width: W, ...WIN }),
  { right: null, top: null }
);
check(
  "only the top saved",
  clampPanelPosition({ right: null, top: 1300, width: W, ...WIN }),
  { right: null, top: 688 }
);

console.log("\n" + "=".repeat(60));
console.log(`FAILURES: ${fails}`);
process.exit(fails ? 1 : 0);
