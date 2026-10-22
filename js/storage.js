/**
 * Everything that touches localStorage or the filesystem.
 *
 * Nothing else in the app knows the storage key or the on-disk shape.
 */

import {
  STORAGE_KEY, SCHEMA_VERSION, SPELL_LEVELS, ROW_TEMPLATES, MAX_EXHAUSTION,
  blankCharacter, newId,
} from './constants.js';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function str(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function strArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

function normalizeRow(listName, raw) {
  const template = ROW_TEMPLATES[listName]();
  if (!raw || typeof raw !== 'object') return template;
  const out = {};
  for (const [key, fallback] of Object.entries(template)) {
    const value = raw[key];
    if (typeof fallback === 'number') out[key] = num(value, fallback);
    // A MISSING boolean takes the template's default, the way the number and string branches
    // already do — a bare Boolean(value) made every absent key false and so quietly discarded
    // a `true` default (#84's `proficient`). A key that IS present is still coerced, so a
    // hand-edited 0/null/"" still reads as false.
    else if (typeof fallback === 'boolean') out[key] = value === undefined ? fallback : Boolean(value);
    // A hand-edited file may hold "bonus": 5 where the app stores "+5". Coercing
    // rather than str()-ing keeps the number instead of silently blanking it.
    else if (typeof value === 'number') out[key] = String(value);
    else out[key] = str(value, fallback);
  }
  return out;
}

function normalizeRows(listName, raw) {
  return Array.isArray(raw) ? raw.map((row) => normalizeRow(listName, row)) : [];
}

/**
 * Merge a raw object over the canonical shape.
 *
 * Used by BOTH load and import, so a hand-edited file, an export from an older version,
 * or a partially-written record can never crash the app on a missing key.
 */
export function normalizeCharacter(raw) {
  const base = blankCharacter();
  if (!raw || typeof raw !== 'object') return base;

  const char = { ...base };

  char.id = str(raw.id) || newId();
  for (const key of ['name', 'player', 'species', 'class', 'subclass', 'background', 'alignment', 'notes']) {
    char[key] = str(raw[key], base[key]);
  }
  char.level = num(raw.level, base.level);
  char.heroicInspiration = Boolean(raw.heroicInspiration);
  char.concentration = Boolean(raw.concentration);   // #78, same contract: any truthy value → true

  char.abilities = { ...base.abilities };
  if (raw.abilities && typeof raw.abilities === 'object') {
    for (const key of Object.keys(base.abilities)) {
      char.abilities[key] = num(raw.abilities[key], base.abilities[key]);
    }
  }

  char.saveProficiencies = strArray(raw.saveProficiencies);
  char.skillProficiencies = strArray(raw.skillProficiencies);
  char.skillExpertise = strArray(raw.skillExpertise);
  // Expertise implies proficiency (#5). An old save or hand-edited file may hold
  // expertise without proficiency — promote rather than drop, honoring the stronger
  // claim, the same way out-of-range pips are clamped at the door below.
  for (const key of char.skillExpertise) {
    if (!char.skillProficiencies.includes(key)) char.skillProficiencies.push(key);
  }

  // #57: flat scalar, same idiom as ac/initiativeBonus/speed just below.
  char.skillBonusAll = num(raw.skillBonusAll, base.skillBonusAll);

  // #57: fixed key set, same idiom as `abilities` above and `currency` below —
  // unknown keys dropped, missing keys default to 0.
  char.skillBonuses = { ...base.skillBonuses };
  if (raw.skillBonuses && typeof raw.skillBonuses === 'object') {
    for (const key of Object.keys(base.skillBonuses)) {
      char.skillBonuses[key] = num(raw.skillBonuses[key], base.skillBonuses[key]);
    }
  }

  // #68: the saving-throw twins of the two blocks above, same idioms.
  char.saveBonusAll = num(raw.saveBonusAll, base.saveBonusAll);
  char.saveBonuses = { ...base.saveBonuses };
  if (raw.saveBonuses && typeof raw.saveBonuses === 'object') {
    for (const key of Object.keys(base.saveBonuses)) {
      char.saveBonuses[key] = num(raw.saveBonuses[key], base.saveBonuses[key]);
    }
  }

  char.ac = num(raw.ac, base.ac);
  char.initiativeBonus = num(raw.initiativeBonus, base.initiativeBonus);
  char.speed = num(raw.speed, base.speed);

  char.hp = {
    max: num(raw.hp?.max, base.hp.max),
    current: num(raw.hp?.current, base.hp.current),
    temp: num(raw.hp?.temp, base.hp.temp),
  };
  // hitDice grew from a single {size,total,remaining} object into a list of pools
  // (multiclass). Fold the old shape into a one-row list so pre-v2 saves and older
  // exported backups keep loading with their die preserved.
  if (Array.isArray(raw.hitDice)) {
    char.hitDice = normalizeRows('hitDice', raw.hitDice);
  } else if (raw.hitDice && typeof raw.hitDice === 'object') {
    char.hitDice = [normalizeRow('hitDice', raw.hitDice)];
  } else {
    char.hitDice = normalizeRows('hitDice', base.hitDice);
  }
  // Clamped on the way in: there are only ever three death-save pips and six
  // exhaustion pips, so an out-of-range import would display a number the sheet
  // has no way to represent or undo.
  char.deathSaves = {
    successes: clamp(num(raw.deathSaves?.successes, 0), 0, 3),
    failures: clamp(num(raw.deathSaves?.failures, 0), 0, 3),
  };
  char.conditions = strArray(raw.conditions);
  char.exhaustion = clamp(num(raw.exhaustion, 0), 0, MAX_EXHAUSTION);
  // #140 — absent in every pre-#140 file, and normalizeRows maps a non-array to [], so old
  // saves and old exports load with an empty list instead of crashing. NOT clamped the way
  // deathSaves/exhaustion/slots are just above: those have a fixed number of pips, so an
  // out-of-range import would render a state the UI cannot undo. A resource is two free-form
  // numbers in typed fields, and `remaining` above `total` is a legitimate override the player
  // can always correct — the same reason current HP is allowed above max.
  char.resources = normalizeRows('resources', raw.resources);

  char.attacks = normalizeRows('attacks', raw.attacks);
  char.features = normalizeRows('features', raw.features);
  char.feats = normalizeRows('feats', raw.feats); // #67 — absent in every pre-#67 file → []
  char.inventory = normalizeRows('inventory', raw.inventory);

  const slots = {};
  for (const level of SPELL_LEVELS) {
    const rawSlot = raw.spellcasting?.slots?.[level] ?? raw.spellcasting?.slots?.[String(level)];
    const total = num(rawSlot?.total, 0);
    // Same invariant state.js keeps at runtime (setSlotsUsed, and the total-lowering clamp in
    // updateActive): spent can't exceed the total or fall below zero. Without this an import
    // could render more filled pips than exist — a state the pip UI has no way to clear, the
    // same reason deathSaves and exhaustion are clamped above.
    slots[level] = {
      total,
      used: clamp(num(rawSlot?.used, 0), 0, total),
    };
  }
  char.spellcasting = {
    ability: str(raw.spellcasting?.ability, ''),
    // Absent in every older file, so it backfills to 0 — "not tracked" — with no migration.
    // Not clamped: like Max HP it is a typed number, and the player can always correct it.
    preparedMax: num(raw.spellcasting?.preparedMax, base.spellcasting.preparedMax),
    slots,
    spells: normalizeRows('spells', raw.spellcasting?.spells),
  };

  char.currency = { ...base.currency };
  if (raw.currency && typeof raw.currency === 'object') {
    for (const key of Object.keys(base.currency)) {
      char.currency[key] = num(raw.currency[key], 0);
    }
  }

  // #69: same fixed-key-object idiom as `currency` above, but string-valued — unknown keys
  // dropped, missing keys default to ''. Backfills every character created before the card.
  char.proficiencies = { ...base.proficiencies };
  if (raw.proficiencies && typeof raw.proficiencies === 'object') {
    for (const key of Object.keys(base.proficiencies)) {
      char.proficiencies[key] = str(raw.proficiencies[key], '');
    }
  }

  return char;
}

/**
 * Turn stored text into characters. Pure (no localStorage), so both load() and the tests
 * share it. A parse failure is reported as `corrupt` with the original text kept in `raw`,
 * so the caller can back it up before anything overwrites it.
 *
 * `fromNewerVersion` is set when the payload's schemaVersion is greater than this build's
 * SCHEMA_VERSION: the data may carry fields this build doesn't understand and would drop on
 * the next save, so the caller can warn before an edit silently discards them. We still load
 * best-effort — the tracker stays usable — rather than refuse, which would only strand it.
 */
export function parseStored(text) {
  if (!text) return { characters: [], error: null };
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed?.characters;
    if (!Array.isArray(list)) throw new Error('no character array');
    // A bare array or a missing/garbage version is treated as "not newer" (null).
    const storedVersion = Array.isArray(parsed) ? null : num(parsed?.schemaVersion, null);
    return {
      characters: list.map(normalizeCharacter),
      fromNewerVersion: storedVersion !== null && storedVersion > SCHEMA_VERSION,
      error: null,
    };
  } catch (err) {
    return {
      characters: [],
      corrupt: true,
      raw: text,
      error: 'Saved characters could not be read. They have NOT been changed — download a copy before starting fresh.',
    };
  }
}

