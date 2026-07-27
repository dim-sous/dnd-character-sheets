/**
 * The rules test suite — framework-free and DOM-free, so the exact same assertions
 * run in the browser (tests.html) and under Node (tools/run-tests.mjs, and CI).
 *
 * This exists because rules.js is pure — no DOM, no state, no side effects — so every
 * derived number on the sheet can be checked by calling a function and comparing the
 * result. That is the entire argument for keeping the arithmetic separate from the
 * rendering, and the reason the same file can run in either place with no test framework.
 */
import {
  blankCharacter, MAX_EXHAUSTION, SCHEMA_VERSION, ROW_TEMPLATES,
} from './js/constants.js';
import * as rules from './js/rules.js';
import { normalizeCharacter, parseStored, mergeCharacters, characterFilename } from './js/storage.js';
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
  moveObject, toggleObjectHidden, setObjectSpan, setObjectHeight, renameObject,
} from './js/layout.js';
import {
  CARD_REGISTRY, TAB_REGISTRY, OBJECT_REGISTRY, OBJECT_ORDER,
  GRID_COLUMNS, SPAN_MIN, SPAN_MAX, HEIGHT_MIN, HEIGHT_MAX,
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

describe('saveTotal misc bonuses (#68)');
{
  const flat = char({ saveBonusAll: 2 });
  is('flat saveBonusAll adds to a save with no proficiency', rules.saveTotal(flat, 'dex'), 2);

  const flatWithProf = char({
    level: 3,
    abilities: { ...blankCharacter().abilities, str: 16 },
    saveProficiencies: ['str'],
    saveBonusAll: 2,
  });
  is('flat saveBonusAll stacks on top of proficiency', rules.saveTotal(flatWithProf, 'str'), 7);

  const perSave = char({
    abilities: { ...blankCharacter().abilities, con: 14 },
    saveBonuses: { ...blankCharacter().saveBonuses, con: 3 },
  });
  is('per-save saveBonuses adds only to the listed save', rules.saveTotal(perSave, 'con'), 5);
  is('per-save saveBonuses leaves other saves untouched', rules.saveTotal(perSave, 'dex'), 0);

  const combined = char({
    abilities: { ...blankCharacter().abilities, con: 14 },
    saveBonusAll: -1,
    saveBonuses: { ...blankCharacter().saveBonuses, con: 3 },
  });
  is('saveBonusAll and saveBonuses combine additively', rules.saveTotal(combined, 'con'), 4);
  // Unlike skillTotal, saveTotal has no unknown-key early return: an unknown ability
  // yields a +0 modifier, so only the flat bonus lands. Pinned so it stays deliberate.
  is('unknown ability key → flat bonus only', rules.saveTotal(combined, 'basketweaving'), -1);

  // #63 interaction: the exhaustion penalty and the misc bonus both apply, and cancel.
  is('save bonus and exhaustion penalty stack', rules.saveTotal({ ...flat, exhaustion: 1 }, 'dex'), 0);
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

/* ---------------------------------------------------------- attack to-hit */

describe('attack to-hit (#84)');
{
  const row = (over = {}) => ({ ...ROW_TEMPLATES.attacks(), ...over });
  const fighter = char({
    level: 5, // PB +3
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 }, // STR +4, DEX +2
  });

  // The ability picker is the mode switch: no ability = Custom, the free text stands.
  is('a blank row is Custom, not derived', rules.isDerivedAttack(row()), false);
  is('an ability key makes it derived', rules.isDerivedAttack(row({ ability: 'str' })), true);
  is('an unknown ability stays Custom', rules.isDerivedAttack(row({ ability: 'luck' })), false);
  is('a missing row is not derived', rules.isDerivedAttack(undefined), false);

  const longsword = row({ ability: 'str', proficient: true });
  is('STR +4 with PB +3 → +7', rules.attackToHit(fighter, longsword), 7);
  is('not proficient drops PB → +4', rules.attackToHit(fighter, { ...longsword, proficient: false }), 4);
  is('a +1 weapon adds its misc bonus → +8', rules.attackToHit(fighter, { ...longsword, miscBonus: 1 }), 8);
  is('a negative misc bonus subtracts → +5', rules.attackToHit(fighter, { ...longsword, miscBonus: -2 }), 5);
  is('the same row set to DEX (finesse) → +5', rules.attackToHit(fighter, { ...longsword, ability: 'dex' }), 5);
  // The point of deriving rather than storing: a level-up moves it unattended (5 → 9 is PB +4).
  is('PB follows a level-up → +8', rules.attackToHit({ ...fighter, level: 9 }, longsword), 8);
  // A weapon attack is a D20 Test, so it moves with Exhaustion like every other total (#63).
  is('exhaustion 2 takes 4 off a derived to-hit', rules.attackToHit({ ...fighter, exhaustion: 2 }, longsword), 3);
  is('the derived readout is formatted', rules.attackHit(fighter, longsword), '+7');
  is('a derived total can go negative', rules.attackHit({ ...fighter, exhaustion: 6 }, longsword), '−5');
  // One authoritative contract: choosing an ability wins over whatever text is still stored.
  is('an ability beats a stale typed bonus', rules.attackHit(fighter, { ...longsword, bonus: '+99' }), '+7');

  // Custom mode gets the Speed treatment: the STORED string is never rewritten, only the
  // readout moves, so dropping the exhaustion level restores it exactly.
  const typed = row({ bonus: '+5' });
  is('typed +5, rested → +5', rules.attackHit(fighter, typed), '+5');
  is('typed +5 at exhaustion 2 → +1', rules.attackHit({ ...fighter, exhaustion: 2 }, typed), '+1');
  is('the stored string is not mutated by the readout', typed.bonus, '+5');
  is('a bare 5 is still a number', rules.attackHit({ ...fighter, exhaustion: 1 }, row({ bonus: '5' })), '+3');
  is('a real minus sign round-trips back in', rules.attackHit(fighter, row({ bonus: '−1' })), '−1');
  is('surrounding space is tolerated', rules.attackHit(fighter, row({ bonus: ' +5 ' })), '+5');

  // Anything we cannot do arithmetic on is echoed verbatim rather than coerced — those are
  // exactly the rows whose text carries the most information.
  const worn = { ...fighter, exhaustion: 3 };
  is('"+5 (adv)" echoes verbatim', rules.attackHit(worn, row({ bonus: '+5 (adv)' })), '+5 (adv)');
  is('"+5/+0" echoes verbatim', rules.attackHit(worn, row({ bonus: '+5/+0' })), '+5/+0');
  is('"1d20+5" echoes verbatim', rules.attackHit(worn, row({ bonus: '1d20+5' })), '1d20+5');
  is('blank stays blank, never a confident +0', rules.attackHit(worn, row()), '');
  is('a missing row renders nothing', rules.attackHit(worn, undefined), '');
}

/* ------------------------------------------------------------- exhaustion */

describe('exhaustion penalties (#63)');
{
  // Level 0 must leave every derived number exactly as it was before #63 — the whole
  // feature has to be invisible to a character carrying no exhaustion.
  const rested = char({
    level: 3,
    abilities: { str: 16, dex: 18, con: 14, int: 8, wis: 14, cha: 10 },
    saveProficiencies: ['str'],
    skillProficiencies: ['athletics'],
    initiativeBonus: 2,
  });
  is('level 0 → penalty is 0', rules.exhaustionPenalty(rested), 0);
  is('level 0 leaves a save unchanged', rules.saveTotal(rested, 'str'), 5);
  is('level 0 leaves a skill unchanged', rules.skillTotal(rested, 'athletics'), 5);
  is('level 0 leaves initiative unchanged', rules.initiative(rested), 6);
  is('level 0 leaves passive Perception unchanged', rules.passivePerception(rested), 12);
  is('level 0 leaves speed unchanged', rules.effectiveSpeed(rested), 30);

  // 2024: a D20 Test is reduced by 2 × level.
  const worn = { ...rested, exhaustion: 3 };
  is('level 3 → penalty is −6', rules.exhaustionPenalty(worn), -6);
  is('level 3 takes 6 off a save', rules.saveTotal(worn, 'str'), -1);
  is('level 3 takes 6 off a skill', rules.skillTotal(worn, 'athletics'), -1);
  is('level 3 takes 6 off initiative', rules.initiative(worn), 0);

  // Decided in #63: passive Perception inherits the penalty via skillTotal.
  is('level 1 takes 2 off passive Perception', rules.passivePerception({ ...rested, exhaustion: 1 }), 10);

  // A spell attack is a D20 Test; the save DC is not a roll and must not move.
  const caster = char({ level: 5, abilities: { ...blankCharacter().abilities, cha: 18 } });
  caster.spellcasting.ability = 'cha';
  is('level 2 takes 4 off spell attack', rules.spellAttackBonus({ ...caster, exhaustion: 2 }), 3);
  is('spell save DC is untouched at level 2', rules.spellSaveDC({ ...caster, exhaustion: 2 }), 15);
  is('spell save DC is untouched at level 6', rules.spellSaveDC({ ...caster, exhaustion: 6 }), 15);
  is('non-caster still returns null at level 3', rules.spellAttackBonus({ ...char({ level: 5 }), exhaustion: 3 }), null);

  // Speed: −5 ft per level, floored at 0.
  is('speed 30 at level 2 → 20', rules.effectiveSpeed({ ...rested, exhaustion: 2 }), 20);
  is('speed 30 at level 6 → 0 (exactly cancels)', rules.effectiveSpeed({ ...rested, exhaustion: MAX_EXHAUSTION }), 0);
  is('speed 20 at level 6 → 0, never negative', rules.effectiveSpeed({ ...rested, speed: 20, exhaustion: MAX_EXHAUSTION }), 0);
  is('base speed is not mutated by the readout', rested.speed, 30);

  // Garbage in the stored level must not become a bonus.
  is('negative level → no penalty', rules.exhaustionPenalty({ exhaustion: -4 }), 0);
  is('negative level → speed unchanged', rules.effectiveSpeed({ speed: 30, exhaustion: -4 }), 30);
  is('garbage level → no penalty', rules.exhaustionPenalty({ exhaustion: 'x' }), 0);
  is('missing level → no penalty', rules.exhaustionPenalty({}), 0);
  is('garbage speed → 0', rules.effectiveSpeed({ speed: 'fast', exhaustion: 0 }), 0);
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

/* ------------------------------------------------ applyHpInput (Current HP field) */

describe('applyHpInput');
is('bare number sets current', rules.applyHpInput({ max: 30, current: 20, temp: 0 }, '17').current, 17);
is('bare number may exceed max (hand override)', rules.applyHpInput({ max: 30, current: 20, temp: 0 }, '45').current, 45);
is('negative delta damages through temp first', rules.applyHpInput({ max: 30, current: 20, temp: 5 }, '-8'),
   { max: 30, current: 17, temp: 0 });
is('negative delta floors at 0', rules.applyHpInput({ max: 30, current: 3, temp: 0 }, '-8').current, 0);
is('positive delta heals', rules.applyHpInput({ max: 30, current: 10, temp: 0 }, '+5').current, 15);
is('positive delta caps at max', rules.applyHpInput({ max: 30, current: 28, temp: 0 }, '+9').current, 30);
is('blank is a no-op', rules.applyHpInput({ max: 30, current: 20, temp: 5 }, ''), { max: 30, current: 20, temp: 5 });
is('garbage is a no-op', rules.applyHpInput({ max: 30, current: 20, temp: 5 }, 'abc'), { max: 30, current: 20, temp: 5 });
is('whitespace is trimmed', rules.applyHpInput({ max: 30, current: 20, temp: 0 }, '  12 ').current, 12);
is('does not mutate its input', (() => {
  const hp = { max: 30, current: 20, temp: 5 };
  rules.applyHpInput(hp, '-8');
  return hp;
})(), { max: 30, current: 20, temp: 5 });
// #74: formatMod prints U+2212 all over the sheet, and this field's own tooltip spelled its
// example "−8 for damage" with it — which /^[+-]/ never matched and Number() turned to NaN. The
// app silently rejected the exact string it told the player to type.
is('real minus sign (U+2212) damages like a hyphen',
   rules.applyHpInput({ max: 30, current: 20, temp: 5 }, '−8'),
   rules.applyHpInput({ max: 30, current: 20, temp: 5 }, '-8'));
is('real minus sign is not read as a bare number',
   rules.applyHpInput({ max: 30, current: 20, temp: 0 }, '−8').current, 12);
is('a trailing minus sign is still garbage', rules.applyHpInput({ max: 30, current: 20, temp: 0 }, '8−').current, 20);

/* ------------------------------------- describeHpChange (the one sentence, #74) */

describe('describeHpChange');
const desc = (hp, raw) => rules.describeHpChange(hp, rules.applyHpInput(hp, raw), raw);
// The whole point of the sentence: the two contracts have to say which one fired.
is('a delta names the temp absorption', desc({ max: 20, current: 12, temp: 5 }, '-8'),
   'Took 8. Temp absorbed 5, 3 off hit points. Now 9 of 20.');
is('an absolute set discloses that temp was left alone', desc({ max: 20, current: 12, temp: 5 }, '19'),
   'Set to 19. Temp 5 unchanged. Now 19 of 20.');
is('no temp, no temp clause', desc({ max: 20, current: 12, temp: 0 }, '-3'), 'Took 3. Now 9 of 20.');
is('temp swallowing the whole hit reads as such', desc({ max: 20, current: 12, temp: 10 }, '-8'),
   'Took 8. Temp absorbed all of it, 2 left. Now 12 of 20, temp 2.');
// Reports what was ENTERED, not what landed — "Took 3" for a typed -9 reads as a misheard entry.
is('damage past 0 reports the amount entered', desc({ max: 20, current: 3, temp: 0 }, '-9'),
   'Took 9. Now 0 of 20. At 0 — make death saving throws.');
is('healing at full is still worth saying', desc({ max: 20, current: 20, temp: 0 }, '+5'),
   'No change. Now 20 of 20.');
// The field repaints to the absolute result, so blurring after Enter re-commits that number as
// a bare entry. Narrating it would replace "Took 8. Temp absorbed 5…" with "No change." — the
// sentence describing what the player actually did, overwritten a moment later by a phantom.
is('a bare re-commit of the same value says nothing', desc({ max: 20, current: 9, temp: 0 }, '9'), '');
is('but a delta that moved nothing still speaks', desc({ max: 20, current: 20, temp: 0 }, '+0'),
   'No change. Now 20 of 20.');
is('unreadable input says so instead of nothing', desc({ max: 20, current: 12, temp: 0 }, 'abc'),
   'Couldn’t read “abc”. Hit points unchanged.');
is('blank says nothing at all', desc({ max: 20, current: 12, temp: 0 }, ''), '');
is('no max set drops the denominator', desc({ max: 0, current: 14, temp: 0 }, '-4'), 'Took 4. Now 10.');
// The case that makes the disclosure load-bearing: at temp 5 / current 3 a 7-point hit leaves
// you standing on 1, but a player doing the subtraction themselves types 0 and trips death saves.
is('the death-threshold case is spelled out', desc({ max: 20, current: 3, temp: 5 }, '-7'),
   'Took 7. Temp absorbed 5, 2 off hit points. Now 1 of 20.');
is('is pure — describing does not mutate', (() => {
  const hp = { max: 20, current: 12, temp: 5 };
  rules.describeHpChange(hp, rules.applyHpInput(hp, '-8'), '-8');
  return hp;
})(), { max: 20, current: 12, temp: 5 });

/* ------------------------------------------------------ restoreHp (long rest) */

describe('restoreHp');
is('lost hit points come back', rules.restoreHp({ max: 30, current: 11, temp: 0 }).current, 30);
is('temp hit points are cleared', rules.restoreHp({ max: 30, current: 11, temp: 8 }).temp, 0);
is('already full is a no-op', rules.restoreHp({ max: 30, current: 30, temp: 0 }).current, 30);
is('from 0', rules.restoreHp({ max: 30, current: 0, temp: 0 }).current, 30);
/*
 * #106. Max HP is Edit-gated and starts at 0, so "note your current HP without ever opening
 * Edit" is the ordinary path — and a rest used to assign max over it, landing the player on 0.
 * Silently: the `.is-dying` cue requires max > 0, so nothing on screen flagged it.
 */
is('an unset max means untracked, not a ceiling of zero',
   rules.restoreHp({ max: 0, current: 14, temp: 0 }).current, 14);
is('an unset max still clears temp', rules.restoreHp({ max: 0, current: 14, temp: 3 }).temp, 0);
/*
 * A rest is the largest heal in the game; it should not be the one healing effect that can
 * COST hit points. This mirrors applyHealing's "never lowers a current already above max",
 * which matters more now that character data has no undo (#107).
 */
is('never lowers a hand-set current above max',
   rules.restoreHp({ max: 20, current: 30, temp: 0 }).current, 30);
is('agrees with applyHealing about over-max current',
   rules.restoreHp({ max: 20, current: 30, temp: 0 }).current,
   rules.applyHealing({ max: 20, current: 30, temp: 0 }, 999).current);
is('garbage max is treated as unset', rules.restoreHp({ max: 'x', current: 12, temp: 0 }).current, 12);
is('does not mutate its input', (() => {
  const hp = { max: 30, current: 11, temp: 8 };
  rules.restoreHp(hp);
  return hp;
})(), { max: 30, current: 11, temp: 8 });

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

describe('characterFilename (#70)');
{
  const D = '2026-07-25';
  const fn = (name) => characterFilename({ name }, D);
  is('plain name', fn('Aragorn'), `Aragorn_${D}.json`);
  is('spaces become underscores', fn('Sir Reginald the Bold'), `Sir_Reginald_the_Bold_${D}.json`);
  is('runs of whitespace collapse', fn('A   B\tC'), `A_B_C_${D}.json`);
  is('path separators stripped', fn('Rogue/Bard'), `RogueBard_${D}.json`);
  is('windows-illegal characters stripped', fn('a<b>c:d"e|f?g*h'), `abcdefgh_${D}.json`);
  is('stripped character does not leave a double underscore', fn('Sir Reginald / the Bold'), `Sir_Reginald_the_Bold_${D}.json`);
  is('hyphens and underscores kept', fn('Half-Elf_Ranger'), `Half-Elf_Ranger_${D}.json`);
  is('non-ASCII letters kept', fn('Ñandú Þórr'), `Ñandú_Þórr_${D}.json`);
  is('leading/trailing punctuation trimmed', fn('  ..Grog--  '), `Grog_${D}.json`);
  is('empty name → unnamed', fn(''), `unnamed_${D}.json`);
  is('whitespace-only name → unnamed', fn('   '), `unnamed_${D}.json`);
  is('name of only illegal chars → unnamed', fn('///'), `unnamed_${D}.json`);
  is('missing name → unnamed', characterFilename({}, D), `unnamed_${D}.json`);
  is('missing character → unnamed', characterFilename(undefined, D), `unnamed_${D}.json`);
  is('long name capped at 60', fn('x'.repeat(200)), `${'x'.repeat(60)}_${D}.json`);
  is('cap does not leave trailing punctuation', fn(`${'y'.repeat(59)}   tail`), `${'y'.repeat(59)}_${D}.json`);

  // The single-character envelope is the one readImportFile already accepts, so a
  // one-character export must round-trip with no import changes (#70 note 2).
  const one = { ...blankCharacter(), name: 'Solo' };
  const payload = JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters: [one] });
  is('single-character envelope round-trips', parseStored(payload).characters.length, 1);
  is('round-trip preserves the name', parseStored(payload).characters[0].name, 'Solo');
}

