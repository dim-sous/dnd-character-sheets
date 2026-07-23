/**
 * The runtime seam between the pure layout config (js/layout.js) and the live DOM.
 *
 * Browser-only — it touches localStorage and the document, so tests never import it (the
 * pure half they cover lives in js/layout.js). Kept deliberately off state.js's save loop:
 * a layout is a per-device display preference under its OWN key, and a broken character
 * store must not freeze layout edits, or vice-versa.
 */

import {
  DEFAULT_LAYOUT, normalizeLayout, moveCard, moveCardToTab,
  addTab, removeTab, renameTab, moveTab,
} from './layout.js';
import { CARD_REGISTRY } from './layout-registry.js';
import { newId } from './constants.js';

const LAYOUT_KEY = 'dnd-character-sheets:layout';

// The active layout. Starts at the default so getTabIds() is safe the moment any module
// reads it (render.js resolves its first active tab from it at import time); loadLayout()
// swaps in the stored, normalized layout at bootstrap.
let currentLayout = DEFAULT_LAYOUT;

/**
 * Read the per-device layout from its own key and normalize it. A layout is fully
 * reconstructible, so ANY failure — absent, unparseable, private-mode throw — silently
 * falls back to the default (no recovery banner, unlike character data). In Phase 1 there
 * is no writer yet, so the key is empty and this always yields the default; Phase 2 adds
 * the debounced save.
 */
export function loadLayout() {
  let raw = null;
  try {
    const text = localStorage.getItem(LAYOUT_KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  currentLayout = normalizeLayout(raw);
  return currentLayout;
}

/** The live, already-normalized layout object. */
export function getLayout() {
  return currentLayout;
}

/**
 * Ordered tab ids. Replaces the hardcoded TAB_KEYS/TAB_ORDER in render.js/main.js so the
 * tab set has a single source of truth (the config), ready for tab CRUD in a later phase.
 */
export function getTabIds() {
  return currentLayout.tabs.map((tab) => tab.id);
}

/**
 * Build the sheet from the config by RELOCATING the existing live card nodes into their
 * tab panels, in order — never regenerating markup. Moving a node preserves its identity,
 * so every render.js host (#abilities, #slots, #spell-body, …) stays alive and the data
 * layer never learns the layout changed. In Phase 1 the config equals today's arrangement,
 * so every append is a no-op reposition; the point is to exercise the real relocation path
 * end to end. Panels and tab buttons stay static in index.html for now — generating them
 * is a later phase; this only orders the cards within each existing panel.
 */
/** The tab-button node for a tab id, created (with full ARIA) if it doesn't exist yet. */
function ensureTabButton(id, label) {
  let btn = document.getElementById(`tab-${id}`);
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab';
    btn.id = `tab-${id}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `panel-${id}`);
    btn.setAttribute('aria-selected', 'false');
    btn.tabIndex = -1;
  }
  btn.textContent = label; // relabel on rename (no-op for a default tab)
  return btn;
}

/** The panel node for a tab id, created (hidden, with full ARIA) if it doesn't exist yet. */
function ensurePanel(id) {
  let panel = document.getElementById(`panel-${id}`);
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'tabpanel';
    panel.id = `panel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-${id}`);
    panel.tabIndex = 0;
    panel.hidden = true;
  }
  return panel;
}

/**
 * Order a card's objects within their grid container and apply each one's hidden state (#54
 * Phase 5). Relocation by identity, like cards: a hidden object keeps its render.js host in the
 * DOM (present-but-hidden), so nothing dereferences null. No-op for a card without objects.
 */
function applyObjects(cardNode, card) {
  if (!card.objects || !card.objects.length) return;
  const first = cardNode.querySelector('[data-object]');
  const container = first && first.parentElement; // the .tiles grid holding the objects
  if (!container) return;
  for (const obj of card.objects) {
    const objNode = cardNode.querySelector(`[data-object="${obj.componentId}"]`);
    if (!objNode) continue;
    container.append(objNode); // reorder into config order
    objNode.hidden = Boolean(obj.hidden);
  }
}

/**
 * Build the sheet from the config by RELOCATING existing live nodes — never regenerating
 * markup — so every render.js host stays alive by identity and the data layer never learns.
 *
 * Reconciles the tab set too (#54 Tab CRUD): ensure a button + panel per config tab (create
 * missing ones with the `#tab-<id>`/`#panel-<id>` convention the nav relies on), order both
 * by append, relabel; relocate each tab's cards into its panel; then drop the button + panel
 * of any tab no longer in the config (a removed tab's cards were re-homed by the loop above,
 * so its panel is already empty). On the default layout every step is a no-op reposition.
 */
export function applyLayout() {
  const tabbar = document.getElementById('tabbar');
  const cardsWrap = document.querySelector('.cards');
  const liveIds = new Set(currentLayout.tabs.map((t) => t.id));

  for (const tab of currentLayout.tabs) {
    const btn = ensureTabButton(tab.id, tab.label);
    const panel = ensurePanel(tab.id);
    if (tabbar) tabbar.append(btn); // append = create-or-reorder into config order
    if (cardsWrap) cardsWrap.append(panel);
    for (const card of tab.cards) {
      const reg = CARD_REGISTRY[card.componentId];
      const node = reg && document.querySelector(reg.sel);
      if (node) { panel.append(node); applyObjects(node, card); }
    }
  }

  // Reap the chrome of removed tabs (never a `cost:'js'` host — the cards moved out above).
  if (tabbar) {
    for (const btn of [...tabbar.querySelectorAll('.tab')]) {
      if (!liveIds.has(btn.id.replace('tab-', ''))) btn.remove();
    }
  }
  if (cardsWrap) {
    for (const panel of [...cardsWrap.querySelectorAll('.tabpanel')]) {
      if (!liveIds.has(panel.id.replace('panel-', ''))) panel.remove();
    }
  }
}

/* ----------------------------------------------------------- persistence */

let saveTimer = null;
let dirty = false;

function writeLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(currentLayout));
    dirty = false;
  } catch {
    // Private mode / full storage. A layout is reconstructible from the default, so unlike
    // character data this fails silently — no banner, no write-refusal.
  }
}

