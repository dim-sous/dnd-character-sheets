/**
 * Wiring: DOM events in, state mutations out, renders back.
 *
 * There is no per-field event handler anywhere. Two delegated listeners read
 * data-bind / data-toggle / data-action attributes, so adding a field to index.html
 * needs no JavaScript at all.
 */

import * as rules from './rules.js';
import * as state from './state.js';
import { STORAGE_KEY } from './constants.js';
import { exportToFile, readImportFile, exportRaw } from './storage.js';
import {
  shouldRemindBackup, shouldSuggestInstall, loadNudgeState,
  recordFirstSeen, recordBackup, snoozeBackup, snoozeInstall,
} from './nudges.js';
import {
  renderRoster, renderSheet, renderDerived, renderSlotPips, toggleCardEdit,
  invalidateRoster, setSaved, showBanner, clearBanner, showNotice, showNudge,
  clearNudge, showUpdatePrompt, showRecovery, activateTab, reactivateTab, clearCardEdits,
} from './render.js';
import {
  loadLayout, applyLayout, getLayout, getTabIds, flushLayout,
  toggleArrange, isArranging, reorderCard, sendCardToTab, resetLayout, saveDefault,
  tabAdd, tabRemove, tabRename, tabMove, reorderObject, toggleObject, resizeObject,
  renameCardTitle, renameObjectLabel,
} from './layout-view.js';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------ the loop */

function render(type) {
  const char = state.getActive();
  if (type === 'structural') {
    invalidateRoster();
    renderSheet(char);
  } else {
    // 'slots' rebuilds the pip rows only — never the total input being typed into.
    if (type === 'slots' && char) renderSlotPips(char);
    renderDerived(char);
  }
  renderRoster(state.getCharacters(), state.getActiveId());
}

/* --------------------------------------------------------- field input */

function coerce(el) {
  switch (el.dataset.type) {
    case 'checkbox':
      return el.checked;
    case 'number': {
      const n = Number(el.value);
      return el.value.trim() === '' || !Number.isFinite(n) ? 0 : n;
    }
    case 'nullable-number': {
      if (el.value.trim() === '') return null;
      const n = Number(el.value);
      return Number.isFinite(n) ? n : null;
    }
    default:
      return el.value;
  }
}

function applyField(el) {
  if (el.dataset.toggle) {
    state.toggleInArray(el.dataset.toggle, el.dataset.value, el.checked);
    return;
  }
  if (!el.dataset.bind) return;

  let type = 'derived';
  if (el.dataset.structural === 'true') type = 'structural';
  else if (el.dataset.slots === 'true') type = 'slots';

  state.updateActive(el.dataset.bind, coerce(el), type);
}

// Live fields update as you type. Structural ones (they change how much DOM exists)
// wait for `change` — rebuilding mid-keystroke would throw the caret away.
document.addEventListener('input', (event) => {
  const el = event.target;
  if (!el.dataset || el.dataset.structural === 'true') return;
  applyField(el);
});

document.addEventListener('change', (event) => {
  const el = event.target;
  if (!el.dataset || el.dataset.structural !== 'true') return;
  applyField(el);
});

// Cross-tab card move (#54): the arrange-mode "Move to…" select. A <select> fires `change`,
// not click, so it can't ride the delegated ACTIONS map. The view stays on the current tab
// (the card just leaves it); sendCardToTab announces the destination and re-homes focus.
document.addEventListener('change', (event) => {
  const sel = event.target.closest && event.target.closest('.card__movetab');
  if (!sel || !sel.value) return;
  const id = cardIdOf(sel);
  const dest = sel.value;
  sel.value = ''; // snap back to the "Move to…" placeholder
  if (id) sendCardToTab(id, dest);
});

// Tab rename (#54): the tab-list rename field commits on `change` (blur/Enter). Reflect the
// final label back — a blank entry reverts to the current name.
document.addEventListener('change', (event) => {
  const input = event.target.closest && event.target.closest('.tabrow__name');
  if (!input) return;
  const tabId = tabIdOf(input);
  if (!tabId) return;
  tabRename(tabId, input.value);
  reactivateTab();
  const tab = getLayout().tabs.find((t) => t.id === tabId);
  if (tab) input.value = tab.label;
});

