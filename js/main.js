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
import { exportToFile, exportCharacterToFile, readImportFile, exportRaw } from './storage.js';
import {
  shouldRemindBackup, shouldSuggestInstall, loadNudgeState,
  recordFirstSeen, recordBackup, snoozeBackup, snoozeInstall,
} from './nudges.js';
import {
  renderRoster, renderSheet, renderDerived, renderSlotPips, toggleCardEdit,
  invalidateRoster, setSaved, showBanner, clearBanner, showNotice, showNudge,
  clearNudge, showUpdatePrompt, showRecovery, activateTab, reactivateTab, clearCardEdits,
  announcePlay,
} from './render.js';
import {
  loadLayout, applyLayout, getLayout, getTabIds, flushLayout,
  toggleArrange, isArranging, reorderCard, sendCardToTab, resetLayout, saveDefault,
  tabAdd, tabRemove, tabRename, tabMove, toggleObject, resizeObject, resizeObjectHeight, endResize,
  renameCardTitle, renameObjectLabel, dropCard, dropObject,
  selectObject, getSelectedObject,
  startPlacing, cancelPlacing, placeObject, isPlacing, undoLayout,
} from './layout-view.js';

const $ = (sel) => document.querySelector(sel);

/* -------------------------------------------------- unexpected failures */

/**
 * Say something when the app breaks (#122).
 *
 * There is no build step, no telemetry and no error reporting here, so before this an
 * exception escaping a render left the sheet half-painted and silent: stale readouts, a row
 * that didn't appear, and nothing on screen to say so. The player's only clue was that the
 * numbers looked wrong, which on a character sheet is indistinguishable from having typed
 * the wrong number.
 *
 * Registered before anything else in this module so it is already listening while the rest
 * of the file wires itself up. It cannot catch a failure to *load* the modules — by then
 * this file has not run — but that case is a blank page rather than a plausible-looking
 * wrong one, and the blank page is at least honest.
 *
 * Once per page load. A render that throws usually throws again on the next keystroke, and
 * a banner that rewrites itself on every letter is worse than no banner.
 */
let reportedFailure = false;
function reportUnexpectedFailure(detail) {
  // eslint-disable-next-line no-console -- the only channel a player can quote back to us
  if (typeof console !== 'undefined') console.error('[character sheets] unexpected failure:', detail);
  if (reportedFailure) return;
  reportedFailure = true;
  try {
    showBanner(
      'Something went wrong, and part of the sheet may not have updated. Your characters are '
      + 'still saved — export a backup from the menu, then reload the page.',
      'crash',
    );
  } catch {
    // The banner is the thing that broke. There is nowhere left to report to, and throwing
    // from inside the error handler would only recurse.
  }
}