/** Debounced write, mirroring state.js's scheduleSave — its OWN timer and key. */
function saveLayout() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; if (dirty) writeLayout(); }, 400);
}

/** Synchronous write for pagehide/visibilitychange — only if there is something unsaved. */
export function flushLayout() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (dirty) writeLayout();
}

/* ---------------------------------------------------------- arrange mode */

// Transient display mode (never persisted): reorder cards within a tab. The layout RESULT
// persists (own key); the mode itself does not.
let arranging = false;

export function isArranging() {
  return arranging;
}

/** Where a card sits: its tab id, index within that tab, and the tab's card count. */
function cardPosition(componentId) {
  for (const tab of currentLayout.tabs) {
    const index = tab.cards.findIndex((c) => c.componentId === componentId);
    if (index !== -1) return { tabId: tab.id, index, count: tab.cards.length };
  }
  return null;
}

function moveButton(action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.dataset.action = action;
  btn.textContent = action === 'move-card-up' ? '↑' : '↓';
  return btn;
}

/**
 * (Re)populate a card's "Move to…" select with the CURRENT tab set. Called on every render,
 * so it never goes stale after a tab is added, removed, renamed, or reordered (#54 Phase 4).
 * Choosing the card's own tab is a no-op (sendCardToTab guards it), so no per-card pruning.
 */
function fillTabOptions(sel, label) {
  sel.replaceChildren();
  sel.setAttribute('aria-label', `Move ${label} to another tab`);
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Move to…';
  placeholder.disabled = true;
  placeholder.selected = true;
  sel.append(placeholder);
  for (const tab of currentLayout.tabs) {
    const opt = document.createElement('option');
    opt.value = tab.id;
    opt.textContent = tab.label;
    sel.append(opt);
  }
}

/**
 * Inject (or refresh) each card's arrange controls into its `.list__head`: ↑/↓ reorder plus a
 * "Move to…" cross-tab select. Reuses an existing group so a control's identity — and the
 * focus on it — survives a refresh. Disables the first card's ↑ and the last card's ↓ (also
 * signals the bounds; a lone card disables both).
 */
function renderArrangeControls() {
  for (const card of document.querySelectorAll('[data-editcard]')) {
    const id = card.dataset.editcard;
    const pos = cardPosition(id);
    const head = card.querySelector('.list__head');
    if (!pos || !head) continue;
    const label = (CARD_REGISTRY[id] && CARD_REGISTRY[id].label) || id;

    let group = head.querySelector('.card__move');
    if (!group) {
      group = document.createElement('div');
      group.className = 'card__move';
      const sel = document.createElement('select');
      sel.className = 'card__movetab';
      group.append(moveButton('move-card-up'), moveButton('move-card-down'), sel);
      head.append(group);
    }
    const [up, down] = group.querySelectorAll('button');
    up.setAttribute('aria-label', `Move ${label} up`);
    down.setAttribute('aria-label', `Move ${label} down`);
    up.disabled = pos.index === 0;
    down.disabled = pos.index === pos.count - 1;
    fillTabOptions(group.querySelector('.card__movetab'), label); // always fresh (never stale)
  }
}