// Card rename (#54): the arrange-mode title field commits on `change` (blur/Enter). renameCardTitle
// re-applies the layout (repainting the title) and refreshes the field — a blank reverts to the
// registry default.
document.addEventListener('change', (event) => {
  const input = event.target.closest && event.target.closest('.card__rename');
  if (!input) return;
  const id = cardIdOf(input);
  if (id) renameCardTitle(id, input.value);
});

// Object (tile) rename (#54): the arrange-mode label field on each object commits on `change`.
document.addEventListener('change', (event) => {
  const input = event.target.closest && event.target.closest('.obj-rename');
  if (!input) return;
  const cardId = cardIdOf(input);
  const objectId = objIdOf(input);
  if (cardId && objectId) renameObjectLabel(cardId, objectId, input.value);
});

/* -------------------------------------------------------------- actions */

/** Clicking pip i fills through i; clicking the last filled pip clears it. */
function pipTarget(current, index) {
  return current === index + 1 ? index : index + 1;
}

/** The componentId of the card an arrange control lives in (its `data-editcard`). */
function cardIdOf(el) {
  return el.closest('[data-editcard]')?.dataset.editcard;
}

/** The tab id a tab-list control belongs to (its row's `data-tab`). */
function tabIdOf(el) {
  return el.closest('.tabrow')?.dataset.tab;
}

/** The object id an object control lives in (its `data-object`). */
function objIdOf(el) {
  return el.closest('[data-object]')?.dataset.object;
}

function amountField() {
  const el = $('#f-hp-amount');
  const n = Number(el.value);
  // Round the scratch amount so the Damage/Heal buttons emit whole HP (a decimal like 3.5
  // would otherwise leave fractional HP). Direct edits to the HP fields stay free-form.
  return { el, value: Number.isFinite(n) ? Math.round(Math.abs(n)) : 0 };
}

/**
 * iOS Safari and Firefox do NOT blur a focused <input> when you tap a <button>, so a
 * tapped-into HP field stays document.activeElement — and renderDerived deliberately skips
 * writing back the active element to protect the caret while typing. Net effect there: tap
 * into an HP field, then tap +/-/Damage/Heal, and the number on screen stays STALE (Chromium
 * blurs on tap, so it's already fine). Release the field first so the write-back repaints it.
 * Scoped to the hp.* display inputs; a no-op when nothing (or the Amount scratch field) is
 * focused. Typing is untouched — it never reaches these handlers.
 */
function blurActiveHpField() {
  const el = document.activeElement;
  if (el?.dataset?.bind?.startsWith('hp.')) el.blur();
}

function adjustHp(delta) {
  const char = state.getActive();
  if (!char) return;
  blurActiveHpField();
  const next = char.hp.current + delta;
  const max = char.hp.max;
  state.updateActive('hp.current', Math.max(0, max > 0 ? Math.min(max, next) : next));
}

