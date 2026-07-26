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
  SPAN_MIN, SPAN_MAX, HEIGHT_MIN, HEIGHT_MAX,
} from './layout-registry.js';

export const LAYOUT_SCHEMA_VERSION = 2;

/** An integer within [min, max], or null if the input is not one. */
function intInRange(value, min, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/**
 * The width of an object within its card grid (#54 Phase 6), as a whole number of the twelve
 * columns. Anything out of range — a stale `'full'` from a layout that skipped the migration,
 * a typo, a missing field — falls back to the object's registry default, so an old or
 * hand-edited layout can never produce an invalid `grid-column`.
 */
function normalizeSpan(rawSpan, componentId) {
  const span = intInRange(rawSpan, SPAN_MIN, SPAN_MAX);
  if (span !== null) return span;
  const reg = OBJECT_REGISTRY[componentId];
  return (reg && intInRange(reg.defaultSpan, SPAN_MIN, SPAN_MAX)) ?? SPAN_MIN;
}

/**
 * The object's minimum height in `--tile-step` units. 0 is "as tall as its contents", and is
 * both the default and where anything unparseable lands — a layout with no height at all (every
 * layout saved before this existed) reads as today's behaviour rather than as a broken tile.
 *
 * Out of range CLAMPS, where an out-of-range span falls back to the registry default instead.
 * The asymmetry is deliberate: both ends of the height range are meaningful values a slider can
 * legitimately report, whereas a span of 0 or 99 is not a width at all and the registry default
 * is the only sensible recovery.
 */
function normalizeHeight(rawHeight) {
  const n = Math.round(Number(rawHeight));
  if (!Number.isFinite(n)) return HEIGHT_MIN;
  return Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, n));
}

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
  // A custom card title (#54) — a per-device override of the registry label. Stored only when
  // set to a non-empty string, so the default layout stays label-free and a blank reverts to the
  // registry default. Applies to EVERY card (kept before the non-objectified early return).
  const rawLabel = rawCard && typeof rawCard.label === 'string' ? rawCard.label.trim() : '';
  if (rawLabel) card.label = rawLabel;
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
    const rawLabel = rawObj && typeof rawObj.label === 'string' ? rawObj.label.trim() : '';
    const obj = { componentId: oid };
    if (rawLabel) obj.label = rawLabel; // custom title overriding the registry label (#54)
    obj.hidden = Boolean(rawObj && rawObj.hidden);
    obj.span = normalizeSpan(rawObj && rawObj.span, oid);
    obj.height = normalizeHeight(rawObj && rawObj.height);
    objects.push(obj);
  }
  for (const oid of order) {
    if (seen.has(oid)) continue;
    seen.add(oid);
    objects.push({
      componentId: oid, hidden: false, span: normalizeSpan(undefined, oid), height: HEIGHT_MIN,
    });
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
 * v1 object spans against the old four-column grid. Twelve columns make each an exact
 * multiple — see the GRID_COLUMNS note in the registry — so the mapping loses nothing: a
 * layout saved before this change comes back pixel-identical.
 */
const V1_SPANS = { 1: 3, 2: 6, full: 12 };

function upgradeV1toV2(raw) {
  return {
    ...raw,
    tabs: (Array.isArray(raw.tabs) ? raw.tabs : []).map((tab) => {
      if (!tab || typeof tab !== 'object') return tab;
      return {
        ...tab,
        cards: (Array.isArray(tab.cards) ? tab.cards : []).map((card) => {
          if (!card || typeof card !== 'object' || !Array.isArray(card.objects)) return card;
          return {
            ...card,
            objects: card.objects.map((o) => (
              o && typeof o === 'object' && Object.hasOwn(V1_SPANS, o.span)
                ? { ...o, span: V1_SPANS[o.span] }
                : o
            )),
          };
        }),
      };
    }),
  };
}

/**
 * Bring an older stored shape forward — the single seam a shape change hangs one explicit
 * branch on, modelled on normalizeCharacter's hitDice object→list fold. Additive changes need
 * NO code here (the new `height` field is one: the reconciliation below fills it in), but the
 * v1→v2 span rescale is not additive — the same key changed meaning.
 *
 * Version 0 takes the same branch as 1: a blob with no version at all still carries v1 spans,
 * and reading it as v2 would coerce every one of them to a registry default, silently throwing
 * away a layout the player had arranged.
 */
function migrate(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  switch (num(raw.layoutSchemaVersion, 0)) {
    case 0:
    case 1: return upgradeV1toV2(raw);
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

/**
 * Set one object's span within its card (immutable). An out-of-range span is coerced to the
 * object's registry default by normalizeSpan, so this can never store an invalid width. No-op
 * (returns a structurally-equal layout) if the object is absent.
 */
export function setObjectSpan(layout, cardId, objectId, span) {
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
              o.componentId === objectId ? { ...o, span: normalizeSpan(span, objectId) } : o
            )),
          };
        }),
      };
    }),
  };
}

