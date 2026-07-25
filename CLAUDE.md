# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A D&D 2024 character sheet PWA for a home game. It is a **tracker, not a rules engine** — every field is free-form, nothing is validated, no class features or level-up logic. Derived numbers (modifiers, proficiency bonus, saves, skills, passive Perception, spell DC/attack) are never stored, only recomputed. Vanilla JS, no framework.

## Commands

There is **no build, no bundler, no package manager, no lint step** — and that is a hard product constraint, not a gap to fill. The repo must run from a bare folder.

- **Run locally:** serve over HTTP, never `file://` (a bare file path blocks ES module imports and makes `localStorage` flaky). VS Code Live Server ("Go Live"), or:
  ```bash
  python3 -m http.server 8000
  ```
- **Tests:** `node tools/run-tests.mjs` runs the full suite headless (Node ≥ 22.7 — no browser, no deps, no `package.json`), or open `tests.html` in a browser for the same assertions. The suite lives in `tests.js`, imported by both. No per-test filter — comment others out to isolate one. CI runs the runner on every pull request, so a broken calculation blocks the merge.
- **Deploy:** merge/push to `main` → `.github/workflows/deploy.yml` runs `tools/stamp-sw.py` (stamps the service-worker cache version + precache list from the deployed files) and publishes to GitHub Pages. Re-runnable from the Actions tab via `workflow_dispatch`. Production URL: https://dim-sous.github.io/dnd-character-sheets/

## Measuring the running app

**There IS a browser available in this WSL environment — do not assume otherwise, and do not hand a UI check back to the user as unverifiable.** Windows Chrome is reachable through WSL interop, runs headless, executes ES modules and JS, and can be measured. Node also exists even when it is not on `PATH` (the VS Code server ships one).

```bash
# node, when `node` is not on PATH (this is what runs the test suite)
NODE=$(ls -d ~/.vscode-server/bin/*/node | head -1); "$NODE" tools/run-tests.mjs

# 1. serve the repo (Windows Chrome reaches WSL's localhost directly)
python3 -m http.server 8000 --bind 127.0.0.1 &

# 2. drive Chrome headless and print the page's post-JS DOM
CHROME="/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --user-data-dir='C:\Temp\cc-probe-profile' --force-device-scale-factor=1 \
  --virtual-time-budget=25000 --dump-dom "http://localhost:8000/tools/probe.html"
```

`tools/probe.html` is the standing **touch-target audit**: it seeds a character through `blankCharacter()`, loads the app in a 390px iframe, walks every tab and edit/arrange mode, and reports any control whose hit area is under 44px. Extend it rather than writing throwaway probes. Read its header comment before changing it.

The other `tools/probe-*.html` pages are targeted regression checks for behaviour the DOM-free suite can't reach — `probe-hp-commit.html` (an HP edit must survive a roster switch, #94) and `probe-arrange-fn.html` (arrange mode's select-a-tile wiring plus a **height budget** for the arrange bar, #71/#72/#73). They print `ALL PASS` or a list of failures; run them the same way as `probe.html`. Each reseeds `localStorage` — including the layout keys, which are `dnd-character-sheets:layout` and `:layout-default`, colons not hyphens — so runs don't inherit each other's mutations.

Gotchas, all of them learned the hard way:

- **`--user-data-dir` is required.** Without it Chrome forwards to the user's already-running desktop instance and your flags are silently ignored.
- **Don't trust `--window-size` for viewport width** — Windows display scaling distorts it. Pin the width with a fixed-size `<iframe>` instead; that is what `probe.html` does.
- **Use `setTimeout`, not `requestAnimationFrame`, to wait.** Under `--virtual-time-budget` timers are fast-forwarded reliably; an animation-frame loop is not guaranteed to be driven.
- **Probe pages belong in `tools/`, never the repo root.** `tools/` is in `stamp-sw.py`'s `SKIP_DIRS`; a stray `.html` at the root **would** be precached and shipped to every player's phone.
- **Kill the service worker before measuring, or you will measure the last build.** The app registers a cache-first worker, so a probe run in a reused `--user-data-dir` serves stale CSS and stale modules — it shows up as a change that "didn't apply", or a `does not provide an export named …` error for code you just wrote. Every committed probe unregisters it and clears `caches` before loading the app; do the same in any new one, or use a throwaway profile directory.
- **Inactive tab panels carry `hidden`**, so a control measures 0×0 until you activate its tab. Some controls only exist in a card's edit mode (the spell-slot total is setup-only — play mode renders a count instead).
- **Measure, don't infer.** This stylesheet has a recurring trap where a class rule (0,1,0) declares a size that the base `input[type=…]` / `.icon-btn` rule (0,1,1) outranks, so the control is *not* the size the CSS appears to say. Reading the stylesheet has already put wrong claims into three issues; measurement disproved them. The honest tap target is also not the border box — `.pip` and `.toggle` carry theirs on an absolutely-positioned `::after`, and `.chip` puts it on the wrapping `<label>`.

## Architecture

**Unidirectional loop, single source of truth:**

```
DOM events ─▶ state mutator ─▶ emit() ─▶ subscribed render() ─▶ DOM
                   └─▶ debounced 400ms ─▶ localStorage
```

Event handlers only mutate state and re-render — they never reach into unrelated DOM. Persistence hangs off `emit()`, so no mutator has to remember to save.

