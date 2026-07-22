/**
 * Turning a character into DOM.
 *
 * Split into three functions with deliberately different trigger rates:
 *
 *   renderRoster()  — the character list, when the list itself changes
 *   renderSheet()   — the whole sheet, only on STRUCTURAL change (open a character,
 *                     add/remove a row, import). Writes every input's value once.
 *   renderDerived() — computed readouts and pip states, on EVERY change.
 *
 * Why the split: rebuilding the sheet on every keystroke would reassign .value on the
 * field being typed into and throw the caret to the end of the line. So after the
 * initial write, text fields flow one way only — DOM to state, never back.
 */

import {
  ABILITIES, SKILLS, CONDITIONS, SPELL_LEVELS, MAX_EXHAUSTION,
} from './constants.js';
import * as rules from './rules.js';
import { getByPath, getListPath } from './state.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const tpl = (id) => $(`#${id}`).content.firstElementChild;

/* --------------------------------------------------------------- roster */

let rosterSignature = null;

/** A cheap fingerprint, so typing a name doesn't rebuild the list 40 times. */
function signatureOf(characters, activeId) {
  return JSON.stringify(
    characters.map((c) => [c.id, c.name, c.class, c.level]).concat([['active', activeId]]),
  );
}

export function renderRoster(characters, activeId) {
  const signature = signatureOf(characters, activeId);
  if (signature === rosterSignature) return;
  rosterSignature = signature;

  const list = $('#roster');
  list.replaceChildren();

  for (const char of characters) {
    const item = tpl('tpl-roster').cloneNode(true);
    const button = $('.roster__btn', item);
    button.dataset.id = char.id;
    button.setAttribute('aria-current', char.id === activeId ? 'true' : 'false');
    $('.roster__name', item).textContent = char.name || 'Unnamed';
    $('.roster__meta', item).textContent =
      [char.class, char.level ? `Level ${char.level}` : ''].filter(Boolean).join(' · ') || '—';
    list.append(item);
  }
}

/** The roster caches; a delete or import must invalidate that cache. */
export function invalidateRoster() {
  rosterSignature = null;
}

/* ------------------------------------------------------- static sections */

/**
 * Abilities and saves used to share one cell. They now live on different tabs
 * (scores on Abilities, saves on Combat), so they are two independent renders —
 * but both still write the same derived/toggle/bind keys, so rules.js and state.js
 * never learn the layout moved.
 */
function renderAbilities(char) {
  const host = $('#abilities');
  host.replaceChildren();

  for (const ability of ABILITIES) {
    const node = tpl('tpl-ability-score').cloneNode(true);
    const scoreId = `f-ability-${ability.key}`;

    $('.ability__name', node).textContent = ability.short;

    const score = $('.ability__score', node);
    score.id = scoreId;
    score.dataset.bind = `abilities.${ability.key}`;
    score.setAttribute('aria-label', `${ability.label} score`);

    const mod = $('.ability__mod', node);
    mod.dataset.derived = `mod.${ability.key}`;
    mod.setAttribute('for', scoreId);

    host.append(node);
  }
}

function renderSaves(char) {
  const host = $('#saves');
  host.replaceChildren();

  for (const ability of ABILITIES) {
    const node = tpl('tpl-save').cloneNode(true);

    $('.save__name', node).textContent = ability.label;

    const box = $('.save__prof', node);
    box.id = `f-save-${ability.key}`;
    box.dataset.toggle = 'saveProficiencies';
    box.dataset.value = ability.key;
    box.setAttribute('aria-label', `${ability.label} saving throw proficiency`);

    $('.save__total', node).dataset.derived = `save.${ability.key}`;

    host.append(node);
  }
}

