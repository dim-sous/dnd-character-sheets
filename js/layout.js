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

import {
  TAB_REGISTRY, CARD_REGISTRY, CARD_ORDER, OBJECT_REGISTRY, OBJECT_ORDER,
} from './layout-registry.js';

export const LAYOUT_SCHEMA_VERSION = 1;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Normalize one card: `{ componentId }` plus, for a card that has registered objects (Phase 5
 * — only `combat` so far), a reconciled `objects` list. Objects follow the same contract as
 * cards one level down: drop unknown/duplicate/foreign-card ids, coerce `hidden`, append every
 * missing registered object (exactly-once), so a `cost:'js'` object can never go missing.
 */
function normalizeCard(componentId, rawCard) {
  const card = { componentId };
  const order = OBJECT_ORDER[componentId];
  if (!order) return card; // this card is not objectified

  const seen = new Set();
  const objects = [];
  const rawObjects = rawCard && Array.isArray(rawCard.objects) ? rawCard.objects : [];
  for (const rawObj of rawObjects) {
    const oid = typeof rawObj === 'string' ? rawObj
      : (rawObj && typeof rawObj === 'object' ? rawObj.componentId : null);
    const reg = OBJECT_REGISTRY[oid];
    if (!reg || reg.card !== componentId || seen.has(oid)) continue;
    seen.add(oid);
    objects.push({ componentId: oid, hidden: Boolean(rawObj && rawObj.hidden) });
  }
  for (const oid of order) {
    if (seen.has(oid)) continue;
    seen.add(oid);
    objects.push({ componentId: oid, hidden: false });
  }
  card.objects = objects;
  return card;
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
        .map((componentId) => normalizeCard(componentId, null)),
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
  const tabs = [];

  // Keep EVERY tab with a unique, non-empty string id — registry or user-created (#54 Tab
  // CRUD). Unlike earlier phases we no longer whitelist the registry tabs or restore
  // "missing" ones: a tab the user removed stays removed. A default tab's id still gets its
  // registry label as a fallback.
  for (const rawTab of Array.isArray(input.tabs) ? input.tabs : []) {
    if (!rawTab || typeof rawTab !== 'object') continue;
    const id = typeof rawTab.id === 'string' ? rawTab.id.trim() : '';
    if (!id || byId.has(id)) continue;
    const regLabel = (TAB_REGISTRY.find((t) => t.id === id) || {}).label;
    const label = str(rawTab.label, '').trim() ? rawTab.label : (regLabel || id);

    const cards = [];
    for (const rawCard of Array.isArray(rawTab.cards) ? rawTab.cards : []) {
      const componentId = typeof rawCard === 'string' ? rawCard
        : (rawCard && typeof rawCard === 'object' ? rawCard.componentId : null);
      if (!CARD_REGISTRY[componentId] || seen.has(componentId)) continue;
      seen.add(componentId);
      cards.push(normalizeCard(componentId, rawCard));
    }

    const tab = { id, label, cards };
    tabs.push(tab);
    byId.set(id, tab);
  }

  // The app can never be tab-less: a fully corrupt/empty tab set rebuilds the default.
  if (tabs.length === 0) return buildDefaultLayout();

  // Place every registry card exactly once: at its home tab if that tab still exists, else
  // the first tab. This still guarantees no `cost:'js'` host can go missing (the anti-crash
  // invariant) even when a card's home tab was deleted.
  for (const componentId of CARD_ORDER) {
    if (seen.has(componentId)) continue;
    seen.add(componentId);
    const tab = byId.get(CARD_REGISTRY[componentId].home) || tabs[0];
    tab.cards.push(normalizeCard(componentId, null));
  }

  return { layoutSchemaVersion: LAYOUT_SCHEMA_VERSION, tabs };
}

/* ------------------------------------------------------- object mutators */

/** Move an object within its card (clamped, immutable). No-op for an unknown card, a card
 *  without objects, or an out-of-range index. */
export function moveObject(layout, cardId, fromIndex, toIndex) {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => {
      if (!tab.cards.some((c) => c.componentId === cardId)) return tab;
      return {
        ...tab,
        cards: tab.cards.map((card) => {
          if (card.componentId !== cardId || !card.objects) return card;
          const objects = card.objects.slice();
          if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= objects.length) return card;
          const to = Math.max(0, Math.min(toIndex, objects.length - 1));
          const [moved] = objects.splice(fromIndex, 1);
          objects.splice(to, 0, moved);
          return { ...card, objects };
        }),
      };
    }),
  };
}

/** Flip one object's hidden flag within its card (immutable). No-op if the object is absent. */
export function toggleObjectHidden(layout, cardId, objectId) {
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => {
      if (!tab.cards.some((c) => c.componentId === cardId)) return tab;
      return {
        ...tab,
        cards: tab.cards.map((card) => {
          if (card.componentId !== cardId || !card.objects) return card;
          return {
            ...card,
            objects: card.objects.map((o) => (
              o.componentId === objectId ? { ...o, hidden: !o.hidden } : o
            )),
          };
        }),
      };
    }),
  };
}

/* --------------------------------------------------------- tab mutators */

/** Append a new empty tab, returning a NEW layout. No-op if the id already exists or is blank. */
export function addTab(layout, id, label) {
  if (!id || layout.tabs.some((tab) => tab.id === id)) return layout;
  return { ...layout, tabs: [...layout.tabs, { id, label: label || id, cards: [] }] };
}

/**
 * Remove a tab, moving its cards to the first REMAINING tab so nothing is ever lost (the
 * every-card-placed-once invariant holds, and the spellcasting card's ability select is
 * never orphaned). Never removes the last tab — the app must keep at least one.
 */
export function removeTab(layout, tabId) {
  if (layout.tabs.length <= 1) return layout;
  const victim = layout.tabs.find((tab) => tab.id === tabId);
  if (!victim) return layout;
  const remaining = layout.tabs.filter((tab) => tab.id !== tabId);
  const firstId = remaining[0].id;
  return {
    ...layout,
    tabs: remaining.map((tab) => (
      tab.id === firstId ? { ...tab, cards: [...tab.cards, ...victim.cards] } : tab
    )),
  };
}

/** Rename a tab; a blank label keeps the current one (labels are never empty). */
export function renameTab(layout, tabId, label) {
  const clean = typeof label === 'string' ? label.trim() : '';
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => (
      tab.id === tabId ? { ...tab, label: clean || tab.label } : tab
    )),
  };
}

/** Reorder a tab by delta (±1), clamped. No-op at the ends or for an unknown tab. */
export function moveTab(layout, tabId, delta) {
  const from = layout.tabs.findIndex((tab) => tab.id === tabId);
  if (from === -1) return layout;
  const to = from + delta;
  if (to < 0 || to >= layout.tabs.length) return layout;
  const tabs = layout.tabs.slice();
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...layout, tabs };
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
