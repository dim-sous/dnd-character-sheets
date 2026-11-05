/**
 * Spells the table uses that the SRD 5.2.1 does not contain — hand-written, unlike its neighbour.
 *
 * TO ADD ONE: README.md → "Adding a spell to the library" has a block to paste, what each field
 * accepts, the test command, and what each failure means. Then run `node tools/run-tests.mjs`.
 *
 * spell-data.js is GENERATED from the SRD, and a regeneration rewrites it from scratch, so a spell
 * patched into it by hand would vanish on the next run. These live here instead, in the same shape,
 * and the picker loads both on first open and searches them as one list.
 *
 * NEVER PASTE A BOOK'S TEXT HERE. The SRD is licensed for sharing (CC-BY 4.0, attributed in the
 * picker); a spell outside it is not, and this site is public. What an entry may hold:
 *   - the spell's facts: level, school, classes, casting time, range, components, duration, and
 *     the numbers of any stat block it summons — game mechanics, not prose;
 *   - wording the SRD itself licenses: the summon spells share their boilerplate, and the SRD's
 *     own copy of it (Summon Dragon) is reused, adapted, for that part;
 *   - everything else written for this app, as short as the rule allows.
 * `source` names the book a spell comes from. The picker shows it on the result, so nobody takes
 * an entry for SRD text, and tests.js refuses an entry without one.
 *
 * Same keys as an SRD entry plus `source`, and the same VALUE model for casting time, range,
 * components and duration — written once as values, never as the book's sentence; the model is
 * documented at the top of js/spell-library.js, and spellToRow formats it into the sentence a
 * character's row carries. `source` never reaches a character. tests.js holds every entry to the
 * model, and refuses a name the SRD already has — the picker would list it twice.
 *
 * Small, but loaded on demand like the SRD file, so the boot path stays the same.
 */
