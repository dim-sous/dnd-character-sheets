/**
 * Wiring. Events in, store mutations out, renders back.
 *
 * The store notifies; this module decides what to repaint. Nothing else calls a
 * render function directly except the canvases, which repaint themselves during a
 * gesture to avoid replacing the node the pointer is captured on.
 */

import { PRESETS, LIGHT, DARK, METRICS, SWATCH_ORDER, WIDTHS } from './constants.js';
import * as store from './state.js';
import * as rail from './rail.js';
import * as canvas from './canvas.js';
import * as exporter from './exporter.js';
import { renderSheet } from './preview.js';
import { applyTokens, parseRoot, parsePx } from './tokens.js';

const $ = (sel) => document.querySelector(sel);
const MODES = ['style', 'structure', 'compose'];

/* ------------------------------------------------------------------ chrome */

let toastTimer = null;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.show = 'true';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.dataset.show = 'false'; }, 2400);
}

store.onStatus((message) => { $('#save-state').textContent = message; });

/* ------------------------------------------------------------------ render */

function renderWidths() {
  const w = store.get().ui.width;
  $('#seg-width').innerHTML = WIDTHS.map((x) =>
    `<button data-width="${x.w}" aria-pressed="${w === x.w}" title="${x.name}">${x.label}</button>`).join('');
  $('#width-readout').textContent = `${w} × 740`;
  const frame = $('#frame');
  const flat = w >= 640;
  frame.style.width = `${w + (flat ? 2 : 18)}px`;
  frame.classList.toggle('frame--flat', flat);
}

function render() {
  const { mode, scheme } = store.get().ui;
  for (const m of MODES) $(`#mode-${m}`).setAttribute('aria-pressed', String(mode === m));
  $('#frame').hidden = mode !== 'style';
  $('#structure').hidden = mode !== 'structure';
  $('#compose').hidden = mode !== 'compose';
  $('#stage-body').dataset.mode = mode;

  $('#scheme-light').setAttribute('aria-pressed', String(scheme === 'light'));
  $('#scheme-dark').setAttribute('aria-pressed', String(scheme === 'dark'));

  if (mode === 'structure') {
    rail.renderStructure($('#rail-body'));
    canvas.renderStructure($('#structure'), render);
  } else if (mode === 'compose') {
    rail.renderCompose($('#rail-body'));
    canvas.renderCompose($('#compose'), render);
  } else {
    rail.renderStyle($('#rail-body'));
  }

  renderWidths();
  renderSheet($('#sheet'));
}

store.subscribe(render);

/* ------------------------------------------------------- rail: live input */

$('#rail-body').addEventListener('input', (e) => {
  const el = e.target;
  const state = store.get();

  // Metric sliders repaint tokens directly rather than through the store, so
  // dragging stays smooth; the store still records the value and schedules a save.
  if (el.dataset.metric) {
    const key = el.dataset.metric;
    state.metrics[key] = parseFloat(el.value);
    const out = document.getElementById(`v-${key}`);
    if (out) out.textContent = `${state.metrics[key]}${['scale', 'shadow'].includes(key) ? '' : 'px'}`;
    const readout = document.getElementById('scale-readout');
    if (readout && (key === 'textBase' || key === 'scale')) readout.textContent = rail.scaleReadout();
    applyTokens($('#sheet'), state, state.ui.scheme);
    const editSheet = document.getElementById('edit-sheet');
    if (editSheet) applyTokens(editSheet, state, state.ui.scheme);
    store.set(() => {});
    return;
  }

  if (el.dataset.colour) {
    const palette = state.ui.scheme === 'dark' ? state.dark : state.light;
    palette[el.dataset.colour] = el.value;
    const hex = document.getElementById(`hex-${el.dataset.colour}`);
    if (hex) hex.textContent = el.value;
    applyTokens($('#sheet'), state, state.ui.scheme);
    store.set(() => {});
    return;
  }

  if (el.dataset.sample) { store.set((s) => { s.sample[el.dataset.sample] = el.value; }); return; }
  if (el.dataset.cardtitle) { store.set((s) => { s.cards[el.dataset.cardtitle].title = el.value; }); return; }
  if (el.dataset.subhead) { store.set((s) => { s.blockCfg[el.dataset.subhead].subhead = el.value; }); return; }
  if (el.dataset.cardcols) { store.setCardCols(el.dataset.cardcols, Number(el.value)); return; }
  if (el.dataset.blkspan && canvas.pickedBlock) {
    store.set((s) => { s.blockCfg[canvas.pickedBlock][el.dataset.blkspan] = Number(el.value); });
  }
});

