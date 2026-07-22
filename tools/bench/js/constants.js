/**
 * Static data for the bench: what a card is made of, and where things start.
 *
 * Naming mirrors the app's own js/constants.js on purpose — the two projects sit
 * next to each other and there is no reason to make you learn a second vocabulary.
 */

/** Where the repo root sits relative to this folder (tools/bench/js/). */
export const REPO_ROOT = '../../../';

/**
 * Every block a card can hold.
 *
 * `cost` is the thing worth knowing before you move something:
 *   'markup' — lives in index.html. Free to move, free to delete.
 *   'js'     — a host element render.js writes into. Free to MOVE, because the
 *              lookup is by id and does not care where the id sits. NOT free to
 *              delete: render.js queries `host` and calls replaceChildren() on the
 *              result with no null check, so removing it throws on first render.
 */
export const BLOCKS = {
  'hp-readout':       { label: 'HP readout',           cost: 'markup' },
  'hp-controls':      { label: 'Damage / heal / rest', cost: 'markup' },
  'combat-fields':    { label: 'Combat numbers',       cost: 'markup',
                        fields: { ac: 'Armour Class', init: 'Initiative', speed: 'Speed',
                                  pb: 'Prof. Bonus', passive: 'Passive Perc.' } },
  'saves-list':       { label: 'Saving throws',        cost: 'js', host: '#saves' },
  'conditions-chips': { label: 'Condition chips',      cost: 'js', host: '#conditions' },
  'attacks-rows':     { label: 'Attack rows',          cost: 'js', host: '#attacks' },
  'hitdice-rows':     { label: 'Hit dice pools',       cost: 'js', host: '#hitDice', subhead: 'Hit Dice' },
  'deathsaves-pips':  { label: 'Death save pips',      cost: 'js', host: '#death-successes', subhead: 'Death Saves' },
  'exhaustion-pips':  { label: 'Exhaustion pips',      cost: 'js', host: '#exhaustion', subhead: 'Exhaustion' },
  'abilities-grid':   { label: 'Ability scores',       cost: 'js', host: '#abilities' },
  'skills-list':      { label: 'Skill list',           cost: 'js', host: '#skills' },
  'spell-meta':       { label: 'Spell DC and attack',  cost: 'markup',
                        fields: { ability: 'Ability', dc: 'Save DC', atk: 'Attack' } },
  'slots-list':       { label: 'Spell slots',          cost: 'js', host: '#slots', subhead: 'Spell Slots' },
  'spells-rows':      { label: 'Spell rows',           cost: 'js', host: '#spells', subhead: 'Spells' },
  'inventory-rows':   { label: 'Inventory rows',       cost: 'js', host: '#inventory' },
  'currency-fields':  { label: 'Currency',             cost: 'markup', subhead: 'Currency',
                        fields: { cp: 'CP', sp: 'SP', ep: 'EP', gp: 'GP', pp: 'PP' } },
  'features-rows':    { label: 'Feature rows',         cost: 'js', host: '#features' },
  'identity-fields':  { label: 'Identity fields',      cost: 'markup',
                        fields: { name: 'Name', player: 'Player', species: 'Species', class: 'Class',
                                  subclass: 'Subclass', level: 'Level', background: 'Background',
                                  alignment: 'Alignment' } },
  'notes-area':       { label: 'Notes',                cost: 'markup' },
};

export const DEFAULT_CARDS = {
  hitpoints:    { title: 'Hit Points',        blocks: ['hp-readout', 'hp-controls'] },
  combat:       { title: 'Combat',            blocks: ['combat-fields'] },
  conditions:   { title: 'Conditions',        blocks: ['conditions-chips'] },
  saves:        { title: 'Saving Throws',     blocks: ['saves-list'] },
  attacks:      { title: 'Attacks',           blocks: ['attacks-rows'] },
  status:       { title: 'Status',            blocks: ['hitdice-rows', 'deathsaves-pips', 'exhaustion-pips'] },
  abilities:    { title: 'Abilities',         blocks: ['abilities-grid'] },
  skills:       { title: 'Skills',            blocks: ['skills-list'] },
  spellcasting: { title: 'Spellcasting',      blocks: ['spell-meta', 'slots-list', 'spells-rows'] },
  inventory:    { title: 'Inventory',         blocks: ['inventory-rows', 'currency-fields'] },
  features:     { title: 'Features & Traits', blocks: ['features-rows'] },
  identity:     { title: 'Identity',          blocks: ['identity-fields'] },
  notes:        { title: 'Notes',             blocks: ['notes-area'] },
};

