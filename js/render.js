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
import { getTabIds, exitArrange } from './layout-view.js';

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
  // Selecting a character rebuilds this list, which would drop focus off the button the
  // keyboard user just activated. Remember it and put focus back on its replacement.
  const focusedId = document.activeElement?.closest?.('.roster__btn')?.dataset.id ?? null;
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

  if (focusedId) {
    const btn = $(`.roster__btn[data-id="${focusedId}"]`);
    if (btn && !btn.closest('[inert]')) btn.focus();
  }
}

/** The roster caches; a delete or import must invalidate that cache. */
export function invalidateRoster() {
  rosterSignature = null;
}

/* ------------------------------------------------------- static sections */

/**
 * Per-card edit mode. A card in this set reveals its editing affordances — the ability
 * scores + per-skill checkboxes/misc-bonus inputs, the spell-slot totals, and its list
 * Add / remove (✕) controls — and unlocks its authored fields, all via the `.is-editing`
 * class on that card (each editable card carries `data-editcard` + a header Edit button).
 * Never stored on the character: it's a display preference, not sheet data.
 *
 * Persistent across a structural rebuild (unlike a keystroke) so that adding a row while
 * editing doesn't bounce you out; cleared only when a different character is opened (see
 * renderSheet). Modelled on activeTabKey, not a transient flag.
 */
let editCards = new Set();

/**
 * Reflect editCards into the DOM: the `.is-editing` class each reveal keys off, each card's
 * Edit button label + pressed state, and the per-field read-only lock. Idempotent — safe on
 * every render.
 */
function applyEditState() {
  for (const card of $$('[data-editcard]')) {
    const on = editCards.has(card.dataset.editcard);
    card.classList.toggle('is-editing', on);
    const btn = $('.card__edit', card);
    if (btn) {
      btn.textContent = on ? 'Done' : 'Edit';
      btn.setAttribute('aria-pressed', String(on));
    }

    // Lock authored fields in view mode; Edit unlocks them. Only the always-live play
    // controls stay editable everywhere — HP current/max/temp + the Damage/Heal amount,
    // heroic inspiration, the hit-dice "current" count, conditions, and currency — tagged
    // `data-live` in the markup. (Damage/Heal/Long-rest and the death-save/exhaustion/slot
    // pips are buttons, so they're live regardless.) Values are still written by
    // renderDerived; readOnly/disabled only block the user. Selects and checkboxes ignore
    // readOnly, so they take `disabled` instead.
    for (const field of $$('input, textarea, select', card)) {
      const locked = !on && !field.hasAttribute('data-live');
      if (field.tagName === 'SELECT' || field.type === 'checkbox' || field.type === 'radio') {
        field.disabled = locked;
      } else {
        field.readOnly = locked;
      }
    }
  }
}

/**
 * Flip one card between view and edit mode. The Spellcasting card rebuilds its slot rows
 * first (setup mode adds the empty levels + the total inputs) so the lock pass then sees
 * the fresh inputs; the other cards reveal purely via CSS, so a class toggle plus a derived
 * pass is enough.
 */
export function toggleCardEdit(char, cardId) {
  if (editCards.has(cardId)) editCards.delete(cardId);
  else editCards.add(cardId);
  if (cardId === 'spellcasting') renderSlots(char);
  applyEditState();
  renderDerived(char);
}

/**
 * Drop every open per-card content edit at once (used when entering layout-arrange mode, so
 * the two edit modes never overlap). Reverts the Spellcasting card out of slot-setup too.
 */
export function clearCardEdits(char) {
  if (editCards.size === 0) return;
  editCards.clear();
  if (char) renderSlots(char);
  applyEditState();
  if (char) renderDerived(char);
}

/**
 * One group per ability: score + modifier in the header row, then its saving
 * throw and its skills in a shared grid beneath (#14). Everything still writes
 * the same derived/toggle/bind keys, so rules.js and state.js never learn the
 * layout moved.
 */
