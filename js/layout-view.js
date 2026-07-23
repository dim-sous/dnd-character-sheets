/**
 * The runtime seam between the pure layout config (js/layout.js) and the live DOM.
 *
 * Browser-only — it touches localStorage and the document, so tests never import it (the
 * pure half they cover lives in js/layout.js). Kept deliberately off state.js's save loop:
 * a layout is a per-device display preference under its OWN key, and a broken character
 * store must not freeze layout edits, or vice-versa.
 */

import {
  DEFAULT_LAYOUT, normalizeLayout, moveCard, moveCardToTab, renameCard,
  addTab, removeTab, renameTab, moveTab, moveObject, toggleObjectHidden,
  setObjectSpan, cycleSpan, renameObject,
} from './layout.js';
import { CARD_REGISTRY, OBJECT_REGISTRY } from './layout-registry.js';
import { newId } from './constants.js';

const LAYOUT_KEY = 'dnd-character-sheets:layout';
// A per-device "saved default" the player sets from their current arrangement; Reset restores
// this if present, else the factory DEFAULT_LAYOUT.
const LAYOUT_DEFAULT_KEY = 'dnd-character-sheets:layout-default';

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

/** An object's span expressed as a `grid-column` value. Config owns object width now (#54
 *  Phase 6), so it is written inline on every object — beating the static `.tiles` rules — and
 *  span `1` becomes explicit `auto` so a shrunk full-width object drops back to one track. */
function spanToGridColumn(span) {
  if (span === 'full') return '1 / -1';
  if (span === 2) return 'span 2';
  return 'auto';
}

/**
 * Order a card's objects within their grid container and apply each one's hidden state and span
 * (#54 Phase 5/6). Relocation by identity, like cards: a hidden object keeps its render.js host
 * in the DOM (present-but-hidden), so nothing dereferences null. Width is written inline so the
 * layout config is the single source of truth for it. No-op for a card without objects.
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
    objNode.style.gridColumn = spanToGridColumn(obj.span); // config-owned width (#54 Phase 6)
    // Config-owned title (#54): write to EVERY label node so multi-label objects (Conditions
    // has a visually-hidden heading + a visible summary title) rename together. Default = the
    // registry label, which matches the static markup, so it's a no-op.
    const reg = OBJECT_REGISTRY[obj.componentId];
    const label = obj.label || (reg && reg.label) || obj.componentId;
    for (const node of objNode.querySelectorAll('.tile__label, .subhead')) node.textContent = label;
    const isHidden = Boolean(obj.hidden);
    objNode.classList.toggle('is-hidden', isHidden);
    // The real display:none only OUTSIDE arrange mode; while arranging a hidden object stays
    // visible (dimmed via .is-hidden) so it can be unhidden.
    objNode.hidden = isHidden && !arranging;
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
      if (node) {
        const title = node.querySelector('.card__title');
        if (title) title.textContent = card.label || reg.label; // config-owned title (#54)
        panel.append(node);
        applyObjects(node, card);
      }
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

    // Editable card title (#54): an input that stands in for the (CSS-hidden) .card__title while
    // arranging. Prefilled with the current display title (custom override or registry default);
    // never clobbered while the player is typing in it.
    const cfg = currentLayout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === id);
    const displayTitle = (cfg && cfg.label) || label;
    let rename = head.querySelector('.card__rename');
    if (!rename) {
      rename = document.createElement('input');
      rename.type = 'text';
      rename.className = 'card__rename';
      head.insertBefore(rename, head.firstChild); // sits where the title is
    }
    rename.setAttribute('aria-label', `Rename ${displayTitle} card`);
    if (document.activeElement !== rename) rename.value = displayTitle;

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
  for (const input of document.querySelectorAll('.card__rename')) input.remove();
}

/**
 * Commit a card-title edit (#54): store the new label (blank reverts to the registry default),
 * persist, and re-apply so the title paints everywhere. Refresh the controls so the field
 * reflects the stored value (e.g. a blanked entry snapping back to the default).
 */
