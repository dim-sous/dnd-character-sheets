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

  // Each toggle adds PB independently. Expertise without proficiency is not a legal
  // build, but the app does not police choices, so it adds one PB and nothing more.
  const d = char({ level: 3, skillProficiencies: [], skillExpertise: ['stealth'] });
  is('expertise alone → one PB, not two', rules.skillTotal(d, 'stealth'), 2);

  is('unknown skill key → 0', rules.skillTotal(c, 'basketweaving'), 0);
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
is('currency coercion + unknown key ignored', normalizeCharacter({ currency: { gp: '50', xx: 1 } }).currency, { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 });
is('currency missing → zeros', normalizeCharacter({}).currency, { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
is('abilities coercion', normalizeCharacter({ abilities: { str: '18' } }).abilities.str, 18);
is('abilities unknown key dropped', Object.keys(normalizeCharacter({ abilities: { str: 18, zzz: 5 } }).abilities), ['str', 'dex', 'con', 'int', 'wis', 'cha']);
is('abilities missing → all 10', normalizeCharacter({}).abilities, { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 });
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

export { results };
