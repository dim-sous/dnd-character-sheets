/**
 * Spells the table uses that the SRD 5.2.1 does not contain — hand-written, unlike its neighbour.
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
 * Same keys as an SRD entry plus `source`; spellToRow copies the eight row fields and ignores the
 * rest, so `source` never reaches a character. tests.js holds every entry to the SRD entries'
 * shape, and refuses a name the SRD already has — the picker would list it twice.
 *
 * Small, but loaded on demand like the SRD file, so the boot path stays the same.
 */
export const EXTRA_SPELLS = [
  {
    name: 'Summon Beast',
    level: 2,
    school: 'Conjuration',
    classes: ['Druid', 'Ranger'],
    castingTime: 'Action',
    range: '90 feet',
    components: 'V, S, M (a feather, tuft of fur, and fish tail inside a gilded acorn worth 200+ GP)',
    duration: 'Concentration, up to 1 hour',
    concentration: true,
    ritual: false,
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
];
