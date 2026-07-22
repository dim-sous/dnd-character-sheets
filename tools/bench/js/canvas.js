/**
 * The two editing canvases.
 *
 * structure — tabs as columns, cards inside them, blocks inside those. Drag to
 *             rearrange at any level.
 * compose   — the rendered sheet itself, with blocks draggable and resizable
 *             against their card's internal grid.
 *
 * Both use HTML5 drag for movement and pointer events for resizing. Drag gives
 * free cross-container movement; pointer capture gives smooth resize without a
 * document-level mousemove listener.
 */

import { BLOCKS } from './constants.js';
import { escapeHtml } from './blocks.js';
import * as store from './state.js';
import { renderCard } from './preview.js';
import { applyTokens } from './tokens.js';

let dragging = null;
let resizing = null;
export let selectedCard = null;
export let pickedBlock = null;

export function selectCard(id) { selectedCard = id; }
export function pickBlock(id) { pickedBlock = id; }

const clearOver = () => document.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));

/** Insertion index for a vertical list, by pointer Y against each item's midpoint. */
function indexAtY(list, y, selector) {
  const items = [...list.querySelectorAll(selector)].filter((el) => !el.classList.contains('is-dragging'));
  for (let i = 0; i < items.length; i += 1) {
    const r = items[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return items.length;
}

/* ========================================================== STRUCTURE ==== */

export function renderStructure(host, onChange) {
  const state = store.get();
  const placed = new Set(Object.values(state.cards).flatMap((c) => c.blocks));
  const tray = Object.keys(BLOCKS).filter((b) => !placed.has(b));

  host.innerHTML = `
    <p class="canvas-hint">Cards drag between tabs and reorder within one. Expand a card with ▸
    to reach its blocks, which drag into any other card. Blocks marked
    <span class="cost" data-cost="markup">md</span> are markup in <code>index.html</code>;
    <span class="cost" data-cost="js">js</span> ones are hosts rendered by
    <code>render.js</code> — moving those is still markup, removing them is not.</p>
    <div class="cols">
      ${state.tabs.map((t) => `
        <div class="col" data-tab="${t.id}">
          <div class="col__head">
            <input class="col__name" value="${escapeHtml(t.label)}" data-rename="${t.id}" aria-label="Tab name">
            <span class="col__count">${t.cards.length}</span>
            ${t.cards.length === 0 && state.tabs.length > 1
              ? `<button class="col__kill" data-killtab="${t.id}" aria-label="Delete tab">✕</button>` : ''}
          </div>
          <ul class="col__list" data-droptab="${t.id}">
            ${t.cards.length === 0 ? '<li class="col__empty">Drop a card here</li>' : ''}
            ${t.cards.map((cid) => {
              const card = state.cards[cid];
              if (!card) return '';
              const open = state.ui.expanded[cid] === true;
              return `<li class="centry${selectedCard === cid ? ' is-selected' : ''}"
                          data-card="${cid}" data-from="${t.id}" data-open="${open}" draggable="true">
                <div class="centry__head" data-select="${cid}">
                  <span class="centry__grip">⠿</span>
                  <span class="centry__name">${escapeHtml(card.title || 'untitled')}</span>
                  <span class="centry__n">${card.blocks.length}${(card.cols || 1) > 1 ? ` · ${card.cols}col` : ''}</span>
                  <button class="centry__exp" data-expand="${cid}" aria-expanded="${open}"
                          aria-label="Show blocks">▶</button>
                </div>
                <ul class="centry__blocks" data-dropcard="${cid}">
                  ${card.blocks.length === 0 ? '<li class="col__empty">Drop a block</li>' : ''}
                  ${card.blocks.map((b) => `
                    <li class="blkchip" data-block="${b}" data-fromcard="${cid}" draggable="true">
                      <span class="blkchip__grip">⠿</span>
                      <span class="blkchip__name">${BLOCKS[b].label}</span>
                      <span class="cost" data-cost="${BLOCKS[b].cost}">${BLOCKS[b].cost === 'js' ? 'js' : 'md'}</span>
                      <button class="blkchip__kill" data-killblock="${b}" aria-label="Remove block">✕</button>
                    </li>`).join('')}
                </ul></li>`;
            }).join('')}
          </ul></div>`).join('')}
    </div>
    <div class="tray" data-droptray="1">
      <div class="tray__title">Tray — blocks not on any card</div>
      ${tray.length ? `<div class="tray__items">${tray.map((b) => `
        <span class="blkchip" data-block="${b}" data-fromcard="" draggable="true">
          <span class="blkchip__grip">⠿</span><span class="blkchip__name">${BLOCKS[b].label}</span>
          <span class="cost" data-cost="${BLOCKS[b].cost}">${BLOCKS[b].cost === 'js' ? 'js' : 'md'}</span>
        </span>`).join('')}</div>`
        : '<span class="tray__empty">Everything is placed.</span>'}
    </div>`;

  wireStructure(host, onChange);
}

function wireStructure(host, onChange) {
  host.querySelectorAll('.centry').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      if (e.target.closest('.blkchip')) return;      // the block's handler wins
      e.stopPropagation();
      dragging = { kind: 'card', id: el.dataset.card, from: el.dataset.from };
      el.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.card); } catch (err) { /* Safari */ }
    });
    el.addEventListener('dragend', () => { el.classList.remove('is-dragging'); clearOver(); dragging = null; });
  });

  host.querySelectorAll('.blkchip[draggable="true"]').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      dragging = { kind: 'block', id: el.dataset.block, from: el.dataset.fromcard };
      el.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.block); } catch (err) { /* Safari */ }
    });
    el.addEventListener('dragend', () => { el.classList.remove('is-dragging'); clearOver(); dragging = null; });
  });

  host.querySelectorAll('[data-droptab]').forEach((list) => {
    list.addEventListener('dragover', (e) => {
      if (!dragging || dragging.kind !== 'card') return;
      e.preventDefault();
      list.closest('.col').classList.add('is-over');
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) list.closest('.col').classList.remove('is-over');
    });
    list.addEventListener('drop', (e) => {
      if (!dragging || dragging.kind !== 'card') return;
      e.preventDefault(); e.stopPropagation();
      store.moveCard(dragging.id, dragging.from, list.dataset.droptab, indexAtY(list, e.clientY, '.centry'));
    });
  });

  host.querySelectorAll('[data-dropcard]').forEach((list) => {
    list.addEventListener('dragover', (e) => {
      if (!dragging || dragging.kind !== 'block') return;
      e.preventDefault(); e.stopPropagation();
      list.classList.add('is-over');
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) list.classList.remove('is-over');
    });
    list.addEventListener('drop', (e) => {
      if (!dragging || dragging.kind !== 'block') return;
      e.preventDefault(); e.stopPropagation();
      store.moveBlock(dragging.id, dragging.from, list.dataset.dropcard, indexAtY(list, e.clientY, '.blkchip'));
    });
  });

  const tray = host.querySelector('[data-droptray]');
  tray.addEventListener('dragover', (e) => {
    if (!dragging || dragging.kind !== 'block') return;
    e.preventDefault(); tray.classList.add('is-over');
  });
  tray.addEventListener('dragleave', () => tray.classList.remove('is-over'));
  tray.addEventListener('drop', (e) => {
    if (!dragging || dragging.kind !== 'block') return;
    e.preventDefault();
    store.moveBlock(dragging.id, dragging.from, null, 0);
  });

  host.querySelectorAll('[data-select]').forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-expand]')) return;
    selectedCard = el.dataset.select;
    onChange();
  }));

  host.querySelectorAll('[data-expand]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = el.dataset.expand;
    store.set((s) => { s.ui.expanded[id] = !s.ui.expanded[id]; });
  }));

  host.querySelectorAll('[data-rename]').forEach((el) => el.addEventListener('input', () => {
    store.set((s) => {
      const tab = s.tabs.find((t) => t.id === el.dataset.rename);
      if (tab) tab.label = el.value;
    });
  }));

  host.querySelectorAll('[data-killtab]').forEach((el) =>
    el.addEventListener('click', () => store.removeTab(el.dataset.killtab)));

  host.querySelectorAll('[data-killblock]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const li = el.closest('.blkchip');
    store.moveBlock(li.dataset.block, li.dataset.fromcard, null, 0);
  }));
}

