/**
 * Every derived number on the sheet.
 *
 * These are pure functions: same character in, same number out, no DOM, no state,
 * no side effects. That is what makes tests.html possible without a test framework —
 * and it is the reason none of this arithmetic is ever stored.
 */

import { ABILITIES, SKILLS } from './constants.js';

const SKILL_BY_KEY = new Map(SKILLS.map((s) => [s.key, s]));
const ABILITY_KEYS = new Set(ABILITIES.map((a) => a.key));

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

/**
 * Exhaustion level, floored at 0. It is tracked and clamped to 0..MAX_EXHAUSTION at the
 * doors (on input and on import, storage.js), so this is belt-and-braces: a hand-edited
 * file with a negative level must not turn the penalty into a bonus.
 */
function exhaustionLevel(char) {
  return Math.max(0, num(char.exhaustion));
}

/**
 * 2024 Exhaustion: "When you make a D20 Test, the roll is reduced by 2 × your Exhaustion
 * level." Applied to every roll TOTAL this sheet derives — saveTotal, skillTotal,
 * initiative, spellAttackBonus. Returns 0 at level 0, so a character with no exhaustion
 * sees exactly the numbers they saw before (#63).
 *
 * Deliberately NOT applied to:
 * - spellSaveDC — a DC is not a roll. The D20 Test there is the *target's* saving throw,
 *   already covered by saveTotal on the target's own sheet.
 * - modFor/abilityMod — the bare ability-modifier readout stays raw. It is a component,
 *   not a total: it feeds the four penalized functions (which would then double-apply),
 *   and it also feeds damage rolls and the DC, neither of which Exhaustion touches. The
 *   cost is that a straight ability check read off that readout doesn't show the penalty.
 */
export function exhaustionPenalty(char) {
  return -2 * exhaustionLevel(char);
}

/**
 * Speed after Exhaustion — "your Speed is reduced by 5 × your Exhaustion level feet" —
 * floored at 0 so six levels never render a negative. The stored `speed` stays the BASE
 * value the player typed and is what the Edit field still binds to, exactly the split
 * initiativeBonus → initiative already uses, so dropping a level restores it precisely.
 */
export function effectiveSpeed(char) {
  return Math.max(0, num(char.speed) - 5 * exhaustionLevel(char));
}

export function saveTotal(char, abilityKey) {
  const proficient = char.saveProficiencies.includes(abilityKey);
  let total = modFor(char, abilityKey) + (proficient ? characterPB(char) : 0);
  // #68: hand-computed extras, the mirror of skillTotal's — flat across every save, plus
  // a per-save one. Never recomputed from a formula, on purpose.
  total += num(char.saveBonusAll) + num(char.saveBonuses[abilityKey]);
  total += exhaustionPenalty(char);
  return total;
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
  // #57: hand-computed extras — a flat bonus to every skill and a per-skill one,
  // typed in once and retyped by hand if they ever change (item swapped, leveled
  // into a new feature). Never recomputed from a formula, on purpose.
  total += num(char.skillBonusAll) + num(char.skillBonuses[skillKey]);
  // #63: an ability check is a D20 Test. Living here rather than at each call site is
  // what makes passivePerception inherit it — a deliberate call, see the note there.
  total += exhaustionPenalty(char);
  return total;
}

/** A discreet stand-in for the prof/expertise checkboxes when the skill list is collapsed. */
export function skillMarker(char, skillKey) {
  if (char.skillExpertise.includes(skillKey)) return 'E';
  if (char.skillProficiencies.includes(skillKey)) return 'P';
  return '';
}

export function saveMarker(char, abilityKey) {
  return char.saveProficiencies.includes(abilityKey) ? 'P' : '';
}

/**
 * Passive Perception inherits the Exhaustion penalty through skillTotal (#63).
 *
 * By the letter of the rule a passive check "doesn't involve a roll" and so is not a
 * D20 Test — but a reduced Perception check reading as a reduced passive score is what
 * tables expect. Recorded here so it doesn't get "fixed" as a leak later.
 */
export function passivePerception(char) {
  return 10 + skillTotal(char, 'perception');
}

export function initiative(char) {
  // Initiative is a Dexterity check, so it takes the Exhaustion penalty like any other.
  return modFor(char, 'dex') + num(char.initiativeBonus) + exhaustionPenalty(char);
}

export function isSpellcaster(char) {
  return Boolean(char.spellcasting && char.spellcasting.ability);
}

/** No Exhaustion penalty here on purpose — a DC is not a roll. See exhaustionPenalty. */
export function spellSaveDC(char) {
  if (!isSpellcaster(char)) return null;
  return 8 + characterPB(char) + modFor(char, char.spellcasting.ability);
}

