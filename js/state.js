/**
 * The store: the single source of truth for what is on screen.
 *
 * Rules of the loop:
 *   - Nothing outside this module mutates a character.
 *   - Every mutator ends in emit(), which both notifies renderers and schedules a save.
 *     Persistence hangs off the loop rather than being something a caller must remember.
 */

import { ROW_TEMPLATES, newId, blankCharacter } from './constants.js';
import { load, save, importCharacters as mergeImport, canWrite } from './storage.js';
import * as rules from './rules.js';

const SAVE_DELAY_MS = 400;

/** Where each repeatable list lives on a character. */
const LIST_PATHS = {
  attacks: 'attacks',
  spells: 'spellcasting.spells',
  features: 'features',
  feats: 'feats',
  inventory: 'inventory',
  hitDice: 'hitDice',
  resources: 'resources',   // #140
};

let characters = [];
let activeId = null;
let saveTimer = null;
// Set when load() found unreadable data. While true we refuse to save, so the first
// interaction can't overwrite characters the user might still recover.
let recoveryMode = false;
let corruptRaw = null;
// The roster as it was before the last import, while that import can still be undone.
let importUndo = null;

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

/**
 * Schedule the save BEFORE telling anyone, because rendering is the thing most likely to
 * throw and the write is the thing that must not be lost (#122).
 *
 * The old order was notify-then-schedule, so a render bug escaping `notify` skipped
 * `scheduleSave()` entirely: the mutation had already landed in `characters`, nothing was
 * queued to write it, and the player kept typing into a sheet that had quietly stopped
 * saving. A later successful edit re-saved the whole array, so it read as "my last few
 * changes vanished" rather than as a crash — and only if the tab survived that long.
 *
 * The debounce makes the order free: the write still happens SAVE_DELAY_MS later, against
 * the same mutated `characters`, whether or not the render that follows survives.
 *
 * Deliberately NOT wrapped in try/catch. There is one subscriber, and swallowing its
 * exception here would hide the render bug instead of fixing the data loss — the throw
 * should keep travelling up to the window error handler, which puts a banner on screen.
 */
function emit(type = 'derived') {
  importUndo = null; // any change ends the last import's undo window (importCharacters)
  scheduleSave();
  notify(type);
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
  return {
    error: result.error,
    corrupt: recoveryMode,
    writable: canWrite(),
    // Loaded a backup from a newer build — some fields may be hidden and would be lost on save.
    staleApp: Boolean(result.fromNewerVersion),
  };
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
  importUndo = null;
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
  // Expertise implies proficiency (#5) — the one rule the sheet enforces. Ticking
  // expertise pulls proficiency on; unticking proficiency pulls expertise off.
  // renderDerived re-syncs every [data-toggle] checkbox from state, so the second
  // box follows the same tap with no render changes. The import-side twin lives in
  // normalizeCharacter, which promotes expertise-without-proficiency at the door.
  if (path === 'skillExpertise' && on && !char.skillProficiencies.includes(value)) {
    char.skillProficiencies.push(value);
  }
  if (path === 'skillProficiencies' && !on) {
    const expIndex = char.skillExpertise.indexOf(value);
    if (expIndex !== -1) char.skillExpertise.splice(expIndex, 1);
  }
  emit('derived');
}

/**
 * `preset` pre-fills fields on the new row (#141). The spell list groups by level into one
 * <details> per level, so "+ Add" inside the Level 3 section has to create a level-3 spell —
 * appending a blank one that lands under Cantrips and has to be re-levelled would make the
 * grouping a thing to fight rather than a thing to use.
 *
 * Merged OVER the template and only for keys the template already has, so a preset can fill a
 * field but never invent one. That matters because the preset arrives from a DOM attribute:
 * normalizeRow rebuilds every stored row from template keys on load, so a key smuggled in here
 * would survive in memory, save to localStorage, and then silently disappear on the next open.
 */
export function addRow(listName, preset) {
  const char = getActive();
  if (!char) return;
  const row = ROW_TEMPLATES[listName]();
  if (preset) {
    for (const key of Object.keys(row)) {
      if (key in preset) row[key] = preset[key];
    }
  }
  getByPath(char, LIST_PATHS[listName]).push(row);
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
 * A long rest applies the full 2024 recovery: lost HP back, temp HP and death saves
 * cleared, all spent Hit Point Dice back, every class resource refilled, exhaustion down one,
 * all spell slots reset. Every field stays hand-editable afterwards — this automates the
 * common case, it does not take the ruling away from the player. Confirmed at the call site
 * (main.js).
 *
 * The HP half is `rules.restoreHp`, not an inline assignment: it has two edge cases worth
 * stating and testing (an unset max, and a hand-set current above max), and the rest of the
 * recovery arithmetic already lives in the pure module for exactly that reason.
 *
 * Class resources (#140) shipped OUT of this list, on the grounds that whether a resource comes
 * back is per-resource and this app holds no class knowledge. The owner reversed that on
 * 2026-10-21, and for class resources the 2024 rules agree: a resource that comes back on a short
 * rest (Channel Divinity, a Warlock's slots) comes back on a long one too, so refilling them all
 * is right for every class. What it can get wrong is a non-class row someone keeps in the
 * same tile — an item that recharges at dawn — and that stays a hand edit, like everything here.
 */
export function longRest() {
  const char = getActive();
  if (!char) return;

  char.hp = rules.restoreHp(char.hp);
  char.deathSaves = { successes: 0, failures: 0 };
  char.concentration = false;   // #78: nothing you concentrate on survives 8 hours of rest
  char.hitDice = rules.restoreHitDice(char.hitDice);
  char.resources = rules.restoreResources(char.resources || []);
  char.exhaustion = Math.max(0, char.exhaustion - 1);
  for (const slot of Object.values(char.spellcasting.slots)) slot.used = 0;

  emit('derived');
}

/**
 * Import a file's characters: update the ones already here, add the rest (storage.js's
 * importCharacters has the rules). An imported character becomes the open one — an updated one
 * first — so the player lands on what the file just changed.
 *
 * There is no question before it, so there is an Undo after it: the roster as it was is kept
 * until the next change of any kind, and undoImport() puts it back. Any later emit drops it,
 * because restoring a snapshot over edits made since would throw those edits away.
 */
export function importCharacters(incoming) {
  const before = { characters: structuredCloneish(characters), activeId };
  const result = mergeImport(characters, incoming);
  characters = result.characters;
  const open = result.updated[0] ?? result.added[0];
  if (open) activeId = open.id;
  emit('structural');
  importUndo = before; // after emit, which clears it
  return { updated: result.updated, added: result.added };
}

export function canUndoImport() {
  return importUndo !== null;
}

export function undoImport() {
  if (!importUndo) return;
  ({ characters, activeId } = importUndo);
  emit('structural');
}

/**
 * structuredClone() is unavailable in some older mobile browsers, and a character is
 * plain JSON anyway.
 */
function structuredCloneish(value) {
  return JSON.parse(JSON.stringify(value));
}
