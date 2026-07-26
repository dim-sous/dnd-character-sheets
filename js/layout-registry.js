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
  features: { label: 'Features & Feats', home: 'gear', cost: 'js', sel: '[data-editcard="features"]' },
  identity: { label: 'Identity', home: 'character', cost: 'markup', sel: '[data-editcard="identity"]' },
  proficiencies: { label: 'Proficiencies', home: 'character', cost: 'markup', sel: '[data-editcard="proficiencies"]' },
  notes: { label: 'Notes', home: 'character', cost: 'markup', sel: '[data-editcard="notes"]' },
};

/** Card ids in a stable default order (matches today: combat→attacks, inventory→features, …). */
export const CARD_ORDER = [
  'combat', 'attacks', 'abilities', 'spellcasting', 'inventory', 'features',
  'identity', 'proficiencies', 'notes',
];

/**
 * Objects — the placeable units INSIDE a card (#54 Phase 5), one level below cards. Located by
 * `data-object="<id>"`, the object analogue of `data-editcard`. `cost:'js'` objects contain a
 * render.js host, so they may be hidden (host stays present-but-hidden) but never detached.
 *
 * Phase 5 objectifies only the Combat card (its tiles + 4 status blocks; Temp HP folded into
 * the Hit Points tile and the Adjust HP tile retired in #65, Concentration added in #78);
 * other cards stay whole.
 * `cost:'js'` object hosts, for reference: hitdice→#hitDice, deathsaves→#death-successes
 * /#death-failures, exhaustion→#exhaustion, conditions→#conditions.
 *
 *   defaultSpan — the object's width in the card's twelve-column `.tiles` grid (#54 Phase 6),
 *                 reproducing today's layout: 12 (a whole row), 6 (half), 3 (a quarter). The
 *                 layout config carries the live per-object span; this is the value
 *                 reconciliation falls back to. Cards keep a single column for now.
 */
export const OBJECT_REGISTRY = {
  hp: { card: 'combat', label: 'Hit Points', cost: 'markup', defaultSpan: 12 },
  rest: { card: 'combat', label: 'Rest', cost: 'markup', defaultSpan: 3 },
  // #75: half the row by default. AC is read on every incoming attack and was visually
  // indistinguishable from Prof. Bonus, which never changes in play — span is the grid's
  // own way of encoding "this one matters more", and it costs no new CSS.
  ac: { card: 'combat', label: 'AC', cost: 'markup', defaultSpan: 6 },
  initiative: { card: 'combat', label: 'Initiative', cost: 'markup', defaultSpan: 3 },
  speed: { card: 'combat', label: 'Speed', cost: 'markup', defaultSpan: 3 },
  pb: { card: 'combat', label: 'Prof. Bonus', cost: 'markup', defaultSpan: 3 },
  heroic: { card: 'combat', label: 'Heroic Insp.', cost: 'markup', defaultSpan: 3 },
  // #78. Label matches the static markup (see applyObjects) and is abbreviated to fit a
  // quarter-row tile.
  concentration: { card: 'combat', label: 'Conc.', cost: 'markup', defaultSpan: 3 },
  hitdice: { card: 'combat', label: 'Hit Point Dice', cost: 'js', defaultSpan: 12 },
  deathsaves: { card: 'combat', label: 'Death Saves', cost: 'js', defaultSpan: 12 },
  exhaustion: { card: 'combat', label: 'Exhaustion', cost: 'js', defaultSpan: 12 },
  conditions: { card: 'combat', label: 'Conditions', cost: 'js', defaultSpan: 12 },
  // #67: the second objectified card. Both own a render.js host (#features / #feats), so
  // cost:'js' — hiding one keeps the host in the DOM, it is never detached.
  features: { card: 'features', label: 'Features', cost: 'js', defaultSpan: 12 },
  feats: { card: 'features', label: 'Feats', cost: 'js', defaultSpan: 12 },
};

/**
 * The `.tiles` grid is TWELVE columns. It was four — `auto-fit, minmax(4.5rem, 1fr)` — which
 * permitted exactly three widths, and that is the only reason resizing was a three-step cycle
 * (one track, two tracks, the whole row) rather than something continuous.
 *
 * Twelve is an exact refinement of four, not a redesign. A span of three covers three tracks
 * plus the two gaps inside them: 3·(W − 11g)/12 + 2g, which reduces to (W − 3g)/4 — the old
 * track width, to the pixel. So 1 → 3, 2 → 6, full → 12 reproduces every layout anyone has
 * already saved, and the nine widths in between are new.
 *
 * SPAN_MIN is 2, not 1: a twelfth of a 390px card is ~22px, while two tracks is ~51px — the
 * narrowest a tile can be and still hold a 44px touch target.
 */
export const GRID_COLUMNS = 12;
export const SPAN_MIN = 2;
export const SPAN_MAX = GRID_COLUMNS;

/**
 * A tile's height, counted in `--tile-step` units. 0 — every object's default, and the only
 * value the slider never writes — means "as tall as its contents", which is what every tile has
 * always been and what every layout saved before this reads as.
 *
 * An explicit height rather than a minimum. A minimum is not a height control: it can only ever
 * add space, so the shortest thing a tile could be was already the tallest thing inside it, and
 * the slider's bottom end did nothing. Real heights shrink as well as grow, which is what
 * `.tile.is-sized` clipping and the collapsed label reservation in style.css are there to
 * absorb.
 *
 * The step is deliberately small (.75rem — see style.css) and the range deliberately short: a
 * tile is naturally 6–8 steps, so 4..16 is roughly half to double, with the thumb landing near
 * the middle and useful travel in both directions. A taller ceiling only adds stops nobody
 * drags to.
 *
 * HEIGHT_SET_MIN is where the slider bottoms out rather than 1: four steps is ~48px, a tile that
 * can still hold a 44px control. HEIGHT_MIN stays 0 because that is the storage floor, and 0
 * means something different in kind from a height.
 */
export const HEIGHT_MIN = 0;
export const HEIGHT_SET_MIN = 4;
export const HEIGHT_MAX = 16;

/** Default object order per card (matches today's DOM). Only `combat` has objects this phase. */
export const OBJECT_ORDER = {
  // #75: ordered by frequency-of-use in play, not by the historical DOM order.
  //   hp → deathsaves   the 0-HP path is ONE region; these used to sit at indices 0 and 9
  //                     with seven unrelated objects between them.
  //   ac                read on every incoming attack.
  //   conditions, concentration   change often mid-fight (conditions was ordered last,
  //                     below the invariant PB tile).
  //   heroic, hitdice, exhaustion   occasional.
  //   initiative, speed, pb   read once a fight or never; pb never changes at all.
  //   rest              once per session and destructive, so it is last and no longer sits
  //                     next to the HP field a player taps every round.
  combat: [
    'hp', 'deathsaves', 'ac', 'conditions', 'concentration', 'heroic',
    'hitdice', 'exhaustion', 'initiative', 'speed', 'pb', 'rest',
  ],
  // #67. Registering the order is what objectifies a card: normalizeCard backfills any object
  // missing from a saved layout, so every existing character gains both tiles with no migration.
  features: ['features', 'feats'],
};
