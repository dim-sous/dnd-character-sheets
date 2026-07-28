/**
 * The spell picker (#149): search the SRD library and add a spell to the sheet.
 *
 * The DOM half of the library, the way layout-view.js is the DOM half of layout.js — every
 * decision it makes (what matches, how results rank, what a library entry becomes as a row)
 * lives in the pure spell-library.js and is under test. This file owns a <dialog>, its filter
 * state, and nothing else.
 *
 * It does not import state.js. The caller passes `onAdd`, so the one thing this can do to a
 * character is hand back a row for the sheet to append — the same separation that keeps
 * layout-view out of the character model.
 *
 * WHY A DIALOG, AND WHY IT STAYS OPEN. A player stocking a spellbook adds six spells at a
 * time. A picker that closed on each pick would make that six round trips through a card, a
 * section and a button, so `onAdd` is a callback rather than a resolved promise and the list
 * marks what it has already added. Escape and the backdrop close it, which is `showModal`'s
 * own behaviour and not worth re-implementing.
 */

import {
  searchSpells, spellToRow, spellSummary, SPELL_CLASSES, SPELL_SCHOOLS,
} from './spell-library.js';
import { SPELL_LIST_LEVELS, spellLevelLabel } from './constants.js';

const $ = (sel, root = document) => root.querySelector(sel);

/**
 * The 330KB data file, loaded on FIRST OPEN and never at boot.
 *
 * A static import would put the whole SRD in the critical path of an app whose entire point is
 * opening instantly to a character sheet, for a feature most sessions never touch. The service
 * worker still precaches it (it is a .js under the app root), so the second open — and every
 * open at a table with no signal — is instant and offline.
 *
 * The promise is cached, not the module: two taps before the first load resolves must not start
 * two downloads.
 */
let libraryPromise = null;
function loadLibrary() {
  libraryPromise ??= import('./spell-data.js');
  return libraryPromise;
}

/** How many results are built as DOM at once. */
const PAGE = 60;

const filters = {
  text: '',
  levels: new Set(),
  classes: new Set(),
  schools: new Set(),
};

let spells = [];            // the loaded library, or [] until it arrives
let onAdd = null;           // caller's "append this row" callback
let addedNames = new Set(); // lower-cased names already on the character, plus this session's
let openedFromLevel = null; // the section that opened us, so focus can go home on close
let shown = PAGE;           // results currently rendered (the "Show more" count)

const els = {};
function cache() {
  if (els.dialog) return els;
  els.dialog = $('#spell-picker');
  els.search = $('#spell-search');
  els.results = $('#spell-results');
  els.status = $('#spell-picker-status');
  els.count = $('#spell-picker-count');
  els.more = $('#spell-picker-more');
  els.custom = $('#spell-picker-custom');
  els.attrib = $('#spell-picker-attrib');
  els.filters = {
    levels: $('#spell-filter-levels'),
    classes: $('#spell-filter-classes'),
    schools: $('#spell-filter-schools'),
  };
  /*
   * Send focus home when the picker goes away (#100's lesson, one dialog along).
   *
   * `showModal` restores focus to whatever opened it — but adding a spell rebuilds the section
   * that button lives in, so by closing time the invoker is a DETACHED node, restoration finds
   * nothing, and focus lands on <body>: the next Tab restarts at the top of the document. So the
   * button is re-found by level instead.
   *
   * Called from two places rather than one, and that is deliberate. `closeSpellPicker` covers
   * the app's own Close/Done buttons directly, so that path does not depend on observing an
   * event at all; the `close` listener covers the ways the BROWSER shuts a dialog — Escape and
   * the backdrop — which never reach our code otherwise. Leaning on the event alone was measured
   * flaky across probe runs, and "focus is usually restored" is the kind of bug a keyboard user
   * hits and cannot describe.
   */
  els.dialog?.addEventListener('close', focusHome);
  return els;
}

