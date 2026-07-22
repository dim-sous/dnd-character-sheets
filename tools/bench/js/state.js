/**
 * The store.
 *
 * One object, one notify, one debounced write. Nothing outside this module mutates
 * it — same discipline as the app's state.js, for the same reason: it keeps the
 * "what changed" question answerable.
 */

import {
  BLOCKS, DEFAULT_CARDS, DEFAULT_TABS, DEFAULT_SAMPLE,
  LIGHT, DARK, METRICS, STORAGE_KEY, SCHEMA_VERSION,
} from './constants.js';

const SAVE_DELAY_MS = 350;

let state = null;
let saveTimer = null;
const listeners = new Set();
let statusFn = () => {};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onStatus(fn) { statusFn = fn; }
export function get() { return state; }

function emit() {
  listeners.forEach((fn) => fn(state));
  scheduleSave();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  statusFn('Saving…');
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...state }));
      statusFn('Saved');
    } catch (err) {
      statusFn('Not saved — storage blocked');
    }
  }, SAVE_DELAY_MS);
}

/** Force a write now. Called on pagehide, because a browser will not wait. */
export function flush() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...state })); }
  catch (err) { /* nothing useful to do here */ }
}

export function blank() {
  const cards = {};
  for (const [id, c] of Object.entries(DEFAULT_CARDS)) {
    cards[id] = { title: c.title, blocks: [...c.blocks], cols: 1 };
  }
  const blockCfg = {};
  for (const [id, b] of Object.entries(BLOCKS)) {
    blockCfg[id] = { subhead: b.subhead || '', hidden: [], span: 1, rowSpan: 1, col: 0 };
  }
  return {
    light: { ...LIGHT },
    dark: { ...DARK },
    metrics: { ...METRICS },
    cards,
    blockCfg,
    tabs: DEFAULT_TABS.map((t) => ({ ...t, cards: [...t.cards] })),
    sample: { ...DEFAULT_SAMPLE },
    ui: { mode: 'style', width: 390, scheme: 'light', activeTab: 'combat', open: {}, expanded: {} },
  };
}

/**
 * Merge a stored object over a blank one.
 *
 * Same contract as the app's normalizeCharacter: a save from an older version, or
 * one you hand-edited in devtools, must never crash the tool on a missing key.
 */
export function normalize(raw) {
  const base = blank();
  if (!raw || typeof raw !== 'object') return base;

  if (raw.light) Object.assign(base.light, raw.light);
  if (raw.dark) Object.assign(base.dark, raw.dark);
  if (raw.metrics) Object.assign(base.metrics, raw.metrics);
  if (raw.sample) Object.assign(base.sample, raw.sample);
  if (raw.ui) Object.assign(base.ui, raw.ui);

  if (raw.cards && typeof raw.cards === 'object') {
    base.cards = {};
    for (const [id, c] of Object.entries(raw.cards)) {
      base.cards[id] = {
        title: typeof c.title === 'string' ? c.title : '',
        blocks: Array.isArray(c.blocks) ? c.blocks.filter((b) => BLOCKS[b]) : [],
        cols: Number.isFinite(c.cols) ? Math.max(1, Math.min(4, c.cols)) : 1,
      };
    }
  }
  if (raw.blockCfg && typeof raw.blockCfg === 'object') {
    for (const [id, cfg] of Object.entries(raw.blockCfg)) {
      if (!base.blockCfg[id]) continue;
      Object.assign(base.blockCfg[id], {
        subhead: typeof cfg.subhead === 'string' ? cfg.subhead : base.blockCfg[id].subhead,
        hidden: Array.isArray(cfg.hidden) ? cfg.hidden : [],
        span: Number.isFinite(cfg.span) ? cfg.span : 1,
        rowSpan: Number.isFinite(cfg.rowSpan) ? cfg.rowSpan : 1,
        col: Number.isFinite(cfg.col) ? cfg.col : 0,
      });
    }
  }
  if (Array.isArray(raw.tabs) && raw.tabs.length) {
    base.tabs = raw.tabs.map((t) => ({
      id: String(t.id || `tab${Math.random().toString(36).slice(2, 8)}`),
      label: typeof t.label === 'string' ? t.label : 'Tab',
      glyph: typeof t.glyph === 'string' ? t.glyph : '○',
      cards: Array.isArray(t.cards) ? t.cards.filter((c) => base.cards[c]) : [],
    }));
  }
  if (!base.tabs.some((t) => t.id === base.ui.activeTab)) {
    base.ui.activeTab = base.tabs[0] ? base.tabs[0].id : null;
  }
  return base;
}

