/**
 * The rules test suite — framework-free and DOM-free, so the exact same assertions
 * run in the browser (tests.html) and under Node (tools/run-tests.mjs, and CI).
 *
 * This exists because rules.js is pure — no DOM, no state, no side effects — so every
 * derived number on the sheet can be checked by calling a function and comparing the
 * result. That is the entire argument for keeping the arithmetic separate from the
 * rendering, and the reason the same file can run in either place with no test framework.
 */
import { blankCharacter, MAX_EXHAUSTION, SCHEMA_VERSION } from './js/constants.js';
import * as rules from './js/rules.js';
import { normalizeCharacter, parseStored, mergeCharacters } from './js/storage.js';
// state.js is safe to import: its module scope has no side effects (it does not call
// init/load/localStorage), and only its PURE exports getByPath/setByPath are used here.
// DO NOT call state.js mutators from this suite — they end in a debounced save() that,
// when tests.html runs in a browser, overwrites the user's real roster under the shared
// STORAGE_KEY. Cover only the pure surface. (Verified: import is side-effect-free.)
import { getByPath, setByPath } from './js/state.js';
// nudges.js: same rule — only the pure decision functions; the record/snooze helpers
// write localStorage and stay untested here.
import { shouldRemindBackup, shouldSuggestInstall, normalizeNudgeState } from './js/nudges.js';
// layout.js is pure/DOM-free (the browser-only half is layout-view.js, never imported
// here), so its reconciliation is covered exactly like normalizeCharacter above.
import {
  normalizeLayout, DEFAULT_LAYOUT, LAYOUT_SCHEMA_VERSION, tabIds, cardsOf,
  moveCard, moveCardToTab, renameCard, addTab, removeTab, renameTab, moveTab,
  moveObject, toggleObjectHidden, setObjectSpan, cycleSpan, renameObject,
} from './js/layout.js';
import {
  CARD_REGISTRY, TAB_REGISTRY, OBJECT_REGISTRY, OBJECT_ORDER, OBJECT_SPANS,
} from './js/layout-registry.js';

const results = [];
let group = '';

const describe = (name) => { group = name; };

function is(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ group, label, ok, actual, expected });
}

/** A character built by tweaking the canonical blank one. */
function char(overrides = {}) {
  return { ...blankCharacter(), ...overrides };
}

/* ---------------------------------------------------------- ability mod */

describe('abilityMod');
is('1 → −5', rules.abilityMod(1), -5);
is('8 → −1', rules.abilityMod(8), -1);
is('9 → −1 (rounds down, not toward zero)', rules.abilityMod(9), -1);
is('10 → 0', rules.abilityMod(10), 0);
is('11 → 0', rules.abilityMod(11), 0);
is('15 → +2', rules.abilityMod(15), 2);
is('20 → +5', rules.abilityMod(20), 5);
is('30 → +10', rules.abilityMod(30), 10);
is('garbage falls back to 10', rules.abilityMod('abc'), 0);

/* --------------------------------------------------- proficiency bonus */

describe('proficiencyBonus');
is('level 1 → +2', rules.proficiencyBonus(1), 2);
is('level 3 → +2', rules.proficiencyBonus(3), 2);
is('level 4 → +2', rules.proficiencyBonus(4), 2);
is('level 5 → +3 (first step)', rules.proficiencyBonus(5), 3);
is('level 8 → +3', rules.proficiencyBonus(8), 3);
is('level 9 → +4', rules.proficiencyBonus(9), 4);
is('level 12 → +4', rules.proficiencyBonus(12), 4);
is('level 20 → +6', rules.proficiencyBonus(20), 6);
is('blank/0 level floors at +2 (never +1)', rules.proficiencyBonus(0), 2);
is('negative level floors at +2', rules.proficiencyBonus(-5), 2);

/* ------------------------------------------------------------ formatMod */

describe('formatMod');
is('0 → "+0"', rules.formatMod(0), '+0');
is('3 → "+3"', rules.formatMod(3), '+3');
is('−1 → "−1" (true minus sign)', rules.formatMod(-1), '−1');

/* ----------------------------------------------------------- save total */

describe('saveTotal');
{
  const c = char({
    level: 3,
    abilities: { str: 16, dex: 10, con: 14, int: 8, wis: 12, cha: 10 },
    saveProficiencies: ['str', 'con'],
  });
  is('proficient STR 16 at L3 → +5', rules.saveTotal(c, 'str'), 5);
  is('proficient CON 14 at L3 → +4', rules.saveTotal(c, 'con'), 4);
  is('non-proficient INT 8 → −1', rules.saveTotal(c, 'int'), -1);
  is('non-proficient DEX 10 → +0', rules.saveTotal(c, 'dex'), 0);
}

/* ---------------------------------------------------------- skill total */

describe('skillTotal');
{
  const c = char({
    level: 3,
    abilities: { str: 16, dex: 14, con: 10, int: 10, wis: 12, cha: 10 },
    skillProficiencies: ['athletics'],
    skillExpertise: [],
  });
  is('Athletics: STR +3, prof +2 → +5', rules.skillTotal(c, 'athletics'), 5);
  is('Acrobatics: DEX +2, no prof → +2', rules.skillTotal(c, 'acrobatics'), 2);

  c.skillExpertise = ['athletics'];
  is('Athletics with expertise → +7 (PB twice)', rules.skillTotal(c, 'athletics'), 7);

  c.level = 5; // PB becomes +3
  is('same at L5 → +9', rules.skillTotal(c, 'athletics'), 9);

  // The arithmetic stays permissive: expertise-implies-proficiency (#5) is enforced
  // by toggleInArray and normalizeCharacter, not here. A pair that dodges both
  // doors (hand-built state, as in this test) degrades to one PB, not two.
  const d = char({ level: 3, skillProficiencies: [], skillExpertise: ['stealth'] });
  is('expertise alone → one PB, not two', rules.skillTotal(d, 'stealth'), 2);

  is('unknown skill key → 0', rules.skillTotal(c, 'basketweaving'), 0);
}

/* ---------------------------------------------- skill misc bonuses (#57) */

describe('skillTotal misc bonuses (#57)');
{
  const flat = char({ skillBonusAll: 2 });
  is('flat skillBonusAll adds to a skill with no prof/expertise', rules.skillTotal(flat, 'acrobatics'), 2);

  const flatWithProf = char({
    level: 3, skillProficiencies: ['athletics'], skillExpertise: ['athletics'], skillBonusAll: 2,
  });
  is('flat skillBonusAll stacks on top of prof + expertise', rules.skillTotal(flatWithProf, 'athletics'), 6);

  const perSkill = char({
    abilities: { ...blankCharacter().abilities, wis: 12 },
    skillBonuses: { ...blankCharacter().skillBonuses, insight: 3 },
  });
  is('per-skill skillBonuses adds only to the listed skill', rules.skillTotal(perSkill, 'insight'), 4);
  is('per-skill skillBonuses leaves other skills untouched', rules.skillTotal(perSkill, 'acrobatics'), 0);

  const combined = char({
    abilities: { ...blankCharacter().abilities, wis: 12 },
    skillBonusAll: -1,
    skillBonuses: { ...blankCharacter().skillBonuses, insight: 3 },
  });
  is('skillBonusAll and skillBonuses combine additively', rules.skillTotal(combined, 'insight'), 3);
  is('unknown skill key → 0 even when bonuses are set', rules.skillTotal(combined, 'basketweaving'), 0);
}

/* --------------------------------------- skill/save proficiency markers */

describe('skillMarker / saveMarker (skills-edit collapsed view)');
{
  const c = char({
    skillProficiencies: ['athletics'],
    skillExpertise: ['stealth'],
    saveProficiencies: ['con'],
  });
  is('proficient only → P', rules.skillMarker(c, 'athletics'), 'P');
  is('expertise → E', rules.skillMarker(c, 'stealth'), 'E');
  is('neither → empty string', rules.skillMarker(c, 'acrobatics'), '');
  is('unknown skill key → empty string', rules.skillMarker(c, 'basketweaving'), '');
  is('save proficient → P', rules.saveMarker(c, 'con'), 'P');
  is('save not proficient → empty string', rules.saveMarker(c, 'dex'), '');
}