/**
 * Put focus back on the section button that opened the picker.
 *
 * Deferred by a task: the browser runs its own focus restoration as part of closing, and a
 * synchronous focus here is simply overwritten. The guard makes a second call free, so the two
 * callers can both fire without fighting. setTimeout rather than rAF, which is not reliably
 * driven under the probes' virtual time (CLAUDE.md).
 */
function focusHome() {
  setTimeout(() => {
    const target = document.querySelector(`.spelllevel[data-level="${openedFromLevel}"] .spelllevel__add`)
      || document.querySelector('#spells .spelllevel__add');
    if (target && document.activeElement !== target) target.focus();
  }, 0);
}

/** A filter chip: a checkbox in a label, the same control the Conditions tile uses. */
function chip(group, value, label, checked) {
  const node = $('#tpl-chip').content.firstElementChild.cloneNode(true);
  node.classList.add('chip--filter');
  const box = $('.chip__box', node);
  box.checked = checked;
  box.dataset.spellFilter = group;
  box.dataset.value = String(value);
  box.removeAttribute('data-live');   // not character data; nothing here is bound or saved
  $('.chip__text', node).textContent = label;
  return node;
}

function renderFilters() {
  const { filters: hosts } = cache();
  hosts.levels.replaceChildren(...SPELL_LIST_LEVELS.map((level) => chip(
    'levels', level, level === 0 ? 'Cantrip' : String(level), filters.levels.has(level),
  )));
  hosts.classes.replaceChildren(...SPELL_CLASSES.map((name) => chip(
    'classes', name, name, filters.classes.has(name),
  )));
  hosts.schools.replaceChildren(...SPELL_SCHOOLS.map((name) => chip(
    'schools', name, name, filters.schools.has(name),
  )));
}

function query() {
  return searchSpells(spells, {
    text: filters.text,
    levels: [...filters.levels],
    classes: [...filters.classes],
    schools: [...filters.schools],
  });
}

function resultNode(spell) {
  const node = $('#tpl-spell-result').content.firstElementChild.cloneNode(true);
  const already = addedNames.has(spell.name.toLowerCase());

  $('.result__name', node).textContent = spell.name;
  $('.result__meta', node).textContent = spellSummary(spell);
  /*
   * The four header fields, then the description — the same order the row's detail block shows
   * them in, so what you read here is what you get. Set as textContent on a <p>: the library is
   * generated data rather than player input, but this app has no HTML sink anywhere and is not
   * about to grow its first one for a convenience.
   */
  $('.result__stats', node).textContent =
    [spell.castingTime, spell.range, spell.components, spell.duration].filter(Boolean).join(' · ');
  $('.result__text', node).textContent = spell.text;

  const add = $('.result__add', node);
  add.dataset.spellName = spell.name;
  if (already) markAdded(add);
  return node;
}

function markAdded(button) {
  button.textContent = 'Added';
  button.disabled = true;
  button.classList.add('result__add--done');
}

function renderResults() {
  const { results, count, more, custom } = cache();
  const found = query();

  results.replaceChildren(...found.slice(0, shown).map(resultNode));

  const total = found.length;
  count.textContent = spells.length === 0
    ? ''
    : `${total} spell${total === 1 ? '' : 's'}${total > shown ? `, showing ${shown}` : ''}`;
  more.hidden = total <= shown;

  /*
   * The escape hatch, and it is not decoration: every field in this app is free-form, and the
   * library is a typing shortcut rather than a source of truth. Homebrew, a spell from a book
   * that is not in the SRD, or a spell whose name you cannot quite remember all end here. It is
   * also what the "+ Add" button this search replaced used to do, so nothing was taken away.
   */
  const typed = filters.text.trim();
  custom.textContent = typed ? `Add “${typed}” as a custom spell` : 'Add a blank spell';
  results.hidden = false;

  if (total === 0 && spells.length) {
    const empty = document.createElement('li');
    empty.className = 'rows__empty';
    empty.textContent = filters.text
      ? 'No SRD spell matches that. You can still add it as your own.'
      : 'No spell matches these filters.';
    results.append(empty);
  }
}

function announce(message) {
  cache().status.textContent = message;
}

