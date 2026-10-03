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
  { id: 'combat', label: 'Status' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'spells', label: 'Spells' },
  { id: 'gear', label: 'Attacks' },
  { id: 'character', label: 'Character' },
];
/*
 * #164: the labels and the homes below are a REAL arrangement, exported from a device that had
 * been played with, not a guess at one. Two ids now read oddly against their labels — `combat`
 * is labelled "Status" and `gear` is labelled "Attacks" — and that is deliberate: an id is
 * internal (it is the `#tab-<id>` / `#panel-<id>` node and the `home` key), while the label is
 * the only part a player sees. Renaming the ids would be a migration for every stored layout
 * that already references them, bought for nothing.
 */

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
 *   combat       → #hitDice #resources #death-successes #death-failures #exhaustion #conditions
 *   attacks      → #attacks
 *   abilities    → #abilities
 *   spellcasting → #spell-body #card-spellcasting
 *   spellslots   → #slots #card-spellslots
 *   spells       → #spells #card-spells
 *   inventory    → #inventory
 *   features     → #features
 */
export const CARD_REGISTRY = {
  combat: { label: 'Status', home: 'combat', cost: 'js', sel: '[data-editcard="combat"]' },
  // #164: its own tab rather than sharing Status. A fight reads one of two things — what is
  // happening to you, or what you are about to do — and the Status card is thirteen tiles deep,
  // so the attack rows used to start below the fold on a phone.
  attacks: { label: 'Attacks', home: 'gear', cost: 'js', sel: '[data-editcard="attacks"]' },
  // #164: saves are built by the same render as the scores and the skills (renderAbilities), and
  // the old title named two of the three.
  abilities: { label: 'Abilities, Saves & Skills', home: 'abilities', cost: 'js', sel: '[data-editcard="abilities"]' },
  spellcasting: { label: 'Spellcasting', home: 'spells', cost: 'js', sel: '[data-editcard="spellcasting"]' },
  // Split out of Spellcasting: the ability and its two derived numbers are set once, the slots
  // drain every fight, and separating them is what lets a player size or hide one without the
  // other. cost:'js' — renderSlots dereferences #slots with no null check.
  spellslots: { label: 'Spell Slots', home: 'spells', cost: 'js', sel: '[data-editcard="spellslots"]' },
  // #141. Its own card rather than a section of Spellcasting, which is the whole point of the
  // issue title: the slots and the spells are tracked at different moments and a player who
  // wants one on screen does not necessarily want the other. cost:'js' — renderSpells
  // dereferences #spells with no null check, so it may be hidden but never detached.
  spells: { label: 'Spells', home: 'spells', cost: 'js', sel: '[data-editcard="spells"]' },
  // #164: Gear became the Attacks tab, so what you own moved in with the rest of the reference
  // material you read between fights rather than during one.
  inventory: { label: 'Inventory', home: 'character', cost: 'js', sel: '[data-editcard="inventory"]' },
  features: { label: 'Features & Feats', home: 'character', cost: 'js', sel: '[data-editcard="features"]' },
  identity: { label: 'Identity', home: 'character', cost: 'markup', sel: '[data-editcard="identity"]' },
  proficiencies: { label: 'Proficiencies', home: 'character', cost: 'markup', sel: '[data-editcard="proficiencies"]' },
  notes: { label: 'Notes', home: 'character', cost: 'markup', sel: '[data-editcard="notes"]' },
};

/** Card ids in a stable default order (matches today: combat→attacks, inventory→features, …). */
export const CARD_ORDER = [
  // The Spells tab reads in order of how often you touch it: the ability and its two derived
  // numbers (set once), then the slots (spent every fight), then the list (revised at a long
  // rest). Arrange mode can reorder all three per device; this is only where they start.
  //
  // #164: only the order WITHIN a tab is visible — buildDefaultLayout filters this list by each
  // card's `home` — so moving `attacks` down here is not what moved it to its own tab; its
  // `home` did. The list still has to hold every card exactly once, because it also drives the
  // place-every-registry-card pass that keeps a cost:'js' host from going missing.
  //
  // Character reads outside-in: who they are, what they are trained in, what they can do, what
  // they carry, then the free-text notes last.
  'combat', 'abilities', 'spellcasting', 'spellslots', 'spells', 'attacks',
  'identity', 'proficiencies', 'features', 'inventory', 'notes',
];