describe('normalizeCharacter proficiencies (#69)');
is('missing → all four empty', normalizeCharacter({}).proficiencies, { weapons: '', armor: '', tools: '', languages: '' });
is('values preserved', normalizeCharacter({ proficiencies: { weapons: 'Simple, Martial' } }).proficiencies.weapons, 'Simple, Martial');
is('non-string value → ""', normalizeCharacter({ proficiencies: { tools: 42 } }).proficiencies.tools, '');
is('unknown key dropped', 'bogus' in normalizeCharacter({ proficiencies: { bogus: 'x' } }).proficiencies, false);
is('non-object ignored', normalizeCharacter({ proficiencies: 'nope' }).proficiencies, { weapons: '', armor: '', tools: '', languages: '' });
is('round-trips through parseStored', parseStored(JSON.stringify({
  schemaVersion: SCHEMA_VERSION,
  characters: [{ ...blankCharacter(), proficiencies: { weapons: 'Longsword', armor: '', tools: "Thieves' tools", languages: 'Common' } }],
})).characters[0].proficiencies.tools, "Thieves' tools");

describe('normalizeCharacter save bonuses (#68)');
is('saveBonusAll missing → 0', normalizeCharacter({}).saveBonusAll, 0);
is('saveBonusAll garbage → 0', normalizeCharacter({ saveBonusAll: 'x' }).saveBonusAll, 0);
is('saveBonusAll preserved', normalizeCharacter({ saveBonusAll: -2 }).saveBonusAll, -2);
is('saveBonuses missing → all six zeroed', normalizeCharacter({}).saveBonuses, blankCharacter().saveBonuses);
is('saveBonuses coerces strings', normalizeCharacter({ saveBonuses: { con: '3' } }).saveBonuses.con, 3);
is('saveBonuses garbage → 0', normalizeCharacter({ saveBonuses: { con: 'x' } }).saveBonuses.con, 0);
is('saveBonuses unknown key dropped', 'bogus' in normalizeCharacter({ saveBonuses: { bogus: 9 } }).saveBonuses, false);
is('saveBonuses non-object ignored', normalizeCharacter({ saveBonuses: 'nope' }).saveBonuses, blankCharacter().saveBonuses);

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
// #78. The second boolean flag on the character, and the interesting case is the pre-#78
// export: it has no `concentration` key at all and must load as "not concentrating".
is('concentration truthy → true', normalizeCharacter({ concentration: 'yes' }).concentration, true);
is('concentration missing → false', normalizeCharacter({}).concentration, false);
is('a pre-#78 character gains the flag', 'concentration' in normalizeCharacter({ name: 'Old' }), true);
is('ac coercion', normalizeCharacter({ ac: '16' }).ac, 16);
is('speed garbage → base 30', normalizeCharacter({ speed: 'x' }).speed, 30);
is('id string preserved', normalizeCharacter({ id: 'abc' }).id, 'abc');
is('id missing → generated non-empty string', typeof normalizeCharacter({}).id === 'string' && normalizeCharacter({}).id.length > 0, true);