/**
 * Read the saved characters. On a parse failure the recoverable text is handed back
 * untouched (see parseStored) so the caller can refuse to overwrite it.
 */
export function load() {
  let text;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return { characters: [], error: 'Storage is unavailable (private browsing?). Changes will not be saved.' };
  }
  return parseStored(text);
}

/** Probe whether localStorage actually accepts writes — private mode / a full disk block it. */
export function canWrite() {
  const probe = `${STORAGE_KEY}::probe`;
  try {
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch (err) {
    return false;
  }
}

export function save(characters) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters }),
    );
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: 'Could not save — storage may be full or blocked.' };
  }
}

/**
 * Today as `YYYY-MM-DD`. Exported for #162: the layout exporter needs the same date string, and
 * every function that bakes it into a filename or an envelope takes it as an argument so the
 * tests do not depend on what day it is.
 */
export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Hand the browser a JSON file to save.
 *
 * Exported for #162 so the layout exporter reuses it instead of growing a second copy — the
 * `setTimeout` below is the whole reason not to write this twice, and a duplicate that revokes
 * immediately cancels the download in some browsers. This is the one place the layout feature
 * touches storage.js, and it is additive: nothing here learns what a layout is, and the character
 * persistence path is unchanged. (CLAUDE.md calls a layout change that FORCES a storage.js change
 * a smell; reusing an existing DOM helper that knows nothing about characters is not that.)
 *
 * Note this module is "DOM-free" only at module scope — the suite imports storage.js and never
 * calls this, so Node never evaluates the Blob/anchor path.
 */
