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

/**
 * The spell LIST covers one more level than the spell SLOTS do: cantrips are level 0 and have
 * no slots, so `slots` is keyed by SPELL_LEVELS while the list groups by this (#141). Derived
 * from SPELL_LEVELS rather than written out again, so the range still lives in one place.
 */
export const SPELL_LIST_LEVELS = [0, ...SPELL_LEVELS];

/** What a spell level is called in a heading. Level 0 is the only one that isn't "Nth level". */
export function spellLevelLabel(level) {
  return Number(level) === 0 ? 'Cantrips' : `Level ${level}`;
}

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
    // #78: one of the highest-frequency caster states in play, and the only one with no home —
    // it is not a condition (it is not on the CONDITIONS list, and the 2024 rules do not make it
    // one), so it gets its own flag and its own tile rather than being smuggled in there.
    concentration: false,

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
    // #68: the same pair for saving throws — a flat bonus to every save (Paladin's Aura
    // of Protection, a cloak of protection) and a per-save one. Same hand-maintained
    // contract as the skill bonuses above: typed once, retyped when it changes.
    saveBonusAll: 0,
    saveBonuses: Object.fromEntries(ABILITIES.map((a) => [a.key, 0])),

    ac: 10,
    initiativeBonus: 0,
    speed: 30,
    hp: { max: 0, current: 0, temp: 0 },
    // A list of pools, one per class, so a multiclass build (e.g. 3d10 + 2d6) fits.
    hitDice: [{ size: 'd8', total: 3, remaining: 3 }],
    deathSaves: { successes: 0, failures: 0 },
    conditions: [],
    exhaustion: 0,
    // #140: class/subclass resources — Rage, Ki, Bardic Inspiration, Channel Divinity, a
    // once-per-rest subclass trick. Deliberately the SHAPE of `hitDice` and nothing more: a
    // name the player types and a remaining/total pair. The app never learns which resource
    // recovers on which rest, which is why there is no `recovery` field and why `longRest()`
    // does not touch this list — see the note there. Absent in every pre-#140 file, and
    // normalizeRows turns a missing array into [], so no migration and no SCHEMA_VERSION bump
    // (exactly the path `feats` took in #67).
    resources: [],

    attacks: [],

    spellcasting: {
      ability: '',
      // Derived from SPELL_LEVELS so the range lives in exactly one place.
      slots: Object.fromEntries(SPELL_LEVELS.map((l) => [l, { total: 0, used: 0 }])),
      spells: [],
    },

    features: [],
    feats: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    // #69: free text, one blob per kind — a tracker records what you're proficient with,
    // it does not model weapon/armour categories. Fixed key set, normalized like `currency`.
    proficiencies: { weapons: '', armor: '', tools: '', languages: '' },
    notes: '',
  };
}

export const ROW_TEMPLATES = {
  // #84: `ability` is the MODE SWITCH for to-hit. '' is Custom — the free-text `bonus` the
  // player typed stands (Exhaustion-adjusted in the readout when it parses as a plain number,
  // exactly the split `speed`/`effectiveSpeed` uses). Any ability key derives it instead:
  // mod + PB (if proficient) + miscBonus − Exhaustion, so a level-up or an exhaustion level
  // reaches weapon attacks the way it already reaches saves, skills and spell attacks.
  //
  // `bonus` therefore STAYS in the template. normalizeRow builds its output solely from
  // template keys, so dropping it would discard every stored to-hit string on load and the
  // debounced save would then persist the loss — and "just retype it as a number" silently
  // zeroes exactly the rows carrying the most information ("+5 (adv)", "1d20+5", "+5/+0").
  // Defaulting `ability` to '' is also what backfills every pre-existing row into Custom
  // mode with no migration and no SCHEMA_VERSION bump.
  attacks: () => ({
    name: '', ability: '', proficient: true, miscBonus: 0, bonus: '', damage: '', notes: '',
  }),
  /*
   * #141. `name`/`level`/`prepared` are the shape the inert list shipped with and #9 hid; the
   * five that follow are the at-a-glance fields you look up mid-turn, and they live in the
   * row's tap-revealed detail rather than on its one visible line (#139: `.row__primary` has a
   * history of items summing to exactly the container width and wrapping).
   *
   * All free text, including `castingTime` and `components` — the app does not know what an
   * action is or that V/S/M is a closed set, and a player writing "1 action (ritual)" or
   * "V, S, M (a pinch of soot)" must get back exactly what they typed. `level` stays a NUMBER
   * because the list groups by it; everything else is a string.
   *
   * normalizeRow builds its output solely from template keys, so every spell saved before this
   * backfills to '' with no migration code and no SCHEMA_VERSION bump — the same free ride
   * #67 took when it added source/level to features.
   */
  spells: () => ({
    name: '', level: 0, prepared: false,
    castingTime: '', range: '', duration: '', components: '', notes: '',
  }),
  // #67: source (Species / Background / Class / Other) and level stay FREE TEXT — the sheet
  // records where a feature came from, it doesn't model class progression. Old rows carry only
  // name+text; normalizeRow is template-driven, so they backfill to '' with no migration code.
  features: () => ({ name: '', source: '', level: '', text: '' }),
  feats: () => ({ name: '', source: '', text: '' }),
  inventory: () => ({ item: '', qty: 1, notes: '' }),
  hitDice: () => ({ size: 'd8', total: 1, remaining: 1 }),
  // #140: `remaining`/`total` named to match the hitDice row above, so the two tiles read the
  // same way and share their row CSS. Both start at 0 rather than 1: a resource's size is
  // whatever the player types, and there is no sensible guess — where a Hit Point Dice pool
  // added by hand is almost always at least one die, a blank resource is a blank resource.
  // `remaining` is NOT clamped to `total` anywhere (hitDice isn't either): a total of 0 means
  // "not tracked", the same contract Max HP has, and clamping would be a rule.
  resources: () => ({ name: '', remaining: 0, total: 0 }),
};
