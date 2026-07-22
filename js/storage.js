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
    else if (typeof fallback === 'boolean') out[key] = Boolean(value);
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

  char.abilities = { ...base.abilities };
  if (raw.abilities && typeof raw.abilities === 'object') {
    for (const key of Object.keys(base.abilities)) {
      char.abilities[key] = num(raw.abilities[key], base.abilities[key]);
    }
  }

  char.saveProficiencies = strArray(raw.saveProficiencies);
  char.skillProficiencies = strArray(raw.skillProficiencies);
  char.skillExpertise = strArray(raw.skillExpertise);
  char.proficiencyBonusOverride =
    raw.proficiencyBonusOverride === null || raw.proficiencyBonusOverride === undefined || raw.proficiencyBonusOverride === ''
      ? null
      : num(raw.proficiencyBonusOverride, null);

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

  char.attacks = normalizeRows('attacks', raw.attacks);
  char.features = normalizeRows('features', raw.features);
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
    slots,
    spells: normalizeRows('spells', raw.spellcasting?.spells),
  };

  char.currency = { ...base.currency };
  if (raw.currency && typeof raw.currency === 'object') {
    for (const key of Object.keys(base.currency)) {
      char.currency[key] = num(raw.currency[key], 0);
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

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function downloadFile(text, filename) {
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
 * Append imported characters, giving a fresh id to anything that collides.
 * Never silently overwrites a character the user is already using.
 */
export function mergeCharacters(existing, incoming) {
  const taken = new Set(existing.map((c) => c.id));
  const added = incoming.map((char) => {
    if (!taken.has(char.id)) {
      taken.add(char.id);
      return char;
    }
    const copy = { ...char, id: newId() };
    taken.add(copy.id);
    return copy;
  });
  return [...existing, ...added];
}