function removeArrangeControls() {
  for (const group of document.querySelectorAll('.card__move')) group.remove();
}

function announce(message) {
  const status = document.getElementById('arrange-status');
  if (status) status.textContent = message;
}

/**
 * After a reorder the used button may have become disabled (the card reached an end), which
 * drops focus to <body>. Put it on the used button, or its still-enabled sibling.
 */
function restoreMoveFocus(componentId, delta) {
  const card = document.querySelector(`[data-editcard="${componentId}"]`);
  const group = card && card.querySelector('.card__move');
  if (!group) return;
  const [up, down] = group.querySelectorAll('button');
  const wanted = delta < 0 ? up : down;
  const target = wanted && !wanted.disabled ? wanted : (delta < 0 ? down : up);
  if (target && !target.disabled) target.focus();
}

/** Move a card up (delta -1) or down (delta +1) within its tab; persist and re-lay-out. */
export function reorderCard(componentId, delta) {
  const pos = cardPosition(componentId);
  if (!pos) return;
  const target = pos.index + delta;
  if (target < 0 || target >= pos.count) return; // at an end — nothing to do

  currentLayout = moveCard(currentLayout, pos.tabId, pos.index, target);
  saveLayout();
  applyLayout(); // relocates the card node; focus inside it is preserved by append
  renderArrangeControls();
  const after = cardPosition(componentId);
  const label = (CARD_REGISTRY[componentId] && CARD_REGISTRY[componentId].label) || componentId;
  if (after) announce(`Moved ${label} to position ${after.index + 1} of ${after.count}.`);
  restoreMoveFocus(componentId, delta);
}

/**
 * The card left the current tab, so its own control is gone from view. Keep focus in place:
 * land on the card that slid into the vacated slot (or the new last card), else — the tab is
 * now empty — the arrange toolbar's Done.
 */
function restoreFocusAfterLeave(sourceTabId, vacatedIndex) {
  const tab = currentLayout.tabs.find((t) => t.id === sourceTabId);
  const remaining = tab ? tab.cards : [];
  if (remaining.length) {
    const next = remaining[Math.min(vacatedIndex, remaining.length - 1)];
    const card = document.querySelector(`[data-editcard="${next.componentId}"]`);
    const ctrl = card && (card.querySelector('.card__movetab') || card.querySelector('.card__move button'));
    if (ctrl) { ctrl.focus(); return; }
  }
  document.querySelector('#arrange-bar [data-action="arrange-toggle"]')?.focus();
}

/**
 * Send a card to another tab (appended to its end). The view stays on the current tab — the
 * card simply leaves it (the announcement says where it went). Returns the destination tab id,
 * or null when there was nothing to do.
 */
export function sendCardToTab(componentId, toTabId) {
  const pos = cardPosition(componentId);
  if (!pos || pos.tabId === toTabId) return null;
  const { tabId: sourceTabId, index: vacatedIndex } = pos;

  currentLayout = moveCardToTab(currentLayout, componentId, toTabId);
  saveLayout();
  applyLayout(); // relocates the card node into the (currently hidden) destination panel
  renderArrangeControls();
  const label = (CARD_REGISTRY[componentId] && CARD_REGISTRY[componentId].label) || componentId;
  const dest = currentLayout.tabs.find((t) => t.id === toTabId);
  announce(`Moved ${label} to the ${dest ? dest.label : toTabId} tab.`);
  restoreFocusAfterLeave(sourceTabId, vacatedIndex);
  return toTabId;
}

/** Reset the whole layout to its default (correct regardless of any cross-tab moves). */
export function resetLayout() {
  currentLayout = normalizeLayout(null); // a fresh default — never the shared DEFAULT_LAYOUT object
  saveLayout();
  applyLayout();
  if (arranging) { renderArrangeControls(); renderTabList(); }
  announce('Layout reset to its default.');
}

/* ------------------------------------------------------ tab-editing list */

