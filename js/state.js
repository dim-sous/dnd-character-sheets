/**
 * The store: the single source of truth for what is on screen.
 *
 * Rules of the loop:
 *   - Nothing outside this module mutates a character.
 *   - Every mutator ends in emit(), which both notifies renderers and schedules a save.
 *     Persistence hangs off the loop rather than being something a caller must remember.
 */

import { ROW_TEMPLATES, newId, blankCharacter } from './constants.js';
import { load, save, mergeCharacters, canWrite } from './storage.js';
import * as rules from './rules.js';

const SAVE_DELAY_MS = 400;

/** Where each repeatable list lives on a character. */
const LIST_PATHS = {
  attacks: 'attacks',
  spells: 'spellcasting.spells',
  features: 'features',
  inventory: 'inventory',
  hitDice: 'hitDice',
};

let characters = [];
let activeId = null;
let saveTimer = null;
// Set when load() found unreadable data. While true we refuse to save, so the first
// interaction can't overwrite characters the user might still recover.
let recoveryMode = false;
let corruptRaw = null;

const listeners = new Set();
const statusListeners = new Set();

/* ------------------------------------------------------------------ paths */

export function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

export function setByPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((acc, key) => acc[key], obj);
  target[last] = value;
}

/* ------------------------------------------------- subscription and events */

/** type is 'structural' (rebuild the sheet) or 'derived' (recompute readouts only). */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function status(message, tone = 'info') {
  statusListeners.forEach((fn) => fn(message, tone));
}

/** Notify renderers without scheduling a save — used when adopting another tab's write. */
function notify(type = 'derived') {
  listeners.forEach((fn) => fn(type));
}

function emit(type = 'derived') {
  notify(type);
  scheduleSave();
}

function scheduleSave() {
  if (recoveryMode) return; // never overwrite unreadable data until the user resolves it
  clearTimeout(saveTimer);
  status('Saving…', 'pending');
  saveTimer = setTimeout(() => {
    // Null the timer before writing so flush()'s guard reflects reality and an idle,
    // stale tab does not re-save its snapshot over another tab on the next lifecycle event.
    saveTimer = null;
    const result = save(characters);
    status(result.ok ? 'Saved' : result.error, result.ok ? 'ok' : 'error');
  }, SAVE_DELAY_MS);
}