/* ---------------------------------------------- passive perception, init */

describe('passivePerception & initiative');
{
  const c = char({ level: 3, abilities: { ...blankCharacter().abilities, wis: 14 } });
  is('WIS 14, no prof → 12', rules.passivePerception(c), 12);

  c.skillProficiencies = ['perception'];
  is('WIS 14, proficient at L3 → 14', rules.passivePerception(c), 14);

  const d = char({ abilities: { ...blankCharacter().abilities, dex: 18 }, initiativeBonus: 2 });
  is('DEX 18 with +2 bonus → +6', rules.initiative(d), 6);
}

/* ------------------------------------------------------------- spellcasting */

describe('spellcasting');
{
  const martial = char({ level: 5 });
  is('no ability set → not a caster', rules.isSpellcaster(martial), false);
  is('no ability set → DC is null', rules.spellSaveDC(martial), null);
  is('no ability set → attack is null', rules.spellAttackBonus(martial), null);

  const caster = char({
    level: 5, // PB +3
    abilities: { ...blankCharacter().abilities, cha: 18 }, // +4
  });
  caster.spellcasting.ability = 'cha';
  is('is a caster', rules.isSpellcaster(caster), true);
  is('DC = 8 + 3 + 4 → 15', rules.spellSaveDC(caster), 15);
  is('attack = 3 + 4 → +7', rules.spellAttackBonus(caster), 7);
}

/* ------------------------------------------------------------------- HP */

describe('applyDamage');
is('plain damage', rules.applyDamage({ max: 30, current: 20, temp: 0 }, 7).current, 13);
is('temp absorbs first', rules.applyDamage({ max: 30, current: 20, temp: 3 }, 7),
   { max: 30, current: 16, temp: 0 });
is('temp fully absorbs', rules.applyDamage({ max: 30, current: 20, temp: 10 }, 7),
   { max: 30, current: 20, temp: 3 });
is('current floors at 0', rules.applyDamage({ max: 30, current: 4, temp: 0 }, 99).current, 0);
is('does not mutate its input', (() => {
  const hp = { max: 30, current: 20, temp: 5 };
  rules.applyDamage(hp, 10);
  return hp;
})(), { max: 30, current: 20, temp: 5 });

describe('applyHealing');
is('heals up to max', rules.applyHealing({ max: 30, current: 20, temp: 0 }, 5).current, 25);
is('caps at max', rules.applyHealing({ max: 30, current: 28, temp: 0 }, 99).current, 30);
is('unbounded when max is 0', rules.applyHealing({ max: 0, current: 3, temp: 0 }, 5).current, 8);
is('leaves temp alone', rules.applyHealing({ max: 30, current: 10, temp: 4 }, 5).temp, 4);
is('never lowers a current already above max', rules.applyHealing({ max: 30, current: 35, temp: 0 }, 5).current, 35);

/* ------------------------------------------------ restoreHitDice (long rest) */

describe('restoreHitDice');
{
  // 2024 long rest: every spent Hit Point Die comes back — each pool to its own total.
  is('empty pool → full', rules.restoreHitDice([{ size: 'd8', total: 4, remaining: 0 }])[0].remaining, 4);
  is('partial pool → full', rules.restoreHitDice([{ size: 'd10', total: 6, remaining: 5 }])[0].remaining, 6);
  is('full pool stays full', rules.restoreHitDice([{ size: 'd10', total: 3, remaining: 3 }])[0].remaining, 3);
  is('total 1 → 1', rules.restoreHitDice([{ size: 'd8', total: 1, remaining: 0 }])[0].remaining, 1);

  // Multiclass: each pool is independently restored to its own total. No fill-in-order,
  // no overflow, no redistribution — restore-all removed that whole question.
  const multi = rules.restoreHitDice([
    { size: 'd10', total: 3, remaining: 0 },
    { size: 'd6', total: 2, remaining: 1 },
  ]);
  is('first pool → full', multi[0].remaining, 3);
  is('second pool → full', multi[1].remaining, 2);

  // The die size (and any other field) rides along untouched.
  is('keeps the die size', rules.restoreHitDice([{ size: 'd12', total: 2, remaining: 0 }])[0].size, 'd12');

  // Pure — does not mutate the pools passed in.
  is('does not mutate input', (() => {
    const pools = [{ size: 'd8', total: 4, remaining: 1 }];
    rules.restoreHitDice(pools);
    return pools;
  })(), [{ size: 'd8', total: 4, remaining: 1 }]);
}

/* -------------------------------------------------------- hitDice migration */

describe('hitDice migration');
{
  // Pre-v2 saves and old exported backups stored a single object; it must fold into a
  // one-row list with the die preserved (issue #1's data-loss guard).
  const migrated = normalizeCharacter({ hitDice: { size: 'd10', total: 3, remaining: 2 } });
  is('old object → array', Array.isArray(migrated.hitDice), true);
  is('old object → one row', migrated.hitDice.length, 1);
  is('die preserved', migrated.hitDice[0], { size: 'd10', total: 3, remaining: 2 });

  // The new multiclass shape passes straight through.
  const multiclass = normalizeCharacter({
    hitDice: [{ size: 'd10', total: 3, remaining: 3 }, { size: 'd6', total: 2, remaining: 1 }],
  });
  is('list keeps both pools', multiclass.hitDice.length, 2);
  is('second pool preserved', multiclass.hitDice[1], { size: 'd6', total: 2, remaining: 1 });

  // A garbage entry in the list is coerced to a template row, never dropped or crashed.
  const messy = normalizeCharacter({ hitDice: [{ size: 'd12' }, 'nonsense'] });
  is('partial row filled from template', messy.hitDice[0], { size: 'd12', total: 1, remaining: 1 });
  is('garbage row → template row', messy.hitDice[1], { size: 'd8', total: 1, remaining: 1 });

  // A record with no hitDice at all still gets the default one-row list.
  const bare = normalizeCharacter({});
  is('missing → default list', bare.hitDice, [{ size: 'd8', total: 3, remaining: 3 }]);
}

/* ------------------------------------------------ parseStored (data safety) */

describe('parseStored');
{
  // Unreadable data must be flagged corrupt, with the original text preserved so the app
  // can back it up instead of silently overwriting it (issue #22).
  const bad = parseStored('{ not valid json');
  is('unparseable → corrupt flag', bad.corrupt === true, true);
  is('unparseable → raw text preserved', bad.raw, '{ not valid json');
  is('unparseable → no characters', bad.characters.length, 0);

  // Valid JSON of the wrong shape is corrupt too, not silently treated as empty.
  is('non-array payload → corrupt', parseStored('{"nope":1}').corrupt === true, true);

  // Empty storage is a normal first run, not corruption.
  const empty = parseStored('');
  is('empty string → not corrupt', Boolean(empty.corrupt), false);
  is('empty string → empty list', empty.characters.length, 0);

  // A well-formed payload loads and normalizes.
  const good = parseStored(JSON.stringify({ schemaVersion: 2, characters: [{ name: 'Aria' }] }));
  is('valid → one character', good.characters.length, 1);
  is('valid → not corrupt', Boolean(good.corrupt), false);
  is('valid → normalized through', good.characters[0].name, 'Aria');
}

/* ------------------------------------------------ path get/set (state.js) */

