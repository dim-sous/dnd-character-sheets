/**
 * Every derived number on the sheet.
 *
 * These are pure functions: same character in, same number out, no DOM, no state,
 * no side effects. That is what makes tests.html possible without a test framework —
 * and it is the reason none of this arithmetic is ever stored.
 */

import { SKILLS } from './constants.js';

const SKILL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));

/** Coerce anything the user typed into a usable number. */
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function abilityMod(score) {
  return Math.floor((num(score, 10) - 10) / 2);
}

export function proficiencyBonus(level) {
  // Floor the level at 1 so a blank/0/negative Level still yields the +2 minimum, not +1.
  return 2 + Math.floor((Math.max(1, num(level, 1)) - 1) / 4);
}

/** "+3" / "−1" / "+0" — uses a real minus sign, not a hyphen. */
export function formatMod(n) {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

export function characterPB(char) {
  return proficiencyBonus(char.level);
}

export function modFor(char, abilityKey) {
  return abilityMod(char.abilities[abilityKey]);
}

export function saveTotal(char, abilityKey) {
  const proficient = char.saveProficiencies.includes(abilityKey);
  return modFor(char, abilityKey) + (proficient ? characterPB(char) : 0);
}

export function skillTotal(char, skillKey) {
  const skill = SKILL_BY_KEY.get(skillKey);
  if (!skill) return 0;

  const pb = characterPB(char);
  const proficient = char.skillProficiencies.includes(skillKey);
  const expert = char.skillExpertise.includes(skillKey);

  // Each toggle independently adds PB. Expertise-implies-proficiency (#5) is
  // enforced at the doors — toggleInArray for taps, normalizeCharacter for imports —
  // not here: the arithmetic stays permissive, so an illegal pair that somehow
  // leaks in degrades to one PB instead of guessing.
  let total = modFor(char, skill.ability);
  if (proficient) total += pb;
  if (expert) total += pb;
  return total;
}

export function passivePerception(char) {
  return 10 + skillTotal(char, 'perception');
}

export function initiative(char) {
  return modFor(char, 'dex') + num(char.initiativeBonus);
}

export function isSpellcaster(char) {
  return Boolean(char.spellcasting && char.spellcasting.ability);
}

export function spellSaveDC(char) {
  if (!isSpellcaster(char)) return null;
  return 8 + characterPB(char) + modFor(char, char.spellcasting.ability);
}

export function spellAttackBonus(char) {
  if (!isSpellcaster(char)) return null;
  return characterPB(char) + modFor(char, char.spellcasting.ability);
}

/**
 * Damage eats temporary hit points first, then real ones. Current HP floors at 0.
 *
 * This is the only D&D rule the app enforces, and it is a convenience rather than a
 * ruling: max/current/temp all stay directly editable so the player can override it.
 * Returns a new hp object; it does not mutate the one passed in.
 */
export function applyDamage(hp, amount) {
  const dmg = Math.max(0, num(amount));
  const temp = num(hp.temp);
  const absorbed = Math.min(temp, dmg);
  return {
    ...hp,
    temp: temp - absorbed,
    current: Math.max(0, num(hp.current) - (dmg - absorbed)),
  };
}

/** Healing tops out at max HP, unless max is unset (0), in which case it is unbounded. */
export function applyHealing(hp, amount) {
  const heal = Math.max(0, num(amount));
  const max = num(hp.max);
  const current = num(hp.current);
  const raw = current + heal;
  const capped = max > 0 ? Math.min(max, raw) : raw;
  // Healing only ever raises current — never lower it, even when a hand-edited
  // current already sits above max.
  return { ...hp, current: Math.max(current, capped) };
}

/**
 * A 2024 long rest restores every spent Hit Point Die — each pool goes back to its total.
 * (The 2014 rule regained only half, rounded down; 2024 dropped that, and with it any
 * question of which pool a multiclass character recovers into.) New pools; never mutates.
 */
export function restoreHitDice(pools) {
  return pools.map((pool) => ({ ...pool, remaining: num(pool.total) }));
}