export const EXTRA_SPELLS = [
  {
    name: 'Summon Beast',
    level: 2,
    school: 'Conjuration',
    classes: ['Druid', 'Ranger'],
    castingTime: { unit: 'action' },
    range: { unit: 'foot', amount: 90 },
    components: {
      verbal: true, somatic: true,
      material: 'a feather, tuft of fur, and fish tail inside a gilded acorn worth 200+ GP',
    },
    duration: { unit: 'hour', amount: 1, concentration: true },
    source: 'PHB 2024',
    text: [
      'You call forth a bestial spirit. It manifests in an unoccupied space that you can see within '
        + 'range and uses the Bestial Spirit stat block. When you cast the spell, choose Air, Land or '
        + 'Water: the spirit looks like an animal of your choice from that environment, and the choice '
        + 'sets the lines of the stat block marked with it. The creature disappears when it drops to '
        + '0 Hit Points or when the spell ends.',
      'The creature is an ally to you and your allies. In combat, the creature shares your Initiative '
        + 'count, but it takes its turn immediately after yours. It obeys your verbal commands (no '
        + "action required by you). If you don't issue any, it takes the Dodge action and uses its "
        + 'movement to avoid danger.',
      "Using a Higher-Level Spell Slot. Use the spell slot's level for the spell's level in the stat block.",
      'Bestial Spirit',
      'Small Beast, Neutral',
      "AC 11 + the spell's level\n"
        + 'HP 20 (Air only) or 30 (Land and Water only) + 5 for each spell level above 2\n'
        + 'Speed 30 ft., Climb 30 ft. (Land only), Fly 60 ft. (Air only), Swim 30 ft. (Water only)',
      'STR 18 (+4), DEX 11 (+0), CON 16 (+3)\nINT 4 (−3), WIS 14 (+2), CHA 5 (−3)',
      'Senses Darkvision 60 ft.; Passive Perception 12\n'
        + 'Languages Understands the languages you know\n'
        + 'CR None (XP 0; PB equals your Proficiency Bonus)',
      'Traits\n'
        + "Flyby (Air only). It doesn't provoke Opportunity Attacks when it flies out of an enemy's reach.\n"
        + 'Pack Tactics (Land and Water only). It has Advantage on an attack roll against a creature '
        + "if one of the spirit's allies is within 5 feet of that creature and isn't Incapacitated.\n"
        + 'Water Breathing (Water only). It can breathe only underwater.',
      'Actions\n'
        + "Multiattack. The spirit makes a number of Rend attacks equal to half the spell's level (round down).\n"
        + 'Rend. Melee Attack Roll: Bonus equals your spell attack modifier, reach 5 feet. '
        + "Hit: 1d8 + 4 + the spell's level Piercing damage.",
    ].join('\n\n'),
  },
  {
    name: 'Shadow Blade',
    level: 2,
    school: 'Illusion',
    classes: ['Sorcerer', 'Wizard', 'Warlock'],
    castingTime: { unit: 'bonusAction' },
    range: { unit: 'self' },
    components: { verbal: true, somatic: true },
    duration: { unit: 'minute', amount: 1, concentration: true },
    source: 'XGtE',
    text: [
      'A sword of shadow appears in your hand for the duration. It is a Simple Melee weapon you are '
        + 'proficient with, with the Finesse, Light and Thrown (range 20/60) properties, and a hit '
        + 'deals 2d8 Psychic damage. Your attack rolls with it have Advantage against a target in '
        + 'Dim Light or Darkness.',
      'A dropped or thrown sword vanishes at the end of the turn. While the spell lasts, a Bonus '
        + 'Action brings it back to your hand.',
      'Using a Higher-Level Spell Slot. The damage is 3d8 with a level 3 or 4 slot, 4d8 with a '
        + 'level 5 or 6 slot, and 5d8 with a slot of level 7 or higher.',
    ].join('\n\n'),
  },
  {
    name: 'Far Step',
    level: 5,
    school: 'Conjuration',
    classes: ['Sorcerer', 'Wizard', 'Warlock'],
    castingTime: { unit: 'bonusAction' },
    range: { unit: 'self' },
    components: { verbal: true },
    duration: { unit: 'minute', amount: 1, concentration: true },
    source: 'XGtE',
    text: 'You teleport up to 60 feet to an unoccupied space you can see. Until the spell ends, '
      + 'you can do it again as a Bonus Action on each of your later turns.',
  },
  {
    name: 'Thunder Step',
    level: 3,
    school: 'Conjuration',
    classes: ['Sorcerer', 'Warlock', 'Wizard'],
    castingTime: { unit: 'action' },
    range: { unit: 'foot', amount: 90 },
    components: { verbal: true },
    duration: { unit: 'instantaneous' },
    source: 'XGtE',
    text: [
      'You teleport to an unoccupied space you can see within range, leaving a thunderclap behind. '
        + 'Each creature within 10 feet of the space you left makes a Constitution saving throw, '
        + 'taking 3d10 Thunder damage on a failed save or half as much on a success. The boom is '
        + 'audible up to 300 feet away.',
      'Objects you could carry come with you. So can one willing creature your size or smaller, with '
        + 'gear up to its own carrying capacity, if it is within 5 feet of you when you cast the spell. '
        + 'It arrives in an unoccupied space within 5 feet of where you land; with no such space, it '
        + 'stays behind.',
      'Using a Higher-Level Spell Slot. The damage increases by 1d10 for each spell slot level above 3.',
    ].join('\n\n'),
  },
  {
    name: 'Summon Celestial',
    level: 5,
    school: 'Conjuration',
    classes: ['Cleric', 'Paladin'],
    castingTime: { unit: 'action' },
    range: { unit: 'foot', amount: 90 },
    components: { verbal: true, somatic: true, material: 'a reliquary worth 500+ GP' },
    duration: { unit: 'hour', amount: 1, concentration: true },
    source: 'PHB 2024',
    text: [
      'You call forth a celestial spirit. It manifests in angelic form in an unoccupied space that you can see within '
        + 'range and uses the Celestial Spirit stat block. When you cast the spell, choose Avenger or '
        + 'Defender: the choice sets the lines of the stat block marked with it. The creature '
        + 'disappears when it drops to 0 Hit Points or when the spell ends.',
      'The creature is an ally to you and your allies. In combat, the creature shares your Initiative '
        + 'count, but it takes its turn immediately after yours. It obeys your verbal commands (no '
        + "action required by you). If you don't issue any, it takes the Dodge action and uses its "
        + 'movement to avoid danger.',
      "Using a Higher-Level Spell Slot. Use the spell slot's level for the spell's level in the stat block.",
      'Celestial Spirit',
      'Large Celestial, Neutral',
      "AC 11 + the spell's level + 2 (Defender only)\n"
        + 'HP 40 + 10 for each spell level above 5\n'
        + 'Speed 30 ft., Fly 40 ft.',
      'STR 16 (+3), DEX 14 (+2), CON 16 (+3)\nINT 10 (+0), WIS 14 (+2), CHA 16 (+3)',
      'Resistances Radiant\n'
        + 'Immunities Charmed, Frightened\n'
        + 'Senses Darkvision 60 ft.; Passive Perception 12\n'
        + 'Languages Celestial, understands the languages you know\n'
        + 'CR None (XP 0; PB equals your Proficiency Bonus)',
      'Actions\n'
        + "Multiattack. The spirit makes a number of attacks equal to half the spell's level (round down).\n"
        + 'Radiant Bow (Avenger only). Ranged Attack Roll: Bonus equals your spell attack modifier, '
        + "range 600 feet. Hit: 2d6 + 2 + the spell's level Radiant damage.\n"
        + 'Radiant Mace (Defender only). Melee Attack Roll: Bonus equals your spell attack modifier, '
        + "reach 5 feet. Hit: 1d10 + 3 + the spell's level Radiant damage, and the spirit gives "
        + '1d10 Temporary Hit Points to itself or another creature it can see within 10 feet of the target.\n'
        + 'Healing Touch (1/Day). The spirit touches another creature, which regains Hit Points equal '
        + "to 2d8 + the spell's level.",
    ].join('\n\n'),
  },
  {
    name: 'Arcane Vigor',
    level: 2,
    school: 'Abjuration',
    classes: ['Sorcerer', 'Wizard'],
    castingTime: { unit: 'bonusAction' },
    range: { unit: 'self' },
    components: { verbal: true, somatic: true },
    duration: { unit: 'instantaneous' },
    source: 'PHB 2024',
    text: [
      'You heal yourself by drawing on your own stamina. Roll one or two of your unspent Hit Point '
        + 'Dice; you regain Hit Points equal to the total plus your spellcasting ability modifier, '
        + 'and the dice you rolled are spent.',
      'Using a Higher-Level Spell Slot. You can roll one more Hit Point Die for each spell slot '
        + 'level above 2.',
    ].join('\n\n'),
  },
  {
    name: 'Disruptive Tune',
    level: 2,
    school: 'Abjuration',
    classes: ['Bard', 'Sorcerer', 'Wizard'],
    castingTime: { unit: 'action' },
    range: { unit: 'foot', amount: 120 },
    components: { verbal: true, somatic: true },
    duration: { unit: 'minute', amount: 1, concentration: true },
    source: 'AU',
    text: 'A jarring melody fills a 20-foot-radius Sphere centered on a point you choose within range. '
      + 'Each creature in it makes a Constitution saving throw. On a failed save, the creature loses '
      + 'Concentration on any spell it is maintaining, and until this spell ends it has Disadvantage '
      + 'on Constitution saving throws made to keep Concentration.',
  },
  {
    name: 'Circle of Power',
    level: 5,
    school: 'Abjuration',
    classes: ['Cleric', 'Paladin', 'Wizard'],
    castingTime: { unit: 'action' },
    range: { unit: 'self' },
    components: { verbal: true },
    duration: { unit: 'minute', amount: 10, concentration: true },
    source: 'PHB 2024',
    text: 'For the duration, an aura surrounds you in a 30-foot Emanation. You and your allies in it '
      + 'have Advantage on saving throws against spells and other magical effects, and an affected '
      + 'creature that succeeds on such a save against an effect that deals half damage on a success '
      + 'takes no damage instead.',
  },
  {
    name: 'Zephyr Strike',
    level: 1,
    school: 'Transmutation',
    classes: ['Ranger'],
    castingTime: { unit: 'bonusAction' },
    range: { unit: 'self' },
    components: { verbal: true },
    duration: { unit: 'minute', amount: 1, concentration: true },
    source: 'PHB 2024',
    text: 'You move like the wind. While the spell lasts, your movement does not provoke '
      + 'Opportunity Attacks. Once before it ends, you can give yourself Advantage on one weapon '
      + 'attack roll on your turn, and if that attack hits it deals an extra 1d8 Force damage. '
      + 'Hit or miss, your Speed is 30 feet higher until the end of that turn.',
  },
  {
    name: 'Lightning Arrow',
    level: 3,
    school: 'Transmutation',
    classes: ['Ranger'],
    castingTime: { unit: 'bonusAction', trigger: 'immediately after making a ranged attack with a weapon' },
    range: { unit: 'self' },
    components: { verbal: true, somatic: true },
    duration: { unit: 'instantaneous' },
    source: 'PHB 2024',
    text: [
      'The ammunition or weapon you just used turns into a bolt of lightning. The target of the '
        + 'attack takes 4d8 Lightning damage if the attack hit, or half as much if it missed. Each '
        + 'other creature within 10 feet of the target makes a Dexterity saving throw, taking 2d8 '
        + 'Lightning damage on a failed save or half as much on a success.',
      'Using a Higher-Level Spell Slot. The damage of both effects increases by 1d8 for each spell '
        + 'slot level above 3.',
    ].join('\n\n'),
  },
  {
    name: 'Conjure Barrage',
    level: 3,
    school: 'Conjuration',
    classes: ['Ranger'],
    castingTime: { unit: 'action' },
    range: { unit: 'self' },
    components: {
      verbal: true, somatic: true,
      material: 'a piece of Ammunition or a Thrown weapon',
    },
    duration: { unit: 'instantaneous' },
    source: 'PHB 2024',
    text: [
      'You brandish the weapon or ammunition you used as the component, and spectral copies of it '
        + 'fill a 60-foot Cone. Each creature in the Cone makes a Dexterity saving throw, taking '
        + '5d8 damage on a failed save or half as much on a success. The damage is of the same type '
        + 'as the weapon or ammunition you used.',
      'Using a Higher-Level Spell Slot. The damage increases by 1d8 for each spell slot level above 3.',
    ].join('\n\n'),
  },
];
