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
  renderRoster, renderSheet, renderDerived, renderSlotPips,
  invalidateRoster, setSaved, showBanner, showUpdatePrompt, showRecovery, activateTab,
} from './render.js';

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

/* -------------------------------------------------------------- actions */

/** Clicking pip i fills through i; clicking the last filled pip clears it. */
function pipTarget(current, index) {
  return current === index + 1 ? index : index + 1;
}

function amountField() {
  const el = $('#f-hp-amount');
  const n = Number(el.value);
  return { el, value: Number.isFinite(n) ? Math.abs(n) : 0 };
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
    state.setSlotsUsed(level, pipTarget(char.spellcasting.slots[level].used, Number(el.dataset.index)));
  },

  'reload-app': () => window.location.reload(),
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
  'start-fresh': () => { state.startFresh(); showBanner(''); },
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
   The list is rebuilt from the visible tabs each press, so a hidden Spells tab is
   skipped automatically. */
const TAB_ORDER = ['combat', 'abilities', 'spells', 'gear', 'character'];
document.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (!tab) return;

  const tabs = TAB_ORDER
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
    showBanner('Nothing to export yet.');
    return;
  }
  state.flush();
  exportToFile(characters);
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
    if (choice !== 'cancel') showBanner('');
  } catch (err) {
    showBanner(err.message);
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

const startup = state.init();
render('structural');
setSaved('', 'idle');

if (startup.corrupt) {
  // Unreadable data — offer to download it before anything can overwrite it.
  showRecovery();
} else if (startup.error) {
  showBanner(startup.error);
} else if (!startup.writable) {
  showBanner('This browser is not saving changes (private mode or full storage). Export a backup to keep your work.');
}

// Phones kill tabs without warning; pagehide is the reliable last call.
window.addEventListener('pagehide', () => state.flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') state.flush();
});

// Another tab saved the roster: adopt it when we have nothing unsaved, so open tabs
// converge instead of the last one to write clobbering the rest.
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) state.reloadFromStorage();
});

// navigator.serviceWorker is undefined on an insecure origin, so this is automatically
// inert over a plain http:// LAN address and active on HTTPS. One build, both paths.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
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
  });
}