const ACTIONS = {
  'hp-inc': () => adjustHp(1),
  'hp-dec': () => adjustHp(-1),

  damage: () => {
    const char = state.getActive();
    const { el, value } = amountField();
    if (!char || value === 0) return;
    blurActiveHpField();
    state.updateActive('hp', rules.applyDamage(char.hp, value));
    el.value = '';
  },

  heal: () => {
    const char = state.getActive();
    const { el, value } = amountField();
    if (!char || value === 0) return;
    blurActiveHpField();
    state.updateActive('hp', rules.applyHealing(char.hp, value));
    el.value = '';
  },

  'death-save': (el) => {
    const char = state.getActive();
    if (!char) return;
    const { kind } = el.dataset;
    const index = Number(el.dataset.index);
    state.updateActive(`deathSaves.${kind}`, pipTarget(char.deathSaves[kind], index));
  },

  exhaustion: (el) => {
    const char = state.getActive();
    if (!char) return;
    state.updateActive('exhaustion', pipTarget(char.exhaustion, Number(el.dataset.index)));
  },

  'slot-pip': (el) => {
    const char = state.getActive();
    if (!char) return;
    const level = el.dataset.level;
    const slot = char.spellcasting.slots[level];
    // Pips show REMAINING slots (#9), so the tap maps through remaining and back:
    // same fill-through-i helper as every other pip row, applied to the inverse.
    const next = pipTarget(slot.total - slot.used, Number(el.dataset.index));
    state.setSlotsUsed(level, slot.total - next);
  },

  'toggle-card-edit': (el) => {
    const char = state.getActive();
    if (char) toggleCardEdit(char, el.dataset.card);
  },

  // Layout arrange mode (#54): a display preference under its own key, distinct from the
  // per-card CONTENT edit above. Entering it drops any open content edit so they never overlap.
  'arrange-toggle': () => {
    if (toggleArrange()) clearCardEdits(state.getActive());
  },
  'move-card-up': (el) => reorderCard(cardIdOf(el), -1),
  'move-card-down': (el) => reorderCard(cardIdOf(el), 1),

  // Object controls (#54 Phase 5): reorder/hide the tiles & status blocks within a card.
  'move-object-up': (el) => reorderObject(cardIdOf(el), objIdOf(el), -1),
  'move-object-down': (el) => reorderObject(cardIdOf(el), objIdOf(el), 1),
  'resize-object': (el) => resizeObject(cardIdOf(el), objIdOf(el)),
  'toggle-object-hide': (el) => toggleObject(cardIdOf(el), objIdOf(el)),

  'arrange-reset': () => { resetLayout(); activateTab(getTabIds()[0]); },
  'arrange-set-default': () => saveDefault(),

  // Tab CRUD (#54 Phase 4b). Each tab-set change re-applies the active tab (which tolerates
  // the active one having been removed). Removing a non-empty tab confirms first.
  'tab-add': () => { tabAdd(); reactivateTab(); },
  'tab-up': (el) => { tabMove(tabIdOf(el), -1); reactivateTab(); },
  'tab-down': (el) => { tabMove(tabIdOf(el), 1); reactivateTab(); },
  'tab-remove': (el) => {
    const tabId = tabIdOf(el);
    const layout = getLayout();
    const tab = layout.tabs.find((t) => t.id === tabId);
    if (!tab || layout.tabs.length <= 1) return; // last tab can't go (button is disabled too)
    if (tab.cards.length) {
      const dest = layout.tabs.find((t) => t.id !== tabId);
      const n = tab.cards.length;
      const ok = confirm(
        `Remove the “${tab.label}” tab? Its ${n} card${n === 1 ? '' : 's'} will move to “${dest.label}”.`,
      );
      if (!ok) return;
    }
    tabRemove(tabId);
    reactivateTab();
  },

  'reload-app': () => window.location.reload(),

  // Data-durability nudges (#32). Each handler dismisses only its OWN banner —
  // clearNudge is kind-guarded, so it can never wipe the update prompt (#33).
  'nudge-backup-export': () => {
    const characters = state.getCharacters();
    if (!characters.length) {
      // The roster was emptied after the nudge appeared — say so, exactly like
      // the Export button would, instead of silently pretending a file was saved.
      clearNudge('backup');
      showNotice('Nothing to export yet.');
      return;
    }
    state.flush();
    exportToFile(characters);
    recordBackup();
    clearNudge('backup');
  },
  'nudge-backup-later': () => {
    snoozeBackup();
    clearNudge('backup');
  },
  'nudge-install-dismiss': () => {
    snoozeInstall();
    clearNudge('install');
  },
  'long-rest': () => {
    // Destructive now that it touches HP and death saves — a mis-tap shouldn't wipe
    // what you were tracking, so gate it behind a confirm.
    const ok = confirm(
      'Take a long rest? Restores HP to max, recovers all your Hit Point Dice, reduces '
      + 'exhaustion by 1, clears temp HP and death saves, and resets spell slots.',
    );
    if (ok) state.longRest();
  },
  'add-row': (el) => state.addRow(el.dataset.list),
  'remove-row': (el) => state.removeRow(el.dataset.list, Number(el.dataset.index)),

  'download-corrupt': () => exportRaw(state.getCorruptRaw()),
  'start-fresh': () => { state.startFresh(); clearBanner('recovery'); },
};

document.addEventListener('click', (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (actionEl) {
    const handler = ACTIONS[actionEl.dataset.action];
    if (handler) handler(actionEl);
    return;
  }

  const tabBtn = event.target.closest('[role="tab"]');
  if (tabBtn) {
    activateTab(tabBtn.id.replace('tab-', ''));
    return;
  }

  const rosterBtn = event.target.closest('.roster__btn');
  if (rosterBtn) {
    state.setActive(rosterBtn.dataset.id);
    closeDrawer();
  }
});

/* Roving-tabindex arrow navigation across the tab bar, per the ARIA tabs pattern.
   The order comes from the layout config (getTabIds), and the list is rebuilt from the
   visible tabs each press, so a hidden Spells tab is skipped automatically. */