window.addEventListener('error', (event) => {
  // A failed <img>/<link> fetch fires 'error' here too, retargeted to the element rather
  // than the window. A missing icon is not a crash and must not raise the banner.
  if (event.target && event.target !== window && event.target.nodeType === 1) return;
  reportUnexpectedFailure(event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => reportUnexpectedFailure(event.reason));

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


// Current HP (#65/#74): the sole HP-change control now that the steppers and Damage/Heal
// buttons are gone. A bare number sets current HP; a signed value adjusts it — "-8" damages
// (through temp first), "+5" heals (capped at max) — via the pure rules.applyHpInput. Then
// repaint the field to the resulting absolute value (renderDerived skips the active element,
// so an Enter that keeps focus wouldn't otherwise show the result).
function commitHpCurrent(el) {
  const char = state.getActive();
  if (!char) return;
  const before = char.hp;
  const raw = el.value; // captured BEFORE the repaint below overwrites what was typed
  const hp = rules.applyHpInput(before, raw);
  state.updateActive('hp', hp);
  el.value = String(hp.current);
  reportHp(before, hp, raw);
}

/**
 * Say what actually happened — once, to both audiences (#74, extending #100).
 *
 * The sentence itself is `rules.describeHpChange`, a pure function, so the wording is under test
 * and the two audiences can never drift apart. #100 gave screen-reader users the spoken result;
 * the visible line is the parity, because the field's two contracts were previously stated only
 * in a `title` tooltip that a touch device never shows.
 *
 * An empty sentence means there was nothing to report (a blank entry, a blurred untouched field)
 * — clear the line and stay silent rather than announcing emptiness.
 */
function reportHp(before, after, raw) {
  const sentence = rules.describeHpChange(before, after, raw);
  if (sentence) announcePlay(sentence);
}

document.addEventListener('keydown', (event) => {
  const el = event.target;
  if (event.key !== 'Enter' || !el.dataset?.hpCurrent) return;
  event.preventDefault();
  // Commit in place and KEEP focus (#100). Blurring used to BE the commit, which stranded
  // focus on <body> and made the next Tab restart from the top of the document. Selecting the
  // result means the next entry overwrites it rather than appending to it. A `change` still
  // fires on the eventual real blur; re-committing the absolute value already in the field is
  // a no-op, and reportHp stays silent because nothing moved.
  commitHpCurrent(el);
  el.select();
});

// Cross-tab card move (#54): the arrange-mode "Send to tab…" select. A <select> fires `change`,
// not click, so it can't ride the delegated ACTIONS map. The view stays on the current tab
// (the card just leaves it); sendCardToTab announces the destination and re-homes focus.
function commitCardMoveTab(sel) {
  if (!sel.value) return;
  const id = cardIdOf(sel);
  const dest = sel.value;
  sel.value = ''; // snap back to the "Send to tab…" placeholder
  if (id) sendCardToTab(id, dest);
}

// Tab rename (#54): the tab-list rename field commits on `change` (blur/Enter). Reflect the
// final label back — a blank entry reverts to the current name.
function commitTabRename(input) {
  const tabId = tabIdOf(input);
  if (!tabId) return;
  tabRename(tabId, input.value);
  reactivateTab();
  const tab = getLayout().tabs.find((t) => t.id === tabId);
  if (tab) input.value = tab.label;
}

// Card rename (#54): the arrange-mode title field commits on `change` (blur/Enter). renameCardTitle
// re-applies the layout (repainting the title) and refreshes the field — a blank reverts to the
// registry default.
function commitCardRename(input) {
  const id = cardIdOf(input);
  if (id) renameCardTitle(id, input.value);
}

// Object (tile) rename (#54): the field lives in the arrange bar now (#72), so it names the
// SELECTED object rather than the one it sits inside. Commits on `change` (blur/Enter).
function commitObjectRename(input) {
  const sel = getSelectedObject();
  if (sel) renameObjectLabel(sel.cardId, sel.objectId, input.value);
}

/* -------------------------------------------------------------- actions */

/** Clicking pip i fills through i; clicking the last filled pip clears it. */
function pipTarget(current, index) {
  return current === index + 1 ? index : index + 1;
}

/**
 * The componentId of the card an arrange control lives in. Object controls now sit in the
 * arrange BAR rather than inside the tile (#72), so they have no card ancestor to read —
 * they fall back to the current selection. Card controls are still inside their card, so the
 * fallback never fires for them.
 */
function cardIdOf(el) {
  return el.closest('[data-editcard]')?.dataset.editcard ?? getSelectedObject()?.cardId;
}

/** The tab id a tab-list control belongs to (its row's `data-tab`). */
function tabIdOf(el) {
  return el.closest('.tabrow')?.dataset.tab;
}

/** The object id an object control lives in (its `data-object`). */
function objIdOf(el) {
  return el.closest('[data-object]')?.dataset.object ?? getSelectedObject()?.objectId;
}

const ACTIONS = {
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
    // Flush a half-typed field into the character BEFORE the mode goes up, for the same reason
    // the roster switch does (#94): once arranging, a `change` from inside a tile is ignored on
    // purpose, so an uncommitted HP edit sitting in a still-focused field would be dropped rather
    // than saved. A desktop blurs on the button's own mousedown; iOS does not.
    document.activeElement?.blur?.();
    if (toggleArrange()) clearCardEdits(state.getActive());
  },
  'move-card-up': (el) => reorderCard(cardIdOf(el), -1),
  'move-card-down': (el) => reorderCard(cardIdOf(el), 1),

  // Object controls (#54 Phase 5): resize/hide the tiles & status blocks within a card. The
  // ↑/↓ nudge is gone — "Move to…" below replaced it (#73). The two resize entries are ranges,
  // so they arrive through the `input` listener below rather than by click.
  'resize-object': (el) => resizeObject(cardIdOf(el), objIdOf(el), el.value),
  'resize-object-height': (el) => resizeObjectHeight(cardIdOf(el), objIdOf(el), el.value),
  'toggle-object-hide': (el) => toggleObject(cardIdOf(el), objIdOf(el)),

  // "Pick it up, tap where it goes" (#73): the touch reorder path, so a move costs two taps
  // instead of one per slot travelled.
  'place-object-start': () => startPlacing(),
  'place-object-cancel': () => cancelPlacing(),
  'place-object': (el) => placeObject(Number(el.dataset.gap)),

  'layout-undo': () => { undoLayout(); reactivateTab(); },
  'arrange-reset': () => { resetLayout(); activateTab(getTabIds()[0]); },
  // Clears the saved default as well as restoring the shipped layout, so a bad "Set as
  // default" can no longer lock the player out of the original arrangement (#73). Confirmed
  // because it discards something they deliberately saved — undo can't bring that key back.
  'arrange-reset-factory': () => {
    const ok = confirm('Reset to the original layout? This also clears the default you saved.');
    if (!ok) return;
    resetLayout({ factory: true });
    activateTab(getTabIds()[0]);
  },
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
  'long-rest': (el) => {
    // Current HP commits on blur (#65); flush a pending edit first so a still-focused HP field
    // can't blur *after* the rest and silently overwrite it back. No-op when nothing's focused.
    document.activeElement?.blur?.();
    // Destructive now that it touches HP and death saves — a mis-tap shouldn't wipe
    // what you were tracking, so gate it behind a confirm.
    // "Restores lost HP", not "restores HP to max" (#106): a rest no longer lowers a hand-set
    // current that sits above max, so promising a set-to-max would now misdescribe it.
    const ok = confirm(
      'Take a long rest? Restores lost HP, recovers all your Hit Point Dice, reduces '
      + 'exhaustion by 1, clears temp HP and death saves, and resets spell slots.',
    );
    if (ok) {
      state.longRest();
      // One rest rewrites HP, temp, hit dice, exhaustion, death saves and concentration at
      // once; none of it was announced (#100). Lead with HP — it is what a player checks.
      const char = state.getActive();
      const max = char && Number(char.hp.max) > 0 ? ` of ${char.hp.max}` : '';
      announcePlay(
        `Long rest taken. Hit points ${char ? char.hp.current : 0}${max}. `
        + 'Temp HP, death saves and concentration cleared. Hit dice restored.',
      );
    }
    // Re-home focus (#100). The flush above blurs whatever was focused — including this very
    // button when it was activated by keyboard — and nothing put it back, so the next Tab
    // restarted from the top of the document. Also runs on cancel: focus should never be a
    // casualty of changing your mind.
    el?.focus?.();
  },
  // #141: a spell level section's "+ Add" carries its level, so adding there creates a spell
  // already at that level. addRow merges the preset over the row TEMPLATE and only for keys the
  // template already has, so an attribute here can fill a field but never invent one.
  'add-row': (el) => state.addRow(
    el.dataset.list,
    el.dataset.rowLevel == null ? undefined : { level: Number(el.dataset.rowLevel) },
  ),
  'remove-row': (el) => state.removeRow(el.dataset.list, Number(el.dataset.index)),

  'download-corrupt': () => exportRaw(state.getCorruptRaw()),
  'start-fresh': () => { state.startFresh(); clearBanner('recovery'); },
};

/*
 * Ranges dispatch through the SAME ACTIONS map as buttons, but on `input` — so the tile follows
 * the thumb instead of jumping when it is released. Separate from the field listener above
 * because these carry no `data-bind`: they are layout controls, not character data, and must
 * never reach state.updateActive.
 */
const isActionRange = (el) => el.tagName === 'INPUT' && el.type === 'range' && el.dataset.action;

function runRangeAction(el) {
  const handler = ACTIONS[el.dataset.action];
  if (handler) handler(el);
}

document.addEventListener('click', (event) => {
  // Arrange mode (#72): the tile IS the target — tap one to point the toolbar at it. Only a
  // tap that lands ON an object is swallowed; the tab bar, roster and drawer stay usable while
  // arranging, which is why this doesn't return unconditionally.
  //
  // Two questions, and answering them with one variable left a hole. Whether the tap can SELECT:
  // not while placing (#73), where the live targets are the "Move here" lines between the tiles
  // and re-selecting mid-move would silently abandon the move you started. Whether it must be
  // SUPPRESSED: throughout arrange mode, placing included — while placing the tiles are meant to
  // be quiet, not live, and folding that into the same expression woke every [data-action] inside
  // a tile back up for the duration of a move, which is exactly what #115 set out to stop.
  const inObject = isArranging() ? event.target.closest('[data-object]') : null;
  const objNode = inObject && !isPlacing() ? inObject : null;

  const actionEl = event.target.closest('[data-action]');
  /*
   * A [data-action] INSIDE the tile being arranged does not fire (#115). Selecting the tile is
   * the only thing a tap in there can mean, and dispatching first meant tapping the Rest tile to
   * move it opened the Long rest confirm instead — a reset of HP, Hit Point Dice, death saves,
   * concentration, exhaustion and every spell slot, offered while the player was rearranging
   * furniture and not thinking about character data at all. The death-save pips are in a tile
   * too, so they went the same way.
   *
   * The CSS could not have stopped it: `pointer-events` is inherited, so
   * `body.is-arranging .card{pointer-events:none}` never reached these buttons — [data-object]
   * opts back in and every descendant comes with it. The blocklist that hides `.card__edit` and
   * `add-row` during arrange is the same oversight one layer up, and it grows a new hole every
   * time a button is added to a tile.
   *
   * So suppress by POSITION, not by name: no layout action lives inside an object — they are all
   * in the arrange bar, and the placement drop slots are siblings of the tiles rather than
   * children — which means there is no allow-list to keep in step with the ACTIONS map, and
   * nothing to forget when the next control lands in a tile.
   */
  if (actionEl && !(inObject && inObject.contains(actionEl))) {
    const handler = ACTIONS[actionEl.dataset.action];
    if (handler) handler(actionEl);
    return;
  }

  if (inObject) {
    /*
     * The browser's OWN default action for the tap goes the same way, and this is the half #115
     * missed: the suppression above only reaches what this app dispatches, and a <summary>
     * opening its <details> or a chip's <label> ticking its checkbox happen one layer below
     * anything in the ACTIONS map. So the Conditions tile — a <details> wrapping the condition
     * chips — folded itself open and shut every time it was tapped to move it, and once open, a
     * tap that landed on a chip gave the character a condition. Blinded, mid-rearrange, with no
     * undo for character data (#107).
     *
     * Same answer as #115, one layer down: suppress by POSITION. A tap inside a tile means
     * "select this tile" and cannot be made to mean anything else, so there is no per-control
     * list here to fall out of step with the markup.
     */
    event.preventDefault();
    if (objNode) selectObject(cardIdOf(objNode), objNode.dataset.object);
    return;
  }

  // Collapsible notes (#64): in VIEW mode, tapping an attack/inventory entry reveals or hides its
  // notes. Ephemeral UI state (a class on the row, like card edit mode): no character mutation,
  // resets on the next structural render. Edit mode (fields tappable to type) and taps on the note
  // itself are excluded; a note-less entry has nothing to reveal.
  // .row--spell joins the list unchanged (#141): a spell row is a Feature row in shape — one
  // visible line over a detail block — so tap-to-reveal comes for free and there is no new
  // gesture to learn or to test.
  const entryRow = event.target.closest('.row--attack, .row--inventory, .row--feature, .row--feat, .row--spell');
  /*
   * A control that is live in PLAY mode owns its own tap (#146). Until the spell row there was
   * never one on a primary line — every other row locks its fields in view mode, which is why
   * the exclusions above only ever named the hidden half of the row — and ticking Prepared
   * therefore also folded the detail block open underneath the player's finger, on the one
   * action this card exists for.
   *
   * The test is `data-live` (plus the <label> that wraps it and forwards the tap), not the
   * class: `data-live` is already the attribute that means "editable without Edit", so the next
   * live control put on a row line inherits this instead of re-opening the bug.
   */
  const livePrimaryControl = event.target.closest('[data-live], label');
  if (entryRow && !entryRow.closest('.is-editing') && !livePrimaryControl
      && !event.target.closest('.row__notes') && !event.target.closest('.row__detail')) {
    // #67 rows carry a .row__detail block (source / level / text) that ALWAYS has fields worth
    // revealing, so they toggle unconditionally — the note-less guard below only makes sense for
    // an attack/inventory row, whose sole hidden content is one optional note.
    const detail = entryRow.querySelector('.row__detail');
    if (detail) {
      entryRow.classList.toggle('is-expanded');
      return;
    }
    const notes = entryRow.querySelector('.row__notes');
    if (notes && notes.value.trim()) entryRow.classList.toggle('is-expanded');
    return;
  }

  const tabBtn = event.target.closest('[role="tab"]');
  if (tabBtn) {
    activateTab(tabBtn.id.replace('tab-', ''));
    return;
  }

  const rosterBtn = event.target.closest('.roster__btn');
  if (rosterBtn) {
    // Current HP commits on blur, and iOS doesn't blur a focused input when a button is
    // tapped (#94) — flush a pending edit into the OUTGOING character before switching, or
    // renderSheet repaints the field for the incoming one and the edit is dropped. Same
    // guard long-rest uses; renderSheet's activeElement skip deliberately does not cover
    // a character switch, because that render MUST repaint every field.
    document.activeElement?.blur?.();
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
   keyboard nicety). Scoped to the buttons, never the "Send to tab…" select, whose own arrow-key
   option navigation must not be hijacked.

   While placing an object (#73) the same keys walk the drop targets instead. That is where the
   objects' ↑/↓ went: reordering by keyboard is now "Move to…", arrow to a line, Enter — the
   identical path a finger takes, rather than a separate keyboard-only shortcut. */
document.addEventListener('keydown', (event) => {
  const inField = event.target.closest && event.target.closest('input, select, textarea');
  // Escape unwinds one step at a time: put the tile down first, leave the mode second. Exiting
  // outright would drop a half-finished move with no way to tell whether it took effect.
  if (event.key === 'Escape' && isArranging() && !inField) {
    if (isPlacing()) cancelPlacing(); else toggleArrange();
    return;
  }

  // A tile is role="button" while arranging (#72), so Enter/Space must select it — that is the
  // keyboard equivalent of tapping it, and without this the toolbar is unreachable by keyboard.
  // Inert while placing, for the same reason the click handler is.
  if (isArranging() && !isPlacing() && (event.key === 'Enter' || event.key === ' ')
      && event.target.matches?.('[data-object]')) {
    event.preventDefault();
    selectObject(cardIdOf(event.target), event.target.dataset.object);
    return;
  }

  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  const action = event.target.dataset && event.target.dataset.action;
  const delta = event.key === 'ArrowUp' ? -1 : 1;

  // Walk between drop targets, skipping the disabled pair that marks where the tile already is.
  if (isPlacing() && event.target.classList?.contains('dropslot')) {
    event.preventDefault();
    const slots = [...document.querySelectorAll('.dropslot')];
    let i = slots.indexOf(event.target) + delta;
    while (slots[i] && slots[i].disabled) i += delta;
    slots[i]?.focus();
    return;
  }

  if (action === 'move-card-up' || action === 'move-card-down') {
    const id = cardIdOf(event.target);
    if (id) { event.preventDefault(); reorderCard(id, delta); }
  }
});

/* Drag-and-drop reorder (#54 Phase 7): mouse-only, initiated from the ⠿ grips injected in arrange
   mode. Native HTML5 drag; "Move to…" (objects) and the ↑/↓ buttons (cards) stay the touch and
   keyboard path. Constrained to the dragged item's own container — a card within its tab, an
   object within its card (cross-tab stays the "Send to tab…" select) — so a drop only ever
   reorders siblings. */
let drag = null;

function clearDropMarks() {
  for (const el of document.querySelectorAll('.drop-before, .drop-after')) {
    el.classList.remove('drop-before', 'drop-after');
  }
}

function endDrag() {
  if (drag && drag.node) drag.node.classList.remove('is-dragging');
  clearDropMarks();
  drag = null;
}

/** Siblings of the dragged item in its container (excludes the dragged one itself). */
function dragSiblings() {
  return [...drag.container.children].filter(
    (c) => c.dataset && c.dataset[drag.attr] != null && c.dataset[drag.attr] !== drag.id,
  );
}

/** The sibling to insert before (null → end), from the pointer position within the container. */
function insertionRef(x, y) {
  for (const item of dragSiblings()) {
    const r = item.getBoundingClientRect();
    // Cards are a vertical list (compare against the vertical midpoint); objects flow inline in a
    // grid (a point is "after" an object if below it, or within its row and past its center).
    const after = drag.attr === 'editcard'
      ? y > r.top + r.height / 2
      : (y > r.bottom) || (y >= r.top && x > r.left + r.width / 2);
    if (!after) return item;
  }
  return null;
}

document.addEventListener('dragstart', (event) => {
  if (!isArranging() || isPlacing()) return; // one move at a time
  const grip = event.target.closest && event.target.closest('.drag-grip');
  // Objects drag from the TILE itself since the in-tile grip went away with the overlay (#72);
  // cards still drag from the ⠿ in their head. Both remain mouse-only — native HTML5 drag does
  // nothing on touch, where "Move to…" and the drop lines are the path (#73).
  const objNode = grip ? null : (event.target.closest && event.target.closest('[data-object]'));
  const cardNode = grip ? grip.closest('[data-editcard]') : null;
  if (!objNode && !cardNode) return;
  if (objNode) {
    drag = {
      kind: 'object', attr: 'object', id: objNode.dataset.object,
      cardId: objNode.closest('[data-editcard]')?.dataset.editcard,
      container: objNode.parentElement, node: objNode,
    };
  } else if (cardNode) {
    drag = {
      kind: 'card', attr: 'editcard', id: cardNode.dataset.editcard,
      container: cardNode.parentElement, node: cardNode,
    };
  } else {
    return;
  }
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', drag.id); // Firefox won't start a drag without data
  try { event.dataTransfer.setDragImage(drag.node, 12, 12); } catch { /* not every engine */ }
  drag.node.classList.add('is-dragging');
});

document.addEventListener('dragover', (event) => {
  if (!drag) return;
  const over = event.target.closest && event.target.closest(`[data-${drag.attr}]`);
  if (!over || over.parentElement !== drag.container) return; // same container only
  event.preventDefault(); // allow the drop
  event.dataTransfer.dropEffect = 'move';
  const ref = insertionRef(event.clientX, event.clientY);
  clearDropMarks();
  if (ref) {
    ref.classList.add('drop-before');
  } else {
    const sibs = dragSiblings();
    if (sibs.length) sibs[sibs.length - 1].classList.add('drop-after');
  }
});

document.addEventListener('drop', (event) => {
  if (!drag) return;
  const over = event.target.closest && event.target.closest(`[data-${drag.attr}]`);
  if (over && over.parentElement === drag.container) {
    event.preventDefault();
    const ref = insertionRef(event.clientX, event.clientY);
    const beforeId = ref ? ref.dataset[drag.attr] : null;
    if (drag.kind === 'object') dropObject(drag.cardId, drag.id, beforeId);
    else dropCard(drag.id, beforeId);
  }
  endDrag();
});

document.addEventListener('dragend', endDrag);

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

$('#btn-export-one').addEventListener('click', () => {
  const char = state.getActive();
  if (!char) {
    showNotice('Open a character first.');
    return;
  }
  state.flush();
  exportCharacterToFile(char);
  // Deliberately NOT recordBackup() (#70/#32): one character is not a backup of the roster,
  // so the 14-day reminder keeps counting until an "Export all". Exporting the only character
  // you have is a full backup in practice, but making the clock depend on the roster size
  // would mean the same button silently means two different things.
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


/* ------------------------------------------------------------- dispatch */

/*
 * One `input` listener and one `change` listener, each driving an ordered table (#125).
 *
 * There used to be seven top-level `change` listeners and two `input` ones, each re-deriving
 * from scratch whether the event was theirs. Every change event ran all seven `closest()`
 * walks — which is cheap and not the problem. The problem was that nothing declared a
 * PRECEDENCE: an element matching two predicates ran both handlers, in source-file order,
 * silently, and nothing anywhere said which was meant to win. Given how much of this repo's
 * bug history is "something fired that shouldn't have", that is a standing invitation.
 *
 * FIRST MATCH WINS. The routes below are mutually exclusive today — a structural field is not
 * the HP field, a rename input is not a range — so this is the same behaviour the seven
 * listeners had, with the contract written down instead of implied. probe-dispatch.html holds
 * that claim to account by walking the live DOM and failing if any element matches two routes;
 * without it "mutually exclusive" is just a comment that ages badly.
 *
 * `find` returns the element to ACT ON, not a boolean, because several routes match an
 * ancestor of the event target rather than the target itself.
 */

const INPUT_ROUTES = [
  { name: 'resize slider', find: (t) => (isActionRange(t) ? t : null), run: runRangeAction },
  /*
   * Live fields update as you type. Structural ones (they change how much DOM exists) wait for
   * `change` — rebuilding mid-keystroke would throw the caret away. Current HP also waits: a
   * signed value like "-8" is a delta (damage/heal), so writing it live would set current HP
   * to a literal negative mid-type.
   *
   * Requiring data-bind/data-toggle is what keeps this route from being a catch-all. Written
   * as "anything not structural and not HP" it matched 4183 elements — including the resize
   * slider, which then depended on being listed first to work at all. applyField already does
   * nothing without one of those two attributes, so asking for them up front costs no
   * behaviour and makes the table genuinely disjoint instead of merely well-ordered.
   * probe-dispatch.html caught this on its first run.
   */
  {
    name: 'live field',
    find: (t) => (t.dataset && (t.dataset.bind || t.dataset.toggle)
      && t.dataset.structural !== 'true' && !t.dataset.hpCurrent ? t : null),
    run: applyField,
  },
];

const CHANGE_ROUTES = [
  { name: 'structural field', find: (t) => (t.dataset?.structural === 'true' ? t : null), run: applyField },
  // Two ways to register an HP change: tap away (blur → change) or press Enter.
  { name: 'current HP', find: (t) => (t.dataset?.hpCurrent ? t : null), run: commitHpCurrent },
  { name: 'send card to tab', find: (t) => t.closest?.('.card__movetab') ?? null, run: commitCardMoveTab },
  { name: 'rename tab', find: (t) => t.closest?.('.tabrow__name') ?? null, run: commitTabRename },
  { name: 'rename card', find: (t) => t.closest?.('.card__rename') ?? null, run: commitCardRename },
  { name: 'rename object', find: (t) => t.closest?.('.obj-rename') ?? null, run: commitObjectRename },
  // Release ends the gesture, which is what collapses a whole drag into ONE undo step. Without
  // it the "same gesture" test never goes false and later drags ride the first one's entry.
  { name: 'end resize drag', find: (t) => (isActionRange(t) ? t : null), run: () => endResize() },
];

function dispatch(routes, target) {
  if (!target || target.nodeType !== 1) return;
  /*
   * Nothing inside a tile edits character data while arranging — the third and last way in.
   * The click handler suppresses by position and the CSS makes a tile's descendants
   * pointer-inert, but neither reaches a control activated from the KEYBOARD: tab onto a
   * condition chip inside the Conditions tile, press Space, and `change` fires with no pointer
   * event anywhere in the story. Same test as the click handler, for the same reason — every
   * layout control lives OUTSIDE the tiles (the arrange bar, the card head, the drop slots
   * between them), so position decides it and no allow-list has to be kept in step.
   */
  if (isArranging() && target.closest?.('[data-object]')) return;
  for (const route of routes) {
    const el = route.find(target);
    if (el) { route.run(el); return; }
  }
}

document.addEventListener('input', (event) => dispatch(INPUT_ROUTES, event.target));
document.addEventListener('change', (event) => dispatch(CHANGE_ROUTES, event.target));

// Exposed for probe-dispatch.html only — it needs the tables to prove they stay disjoint.
window.__dispatchRoutes = { INPUT_ROUTES, CHANGE_ROUTES };

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
//
// The chip is visual only now (#123) — as a live region it announced once per keystroke.
// So a failure has to speak somewhere else, and the banner is the right somewhere: it is
// already how startup reports read-only storage, and "your work is not being written" is a
// warning rather than a status. Cleared on the next successful write, by its own key, so it
// cannot outlive the problem or stomp on another flow's warning.
state.onStatus((message, tone) => {
  setSaved(message, tone);
  if (tone === 'error') showBanner(message, 'save');
  else if (tone === 'ok') clearBanner('save');
});

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

/*
 * Every spell level prints, whether or not its disclosure was left open (#141).
 *
 * This is JS rather than a print rule because a closed <details> is not `display:none` — it is
 * content containment, the same trap CLAUDE.md documents for measuring one — so overriding
 * `display` on its children does not reliably reveal them, and "reliably" is the whole
 * requirement here: a level heading printed with its spells missing is the one output a player
 * cannot detect from the paper in their hand.
 *
 * The screen state is restored afterwards, so printing does not silently unfold the card the
 * player was reading. `afterprint` fires on cancel as well as on print. Which sections were
 * open is captured at beforeprint rather than tracked, so nothing has to stay in step.
 */
let printReopen = [];
window.addEventListener('beforeprint', () => {
  printReopen = [...document.querySelectorAll('.spelllevel__disclosure:not([open])')];
  for (const details of printReopen) details.open = true;
});
window.addEventListener('afterprint', () => {
  for (const details of printReopen) details.open = false;
  printReopen = [];
});

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