describe('getByPath & setByPath');
is('shallow read', getByPath({ a: 1 }, 'a'), 1);
is('nested read', getByPath({ hp: { current: 5 } }, 'hp.current'), 5);
is('deep read on blank', getByPath(blankCharacter(), 'spellcasting.ability'), '');
is('numeric-in-path slot read', getByPath(blankCharacter(), 'spellcasting.slots.3.total'), 0);
is('missing leaf → undefined', getByPath({ a: {} }, 'a.b'), undefined);
is('missing intermediate → undefined (no throw)', getByPath({ a: {} }, 'a.b.c'), undefined);
is('null intermediate → undefined (no throw)', getByPath({ a: null }, 'a.b'), undefined);
is('read a whole object key', getByPath({ hp: { current: 5 } }, 'hp'), { current: 5 });
is('shallow write', (() => { const o = { a: 1 }; setByPath(o, 'a', 2); return o.a; })(), 2);
is('nested write', (() => { const o = { hp: { current: 5 } }; setByPath(o, 'hp.current', 9); return o.hp.current; })(), 9);
is('deep write into blank slot total', (() => { const c = blankCharacter(); setByPath(c, 'spellcasting.slots.3.total', 4); return c.spellcasting.slots[3].total; })(), 4);
is('write leaves siblings alone', (() => { const c = blankCharacter(); setByPath(c, 'hp.current', 7); return c.hp; })(), { max: 0, current: 7, temp: 0 });
is('write returns undefined', setByPath({ a: { b: 1 } }, 'a.b', 2), undefined);
// Contract: paths must already exist. updateActive only ever writes blankCharacter paths,
// so this never bites in production, but the throw is the documented behaviour.
is('write to missing intermediate throws', (() => { try { setByPath({}, 'a.b', 1); return 'no-throw'; } catch (e) { return 'threw'; } })(), 'threw');

/* ------------------------------------ normalizeCharacter clamp & coercion */

describe('normalizeCharacter clamping');
is('deathSaves.successes clamps high', normalizeCharacter({ deathSaves: { successes: 9 } }).deathSaves.successes, 3);
is('deathSaves.failures clamps negative', normalizeCharacter({ deathSaves: { failures: -4 } }).deathSaves.failures, 0);
is('deathSaves non-number → 0', normalizeCharacter({ deathSaves: { successes: 'x' } }).deathSaves.successes, 0);
is('deathSaves missing → 0/0', normalizeCharacter({}).deathSaves, { successes: 0, failures: 0 });
is('exhaustion clamps to MAX', normalizeCharacter({ exhaustion: 99 }).exhaustion, MAX_EXHAUSTION);
is('exhaustion clamps negative', normalizeCharacter({ exhaustion: -3 }).exhaustion, 0);
is('exhaustion in range passes', normalizeCharacter({ exhaustion: 4 }).exhaustion, 4);
is('level from numeric string', normalizeCharacter({ level: '7' }).level, 7);
is('level garbage → base 3', normalizeCharacter({ level: 'abc' }).level, 3);
is('hp coercion mixed', normalizeCharacter({ hp: { max: '20', current: '15', temp: 'x' } }).hp, { max: 20, current: 15, temp: 0 });
is('hp missing → 0/0/0', normalizeCharacter({}).hp, { max: 0, current: 0, temp: 0 });
is('conditions filters non-strings', normalizeCharacter({ conditions: ['Prone', 5, null, 'Poisoned'] }).conditions, ['Prone', 'Poisoned']);
is('conditions non-array → []', normalizeCharacter({ conditions: 'Prone' }).conditions, []);
is('saveProficiencies filters non-strings', normalizeCharacter({ saveProficiencies: ['str', 3] }).saveProficiencies, ['str']);
is('expertise without proficiency is promoted', normalizeCharacter({ skillExpertise: ['stealth'] }).skillProficiencies, ['stealth']);
is('promoted expertise is kept', normalizeCharacter({ skillExpertise: ['stealth'] }).skillExpertise, ['stealth']);
is('promotion does not duplicate proficiency', normalizeCharacter({ skillProficiencies: ['stealth'], skillExpertise: ['stealth'] }).skillProficiencies, ['stealth']);
is('promotion appends after existing proficiencies', normalizeCharacter({ skillProficiencies: ['athletics'], skillExpertise: ['stealth'] }).skillProficiencies, ['athletics', 'stealth']);
is('promoted pair yields expert total (mod + 2×PB)', rules.skillTotal(normalizeCharacter({ level: 3, skillExpertise: ['stealth'] }), 'stealth'), 4);
is('currency coercion + unknown key ignored', normalizeCharacter({ currency: { gp: '50', xx: 1 } }).currency, { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 });
is('currency missing → zeros', normalizeCharacter({}).currency, { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
is('abilities coercion', normalizeCharacter({ abilities: { str: '18' } }).abilities.str, 18);
is('abilities unknown key dropped', Object.keys(normalizeCharacter({ abilities: { str: 18, zzz: 5 } }).abilities), ['str', 'dex', 'con', 'int', 'wis', 'cha']);
is('abilities missing → all 10', normalizeCharacter({}).abilities, { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
is('skillBonusAll coercion from string', normalizeCharacter({ skillBonusAll: '3' }).skillBonusAll, 3);
is('skillBonusAll missing → 0', normalizeCharacter({}).skillBonusAll, 0);
is('skillBonusAll garbage → 0', normalizeCharacter({ skillBonusAll: 'x' }).skillBonusAll, 0);
is('skillBonuses coercion', normalizeCharacter({ skillBonuses: { insight: '3' } }).skillBonuses.insight, 3);
is('skillBonuses unknown key dropped', 'zzz' in normalizeCharacter({ skillBonuses: { insight: 3, zzz: 5 } }).skillBonuses, false);
is('skillBonuses missing → all 18 skill keys at 0', normalizeCharacter({}).skillBonuses, blankCharacter().skillBonuses);
is('skillBonuses non-object → all zero (default)', normalizeCharacter({ skillBonuses: 'nope' }).skillBonuses, blankCharacter().skillBonuses);
is('name non-string → empty', normalizeCharacter({ name: 42 }).name, '');
is('name string passes', normalizeCharacter({ name: 'Aria' }).name, 'Aria');
is('heroicInspiration truthy → true', normalizeCharacter({ heroicInspiration: 1 }).heroicInspiration, true);
is('heroicInspiration missing → false', normalizeCharacter({}).heroicInspiration, false);
is('ac coercion', normalizeCharacter({ ac: '16' }).ac, 16);
is('speed garbage → base 30', normalizeCharacter({ speed: 'x' }).speed, 30);
is('id string preserved', normalizeCharacter({ id: 'abc' }).id, 'abc');
is('id missing → generated non-empty string', typeof normalizeCharacter({}).id === 'string' && normalizeCharacter({}).id.length > 0, true);

/* -------------------------------------- normalizeCharacter row coercion */

describe('normalizeCharacter rows');
is('attack number → string coercion', normalizeCharacter({ attacks: [{ bonus: 5 }] }).attacks[0].bonus, '5');
is('attack garbage row → template', normalizeCharacter({ attacks: ['nope'] }).attacks[0], { name: '', bonus: '', damage: '', notes: '' });
is('attacks non-array → []', normalizeCharacter({ attacks: {} }).attacks, []);
is('inventory qty coercion', normalizeCharacter({ inventory: [{ item: 'Rope', qty: '3' }] }).inventory[0].qty, 3);
is('inventory qty garbage → template 1', normalizeCharacter({ inventory: [{ item: 'Rope', qty: 'x' }] }).inventory[0].qty, 1);
is('spell prepared → boolean', normalizeCharacter({ spellcasting: { spells: [{ name: 'X', prepared: 1 }] } }).spellcasting.spells[0].prepared, true);
is('spell level coercion', normalizeCharacter({ spellcasting: { spells: [{ level: '2' }] } }).spellcasting.spells[0].level, 2);

/* ------------------------------------- normalizeCharacter spell slots */

describe('normalizeCharacter slots');
is('slot from string key', normalizeCharacter({ spellcasting: { slots: { '3': { total: 4, used: 1 } } } }).spellcasting.slots[3], { total: 4, used: 1 });
is('slot from numeric key', normalizeCharacter({ spellcasting: { slots: { 3: { total: 2, used: 0 } } } }).spellcasting.slots[3], { total: 2, used: 0 });
is('slot missing → 0/0', normalizeCharacter({}).spellcasting.slots[5], { total: 0, used: 0 });
is('slots always cover 1..9', Object.keys(normalizeCharacter({}).spellcasting.slots), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
is('spellcasting ability passthrough', normalizeCharacter({ spellcasting: { ability: 'cha' } }).spellcasting.ability, 'cha');
is('spellcasting ability default ""', normalizeCharacter({}).spellcasting.ability, '');
is('spellcasting ability non-string → ""', normalizeCharacter({ spellcasting: { ability: 7 } }).spellcasting.ability, '');
// A backup can carry more slots spent than exist (or a negative). Clamp on the way in to the
// same [0, total] range state.js enforces at runtime, so an import can't paint phantom pips.
is('slot used clamps down to total', normalizeCharacter({ spellcasting: { slots: { 1: { total: 3, used: 9 } } } }).spellcasting.slots[1], { total: 3, used: 3 });
is('slot used clamps negative to 0', normalizeCharacter({ spellcasting: { slots: { 2: { total: 2, used: -4 } } } }).spellcasting.slots[2], { total: 2, used: 0 });
is('slot used equal to total passes', normalizeCharacter({ spellcasting: { slots: { 4: { total: 2, used: 2 } } } }).spellcasting.slots[4], { total: 2, used: 2 });
is('slot used within range passes', normalizeCharacter({ spellcasting: { slots: { 5: { total: 4, used: 1 } } } }).spellcasting.slots[5], { total: 4, used: 1 });

/* -------------------------------------------- mergeCharacters (storage) */

describe('mergeCharacters');
is('no collision keeps both, order preserved', mergeCharacters([{ id: 'a' }], [{ id: 'b' }]).map((c) => c.id), ['a', 'b']);
is('no collision length', mergeCharacters([{ id: 'a' }], [{ id: 'b' }]).length, 2);
is('collision renumbers only the incoming dup', (() => { const r = mergeCharacters([{ id: 'a' }], [{ id: 'a', name: 'dup' }]); return r[0].id === 'a' && r[1].id !== 'a' && r[1].name === 'dup' && r.length === 2; })(), true);
is('collision within the incoming batch', (() => { const r = mergeCharacters([], [{ id: 'x' }, { id: 'x' }]); return r.length === 2 && r[0].id === 'x' && r[1].id !== 'x' && r[0].id !== r[1].id; })(), true);
is('empty incoming → existing unchanged', mergeCharacters([{ id: 'a' }], []).map((c) => c.id), ['a']);
is('empty existing → incoming kept', mergeCharacters([], [{ id: 'a' }]).map((c) => c.id), ['a']);
is('does not mutate the existing array', (() => { const ex = [{ id: 'a' }]; mergeCharacters(ex, [{ id: 'a' }]); return ex.length; })(), 1);

/* --------------------------------------- parseStored (more shapes) */

describe('parseStored (more shapes)');
is('bare top-level array → characters', parseStored(JSON.stringify([{ name: 'X' }])).characters.length, 1);
is('bare array → normalized name', parseStored(JSON.stringify([{ name: 'X' }])).characters[0].name, 'X');
is('bare array → not corrupt', Boolean(parseStored(JSON.stringify([{ name: 'X' }])).corrupt), false);
is('empty array payload → empty, not corrupt', parseStored('[]').characters.length, 0);
is('empty array → not corrupt', Boolean(parseStored('[]').corrupt), false);
is('JSON number payload → corrupt', parseStored('42').corrupt === true, true);
is('JSON null payload → corrupt', parseStored('null').corrupt === true, true);

/* ------------------------------------ parseStored schema version (issue #31c) */

describe('parseStored (schema version)');
// A backup written by a NEWER build is loaded best-effort but flagged, so the app can warn
// before an edit here silently drops fields this build doesn't understand.
is('newer schemaVersion → flagged', parseStored(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, characters: [{ name: 'A' }] })).fromNewerVersion, true);
is('newer backup still loads best-effort', parseStored(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, characters: [{ name: 'A' }] })).characters[0].name, 'A');
is('newer backup is not corrupt', Boolean(parseStored(JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, characters: [] })).corrupt), false);
is('current schemaVersion → not flagged', Boolean(parseStored(JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters: [] })).fromNewerVersion), false);
is('older schemaVersion → not flagged', Boolean(parseStored(JSON.stringify({ schemaVersion: SCHEMA_VERSION - 1, characters: [] })).fromNewerVersion), false);
is('missing schemaVersion → not flagged', Boolean(parseStored(JSON.stringify({ characters: [] })).fromNewerVersion), false);
is('bare array (no version) → not flagged', Boolean(parseStored(JSON.stringify([{ name: 'X' }])).fromNewerVersion), false);
is('garbage schemaVersion → not flagged', Boolean(parseStored(JSON.stringify({ schemaVersion: 'x', characters: [] })).fromNewerVersion), false);