export function renameCardTitle(componentId, label) {
  currentLayout = renameCard(currentLayout, componentId, label);
  saveLayout();
  applyLayout();
  renderArrangeControls();
  announce('Card renamed.');
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

/** Snapshot the current arrangement as the player's saved default (own key). */
export function saveDefault() {
  try {
    localStorage.setItem(LAYOUT_DEFAULT_KEY, JSON.stringify(currentLayout));
  } catch {
    // best-effort; a layout is reconstructible so a private-mode failure is silent
  }
  announce('Current layout saved as your default.');
}

/** Reset to the saved default if the player set one, else the factory default. */
export function resetLayout() {
  let raw = null;
  try {
    const text = localStorage.getItem(LAYOUT_DEFAULT_KEY);
    if (text) raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  currentLayout = normalizeLayout(raw); // saved default if any, else a fresh factory default
  saveLayout();
  applyLayout();
  if (arranging) { renderArrangeControls(); renderObjectControls(); renderTabList(); }
  announce('Layout reset to your default.');
}

/* --------------------------------------------------- object arrange controls */

function objButton(action, glyph) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn';
  btn.dataset.action = action;
  btn.textContent = glyph;
  return btn;
}

/** Where an object sits within its card: index, count, its hidden flag, and its span. */
function objectPosition(cardId, objectId) {
  const card = currentLayout.tabs.flatMap((t) => t.cards).find((c) => c.componentId === cardId);
  if (!card || !card.objects) return null;
  const i = card.objects.findIndex((o) => o.componentId === objectId);
  if (i === -1) return null;
  const obj = card.objects[i];
  return {
    index: i, count: card.objects.length, hidden: obj.hidden, span: obj.span, label: obj.label,
  };
}

/** Human-readable width, for the resize control's label + the announcement. */
function spanLabel(span) {
  if (span === 'full') return 'full width';
  if (span === 2) return 'double width';
  return 'normal width';
}

/**
 * Inject (or refresh) each object's arrange controls: ↑/↓ reorder within the card + a
 * hide/show toggle. Reuses an existing cluster so focus survives a refresh. Only registered
 * objects (Phase 5: the Combat card's tiles + status blocks) get controls.
 */
function renderObjectControls() {
  for (const objNode of document.querySelectorAll('[data-object]')) {
    const objectId = objNode.dataset.object;
    const reg = OBJECT_REGISTRY[objectId];
    if (!reg) continue;
    const pos = objectPosition(reg.card, objectId);
    if (!pos) continue;

    // Editable object title (#54): an opaque field overlaying the object's top; the static label
    // text sits hidden beneath it (CSS), so you always see the name of what you're arranging.
    let rename = objNode.querySelector('.obj-rename');
    if (!rename) {
      rename = document.createElement('input');
      rename.type = 'text';
      rename.className = 'obj-rename';
      objNode.append(rename); // absolutely positioned, so DOM order doesn't matter
    }
    rename.setAttribute('aria-label', `Rename ${reg.label} tile`);
    if (document.activeElement !== rename) rename.value = pos.label || reg.label;

    let ctl = objNode.querySelector('.obj-ctl');
    if (!ctl) {
      ctl = document.createElement('div');
      ctl.className = 'obj-ctl';
      ctl.append(
        objButton('move-object-up', '↑'),
        objButton('move-object-down', '↓'),
        objButton('resize-object', '↔'),
        objButton('toggle-object-hide', '👁'),
      );
      objNode.append(ctl);
    }
    const [up, down, resize, hide] = ctl.querySelectorAll('button');
    up.setAttribute('aria-label', `Move ${reg.label} up`);
    down.setAttribute('aria-label', `Move ${reg.label} down`);
    up.disabled = pos.index === 0;
    down.disabled = pos.index === pos.count - 1;
    resize.setAttribute('aria-label', `Resize ${reg.label} (${spanLabel(pos.span)})`);
    hide.setAttribute('aria-label', pos.hidden ? `Show ${reg.label}` : `Hide ${reg.label}`);
    hide.setAttribute('aria-pressed', String(pos.hidden));
    hide.classList.toggle('is-off', pos.hidden);
  }
}

function removeObjectControls() {
  for (const ctl of document.querySelectorAll('.obj-ctl')) ctl.remove();
  for (const input of document.querySelectorAll('.obj-rename')) input.remove();
}

/**
 * Commit an object-title edit (#54): store the new label (blank reverts to the registry label),
 * persist, re-apply (repaints every label node), and refresh the controls so the field reflects
 * the stored value.
 */
export function renameObjectLabel(cardId, objectId, label) {
  currentLayout = renameObject(currentLayout, cardId, objectId, label);
  saveLayout();
  applyLayout();
  renderObjectControls();
  announce('Tile renamed.');
}

/** Move an object up/down within its card; persist, re-apply, keep focus. */
export function reorderObject(cardId, objectId, delta) {
  const pos = objectPosition(cardId, objectId);
  if (!pos) return;
  const target = pos.index + delta;
  if (target < 0 || target >= pos.count) return;
  currentLayout = moveObject(currentLayout, cardId, pos.index, target);
  saveLayout();
  applyLayout();
  renderObjectControls();
  const reg = OBJECT_REGISTRY[objectId];
  const after = objectPosition(cardId, objectId);
  if (after) announce(`Moved ${reg ? reg.label : objectId} to position ${after.index + 1} of ${after.count}.`);
  const group = document.querySelector(`[data-object="${objectId}"] .obj-ctl`);
  if (group) {
    const [up, down] = group.querySelectorAll('button');
    const wanted = delta < 0 ? up : down;
    const t = wanted && !wanted.disabled ? wanted : (delta < 0 ? down : up);
    if (t && !t.disabled) t.focus();
  }
}

/** Cycle an object's width (1 → 2 → full → 1); persist, re-apply, refresh, announce, keep focus. */
export function resizeObject(cardId, objectId) {
  const pos = objectPosition(cardId, objectId);
  if (!pos) return;
  const next = cycleSpan(pos.span);
  currentLayout = setObjectSpan(currentLayout, cardId, objectId, next);
  saveLayout();
  applyLayout();
  renderObjectControls();
  const reg = OBJECT_REGISTRY[objectId];
  announce(`${reg ? reg.label : objectId} set to ${spanLabel(next)}.`);
  document.querySelector(`[data-object="${objectId}"] .obj-ctl button[data-action="resize-object"]`)?.focus();
}

/** Hide or show an object; persist, re-apply, refresh, announce. */
export function toggleObject(cardId, objectId) {
  currentLayout = toggleObjectHidden(currentLayout, cardId, objectId);
  saveLayout();
  applyLayout();
  renderObjectControls();
  const reg = OBJECT_REGISTRY[objectId];
  const pos = objectPosition(cardId, objectId);
  announce(`${reg ? reg.label : objectId} ${pos && pos.hidden ? 'hidden' : 'shown'}.`);
  document.querySelector(`[data-object="${objectId}"] .obj-ctl button[data-action="toggle-object-hide"]`)?.focus();
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
    applyLayout(); // re-hide any hidden objects (display:none again outside arrange)
    removeArrangeControls();
    removeObjectControls();
    clearTabList();
    const btn = document.getElementById('btn-arrange');
    if (btn) btn.focus(); // Done/exit — never strand focus on a now-hidden bar
    return false;
  }
  setArranging(true);
  applyLayout(); // reveal hidden objects (dimmed) so they can be unhidden
  renderArrangeControls();
  renderObjectControls();
  renderTabList();
  return true;
}

/** Force arrange mode off (e.g. on a character switch). Idempotent. */
export function exitArrange() {
  if (!arranging) return;
  setArranging(false);
  applyLayout();
  removeArrangeControls();
  removeObjectControls();
  clearTabList();
}