export function spellAttackBonus(char) {
  if (!isSpellcaster(char)) return null;
  return characterPB(char) + modFor(char, char.spellcasting.ability) + exhaustionPenalty(char);
}

/* ------------------------------------------------------------ attack to-hit (#84) */

/**
 * An attack row derives its to-hit only when it names a governing ability. '' is Custom —
 * the mode every pre-existing row backfills into — where the free-text `bonus` stands.
 *
 * An unrecognised string (a hand-edited file, a key we later rename) is read as Custom
 * rather than derived: modFor would happily return +0 for it, and quietly showing +0 in
 * place of what the player typed is the one outcome worth ruling out by construction.
 */
export function isDerivedAttack(attack) {
  return Boolean(attack) && ABILITY_KEYS.has(attack.ability);
}

/**
 * A weapon attack is a D20 Test, so it takes the Exhaustion penalty like every other total
 * this sheet derives. The governing ability is per-row DATA, not static metadata the way a
 * skill's is — a rapier is DEX for one character and STR for the next — so unlike
 * skillTotal(char, key) this takes the row itself.
 *
 * `proficient` is deliberately per-row arithmetic and does NOT read #69's free-text weapon
 * proficiencies: that field records WHAT you are proficient with in the player's own words,
 * which the app cannot match against an attack named "Dagger (offhand)". One is prose, one
 * is a number — only this one is authoritative for the total.
 */
export function attackToHit(char, attack) {
  return modFor(char, attack.ability)
    + (attack.proficient ? characterPB(char) : 0)
    + num(attack.miscBonus)
    + exhaustionPenalty(char);
}

/**
 * The Speed treatment for a to-hit the player typed by hand: a plain signed integer is
 * arithmetic we can safely do, so the Exhaustion penalty lands on it; anything else
 * ("+5 (adv)", "+5/+0", "1d20+5") is echoed verbatim, exactly as render's `raw` case does.
 * The STORED string is never rewritten — dropping the exhaustion level restores it exactly.
 */
function adjustedBonusText(char, bonus) {
  const text = String(bonus ?? '').trim();
  // formatMod prints a real minus sign, so accept one back: a value copied out of a readout
  // must not stop being a number the moment it is pasted into the field.
  const signed = text.replace(/^−/, '-');
  if (!/^[+-]?\d+$/.test(signed)) return text;
  return formatMod(Number(signed) + exhaustionPenalty(char));
}

/**
 * What a row's to-hit readout shows, in either mode — the one string render.js asks for.
 * Blank stays blank: a row with no to-hit yet should read as empty, not as a confident +0.
 */
export function attackHit(char, attack) {
  if (!attack) return '';
  if (isDerivedAttack(attack)) return formatMod(attackToHit(char, attack));
  return adjustedBonusText(char, attack.bonus);
}

/**
 * Damage eats temporary hit points first, then real ones. Current HP floors at 0.
 *
 * This is the only D&D rule the app applies to a STORED value, and it is a convenience
 * rather than a ruling: max/current/temp all stay directly editable so the player can
 * override it. (Exhaustion, #63, reduces recomputed readouts only — nothing stored.)
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
 * Interpret what a player typed into the Current HP field — the sole HP-change control now
 * that the +/- steppers and the Damage/Heal buttons are gone. A *signed* value is a delta:
 * `-8` takes 8 damage (through temp first, via applyDamage), `+5` heals 5 (capped at max, via
 * applyHealing). A *bare* number sets current HP outright — the hand-override that keeps this
 * a tracker, not a rules engine (it may sit above max). Blank or non-numeric input is a no-op.
 * Returns a new hp object; never mutates.
 */
export function applyHpInput(hp, raw) {
  const text = String(raw).trim();
  if (text === '') return { ...hp };
  const n = Number(text);
  if (!Number.isFinite(n)) return { ...hp };
  // A leading + or - marks a delta; a bare number is an absolute set.
  if (/^[+-]/.test(text)) {
    return n < 0 ? applyDamage(hp, -n) : applyHealing(hp, n);
  }
  return { ...hp, current: n };
}

/**
 * A 2024 long rest restores every spent Hit Point Die — each pool goes back to its total.
 * (The 2014 rule regained only half, rounded down; 2024 dropped that, and with it any
 * question of which pool a multiclass character recovers into.) New pools; never mutates.
 */
export function restoreHitDice(pools) {
  return pools.map((pool) => ({ ...pool, remaining: num(pool.total) }));
}