/* -------------------------------------------- rules boundary cases */

describe('rules boundaries');
is('applyDamage negative amount → no change', rules.applyDamage({ max: 30, current: 20, temp: 5 }, -7), { max: 30, current: 20, temp: 5 });
is('applyDamage garbage amount → no change', rules.applyDamage({ max: 30, current: 20, temp: 0 }, 'x').current, 20);
is('applyDamage temp exactly equals dmg', rules.applyDamage({ max: 30, current: 20, temp: 7 }, 7), { max: 30, current: 20, temp: 0 });
is('applyHealing negative → no change', rules.applyHealing({ max: 30, current: 20, temp: 0 }, -5).current, 20);
is('applyHealing garbage → no change', rules.applyHealing({ max: 30, current: 20, temp: 0 }, 'x').current, 20);
is('applyHealing does not mutate input', (() => { const hp = { max: 30, current: 10, temp: 0 }; rules.applyHealing(hp, 5); return hp; })(), { max: 30, current: 10, temp: 0 });
is('proficiencyBonus garbage level → +2', rules.proficiencyBonus('abc'), 2);
is('initiative garbage bonus → dex mod only', rules.initiative({ abilities: { dex: 14 }, initiativeBonus: 'x' }), 2);
is('formatMod large negative', rules.formatMod(-10), '−10');
is('restoreHitDice garbage total → 0', rules.restoreHitDice([{ size: 'd8', total: 'x', remaining: 5 }])[0].remaining, 0);

/* -------------------------------------------- backup & install nudges (#32) */