/* -------------------------------------- normalizeCharacter row coercion */

describe('normalizeCharacter rows');
is('attack number → string coercion', normalizeCharacter({ attacks: [{ bonus: 5 }] }).attacks[0].bonus, '5');
is('attack garbage row → template', normalizeCharacter({ attacks: ['nope'] }).attacks[0],
  { name: '', ability: '', proficient: true, miscBonus: 0, bonus: '', damage: '', notes: '' });
is('attacks non-array → []', normalizeCharacter({ attacks: {} }).attacks, []);
{
  // #84: a pre-#84 row carries only name/bonus/damage/notes. normalizeRow is template-driven,
  // so the new keys backfill with no migration — and they backfill into Custom mode, which is
  // exactly what keeps the typed to-hit standing instead of silently deriving something else.
  const legacy = normalizeCharacter({
    attacks: [{ name: 'Longsword', bonus: '+5 (adv)', damage: '1d8+3' }],
  }).attacks[0];
  is('a pre-#84 row keeps its typed bonus', legacy.bonus, '+5 (adv)');
  is('a pre-#84 row backfills to Custom', legacy.ability, '');
  is('a pre-#84 row backfills proficient', legacy.proficient, true);
  is('a pre-#84 row backfills miscBonus', legacy.miscBonus, 0);
  is('a pre-#84 row reads as Custom, not derived', rules.isDerivedAttack(legacy), false);
  is('attack miscBonus garbage → 0', normalizeCharacter({ attacks: [{ miscBonus: 'x' }] }).attacks[0].miscBonus, 0);
  is('attack miscBonus coercion', normalizeCharacter({ attacks: [{ miscBonus: '-2' }] }).attacks[0].miscBonus, -2);
  is('attack proficient → boolean', normalizeCharacter({ attacks: [{ proficient: 0 }] }).attacks[0].proficient, false);
  is('a nonsense ability degrades to Custom',
    rules.isDerivedAttack(normalizeCharacter({ attacks: [{ ability: 'luck' }] }).attacks[0]), false);
}
is('inventory qty coercion', normalizeCharacter({ inventory: [{ item: 'Rope', qty: '3' }] }).inventory[0].qty, 3);
is('inventory qty garbage → template 1', normalizeCharacter({ inventory: [{ item: 'Rope', qty: 'x' }] }).inventory[0].qty, 1);
is('spell prepared → boolean', normalizeCharacter({ spellcasting: { spells: [{ name: 'X', prepared: 1 }] } }).spellcasting.spells[0].prepared, true);
// A missing boolean takes its TEMPLATE default, not a blanket false (#84) — here that default
// is false, so this pins the unchanged half of that rule alongside `proficient`'s true above.
is('spell prepared missing → template false', normalizeCharacter({ spellcasting: { spells: [{ name: 'X' }] } }).spellcasting.spells[0].prepared, false);
is('spell level coercion', normalizeCharacter({ spellcasting: { spells: [{ level: '2' }] } }).spellcasting.spells[0].level, 2);