function renderAbilities(char) {
  const host = $('#abilities');
  host.replaceChildren();

  for (const ability of ABILITIES) {
    const node = tpl('tpl-ability-group').cloneNode(true);
    const scoreId = `f-ability-${ability.key}`;

    $('.ability-row__name', node).textContent = ability.label;

    const score = $('.ability-row__score', node);
    score.id = scoreId;
    score.dataset.bind = `abilities.${ability.key}`;
    score.setAttribute('aria-label', `${ability.label} score`);

    // Read-only stand-in for the score input when the sheet is collapsed — same
    // reason the skill marker exists: hiding the input must not hide the value.
    $('.ability-row__score-display', node).dataset.derived = `score.${ability.key}`;

    const mod = $('.ability-row__mod', node);
    mod.dataset.derived = `mod.${ability.key}`;
    mod.setAttribute('for', scoreId);

    // The save row is part of the template; only its wiring is per-ability.
    const save = $('.skill--save', node);
    const saveBox = $('.skill__prof', save);
    saveBox.dataset.toggle = 'saveProficiencies';
    saveBox.dataset.value = ability.key;
    saveBox.setAttribute('aria-label', `${ability.label} saving throw proficiency`);
    $('.skill__total', save).dataset.derived = `save.${ability.key}`;
    $('.skill__marker', save).dataset.derived = `saveMark.${ability.key}`;

    // Skills nest under the ability that drives them (#14). Every derived/toggle
    // key is unchanged, so renderDerived and state.js never learn the layout moved.
    const list = $('.skills', node);
    for (const skill of SKILLS) {
      if (skill.ability !== ability.key) continue;
      const row = tpl('tpl-skill').cloneNode(true);

      // No "(STR)" suffix — the group header already names the ability.
      $('.skill__name', row).textContent = skill.label;

      const prof = $('.skill__prof', row);
      prof.dataset.toggle = 'skillProficiencies';
      prof.dataset.value = skill.key;
      prof.setAttribute('aria-label', `${skill.label} proficiency`);

      const exp = $('.skill__exp', row);
      exp.dataset.toggle = 'skillExpertise';
      exp.dataset.value = skill.key;
      exp.setAttribute('aria-label', `${skill.label} expertise`);

      // #57: per-skill misc bonus. A plain data-bind, not data-toggle/data-derived —
      // dataset.bind varies per skill, exactly like ability-row__score above varies
      // per ability, so it has to be set here rather than statically in the template.
      const bonus = $('.skill__bonus', row);
      bonus.dataset.bind = `skillBonuses.${skill.key}`;
      bonus.dataset.type = 'number';
      bonus.setAttribute('aria-label', `${skill.label} misc bonus`);

      $('.skill__total', row).dataset.derived = `skill.${skill.key}`;
      $('.skill__marker', row).dataset.derived = `skillMark.${skill.key}`;
      list.append(row);
    }

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

function renderPipRow(host, count, action, extra = {}, label = null) {
  host.replaceChildren();
  const capped = Math.min(Math.max(0, count), MAX_PIPS);
  for (let i = 0; i < capped; i += 1) {
    const pip = document.createElement('button');
    pip.type = 'button';
    pip.className = 'pip';
    pip.dataset.action = action;
    pip.dataset.index = String(i);
    Object.assign(pip.dataset, extra);
    // Without a name a screen reader hears only "button, pressed" for every pip. The
    // label gives each one its position ("Success 2 of 3"); the container is a labelled
    // role=group so the set reads as one control.
    if (label) pip.setAttribute('aria-label', label(i, capped));
    host.append(pip);
  }
}

function renderStatusPips() {
  renderPipRow($('#death-successes'), 3, 'death-save', { kind: 'successes' },
    (i, n) => `Death save success ${i + 1} of ${n}`);
  renderPipRow($('#death-failures'), 3, 'death-save', { kind: 'failures' },
    (i, n) => `Death save failure ${i + 1} of ${n}`);
  renderPipRow($('#exhaustion'), MAX_EXHAUSTION, 'exhaustion', {},
    (i, n) => `Exhaustion level ${i + 1} of ${n}`);
}

/** One slot row's pips, named and grouped. Shared by the full build and the targeted rebuild. */
function paintSlotPipRow(row, char) {
  const level = row.dataset.level;
  const host = $('.pips--slot', row);
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', `Level ${level} spell slots`);
  renderPipRow(host, char.spellcasting.slots[level].total, 'slot-pip', { level },
    (i, n) => `Level ${level} slot ${i + 1} of ${n}`);
}

function renderSlots(char) {
  const host = $('#slots');
  host.replaceChildren();

  // Setup mode = the Spellcasting card is in edit mode (editCards): it shows all nine
  // levels with their editable totals. Play mode hides levels with no slots (#9) — a
  // level-5 wizard shouldn't scroll past six dead rows — and shows a remaining/total count.
  const setup = editCards.has('spellcasting');
  const levels = setup
    ? SPELL_LEVELS
    : SPELL_LEVELS.filter((level) => char.spellcasting.slots[level].total > 0);

  for (const level of levels) {
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

    // The third grid column is the count in play mode, the total input in setup
    // mode. Both live in the template so the row shape never changes.
    $('.slot__total', node).hidden = !setup;
    $('.slot__count', node).hidden = setup;

    paintSlotPipRow(node, char);

    host.append(node);
  }

  // A brand-new caster has every total at 0, so the play-mode filter would show
  // nothing and the card would look broken (#9). Point at the Edit button.
  if (levels.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'rows__empty';
    empty.textContent = 'No spell slots yet — use Edit to set them up.';
    host.append(empty);
  }
}

/**
 * Rebuild just the slot pips, leaving the total inputs (and the caret in one of them)
 * untouched. Cheap enough to run on every keystroke in a total field.
 */
export function renderSlotPips(char) {
  for (const row of $$('#slots .slot')) paintSlotPipRow(row, char);
}

/* ------------------------------------------------------- repeatable rows */

const ROW_TEMPLATE_IDS = {
  attacks: 'tpl-attack',
  // spells is deliberately absent: the inert spell list was hidden in #9. The FIELD
  // stays in the model (constants/storage) so existing data keeps round-tripping
  // through save/export/import, and the UI can come back for free.
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
    empty.textContent = 'Nothing here yet — tap Edit to add.';
    host.append(empty);
  }
}

/* ---------------------------------------------------------------- tabs */

// The tab set is config-derived now (#54): getTabIds() reads it from the layout, so the
// old hardcoded TAB_KEYS literal is gone and tab CRUD later has one source of truth.
let activeTabKey = getTabIds()[0];
let renderedCharId = null;

/** Show one panel, hide the rest. Desktop CSS overrides the `hidden` to show all. */
export function activateTab(tabKey, { focus = false } = {}) {
  activeTabKey = tabKey;
  for (const key of getTabIds()) {
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
    activeTabKey = getTabIds()[0]; // opening a character lands on the first tab
  }
  activateTab(activeTabKey);
}

/* ------------------------------------------------------ focus across rebuilds */

/**
 * A structural render replaceChildren()s whole sections, so if focus was inside one it
 * drops to <body> — stranding a keyboard or screen-reader user at the top of the page
 * after removing a row or switching character. Capture enough to re-find the element,
 * put focus back after the rebuild. Uses the delegated data-attributes that survive it.
 */
function captureFocus() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  if (el.dataset?.action === 'remove-row') {
    return { by: 'remove', list: el.dataset.list, index: Number(el.dataset.index) };
  }
  if (el.id) return { by: 'id', id: el.id };
  if (el.dataset?.bind) return { by: 'bind', bind: el.dataset.bind };
  if (el.dataset?.toggle) return { by: 'toggle', toggle: el.dataset.toggle, value: el.dataset.value };
  // Roster buttons live outside the sheet and are rebuilt by renderRoster, which restores
  // their focus itself — nothing to capture here.
  return null;
}