function renderSkills(char) {
  const host = $('#skills');
  host.replaceChildren();

  for (const skill of SKILLS) {
    const node = tpl('tpl-skill').cloneNode(true);
    const ability = ABILITIES.find((a) => a.key === skill.ability);

    $('.skill__name', node).textContent = `${skill.label} (${ability.short})`;

    const prof = $('.skill__prof', node);
    prof.dataset.toggle = 'skillProficiencies';
    prof.dataset.value = skill.key;
    prof.setAttribute('aria-label', `${skill.label} proficiency`);

    const exp = $('.skill__exp', node);
    exp.dataset.toggle = 'skillExpertise';
    exp.dataset.value = skill.key;
    exp.setAttribute('aria-label', `${skill.label} expertise`);

    $('.skill__total', node).dataset.derived = `skill.${skill.key}`;
    host.append(node);
  }
}

function renderConditions() {
  const host = $('#conditions');
  host.replaceChildren();

  for (const condition of CONDITIONS) {
    const node = tpl('tpl-chip').cloneNode(true);
    const box = $('.chip__box', node);
    box.dataset.toggle = 'conditions';
    box.dataset.value = condition;
    $('.chip__text', node).textContent = condition;
    host.append(node);
  }
}

/** Pips are one DOM node each, so a fat-fingered "999" must not build 999 buttons. */
const MAX_PIPS = 20;

function renderPipRow(host, count, action, extra = {}) {
  host.replaceChildren();
  const capped = Math.min(Math.max(0, count), MAX_PIPS);
  for (let i = 0; i < capped; i += 1) {
    const pip = document.createElement('button');
    pip.type = 'button';
    pip.className = 'pip';
    pip.dataset.action = action;
    pip.dataset.index = String(i);
    Object.assign(pip.dataset, extra);
    host.append(pip);
  }
}

function renderStatusPips() {
  renderPipRow($('#death-successes'), 3, 'death-save', { kind: 'successes' });
  renderPipRow($('#death-failures'), 3, 'death-save', { kind: 'failures' });
  renderPipRow($('#exhaustion'), MAX_EXHAUSTION, 'exhaustion');
}

function renderSlots(char) {
  const host = $('#slots');
  host.replaceChildren();

  for (const level of SPELL_LEVELS) {
    const node = tpl('tpl-slot-row').cloneNode(true);
    node.dataset.level = String(level);
    $('.slot__level', node).textContent = `Lv ${level}`;

    const total = $('.slot__total-input', node);
    total.id = `f-slot-total-${level}`;
    total.dataset.bind = `spellcasting.slots.${level}.total`;
    // Changing the total changes how many pips exist, but rebuilding the whole sheet
    // would destroy this very input mid-keystroke. data-slots asks for a targeted
    // pip rebuild instead — see renderSlotPips.
    total.dataset.slots = 'true';
    total.setAttribute('aria-label', `Level ${level} total spell slots`);
    $('.slot__total', node).setAttribute('for', total.id);

    renderPipRow($('.pips--slot', node), char.spellcasting.slots[level].total, 'slot-pip', {
      level: String(level),
    });

    host.append(node);
  }
}

/**
 * Rebuild just the slot pips, leaving the total inputs (and the caret in one of them)
 * untouched. Cheap enough to run on every keystroke in a total field.
 */
export function renderSlotPips(char) {
  for (const row of $$('#slots .slot')) {
    const level = row.dataset.level;
    renderPipRow($('.pips--slot', row), char.spellcasting.slots[level].total, 'slot-pip', {
      level,
    });
  }
}

/* ------------------------------------------------------- repeatable rows */

const ROW_TEMPLATE_IDS = {
  attacks: 'tpl-attack',
  spells: 'tpl-spell',
  features: 'tpl-feature',
  inventory: 'tpl-inventory',
  hitDice: 'tpl-hitdie',
};

