/**
 * Searching and filtering the SRD spell library, as pure functions (#149).
 *
 * DOM-free and side-effect-free, like rules.js, so the whole of it is under test — the ranking
 * is the part of a picker that quietly goes wrong (a search for "fire" that does not put
 * Fireball first is not obviously broken, it is just annoying forever).
 *
 * Deliberately does NOT import the data. `spell-data.js` is 330KB, and the picker loads it with
 * a dynamic import the first time it opens; a static import here would drag it into the boot
 * path of every module that wanted a search helper. Every function takes the spell array.
 *
 * This module knows nothing about characters. `spellToRow` is the one place the library shape
 * meets the app's row shape, and it produces a plain row the player can then edit like any
 * other — the library is a typing shortcut, not a source of truth. That is the whole tracker
 * premise: nothing here validates, and a spell in a character is just eight free-form fields.
 */

/**
 * The filter axes, in the order the picker shows them. Hardcoded rather than derived from the
 * data on every open: they are the closed sets the 2024 rules define, the picker needs them
 * before the 330KB import resolves, and a class list computed from the data would quietly
 * shrink if a regeneration dropped every Warlock spell.
 *
 * `SPELL_SCHOOLS` is checked against the data by the test suite, so a drift between this list
 * and what the library actually contains is a failing test rather than an empty filter.
 */
export const SPELL_CLASSES = ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'];
export const SPELL_SCHOOLS = [
  'Abjuration', 'Conjuration', 'Divination', 'Enchantment',
  'Evocation', 'Illusion', 'Necromancy', 'Transmutation',
];

/**
 * Fold the differences a player should not have to type: case, and the curly apostrophe the SRD
 * uses in "Otiluke's Resilient Sphere". A phone keyboard produces a straight one, so without
 * this the spell a player is most likely to search by name is the one they cannot find.
 */
export function normalizeText(value) {
  return String(value ?? '').toLowerCase().replace(/[’‘`]/g, "'").trim();
}

/**
 * Lowercased name/description per spell, cached against the ARRAY identity.
 *
 * Rebuilt per call it would be ~500KB of string allocation on every keystroke of a search, on a
 * phone. Keyed by the array a caller passes in (a WeakMap, so a discarded library is collectable)
 * rather than by a module-level flag, which would go stale the moment anything searched a
 * different set — the test suite searches half a dozen little fixtures.
 */
const indexes = new WeakMap();

function indexOf(spells) {
  let index = indexes.get(spells);
  if (!index) {
    index = spells.map((spell) => ({
      spell,
      name: normalizeText(spell.name),
      text: normalizeText(spell.text),
    }));
    indexes.set(spells, index);
  }
  return index;
}

/**
 * How well a spell answers a query. 0 means it does not.
 *
 * The tiers exist because substring matching alone ranks by array order, which is alphabetical,
 * so "fire" offers Fire Bolt, Fire Shield, Fire Storm… and buries Fireball. Word-start beats
 * mid-word so "storm" finds Storm Sphere over Firestorm-ish neighbours, and a description hit
 * ranks below every name hit so "fire damage" still works without drowning the name matches.
 */
function score(entry, query) {
  if (entry.name === query) return 5;
  if (entry.name.startsWith(query)) return 4;
  if (new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(entry.name)) return 3;
  if (entry.name.includes(query)) return 2;
  if (entry.text.includes(query)) return 1;
  return 0;
}

/**
 * The picker's one query function: filters, then text, then ranking.
 *
 * Every filter is "empty means all", so an untouched picker lists the whole library rather than
 * nothing — the failure mode where a player opens a search and sees an empty list has no way of
 * telling them that a filter, not the library, is why.
 *
 * `levels`/`classes`/`schools` are OR within an axis and AND across them: level 1 or 2, AND a
 * Wizard spell. That is how a player says "what can I actually prepare tonight".
 */
export function searchSpells(spells, options = {}) {
  const {
    text = '', levels = [], classes = [], schools = [],
    concentration = null, ritual = null, limit = 0,
  } = options;

  const query = normalizeText(text);
  const wantLevels = new Set(levels.map(Number));
  const wantClasses = new Set(classes.map(normalizeText));
  const wantSchools = new Set(schools.map(normalizeText));

  const matches = [];
  for (const entry of indexOf(spells)) {
    const spell = entry.spell;
    if (wantLevels.size && !wantLevels.has(Number(spell.level))) continue;
    if (wantSchools.size && !wantSchools.has(normalizeText(spell.school))) continue;
    if (wantClasses.size
      && !(spell.classes || []).some((c) => wantClasses.has(normalizeText(c)))) continue;
    if (concentration !== null && Boolean(spell.concentration) !== concentration) continue;
    if (ritual !== null && Boolean(spell.ritual) !== ritual) continue;

    const rank = query ? score(entry, query) : 1;
    if (rank === 0) continue;
    matches.push({ spell, rank });
  }

  // Rank, then level, then name: with no query every rank is 1, so the list reads as the
  // library in its natural order (cantrips first, alphabetical within a level) rather than in
  // whatever order the generator happened to emit.
  matches.sort((a, b) => (
    b.rank - a.rank
    || Number(a.spell.level) - Number(b.spell.level)
    || a.spell.name.localeCompare(b.spell.name)
  ));

  const found = matches.map((m) => m.spell);
  return limit > 0 ? found.slice(0, limit) : found;
}

/**
 * A library entry as a spell ROW — the app's shape, not the library's.
 *
 * Every field is copied, not referenced: the row is the player's from here on, editable and
 * deletable like one they typed, and nothing in the app ever looks a spell back up. That is why
 * there is no `srdId` — a stored reference would make the sheet depend on a library version, and
 * a player's edit to a description would be silently overwritten by the next regeneration.
 *
 * `prepared` starts false. Adding a spell to the list is not preparing it, and the tick is the
 * one thing on this card a player touches every long rest — pre-ticking it would quietly claim
 * they had made that decision.
 */
export function spellToRow(spell) {
  return {
    name: String(spell?.name ?? ''),
    level: Number.isFinite(Number(spell?.level)) ? Number(spell.level) : 0,
    prepared: false,
    castingTime: String(spell?.castingTime ?? ''),
    range: String(spell?.range ?? ''),
    duration: String(spell?.duration ?? ''),
    components: String(spell?.components ?? ''),
    notes: String(spell?.text ?? ''),
  };
}

/**
 * The one-line summary under a name in the results list: "Level 3 Evocation · Wizard, Sorcerer".
 * Cantrips say "Cantrip" rather than "Level 0", because the rules do.
 */
export function spellSummary(spell) {
  const level = Number(spell?.level) === 0 ? 'Cantrip' : `Level ${Number(spell?.level)}`;
  const parts = [`${level} ${spell?.school ?? ''}`.trim()];
  if (spell?.classes?.length) parts.push(spell.classes.join(', '));
  if (spell?.concentration) parts.push('Concentration');
  if (spell?.ritual) parts.push('Ritual');
  return parts.join(' · ');
}