describe('nudges');
{
  const DAY = 24 * 60 * 60 * 1000;
  const now = 100 * DAY; // fixed fake clock — the decisions take `now` as an input

  is('no characters → no backup nudge', shouldRemindBackup({ firstSeenAt: 1 }, now, false), false);
  is('empty meta (very first visit) → no nudge', shouldRemindBackup({}, now, true), false);
  is('fresh device inside the cadence → no nudge', shouldRemindBackup({ firstSeenAt: now - DAY }, now, true), false);
  is('never exported, quiet 15 days → nudge', shouldRemindBackup({ firstSeenAt: now - 15 * DAY }, now, true), true);
  is('exactly at the cadence boundary → not yet', shouldRemindBackup({ firstSeenAt: now - 14 * DAY }, now, true), false);
  is('recent export resets the clock', shouldRemindBackup({ firstSeenAt: now - 40 * DAY, lastBackupAt: now - DAY }, now, true), false);
  is('stale export → nudge', shouldRemindBackup({ firstSeenAt: 1, lastBackupAt: now - 15 * DAY }, now, true), true);
  is('active snooze wins over a stale export', shouldRemindBackup({ firstSeenAt: 1, lastBackupAt: now - 15 * DAY, backupSnoozedUntil: now + DAY }, now, true), false);
  is('expired snooze → nudge returns', shouldRemindBackup({ firstSeenAt: 1, lastBackupAt: now - 15 * DAY, backupSnoozedUntil: now - 1 }, now, true), true);

  // An anchor describes the past, so a future firstSeenAt from a skewed clock is
  // IGNORED, not floored to now. A lone future anchor yields "no anchor yet" (the
  // stateful recordFirstSeen re-stamps it on load); crucially it must not MASK a
  // valid older lastBackupAt, and an extreme value must not mute the reminder.
  is('lone future firstSeenAt → no valid anchor, no nudge', shouldRemindBackup({ firstSeenAt: now + 30 * DAY }, now, true), false);
  is('future firstSeenAt does NOT mask a stale valid backup', shouldRemindBackup({ firstSeenAt: now + 30 * DAY, lastBackupAt: now - 15 * DAY }, now, true), true);
  is('extreme future firstSeenAt is ignored, not muted', shouldRemindBackup({ firstSeenAt: 8.98e307, lastBackupAt: now - 15 * DAY }, now, true), true);
  is('once the clock passes a future firstSeenAt it counts normally', shouldRemindBackup({ firstSeenAt: now + 30 * DAY }, now + 45 * DAY, true), true);

  is('install: not iOS → no', shouldSuggestInstall({}, now, false, false, true), false);
  is('install: already installed → no', shouldSuggestInstall({}, now, true, true, true), false);
  is('install: no characters → no', shouldSuggestInstall({}, now, true, false, false), false);
  is('install: iOS browser with characters → yes', shouldSuggestInstall({}, now, true, false, true), true);
  is('install: active snooze → no', shouldSuggestInstall({ installSnoozedUntil: now + DAY }, now, true, false, true), false);
  is('install: expired snooze → returns', shouldSuggestInstall({ installSnoozedUntil: now - 1 }, now, true, false, true), true);
  // A snooze further out than its own cadence is a skewed-clock artifact — expired,
  // not honored, so a bad clock can suppress the nudge by at most one cadence.
  is('install: skewed-clock snooze (far future) → not muted', shouldSuggestInstall({ installSnoozedUntil: now + 5 * 365 * DAY }, now, true, false, true), true);
  is('backup: skewed-clock snooze (far future) → not muted', shouldRemindBackup({ firstSeenAt: 1, lastBackupAt: now - 15 * DAY, backupSnoozedUntil: now + 5 * 365 * DAY }, now, true), true);
  is('backup: snooze exactly one cadence out is honored', shouldRemindBackup({ firstSeenAt: 1, lastBackupAt: now - 15 * DAY, backupSnoozedUntil: now + 14 * DAY }, now, true), false);

  // Hand-edited state is an input class, not an error (same bar as normalizeCharacter).
  // A garbage timestamp must be DROPPED, not kept: kept, it would NaN-poison Math.max
  // and permanently kill the reminder; dropped, recordFirstSeen can re-stamp it.
  is('normalize: date-string timestamp is dropped', normalizeNudgeState({ firstSeenAt: '2026-01-01' }), {});
  is('normalize: negative and zero are dropped', normalizeNudgeState({ lastBackupAt: -5, firstSeenAt: 0 }), {});
  is('normalize: numeric string survives as a number', normalizeNudgeState({ firstSeenAt: '123' }), { firstSeenAt: 123 });
  is('normalize: valid fields pass, unknown keys are dropped', normalizeNudgeState({ firstSeenAt: 7, junk: true }), { firstSeenAt: 7 });
  is('normalize: null → {}', normalizeNudgeState(null), {});
  is('normalize: array → {}', normalizeNudgeState([1, 2]), {});
  is('poisoned meta no longer mutes a valid backup clock', shouldRemindBackup(normalizeNudgeState({ firstSeenAt: 'garbage', lastBackupAt: now - 15 * DAY }), now, true), true);
}

/* ---------------------------------------------------- normalizeLayout (#54) */

describe('normalizeLayout');
{
  const CARD_IDS = Object.keys(CARD_REGISTRY);
  const TAB_IDS = TAB_REGISTRY.map((t) => t.id);
  const JS_CARDS = CARD_IDS.filter((id) => CARD_REGISTRY[id].cost === 'js');

  // Every componentId across a layout, flattened in placement order.
  const placed = (layout) => layout.tabs.flatMap((tab) => tab.cards.map((c) => c.componentId));
  const count = (arr, x) => arr.filter((v) => v === x).length;

  // Corrupt / empty inputs all reconstruct the default — a layout is never unrecoverable.
  is('null → DEFAULT_LAYOUT', normalizeLayout(null), DEFAULT_LAYOUT);
  is('undefined → DEFAULT_LAYOUT', normalizeLayout(undefined), DEFAULT_LAYOUT);
  is('number → DEFAULT_LAYOUT', normalizeLayout(42), DEFAULT_LAYOUT);
  is('string → DEFAULT_LAYOUT', normalizeLayout('garbage'), DEFAULT_LAYOUT);
  is('object with junk tabs → DEFAULT_LAYOUT', normalizeLayout({ tabs: 'nope' }), DEFAULT_LAYOUT);
  is('empty array → DEFAULT_LAYOUT', normalizeLayout({ tabs: [] }), DEFAULT_LAYOUT);

  // The default is already normal.
  is('DEFAULT_LAYOUT is stamped v1', DEFAULT_LAYOUT.layoutSchemaVersion, LAYOUT_SCHEMA_VERSION);
  is('idempotent on default', normalizeLayout(DEFAULT_LAYOUT), DEFAULT_LAYOUT);

  // Full coverage: all 5 tabs and all 8 cards, each card exactly once, whatever the input.
  const fromEmpty = normalizeLayout({ tabs: [] });
  is('empty input restores all tabs', tabIds(fromEmpty), TAB_IDS);
  is('empty input places every card once', placed(fromEmpty).sort(), [...CARD_IDS].sort());

  // Anti-crash guarantee: an input that names every tab but places NO cards must still end
  // with every cost:'js' host card present exactly once (else render.js dereferences null).
  const noCards = normalizeLayout({ tabs: TAB_IDS.map((id) => ({ id, cards: [] })) });
  is('js host cards all present when input omits every card',
    JS_CARDS.every((id) => count(placed(noCards), id) === 1), true);
  is('omitted cards land at their home tab',
    cardsOf(noCards, 'combat'), CARD_IDS.filter((id) => CARD_REGISTRY[id].home === 'combat'));

  // Idempotence + JSON round-trip on a non-trivial (reordered, partial) layout.
  const partial = {
    layoutSchemaVersion: 1,
    tabs: [
      { id: 'gear', label: 'Loot', cards: [{ componentId: 'features' }] },
      { id: 'combat', cards: [{ componentId: 'attacks' }, { componentId: 'combat' }] },
    ],
  };
  const norm = normalizeLayout(partial);
  is('partial: only the input tabs are kept (missing NOT restored)',
    tabIds(norm), ['gear', 'combat']);
  is('partial: custom tab label preserved', norm.tabs[0].label, 'Loot');
  is('partial: within-tab card order honored (attacks before combat)',
    cardsOf(norm, 'combat'), ['attacks', 'combat']);
  is('partial: every card still present exactly once',
    placed(norm).slice().sort(), [...CARD_IDS].sort());
  is('idempotent on a partial layout', normalizeLayout(norm), norm);
  is('JSON round-trips unchanged', normalizeLayout(JSON.parse(JSON.stringify(norm))), norm);

  // Unknown COMPONENT ids are dropped; a non-registry TAB id is now KEPT (a user-created
  // tab — Tab CRUD, #54). Either way every card still lands exactly once.
  const stale = normalizeLayout({
    tabs: [
      { id: 'combat', cards: [{ componentId: 'combat' }, { componentId: 'ghost-card' }] },
      { id: 'my-tab', label: 'My Tab', cards: [{ componentId: 'attacks' }] },
    ],
  });
  is('unknown componentId dropped', placed(stale).includes('ghost-card'), false);
  is('user-created tab id is kept', tabIds(stale).includes('my-tab'), true);
  is('user tab keeps its card', cardsOf(stale, 'my-tab'), ['attacks']);
  is('every card still placed exactly once (with a user tab)',
    placed(stale).slice().sort(), [...CARD_IDS].sort());

  // Tab-set is input-driven now, never registry-whitelisted or floor-restored above 1.
  {
    const oneTab = normalizeLayout({ tabs: [{ id: 'combat', cards: [{ componentId: 'combat' }] }] });
    is('a single-tab layout stays single-tab (no phantom tabs)', tabIds(oneTab), ['combat']);
    is('every card re-homes onto the surviving tab',
      placed(oneTab).slice().sort(), [...CARD_IDS].sort());
    is('js hosts still all present on the lone tab',
      JS_CARDS.every((id) => count(placed(oneTab), id) === 1), true);

    is('tabs with no usable id → DEFAULT',
      normalizeLayout({ tabs: [{ label: 'x' }, { id: '' }] }), DEFAULT_LAYOUT);

    const noGear = normalizeLayout({ tabs: [{ id: 'combat', cards: [] }, { id: 'spells', cards: [] }] });
    is('a card whose home tab is gone re-homes to the first tab',
      cardsOf(noGear, 'combat').includes('inventory'), true);
  }

  // A duplicated card collapses to a single placement (keep first).
  const dup = normalizeLayout({
    tabs: [
      { id: 'combat', cards: [{ componentId: 'combat' }, { componentId: 'combat' }] },
      { id: 'gear', cards: [{ componentId: 'combat' }] },
    ],
  });
  is('duplicate componentId collapses to one', count(placed(dup), 'combat'), 1);

  // Bare-string card entries (hand-edited) are tolerated and coerced, in order (the rest of
  // the single tab's cards are the re-homed remainder).
  const strings = normalizeLayout({ tabs: [{ id: 'combat', cards: ['attacks', 'combat'] }] });
  is('string card entries coerced to { componentId }',
    cardsOf(strings, 'combat').slice(0, 2), ['attacks', 'combat']);

  // Version handling: an old/absent version normalizes forward to the current stamp.
  is('absent version stamped forward',
    normalizeLayout({ tabs: [] }).layoutSchemaVersion, LAYOUT_SCHEMA_VERSION);
  is('old version stamped forward',
    normalizeLayout({ layoutSchemaVersion: 0, tabs: [] }).layoutSchemaVersion, LAYOUT_SCHEMA_VERSION);
}