describe('features + feats rows (#67)');
{
  // The migration that matters: a pre-#67 export holds features as {name,text} and no feats
  // at all. normalizeRow is template-driven, so the new keys backfill with no migration code.
  const old = normalizeCharacter({ features: [{ name: 'Second Wind', text: 'Regain HP' }] });
  is('old feature row keeps its data', [old.features[0].name, old.features[0].text], ['Second Wind', 'Regain HP']);
  is('old feature row backfills source/level', [old.features[0].source, old.features[0].level], ['', '']);
  is('feats absent → []', old.feats, []);

  is('feature garbage row → template', normalizeCharacter({ features: ['nope'] }).features[0],
    { name: '', source: '', level: '', text: '' });
  is('feat garbage row → template', normalizeCharacter({ feats: ['nope'] }).feats[0],
    { name: '', source: '', text: '' });
  is('feats non-array → []', normalizeCharacter({ feats: {} }).feats, []);
  is('feat row preserved', normalizeCharacter({ feats: [{ name: 'Alert', source: 'Origin', text: '+5 init' }] }).feats[0],
    { name: 'Alert', source: 'Origin', text: '+5 init' });
  // level is free text on purpose — "3", "3rd" and "" are all things a player might type.
  is('feature level stays a string', normalizeCharacter({ features: [{ level: 3 }] }).features[0].level, '3');
  is('feature level free text kept', normalizeCharacter({ features: [{ level: '3rd' }] }).features[0].level, '3rd');

  // A pre-#67 backup must still import, and a post-#67 file must round-trip.
  const preFile = JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters: [{ name: 'Old', features: [{ name: 'F', text: 'T' }] }] });
  is('pre-#67 backup imports without crashing', parseStored(preFile).characters[0].features[0].source, '');
  is('pre-#67 backup gains an empty feats list', parseStored(preFile).characters[0].feats, []);
}

