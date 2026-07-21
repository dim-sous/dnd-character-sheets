# D&D Character Sheets

A character sheet for D&D 2024 that does its own arithmetic, built for a home game of
three players going from level 3 to 10.

Modifiers, proficiency bonus, saving throws, all eighteen skills, passive Perception and
spell save DC recalculate the moment anything changes — they are never stored, only
derived. Current HP and spell slots are the two things you touch most during play, so they
are the two things placed within a thumb's reach.

It is a **tracker, not a rules engine.** It will not validate your choices, apply class
features, or run a level-up wizard. Every field is free-form. The player is the authority.

No frameworks, no dependencies, no build step, no accounts, no backend.

---

## Running it

**→ https://dim-sous.github.io/dnd-character-sheets/**

### On a phone (the way players use it)

1. Open **https://dim-sous.github.io/dnd-character-sheets/**
2. **Add to Home Screen** — iOS: Share → Add to Home Screen. Android: menu → Install app.
3. Open it from the home screen icon. It runs fullscreen and **works with no signal.**

> **Install it, don't just bookmark it.** iOS Safari deletes localStorage for sites you
> have not visited in seven days. If you play every few weeks, a bookmarked sheet can
> quietly lose your character. Home-screen installs are exempt from that eviction.
> Export a backup now and then anyway.

### On your laptop (editing the code)

Open the folder in VS Code and hit **Go Live** (Live Server extension), then open the URL
it gives you.

Serve it over Live Server rather than double-clicking `index.html` — a bare `file://` path
blocks ES module imports and makes `localStorage` behave inconsistently. If you don't have
Live Server, any static server works:

```bash
python3 -m http.server 8000
```

**The service worker is switched off on localhost.** It would otherwise cache the app
shell and serve your own edits back to you stale — the repo copy of `service-worker.js`
is deliberately never stamped, so its cache version never changes and nothing invalidates.
Any worker left over from an older build is unregistered automatically on first load.

To exercise offline behaviour on purpose, opt back in:

```
http://localhost:5500/?sw=1
```

### Over your LAN, without internet

Live Server binds to all interfaces, so a phone on the same Wi-Fi can reach your laptop:

```
http://<your-laptop-ip>:5500/
```

Find the IP with `ip addr` (Linux/WSL), `ifconfig` (macOS) or `ipconfig` (Windows).

This works, but understand the trade-off: **offline support and home-screen install are
not available over LAN.** Service workers require a secure context (HTTPS or localhost),
and a `http://192.168.x.x` address is neither. The app itself works fine; it just can't
cache itself or dodge the iOS eviction. The laptop also has to stay awake.

---

## Where your characters live

**In your browser's `localStorage`, on that one device.** Nothing syncs. Nothing is
uploaded. Each player's phone holds its own copy of its own character.

That means:

- Clearing your browser data deletes your characters.
- Your phone and your laptop have separate, unrelated copies.
- **Export is the only backup, and it's the only way to move a character between devices.**

Git tracks the code, not the party. Exported `.json` files are user data and are
gitignored (`/backups/`).

### Export

Sidebar → **Export**. Downloads every character on this device as one `.json` file. On a
phone it lands in Files/Downloads and can be sent on via the share sheet.

### Import

Sidebar → **Import**, pick a `.json`, then choose:

- **Replace all** — discards what is on this device and uses the file.
- **Merge** — keeps what you have and adds the file's characters. Anything whose id
  collides gets a fresh one, so an import can never silently overwrite a live character.

Imported files are normalised against the canonical character shape, so a backup from an
older version — or one you hand-edited — won't crash the app on a missing field.

---

## How it fits together

```
   DOM events ──▶ mutate state ──▶ notify ──▶ render ──▶ DOM
                       │
                       └──▶ debounced (400ms) ──▶ localStorage
```

State is the single source of truth. Event handlers only mutate state and re-render; they
never reach into unrelated DOM. Persistence hangs off the loop rather than being something
each mutator has to remember.

