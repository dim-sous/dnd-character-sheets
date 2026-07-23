/**
 * The runtime seam between the pure layout config (js/layout.js) and the live DOM.
 *
 * Browser-only — it touches localStorage and the document, so tests never import it (the
 * pure half they cover lives in js/layout.js). Kept deliberately off state.js's save loop:
 * a layout is a per-device display preference under its OWN key, and a broken character
 * store must not freeze layout edits, or vice-versa.
 */

import { DEFAULT_LAYOUT, normalizeLayout } from './layout.js';
import { CARD_REGISTRY } from './layout-registry.js';

const LAYOUT_KEY = 'dnd-character-sheets:layout';

// The active layout. Starts at the default so getTabIds() is safe the moment any module
// reads it (render.js resolves its first active tab from it at import time); loadLayout()
// swaps in the stored, normalized layout at bootstrap.
let currentLayout = DEFAULT_LAYOUT;

/**
 * Read the per-device layout from its own key and normalize it. A layout is fully
 * reconstructible, so ANY failure — absent, unparseable, private-mode throw — silently
 * falls back to the default (no recovery banner, unlike character data). In Phase 1 there
 * is no writer yet, so the key is empty and this always yields the default; Phase 2 adds
 * the debounced save.
 */
export function loadLayout() {
  let raw = null;
  try {
    const text = localStorage.getItem(LAYOUT_KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  currentLayout = normalizeLayout(raw);
  return currentLayout;
}

/** The live, already-normalized layout object. */
export function getLayout() {
  return currentLayout;
}

/**
 * Ordered tab ids. Replaces the hardcoded TAB_KEYS/TAB_ORDER in render.js/main.js so the
 * tab set has a single source of truth (the config), ready for tab CRUD in a later phase.
 */
export function getTabIds() {
  return currentLayout.tabs.map((tab) => tab.id);
}

/**
 * Build the sheet from the config by RELOCATING the existing live card nodes into their
 * tab panels, in order — never regenerating markup. Moving a node preserves its identity,
 * so every render.js host (#abilities, #slots, #spell-body, …) stays alive and the data
 * layer never learns the layout changed. In Phase 1 the config equals today's arrangement,
 * so every append is a no-op reposition; the point is to exercise the real relocation path
 * end to end. Panels and tab buttons stay static in index.html for now — generating them
 * is a later phase; this only orders the cards within each existing panel.
 */
export function applyLayout() {
  for (const tab of currentLayout.tabs) {
    const panel = document.getElementById(`panel-${tab.id}`);
    if (!panel) continue; // a config-only tab with no panel yet — a later phase creates it
    for (const card of tab.cards) {
      const reg = CARD_REGISTRY[card.componentId];
      const node = reg && document.querySelector(reg.sel);
      if (node) panel.append(node);
    }
  }
}