document.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;

  const tabs = getTabIds()
    .map((key) => document.getElementById(`tab-${key}`))
    .filter((el) => el && !el.hidden);
  const i = tabs.indexOf(tab);
  if (i === -1) return;

  let next = null;
  switch (event.key) {
    case 'ArrowRight': case 'ArrowDown': next = tabs[(i + 1) % tabs.length]; break;
    case 'ArrowLeft': case 'ArrowUp': next = tabs[(i - 1 + tabs.length) % tabs.length]; break;
    case 'Home': next = tabs[0]; break;
    case 'End': next = tabs[tabs.length - 1]; break;
    default: return;
  }
  event.preventDefault();
  activateTab(next.id.replace('tab-', ''), { focus: true });
});

/* Arrange mode (#54): Escape leaves it (but not mid-edit in a field); arrow keys reorder
   while a card's ↑/↓ BUTTON is focused (the buttons already move on Enter/Space — this is a
   keyboard nicety). Scoped to the buttons, never the "Move to…" select, whose own arrow-key
   option navigation must not be hijacked. */
document.addEventListener('keydown', (event) => {
  const inField = event.target.closest && event.target.closest('input, select, textarea');
  if (event.key === 'Escape' && isArranging() && !inField) { toggleArrange(); return; }
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const action = event.target.dataset && event.target.dataset.action;
  const delta = event.key === 'ArrowUp' ? -1 : 1;
  if (action === 'move-card-up' || action === 'move-card-down') {
    const id = cardIdOf(event.target);
    if (id) { event.preventDefault(); reorderCard(id, delta); }
  } else if (action === 'move-object-up' || action === 'move-object-down') {
    const cardId = cardIdOf(event.target);
    const objectId = objIdOf(event.target);
    if (cardId && objectId) { event.preventDefault(); reorderObject(cardId, objectId, delta); }
  }
});

/* ----------------------------------------------------- roster and files */

$('#btn-add').addEventListener('click', () => { state.createCharacter(); closeDrawer(); });
$('#btn-add-empty').addEventListener('click', () => state.createCharacter());

$('#btn-duplicate').addEventListener('click', () => {
  const char = state.getActive();
  if (char) state.createCharacter(char.id);
  closeDrawer();
});

$('#btn-delete').addEventListener('click', () => {
  const char = state.getActive();
  if (!char) return;
  const name = char.name || 'this unnamed character';
  if (confirm(`Delete ${name}? This cannot be undone.`)) state.deleteCharacter(char.id);
});

$('#btn-export').addEventListener('click', () => {
  const characters = state.getCharacters();
  if (characters.length === 0) {
    showNotice('Nothing to export yet.');
    return;
  }
  state.flush();
  exportToFile(characters);
  recordBackup(); // every export resets the backup-reminder clock (#32)
  clearNudge('backup'); // the reminder is satisfied; a pending update prompt is not touched
});

const fileInput = $('#file-import');
$('#btn-import').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = ''; // so re-picking the same file fires change again
  if (!file) return;

  try {
    const incoming = await readImportFile(file);
    const choice = await askImport(incoming.length, state.getCharacters().length);
    if (choice === 'replace') state.replaceAll(incoming);
    else if (choice === 'merge') state.merge(incoming);
    if (choice !== 'cancel') clearBanner('import');
  } catch (err) {
    showBanner(err.message, 'import');
  }
});

function askImport(incomingCount, existingCount) {
  const dialog = $('#import-dialog');
  $('#import-summary').textContent =
    `This file holds ${incomingCount} character${incomingCount === 1 ? '' : 's'}. `
    + `You currently have ${existingCount}.`;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue || 'cancel'), { once: true });
  });
}

/* ------------------------------------------------------- mobile drawer */

const scrim = $('#scrim');
const sidebar = $('#sidebar');
const mainEl = $('.main');
// Below this width the sidebar is an off-canvas drawer; at/above it, a permanent column.
const wide = window.matchMedia('(min-width: 900px)');
let focusBeforeDrawer = null;

/**
 * Keep the accessibility tree honest about what is actually reachable:
 *  - permanent-column layout (wide): nothing is inert.
 *  - closed drawer: the off-canvas sidebar is inert, so Tab can't land on controls that
 *    are slid out of sight behind the sheet.
 *  - open drawer: the sheet behind the scrim is inert, so focus stays trapped in the drawer.
 */
function syncInert() {
  if (wide.matches) {
    sidebar.inert = false;
    mainEl.inert = false;
    return;
  }
  const open = document.body.classList.contains('drawer-open');
  sidebar.inert = !open;
  mainEl.inert = open;
}