| File | Job |
|---|---|
| `js/constants.js` | The canonical character shape, the 2024 skill and condition lists |
| `js/rules.js` | Every derived number, as pure functions. No DOM, no state, no side effects |
| `js/storage.js` | localStorage, normalisation, export and import |
| `js/state.js` | The store: characters, active id, mutators, subscribe/notify |
| `js/render.js` | Character → DOM |
| `js/main.js` | Wiring: delegated listeners, service worker registration, bootstrap |
| `tools/make-icons.py` | One-off icon generator. Not needed to run the app |

**Rendering is split three ways on purpose.** Rebuilding the sheet on every keystroke would
reassign `.value` on the field being typed into and throw the caret to the end of the line.
So `renderSheet()` runs only on structural changes (open a character, add or remove a row,
import) and writes each input's value exactly once. After that, only the field that has the
caret flows one way — DOM to state: `renderDerived()` runs on every change and writes every
*other* bound input back from state, refusing just the one that is `document.activeElement`.
That write-back is what lets the HP +/− buttons and long rest update the inputs at all.

**There are no per-field event handlers.** Two delegated listeners read `data-bind`,
`data-toggle` and `data-action` attributes, so adding a field to `index.html` needs no
JavaScript at all.

## Tests

Open `tests.html` in the browser, or run the same suite headless:

```bash
node tools/run-tests.mjs
```

It asserts every derived value — modifiers, proficiency bonus at each tier, saves, skills
with proficiency and expertise, passive Perception, initiative, spell DC and attack, the
HP damage/healing arithmetic, and the long-rest hit-dice recovery. It also covers the
data-loss-critical load path — the `hitDice` migration, `parseStored`, and
`normalizeCharacter`'s coercion and clamping — plus the dot-path `getByPath`/`setByPath`
and the `mergeCharacters` id-collision handling the store is built on.

The assertions live in `tests.js`, imported by both the browser page and the Node runner.
The identical suite running in either place — with no test framework — is only possible
because `rules.js` is pure, which is the whole argument for keeping the arithmetic separate
from the rendering. CI runs it on every pull request, so a broken calculation blocks the
merge. (Node 22.7+ reads the app's ES modules with no `package.json`.)

## Reviewing a pull request

There is no hosted preview deployment. GitHub Pages serves a single origin, and
`localStorage` is scoped to origin, not path — so a same-origin preview could read and
overwrite your real characters. Review a PR locally instead; `localhost` is its own
origin and cannot touch production data:

```bash
gh pr checkout 12        # by PR number
```

Then Go Live (or `python3 -m http.server 8000`) and click through it, and run
`node tools/run-tests.mjs` to confirm the rules still hold.

## Deploying a change

Push to `main`. The `deploy.yml` workflow runs `tools/stamp-sw.py`, which rewrites the
service worker's `CACHE_VERSION` to a content hash of the precached files and regenerates
the precache list, then publishes to GitHub Pages. **You do not bump the version by hand** —
the hash changes on its own whenever a shipped file changes, and the repo copy deliberately
stays at `v1` (both the stamp and the deploy rely on the committed copy being unstamped). To
see what a deploy would stamp, without touching anything:

```bash
python3 tools/stamp-sw.py --print
```

The app still caches the shell **cache-first**, so a change reaches an installed phone only
once the worker picks up the new build. If one stubbornly refuses to show up, that lag is
why — reopening the app re-checks the worker, and it then offers a reload.

## What it deliberately does not do

No dice roller. No rules validation. No auto-applied class features. No level-up wizard.
No backend, accounts or cloud sync. No frameworks, build step or CDN libraries.

The two behaviours it *does* encode, both overridable by hand:

- Damage is taken from temporary hit points first, then real ones, and current HP floors
  at zero.
- **Long rest** (behind a confirm) applies the full 2024 recovery: HP to max, temp HP and
  death saves cleared, all spent Hit Point Dice back, exhaustion down one, and all spell
  slots reset. Every field stays hand-editable — the DM rules, not the app.
