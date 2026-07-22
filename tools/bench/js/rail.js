/**
 * The control rail.
 *
 * One delegated input listener and one delegated click listener for the whole
 * panel — same trick as the app's main.js, so adding a control is markup only.
 */

import { BLOCKS, PRESETS, SWATCH_ORDER } from './constants.js';
import { escapeHtml } from './blocks.js';
import { get } from './state.js';
import { typeScale } from './tokens.js';
import { selectedCard, pickedBlock } from './canvas.js';
import { missingHosts } from './exporter.js';

const SCALE_NAMES = ['xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl'];

function group(id, title, inner) {
  const open = get().ui.open[id] !== false;
  return `<section class="group" data-group="${id}" data-open="${open}">
    <button class="group__head" data-toggle="${id}" aria-expanded="${open}">
      <span class="group__caret">▼</span>${title}</button>
    <div class="group__body">${inner}</div></section>`;
}

function slider(key, label, min, max, step, unit = '') {
  const v = get().metrics[key];
  return `<div class="ctrl">
    <div class="ctrl__top"><label class="ctrl__label" for="c-${key}">${label}</label>
      <span class="ctrl__val" id="v-${key}">${v}${unit}</span></div>
    <input type="range" id="c-${key}" data-metric="${key}"
           min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
}

export function scaleReadout() {
  const m = get().metrics;
  return Object.values(typeScale(m.textBase, m.scale))
    .map((v, i) => `${SCALE_NAMES[i]} ${(parseFloat(v) * 16).toFixed(1)}`).join('  ');
}

/* -------------------------------------------------------------- style ---- */

export function renderStyle(el) {
  const state = get();
  const m = state.metrics;
  const palette = state.ui.scheme === 'dark' ? state.dark : state.light;

  el.innerHTML = [
    group('presets', 'Starting points',
      `<div class="presets">${Object.keys(PRESETS)
        .map((n) => `<button class="preset" data-preset="${n}">${n}</button>`).join('')}</div>`),

    group('type', 'Type', `
      ${slider('textBase', 'Base size', 13, 20, 0.5, 'px')}
      ${slider('scale', 'Scale ratio', 1.05, 1.4, 0.01)}
      <div class="ctrl"><div class="ctrl__top"><span class="ctrl__label">Card titles</span></div>
        <select id="c-titleface">
          <option value="serif"${m.titleface === 'serif' ? ' selected' : ''}>Serif (Iowan / Palatino)</option>
          <option value="sans"${m.titleface === 'sans' ? ' selected' : ''}>Sans (system)</option>
        </select></div>
      <p class="note"><strong>Scale, px:</strong><br><span id="scale-readout">${scaleReadout()}</span></p>`),

    group('space', 'Space', `
      ${slider('space', 'Base unit', 2, 8, 0.5, 'px')}
      ${slider('cardpad', 'Card padding', 6, 28, 0.5, 'px')}
      ${slider('cardgap', 'Gap between cards', 4, 28, 1, 'px')}
      ${slider('tap', 'Touch target', 36, 56, 1, 'px')}
      <p class="note">style.css has no spacing scale — these are hardcoded rem values across
      40-odd rules. The export gives you the tokens to replace them with.</p>`),

    group('shape', 'Shape', `
      ${slider('radius', 'Corner radius', 0, 22, 1, 'px')}
      ${slider('bw', 'Border width', 0, 3, 0.5, 'px')}
      ${slider('shadow', 'Shadow depth', 0, 6, 1)}
      ${slider('tabbar', 'Tab bar height', 44, 76, 1, 'px')}
      ${slider('topbar', 'Top bar height', 44, 76, 1, 'px')}`),

    group('colour', `Colour — ${state.ui.scheme}`, `
      <div class="swatches">${SWATCH_ORDER.map((n) => `
        <div class="sw">
          <label class="sw__chip"><input type="color" data-colour="${n}" value="${palette[n]}" aria-label="${n}"></label>
          <span class="sw__meta"><span class="sw__name">--${n}</span>
            <span class="sw__hex" id="hex-${n}">${palette[n]}</span></span>
        </div>`).join('')}</div>
      <p class="note">Editing the <strong>${state.ui.scheme}</strong> palette. Switch scheme in
      the toolbar for the other; both export together.</p>`),

    group('sample', 'Sample character', `
      ${['name', 'cls', 'subclass', 'level'].map((k) => `
        <div class="ctrl"><div class="ctrl__top"><span class="ctrl__label">${
          { name: 'Name', cls: 'Class', subclass: 'Subclass', level: 'Level' }[k]}</span></div>
          <input class="textin" data-sample="${k}" value="${escapeHtml(state.sample[k])}"></div>`).join('')}
      <p class="note">Preview data only — none of this is exported.</p>`),
  ].join('');
}

/* ---------------------------------------------------------- structure ---- */

export function renderStructure(el) {
  const state = get();
  const orphans = Object.keys(state.cards).filter((id) => !state.tabs.some((t) => t.cards.includes(id)));
  const gone = missingHosts();

  let panel = '<p class="note">Select a card on the canvas to rename it and edit what is inside.</p>';
  if (selectedCard && state.cards[selectedCard]) {
    const card = state.cards[selectedCard];
    panel = `
      <div class="ctrl"><div class="ctrl__top"><span class="ctrl__label">Card title</span></div>
        <input class="textin" data-cardtitle="${selectedCard}"
               value="${escapeHtml(card.title)}" placeholder="(no title)"></div>
      <div class="ctrl"><div class="ctrl__top"><span class="ctrl__label">Columns</span>
        <span class="ctrl__val">${card.cols || 1}</span></div>
        <input type="range" data-cardcols="${selectedCard}" min="1" max="4" step="1" value="${card.cols || 1}"></div>
      ${card.blocks.map((b) => {
        const def = BLOCKS[b];
        const cfg = state.blockCfg[b];
        const fields = def.fields ? `<div class="toggles">
          ${Object.entries(def.fields).map(([k, lbl]) => {
            const off = cfg.hidden.includes(k);
            return `<label class="tog" data-off="${off}">
              <input type="checkbox" data-fieldtog="${b}:${k}" ${off ? '' : 'checked'}>${lbl}</label>`;
          }).join('')}</div>` : '';
        return `<div class="ctrl">
          <div class="ctrl__top"><span class="ctrl__label">${def.label}</span>
            <span class="cost" data-cost="${def.cost}">${def.cost === 'js' ? 'render.js' : 'markup'}</span></div>
          <input class="textin" data-subhead="${b}" value="${escapeHtml(cfg.subhead)}"
                 placeholder="No subhead">${fields}</div>`;
      }).join('')}
      <div class="ctrl"><button class="btn btn--wide btn--quiet" id="btn-del-card">Delete this card</button></div>`;
  }

  el.innerHTML = [
    group('struct-help', 'Rearranging', `
      <p class="note">Drag cards between tabs and up or down within one. Expand a card with ▸ to
      reach its blocks, which drag into any other card. All of this is markup placement in
      <code>index.html</code> — the binding layer finds fields by attribute, not position.</p>
      <div class="btn-pair">
        <button class="btn btn--wide" id="btn-add-tab">Add tab</button>
        <button class="btn btn--wide" id="btn-add-card">Add card</button></div>`),

    group('struct-card', selectedCard && state.cards[selectedCard]
      ? `Card — ${escapeHtml(state.cards[selectedCard].title || 'untitled')}` : 'Selected card', panel),

    group('struct-skills', 'Skills grouping', `
      <label class="tog"><input type="checkbox" id="c-groupSkills"
        ${state.metrics.groupSkills ? 'checked' : ''}>Group skills by ability</label>
      <p class="note note--warn">Not free. This rewrites <code>renderSkills()</code> in
      <code>render.js</code> — the only control in the bench that does. Issue #14.</p>`),

    gone.length ? group('struct-warn', 'Needs a guard', `
      <p class="note note--warn">Removed: ${gone.map((b) => BLOCKS[b].label).join(', ')}.
      <code>render.js</code> looks up ${gone.map((b) => `<code>${BLOCKS[b].host}</code>`).join(', ')}
      and calls <code>replaceChildren()</code> with no null check — it will throw on first
      render. Leave the host in and hide it with CSS, or add a guard.</p>`) : '',

    orphans.length ? group('struct-orphans', 'Cards not on a tab', `
      <p class="note">${orphans.map((c) => escapeHtml(state.cards[c].title || c)).join(', ')} —
      these render nowhere.</p>`) : '',
  ].join('');
}