/* ----------------------------------------------------- moveCard / resetTabCards (#54) */

describe('moveCard');
{
  const cardsIn = (layout, tabId) => cardsOf(layout, tabId);

  // gear holds [inventory, features] by default.
  is('move down: inventory (0) → 1', cardsIn(moveCard(DEFAULT_LAYOUT, 'gear', 0, 1), 'gear'),
    ['features', 'inventory']);
  is('move up: features (1) → 0', cardsIn(moveCard(DEFAULT_LAYOUT, 'gear', 1, 0), 'gear'),
    ['features', 'inventory']);

  // Clamps to a no-op at both ends (the ↑/↓ buttons call this with fromIndex ± 1).
  is('move up past top is a no-op', cardsIn(moveCard(DEFAULT_LAYOUT, 'gear', 0, -1), 'gear'),
    ['inventory', 'features']);
  is('move down past bottom is a no-op', cardsIn(moveCard(DEFAULT_LAYOUT, 'gear', 1, 2), 'gear'),
    ['inventory', 'features']);

  // Out-of-range fromIndex and unknown tab are no-ops.
  is('out-of-range fromIndex → unchanged', moveCard(DEFAULT_LAYOUT, 'gear', 9, 0), DEFAULT_LAYOUT);
  is('unknown tab → unchanged', moveCard(DEFAULT_LAYOUT, 'nope', 0, 1), DEFAULT_LAYOUT);

  // Other tabs are untouched by a move.
  is('combat tab unchanged when gear moves',
    cardsIn(moveCard(DEFAULT_LAYOUT, 'gear', 0, 1), 'combat'), ['combat', 'attacks']);

  // Immutability: the input layout is never mutated.
  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    moveCard(DEFAULT_LAYOUT, 'gear', 0, 1);
    is('input layout not mutated', JSON.stringify(DEFAULT_LAYOUT), before);
  }

  // A moved layout is still normal (idempotent under normalizeLayout).
  {
    const moved = moveCard(DEFAULT_LAYOUT, 'combat', 0, 1);
    is('moved layout survives normalize unchanged', normalizeLayout(moved), moved);
  }
}

describe('moveCardToTab');
{
  const CARD_IDS = Object.keys(CARD_REGISTRY);
  const placed = (layout) => layout.tabs.flatMap((tab) => tab.cards.map((c) => c.componentId));

  // Send attacks (Combat) → Spells; it leaves the source and lands at the destination end.
  const moved = moveCardToTab(DEFAULT_LAYOUT, 'attacks', 'spells');
  is('card removed from source tab', cardsOf(moved, 'combat'), ['combat']);
  is('card appended to destination end', cardsOf(moved, 'spells'), ['spellcasting', 'attacks']);
  is('other tabs untouched', cardsOf(moved, 'gear'), ['inventory', 'features']);

  // Invariant: still exactly one of every card after a cross-tab move.
  is('every card still placed exactly once', placed(moved).slice().sort(), [...CARD_IDS].sort());

  // No-ops: same tab, unknown card, unknown destination.
  is('same-tab target is a no-op', moveCardToTab(DEFAULT_LAYOUT, 'combat', 'combat'), DEFAULT_LAYOUT);
  is('unknown card is a no-op', moveCardToTab(DEFAULT_LAYOUT, 'ghost', 'spells'), DEFAULT_LAYOUT);
  is('unknown destination is a no-op', moveCardToTab(DEFAULT_LAYOUT, 'attacks', 'nope'), DEFAULT_LAYOUT);

  // Immutability + a moved layout is still normal.
  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    moveCardToTab(DEFAULT_LAYOUT, 'attacks', 'spells');
    is('input layout not mutated', JSON.stringify(DEFAULT_LAYOUT), before);
  }
  is('moved-across-tabs layout survives normalize unchanged', normalizeLayout(moved), moved);

  // A card can be moved off its home tab and the tab left empty without a re-home.
  const empties = moveCardToTab(DEFAULT_LAYOUT, 'abilities', 'combat');
  is('source tab may be left empty', cardsOf(empties, 'abilities'), []);
  is('empty-source layout still normal (no phantom re-home)', normalizeLayout(empties), empties);

  // Moving the objectified Combat card carries its objects along (no silent reset).
  const tweaked = renameCard(moveObject(DEFAULT_LAYOUT, 'combat', 0, 5), 'combat', 'War');
  const combatMoved = moveCardToTab(tweaked, 'combat', 'character');
  const combatCard = (layout) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === 'combat');
  is('moved card keeps its objects', combatCard(combatMoved).objects.length, 13);
  is('moved card keeps its reordered object state',
    combatCard(combatMoved).objects.map((o) => o.componentId), combatCard(tweaked).objects.map((o) => o.componentId));
  is('moved card keeps its custom label', combatCard(combatMoved).label, 'War');
}

