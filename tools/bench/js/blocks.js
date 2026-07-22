/**
 * The preview's content: a plausible level 5 Cleric, and the markup for each block.
 *
 * The numbers are real arithmetic (PB +3, WIS 16, so a spell DC of 14 and Medicine
 * at +9 with expertise) because placeholder values make density judgements lie.
 */

import { BLOCKS } from './constants.js';
import { get } from './state.js';

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ABILITIES = [
  ['STR', 10, '+0'], ['DEX', 14, '+2'], ['CON', 14, '+2'],
  ['INT', 10, '+0'], ['WIS', 16, '+3'], ['CHA', 12, '+1'],
];

const SKILL_ROWS = [
  ['Acrobatics', 'DEX', '+2', 0, 0], ['Animal Handling', 'WIS', '+3', 0, 0],
  ['Arcana', 'INT', '+0', 0, 0], ['Athletics', 'STR', '+0', 0, 0],
  ['Deception', 'CHA', '+1', 0, 0], ['History', 'INT', '+0', 0, 0],
  ['Insight', 'WIS', '+6', 1, 0], ['Intimidation', 'CHA', '+1', 0, 0],
  ['Investigation', 'INT', '+0', 0, 0], ['Medicine', 'WIS', '+9', 1, 1],
  ['Nature', 'INT', '+0', 0, 0], ['Perception', 'WIS', '+6', 1, 0],
  ['Performance', 'CHA', '+1', 0, 0], ['Persuasion', 'CHA', '+1', 0, 0],
  ['Religion', 'INT', '+3', 1, 0], ['Sleight of Hand', 'DEX', '+2', 0, 0],
  ['Stealth', 'DEX', '+2', 0, 0], ['Survival', 'WIS', '+3', 0, 0],
];

const SAVE_ROWS = [
  ['Strength', '+0', 0], ['Dexterity', '+2', 0], ['Constitution', '+2', 0],
  ['Intelligence', '+0', 0], ['Wisdom', '+6', 1], ['Charisma', '+4', 1],
];

const CONDS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated',
  'Invisible', 'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];

const COMBAT_VALS = { ac: 18, init: '+2', speed: 30, pb: '+3', passive: 16 };
const SPELL_VALS = { ability: 'WIS', dc: 14, atk: '+6' };
const CURRENCY_VALS = { cp: 12, sp: 8, ep: 0, gp: 143, pp: 2 };

function identityVals() {
  const s = get().sample;
  return {
    name: s.name, player: 'Ilias', species: 'Human', class: s.cls,
    subclass: s.subclass, level: s.level, background: 'Acolyte', alignment: 'LG',
  };
}

function pips(n, on, cls = '') {
  let out = `<div class="pips ${cls}">`;
  for (let i = 0; i < n; i += 1) {
    out += `<button type="button" class="pip${i < on ? ' is-on' : ''}" tabindex="-1"></button>`;
  }
  return `${out}</div>`;
}

function field(label, value, type = 'text') {
  return `<p class="field"><label>${escapeHtml(label)}</label>
    <input type="${type}" value="${escapeHtml(value)}" readonly tabindex="-1"></p>`;
}

const NUMERIC = new Set(['ac', 'speed', 'level', 'cp', 'sp', 'ep', 'gp', 'pp', 'dc']);

function fieldGrid(blockId, values, cls = 'field-grid') {
  const def = BLOCKS[blockId];
  const cfg = get().blockCfg[blockId];
  const keys = Object.keys(def.fields).filter((k) => !cfg.hidden.includes(k));
  if (!keys.length) return '';
  return `<div class="${cls}">${keys
    .map((k) => field(def.fields[k], values[k], NUMERIC.has(k) ? 'number' : 'text')).join('')}</div>`;
}