/* ============================================================ COMPOSE ==== */

export function renderCompose(host, onChange) {
  const state = store.get();
  const tab = state.tabs.find((t) => t.id === state.ui.activeTab) || state.tabs[0];
  const w = state.ui.width;

  host.innerHTML = `
    <p class="canvas-hint">Drag a block to move it — a dashed slot shows where it lands, and it
    can cross into another card. Drag the right edge to widen, the bottom edge to make it taller.
    Give a card more columns in the rail first; at one column there is nowhere to move sideways.</p>
    <div class="composebar">
      <span class="composebar__label">Tab</span>
      <div class="seg" id="compose-tabs">
        ${state.tabs.map((t) => `<button data-ctab="${t.id}"
          aria-pressed="${Boolean(tab) && t.id === tab.id}">${escapeHtml(t.label)}</button>`).join('')}
      </div>
      <span class="readout">editing at ${w}px</span>
    </div>
    <div class="canvas">
      <div class="canvas__page" style="width:${w}px">
        <div class="sheet sheet--edit" id="edit-sheet" data-wide="${w >= 900}">
          <div class="cards">${(tab ? tab.cards : [])
            .map((c) => renderCard(c, { editing: true, picked: pickedBlock })).join('')}</div>
        </div>
      </div>
    </div>`;

  const sheet = host.querySelector('#edit-sheet');
  applyTokens(sheet, state, state.ui.scheme);
  wireCompose(sheet, host, onChange);
}