describe('renameCard (#54)');
{
  const card = (layout, id) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === id);

  is('default card has no label (uses registry default)', 'label' in card(DEFAULT_LAYOUT, 'combat'), false);
  is('renameCard sets a custom label', card(renameCard(DEFAULT_LAYOUT, 'combat', 'Fight!'), 'combat').label, 'Fight!');
  is('renameCard trims the label', card(renameCard(DEFAULT_LAYOUT, 'combat', '  Fight  '), 'combat').label, 'Fight');
  is('blank label clears the override', 'label' in card(renameCard(renameCard(DEFAULT_LAYOUT, 'combat', 'X'), 'combat', '  '), 'combat'), false);
  is('only the named card changes', 'label' in card(renameCard(DEFAULT_LAYOUT, 'combat', 'X'), 'attacks'), false);
  is('unknown card is a no-op', renameCard(DEFAULT_LAYOUT, 'ghost', 'X'), DEFAULT_LAYOUT);
  is('a custom label survives normalize', card(normalizeLayout(renameCard(DEFAULT_LAYOUT, 'notes', 'Log')), 'notes').label, 'Log');
  is('a renamed layout survives normalize unchanged',
    normalizeLayout(renameCard(DEFAULT_LAYOUT, 'combat', 'Fight')), renameCard(DEFAULT_LAYOUT, 'combat', 'Fight'));

  // Reconcile coerces a non-string / empty label away, never storing an empty override.
  const junk = normalizeLayout({ tabs: [{ id: 'character', cards: [{ componentId: 'notes', label: '   ' }] }] });
  is('a whitespace-only stored label is dropped', 'label' in card(junk, 'notes'), false);

  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    renameCard(DEFAULT_LAYOUT, 'combat', 'X');
    is('renameCard never mutates the input', JSON.stringify(DEFAULT_LAYOUT), before);
  }
}

/* ------------------------------------------------- tab CRUD (#54 Phase 4b) */

describe('addTab / removeTab / renameTab / moveTab');
{
  const CARD_IDS = Object.keys(CARD_REGISTRY);
  const placed = (layout) => layout.tabs.flatMap((tab) => tab.cards.map((c) => c.componentId));

  // addTab appends an empty tab; duplicate id is a no-op.
  const added = addTab(DEFAULT_LAYOUT, 'notes2', 'Session Notes');
  is('addTab appends the tab', tabIds(added), ['combat', 'abilities', 'spells', 'gear', 'character', 'notes2']);
  is('new tab is empty', cardsOf(added, 'notes2'), []);
  is('new tab carries its label', added.tabs[5].label, 'Session Notes');
  is('addTab with an existing id is a no-op', addTab(DEFAULT_LAYOUT, 'combat', 'x'), DEFAULT_LAYOUT);
  is('addTab with a blank id is a no-op', addTab(DEFAULT_LAYOUT, '', 'x'), DEFAULT_LAYOUT);

  // removeTab: its cards move to the first REMAINING tab; last tab can't be removed.
  const removedGear = removeTab(DEFAULT_LAYOUT, 'gear'); // gear held [inventory, features]
  is('removeTab drops the tab', tabIds(removedGear).includes('gear'), false);
  is('its cards move to the first remaining tab (combat)',
    cardsOf(removedGear, 'combat'), ['combat', 'attacks', 'inventory', 'features']);
  is('every card still placed exactly once after removal',
    placed(removedGear).slice().sort(), [...CARD_IDS].sort());

  // Removing the first tab sends its cards to the new first tab.
  const removedCombat = removeTab(DEFAULT_LAYOUT, 'combat');
  is('removing the first tab: cards go to the new first (abilities)',
    cardsOf(removedCombat, 'abilities').slice(0, 2), ['abilities', 'combat']);

  is('unknown tab removal is a no-op', removeTab(DEFAULT_LAYOUT, 'nope'), DEFAULT_LAYOUT);
  {
    const one = { layoutSchemaVersion: 1, tabs: [{ id: 'only', label: 'Only', cards: [] }] };
    is('cannot remove the last tab', removeTab(one, 'only'), one);
  }

  // renameTab; blank keeps the current label.
  is('renameTab sets the label', renameTab(DEFAULT_LAYOUT, 'combat', 'Fight').tabs[0].label, 'Fight');
  is('renameTab blank keeps current', renameTab(DEFAULT_LAYOUT, 'combat', '   ').tabs[0].label, 'Combat');

  // moveTab reorders by ±1, clamped.
  is('moveTab down', tabIds(moveTab(DEFAULT_LAYOUT, 'combat', 1)),
    ['abilities', 'combat', 'spells', 'gear', 'character']);
  is('moveTab up', tabIds(moveTab(DEFAULT_LAYOUT, 'abilities', -1)),
    ['abilities', 'combat', 'spells', 'gear', 'character']);
  is('moveTab past the top is a no-op', moveTab(DEFAULT_LAYOUT, 'combat', -1), DEFAULT_LAYOUT);
  is('moveTab past the bottom is a no-op', moveTab(DEFAULT_LAYOUT, 'character', 1), DEFAULT_LAYOUT);

  // Immutability + still-normal after each op.
  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    addTab(DEFAULT_LAYOUT, 'z', 'Z'); removeTab(DEFAULT_LAYOUT, 'gear');
    renameTab(DEFAULT_LAYOUT, 'combat', 'X'); moveTab(DEFAULT_LAYOUT, 'combat', 1);
    is('tab mutators never mutate the input', JSON.stringify(DEFAULT_LAYOUT), before);
  }
  is('a layout with a user tab survives normalize unchanged', normalizeLayout(added), added);
  is('a post-removal layout survives normalize unchanged', normalizeLayout(removedGear), removedGear);
}

/* ------------------------------------------ normalizeLayout: objects (#54 Phase 5) */

describe('normalizeLayout: objects');
{
  const COMBAT_OBJS = OBJECT_ORDER.combat;
  const JS_OBJS = COMBAT_OBJS.filter((id) => OBJECT_REGISTRY[id].cost === 'js');
  const card = (layout, id) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === id);
  const objIds = (layout) => card(layout, 'combat').objects.map((o) => o.componentId);
  const objCount = (layout, id) => card(layout, 'combat').objects.filter((o) => o.componentId === id).length;

  const objSpan = (layout, id) => card(layout, 'combat').objects.find((o) => o.componentId === id).span;

  is('default combat carries all 13 objects in order', objIds(DEFAULT_LAYOUT), COMBAT_OBJS);
  is('default objects all visible', card(DEFAULT_LAYOUT, 'combat').objects.every((o) => o.hidden === false), true);
  is('a non-objectified card (attacks) has no objects field', 'objects' in card(DEFAULT_LAYOUT, 'attacks'), false);

  // Span (#54 Phase 6): every object carries its registry default span; the small vitals are 1×,
  // HP/Adjust-HP and the status blocks are full-width — reproducing today's layout.
  is('default span comes from the registry', objSpan(DEFAULT_LAYOUT, 'hp'), OBJECT_REGISTRY.hp.defaultSpan);
  is('a small vital defaults to 1×', objSpan(DEFAULT_LAYOUT, 'ac'), 1);
  is('a status block defaults to full', objSpan(DEFAULT_LAYOUT, 'exhaustion'), 'full');
  is('every default span is a valid span', card(DEFAULT_LAYOUT, 'combat').objects.every((o) => OBJECT_SPANS.includes(o.span)), true);

  // Reconcile: unknown dropped, duplicate collapsed, bare-string coerced, hidden preserved,
  // and every registered object present exactly once (js hosts included — anti-crash).
  const messy = normalizeLayout({
    tabs: [{ id: 'combat', cards: [{ componentId: 'combat', objects: [
      { componentId: 'ac', hidden: true, span: 2 },
      { componentId: 'ghost-obj' },
      { componentId: 'ac' },
      { componentId: 'temp-hp', span: 'huge' },
      'exhaustion',
    ] }] }],
  });
  is('unknown object dropped', objIds(messy).includes('ghost-obj'), false);
  is('duplicate object collapses to one', objCount(messy, 'ac'), 1);
  is('kept object order honored (ac, temp-hp, exhaustion first)', objIds(messy).slice(0, 3), ['ac', 'temp-hp', 'exhaustion']);
  is('hidden flag preserved', card(messy, 'combat').objects.find((o) => o.componentId === 'ac').hidden, true);
  is('valid span preserved', objSpan(messy, 'ac'), 2);
  is('invalid span coerced to registry default', objSpan(messy, 'temp-hp'), OBJECT_REGISTRY['temp-hp'].defaultSpan);

  // Object label (#54): custom title reconciled like the card's; default objects carry none.
  is('default object has no label', 'label' in card(DEFAULT_LAYOUT, 'combat').objects[0], false);
  const labelled = normalizeLayout({
    tabs: [{ id: 'combat', cards: [{ componentId: 'combat', objects: [
      { componentId: 'ac', label: '  Armor  ' },
      { componentId: 'speed', label: '   ' },
    ] }] }],
  });
  const obj = (layout, id) => card(layout, 'combat').objects.find((o) => o.componentId === id);
  is('custom object label preserved (trimmed)', obj(labelled, 'ac').label, 'Armor');
  is('whitespace-only object label dropped', 'label' in obj(labelled, 'speed'), false);
  is('every registered object present exactly once', objIds(messy).slice().sort(), [...COMBAT_OBJS].sort());
  is('js-host objects all present (anti-crash, one level down)',
    JS_OBJS.every((id) => objCount(messy, id) === 1), true);

  is('idempotent with objects', normalizeLayout(messy), messy);
  is('JSON round-trips with objects', normalizeLayout(JSON.parse(JSON.stringify(messy))), messy);
}

