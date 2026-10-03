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

/**
 * The `kind` discriminator written into an exported layout file (#162), and the ONLY thing that
 * makes a blob a layout rather than something else that happens to parse.
 *
 * It exists because `normalizeLayout` cannot refuse anything: a character backup, `null`, `42`,
 * `'garbage'` and `{}` all normalize to a layout deep-equal to DEFAULT_LAYOUT. That is right for
 * the LOAD path — a layout is reconstructible, so a damaged one should quietly become the shipped
 * arrangement — and catastrophic for an IMPORT path, where the same behaviour reads as "imported
 * successfully" while replacing the player's work with the factory default. So the importer
 * validates the envelope BEFORE normalizing, and normalizeLayout is never the discriminator.
 */
export const LAYOUT_FILE_KIND = 'dnd-character-sheets/layout';

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
 * The object's EXPLICIT height in `--tile-step` units. 0 is "as tall as its contents", and is
 * both the default and where anything unparseable lands — a layout with no height at all (every
 * layout saved before this existed) reads as today's behaviour rather than as a broken tile.
 *
 * Any non-zero value is an exact height, not a floor: `.tile.is-sized` in style.css sets `height`
 * with `overflow: hidden`, so a tile can be made SHORTER than its contents and clips. That is the
 * point of the control — as a minimum it could only ever add space, which left the whole lower
 * half of the slider doing nothing (#114). These docstrings said "minimum height" for one release
 * after that changed, which describes a different feature from the one that ships.
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
 * A tab id that is safe to interpolate into a selector (#162).
 *
 * render.js resolves a tab with `document.querySelector('#tab-' + id)` and layout-view's
 * tab-edit rows with `.tabrow[data-tab="<id>"]`. An id holding a SPACE turns `#tab-my tab` into
 * a descendant selector that matches nothing: `activateTab` skips that tab while hiding every
 * other panel, so the sheet goes blank — and only at phone width, because at >=900px and in
 * print `.tabpanel[hidden]{display:contents!important}` reveals them all, so a single-width
 * probe run reports PASS. An id holding a `"` makes the selector invalid and throws straight out
 * of `activateTab`, which breaks the "a corrupt blob can never crash a render... Never throws"
 * promise normalizeLayout makes below.
 *
 * This was latent while ids could only come from TAB_REGISTRY or `newId()`. An imported file is
 * arbitrary text, which is what makes it reachable — so the guard belongs HERE and not in the
 * importer: a hand-edited localStorage value arrives through the identical door.
 *
 * Substitution, not rejection, following mergeCharacters' re-id-rather-than-drop: the tab and its
 * label survive a bad id. Deterministic and idempotent (a sanitized id sanitizes to itself), so
 * normalizeLayout stays JSON-round-trip stable. An id that is ENTIRELY unsafe reduces to '' and
 * is dropped by the caller's existing blank-id check; its cards are re-homed by the
 * place-every-card pass, so nothing is lost.
 */
function safeTabId(raw) {
  return raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
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
    // v2 is named explicitly rather than left to `default`, which is what it used to fall
    // through to. While LAYOUT_SCHEMA_VERSION is 2 the two branches behave identically, so this
    // changes nothing today — but `default` meaning "current" is only true until the next bump,
    // and the moment the version becomes 3 without someone adding `case 2: upgradeV2toV3(raw)`,
    // every v2 blob on every device falls into `default` and is read as v3 unmigrated. That is
    // the same silent rewrite the v0/v1 comment above exists to prevent, and it matters more now
    // that layouts travel as FILES: a file outlives the build that wrote it.
    case 2: return raw;
    // A version this build has never heard of. The load path still best-efforts it (a layout is
    // reconstructible and refusing would strand the player on the default anyway); the IMPORT
    // path refuses it outright in parseLayoutFile, because there the misread blob would overwrite
    // an arrangement the player still has.
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
    // Sanitized BEFORE the dedupe check, so two ids that differ only in unsafe characters
    // collapse to one tab rather than two tabs fighting over one `#tab-<id>` node.
    const id = safeTabId(typeof rawTab.id === 'string' ? rawTab.id.trim() : '');
    if (!id || byId.has(id)) continue;
    const regLabel = (TAB_REGISTRY.find((t) => t.id === id) || {}).label;
    // Stored TRIMMED. The test was always on the trimmed value while the stored one kept its
    // padding, so a label of '   Spells   ' round-tripped with the whitespace intact — harmless
    // from the arrange UI, which trims in renameTab, and reachable from an imported file.
    const label = str(rawTab.label, '').trim() ? rawTab.label.trim() : (regLabel || id);

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

/* ------------------------------------------------- export / import (#162) */

/*
 * A layout is a per-device display preference with no backup path: it lives under its own
 * localStorage key, it is NOT part of a character export, and the app's own README calls export
 * "the only backup" while meaning characters only. So clearing site data, reinstalling the PWA or
 * picking up a second device silently destroyed an arrangement that is a dozen deliberate
 * decisions deep, and there was no way to carry one between devices or to make one the shared
 * starting point for a table. These four functions are the file format for that.
 *
 * The read side is deliberately NOT a thin wrapper over normalizeLayout — see LAYOUT_FILE_KIND.
 */

/** The export envelope, as a plain object. `dateStr` is injected, mirroring characterFilename. */
export function layoutExportEnvelope(layout, dateStr = '') {
  return { kind: LAYOUT_FILE_KIND, exportedAt: dateStr, layout };
}

/**
 * The envelope as text, in storage.js's `JSON.stringify(…, null, 2)` house style.
 *
 * The payload is NESTED under `layout` rather than spread across the envelope, and that is a
 * safety property rather than tidiness: with a spread payload `normalizeLayout(parsed)` WORKS
 * (unknown top-level keys are dropped), so an implementer who skipped the `kind` check would get
 * a feature that passes every happy-path test and factory-resets the player's layout when fed a
 * character file. Nested, `parsed.layout` is undefined for anything that is not one of these
 * files, so that mistake cannot be made. It also keeps exactly ONE version field — the payload's
 * own `layoutSchemaVersion`, which is what `migrate` reads — because a duplicate on the envelope
 * is a second source of truth, and desyncing it re-arms the span rescale below.
 */
export function serializeLayout(layout, dateStr = '') {
  return JSON.stringify(layoutExportEnvelope(layout, dateStr), null, 2);
}

/** `dnd-layout-<date>.json` — a different prefix from `dnd-characters-<date>.json`, because the
 *  Downloads folder is where the two files actually get confused. */
export function layoutFilename(dateStr) {
  return `dnd-layout-${dateStr}.json`;
}

/** Every componentId a raw payload mentions, in order, however the card entry is shaped. */
function mentionedCards(rawTabs) {
  const out = [];
  for (const tab of Array.isArray(rawTabs) ? rawTabs : []) {
    if (!tab || typeof tab !== 'object') continue;
    for (const card of Array.isArray(tab.cards) ? tab.cards : []) {
      const id = typeof card === 'string' ? card
        : (card && typeof card === 'object' ? card.componentId : null);
      if (typeof id === 'string' && id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * Read an exported layout file. Never throws; returns a discriminated result:
 *
 *   { ok: true,  layout, droppedCards: [...], addedCards: [...], tabCount, cardCount }
 *   { ok: false, error: '<one sentence to show the player>' }
 *
 * The order of the checks is the point. Each one has to run before normalizeLayout, because
 * normalizeLayout answers "what is the nearest valid layout to this?" and never "is this a
 * layout?" — so by the time it has run, a character backup and a real import are
 * indistinguishable.
 *
 * `droppedCards`/`addedCards` exist because normalizeLayout's losses are USER-VISIBLE and silent:
 * a file carrying a card this build does not know imports as an EMPTY TAB, which reads as a bug
 * rather than as a dropped card. The counts are returned rather than announced so the sentence
 * the player sees is testable here, in the DOM-free suite.
 */
export function parseLayoutFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(typeof text === 'string' ? text : '');
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the whole file, including the outer braces. Nothing has been changed.' };
  }

  // Checked FIRST, and positively, so the message names the mistake a real player will actually
  // make. A roster backup is `{ schemaVersion, characters: [...] }` and readImportFile also
  // accepts a bare array, so both shapes are caught.
  if (Array.isArray(parsed) || Array.isArray(parsed?.characters)) {
    return { ok: false, error: 'That is a character backup, not a layout. Import characters with the Import button in the character list. Nothing has been changed.' };
  }

  if (!parsed || typeof parsed !== 'object' || parsed.kind !== LAYOUT_FILE_KIND
      || !parsed.layout || typeof parsed.layout !== 'object' || Array.isArray(parsed.layout)) {
    return { ok: false, error: 'That is not a layout export this app can read. Nothing has been changed.' };
  }

  // Refused rather than best-effort loaded, which is the opposite of the character path — and the
  // calculus really does invert. A character file may be the only copy of irreplaceable data, so
  // refusing it strands the player; a layout is reconstructible, the file is still in the textarea
  // or the Downloads folder, and importing it OVERWRITES the arrangement they currently have. A
  // silent downgrade here would also drop every field this build does not know and then re-stamp
  // the result as current, so the misread layout would be the only one left.
  const fileVersion = Number(parsed.layout.layoutSchemaVersion);
  if (Number.isFinite(fileVersion) && fileVersion > LAYOUT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `That layout was saved by a newer version of the app (format ${fileVersion}; this build reads ${LAYOUT_SCHEMA_VERSION}). Update the app and import it again. Nothing has been changed.`,
    };
  }

  // The single most important guard in the feature: this is the ONE case where a successful import
  // and a factory reset are indistinguishable to the player, because normalizeLayout hands back
  // DEFAULT_LAYOUT for a payload with no usable tabs and the result looks like a working import.
  const rawTabs = parsed.layout.tabs;
  const usableTab = Array.isArray(rawTabs)
    && rawTabs.some((t) => t && typeof t === 'object' && typeof t.id === 'string' && safeTabId(t.id.trim()));
  if (!usableTab) {
    return { ok: false, error: 'That layout file has no tabs in it. Nothing has been changed.' };
  }

  const layout = normalizeLayout(parsed.layout);
  const mentioned = mentionedCards(rawTabs);
  return {
    ok: true,
    layout,
    droppedCards: mentioned.filter((id) => !CARD_REGISTRY[id]),
    addedCards: CARD_ORDER.filter((id) => !mentioned.includes(id)),
    tabCount: layout.tabs.length,
    cardCount: layout.tabs.reduce((n, tab) => n + tab.cards.length, 0),
  };
}

/** `n thing` / `n things`, so the sentences below read as English at every count. */
function plural(n, word, plural_ = `${word}s`) {
  return `${n} ${n === 1 ? word : plural_}`;
}

/**
 * The sentence shown after a successful import, built from parseLayoutFile's counts.
 *
 * Here rather than in layout-view.js so the WORDING is testable in the DOM-free suite — the
 * whole reason the parser returns counts instead of announcing them itself. It has to name the
 * losses because normalizeLayout's are silent and user-visible: a file carrying a card this
 * build does not know imports as an EMPTY TAB, which reads as a bug rather than a dropped card.
 */
export function layoutImportSummary(result) {
  if (!result || !result.ok) return '';
  const parts = [`Layout imported: ${plural(result.tabCount, 'tab')}, ${plural(result.cardCount, 'card')}.`];
  const dropped = result.droppedCards || [];
  const added = result.addedCards || [];
  if (dropped.length) {
    parts.push(`${plural(dropped.length, 'card')} this version does not recognise ${dropped.length === 1 ? 'was' : 'were'} left out (${dropped.join(', ')}).`);
  }
  if (added.length) {
    const names = added.map((id) => (CARD_REGISTRY[id] || {}).label || id);
    parts.push(`${plural(added.length, 'card')} the file did not mention ${added.length === 1 ? 'was' : 'were'} added at ${added.length === 1 ? 'its' : 'their'} usual place (${names.join(', ')}).`);
  }
  return parts.join(' ');
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
 * Set one object's explicit height, in `--tile-step` units, within its card (immutable). Out of
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