/**
 * Set one object's minimum height, in `--tile-step` units, within its card (immutable). Out of
 * range is clamped by normalizeHeight rather than rejected, so a slider that reports a value
 * past either end still lands somewhere valid. No-op if the object is absent.
 */
export function setObjectHeight(layout, cardId, objectId, height) {
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
              o.componentId === objectId ? { ...o, height: normalizeHeight(height) } : o
            )),
          };
        }),
      };
    }),
  };
}

/**
 * Set (or clear) an object's custom title within its card (immutable). A blank label removes the
 * override so the object falls back to its registry label. Rebuilds the object in reconcile key
 * order (componentId, label, hidden, span, height) so a renamed layout stays byte-identical to its
 * normalized form. No-op if the object is absent.
 */
export function renameObject(layout, cardId, objectId, label) {
  const clean = typeof label === 'string' ? label.trim() : '';
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
            objects: card.objects.map((o) => {
              if (o.componentId !== objectId) return o;
              const next = { componentId: o.componentId };
              if (clean) next.label = clean;
              for (const [k, v] of Object.entries(o)) {
                if (k !== 'componentId' && k !== 'label') next[k] = v;
              }
              return next;
            }),
          };
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
  // Carry the WHOLE card entry across, not a bare { componentId } — so a custom title, object
  // order, spans, and hidden flags survive the move (otherwise they'd reset until the next
  // normalize, which for the objectified Combat card would silently drop the player's tweaks).
  const moved = from.cards.find((c) => c.componentId === componentId);
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => {
      if (tab.id === from.id) {
        return { ...tab, cards: tab.cards.filter((c) => c.componentId !== componentId) };
      }
      if (tab.id === toTabId) return { ...tab, cards: [...tab.cards, moved] };
      return tab;
    }),
  };
}

/**
 * Set (or clear) a card's custom title, returning a NEW layout (#54). A blank label removes the
 * override so the card falls back to its registry default. No-op (returns the input) if the card
 * isn't placed anywhere.
 */
export function renameCard(layout, componentId, label) {
  if (!layout.tabs.some((tab) => tab.cards.some((c) => c.componentId === componentId))) return layout;
  const clean = typeof label === 'string' ? label.trim() : '';
  return {
    ...layout,
    tabs: layout.tabs.map((tab) => ({
      ...tab,
      cards: tab.cards.map((card) => {
        if (card.componentId !== componentId) return card;
        // Rebuild in normalizeCard's key order (componentId, label, then the rest) so a renamed
        // layout stays byte-identical to its normalized form, like the other mutators.
        const next = { componentId: card.componentId };
        if (clean) next.label = clean;
        for (const [k, v] of Object.entries(card)) {
          if (k !== 'componentId' && k !== 'label') next[k] = v;
        }
        return next;
      }),
    })),
  };
}
