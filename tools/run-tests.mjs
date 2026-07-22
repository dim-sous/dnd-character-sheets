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

if (failed > 0) {
  console.error(`\n${failed} of ${results.length} assertions FAILED.`);
  process.exit(1);
}

console.log(`All ${passed} assertions passed.`);