describe('class resources (#140)');
{
  // A blank character has none. Most characters will stay that way, so this is the shape the
  // empty-state hint renders against, not an edge case.
  is('blank character starts with no resources', blankCharacter().resources, []);
  is('row template', ROW_TEMPLATES.resources(), { name: '', remaining: 0, total: 0 });

  // The migration that matters, and the whole reason this needed no SCHEMA_VERSION bump: every
  // file written before #140 lacks the key entirely. normalizeRows maps a non-array to [], so
  // the field arrives empty rather than undefined — which is what stops renderRows throwing on
  // `getByPath(char, 'resources').length`.
  is('resources absent → []', normalizeCharacter({ name: 'Old' }).resources, []);
  is('resources non-array → []', normalizeCharacter({ resources: {} }).resources, []);
  is('resources null → []', normalizeCharacter({ resources: null }).resources, []);
  is('garbage row → template', normalizeCharacter({ resources: ['nope'] }).resources[0],
    { name: '', remaining: 0, total: 0 });

  is('row preserved', normalizeCharacter({ resources: [{ name: 'Rage', remaining: 2, total: 3 }] }).resources[0],
    { name: 'Rage', remaining: 2, total: 3 });
  is('several rows keep their order',
    normalizeCharacter({ resources: [{ name: 'Rage' }, { name: 'Ki' }] }).resources.map((r) => r.name),
    ['Rage', 'Ki']);
  // Template-driven backfill, exactly like the feature rows above: a hand-written file holding
  // only a name gets the two counts for free.
  is('name-only row backfills its counts', normalizeCharacter({ resources: [{ name: 'Ki' }] }).resources[0],
    { name: 'Ki', remaining: 0, total: 0 });
  // The counts are numbers, so a hand-edited string coerces (num()) rather than being kept as
  // text — the opposite of `feature.level`, which is free text on purpose.
  is('string counts coerce to numbers', normalizeCharacter({ resources: [{ name: 'Ki', remaining: '4', total: '5' }] }).resources[0],
    { name: 'Ki', remaining: 4, total: 5 });
  is('unparseable count falls back to 0', normalizeCharacter({ resources: [{ name: 'Ki', remaining: 'lots' }] }).resources[0].remaining, 0);
  // A numeric name is coerced the other way, the same as every other string field.
  is('numeric name becomes a string', normalizeCharacter({ resources: [{ name: 7 }] }).resources[0].name, '7');
  // Unknown keys are dropped: normalizeRow builds its output solely from template keys. This is
  // what makes a future `recovery` field additive rather than a migration — and what guarantees
  // a hand-edited file cannot smuggle state past the shape.
  is('unknown row keys are dropped', Object.keys(normalizeCharacter({ resources: [{ name: 'X', recovery: 'long' }] }).resources[0]),
    ['name', 'remaining', 'total']);

  // NOT clamped, unlike deathSaves / exhaustion / spell slots. Those have a fixed number of pips
  // and an out-of-range import renders a state the UI cannot undo; a resource is two typed
  // fields the player can always correct. `remaining > total` is a legitimate override (the same
  // contract current HP has), and `total: 0` means "not tracked", not "a ceiling of zero".
  is('remaining above total is preserved, not clamped',
    normalizeCharacter({ resources: [{ name: 'Rage', remaining: 9, total: 3 }] }).resources[0].remaining, 9);
  is('an untracked total stays 0 with a live remaining',
    normalizeCharacter({ resources: [{ name: 'Luck', remaining: 3, total: 0 }] }).resources[0], { name: 'Luck', remaining: 3, total: 0 });
  is('a negative count is preserved', normalizeCharacter({ resources: [{ name: 'X', remaining: -1 }] }).resources[0].remaining, -1);

  // A pre-#140 backup must still import, and a #140 file must round-trip through parseStored.
  const preFile140 = JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters: [{ name: 'Old' }] });
  is('pre-#140 backup gains an empty resources list', parseStored(preFile140).characters[0].resources, []);
  const withFile = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    characters: [{ name: 'Barb', resources: [{ name: 'Rage', remaining: 1, total: 3 }] }],
  });
  is('a #140 backup round-trips', parseStored(withFile).characters[0].resources,
    [{ name: 'Rage', remaining: 1, total: 3 }]);
}

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

  // #69: a layout saved BEFORE a card existed must gain it, at its home tab — this is the
  // whole reason adding a card needs no character migration. Simulated by dropping one.
  const preProficiencies = {
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: TAB_IDS.map((id) => ({
      id,
      cards: CARD_IDS.filter((c) => CARD_REGISTRY[c].home === id && c !== 'proficiencies')
        .map((componentId) => ({ componentId })),
    })),
  };
  is('a card absent from a saved layout is re-injected',
    cardsOf(normalizeLayout(preProficiencies), 'character').includes('proficiencies'), true);
  is('re-injection does not duplicate it',
    count(placed(normalizeLayout(preProficiencies)), 'proficiencies'), 1);

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
  // Count from the registry, not a literal — adding a tile (#78) shouldn't fail an
  // assertion about card moves that has nothing to say about how many objects there are.
  is('moved card keeps its objects', combatCard(combatMoved).objects.length, OBJECT_ORDER.combat.length);
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
  // #78: a layout saved before the Concentration tile existed must gain it, same backfill the
  // features card relies on below — otherwise the tile renders but arrange mode can't see it.
  is('a pre-#78 combat card gains the concentration object', objIds(normalizeLayout({
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: [{ id: 'combat', cards: [{ componentId: 'combat', objects: COMBAT_OBJS.filter((id) => id !== 'concentration') }] }],
  })).includes('concentration'), true);
  // #140: the same backfill for the Resources tile, and the one that matters most for it —
  // every player already has a saved layout, so if normalizeCard did not append the new object
  // the tile would render but arrange mode could neither move nor hide it.
  {
    const pre140 = normalizeLayout({
      layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
      tabs: [{ id: 'combat', cards: [{ componentId: 'combat', objects: COMBAT_OBJS.filter((id) => id !== 'resources') }] }],
    });
    is('a pre-#140 combat card gains the resources object', objIds(pre140).includes('resources'), true);
    // Appended, not inserted at its registry index: the saved arrangement is the player's, and
    // reconciliation adds to the end of it rather than reshuffling tiles they placed by hand.
    is('the backfilled resources object lands last', objIds(pre140).at(-1), 'resources');
    is('the backfilled object is visible and full-span',
      card(pre140, 'combat').objects.find((o) => o.componentId === 'resources'),
      { componentId: 'resources', hidden: false, span: SPAN_MAX, height: HEIGHT_MIN });
    // Backfill must be exactly-once, or a second normalize (every load does one) duplicates it.
    is('backfill is idempotent', objCount(normalizeLayout(pre140), 'resources'), 1);
  }
  is('resources defaults to the full row', objSpan(DEFAULT_LAYOUT, 'resources'), SPAN_MAX);
  // cost:'js' is the safety oracle: renderRows dereferences #resources with no null check, so
  // arrange mode must never be allowed to detach this tile.
  is('resources is a cost:js object', OBJECT_REGISTRY.resources.cost, 'js');
  is('default objects all visible', card(DEFAULT_LAYOUT, 'combat').objects.every((o) => o.hidden === false), true);
  is('a non-objectified card (attacks) has no objects field', 'objects' in card(DEFAULT_LAYOUT, 'attacks'), false);

  // #67 objectifies a SECOND card. The arrange machinery is registry-driven, so this is the
  // test that it generalises past Combat rather than being hardcoded to it.
  const featCard = (layout) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === 'features');
  const featObjIds = (layout) => featCard(layout).objects.map((o) => o.componentId);
  is('features card is objectified', featObjIds(DEFAULT_LAYOUT), ['features', 'feats']);
  is('features objects default to full span',
    featCard(DEFAULT_LAYOUT).objects.every((o) => o.span === SPAN_MAX), true);
  // A layout saved before #67 has a features card with NO objects array — both must appear.
  const preObjects = normalizeLayout({
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: [{ id: 'gear', cards: [{ componentId: 'features' }] }],
  });
  is('a pre-#67 features card gains both objects', featObjIds(preObjects), ['features', 'feats']);
  is('an object belonging to another card is rejected', featObjIds(normalizeLayout({
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: [{ id: 'gear', cards: [{ componentId: 'features', objects: [{ componentId: 'exhaustion' }, { componentId: 'feats' }] }] }],
  })), ['feats', 'features']);

  // Span (#54 Phase 6, rescaled to twelfths in item 1): every object carries its registry
  // default; the small vitals are a quarter of the row, HP and the status blocks the whole of
  // it — reproducing today's layout.
  const objHeight = (layout, id) => card(layout, 'combat').objects.find((o) => o.componentId === id).height;
  is('default span comes from the registry', objSpan(DEFAULT_LAYOUT, 'hp'), OBJECT_REGISTRY.hp.defaultSpan);
  is('a small vital defaults to a quarter row', objSpan(DEFAULT_LAYOUT, 'pb'), GRID_COLUMNS / 4);
  // #75 widened AC to half a row: it is read on every incoming attack and was visually identical
  // to Prof. Bonus, which never changes in play. Asserted by name so a silent revert to a quarter
  // fails here rather than quietly undoing the frequency-of-use weighting.
  is('AC defaults to half a row (#75)', objSpan(DEFAULT_LAYOUT, 'ac'), GRID_COLUMNS / 2);
  is('a status block defaults to full', objSpan(DEFAULT_LAYOUT, 'exhaustion'), SPAN_MAX);
  is('every default span is within the grid', card(DEFAULT_LAYOUT, 'combat').objects
    .every((o) => Number.isInteger(o.span) && o.span >= SPAN_MIN && o.span <= SPAN_MAX), true);
  // Height is opt-in: nothing ships with one, so every tile is as tall as its contents until a
  // player drags the slider. This is what makes the new field additive for every saved layout.
  is('every object defaults to no set height',
    card(DEFAULT_LAYOUT, 'combat').objects.every((o) => o.height === HEIGHT_MIN), true);

  // Reconcile: unknown dropped, duplicate collapsed, bare-string coerced, hidden preserved,
  // and every registered object present exactly once (js hosts included — anti-crash).
  // Version-less, so it also takes the v1 span branch — see the migration group below.
  const messy = normalizeLayout({
    tabs: [{ id: 'combat', cards: [{ componentId: 'combat', objects: [
      { componentId: 'ac', hidden: true, span: 2 },
      { componentId: 'ghost-obj' },
      { componentId: 'ac' },
      { componentId: 'speed', span: 'huge' },
      'exhaustion',
    ] }] }],
  });
  is('unknown object dropped', objIds(messy).includes('ghost-obj'), false);
  is('duplicate object collapses to one', objCount(messy, 'ac'), 1);
  is('kept object order honored (ac, speed, exhaustion first)', objIds(messy).slice(0, 3), ['ac', 'speed', 'exhaustion']);
  is('hidden flag preserved', card(messy, 'combat').objects.find((o) => o.componentId === 'ac').hidden, true);
  is('a v1 span is rescaled, not dropped', objSpan(messy, 'ac'), 6);
  is('invalid span coerced to registry default', objSpan(messy, 'speed'), OBJECT_REGISTRY['speed'].defaultSpan);
  is('a missing height reads as none', objHeight(messy, 'ac'), HEIGHT_MIN);

  // Height reconciliation, same contract as span: valid kept, junk and out-of-range clamped
  // rather than rejected, so a hand-edited file can never produce a broken tile.
  const heights = normalizeLayout({
    layoutSchemaVersion: LAYOUT_SCHEMA_VERSION,
    tabs: [{ id: 'combat', cards: [{ componentId: 'combat', objects: [
      { componentId: 'ac', height: 5 },
      { componentId: 'speed', height: 'tall' },
      { componentId: 'pb', height: 999 },
      { componentId: 'heroic', height: -4 },
      { componentId: 'rest', height: 2.6 },
    ] }] }],
  });
  is('a valid height is preserved', objHeight(heights, 'ac'), 5);
  is('junk height reads as none', objHeight(heights, 'speed'), HEIGHT_MIN);
  is('height above the maximum clamps', objHeight(heights, 'pb'), HEIGHT_MAX);
  is('negative height clamps to none', objHeight(heights, 'heroic'), HEIGHT_MIN);
  is('a fractional height rounds to a step', objHeight(heights, 'rest'), 3);

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

  // Registry-derived, not hardcoded: these assert that moveObject SWAPS the first two
  // objects, whatever they are. Naming them cost a false failure when #75 reordered the
  // combat defaults — a deliberate defaults change read as a moveObject bug.
  const [first, second] = OBJECT_ORDER.combat;
  is('move down: index 0 → 1', objIds(moveObject(DEFAULT_LAYOUT, 'combat', 0, 1)).slice(0, 2), [second, first]);
  is('move up: index 1 → 0', objIds(moveObject(DEFAULT_LAYOUT, 'combat', 1, 0)).slice(0, 2), [second, first]);
  is('clamp at top is a no-op', moveObject(DEFAULT_LAYOUT, 'combat', 0, -1), DEFAULT_LAYOUT);
  const lastObj = OBJECT_ORDER.combat.length - 1;   // registry-derived, see the note at 'moved card keeps its objects'
  is('clamp at bottom is a no-op', moveObject(DEFAULT_LAYOUT, 'combat', lastObj, lastObj + 1), DEFAULT_LAYOUT);
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