**The data layer is strictly DOM-free and must stay that way.** The test suite (`tests.js`) imports only `constants.js` + `rules.js`, which is the whole reason the arithmetic is kept pure and separate:
- `js/constants.js` — `blankCharacter()` (the canonical shape every stored/imported character is merged over), the ability/skill/condition lists, `STORAGE_KEY`.
- `js/rules.js` — every derived number as a pure function (`saveTotal`, `skillTotal`, `characterPB`, `passivePerception`, `spellSaveDC`, `isSpellcaster`, `applyDamage`/`applyHealing`, `formatMod`…). No DOM, no state, no side effects.
- `js/storage.js` — localStorage read/write, normalization/migration (imports are merged over `blankCharacter()` so old or hand-edited files never crash), import/export.
- `js/state.js` — the **only** place a character is mutated. Dot-path `getByPath`/`setByPath`; `updateActive(path, value, type)`, `toggleInArray`, `addRow`/`removeRow`, `setSlotsUsed`, `longRest`. `emit(type)` where `type` is `'structural'` or `'derived'`.
- `js/render.js` — character → DOM.
- `js/main.js` — delegated listeners, bootstrap, service-worker registration.

A layout/markup change that forces a change to `rules.js`/`state.js`/`storage.js`/`constants.js` is a smell — stop and reconsider. `tests.html` must stay green.

**Rendering is split by trigger rate (this split is load-bearing):**
- `renderSheet(char)` — STRUCTURAL changes only (open a character, add/remove a row, import). Rebuilds sections and writes each `[data-bind]` input's value exactly **once**; after that text fields flow DOM→state only. Rebuilding on every keystroke would reassign `.value` on the field being typed into and throw the caret to the end.
- `renderDerived(char)` — EVERY change. Recomputes `[data-derived]`, re-checks `[data-toggle]`, and writes back `[data-bind]` inputs **except** `document.activeElement` (so it never clobbers the caret).
- `renderSlotPips(char)` — targeted pip rebuild for spell-slot totals, so typing a total doesn't destroy its own input.

**No per-field event handlers.** Three delegated attributes drive everything, so adding a field to `index.html` usually needs zero JS:
- `data-bind="dot.path"` (+ `data-type="number|nullable-number|checkbox"`) — two-way bound field.
- `data-toggle="arrayName"` + `data-value="key"` — membership in a list (proficiencies, conditions).
- `data-action="name"` — dispatched through the `ACTIONS` map in `main.js`.
- `data-structural="true"` makes a field fire on `change` (not `input`) and trigger a structural render.
- A computed readout is `<output data-derived="kind.arg">` plus a `case` in `derivedValue()` calling a pure `rules.js` function.
- Repeatable lists = `data-list` + `<template id="tpl-…">` + `ROW_TEMPLATES` (constants) + `LIST_PATHS` (state) + `ROW_TEMPLATE_IDS`/`renderRows` (render).

**Tabbed layout (added in #6).** The sheet body is five `role="tabpanel"` panels (Combat, Abilities, Spells, Gear, Character) with a `role="tablist"` bottom bar; roving-tabindex arrow-key nav lives in `main.js`, `activateTab`/`syncActiveTab` in `render.js`. Every panel stays in the DOM — inactive ones carry the `hidden` attribute (never render-on-demand, because `renderDerived` walks `[data-derived]`/`[data-bind]` across the whole document). On laptop (≥900px) and in print the tab bar is hidden and `.tabpanel[hidden]{display:contents!important}` reveals every panel at once (multi-column on screen, full sheet on paper). The active tab is not persisted — opening a character lands on Combat. Saving throws render into Combat, ability scores into Abilities, via two renders (`renderAbilities`/`renderSaves`) that share the same derived keys.

**Service worker.** Caches the app shell cache-first. `tools/stamp-sw.py` sets `CACHE_VERSION` and the precache list from the deployed files during CI, so you normally do **not** bump the version by hand (the README's manual-bump note predates that automation). An installed PWA still needs a reopen/reload to pick up a new build.

**Storage.** Characters live in `localStorage` under `dnd-character-sheets`, per device, never synced. Export is the only backup and the only way to move a character between devices. localStorage is scoped to origin (not path) — relevant to preview-deployment work (#8).

## Conventions

- **Never add a dependency, build step, or runtime CDN/library.** CI tooling (Python scripts, Actions) is fine — it does not touch the shipped artifact, which stays byte-identical static files.
- **Phone-first**, designed ~375–390px. Minimum 44px touch targets. Real ARIA semantics. Verify UI changes at **390px and 1440px**, and check print preview when layout changes.
- Hidden elements use the `hidden` attribute and depend on the global `[hidden]{display:none!important}` in `style.css` — an author `display` silently beats the UA `[hidden]` rule, which has bitten this app before.
- The behaviors the app encodes (all hand-overridable): damage is taken from temp HP first then real HP and floors at 0; a long rest (confirmed) restores HP to max, clears temp HP, death saves and concentration, regains all spent Hit Point Dice (2024 restores the full pool, not half), drops exhaustion by 1, and resets spell slots. The recovery arithmetic lives in `rules.js` (`restoreHitDice`, `applyDamage`, `applyHealing`).
- **Git/PR flow:** branch as `feat/<issue#>-<slug>` (also `fix/…`, `docs/…`); open a PR to `main`; the rules suite (CI) must pass; merge as a merge commit. There is no hosted PR preview — review a PR locally with `gh pr checkout <n>` (see the README); deploys happen on push to `main`.
