/**
 * The layout config — *where* things are placed (#54), and the reconciliation that
 * keeps a stored layout honest against the registry.
 *
 * Pure and DOM-free, exactly like constants.js/rules.js, so the whole file is covered
 * by tools/run-tests.mjs. The browser-only half (reading localStorage, relocating the
 * live DOM nodes) lives in js/layout-view.js and is never imported by tests.
 *
 * Shape (one object, per device — never part of a character export):
 *
 *   { layoutSchemaVersion, tabs: [ { id, label, cards: [ { componentId } ] } ] }
 *
 * Cards are `{ componentId }` objects rather than bare strings so later phases can add
 * fields (colSpan, pinnedCol, objects…) without reshaping the store.
 */

import { TAB_REGISTRY, CARD_REGISTRY, CARD_ORDER } from './layout-registry.js';

export const LAYOUT_SCHEMA_VERSION = 1;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/** The current arrangement expressed as data: each tab in registry order holds its home cards. */
function buildDefaultLayout() {
  return {
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: TAB_REGISTRY.map((tab) => ({
      id: tab.id,
      label: tab.label,
      cards: CARD_ORDER
        .filter((id) => CARD_REGISTRY[id].home === tab.id)
        .map((componentId) => ({ componentId })),
    })),
  };
}

/** The default layout, for the reset-to-default paths and as a test oracle. */
export const DEFAULT_LAYOUT = buildDefaultLayout();

/**
 * Bring an older stored shape forward. Phase 1 is v1 so there is nothing to migrate yet —
 * this is the single seam a future shape change hangs one explicit branch on (modelled on
 * normalizeCharacter's hitDice object→list fold). Additive changes need NO code here: the
 * structural reconciliation below fills anything missing and drops anything stale.
 */
function migrate(raw) {
  switch (num(raw && raw.layoutSchemaVersion, 0)) {
    // case 1: raw = upgradeV1toV2(raw); // fall through when a v2 shape lands
    default: return raw;
  }
}

/**
 * Merge a raw layout over the default, mirroring normalizeCharacter: a hand-edited file,
 * a layout from an older/newer build, or a corrupt blob can never crash a render.
 *
 * Invariants it guarantees:
 *  - every TAB_REGISTRY tab is present (Phase 1 keeps all 5; Phase 4 revisits removal);
 *  - every CARD_REGISTRY card is referenced EXACTLY ONCE — unknown ids and duplicates are
 *    dropped, and any card the input omitted is appended at its home tab. That last pass
 *    is the anti-crash guarantee: a `cost:'js'` card can never go missing and leave
 *    render.js dereferencing a detached host.
 * Never throws; idempotent; JSON-round-trip stable.
 */
export function normalizeLayout(raw) {
  const input = migrate(raw);
  if (!input || typeof input !== 'object') return buildDefaultLayout();

  const seen = new Set(); // componentIds already placed — dedupe + drop-unknown
  const byId = new Map(); // tabId -> its normalized tab, for the append-missing pass
  const takenTabs = new Set();
  const tabs = [];

  // Keep the input's tabs (known ids only, no duplicates), preserving their order.
  for (const rawTab of Array.isArray(input.tabs) ? input.tabs : []) {
    if (!rawTab || typeof rawTab !== 'object') continue;
    const reg = TAB_REGISTRY.find((t) => t.id === rawTab.id);
    if (!reg || takenTabs.has(reg.id)) continue;
    takenTabs.add(reg.id);

    const cards = [];
    for (const rawCard of Array.isArray(rawTab.cards) ? rawTab.cards : []) {
      const componentId = typeof rawCard === 'string' ? rawCard
        : (rawCard && typeof rawCard === 'object' ? rawCard.componentId : null);
      if (!CARD_REGISTRY[componentId] || seen.has(componentId)) continue;
      seen.add(componentId);
      cards.push({ componentId });
    }

    const tab = { id: reg.id, label: str(rawTab.label, reg.label), cards };
    tabs.push(tab);
    byId.set(reg.id, tab);
  }

  // Restore any registry tab the input dropped, in registry order, appended after the
  // kept ones (so it never crashes; its home cards land in the pass below).
  for (const reg of TAB_REGISTRY) {
    if (takenTabs.has(reg.id)) continue;
    const tab = { id: reg.id, label: reg.label, cards: [] };
    tabs.push(tab);
    byId.set(reg.id, tab);
  }

  // Append every card not yet placed at its home tab (guaranteed present). One pass that
  // also enforces the exactly-once + never-missing invariants above.
  for (const componentId of CARD_ORDER) {
    if (seen.has(componentId)) continue;
    seen.add(componentId);
    const tab = byId.get(CARD_REGISTRY[componentId].home) || tabs[0];
    tab.cards.push({ componentId });
  }

  return { layoutSchemaVersion: LAYOUT_SCHEMA_VERSION, tabs };
}

/* ----------------------------------------------------------- accessors */

/** Ordered tab ids — the single source of truth that replaces the hardcoded TAB_KEYS/TAB_ORDER. */
export function tabIds(layout) {
  return layout.tabs.map((tab) => tab.id);
}

/** The componentIds placed on a tab, in order. */
export function cardsOf(layout, tabId) {
  const tab = layout.tabs.find((t) => t.id === tabId);
  return tab ? tab.cards.map((card) => card.componentId) : [];
}

/* ------------------------------------------------------------- mutators */

/**
 * Move a card within its tab, returning a NEW layout (the input is never mutated — the
 * arrange UI relies on that to keep undo/compare cheap). `toIndex` clamps to the tab's
 * bounds, so the ↑/↓ buttons calling this with `fromIndex ± 1` at an end are a clean no-op.
 * An out-of-range `fromIndex` or an unknown `tabId` is a no-op too. Cross-tab moves are a
 * later phase; this only reorders within one tab.
 */
export function moveCard(layout, tabId, fromIndex, toIndex) {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      const cards = tab.cards.slice();
      if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= cards.length) return tab;
      const to = Math.max(0, Math.min(toIndex, cards.length - 1));
      const [moved] = cards.splice(fromIndex, 1);
      cards.splice(to, 0, moved);
      return { ...tab, cards };
    }),
  };
}

/**
 * Move a card to a different tab, appended to that tab's end, returning a NEW layout. The
 * user reorders it into place afterward with ↑/↓. No-op (returns the input) for an unknown
 * card, an unknown destination, or a same-tab target. Because the card is removed from its
 * source and added to exactly one destination, the "every card placed exactly once"
 * invariant is preserved — a card can live on any tab, not just its home (normalizeLayout
 * only re-homes cards that are placed nowhere).
 */
export function moveCardToTab(layout, componentId, toTabId) {
  const from = layout.tabs.find((tab) => tab.cards.some((c) => c.componentId === componentId));
  const dest = layout.tabs.find((tab) => tab.id === toTabId);
  if (!from || !dest || from.id === toTabId) return layout;
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => {
      if (tab.id === from.id) {
        return { ...tab, cards: tab.cards.filter((c) => c.componentId !== componentId) };
      }
      if (tab.id === toTabId) return { ...tab, cards: [...tab.cards, { componentId }] };
      return tab;
    }),
  };
}
