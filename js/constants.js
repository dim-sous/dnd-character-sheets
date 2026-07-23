/**
 * Static game data and the shape of a character.
 *
 * Nothing here has side effects, so both the app and tests.html can import it freely.
 */

export const STORAGE_KEY = 'dnd-character-sheets';
// Bumped to 2 when hitDice went from a single {size,total,remaining} object to a list
// of pools (multiclass). normalizeCharacter migrates the old shape either way.
export const SCHEMA_VERSION = 2;

export const ABILITIES = [
  { key: 'str', short: 'STR', label: 'Strength' },
  { key: 'dex', short: 'DEX', label: 'Dexterity' },
  { key: 'con', short: 'CON', label: 'Constitution' },
  { key: 'int', short: 'INT', label: 'Intelligence' },
  { key: 'wis', short: 'WIS', label: 'Wisdom' },
  { key: 'cha', short: 'CHA', label: 'Charisma' },
];

/** The 2024 skill list with its governing ability. */
export const SKILLS = [
  { key: 'acrobatics', label: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', label: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', label: 'Arcana', ability: 'int' },
  { key: 'athletics', label: 'Athletics', ability: 'str' },
  { key: 'deception', label: 'Deception', ability: 'cha' },
  { key: 'history', label: 'History', ability: 'int' },
  { key: 'insight', label: 'Insight', ability: 'wis' },
  { key: 'intimidation', label: 'Intimidation', ability: 'cha' },
  { key: 'investigation', label: 'Investigation', ability: 'int' },
  { key: 'medicine', label: 'Medicine', ability: 'wis' },
  { key: 'nature', label: 'Nature', ability: 'int' },
  { key: 'perception', label: 'Perception', ability: 'wis' },
  { key: 'performance', label: 'Performance', ability: 'cha' },
  { key: 'persuasion', label: 'Persuasion', ability: 'cha' },
  { key: 'religion', label: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', label: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', label: 'Stealth', ability: 'dex' },
  { key: 'survival', label: 'Survival', ability: 'wis' },
];

export const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
  'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained',
  'Stunned', 'Unconscious',
];

export const SPELL_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export const MAX_EXHAUSTION = 6;

/**
 * crypto.randomUUID() only exists in a secure context (HTTPS or localhost).
 * Over a plain http:// LAN address it is undefined, so we need the fallback.
 */
export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The canonical shape. Every stored or imported character is merged over this. */
export function blankCharacter() {
  return {
    id: newId(),
    name: '',
    player: '',
    species: '',
    class: '',
    subclass: '',
    level: 3,
    background: '',
    alignment: '',
    heroicInspiration: false,

    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProficiencies: [],
    skillProficiencies: [],
    skillExpertise: [],
    // #57: hand-computed extras layered on top of mod + prof/expertise — a flat
    // bonus to every skill (e.g. a magic item) and a per-skill bonus (e.g. half PB
    // for Jack of All Trades, an ability mod for Primal Order). Plain numbers the
    // player retypes by hand when they change, same as every other stored field here.
    skillBonusAll: 0,
    skillBonuses: Object.fromEntries(SKILLS.map((s) => [s.key, 0])),

    ac: 10,
    initiativeBonus: 0,
    speed: 30,
    hp: { max: 0, current: 0, temp: 0 },
    // A list of pools, one per class, so a multiclass build (e.g. 3d10 + 2d6) fits.
    hitDice: [{ size: 'd8', total: 3, remaining: 3 }],
    deathSaves: { successes: 0, failures: 0 },
    conditions: [],
    exhaustion: 0,

    attacks: [],

    spellcasting: {
      ability: '',
      // Derived from SPELL_LEVELS so the range lives in exactly one place.
      slots: Object.fromEntries(SPELL_LEVELS.map((l) => [l, { total: 0, used: 0 }])),
      spells: [],
    },

    features: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    notes: '',
  };
}

export const ROW_TEMPLATES = {
  attacks: () => ({ name: '', bonus: '', damage: '', notes: '' }),
  spells: () => ({ name: '', level: 0, prepared: false }),
  features: () => ({ name: '', text: '' }),
  inventory: () => ({ item: '', qty: 1, notes: '' }),
  hitDice: () => ({ size: 'd8', total: 1, remaining: 1 }),
};