export function downloadFile(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; give it a beat.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportToFile(characters) {
  downloadFile(
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters }, null, 2),
    `dnd-characters-${today()}.json`,
  );
}

/**
 * The filename for a single-character export: `<name>_<date>.json` (#70).
 *
 * Character names are free-form, so strip what filesystems refuse (`<>:"/\|?*` and control
 * characters), fold whitespace runs to underscores, and trim the leading/trailing punctuation
 * that would make the file hidden or awkward. Length-capped so a pasted paragraph can't become
 * a filename. An empty result falls back to `unnamed` — the date still tells the files apart.
 *
 * Letters outside ASCII are kept on purpose: "Ñandú" should export as itself, not as dashes.
 * No Windows reserved-name guard is needed — the `_<date>` suffix means the base can never be
 * bare `CON`/`NUL`/`AUX`.
 *
 * `dateStr` is injected rather than read from the clock so the tests don't depend on today.
 */
export function characterFilename(char, dateStr = today()) {
  const cleaned = String(char?.name ?? '')
    // Whitespace folds FIRST: tab and newline live inside the control range stripped
    // below, so doing that first would delete them and glue the words together.
    .replace(/\s+/g, '_')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    // A stripped character between two words would otherwise leave "A__B".
    .replace(/_{2,}/g, '_')
    .slice(0, 60)
    .replace(/^[._-]+|[._-]+$/g, '');
  return `${cleaned || 'unnamed'}_${dateStr}.json`;
}

/**
 * Export ONE character (#70), wrapped in the very envelope readImportFile already accepts —
 * a one-element `characters` list — so a single-character file round-trips with no import
 * change and no second file shape to maintain.
 */
export function exportCharacterToFile(char) {
  downloadFile(
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters: [char] }, null, 2),
    characterFilename(char),
  );
}

/** Download the raw, unreadable stored text so a corrupt save can be recovered by hand. */
export function exportRaw(raw) {
  downloadFile(raw ?? '', `dnd-characters-unreadable-${today()}.json`);
}

export function readImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const list = Array.isArray(parsed) ? parsed : parsed?.characters;
        if (!Array.isArray(list)) throw new Error('shape');
        if (list.length === 0) throw new Error('empty');
        resolve(list.map(normalizeCharacter));
      } catch (err) {
        reject(new Error('That file is not a character backup this app can read.'));
      }
    };
    reader.readAsText(file);
  });
}