export const DEFAULT_TABS = [
  { id: 'combat',    label: 'Combat',    glyph: '⚔', cards: ['hitpoints', 'combat', 'conditions', 'saves', 'attacks', 'status'] },
  { id: 'abilities', label: 'Abilities', glyph: '◈', cards: ['abilities', 'skills'] },
  { id: 'spells',    label: 'Spells',    glyph: '✦', cards: ['spellcasting'] },
  { id: 'gear',      label: 'Gear',      glyph: '⌂', cards: ['inventory', 'features'] },
  { id: 'character', label: 'Character', glyph: '✎', cards: ['identity', 'notes'] },
];

/**
 * Fallbacks only. On load the bench parses the real :root out of ../../style.css
 * and overwrites these, so the "current" baseline is whatever is actually on disk
 * rather than a snapshot that quietly goes stale.
 */
export const LIGHT = {
  ink: '#241d16', 'ink-soft': '#5f5245', 'ink-faint': '#8b7d6d',
  parchment: '#f4ede0', card: '#fffaf1', line: '#ded1bc', 'line-soft': '#ece1cd',
  accent: '#7b2d26', good: '#2f6b46', bad: '#a33b2c', gold: '#b08340',
};
export const DARK = {
  ink: '#ece3d6', 'ink-soft': '#b3a693', 'ink-faint': '#857868',
  parchment: '#1a1613', card: '#241f1a', line: '#3d352c', 'line-soft': '#322b23',
  accent: '#c8695c', good: '#5da97b', bad: '#d4705f', gold: '#c9a161',
};

export const METRICS = {
  textBase: 16, scale: 1.15, space: 4, cardpad: 13.6, cardgap: 12,
  radius: 10, bw: 1, tap: 44, tabbar: 56, topbar: 56, shadow: 2,
  titleface: 'serif', groupSkills: false,
};

export const SWATCH_ORDER = [
  'parchment', 'card', 'ink', 'ink-soft', 'ink-faint',
  'line', 'line-soft', 'accent', 'gold', 'good', 'bad',
];

export const WIDTHS = [
  { w: 390,  label: '390',  name: 'iPhone' },
  { w: 430,  label: '430',  name: 'Max' },
  { w: 640,  label: '640',  name: 'breakpoint 1' },
  { w: 900,  label: '900',  name: 'breakpoint 2' },
  { w: 1280, label: '1280', name: 'breakpoint 3' },
];

export const PRESETS = {
  'Current':     {},
  'Airier':      { metrics: { space: 5, cardpad: 18, cardgap: 14, radius: 12 } },
  'Denser':      { metrics: { space: 3, cardpad: 10, cardgap: 8, radius: 8, textBase: 15, tap: 40 } },
  'Flat ink':    { metrics: { radius: 4, shadow: 0 } },
  'Bigger type': { metrics: { textBase: 17, scale: 1.2 } },
  'Cooler':      { light: { parchment: '#eef0ec', card: '#fbfcfa', line: '#d4d8d2', 'line-soft': '#e6e9e4', accent: '#3f5f52' } },
  'Slate':       { light: { parchment: '#e9eaee', card: '#fdfdff', ink: '#1c1f26', line: '#cfd2da', 'line-soft': '#e2e4ea', accent: '#3a4a7a' } },
};

export const DEFAULT_SAMPLE = { name: 'Sister Vell', cls: 'Cleric', subclass: 'Light Domain', level: '5' };

export const STORAGE_KEY = 'dnd-sheet-bench';
export const SCHEMA_VERSION = 3;