export const BLOCK_HTML = {
  'hp-readout': () => `
    <div class="hp">
      <span class="hp__big">31</span><span class="hp__slash">/</span><span class="hp__max">38</span>
      <span class="hp__spacer"></span>
      <span class="field" style="max-width:4.6rem"><label>Temp</label>
        <input type="number" value="4" readonly tabindex="-1"></span>
    </div>`,

  'hp-controls': () => `
    <div class="hp-controls">
      <input type="number" placeholder="0" readonly tabindex="-1">
      <button class="btn btn--danger" tabindex="-1">Damage</button>
      <button class="btn btn--good" tabindex="-1">Heal</button>
    </div>
    <div class="btn-row" style="margin-top:var(--s3)">
      <button class="btn" tabindex="-1">−1</button>
      <button class="btn" tabindex="-1">+1</button>
      <button class="btn btn--primary" tabindex="-1">Long rest</button>
    </div>`,

  'combat-fields': () => fieldGrid('combat-fields', COMBAT_VALS),

  'saves-list': () => `<div class="saves">${SAVE_ROWS.map(([n, t, p]) => `
    <div class="save"><input type="checkbox" ${p ? 'checked' : ''} tabindex="-1">
      <span class="save__name">${n}</span><span class="save__total">${t}</span></div>`).join('')}</div>`,

  'conditions-chips': () => `<div class="chips">${CONDS.map((c, i) => `
    <label class="cond"><input type="checkbox" ${i === 9 ? 'checked' : ''} tabindex="-1">${c}</label>`).join('')}</div>`,

  'attacks-rows': () => `
    <div class="list__head"><button class="btn btn--small" tabindex="-1">Add</button></div>
    <ul class="rows">
      <li class="row row--attack"><input type="text" value="Mace" readonly tabindex="-1">
        <input type="text" value="+5" readonly tabindex="-1">
        <input type="text" value="1d6+2" readonly tabindex="-1"></li>
      <li class="row row--attack"><input type="text" value="Sacred Flame" readonly tabindex="-1">
        <input type="text" value="DC 14" readonly tabindex="-1">
        <input type="text" value="2d8" readonly tabindex="-1"></li>
    </ul>`,

  'hitdice-rows': () => `
    <div class="slot" style="grid-template-columns:1fr 3rem 3rem">
      <span class="slot__level">d8</span>
      <input type="number" value="3" readonly tabindex="-1">
      <input type="number" value="5" readonly tabindex="-1">
    </div>`,

  'deathsaves-pips': () => `<div class="status-grid">
      <div><span class="badge">Success</span>${pips(3, 1)}</div>
      <div><span class="badge">Failure</span>${pips(3, 0, 'pips--bad')}</div>
    </div>`,

  'exhaustion-pips': () => pips(6, 1),

  'abilities-grid': () => `<div class="abilities">${ABILITIES.map(([n, s, m]) => `
    <div class="ability"><span class="ability__name">${n}</span>
      <span class="ability__mod">${m}</span>
      <input class="ability__score" type="number" value="${s}" readonly tabindex="-1"></div>`).join('')}</div>`,

  'skills-list': () => {
    const row = ([n, a, t, p, e]) => `<div class="skill">
      <input type="checkbox" ${p ? 'checked' : ''} tabindex="-1">
      <input type="checkbox" ${e ? 'checked' : ''} tabindex="-1">
      <span class="skill__name">${n} (${a})</span><span class="skill__total">${t}</span></div>`;
    if (!get().metrics.groupSkills) return `<div class="skills">${SKILL_ROWS.map(row).join('')}</div>`;
    return ['STR', 'DEX', 'INT', 'WIS', 'CHA'].map((ab) => {
      const rows = SKILL_ROWS.filter((r) => r[1] === ab);
      if (!rows.length) return '';
      return `<div class="skillgroup"><h3 class="subhead">${ab}</h3>
        <div class="skills">${rows.map(row).join('')}</div></div>`;
    }).join('');
  },

  'spell-meta': () => fieldGrid('spell-meta', SPELL_VALS, 'row-3'),

  'slots-list': () => [[1, 4, 2], [2, 3, 1], [3, 2, 2]].map(([lv, tot, used]) => `
    <div class="slot"><span class="slot__level">Lv ${lv}</span>
      <input type="number" value="${tot}" readonly tabindex="-1">${pips(tot, used, 'pips--slot')}</div>`).join(''),

  'spells-rows': () => `<ul class="rows">
      <li class="row row--inv"><input type="text" value="Guiding Bolt" readonly tabindex="-1">
        <input type="text" value="1" readonly tabindex="-1"></li>
      <li class="row row--inv"><input type="text" value="Spiritual Weapon" readonly tabindex="-1">
        <input type="text" value="2" readonly tabindex="-1"></li>
      <li class="row row--inv"><input type="text" value="Revivify" readonly tabindex="-1">
        <input type="text" value="3" readonly tabindex="-1"></li>
    </ul>`,

  'inventory-rows': () => `
    <div class="list__head"><button class="btn btn--small" tabindex="-1">Add</button></div>
    <ul class="rows">
      <li class="row row--inv"><input type="text" value="Chain mail" readonly tabindex="-1">
        <input type="text" value="1" readonly tabindex="-1"></li>
      <li class="row row--inv"><input type="text" value="Healer's kit" readonly tabindex="-1">
        <input type="text" value="2" readonly tabindex="-1"></li>
      <li class="row row--inv"><input type="text" value="Rations" readonly tabindex="-1">
        <input type="text" value="7" readonly tabindex="-1"></li>
    </ul>`,

  'currency-fields': () => fieldGrid('currency-fields', CURRENCY_VALS),

  'features-rows': () => `<ul class="rows">
      <li class="row row--feat"><input type="text" value="Channel Divinity (2/rest)" readonly tabindex="-1">
        <textarea readonly tabindex="-1" rows="2">Turn Undead, or Radiance of the Dawn.</textarea></li>
      <li class="row row--feat"><input type="text" value="Warding Flare" readonly tabindex="-1">
        <textarea readonly tabindex="-1" rows="2">Impose disadvantage on an attack. 3 per long rest.</textarea></li>
    </ul>`,

  'identity-fields': () => fieldGrid('identity-fields', identityVals()),

  'notes-area': () => `<textarea readonly tabindex="-1" rows="5">The innkeeper at Sallow's Rest owes us a favour. Do not trust the reeve — he knew about the shipment before we did.</textarea>`,
};