/**
 * Import: one path, no question. A character whose id is already on this device is UPDATED
 * from the file (see keepPlayState for what survives); anything else is ADDED, and nothing
 * else on the device is touched. The id alone decides — never the name, so two characters
 * that happen to share one stay two characters.
 *
 * The id is the right key because it is the one thing every export carries unchanged: a
 * character levelled up on a laptop and sent back to the phone arrives with the phone's id,
 * while a Duplicate gets a fresh one and so is a different character on purpose.
 *
 * A file can only claim an id once. A second character in the same file with the same id
 * (only a hand-edit makes one) is added under a fresh id rather than applied over the first,
 * so no character in the file is silently dropped.
 *
 * Returns the new roster plus which characters were updated and added, in file order, so the
 * caller can say what happened — there is no dialog before it any more.
 */
export function importCharacters(existing, incoming) {
  const characters = [...existing];
  const taken = new Set(existing.map((c) => c.id));
  const claimed = new Set();
  const updated = [];
  const added = [];
  for (const char of incoming) {
    const index = claimed.has(char.id) ? -1 : existing.findIndex((c) => c.id === char.id);
    claimed.add(char.id);
    if (index !== -1) {
      characters[index] = keepPlayState(existing[index], char);
      updated.push(characters[index]);
      continue;
    }
    const copy = taken.has(char.id) ? { ...char, id: newId() } : char;
    taken.add(copy.id);
    characters.push(copy);
    added.push(copy);
  }
  return { characters, updated, added };
}

/**
 * The file brings the BUILD, the device keeps the PLAY: `incoming` with this device's
 * inventory, coins, notes and everything that moves at the table carried over from `prior`.
 *
 * Pools carry over what was SPENT, not what is left, so a level-up in the file shows up:
 * 5 HP down stays 5 down under the new max, one Rage spent stays one spent out of the new
 * total. A pool with no size on either side (a max or total of 0 — "not tracked", the Max HP
 * contract) has no "spent" to speak of, so its current value is kept as typed. Spell slots are
 * the exception only because they are already stored as `used`, clamped to the new total for
 * the same reason normalizeCharacter clamps them: a pip that does not exist cannot be cleared.
 *
 * Rows are matched by name (resources, spells) or die size (Hit Point Dice), each prior row
 * used once. A row only the file has comes in exactly as the file has it; a row only the
 * device has is gone, because the list itself is part of the build.
 *
 * Pure: neither argument is mutated, and nothing returned shares an object with `prior`.
 */
export function keepPlayState(prior, incoming) {
  const kept = JSON.parse(JSON.stringify(prior));
  const char = JSON.parse(JSON.stringify(incoming));

  char.inventory = kept.inventory;
  char.currency = kept.currency;
  char.notes = kept.notes;

  char.hp = {
    max: char.hp.max,
    current: carrySpent(kept.hp.max, kept.hp.current, char.hp.max),
    temp: kept.hp.temp,
  };
  char.deathSaves = kept.deathSaves;
  char.conditions = kept.conditions;
  char.exhaustion = kept.exhaustion;
  char.concentration = kept.concentration;
  char.heroicInspiration = kept.heroicInspiration;

  const keepRemaining = (row, old) => ({
    ...row, remaining: carrySpent(old.total, old.remaining, row.total),
  });
  char.hitDice = carryRows(char.hitDice, kept.hitDice, (row) => row.size, keepRemaining);
  char.resources = carryRows(char.resources, kept.resources, (row) => row.name, keepRemaining);
  char.spellcasting.spells = carryRows(
    char.spellcasting.spells, kept.spellcasting.spells, (row) => row.name,
    (row, old) => ({ ...row, prepared: old.prepared }),
  );
  for (const level of SPELL_LEVELS) {
    const slot = char.spellcasting.slots[level];
    slot.used = clamp(kept.spellcasting.slots[level].used, 0, slot.total);
  }

  return char;
}

/** Same amount spent out of the new size, floored at 0; as typed when either size is unset. */
function carrySpent(oldSize, oldLeft, newSize) {
  if (!(oldSize > 0) || !(newSize > 0)) return oldLeft;
  return Math.max(0, newSize - (oldSize - oldLeft));
}

/** Each of `rows` that has a namesake in `priorRows` goes through `carry`; first come, first matched. */
function carryRows(rows, priorRows, keyOf, carry) {
  const key = (row) => String(keyOf(row)).trim().toLowerCase();
  const pending = new Map();
  for (const old of priorRows) {
    if (!pending.has(key(old))) pending.set(key(old), []);
    pending.get(key(old)).push(old);
  }
  return rows.map((row) => {
    const old = pending.get(key(row))?.shift();
    return old ? carry(row, old) : row;
  });
}