describe('setObjectSpan / setObjectHeight (#54 Phase 6, sliders in item 1)');
{
  const combat = (layout) => layout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === 'combat');
  const spanOf = (layout, id) => combat(layout).objects.find((o) => o.componentId === id).span;
  const heightOf = (layout, id) => combat(layout).objects.find((o) => o.componentId === id).height;

  // setObjectSpan sets one object's width, coerces junk to the registry default, no-ops elsewhere.
  is('sets a valid span', spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', SPAN_MAX), 'ac'), SPAN_MAX);
  is('sets an in-between span the old cycle could not reach',
    spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 5), 'ac'), 5);
  is('only that object changes', spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', SPAN_MAX), 'hp'), OBJECT_REGISTRY.hp.defaultSpan);
  is('junk span coerced to registry default', spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 'wat'), 'ac'), OBJECT_REGISTRY.ac.defaultSpan);
  // The floor is a touch target, not an aesthetic: one twelfth of a 390px card is ~22px.
  is('a span below the floor coerces rather than sticking',
    spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 1), 'ac'), OBJECT_REGISTRY.ac.defaultSpan);
  is('a span past the grid coerces',
    spanOf(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 13), 'ac'), OBJECT_REGISTRY.ac.defaultSpan);
  is('unknown object is a no-op', setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ghost', 2), DEFAULT_LAYOUT);
  is('unknown card is a no-op', setObjectSpan(DEFAULT_LAYOUT, 'attacks', 'ac', 2), DEFAULT_LAYOUT);
  is('a resized layout survives normalize unchanged',
    normalizeLayout(setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 4)), setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', 4));

  // Height clamps instead of coercing to a default: a slider reporting a value past either end
  // should land at that end, not jump back to whatever the registry says.
  is('sets a height', heightOf(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 6), 'ac'), 6);
  is('0 clears the height', heightOf(setObjectHeight(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 6), 'combat', 'ac', 0), 'ac'), HEIGHT_MIN);
  is('height past the top clamps to the top', heightOf(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 99), 'ac'), HEIGHT_MAX);
  is('height below zero clamps to zero', heightOf(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', -3), 'ac'), HEIGHT_MIN);
  is('junk height reads as none', heightOf(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 'tall'), 'ac'), HEIGHT_MIN);
  is('height leaves width alone', spanOf(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 6), 'ac'), OBJECT_REGISTRY.ac.defaultSpan);
  is('unknown object is a no-op', setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ghost', 6), DEFAULT_LAYOUT);
  is('a heightened layout survives normalize unchanged',
    normalizeLayout(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 6)), setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 6));

  {
    const before = JSON.stringify(DEFAULT_LAYOUT);
    setObjectSpan(DEFAULT_LAYOUT, 'combat', 'ac', SPAN_MAX);
    setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 6);
    is('neither setter mutates the input', JSON.stringify(DEFAULT_LAYOUT), before);
  }
}

