/**
 * Everything that touches localStorage or the filesystem.
 *
 * Nothing else in the app knows the storage key or the on-disk shape.
 */

import {
  STORAGE_KEY, SCHEMA_VERSION, SPELL_LEVELS, ROW_TEMPLATES,
  blankCharacter, newId,
} from './constants.js';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
  char.hitDice = {
    size: str(raw.hitDice?.size, base.hitDice.size),
    total: num(raw.hitDice?.total, base.hitDice.total),
    remaining: num(raw.hitDice?.remaining, base.hitDice.remaining),
  };
  char.deathSaves = {
    successes: num(raw.deathSaves?.successes, 0),
    failures: num(raw.deathSaves?.failures, 0),
  };
  char.conditions = strArray(raw.conditions);
  char.exhaustion = num(raw.exhaustion, 0);

  char.attacks = normalizeRows('attacks', raw.attacks);
  char.features = normalizeRows('features', raw.features);
  char.inventory = normalizeRows('inventory', raw.inventory);

  const slots = {};
  for (const level of SPELL_LEVELS) {
    const rawSlot = raw.spellcasting?.slots?.[level] ?? raw.spellcasting?.slots?.[String(level)];
    slots[level] = {
      total: num(rawSlot?.total, 0),
      used: num(rawSlot?.used, 0),
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
 * Read the saved characters.
 *
 * On a parse failure we deliberately return an empty list WITHOUT writing anything back —
 * overwriting would destroy data the user could otherwise recover by hand from devtools.
 */
export function load() {
  let text;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    return { characters: [], error: 'Storage is unavailable (private browsing?). Changes will not be saved.' };
  }
  if (!text) return { characters: [], error: null };

  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : parsed?.characters;
    if (!Array.isArray(list)) throw new Error('no character array');
    return { characters: list.map(normalizeCharacter), error: null };
  } catch (err) {
    return {
      characters: [],
      error: 'Saved data could not be read and was left untouched. Import a backup, or check localStorage in devtools.',
    };
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

export function exportToFile(characters) {
  const blob = new Blob(
    [JSON.stringify({ schemaVersion: SCHEMA_VERSION, characters }, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dnd-characters-${today()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers; give it a beat.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