function openDrawer() {
  if (wide.matches) return; // nothing to open — the sidebar is always visible
  focusBeforeDrawer = document.activeElement;
  document.body.classList.add('drawer-open');
  scrim.hidden = false;
  syncInert();
  $('#btn-menu-close').focus();
}

function closeDrawer() {
  const wasOpen = document.body.classList.contains('drawer-open');
  document.body.classList.remove('drawer-open');
  scrim.hidden = true;
  syncInert();
  // Hand focus back to whatever opened the drawer (the menu button), never to <body>.
  if (wasOpen && !wide.matches && focusBeforeDrawer?.isConnected) focusBeforeDrawer.focus();
  focusBeforeDrawer = null;
}

$('#btn-menu').addEventListener('click', openDrawer);
$('#btn-menu-close').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
});

// Crossing the breakpoint (rotate/resize) must not strand a half-open drawer or a stray
// inert flag — recompute from scratch.
wide.addEventListener('change', () => {
  if (wide.matches) { document.body.classList.remove('drawer-open'); scrim.hidden = true; }
  syncInert();
});

// A phone starts with the closed drawer inert.
syncInert();

/* -------------------------------------------------------------- startup */

state.subscribe(render);
// Show every save state, including 'Saving…'. A stuck 'Saving…' is the signal that writes
// are failing (private mode / full storage), so it must not be hidden behind an empty string.
state.onStatus((message, tone) => setSaved(message, tone));

// Build the sheet from the saved layout (#54) BEFORE the first render: load the per-device
// layout, then relocate the existing card nodes into their tabs. renderSheet's tab sync
// then reads the same config via getTabIds(). Phase 1 reproduces today exactly.
loadLayout();
applyLayout();

const startup = state.init();
render('structural');
setSaved('', 'idle');

if (startup.corrupt) {
  // Unreadable data — offer to download it before anything can overwrite it.
  showRecovery();
} else if (startup.staleApp) {
  // A backup saved by a newer build. It still loads, but this build may not show every field
  // and would drop the ones it doesn't know about on the next save — so warn before an edit.
  showBanner(
    'These characters were saved by a newer version of this app. Some details may be hidden, '
    + 'and editing here could drop them — reload to update the app before making changes.',
    'stale',
  );
} else if (startup.error) {
  showBanner(startup.error);
} else if (!startup.writable) {
  showBanner('This browser is not saving changes (private mode or full storage). Export a backup to keep your work.');
}

// Phones kill tabs without warning; pagehide is the reliable last call. Flush the layout on
// its own key alongside the character store (both have independent debounced writes).
window.addEventListener('pagehide', () => { state.flush(); flushLayout(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { state.flush(); flushLayout(); }
});

// Another tab saved the roster: adopt it when we have nothing unsaved, so open tabs
// converge instead of the last one to write clobbering the rest.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) state.reloadFromStorage();
});

// Ask the browser to keep our localStorage from being evicted under storage pressure.
// Best-effort: Chromium/Firefox may grant it based on engagement; older Safari lacks the
// API entirely (there the real protection is a Home-Screen install, which the README nudges),
// and a denial is fine — Export stays the durable backup. Feature-detected, never throws.
if (navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}

// Data-durability nudges (#32): at most ONE per visit, decided at startup, only
// when there are characters to lose. The iOS install nudge wins — installing is
// the fix for the eviction the backup reminder merely mitigates. The decisions
// are pure functions covered by tests.js; this block only gathers their inputs.
{
  const now = Date.now();
  recordFirstSeen(now); // BEFORE loadNudgeState, so a re-stamped firstSeenAt is seen this visit
  const meta = loadNudgeState();
  const hasCharacters = state.getCharacters().length > 0;
  // iPadOS reports itself as MacIntel; the touch-point check catches it anyway.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = navigator.standalone === true
    || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  if (shouldSuggestInstall(meta, now, isIOS, isStandalone, hasCharacters)) {
    // Careful, learned the hard way in review: an installed Home-Screen app gets its
    // OWN storage container — installing does NOT carry this tab's characters over.
    // The honest instruction is backup → install → import, in that order.
    showNudge(
      'install',
      'iOS can delete a browser tab’s saved characters after a week unused. For safe '
      + 'keeping: download a backup, add this page to your Home Screen (in Safari: '
      + 'Share → Add to Home Screen), then import the backup there — the installed '
      + 'app starts empty.',
      [
        { action: 'nudge-backup-export', label: 'Download backup' },
        { action: 'nudge-install-dismiss', label: 'Got it' },
      ],
    );
  } else if (shouldRemindBackup(meta, now, hasCharacters)) {
    showNudge(
      'backup',
      'It’s been a while since your last backup — download a copy of your characters.',
      [
        { action: 'nudge-backup-export', label: 'Download backup' },
        { action: 'nudge-backup-later', label: 'Later' },
      ],
    );
  }
}