function restoreFocus(token) {
  if (!token) return;
  let next = null;
  switch (token.by) {
    case 'id': next = document.getElementById(token.id); break;
    case 'bind': next = $(`[data-bind="${token.bind}"]`); break;
    case 'toggle': next = $(`[data-toggle="${token.toggle}"][data-value="${token.value}"]`); break;
    case 'remove': {
      // The removed row is gone; fall to the one that slid into its place (or the last),
      // and to that list's "+ Add" button when the list is now empty.
      const host = document.getElementById(token.list);
      const buttons = host ? $$('.row__remove', host) : [];
      next = buttons[Math.min(token.index, buttons.length - 1)]
        || (host && $(`[data-action="add-row"][data-list="${token.list}"]`));
      break;
    }
    default: break;
  }
  // Never yank focus into a background that a modal/drawer has made inert.
  if (next && typeof next.focus === 'function' && !next.closest('[inert]')) next.focus();
}

/* ---------------------------------------------------------- full rebuild */

export function renderSheet(char) {
  const sheet = $('#sheet');
  const tabbar = $('#tabbar');
  const empty = $('#empty');
  const arrangeBtn = $('#btn-arrange');

  sheet.hidden = !char;
  tabbar.hidden = !char;
  empty.hidden = Boolean(char);
  if (arrangeBtn) arrangeBtn.hidden = !char; // the layout gear only makes sense with a sheet up
  if (!char) {
    $('#topbar-name').textContent = '—';
    $('#topbar-sub').textContent = '';
    // renderDerived never runs without a character, so clear this here or it
    // survives the deletion of the last (bloodied) character.
    document.body.classList.remove('is-bloodied');
    editCards.clear();
    return;
  }

  const focusToken = captureFocus();

  // Edit mode is a display preference, not sheet data: opening a DIFFERENT character
  // starts in view mode. Within the same character it persists across structural
  // rebuilds (so adding a row mid-edit doesn't bounce you out) — cleared here on the
  // id change, mirroring how syncActiveTab resets the active tab below.
  if (char.id !== renderedCharId) { editCards.clear(); exitArrange(); }
  renderAbilities(char);
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
  applyEditState();
  renderDerived(char);
  restoreFocus(focusToken);
}