describe('moveObject / toggleObjectHidden');
{
  const combat = (layout) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === 'combat');
  const objIds = (layout) => combat(layout).objects.map((o) => o.componentId);
  const hiddenOf = (layout, id) => combat(layout).objects.find((o) => o.componentId === id).hidden;

  // hp is index 0, adjust-hp index 1 in the default order.
  is('move down: hp (0) → 1', objIds(moveObject(DEFAULT_LAYOUT, 'combat', 0, 1)).slice(0, 2), ['adjust-hp', 'hp']);
  is('move up: adjust-hp (1) → 0', objIds(moveObject(DEFAULT_LAYOUT, 'combat', 1, 0)).slice(0, 2), ['adjust-hp', 'hp']);
  is('clamp at top is a no-op', moveObject(DEFAULT_LAYOUT, 'combat', 0, -1), DEFAULT_LAYOUT);
  is('clamp at bottom is a no-op', moveObject(DEFAULT_LAYOUT, 'combat', 12, 13), DEFAULT_LAYOUT);
  is('out-of-range fromIndex is a no-op', moveObject(DEFAULT_LAYOUT, 'combat', 99, 0), DEFAULT_LAYOUT);
  is('unknown card is a no-op', moveObject(DEFAULT_LAYOUT, 'attacks', 0, 1), DEFAULT_LAYOUT);
  is('a moved-objects layout survives normalize unchanged',
    normalizeLayout(moveObject(DEFAULT_LAYOUT, 'combat', 0, 5)), moveObject(DEFAULT_LAYOUT, 'combat', 0, 5));

  // toggleObjectHidden flips exactly one, twice returns to start, unknown is a no-op.
  is('hidden starts false', hiddenOf(DEFAULT_LAYOUT, 'exhaustion'), false);
  const hid = toggleObjectHidden(DEFAULT_LAYOUT, 'combat', 'exhaustion');
  is('toggle hides it', hiddenOf(hid, 'exhaustion'), true);
  is('only that object is affected', hiddenOf(hid, 'hp'), false);
  is('toggle twice restores', toggleObjectHidden(hid, 'combat', 'exhaustion'), DEFAULT_LAYOUT);
  is('unknown object toggle is a no-op', toggleObjectHidden(DEFAULT_LAYOUT, 'combat', 'ghost'), DEFAULT_LAYOUT);
  is('a hidden JS-host object survives normalize (present-but-hidden)',
    hiddenOf(normalizeLayout(hid), 'exhaustion'), true);

  // Immutability.
  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    moveObject(DEFAULT_LAYOUT, 'combat', 0, 3);
    toggleObjectHidden(DEFAULT_LAYOUT, 'combat', 'ac');
    is('object mutators never mutate the input', JSON.stringify(DEFAULT_LAYOUT), before);
  }
}

describe('setObjectSpan / cycleSpan (#54 Phase 6)');
{
  const combat = (layout) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === 'combat');
  const spanOf = (layout, id) => combat(layout).objects.find((o) => o.componentId === id).span;

  // cycleSpan steps 1 → 2 → full → 1, and tolerates a junk input by re-entering the cycle.
  is('cycle 1 → 2', cycleSpan(1), 2);
  is('cycle 2 → full', cycleSpan(2), 'full');
  is('cycle full → 1', cycleSpan('full'), 1);
  is('cycle covers every span exactly once', [1, cycleSpan(1), cycleSpan(cycleSpan(1))].sort(), [...OBJECT_SPANS].sort());
  is('cycle of a junk value lands on a valid span', OBJECT_SPANS.includes(cycleSpan('junk')), true);

  // setObjectSpan sets one object's width, coerces junk to the registry default, no-ops elsewhere.
  is('sets a valid span', spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 'full'), 'ac'), 'full');
  is('only that object changes', spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 'full'), 'hp'), OBJECT_REGISTRY.hp.defaultSpan);
  is('junk span coerced to registry default', spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 'wat'), 'ac'), OBJECT_REGISTRY.ac.defaultSpan);
  is('unknown object is a no-op', setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ghost', 2), DEFAULT_LAYOUT);
  is('unknown card is a no-op', setObjectSpan(DEFAULT_LAYOUT, 'attacks', 'ac', 2), DEFAULT_LAYOUT);
  is('a resized layout survives normalize unchanged',
    normalizeLayout(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 2)), setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 2));

  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 'full');
    is('setObjectSpan never mutates the input', JSON.stringify(DEFAULT_LAYOUT), before);
  }
}

describe('renameObject (#54)');
{
  const obj = (layout, id) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === 'combat')
    .objects.find((o) => o.componentId === id);

  is('renameObject sets a custom label', obj(renameObject(DEFAULT_LAYOUT, 'combat', 'ac', 'Armor'), 'ac').label, 'Armor');
  is('renameObject trims the label', obj(renameObject(DEFAULT_LAYOUT, 'combat', 'ac', '  Armor  '), 'ac').label, 'Armor');
  is('blank label clears the override',
    'label' in obj(renameObject(renameObject(DEFAULT_LAYOUT, 'combat', 'ac', 'X'), 'combat', 'ac', ' '), 'ac'), false);
  is('only the named object changes', 'label' in obj(renameObject(DEFAULT_LAYOUT, 'combat', 'ac', 'X'), 'speed'), false);
  is('rename keeps hidden + span intact', (() => {
    const o = obj(renameObject(DEFAULT_LAYOUT, 'combat', 'ac', 'Armor'), 'ac');
    return o.hidden === false && o.span === OBJECT_REGISTRY.ac.defaultSpan;
  })(), true);
  is('unknown object is a no-op', renameObject(DEFAULT_LAYOUT, 'combat', 'ghost', 'X'), DEFAULT_LAYOUT);
  is('unknown card is a no-op', renameObject(DEFAULT_LAYOUT, 'attacks', 'ac', 'X'), DEFAULT_LAYOUT);
  is('a renamed-object layout survives normalize unchanged',
    normalizeLayout(renameObject(DEFAULT_LAYOUT, 'combat', 'ac', 'Armor')), renameObject(DEFAULT_LAYOUT, 'combat', 'ac', 'Armor'));

  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    renameObject(DEFAULT_LAYOUT, 'combat', 'ac', 'X');
    is('renameObject never mutates the input', JSON.stringify(DEFAULT_LAYOUT), before);
  }
}

export { results };
