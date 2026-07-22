#!/usr/bin/env node
/**
 * Run the rules suite under Node so CI can gate a merge on it — no browser, no deps.
 * It imports the exact same assertions the browser page does (tests.js); rules.js being
 * pure is what lets them run headless. Exits non-zero if anything failed.
 *
 * Needs a Node that treats the app's extension-less-of-type .js modules as ESM. Node
 * 22.7+ does this by content detection with no package.json, so the repo stays free of
 * one — CI pins the version (see .github/workflows/ci.yml).
 */
import { results } from '../tests.js';

for (const r of results) {
  if (!r.ok) {
    console.error(
      `✗ [${r.group}] ${r.label} — expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`,
    );
  }
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

// An empty suite is a failure, not a pass. If tests.js fails to load its assertions
// (a bad import, a syntax slip, a renamed export) `results` is empty and every check
// silently vanishes — "All 0 assertions passed" is exactly the green that must not ship.
if (results.length === 0) {
  console.error('No assertions ran — the test suite is empty or failed to load.');
  process.exit(1);
}

if (failed > 0) {
  console.error(`\n${failed} of ${results.length} assertions FAILED.`);
  process.exit(1);
}

console.log(`All ${passed} assertions passed.`);