/* ------------------------------------------------------ derived readouts */

function derivedValue(char, key) {
  // Multi-segment safe: `raw.hp.temp` → kind 'raw', arg 'hp.temp'. Single-segment keys
  // (mod.str, save.dex …) are unaffected — rest is just the one segment.
  const [kind, ...rest] = key.split('.');
  const arg = rest.join('.');
  switch (kind) {
    case 'mod': return rules.formatMod(rules.modFor(char, arg));
    case 'score': return String(char.abilities[arg]);
    case 'save': return rules.formatMod(rules.saveTotal(char, arg));
    case 'skill': return rules.formatMod(rules.skillTotal(char, arg));
    case 'saveMark': return rules.saveMarker(char, arg);
    case 'skillMark': return rules.skillMarker(char, arg);
    case 'pb': return rules.formatMod(rules.characterPB(char));
    case 'passive': return String(rules.passivePerception(char));
    case 'initiative': return rules.formatMod(rules.initiative(char));
    // The closed conditions disclosure still tells you what you're suffering — and
    // print shows exactly this line (full and wrapped; the chip grid is print-hidden
    // so the output doesn't depend on whether the disclosure was left open).
    case 'conditionsList': return char.conditions.length ? char.conditions.join(', ') : '—';
    case 'spellDC': {
      const dc = rules.spellSaveDC(char);
      return dc === null ? '—' : String(dc);
    }
    case 'spellAtk': {
      const atk = rules.spellAttackBonus(char);
      return atk === null ? '—' : rules.formatMod(atk);
    }
    // A tile's view-mode readout of a plain STORED value (AC, Speed…): no rules.js
    // function, just echo the bound value so the field reads as text until Edit.
    case 'raw': {
      const v = getByPath(char, arg);
      return v === null || v === undefined || v === '' ? '—' : String(v);
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
    const slot = char.spellcasting.slots[level];
    // Inverted since #9: a filled pip is an AVAILABLE slot, draining like a battery.
    // Slots are a resource running out — unlike death saves and exhaustion, which
    // count a bad thing accumulating and stay fill-as-you-mark.
    paintPips($('.pips--slot', row), slot.total - slot.used);
    $('.slot__count', row).textContent = `${slot.total - slot.used}/${slot.total}`;
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

/*
 * The #banner is one live region shared by two kinds of message that used to erase each
 * other (#33): a successful import cleared a pending update prompt, and an update prompt
 * overwrote a data-integrity warning — leaving the recovery buttons gone while state.js
 * was still refusing to save, i.e. the user stranded.
 *
 *   DURABLE  warnings  — recovery, storage read-only/unavailable, a failed import, a
 *            startup error. They reflect a condition that is still true, so they stay
 *            until the flow that raised them clears its OWN message (clearBanner). A
 *            transient notice never wipes one; a plain warning never replaces the critical
 *            recovery prompt.
 *   TRANSIENT notices  — "a new version is ready", "nothing to export". Informational;
 *            shown only when no durable warning is up, so they can never hide a warning
 *            and surface the moment a durable one is dismissed.
 *
 * Durable outranks transient. One element = one live region, so the aria-live/atomic
 * semantics added in #44 are unchanged. `painted` skips re-announcing an unchanged banner
 * when only the hidden slot moved (aria-atomic re-reads on any subtree write).
 */
let durable = null; // { key, critical, message, actions } | null
let transient = null; // { info, sticky, message, actions } | null
let painted = null; // the slot object currently in the DOM (identity guard)

function bannerButtons(actions) {
  return actions.map(({ action, label, danger }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = danger ? 'btn btn--small btn--danger' : 'btn btn--small';
    btn.dataset.action = action;
    btn.textContent = label;
    return btn;
  });
}

function paintBanner() {
  // A one-shot notice must not outlive the warning that hid it: once a durable warning is
  // up, drop a non-sticky transient so it can't resurface (falsely) when the warning
  // clears. The update prompt is sticky — it's still true until reload — so it survives to
  // resurface. (Without this, dismissing a warning re-showed a stale "nothing to export".)
  if (durable && transient && !transient.sticky) transient = null;

  const next = durable || transient; // durable wins
  if (next === painted) return; // visible content unchanged — don't re-announce
  painted = next;

  const el = $('#banner');
  el.classList.toggle('banner--info', Boolean(next && next.info));
  el.hidden = !next;
  // One mutation, so the live region reads the sentence and its buttons as a single
  // utterance rather than the sentence and then an orphaned button.
  el.replaceChildren(...(next ? [next.message, ...bannerButtons(next.actions)] : []));
}

/* durable warnings ------------------------------------------------------- */

/**
 * Raise a durable warning (storage read-only, a failed import, a startup error). `key`
 * tags the owner so that same flow can later clear exactly its own message; a falsy
 * message clears this owner's warning. The critical recovery prompt is never replaced by
 * a plain warning — it must be resolved through its own buttons.
 *
 * One durable slot: a later warning of a different key replaces the earlier one. The only
 * overlap in practice is a session-long 'warning' (not-writable/startup) plus a failed
 * 'import', and a lost not-writable warning is still echoed by the persistent #saved
 * "Could not save…" status — so a keyed stack isn't worth the weight here.
 */
export function showBanner(message, key = 'warning') {
  if (!message) { clearBanner(key); return; }
  if (durable && durable.critical) return;
  durable = { key, critical: false, message, actions: [] };
  paintBanner();
}

/** Clear the durable warning, but only if this flow owns it (matched by key). */
export function clearBanner(key) {
  if (durable && durable.key === key) {
    durable = null;
    paintBanner();
  }
}

/**
 * Saved data could not be read. Offer to download the raw bytes before discarding them —
 * until the user chooses "Start fresh", state.js refuses to save over the original.
 * Critical: outranks everything and is cleared only by the start-fresh flow.
 */
export function showRecovery() {
  durable = {
    key: 'recovery',
    critical: true,
    message:
      'Your saved characters could not be read, so they have NOT been changed. '
      + 'Download a copy, then start fresh.',
    actions: [
      { action: 'download-corrupt', label: 'Download unreadable data' },
      { action: 'start-fresh', label: 'Start fresh', danger: true },
    ],
  };
  paintBanner();
}

/* transient notices ------------------------------------------------------ */

/**
 * A low-stakes, one-shot notice (e.g. "nothing to export"). Non-sticky: it never
 * resurfaces once a warning has hidden it, and it refuses to overwrite a pending update
 * prompt (a sticky transient), so a trivial notice can't discard the reload offer.
 */
export function showNotice(message) {
  if (transient && transient.sticky) return;
  transient = { info: false, sticky: false, message, actions: [] };
  paintBanner();
}

/**
 * Offer a reload once the service worker has installed a new build. A prompt, not an
 * auto-reload: this app is read at the table mid-session, and yanking the page out from
 * under someone applying a cosmetic change is worse than showing a slightly old sheet.
 * Transient but sticky: it waits behind a data-integrity warning and resurfaces once that
 * warning is dismissed (the new build is still there), and a one-shot notice can't discard
 * it — but it can never wipe a warning (was #33).
 */
export function showUpdatePrompt() {
  transient = {
    info: true,
    sticky: true,
    message: 'A new version is ready.',
    actions: [{ action: 'reload-app', label: 'Reload' }],
  };
  paintBanner();
}

/**
 * A dismissible data-durability nudge (#32): informational, actioned, and polite —
 * it only takes an EMPTY slot, so it can never displace the update prompt or a
 * pending notice, and a durable warning always outranks it. Non-sticky: hidden
 * once behind a warning, it simply returns on a later visit. `kind` ('backup' |
 * 'install') tags the banner so clearNudge can dismiss exactly its own.
 */
export function showNudge(kind, message, actions) {
  if (durable || transient) return;
  transient = { info: true, sticky: false, kind, message, actions };
  paintBanner();
}

/**
 * Dismiss a nudge — but ONLY if the painted transient is that nudge. An
 * unconditional clear here would wipe whatever else holds the slot (the sticky
 * update prompt, a notice), which is exactly the #33 class of bug.
 */
export function clearNudge(kind) {
  if (transient && transient.kind === kind) {
    transient = null;
    paintBanner();
  }
}