/* ------------------------------------------------------------ compose ---- */

export function renderCompose(el) {
  const state = get();
  const tab = state.tabs.find((t) => t.id === state.ui.activeTab) || state.tabs[0];
  const here = tab ? tab.cards.filter((c) => state.cards[c]) : [];

  let picked = `<p class="note">Click a block on the canvas to select it. Drag to move,
    drag an edge handle to resize.</p>`;

  if (pickedBlock && state.blockCfg[pickedBlock]) {
    const cfg = state.blockCfg[pickedBlock];
    const owner = Object.entries(state.cards).find(([, c]) => c.blocks.includes(pickedBlock));
    const cols = owner ? Math.max(1, owner[1].cols || 1) : 1;
    picked = `
      <div class="ctrl"><div class="ctrl__top">
        <span class="ctrl__label">${BLOCKS[pickedBlock].label}</span>
        <span class="cost" data-cost="${BLOCKS[pickedBlock].cost}">${BLOCKS[pickedBlock].cost === 'js' ? 'render.js' : 'markup'}</span></div>
        <p class="readout">in “${owner ? escapeHtml(owner[1].title || 'untitled') : '—'}” · ${cols} column${cols === 1 ? '' : 's'}</p></div>
      <div class="ctrl"><div class="ctrl__top"><span class="ctrl__label">Width</span>
        <span class="ctrl__val">${Math.min(cfg.span, cols)} of ${cols}</span></div>
        <input type="range" data-blkspan="span" min="1" max="${cols}" step="1"
               value="${Math.min(cfg.span, cols)}"${cols === 1 ? ' disabled' : ''}></div>
      <div class="ctrl"><div class="ctrl__top"><span class="ctrl__label">Height</span>
        <span class="ctrl__val">${cfg.rowSpan} row${cfg.rowSpan === 1 ? '' : 's'}</span></div>
        <input type="range" data-blkspan="rowSpan" min="1" max="4" step="1" value="${cfg.rowSpan}"></div>
      <div class="ctrl"><div class="ctrl__top"><span class="ctrl__label">Start column</span>
        <span class="ctrl__val">${cfg.col === 0 ? 'auto' : cfg.col}</span></div>
        <input type="range" data-blkspan="col" min="0" max="${cols}" step="1"
               value="${cfg.col}"${cols === 1 ? ' disabled' : ''}></div>
      <p class="note">Auto flows into the next free cell. Pinning a start column is what leaves
      a deliberate gap.</p>`;
  }

  el.innerHTML = [
    group('compose-cards', `Columns — ${tab ? escapeHtml(tab.label) : ''}`,
      here.length ? here.map((cid) => {
        const c = state.cards[cid];
        return `<div class="ctrl"><div class="ctrl__top">
          <span class="ctrl__label">${escapeHtml(c.title || 'untitled')}</span>
          <span class="ctrl__val">${c.cols || 1}</span></div>
          <input type="range" data-cardcols="${cid}" min="1" max="4" step="1" value="${c.cols || 1}"></div>`;
      }).join('') : '<p class="note">This tab has no cards.</p>'),

    group('compose-block', 'Selected block', picked),

    group('compose-note', 'How this exports', `
      <p class="note">Spans become utility classes on the block wrappers, and a
      <code>--cols</code> custom property on the card. No absolute positioning, so it survives
      every width and the print stylesheet.</p>`),
  ].join('');
}
