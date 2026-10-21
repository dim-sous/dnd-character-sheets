/*
 * The app's one "are you sure?" (#124).
 *
 * Every destructive action used to ask through the browser's native confirm(), which ignores the
 * theme and dark mode and, in an installed PWA, draws system chrome with the origin printed on it
 * — over a parchment character sheet. This asks through a styled <dialog> instead, and owns it the
 * way spell-picker.js owns the picker: markup in index.html, behaviour here, and no state.js
 * import. The caller decides what a Yes does; all this can do is say which answer was given.
 *
 * Three things here are load-bearing, and the first two are why the first attempt at #124 was
 * backed out:
 *
 *  - The answer resolves from the BUTTON'S OWN CLICK, not from the dialog's `close` event. `close`
 *    is fired from a queued task, so a promise waiting on it settles a turn after the click — or
 *    later: under load it has been measured arriving after the NEXT question opened, where it
 *    reads as that question being dismissed. And a listener attached after showModal() can miss
 *    it outright, leaving the promise, and the action behind it, pending forever. A click is
 *    synchronous, so by the time anything else runs the answer is in and the action's
 *    continuation is queued as a microtask.
 *  - Anything that dismisses the dialog without an answer — Escape, or a stray close() — is a No.
 *    A destructive action must never run because the question went away.
 *  - Cancel is the button that starts focused (`autofocus` in the markup). A stray Enter or Space
 *    should cost nothing; native confirm() focused OK.
 */

let pending = null;   // the open question's resolver, or null when no question is open
let wired = false;

const $ = (sel) => document.querySelector(sel);

function answer(yes) {
  const resolve = pending;
  if (!resolve) return;
  pending = null;
  const dialog = $('#confirm-dialog');
  if (dialog?.open) dialog.close();
  resolve(yes);
}

function wire(dialog) {
  if (wired) return;
  wired = true;
  dialog.addEventListener('click', (event) => {
    const button = event.target.closest('[data-answer]');
    if (button) answer(button.dataset.answer === 'confirm');
  });
  // Escape fires `cancel` synchronously, before the browser closes the dialog — answering here
  // rather than on `close` keeps a keyboard No as immediate as a tapped one.
  dialog.addEventListener('cancel', () => answer(false));
  // The net under both: however else the dialog shuts, an open question is answered No — but only
  // if the dialog is still shut when the event arrives. `close` is queued, not dispatched, and
  // under load it was measured landing AFTER the next question had opened: Cancel on Long rest,
  // then Delete, and the Long rest's late `close` answered "Delete …?" No and shut it, about one
  // run in ten. A `close` that finds the dialog open belongs to a question already answered.
  dialog.addEventListener('close', () => { if (!dialog.open) answer(false); });
}

/**
 * Ask a yes/no question in the app's own dialog.
 *
 * Resolves true only for an explicit Yes. One question at a time: asking while one is open
 * answers the new one No rather than replacing the question the player is reading.
 *
 * @param {{ title: string, body?: string, confirmLabel: string, danger?: boolean }} question
 * @returns {Promise<boolean>}
 */
export function askConfirm({ title, body = '', confirmLabel, danger = true }) {
  const dialog = $('#confirm-dialog');
  if (!dialog || pending || dialog.open) return Promise.resolve(false);
  wire(dialog);
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  const yes = dialog.querySelector('[data-answer="confirm"]');
  yes.textContent = confirmLabel;
  yes.classList.toggle('btn--danger', danger);
  yes.classList.toggle('btn--primary', !danger);
  return new Promise((resolve) => {
    pending = resolve;    // set BEFORE showModal, so nothing can answer into a void
    dialog.showModal();
  });
}