$('#rail-body').addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'c-titleface') { store.set((s) => { s.metrics.titleface = el.value; }); return; }
  if (el.id === 'c-groupSkills') { store.set((s) => { s.metrics.groupSkills = el.checked; }); return; }
  if (el.dataset.fieldtog) {
    const [block, key] = el.dataset.fieldtog.split(':');
    store.set((s) => {
      const cfg = s.blockCfg[block];
      cfg.hidden = el.checked ? cfg.hidden.filter((k) => k !== key) : [...cfg.hidden, key];
    });
  }
});

$('#rail-body').addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const g = toggle.closest('.group');
    const open = g.dataset.open !== 'true';
    g.dataset.open = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    store.set((s) => { s.ui.open[toggle.dataset.toggle] = open; });
    return;
  }

  const preset = e.target.closest('[data-preset]');
  if (preset) {
    const name = preset.dataset.preset;
    store.set((s) => {
      if (name === 'Current') {
        Object.assign(s.metrics, METRICS);
        Object.assign(s.light, LIGHT);
        Object.assign(s.dark, DARK);
      } else {
        const p = PRESETS[name];
        if (p.metrics) Object.assign(s.metrics, p.metrics);
        if (p.light) Object.assign(s.light, p.light);
        if (p.dark) Object.assign(s.dark, p.dark);
      }
    });
    toast(`Applied “${name}”`);
    return;
  }

  if (e.target.id === 'btn-add-tab') { store.addTab(); return; }
  if (e.target.id === 'btn-add-card') {
    canvas.selectCard(store.addCard(store.get().ui.activeTab));
    render();
    return;
  }
  if (e.target.id === 'btn-del-card' && canvas.selectedCard) {
    store.removeCard(canvas.selectedCard);
    canvas.selectCard(null);
    render();
    toast('Card deleted — its blocks are in the tray');
  }
});

/* ------------------------------------------------------------- toolbar */

for (const m of MODES) {
  $(`#mode-${m}`).addEventListener('click', () => store.setUi({ mode: m }));
}
$('#seg-width').addEventListener('click', (e) => {
  const b = e.target.closest('[data-width]');
  if (b) store.setUi({ width: Number(b.dataset.width) });
});
$('#scheme-light').addEventListener('click', () => store.setUi({ scheme: 'light' }));
$('#scheme-dark').addEventListener('click', () => store.setUi({ scheme: 'dark' }));

$('#sheet').addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tabid]');
  if (tab) store.setUi({ activeTab: tab.dataset.tabid });
});

$('#btn-reset').addEventListener('click', () => {
  store.reset();
  canvas.selectCard(null);
  canvas.pickBlock(null);
  render();
  toast('Reset to the stylesheet on disk');
});

/* -------------------------------------------------------------- export */

$('#btn-export').addEventListener('click', () => {
  exporter.render($('#export-body'));
  $('#overlay').dataset.open = 'true';
});
const closeExport = () => { $('#overlay').dataset.open = 'false'; };
$('#btn-close').addEventListener('click', closeExport);
$('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closeExport(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeExport(); });

$('#btn-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#out-tokens').textContent);
    toast('Tokens copied');
  } catch (err) {
    toast('Copy blocked — select the text instead');
  }
});

$('#btn-save').addEventListener('click', async () => {
  try {
    await exporter.saveToStylesheet(toast);
  } catch (err) {
    // AbortError just means the picker was dismissed; that is not worth a message.
    if (err && err.name !== 'AbortError') toast(err.message);
  }
});

/* --------------------------------------------------------------- startup */

/**
 * Read the app's real style.css and adopt its palette as the baseline, so
 * "Reset to current" means what is on disk rather than a snapshot that rots.
 * Failing is fine — the bundled fallback values are the same file's values as of
 * the day this was written, and the banner says so.
 */
async function adoptRealStylesheet(hadSession) {
  try {
    const css = await exporter.loadStylesheet();
    const { light, dark } = parseRoot(css, SWATCH_ORDER);
    const metrics = {};
    const radius = parsePx(css, 'radius');
    const tap = parsePx(css, 'tap');
    if (radius !== null) metrics.radius = radius;
    if (tap !== null) metrics.tap = tap;

    const found = Object.keys(light).length;
    if (!found) throw new Error('no :root variables found');

    // Only overwrite live values on a first run. Coming back to a saved session
    // and having the tuning silently reset would be worse than a stale baseline.
    store.adoptBaseline({ light, dark, metrics }, { overwrite: !hadSession });
    $('#source').textContent = `baseline: style.css (${found} tokens)`;
    $('#source').dataset.ok = 'true';
  } catch (err) {
    $('#source').textContent = 'baseline: bundled fallback — style.css not readable';
    $('#source').dataset.ok = 'false';
  }
}

window.addEventListener('pagehide', () => store.flush());

(async function boot() {
  const hadSession = store.init();
  render();
  await adoptRealStylesheet(hadSession);
  render();
})();
