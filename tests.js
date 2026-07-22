/**
 * The rules test suite — framework-free and DOM-free, so the exact same assertions
 * run in the browser (tests.html) and under Node (tools/run-tests.mjs, and CI).
 *
 * This exists because rules.js is pure — no DOM, no state, no side effects — so every
 * derived number on the sheet can be checked by calling a function and comparing the
 * result. That is the entire argument for keeping the arithmetic separate from the
 * rendering, and the reason the same file can run in either place with no test framework.
 */
import { blankCharacter } from './js/constants.js';
import * as rules from './js/rules.js';

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
is('override wins over level', rules.proficiencyBonus(3, 5), 5);
is('null override is ignored', rules.proficiencyBonus(9, null), 4);
is('empty-string override is ignored', rules.proficiencyBonus(9, ''), 4);

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

export { results };