function tabRowButton(action, label, glyph, disabled) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.dataset.action = action;
  btn.textContent = glyph;
  btn.setAttribute('aria-label', label);
  btn.disabled = disabled;
  return btn;
}

/**
 * The dedicated tab-editing list in the arrange bar: one row per tab (rename field + ↑/↓
 * reorder + ✕ remove) and an "Add tab" button. Rebuilt whole on each structural tab change;
 * only lives in the DOM while arranging. The bottom tab bar stays the navigation surface.
 */
function renderTabList() {
  const host = document.getElementById('tablist-edit');
  if (!host) return;
  host.replaceChildren();

  const rows = document.createElement('ul');
  rows.className = 'tablist-edit__rows';
  const { tabs } = currentLayout;
  tabs.forEach((tab, i) => {
    const row = document.createElement('li');
    row.className = 'tabrow';
    row.dataset.tab = tab.id;

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'tabrow__name';
    name.value = tab.label;
    name.setAttribute('aria-label', `Rename ${tab.label} tab`);

    row.append(
      name,
      tabRowButton('tab-up', `Move ${tab.label} tab up`, '↑', i === 0),
      tabRowButton('tab-down', `Move ${tab.label} tab down`, '↓', i === tabs.length - 1),
      tabRowButton('tab-remove', `Remove ${tab.label} tab`, '✕', tabs.length <= 1),
    );
    rows.append(row);
  });
  host.append(rows);

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--small';
  add.dataset.action = 'tab-add';
  add.textContent = '+ Add tab';
  host.append(add);
}

function clearTabList() {
  const host = document.getElementById('tablist-edit');
  if (host) host.replaceChildren();
}

/** Add a new empty tab and focus its rename field so the player can name it right away. */
export function tabAdd() {
  const id = newId();
  currentLayout = addTab(currentLayout, id, 'New tab');
  saveLayout();
  applyLayout();
  renderTabList();
  renderArrangeControls();
  announce('Tab added.');
  document.querySelector(`.tabrow[data-tab="${id}"] .tabrow__name`)?.focus();
}

/** Remove a tab (its cards were re-homed by the pure removeTab); refresh + land focus. */
export function tabRemove(tabId) {
  currentLayout = removeTab(currentLayout, tabId);
  saveLayout();
  applyLayout();
  renderTabList();
  renderArrangeControls();
  announce('Tab removed; its cards moved to the first tab.');
  document.querySelector('#tablist-edit [data-action="tab-add"]')?.focus();
}

/** Rename a tab. Does NOT rebuild the list (keeps the field the user is in); relabels the bar. */
export function tabRename(tabId, label) {
  currentLayout = renameTab(currentLayout, tabId, label);
  saveLayout();
  applyLayout();
  renderArrangeControls(); // the cards' "Move to…" options carry tab labels — keep them fresh
  announce('Tab renamed.');
}

/** Reorder a tab; refresh the list and keep focus on the moved row's control. */
export function tabMove(tabId, delta) {
  currentLayout = moveTab(currentLayout, tabId, delta);
  saveLayout();
  applyLayout();
  renderTabList();
  renderArrangeControls(); // refresh the cards' "Move to…" option order too
  announce('Tab moved.');
  const row = document.querySelector(`.tabrow[data-tab="${tabId}"]`);
  if (row) {
    const btns = [...row.querySelectorAll('button')];
    const want = delta < 0 ? 'tab-up' : 'tab-down';
    const target = btns.find((b) => b.dataset.action === want && !b.disabled) || btns.find((b) => !b.disabled);
    target?.focus();
  }
}

function setArranging(on) {
  arranging = on;
  document.body.classList.toggle('is-arranging', on);
  const btn = document.getElementById('btn-arrange');
  if (btn) btn.setAttribute('aria-pressed', String(on));
}

/** Toggle arrange mode; returns true when it has just turned ON (so the caller can tidy up). */
export function toggleArrange() {
  if (arranging) {
    setArranging(false);
    removeArrangeControls();
    clearTabList();
    const btn = document.getElementById('btn-arrange');
    if (btn) btn.focus(); // Done/exit — never strand focus on a now-hidden bar
    return false;
  }
  setArranging(true);
  renderArrangeControls();
  renderTabList();
  return true;
}

/** Force arrange mode off (e.g. on a character switch). Idempotent. */
export function exitArrange() {
  if (!arranging) return;
  setArranging(false);
  removeArrangeControls();
  clearTabList();
}