function renderRows(char, listName) {
  const host = $(`#${listName}`);
  const basePath = getListPath(listName);
  const items = getByPath(char, basePath);

  host.replaceChildren();

  for (let index = 0; index < items.length; index += 1) {
    const node = tpl(ROW_TEMPLATE_IDS[listName]).cloneNode(true);

    // Bake the array index into the binding path — the same dot-path helper that
    // handles "hp.current" then handles "attacks.2.damage" with no special case.
    for (const field of $$('[data-bind-suffix]', node)) {
      field.dataset.bind = `${basePath}.${index}.${field.dataset.bindSuffix}`;
      delete field.dataset.bindSuffix;
    }
    const remove = $('.row__remove', node);
    if (remove) remove.dataset.index = String(index);

    host.append(node);
  }

  if (items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'rows__empty';
    empty.textContent = 'Nothing here yet.';
    host.append(empty);
  }
}

/* ---------------------------------------------------------------- tabs */

const TAB_KEYS = ['combat', 'abilities', 'spells', 'gear', 'character'];
let activeTabKey = 'combat';
let renderedCharId = null;

/** Show one panel, hide the rest. Desktop CSS overrides the `hidden` to show all. */
export function activateTab(tabKey, { focus = false } = {}) {
  activeTabKey = tabKey;
  for (const key of TAB_KEYS) {
    const tab = $(`#tab-${key}`);
    const panel = $(`#panel-${key}`);
    if (!tab || !panel) continue;
    const on = key === tabKey;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
    if (on && focus) tab.focus();
  }
}

/**
 * Opening a different character drops you on the first tab; a structural re-render
 * of the SAME character (adding a row, say) keeps you where you were, so editing a
 * spell doesn't bounce you off the Spells tab. The last tab is not persisted.
 */
function syncActiveTab(char) {
  if (char.id !== renderedCharId) {
    renderedCharId = char.id;
    activeTabKey = 'combat';
  }
  activateTab(activeTabKey);
}

/* ---------------------------------------------------------- full rebuild */

export function renderSheet(char) {
  const sheet = $('#sheet');
  const tabbar = $('#tabbar');
  const empty = $('#empty');

  sheet.hidden = !char;
  tabbar.hidden = !char;
  empty.hidden = Boolean(char);
  if (!char) {
    $('#topbar-name').textContent = '—';
    $('#topbar-sub').textContent = '';
    // renderDerived never runs without a character, so clear this here or it
    // survives the deletion of the last (bloodied) character.
    document.body.classList.remove('is-bloodied');
    return;
  }

  renderAbilities(char);
  renderSaves(char);
  renderSkills(char);
  renderConditions();
  renderStatusPips();
  renderSlots(char);
  for (const listName of Object.keys(ROW_TEMPLATE_IDS)) renderRows(char, listName);

  // Write every bound field exactly once. From here on, these flow DOM -> state only.
  for (const el of $$('[data-bind]')) {
    const value = getByPath(char, el.dataset.bind);
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value === null || value === undefined ? '' : value;
  }

  syncActiveTab(char);
  renderDerived(char);
}

/* ------------------------------------------------------ derived readouts */

function derivedValue(char, key) {
  const [kind, arg] = key.split('.');
  switch (kind) {
    case 'mod': return rules.formatMod(rules.modFor(char, arg));
    case 'save': return rules.formatMod(rules.saveTotal(char, arg));
    case 'skill': return rules.formatMod(rules.skillTotal(char, arg));
    case 'pb': return rules.formatMod(rules.characterPB(char));
    case 'passive': return String(rules.passivePerception(char));
    case 'initiative': return rules.formatMod(rules.initiative(char));
    case 'exhaustion': return String(char.exhaustion);
    case 'spellDC': {
      const dc = rules.spellSaveDC(char);
      return dc === null ? '—' : String(dc);
    }
    case 'spellAtk': {
      const atk = rules.spellAttackBonus(char);
      return atk === null ? '—' : rules.formatMod(atk);
    }
    default: return '';
  }
}

/**
 * Runs on every change. Touches computed readouts, toggle states and pips —
 * but writes an input's .value only when the user is not inside it.
 */