function wireCompose(sheet, host, onChange) {
  host.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => {
    pickedBlock = null;
    store.setUi({ activeTab: b.dataset.ctab });
  }));

  sheet.querySelectorAll('.blk').forEach((blk) => {
    blk.addEventListener('click', (e) => {
      if (e.target.closest('[data-resize]')) return;
      pickedBlock = blk.dataset.blk;
      onChange();
    });

    blk.addEventListener('dragstart', (e) => {
      if (resizing) { e.preventDefault(); return; }
      dragging = { kind: 'compose', id: blk.dataset.blk, from: blk.dataset.incard };
      blk.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', blk.dataset.blk); } catch (err) { /* Safari */ }
    });
    blk.addEventListener('dragend', () => {
      blk.classList.remove('is-dragging');
      sheet.querySelectorAll('.dropslot').forEach((s) => s.remove());
      dragging = null;
    });

    blk.querySelectorAll('[data-resize]').forEach((handle) => {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const card = blk.closest('.card');
        const state = store.get();
        const cols = Math.max(1, state.cards[card.dataset.card].cols || 1);
        const cfg = state.blockCfg[blk.dataset.blk];
        resizing = {
          id: blk.dataset.blk, axis: handle.dataset.resize, cols,
          cellW: card.getBoundingClientRect().width / cols,
          startX: e.clientX, startY: e.clientY,
          span0: Math.min(cfg.span, cols), row0: cfg.rowSpan,
        };
        handle.setPointerCapture(e.pointerId);
      });

      handle.addEventListener('pointermove', (e) => {
        if (!resizing) return;
        const cfg = store.get().blockCfg[resizing.id];
        let dirty = false;
        if (resizing.axis !== 's') {
          const next = Math.max(1, Math.min(resizing.cols,
            resizing.span0 + Math.round((e.clientX - resizing.startX) / resizing.cellW)));
          if (next !== cfg.span) { cfg.span = next; dirty = true; }
        }
        if (resizing.axis !== 'e') {
          const next = Math.max(1, Math.min(4,
            resizing.row0 + Math.round((e.clientY - resizing.startY) / 90)));
          if (next !== cfg.rowSpan) { cfg.rowSpan = next; dirty = true; }
        }
        // Paint straight onto the node during the drag. Re-rendering mid-gesture
        // would replace the element the pointer is captured on and drop the drag.
        if (dirty) applyLiveSpan(blk, cfg, resizing.cols);
      });

      const stop = () => {
        if (!resizing) return;
        resizing = null;
        store.set(() => {});           // commit and notify
      };
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
  });

  sheet.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('dragover', (e) => {
      if (!dragging || dragging.kind !== 'compose') return;
      e.preventDefault();
      showSlot(card, e.clientX, e.clientY);
    });
    card.addEventListener('drop', (e) => {
      if (!dragging || dragging.kind !== 'compose') return;
      e.preventDefault();
      store.moveBlock(dragging.id, dragging.from, card.dataset.card, slotIndex(card, e.clientX, e.clientY));
    });
  });
}

function applyLiveSpan(blk, cfg, cols) {
  const span = Math.max(1, Math.min(cfg.span, cols));
  blk.style.gridColumn = cfg.col > 0 && cfg.col + span - 1 <= cols
    ? `${cfg.col}/span ${span}` : `span ${span}`;
  blk.style.gridRow = cfg.rowSpan > 1 ? `span ${cfg.rowSpan}` : '';
}

/** Where a dropped block lands: by row first, then by column within that row. */
function slotIndex(card, x, y) {
  const blocks = [...card.querySelectorAll('.blk')].filter((b) => !b.classList.contains('is-dragging'));
  for (let i = 0; i < blocks.length; i += 1) {
    const r = blocks[i].getBoundingClientRect();
    if (y < r.top + r.height / 2 || (y < r.bottom && x < r.left + r.width / 2)) return i;
  }
  return blocks.length;
}

function showSlot(card, x, y) {
  const sheet = card.closest('.sheet');
  sheet.querySelectorAll('.dropslot').forEach((s) => s.remove());
  const slot = document.createElement('div');
  slot.className = 'dropslot';
  const blocks = [...card.querySelectorAll('.blk')].filter((b) => !b.classList.contains('is-dragging'));
  const at = slotIndex(card, x, y);
  if (at >= blocks.length) card.append(slot);
  else card.insertBefore(slot, blocks[at]);
}