/**
 * Objects — the placeable units INSIDE a card (#54 Phase 5), one level below cards. Located by
 * `data-object="<id>"`, the object analogue of `data-editcard`. `cost:'js'` objects contain a
 * render.js host, so they may be hidden (host stays present-but-hidden) but never detached.
 *
 * Phase 5 objectifies only the Combat card (its tiles + 5 status blocks; Temp HP folded into
 * the Hit Points tile and the Adjust HP tile retired in #65, Concentration added in #78,
 * Resources in #140); other cards stay whole.
 * `cost:'js'` object hosts, for reference: hitdice→#hitDice, resources→#resources,
 * deathsaves→#death-successes/#death-failures, exhaustion→#exhaustion, conditions→#conditions.
 *
 *   defaultSpan — the object's width in the card's twelve-column `.tiles` grid (#54 Phase 6),
 *                 reproducing today's layout: 12 (a whole row), 6 (half), 3 (a quarter). The
 *                 layout config carries the live per-object span; this is the value
 *                 reconciliation falls back to. Cards keep a single column for now.
 *   defaultHeight — the object's height in `--tile-step` units, same contract as defaultSpan one
 *                 field over (#164). Absent means 0, which is "as tall as its contents" and what
 *                 every tile was before this. It exists because the shipped default could express
 *                 order, width and naming but not height, so the arrangement the app ships with
 *                 could not be the arrangement anyone actually plays with. A non-zero value is an
 *                 EXACT height, not a floor: `.tile.is-sized` clips, which is the point of the
 *                 control — see normalizeHeight in layout.js.
 */
export const OBJECT_REGISTRY = {
  hp: { card: 'combat', label: 'Hit Points', cost: 'markup', defaultSpan: 12, defaultHeight: 7 },
  // #164: half a row. Three fixed-height tiles sit beside it on the same line, and a quarter-row
  // Rest cropped its own button text at 390px once the line stopped being four equal quarters.
  rest: { card: 'combat', label: 'Rest', cost: 'markup', defaultSpan: 6, defaultHeight: 7 },
  // #75: half the row by default. AC is read on every incoming attack and was visually
  // indistinguishable from Prof. Bonus, which never changes in play — span is the grid's
  // own way of encoding "this one matters more", and it costs no new CSS.
  // #164 narrows it back to a quarter. #75's reasoning was that span is how the grid says "this
  // one matters more" — but AC now leads the card instead of sitting seventh, and leading a row of
  // four equal quarters says it at least as well as being twice the width of a tile below the fold.
  ac: { card: 'combat', label: 'AC', cost: 'markup', defaultSpan: 3, defaultHeight: 5 },
  initiative: { card: 'combat', label: 'INIT.', cost: 'markup', defaultSpan: 3, defaultHeight: 5 },
  speed: { card: 'combat', label: 'Speed', cost: 'markup', defaultSpan: 3, defaultHeight: 5 },
  // #164: abbreviated, like INIT. above. These four share one line of quarters, and at 390px a
  // quarter is ~51px of label — "Prof. Bonus" wrapped to two lines and made the row taller than
  // the number it was labelling.
  pb: { card: 'combat', label: 'PB', cost: 'markup', defaultSpan: 3, defaultHeight: 5 },
  heroic: { card: 'combat', label: 'Heroic Insp.', cost: 'markup', defaultSpan: 3, defaultHeight: 7 },
  // #78. Label matches the static markup (see applyObjects) and is abbreviated to fit a
  // quarter-row tile.
  concentration: { card: 'combat', label: 'Conc.', cost: 'markup', defaultSpan: 3, defaultHeight: 7 },
  hitdice: { card: 'combat', label: 'Hit Point Dice', cost: 'js', defaultSpan: 12 },
  // #140. cost:'js' — renderRows dereferences #resources with no null check, so the tile may be
  // hidden but must never be detached. Full width like the other row-list tiles: a row is a name
  // that grows plus two counts, and a half-row would ellipsize every name worth reading.
  // The label MUST stay identical to the <h3> in index.html — applyObjects rewrites that node
  // from this string on every layout apply, so a mismatch silently overwrites the markup.
  resources: { card: 'combat', label: 'Class Resources', cost: 'js', defaultSpan: 12 },
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
  //   resources         #140: spent mid-fight like the two above — a Rage, a Bardic
  //                     Inspiration die, a Channel Divinity use — so it sits with them and
  //                     above the tiles read once a session.
  //   heroic, hitdice, exhaustion   occasional.
  //   initiative, speed, pb   read once a fight or never; pb never changes at all.
  //   rest              once per session and destructive, so it is last and no longer sits
  //                     next to the HP field a player taps every round.
  //
  // #164 reorders it again, from a layout that had actually been played with rather than from
  // reasoning about frequency. The shape that emerged is bands, not a ranking:
  //   pb, ac, initiative, speed          four quarters, all fixed-short — the numbers you READ.
  //                                      None of them changes mid-fight; together they are one
  //                                      glanceable strip instead of four tiles scattered by rank.
  //   heroic, rest, concentration        the three things you SPEND or TOGGLE, one line.
  //   hp                                 full width, directly under them.
  //   resources, conditions, hitdice,    the lists, content-height, in descending order of how
  //   deathsaves, exhaustion             often they are touched.
  // #75 put hp first and deathsaves second so the 0-HP path was one region; that still holds —
  // they are just no longer adjacent, because a death save is read in the lists band and current
  // HP is a field you type in every round.
  combat: [
    'pb', 'ac', 'initiative', 'speed',
    'heroic', 'rest', 'concentration',
    'hp',
    'resources', 'conditions', 'hitdice', 'deathsaves', 'exhaustion',
  ],
  // #67. Registering the order is what objectifies a card: normalizeCard backfills any object
  // missing from a saved layout, so every existing character gains both tiles with no migration.
  features: ['features', 'feats'],
};
