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
