/**
 * The component registry — *what* can be placed in the layout (#54).
 *
 * A parallel structure to constants.js: pure static data, no side effects, no DOM,
 * so both the app and tests can import it freely. It answers "what units exist and
 * what does each cost to move/hide" — never "where do they currently sit" (that is
 * the layout config, js/layout.js).
 *
 * Granularity for now is tab + card. The current DOM has 5 tabs and 8 cards; the
 * "13 cards" in the issue predates the #14 grouping merge, which folded HP/stats/
 * status/conditions into one Combat card and abilities/saves/skills into one
 * Abilities card. The finer boxes come back as *objects* in a later phase.
 */

/** The 5 tabs, in default order. `id` matches the `#tab-<id>` / `#panel-<id>` convention. */
export const TAB_REGISTRY = [
  { id: 'combat', label: 'Combat' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'spells', label: 'Spells' },
  { id: 'gear', label: 'Gear' },
  { id: 'character', label: 'Character' },
];

/**
 * The 8 cards, keyed by id (also each card's `data-editcard` value, which is how the
 * DOM apply step finds the live node — `sel`).
 *
 *   home  — the tab a card lives on by default, and where reconciliation re-homes it.
 *   cost  — 'js'     : the card contains a render.js host dereferenced with no null
 *                      check (see hosts below), so it may be hidden but must NEVER be
 *                      detached, or the next render throws. This is the safety oracle.
 *           'markup' : only static fields; free to move/hide/detach.
 *   sel   — the selector locating the live card node (a data string; no DOM access here).
 *
 * cost:'js' host ids, for reference (must stay in the DOM):
 *   combat       → #hitDice #death-successes #death-failures #exhaustion #conditions
 *   attacks      → #attacks
 *   abilities    → #abilities
 *   spellcasting → #slots #spell-body #card-spellcasting
 *   inventory    → #inventory
 *   features     → #features
 */
export const CARD_REGISTRY = {
  combat: { label: 'Combat', home: 'combat', cost: 'js', sel: '[data-editcard="combat"]' },
  attacks: { label: 'Attacks', home: 'combat', cost: 'js', sel: '[data-editcard="attacks"]' },
  abilities: { label: 'Abilities & Skills', home: 'abilities', cost: 'js', sel: '[data-editcard="abilities"]' },
  spellcasting: { label: 'Spellcasting', home: 'spells', cost: 'js', sel: '[data-editcard="spellcasting"]' },
  inventory: { label: 'Inventory', home: 'gear', cost: 'js', sel: '[data-editcard="inventory"]' },
  features: { label: 'Features & Traits', home: 'gear', cost: 'js', sel: '[data-editcard="features"]' },
  identity: { label: 'Identity', home: 'character', cost: 'markup', sel: '[data-editcard="identity"]' },
  notes: { label: 'Notes', home: 'character', cost: 'markup', sel: '[data-editcard="notes"]' },
};

/** Card ids in a stable default order (matches today: combat→attacks, inventory→features, …). */
export const CARD_ORDER = [
  'combat', 'attacks', 'abilities', 'spellcasting', 'inventory', 'features', 'identity', 'notes',
];

/**
 * Objects — the placeable units INSIDE a card (#54 Phase 5), one level below cards. Located by
 * `data-object="<id>"`, the object analogue of `data-editcard`. `cost:'js'` objects contain a
 * render.js host, so they may be hidden (host stays present-but-hidden) but never detached.
 *
 * Phase 5 objectifies only the Combat card (its 9 tiles + 4 status blocks); other cards stay
 * whole. `cost:'js'` object hosts, for reference: hitdice→#hitDice, deathsaves→#death-successes
 * /#death-failures, exhaustion→#exhaustion, conditions→#conditions.
 *
 *   defaultSpan — the object's width within the `.tiles` grid (#54 Phase 6), reproducing today's
 *                 layout: `'full'` (a whole grid row, `grid-column: 1 / -1`), `2` (two tracks),
 *                 or `1` (one track). The layout config carries the live per-object span; this is
 *                 the value reconciliation falls back to. Cards keep a single column for now.
 */
export const OBJECT_REGISTRY = {
  hp: { card: 'combat', label: 'Hit Points', cost: 'markup', defaultSpan: 'full' },
  'adjust-hp': { card: 'combat', label: 'Adjust HP', cost: 'markup', defaultSpan: 'full' },
  'temp-hp': { card: 'combat', label: 'Temp HP', cost: 'markup', defaultSpan: 1 },
  rest: { card: 'combat', label: 'Rest', cost: 'markup', defaultSpan: 1 },
  ac: { card: 'combat', label: 'AC', cost: 'markup', defaultSpan: 1 },
  initiative: { card: 'combat', label: 'Initiative', cost: 'markup', defaultSpan: 1 },
  speed: { card: 'combat', label: 'Speed', cost: 'markup', defaultSpan: 1 },
  pb: { card: 'combat', label: 'Prof. Bonus', cost: 'markup', defaultSpan: 1 },
  heroic: { card: 'combat', label: 'Heroic Insp.', cost: 'markup', defaultSpan: 1 },
  hitdice: { card: 'combat', label: 'Hit Point Dice', cost: 'js', defaultSpan: 'full' },
  deathsaves: { card: 'combat', label: 'Death Saves', cost: 'js', defaultSpan: 'full' },
  exhaustion: { card: 'combat', label: 'Exhaustion', cost: 'js', defaultSpan: 'full' },
  conditions: { card: 'combat', label: 'Conditions', cost: 'js', defaultSpan: 'full' },
};

/** The valid object spans, in cycle order — the ↔ resize control steps 1 → 2 → full → 1. */
export const OBJECT_SPANS = [1, 2, 'full'];

/** Default object order per card (matches today's DOM). Only `combat` has objects this phase. */
export const OBJECT_ORDER = {
  combat: [
    'hp', 'adjust-hp', 'temp-hp', 'rest', 'ac', 'initiative', 'speed', 'pb', 'heroic',
    'hitdice', 'deathsaves', 'exhaustion', 'conditions',
  ],
};
