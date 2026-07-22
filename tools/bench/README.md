# Sheet Design Bench

A design tool for the character sheet, not part of the sheet.

It renders the app's components against live design tokens, lets you rearrange
cards and the blocks inside them, and hands back CSS you can paste — or write
straight over `style.css`. Nothing here ships: it lives in `tools/`, which
`stamp-sw.py` already skips, so it is never precached and never deployed.

---

## Running it

From the repo root:

```
python3 -m http.server 8000
```

Then open **<http://localhost:8000/tools/bench/>**.

Or open the folder in VS Code and hit **Go Live** on `tools/bench/index.html`.

It must be served, not opened as a `file://` path — the same constraint as the
app itself. ES modules need an origin, and so does the `fetch` that reads
`style.css`.

Chrome or Edge gets one extra thing: **Save to style.css** writes the token
blocks directly to disk via the File System Access API. Everywhere else that
button reports the browser cannot do it, and Copy still works.

---

## The three modes

**Style** — tokens against a phone-frame preview. Palette for both colour
schemes, a type scale from a base size and ratio, a spacing scale from a base
unit, radius, border width, shadow depth, touch target, bar heights.

**Structure** — tabs as columns, cards inside them, blocks inside those. Drag at
any level. Rename cards and subheads, toggle individual fields off, park blocks
in the tray.

**Compose** — the sheet itself, editable. Give a card more than one column and
its blocks become draggable and resizable against that grid. Handles on the
right edge, bottom edge and corner; exact values in the rail.

---

## What it knows about the app

Two things worth understanding, because they are why the export is trustworthy.

**Blocks are tagged by what it costs to move them.** A `markup` block lives in
`index.html` and is free to move or delete. A `js` block is a host element
`render.js` writes into — `#skills`, `#slots`, `#death-successes` and the rest.
Moving one of those is *also* free, because the lookup is by id and does not care
where the id sits. Deleting one is not: `render.js` looks the host up and calls
`replaceChildren()` on the result with no null check, so it throws on the next
render. The bench tracks this and the export names every host that needs a guard.

**The baseline comes off disk.** On startup the bench fetches `../../style.css`
and parses the real `:root` and dark-scheme blocks, so the palette you start from
is whatever is committed rather than a snapshot. The banner under the title says
whether that read succeeded. If it failed, bundled fallbacks are used and the
banner turns amber.

---

## Layout

```
tools/bench/
  index.html          shell
  css/bench.css       tool chrome — deliberately cool and neutral
  css/preview.css     the sheet's components, namespaced under .sheet
  js/constants.js     block registry, default cards and tabs, presets
  js/tokens.js        type/space scales, shadow, CSS generation — all pure
  js/state.js         the store: localStorage, mutators, subscribe
  js/blocks.js        sample character and per-block markup
  js/preview.js       state -> sheet
  js/canvas.js        structure and compose canvases, drag and resize
  js/rail.js          the control panel for all three modes
  js/exporter.js      CSS generation, guard warnings, save-to-disk
  js/main.js          wiring and startup
```

Same shape as the app on purpose: pure functions in one file, a store in another,
rendering in a third, wiring in `main.js`. No dependencies, no build step.

---

## Things to know before extending it

**`preview.css` is a copy and copies rot.** Colours are read from the real
stylesheet so those cannot drift, but the component rules are duplicated. If you
restructure a component in the app, mirror it here or the bench starts lying.

**Adding a block** means an entry in `BLOCKS` (`js/constants.js`) with its `cost`
and, for JS-rendered ones, its `host` selector; then markup in `BLOCK_HTML`
(`js/blocks.js`). Nothing else needs touching — the rail, canvases and export all
read from the registry.

**Resizing repaints the node directly** rather than going through the store, in
`canvas.js`. Re-rendering mid-gesture would replace the element the pointer is
captured on and drop the drag. The store is updated on pointer-up.

**Storage is `localStorage` under `dnd-sheet-bench`.** Separate key from the app,
but the same origin — worth remembering if you ever clear site data while
debugging, since that takes your characters with it.

---

## What it deliberately does not do

No absolute positioning. Blocks get a column span, a row span and an optional
pinned start column, because that is what survives the reflow from 390px to
1280px, the multi-column layout at the 900px breakpoint, content that grows
(eighteen skills, N inventory rows), and the print stylesheet. Pixel coordinates
would look right in the tool and break everywhere else.

No behaviour editing. The bench changes how things look and where they are. What
they do stays in the app.