export function init() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch (err) { statusFn('Stored session unreadable — starting fresh'); }
  state = normalize(stored);
  return Boolean(stored);
}

/** Adopt the palette and metrics read out of the real stylesheet as the baseline. */
export function adoptBaseline({ light, dark, metrics }, { overwrite }) {
  if (light) Object.assign(LIGHT, light);
  if (dark) Object.assign(DARK, dark);
  if (metrics) Object.assign(METRICS, metrics);
  if (overwrite) {
    if (light) Object.assign(state.light, light);
    if (dark) Object.assign(state.dark, dark);
    if (metrics) Object.assign(state.metrics, metrics);
    emit();
  }
}

/* --------------------------------------------------------------- mutators */

export function set(fn) { fn(state); emit(); }

export function reset() {
  const keep = state.ui;
  state = blank();
  state.ui = { ...keep, activeTab: state.tabs[0].id, expanded: {} };
  emit();
}

export function setUi(patch) { Object.assign(state.ui, patch); emit(); }

export function moveCard(cardId, fromTab, toTab, index) {
  const src = state.tabs.find((t) => t.id === fromTab);
  const dst = state.tabs.find((t) => t.id === toTab);
  if (!src || !dst) return;
  const at = src.cards.indexOf(cardId);
  if (at === -1) return;
  src.cards.splice(at, 1);
  let target = index;
  if (src === dst && at < index) target -= 1;
  dst.cards.splice(Math.max(0, Math.min(target, dst.cards.length)), 0, cardId);
  emit();
}

export function moveBlock(blockId, fromCard, toCard, index) {
  const src = fromCard ? state.cards[fromCard] : null;
  let target = index;
  if (src) {
    const at = src.blocks.indexOf(blockId);
    if (at !== -1) {
      src.blocks.splice(at, 1);
      if (src === state.cards[toCard] && at < target) target -= 1;
    }
  }
  const dst = toCard ? state.cards[toCard] : null;
  if (dst && !dst.blocks.includes(blockId)) {
    // A block cannot be wider than the card it lands in.
    const cfg = state.blockCfg[blockId];
    const cols = Math.max(1, dst.cols || 1);
    cfg.span = Math.min(cfg.span, cols);
    if (cfg.col > cols) cfg.col = 0;
    dst.blocks.splice(Math.max(0, Math.min(target, dst.blocks.length)), 0, blockId);
  }
  emit();
}

export function setCardCols(cardId, cols) {
  const card = state.cards[cardId];
  if (!card) return;
  card.cols = Math.max(1, Math.min(4, cols));
  for (const b of card.blocks) {
    const cfg = state.blockCfg[b];
    cfg.span = Math.min(cfg.span, card.cols);
    if (cfg.col > card.cols) cfg.col = 0;
  }
  emit();
}

export function addTab() {
  state.tabs.push({
    id: `tab${Date.now()}`, label: `Tab ${state.tabs.length + 1}`, glyph: '○', cards: [],
  });
  emit();
}

export function removeTab(id) {
  state.tabs = state.tabs.filter((t) => t.id !== id);
  if (!state.tabs.some((t) => t.id === state.ui.activeTab)) {
    state.ui.activeTab = state.tabs[0] ? state.tabs[0].id : null;
  }
  emit();
}

export function addCard(tabId) {
  const id = `card${Date.now()}`;
  state.cards[id] = { title: 'New card', blocks: [], cols: 1 };
  const tab = state.tabs.find((t) => t.id === tabId) || state.tabs[0];
  if (tab) tab.cards.push(id);
  state.ui.expanded[id] = true;
  emit();
  return id;
}

/** Deleting a card returns its blocks to the tray rather than losing them. */
export function removeCard(id) {
  delete state.cards[id];
  state.tabs.forEach((t) => { t.cards = t.cards.filter((c) => c !== id); });
  emit();
}