/** Force a write now — used before the tab goes away. Reports success/failure like the debounce. */
export function flush() {
  if (recoveryMode || saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const result = save(characters);
  status(result.ok ? 'Saved' : result.error, result.ok ? 'ok' : 'error');
}

/* --------------------------------------------------------------- lifecycle */

export function init() {
  const result = load();
  characters = result.characters;
  activeId = characters.length > 0 ? characters[0].id : null;
  recoveryMode = Boolean(result.corrupt);
  corruptRaw = result.raw ?? null;
  return { error: result.error, corrupt: recoveryMode, writable: canWrite() };
}

/** The raw unreadable text captured at load, for the recovery "download" action. */
export function getCorruptRaw() {
  return corruptRaw;
}

/** Leave recovery mode: the user chose to discard the unreadable data and start fresh. */
export function startFresh() {
  recoveryMode = false;
  corruptRaw = null;
  scheduleSave();
}

/**
 * Another tab wrote to storage. If we have no unsaved edits of our own (and are not in
 * recovery), adopt its version so the two tabs converge instead of the last writer
 * silently winning the whole roster. Never runs mid-edit — a pending save is local work
 * we must not drop.
 */
export function reloadFromStorage() {
  if (saveTimer !== null || recoveryMode) return;
  const result = load();
  if (result.corrupt || result.error) return;
  characters = result.characters;
  if (!characters.some((c) => c.id === activeId)) {
    activeId = characters.length > 0 ? characters[0].id : null;
  }
  notify('structural');
}

/* ----------------------------------------------------------------- reading */

export function getCharacters() {
  return characters;
}

export function getActive() {
  return characters.find((c) => c.id === activeId) ?? null;
}

export function getActiveId() {
  return activeId;
}

export function getListPath(listName) {
  return LIST_PATHS[listName];
}

/* ---------------------------------------------------------------- mutation */

export function setActive(id) {
  if (id === activeId) return;
  activeId = id;
  emit('structural');
}

export function createCharacter(sourceId = null) {
  const source = sourceId ? characters.find((c) => c.id === sourceId) : null;
  const char = source
    ? { ...structuredCloneish(source), id: newId(), name: `${source.name || 'Unnamed'} (copy)` }
    : blankCharacter();
  characters.push(char);
  activeId = char.id;
  emit('structural');
  return char;
}

export function deleteCharacter(id) {
  const index = characters.findIndex((c) => c.id === id);
  if (index === -1) return;
  characters.splice(index, 1);
  if (activeId === id) {
    activeId = characters.length > 0 ? characters[Math.max(0, index - 1)].id : null;
  }
  emit('structural');
}

/** Set a dot-path field on the active character. */
export function updateActive(path, value, type = 'derived') {
  const char = getActive();
  if (!char) return;
  setByPath(char, path, value);

  // Lowering a slot total must not leave more slots spent than exist. setSlotsUsed
  // clamps the other direction; this is the same invariant from the total's side.
  if (path.startsWith('spellcasting.slots.') && path.endsWith('.total')) {
    const slot = getByPath(char, path.slice(0, -'.total'.length));
    slot.used = Math.max(0, Math.min(slot.total, slot.used));
  }

  emit(type);
}

/** Add or remove a string from one of the toggle arrays (proficiencies, conditions…). */
export function toggleInArray(path, value, on) {
  const char = getActive();
  if (!char) return;
  const list = getByPath(char, path);
  const index = list.indexOf(value);
  if (on && index === -1) list.push(value);
  if (!on && index !== -1) list.splice(index, 1);
  emit('derived');
}

export function addRow(listName) {
  const char = getActive();
  if (!char) return;
  getByPath(char, LIST_PATHS[listName]).push(ROW_TEMPLATES[listName]());
  emit('structural');
}

export function removeRow(listName, index) {
  const char = getActive();
  if (!char) return;
  getByPath(char, LIST_PATHS[listName]).splice(index, 1);
  emit('structural');
}

/** Spell slots: clicking pip i fills through i, clicking the last filled pip empties it. */
export function setSlotsUsed(level, used) {
  const char = getActive();
  if (!char) return;
  const slot = char.spellcasting.slots[level];
  slot.used = Math.max(0, Math.min(slot.total, used));
  emit('derived');
}

/**
 * A long rest applies the full 2024 recovery: HP to max, temp HP and death saves
 * cleared, half the hit dice back (min 1), exhaustion down one, all spell slots reset.
 * Every field stays hand-editable afterwards — this automates the common case, it does
 * not take the ruling away from the player. Confirmed at the call site (main.js).
 */
export function longRest() {
  const char = getActive();
  if (!char) return;

  char.hp.current = char.hp.max;
  char.hp.temp = 0;
  char.deathSaves = { successes: 0, failures: 0 };
  char.hitDice = rules.restoreHitDice(char.hitDice);
  char.exhaustion = Math.max(0, char.exhaustion - 1);
  for (const slot of Object.values(char.spellcasting.slots)) slot.used = 0;

  emit('derived');
}

export function replaceAll(incoming) {
  characters = incoming;
  activeId = characters.length > 0 ? characters[0].id : null;
  emit('structural');
}

export function merge(incoming) {
  characters = mergeCharacters(characters, incoming);
  if (!activeId && characters.length > 0) activeId = characters[0].id;
  emit('structural');
}

/**
 * structuredClone() is unavailable in some older mobile browsers, and a character is
 * plain JSON anyway.
 */
function structuredCloneish(value) {
  return JSON.parse(JSON.stringify(value));
}
