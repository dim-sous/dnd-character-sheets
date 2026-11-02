# D&D Character Sheets

A character sheet for D&D 2024 that does its own arithmetic, built for a home game of 3 bonobos.

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
- Your **layout** — tabs, card order, tile sizes, custom names — is a separate per-device
  preference under its own key, and a character export does **not** contain it. It has its
  own backup, below (#162). Before that it had none, so clearing site data or reinstalling
  destroyed an arrangement with no way to get it back.

Git tracks the code, not the party. Exported `.json` files are user data and are
gitignored (`/backups/`).

### Export

Sidebar → **Export**. Downloads every character on this device as one `.json` file. On a
phone it lands in Files/Downloads and can be sent on via the share sheet.

### Import

Sidebar → **Import**, pick a `.json`. There is no question to answer — each character in the
file is matched to this device's characters by its id, and by nothing else:

- **A character this device doesn't have** is added. Nothing else is touched.
- **A character this device already has** is updated from the file — level, abilities,
  proficiencies, max HP, the spell list, attacks, features, every total — while this device
  **keeps** its inventory, coins and notes, and everything that moves at the table: current
  and temporary HP, death saves, conditions, exhaustion, concentration, Heroic Inspiration,
  spent Hit Point Dice, used spell slots, class resources remaining, and which spells are
  ticked Prepared.

This device's numbers are kept exactly as they were, even when the file raises a total:
15 of 20 HP is 15 of 28 after a level-up, and you heal by hand if your table gives you the
new HP straight away. Used spell slots are the one thing capped, at the file's new total.
Resources and spells are matched by name, Hit Point Dice by die size; a row only the file
has comes in as the file has it, and a row the file no longer has is gone.

The banner afterwards says what was updated and added, and offers **Undo** until you next
change anything. A Duplicate gets a fresh id, so it is a different character to an import.

Imported files are normalised against the canonical character shape, so a backup from an
older version — or one you hand-edited — won't crash the app on a missing field.

### The default arrangement

The layout a new install starts with is a real arrangement, exported from a device that had been
played with and baked in (#164) — five tabs (**Status**, Abilities, Spells, **Attacks**,
Character), with the Status card's tiles in bands: the four numbers you only read, then the three
you spend, then HP, then the lists.

It only reaches a browser that has **never** had anything rearranged. If you have ever moved one
tile, your own layout wins and keeps winning — the app never overrides what you set up. To take
the new default instead, use *Reset to original* in the arrange bar.

### Layout backup

Sidebar → **Layout backup** (also in the arrange bar, under *Tabs & defaults*). The box holds
your arrangement as JSON: **Copy** it into a note or a message, or **Download** it as
`dnd-layout-<date>.json`. To restore it — or to put the same arrangement on a second device, or
hand your table a shared starting point — paste it back in and press **Replace layout**.

The textarea is the transport on purpose. A phone can copy text into a message far more easily
than it can move a file around, and it is the fallback when the clipboard API is blocked.

It is deliberately hard to confuse with a character backup, because the two files look alike in
a Downloads folder:

- A layout file carries `"kind": "dnd-character-sheets/layout"`. Anything without it is refused.
- Feeding a **character** backup to the layout importer is refused by name, not with a generic
  error. This matters more than it sounds: the layout reconciler answers *"what is the nearest
  valid layout to this?"*, never *"is this a layout?"* — so a character file normalises to the
  **shipped default**, and an importer that trusted it would report a clean success while
  replacing your arrangement with the factory one.
- Feeding a **layout** file to the character importer is likewise refused by name.
- A layout saved by a *newer* version of the app is refused rather than half-read. Characters
  are loaded best-effort because the file may be the only copy of irreplaceable data; a layout
  is reconstructible, your file is still in the box, and a misread import would overwrite the
  arrangement you still have.
- An import says what it changed. If the file names a card this version doesn't know, that card
  is dropped — which otherwise shows up as a mysteriously empty tab rather than as a message.

Characters are never touched by any of it, in either direction. Inside arrange mode, **Undo**
steps an import back; from the character list there is no undo, which is why it confirms first.

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
| `js/storage.js` | localStorage, normalisation, character export and import |
| `js/state.js` | The store: characters, active id, mutators, subscribe/notify |
| `js/layout.js` | Where things sit, as pure data — reconciliation, plus the layout file format |
| `js/layout-view.js` | The browser half of the above: the layout key, arrange mode, the backup dialog |
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
per-attack to-hit in both its derived and its free-text modes, the HP damage/healing
arithmetic, and the long-rest hit-dice recovery. It also covers the
data-loss-critical load path — the `hitDice` migration, `parseStored`, and
`normalizeCharacter`'s coercion and clamping — plus the dot-path `getByPath`/`setByPath`
and the import rules the store is built on — `importCharacters`' match-by-id and
`keepPlayState`'s split between the file's build and the device's play.

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

## The spell library

The Spells card's per-level **Search** button opens a picker over the ~340 spells of the SRD
5.2.1, filterable by level, class and school. Picking one fills the row — school, casting time,
range, components, duration and the full description — and it is an ordinary row from then on: editable,
deletable, yours. Anything not in the SRD is still one tap away, as a blank row with whatever you
typed into the search as its name.

The library is `js/spell-data.js`, generated by `tools/build-spell-data.py` and committed, so the
repo still runs from a bare folder with nothing installed:

```bash
python3 tools/build-spell-data.py          # fetch the SRD source and rewrite js/spell-data.js
python3 tools/build-spell-data.py --check  # parse and report, write nothing
```

It is ~330KB, so it is **not** loaded when the app starts — only the first time the picker opens.
The service worker precaches it, so after that first open it works at a table with no signal.

Spells the table uses that the SRD does not have — Summon Beast was the first — live in
`js/extra-spells.js`, written by hand in the same shape and searched as one list with the SRD.
The picker tags each with the book it is from ("PHB 2024"). Add one there, never in
`spell-data.js`, which the next regeneration rewrites. Keep each entry to the spell's facts —
level, range, components, duration, the numbers of any stat block — with any prose short and in
your own words: the SRD is licensed for sharing and the books are not, and this site is public.

### Adding a spell to the library

One spell is one block of JavaScript pasted into `js/extra-spells.js`, checked by the test suite,
and shipped through a pull request like any other change. Several spells can go in one PR.

**1. Check it isn't already there.** The SRD drops the wizard's name from eponymous spells, so
*Tasha's Hideous Laughter* is in the library as **Hideous Laughter** and must not be added again.
Search by a distinctive word rather than the full name:

```bash
grep -io '"name":"[^"]*laughter[^"]*"' js/spell-data.js
grep -in "name: .*laughter" js/extra-spells.js
```

No output from either means it is not in the library. (The 17 renamed spells: Acid Arrow, Arcane
Hand, Arcane Sword, Arcanist's Magic Aura, Black Tentacles, Faithful Hound, Floating Disk, Freezing
Sphere, Hideous Laughter, Instant Summons, Irresistible Dance, Magnificent Mansion, Private Sanctum,
Resilient Sphere, Secret Chest, Telepathic Bond, Tiny Hut.)

**2. Start a branch.**

```bash
git checkout main
git pull
git checkout -b feat/spell-toll-the-dead
```

**3. Paste this block** into `js/extra-spells.js`, after the last entry's `},` and before the `];`
that closes the list, then fill it in. The order of entries in the file does not matter: the picker
sorts by level, then name.

```js
  {
    name: 'Spell Name',
    level: 1,
    school: 'Evocation',
    classes: ['Sorcerer', 'Wizard'],
    castingTime: 'Action',
    range: '60 feet',
    components: 'V, S, M (a pinch of salt)',
    duration: 'Instantaneous',
    concentration: false,
    ritual: false,
    source: 'PHB 2024',
    text: [
      'First paragraph: what the spell does, in your own words.',
      'Using a Higher-Level Spell Slot. What changes for each slot level above this one.',
    ].join('\n\n'),
  },
```

Every field must be present, even the ones that are `false`, and there must be no others. ✓ marks
a rule the test suite enforces.

| Field | What to write | Rules |
| --- | --- | --- |
| `name` | `'Toll the Dead'` | ✓ Not already in the library (case and `'`/`’` are ignored when comparing). |
| `level` | `0` for a cantrip, `1`–`9` | ✓ A number, **no quotes**. |
| `school` | `'Necromancy'` | ✓ Exactly one of `Abjuration` `Conjuration` `Divination` `Enchantment` `Evocation` `Illusion` `Necromancy` `Transmutation`. |
| `classes` | `['Cleric', 'Wizard']` | ✓ At least one, each exactly one of `Bard` `Cleric` `Druid` `Paladin` `Ranger` `Sorcerer` `Warlock` `Wizard`. Base class lists only: no subclass extras, no Artificer. |
| `castingTime` | `'Action'` | ✓ Not empty. The SRD's wording: `Action`, `Bonus Action`, `1 minute`, `Action or Ritual`, `Reaction, which you take when …`. |
| `range` | `'60 feet'` | ✓ Not empty. `Self`, `Touch`, `30 feet`, `1 mile`, `Sight`. A cone or radius goes in `text`; the SRD writes the range as plain `Self`. |
| `components` | `'V, S, M (a sprig of mistletoe)'` | ✓ Not empty. |
| `duration` | `'Concentration, up to 1 minute'` | ✓ Not empty. `Instantaneous`, `1 hour`, `Concentration, up to 10 minutes`, `Until dispelled`. |
| `concentration` | `true` or `false`, no quotes | ✓ `true` exactly when `duration` starts with `Concentration`. |
| `ritual` | `true` or `false`, no quotes | ✓ `true` exactly when `castingTime` contains `Ritual`. |
| `source` | `'PHB 2024'` | ✓ Not empty, and must not say SRD. It is shown on the search result. |
| `text` | see below | ✓ Not empty. No `*`, no `_`, no HTML tags. |

**Writing the strings.** Any text goes between single quotes: `'Action'`. Watch out for three things:

- **Apostrophes.** An apostrophe ends a single-quoted string, so `'can't'` is a syntax error. Wrap
  that string in double quotes instead: `"The target can't take Reactions."`
- **Paragraphs.** Each string in the `text: [ … ]` list is one paragraph, and `.join('\n\n')` puts
  a blank line between them. Inside a paragraph, `\n` starts a new line, which is how a stat block
  lists `AC`, `HP` and `Speed` on lines of their own. Look at Summon Beast in the same file for a
  worked example, including a long paragraph split across lines with `+`.
- **Commas.** Every field line ends with a comma, and every entry ends with `},`.

A short `text` can be a single string instead of a list: `text: 'One paragraph.',`

Paragraph lead-ins follow the SRD's wording, so imported spells read like library ones:
`Cantrip Upgrade.` for a cantrip that scales with character level, and
`Using a Higher-Level Spell Slot.` for a levelled spell that scales with its slot.

**4. Run the tests.**

```bash
node tools/run-tests.mjs
```

`All … assertions passed.` means the entry is valid. If `node` is not found in a VS Code + WSL
setup, use the copy VS Code ships with:

```bash
"$(ls -d ~/.vscode-server/bin/*/node | head -1)" tools/run-tests.mjs
```

Or serve the folder and open `tests.html` in the browser, which runs the same checks.

A failure looks like one of the following. Each `✗` line ends with the name of the spell it is
about.

| You see | Cause |
| --- | --- |
| `SyntaxError` with a file, a line number and a `^` under the problem | The file is not valid JavaScript. **This one matters most: in the app it stops the picker loading any spell at all, SRD ones included.** Usually an apostrophe inside `'…'`, a missing comma after a field or after `}`, or an unclosed quote or bracket. Check that line and the one above it. |
| `✗ … exactly the SRD entry's keys, plus its source` | A field name is misspelled, missing or extra. Compare it with the template. |
| `✗ … carries every field the picker shows` | A text field is empty. |
| `✗ … filed at a level the sheet has` | `level` is outside 0–9, or is in quotes. |
| `✗ … under a school the picker offers` | `school` is misspelled. |
| `✗ … for classes the picker offers` | `classes` is empty, or has a misspelled name or one outside the eight. |
| `✗ … names the book it is from` | `source` is missing or empty, or says SRD. |
| `✗ no extra spell repeats an SRD name` or `✗ ...or another extra spell` | The spell is already in the library. See step 1. |
| `✗ the flags agree with the duration and casting time` | `concentration` or `ritual` disagrees with `duration` or `castingTime`. |
| `✗ no markdown in the descriptions either` | `text` contains `*`, `_` or an HTML tag. Write emphasis as plain words. |

**5. Look at it in the app.**

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>, pick a caster, go to the **Spells** card, press **Edit**, then
**Search** on any level and type the spell's name. The result should read like
`Level 1 Evocation · Sorcerer, Wizard · PHB 2024`. Tap it to read the text, and **Add** it to
check that the row's fields came through. The service worker is off on localhost, so a plain reload
picks up each edit.

**6. Commit, push and open a pull request.**

```bash
git add js/extra-spells.js
git commit -m "feat: Toll the Dead in the spell library"
git push -u origin feat/spell-toll-the-dead
gh pr create --fill
```

CI runs the same tests on the PR. Once they pass, merge it with a merge commit, either on GitHub
or with:

```bash
gh pr merge --merge --delete-branch
```

The merge deploys on its own. A phone with the app installed picks the new library up after it
reopens the app.

<details>
<summary>The 51 spells in the 2024 Player's Handbook that the SRD 5.2.1 leaves out</summary>

These are the candidates for this file. The list was taken from a fan-maintained index of the
2024 book in November 2026 and checked against every name in `spell-data.js`. It records what
the SRD omits, not what has been added here since, so check step 1 before adding any of them.

- **Cantrips:** Blade Ward, Friends, Mind Sliver, Thorn Whip, Thunderclap, Toll the Dead, Word of Radiance
- **Level 1:** Armor of Agathys, Arms of Hadar, Compelled Duel, Hail of Thorns, Thunderous Smite, Witch Bolt, Wrathful Smite
- **Level 2:** Arcane Vigor, Beast Sense, Cloud of Daggers, Cordon of Arrows, Crown of Madness (Summon Beast is already here)
- **Level 3:** Aura of Vitality, Blinding Smite, Conjure Barrage, Crusader's Mantle, Elemental Weapon, Feign Death, Hunger of Hadar, Lightning Arrow, Summon Fey, Summon Undead
- **Level 4:** Aura of Purity, Fount of Moonlight, Grasping Vine, Staggering Smite, Summon Aberration, Summon Construct, Summon Elemental
- **Level 5:** Banishing Smite, Circle of Power, Conjure Volley, Destructive Wave, Jallarzi's Storm of Radiance, Steel Wind Strike, Summon Celestial, Swift Quiver, Synaptic Static, Yolande's Regal Presence
- **Level 6:** Arcane Gate, Summon Fiend, Tasha's Bubbling Cauldron
- **Level 7:** Power Word Fortify
- **Level 8:** Telepathy

</details>

> This work includes material from the System Reference Document 5.2.1 (“SRD 5.2.1”) by Wizards
> of the Coast LLC, available at <https://www.dndbeyond.com/srd>. The SRD 5.2.1 is licensed under
> the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/legalcode).

## What it deliberately does not do

No dice roller. No rules validation. No auto-applied class features. No level-up wizard.
No backend, accounts or cloud sync. No frameworks, build step or CDN libraries.

The two behaviours it *does* encode, both overridable by hand:

- Damage is taken from temporary hit points first, then real ones, and current HP floors
  at zero.
- **Long rest** (behind a confirm) applies the full 2024 recovery: HP to max, temp HP,
  death saves and concentration cleared, all spent Hit Point Dice back, every class
  resource refilled, exhaustion down one, and all spell slots reset. Every field stays
  hand-editable — the DM rules, not the app.