export function renderDerived(char) {
  if (!char) return;

  for (const el of $$('[data-derived]')) {
    el.textContent = derivedValue(char, el.dataset.derived);
  }

  for (const el of $$('[data-toggle]')) {
    el.checked = getByPath(char, el.dataset.toggle).includes(el.dataset.value);
  }

  // HP quick buttons change state, so these two inputs DO need writing back —
  // but never while the user has the caret in them.
  for (const el of $$('[data-bind]')) {
    if (el === document.activeElement) continue;
    const value = getByPath(char, el.dataset.bind);
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else {
      const next = value === null || value === undefined ? '' : String(value);
      if (el.value !== next) el.value = next;
    }
  }

  paintPips($('#death-successes'), char.deathSaves.successes);
  paintPips($('#death-failures'), char.deathSaves.failures);
  paintPips($('#exhaustion'), char.exhaustion);

  for (const row of $$('#slots .slot')) {
    const level = row.dataset.level;
    paintPips($('.pips--slot', row), char.spellcasting.slots[level].used);
  }

  // The Spells tab is always reachable: it holds the "Spellcasting ability" select,
  // which is the ONLY way to become a caster. Hiding the tab for non-casters made that
  // control unreachable on mobile (#20). Instead, keep the tab and hide only the slots
  // and spell list (#spell-body) until an ability is chosen.
  const caster = rules.isSpellcaster(char);
  $('#spell-body').hidden = !caster;
  $('#card-spellcasting').classList.toggle('card--muted', !caster);

  $('#topbar-name').textContent = char.name || 'Unnamed';
  $('#topbar-sub').textContent =
    [char.class, char.subclass, char.level ? `Level ${char.level}` : ''].filter(Boolean).join(' · ');

  document.body.classList.toggle('is-bloodied', isBloodied(char));
}

function isBloodied(char) {
  return char.hp.max > 0 && char.hp.current > 0 && char.hp.current <= char.hp.max / 2;
}

function paintPips(host, filled) {
  if (!host) return;
  const pips = $$('.pip', host);
  pips.forEach((pip, i) => {
    const on = i < filled;
    pip.classList.toggle('is-on', on);
    pip.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/* -------------------------------------------------------------- chrome */

export function setSaved(message, tone) {
  const el = $('#saved');
  el.textContent = message;
  el.dataset.tone = tone;
}

export function showBanner(message) {
  const el = $('#banner');
  el.hidden = !message;
  el.classList.remove('banner--info');
  el.textContent = message || '';
}

/**
 * Saved data could not be read. Offer to download the raw bytes before discarding them —
 * until the user chooses "Start fresh", state.js refuses to save over the original.
 */
export function showRecovery() {
  const el = $('#banner');
  el.hidden = false;
  el.classList.remove('banner--info');
  el.textContent = 'Your saved characters could not be read, so they have NOT been changed. '
    + 'Download a copy, then start fresh.';

  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--small';
  download.dataset.action = 'download-corrupt';
  download.textContent = 'Download unreadable data';

  const fresh = document.createElement('button');
  fresh.type = 'button';
  fresh.className = 'btn btn--small btn--danger';
  fresh.dataset.action = 'start-fresh';
  fresh.textContent = 'Start fresh';

  el.append(download, fresh);
}

/**
 * Offer a reload once a new build has been installed by the service worker.
 *
 * Deliberately a prompt rather than an automatic reload: this app is read at a table
 * mid-session, and yanking the page out from under someone who is typing into Notes to
 * apply a cosmetic change is a worse failure than showing a slightly old sheet.
 */
export function showUpdatePrompt() {
  const el = $('#banner');
  el.hidden = false;
  el.classList.add('banner--info');
  el.textContent = 'A new version is ready.';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--small';
  button.dataset.action = 'reload-app';
  button.textContent = 'Reload';
  el.append(button);
}