/*
 * The v1 → v2 span rescale. This is the first non-additive layout change, and the only one
 * where getting it wrong is silent: a v1 span read as v2 is out of range, so normalizeSpan
 * coerces it to the registry default and the player's arrangement is quietly reset to the
 * shipped one. Nothing throws, nothing warns, the layout is just gone.
 */
describe('layout migration: v1 spans → twelfths (item 1)');
{
  const v1 = (objects) => ({
    layoutSchemaVersion: 1,
    tabs: [{ id: 'combat', label: 'Combat', cards: [{ componentId: 'combat', objects }] }],
  });
  const spanOf = (layout, id) => layout.tabs.flatMap((t) => t.cards)
    .find((c) => c.componentId === 'combat').objects.find((o) => o.componentId === id).span;

  const migrated = normalizeLayout(v1([
    { componentId: 'pb', span: 1 },
    { componentId: 'ac', span: 2 },
    { componentId: 'hp', span: 'full' },
  ]));
  // A third of the grid each way: 1 → 3, 2 → 6, full → 12 puts every tile back at the same
  // pixel width it had under the four-column grid.
  is('v1 single track becomes a quarter row', spanOf(migrated, 'pb'), 3);
  is('v1 double track becomes half a row', spanOf(migrated, 'ac'), 6);
  is('v1 full becomes the whole row', spanOf(migrated, 'hp'), SPAN_MAX);
  is('the migrated layout reports the new version', migrated.layoutSchemaVersion, LAYOUT_SCHEMA_VERSION);
  is('migration adds the height field', migrated.tabs.flatMap((t) => t.cards)
    .find((c) => c.componentId === 'combat').objects.every((o) => o.height === HEIGHT_MIN), true);

  // A NON-default v1 arrangement is the case that matters: the defaults would survive being
  // dropped, because they'd be re-derived from the registry. A player's own widths would not.
  const custom = normalizeLayout(v1([{ componentId: 'pb', span: 'full' }, { componentId: 'hp', span: 1 }]));
  is('a player\'s own v1 widths survive', [spanOf(custom, 'pb'), spanOf(custom, 'hp')], [12, 3]);

  // Version 0 — a blob written before the version field, or one that lost it — still carries v1
  // spans, so it takes the same branch rather than being read as v2 and coerced away.
  is('a version-less layout is migrated too',
    spanOf(normalizeLayout({ tabs: v1([{ componentId: 'ac', span: 2 }]).tabs }), 'ac'), 6);

  // Idempotence: re-running the migration over an already-migrated layout must not rescale
  // twice. 3 and 6 are not v1 keys, so they pass through untouched — this is the assertion that
  // keeps that true if the mapping is ever edited.
  is('migrating twice changes nothing', normalizeLayout(migrated), migrated);
  is('a v2 layout is left alone', normalizeLayout(DEFAULT_LAYOUT), DEFAULT_LAYOUT);
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
  is('rename keeps hidden + span + height intact', (() => {
    const o = obj(renameObject(setObjectHeight(DEFAULT_LAYOUT, 'combat', 'ac', 5), 'combat', 'ac', 'Armor'), 'ac');
    return o.hidden === false && o.span === OBJECT_REGISTRY.ac.defaultSpan && o.height === 5;
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