// navigator.serviceWorker is undefined on an insecure origin, so this stays inert over a
// plain http:// LAN address.
//
// It is NOT inert on localhost. Browsers treat localhost as a secure context precisely so
// service workers can be developed without TLS, so Live Server gets a worker too — and the
// repo copy of service-worker.js is deliberately never stamped, leaving its cache version
// pinned at 'v1' forever. A cache-first worker whose version never moves will serve your
// own edits back to you stale, which looks exactly like a change that did not work.
//
// So the worker is off locally by default. Append ?sw=1 to exercise offline behaviour.
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '[::1]'];
const TEARDOWN_FLAG = 'dnd-sw-torn-down';

/**
 * Undo a worker installed by an earlier version of this file.
 *
 * Not calling register() is not enough on its own: an already-installed worker keeps
 * controlling the page, so this code never gets a say and the stale cache survives. The
 * fix has to actively remove it, or it appears to do nothing on exactly the machine that
 * needs fixing.
 */
function removeWorker() {
  const hadController = Boolean(navigator.serviceWorker.controller);

  if (!hadController) {
    // Nothing is controlling this page, so whatever happened last time worked. Drop the
    // flag rather than leaving it to trigger a spurious warning later in the session.
    sessionStorage.removeItem(TEARDOWN_FLAG);
  } else if (sessionStorage.getItem(TEARDOWN_FLAG)) {
    // Second pass through here and a worker is *still* in charge: the teardown did not
    // take. The tempting move is to reload again, which loops, or to give up quietly,
    // which leaves you debugging stale files without knowing it. Say so instead.
    showBanner(
      'A service worker is still controlling this page on localhost, so you may be '
      + 'seeing cached files instead of your edits. Clear site data (DevTools → '
      + 'Application → Storage) and reload.',
    );
    return;
  }

  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((reg) => reg.unregister())))
    .then((results) => {
      // unregister() resolves false when it declined to do anything. Ignoring that is
      // how a teardown reports success while changing nothing.
      if (results.includes(false)) throw new Error('the browser declined to unregister a worker');
      return caches.keys();
    })
    .then((names) => Promise.all(
      names
        .filter((name) => name.startsWith('dnd-sheets-'))
        .map((name) => caches.delete(name)),
    ))
    .then(() => {
      // This very page was served by the old worker, so what is on screen may already be
      // stale. One reload lands on the network; the flag turns a second pass into the
      // warning above rather than another reload.
      if (hadController) {
        sessionStorage.setItem(TEARDOWN_FLAG, '1');
        window.location.reload();
      }
    })
    .catch((error) => {
      showBanner(
        `Could not remove the local service worker: ${error.message}. `
        + 'Your edits may be served from a stale cache.',
      );
    });
}

function registerWorker() {
  navigator.serviceWorker.register('./service-worker.js').then((registration) => {
    // An installed PWA is never really "opened", so it can sit on a stale build for
    // days: the browser only re-checks the worker script when it happens to. Coming
    // back to the app is the natural moment to look, and it costs one request.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update();
    });

    registration.addEventListener('updatefound', () => {
      const incoming = registration.installing;
      if (!incoming) return;
      incoming.addEventListener('statechange', () => {
        // A controller only exists if a previous worker was already running, which
        // is what distinguishes "there is a newer build" from "this is a first
        // visit and the very first worker just installed". Announcing the latter
        // would tell a new player to reload the page they just opened.
        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdatePrompt();
        }
      });
    });
  }).catch(() => {
    /* offline support is a bonus; the app works without it */
  });
}

if ('serviceWorker' in navigator) {
  const isLocalHost = LOCAL_HOSTNAMES.includes(window.location.hostname);
  const workerRequested = new URLSearchParams(window.location.search).has('sw');

  if (isLocalHost && !workerRequested) {
    removeWorker();
  } else {
    window.addEventListener('load', registerWorker);
  }
}