/** The level a "blank spell" or an unmatched search should land at. */
function targetLevel() {
  if (filters.levels.size === 1) return [...filters.levels][0];
  return openedFromLevel ?? 0;
}

function add(row, what) {
  onAdd?.(row);
  addedNames.add(row.name.toLowerCase());
  announce(`${what} added to ${spellLevelLabel(row.level)}.`);
}

/* ------------------------------------------------------------------ the public surface */

/**
 * Open the picker.
 *
 * `level` pre-filters to the section that opened it — the common case is "I am filling in my
 * 3rd-level spells" — but it is a FILTER, not a destination: pick a cantrip from here and the
 * row lands in the cantrip section, because a spell's level belongs to the spell.
 */
export async function openSpellPicker({ level = null, existing = [], onAdd: handler } = {}) {
  const el = cache();
  if (!el.dialog) return;

  onAdd = handler;
  openedFromLevel = level;
  addedNames = new Set(existing.map((name) => String(name).toLowerCase()).filter(Boolean));
  filters.text = '';
  filters.levels = new Set(level === null ? [] : [level]);
  filters.classes = new Set();
  filters.schools = new Set();
  shown = PAGE;

  el.search.value = '';
  renderFilters();
  el.results.replaceChildren();
  el.count.textContent = '';
  el.more.hidden = true;
  announce('');
  el.dialog.showModal();
  el.search.focus();

  if (spells.length === 0) {
    announce('Loading the spell library…');
    try {
      const data = await loadLibrary();
      spells = data.SRD_SPELLS;
      el.attrib.textContent = data.SRD_ATTRIBUTION;
      announce('');
    } catch {
      /*
       * Offline on a first-ever open, or the file failed to fetch. Say so and leave the custom
       * path working: "you cannot search, but you can still write the spell down" is the honest
       * offer, and it is what this card did before there was a library at all.
       */
      announce('The spell library could not be loaded. You can still add a spell by name.');
      return;
    }
  }
  renderResults();
}

export function closeSpellPicker() {
  const el = cache();
  el.dialog?.close();
  focusHome();
}

/**
 * Everything the dialog's controls do, dispatched from main.js's one click listener so the
 * picker keeps the app's no-per-element-handler rule.
 */
export const SPELL_PICKER_ACTIONS = {
  'spell-picker-close': () => closeSpellPicker(),

  'spell-pick': (button) => {
    const spell = spells.find((s) => s.name === button.dataset.spellName);
    if (!spell) return;
    add(spellToRow(spell), spell.name);
    markAdded(button);
  },

  // The blank/custom row. Uses whatever is typed as the name, so a search that found nothing is
  // one tap from being written down rather than a dead end.
  'spell-pick-custom': () => {
    const name = filters.text.trim();
    add({ ...spellToRow({}), name, level: targetLevel() }, name ? `“${name}”` : 'A blank spell');
  },

  'spell-filters-clear': () => {
    filters.levels.clear();
    filters.classes.clear();
    filters.schools.clear();
    shown = PAGE;
    renderFilters();
    renderResults();
    announce('Filters cleared.');
  },

  'spell-more': () => {
    shown += PAGE;
    renderResults();
  },

  // Tap a result to read it before committing to it — the same tap-to-reveal the sheet's own
  // rows use, and the reason the description is worth shipping at all.
  'spell-preview': (button) => {
    const row = button.closest('.result');
    const open = row.classList.toggle('is-expanded');
    button.setAttribute('aria-expanded', String(open));
  },
};

/** The search box (an `input` event) and the filter chips (a `change`). */
export function onSpellPickerInput(el) {
  if (el.id !== 'spell-search') return false;
  filters.text = el.value;
  shown = PAGE;
  renderResults();
  return true;
}

export function onSpellPickerChange(el) {
  const group = el.dataset.spellFilter;
  if (!group) return false;
  const value = group === 'levels' ? Number(el.dataset.value) : el.dataset.value;
  if (el.checked) filters[group].add(value);
  else filters[group].delete(value);
  shown = PAGE;
  renderResults();
  return true;
}
