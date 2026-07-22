/**
 * Data-durability nudges (#32): a periodic "download a backup" reminder, and — on
 * iOS Safari in the browser — an "Add to Home Screen" suggestion, because Safari
 * can evict a non-installed site's storage after ~7 days of disuse while an
 * installed app is exempt. navigator.storage.persist() (requested at startup)
 * softens that, but Export remains the only real backup.
 *
 * The decision logic is pure and sits at the top so tests.js can cover it; only
 * the helpers below the fold touch localStorage. Nudge state is a device-local
 * preference under its own key — never part of a character export, and decoupled
 * from the character save loop so a corrupt roster can't block a nudge (or vice
 * versa).
 */

import { STORAGE_KEY } from './constants.js';

export const NUDGE_KEY = `${STORAGE_KEY}:nudges`;

const DAY_MS = 24 * 60 * 60 * 1000;
export const BACKUP_REMIND_DAYS = 14;
export const INSTALL_SNOOZE_DAYS = 30;

/* ------------------------------------------------------- pure decisions */

/**
 * Merge raw stored state over a known-good shape, the same way normalizeCharacter
 * does for rosters: hand-edited or version-skewed data is an input class, not an
 * error. Only finite positive numbers survive — a garbage timestamp would NaN-poison
 * Math.max in shouldRemindBackup and silently kill the reminder forever, and a
 * dropped (rather than kept) bad firstSeenAt lets recordFirstSeen re-stamp it.
 */
export function normalizeNudgeState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const key of ['firstSeenAt', 'lastBackupAt', 'backupSnoozedUntil', 'installSnoozedUntil']) {
    const n = Number(raw[key]);
    if (Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

/**
 * A snooze legitimately sits in the FUTURE (now + cadence) — that is its whole job —
 * so it is active until its expiry, but a value more than its own cadence ahead is a
 * skewed-clock or hand-edited artifact and counts as already expired.
 */
function snoozeActive(until, now, days) {
  return Boolean(until) && now < until && until - now <= days * DAY_MS;
}

/**
 * An anchor (firstSeenAt / lastBackupAt) describes the PAST: you cannot have first
 * visited or last backed up in the future. A future value is therefore ignored, NOT
 * floored to now — flooring would let a bogus future firstSeenAt mask a perfectly
 * valid older lastBackupAt (and an extreme value mute the reminder forever). Snoozes
 * need the opposite rule, which is why this is not the same clamp.
 */
function pastAnchor(value, now) {
  return value && value <= now ? value : 0;
}

/**
 * Remind when there are characters worth backing up and neither an export nor
 * first use happened within the cadence. The firstSeenAt anchor keeps a brand-new
 * device from being greeted with a reminder before it could possibly be "behind";
 * an empty meta (the very first visit, before firstSeenAt is stamped) never nudges.
 * A future firstSeenAt from a skewed clock is corrected on load by recordFirstSeen.
 */
export function shouldRemindBackup(meta, now, hasCharacters) {
  if (!hasCharacters) return false;
  if (snoozeActive(meta.backupSnoozedUntil, now, BACKUP_REMIND_DAYS)) return false;
  const anchor = Math.max(pastAnchor(meta.lastBackupAt, now), pastAnchor(meta.firstSeenAt, now));
  if (!anchor) return false;
  return now - anchor > BACKUP_REMIND_DAYS * DAY_MS;
}

/**
 * Suggest installing only where it changes anything: iOS, in the browser (not the
 * installed app), with characters that are actually at risk. Dismissal snoozes for
 * INSTALL_SNOOZE_DAYS — the threat persists until they install, so it may return.
 */
export function shouldSuggestInstall(meta, now, isIOS, isStandalone, hasCharacters) {
  if (!isIOS || isStandalone || !hasCharacters) return false;
  if (snoozeActive(meta.installSnoozedUntil, now, INSTALL_SNOOZE_DAYS)) return false;
  return true;
}

/* --------------------------------------------- localStorage (best-effort) */

export function loadNudgeState() {
  try {
    return normalizeNudgeState(JSON.parse(localStorage.getItem(NUDGE_KEY)));
  } catch (err) {
    return {};
  }
}

function saveNudgeState(patch) {
  try {
    localStorage.setItem(NUDGE_KEY, JSON.stringify({ ...loadNudgeState(), ...patch }));
  } catch (err) {
    /* best-effort: a full or blocked store already raises its own banner */
  }
}

/**
 * Stamp the first visit once, so the backup clock has an anchor from day one — and
 * re-stamp a FUTURE firstSeenAt (a skewed clock at first visit), which is otherwise
 * unusable as a past anchor. This is the stateful half of the skew self-heal: a lone
 * bogus firstSeenAt is corrected to `now` on the next load, bounding suppression to
 * one visit rather than the whole skew.
 */
export function recordFirstSeen(now = Date.now()) {
  const { firstSeenAt } = loadNudgeState();
  if (!firstSeenAt || firstSeenAt > now) saveNudgeState({ firstSeenAt: now });
}

/** Every export resets the reminder clock and cancels any pending snooze. */
export function recordBackup(now = Date.now()) {
  saveNudgeState({ lastBackupAt: now, backupSnoozedUntil: 0 });
}

export function snoozeBackup(now = Date.now()) {
  saveNudgeState({ backupSnoozedUntil: now + BACKUP_REMIND_DAYS * DAY_MS });
}

export function snoozeInstall(now = Date.now()) {
  saveNudgeState({ installSnoozedUntil: now + INSTALL_SNOOZE_DAYS * DAY_MS });
}
