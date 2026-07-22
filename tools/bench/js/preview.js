/**
 * Turning the bench's state into a sheet.
 *
 * Two modes: plain (the phone frame) and editable (compose, where blocks carry
 * drag and resize chrome). Same markup either way, so what you compose is what
 * you preview.
 */

import { BLOCKS } from './constants.js';
import { BLOCK_HTML, escapeHtml } from './blocks.js';
import { get } from './state.js';
import { applyTokens } from './tokens.js';

/** Grid placement for one block, as an inline style. Empty at one column. */
export function blockStyle(id, cols) {
  const cfg = get().blockCfg[id];
  if (cols <= 1) return '';
  const span = Math.max(1, Math.min(cfg.span, cols));
  const parts = [];
  parts.push(cfg.col > 0 && cfg.col + span - 1 <= cols
    ? `grid-column:${cfg.col}/span ${span}`
    : `grid-column:span ${span}`);
  if (cfg.rowSpan > 1) parts.push(`grid-row:span ${cfg.rowSpan}`);
  return ` style="${parts.join(';')}"`;
}

export function renderBlock(id, cardId, cols, { editing = false, picked = null } = {}) {
  const html = BLOCK_HTML[id] ? BLOCK_HTML[id]() : '';
  if (!html) return '';
  const cfg = get().blockCfg[id];
  const chrome = editing ? `
    <span class="grip">${BLOCKS[id].label}</span>
    <span class="handle handle--e" data-resize="e"></span>
    <span class="handle handle--s" data-resize="s"></span>
    <span class="handle handle--se" data-resize="se"></span>` : '';
  return `<div class="blk${editing && picked === id ? ' is-picked' : ''}"${blockStyle(id, cols)}
      data-blk="${id}" data-incard="${cardId}"${editing ? ' draggable="true"' : ''}>
    ${chrome}${cfg.subhead ? `<h3 class="subhead">${escapeHtml(cfg.subhead)}</h3>` : ''}${html}</div>`;
}

export function renderCard(id, opts = {}) {
  const card = get().cards[id];
  if (!card) return '';
  const cols = Math.max(1, card.cols || 1);
  return `<section class="card${cols > 1 ? ' card--grid' : ''}" data-card="${id}"
      data-cardname="${escapeHtml(card.title || 'untitled')}" style="--cols:${cols}">
    ${card.title ? `<h2 class="card__title">${escapeHtml(card.title)}</h2>` : ''}
    ${card.blocks.map((b) => renderBlock(b, id, cols, opts)).join('')}</section>`;
}

/** The phone-frame preview: topbar, one tab's cards, tab bar. */
export function renderSheet(el) {
  const state = get();
  const wide = state.ui.width >= 900;
  const tab = state.tabs.find((t) => t.id === state.ui.activeTab) || state.tabs[0];
  if (!tab) { el.innerHTML = ''; return; }

  const ids = wide ? state.tabs.flatMap((t) => t.cards) : tab.cards;
  const s = state.sample;
  const sub = [s.cls, s.subclass, s.level ? `Level ${s.level}` : ''].filter(Boolean).join(' · ');

  el.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" tabindex="-1">☰</button>
      <span class="topbar__id">
        <span class="topbar__name">${escapeHtml(s.name)}</span>
        <span class="topbar__sub">${escapeHtml(sub)}</span>
      </span>
      <button class="icon-btn" tabindex="-1">⋯</button>
    </header>
    <div class="cards">${ids.map((c) => renderCard(c)).join('')}</div>
    <nav class="tabbar">${state.tabs.map((t) => `
      <button class="tab" data-tabid="${t.id}" aria-selected="${t.id === tab.id}">
        <span class="tab__glyph">${t.glyph || '○'}</span>
        <span class="tab__label">${escapeHtml(t.label)}</span></button>`).join('')}</nav>`;

  el.dataset.wide = String(wide);
  applyTokens(el, state, state.ui.scheme);
}
