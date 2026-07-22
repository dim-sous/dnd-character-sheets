/**
 * What leaves the bench.
 *
 * Three things: the :root block, the grid utilities and where they go, and a list
 * of the changes that are NOT free — the render.js guards and the one renderer
 * rewrite. The last part matters more than the CSS; the CSS you can eyeball, the
 * null-guard you cannot.
 */

import { BLOCKS, DEFAULT_CARDS, DEFAULT_TABS, METRICS, REPO_ROOT } from './constants.js';
import { escapeHtml } from './blocks.js';
import { get } from './state.js';
import { rootCss } from './tokens.js';

const gridCards = () => Object.entries(get().cards).filter(([, c]) => (c.cols || 1) > 1);

export function gridCss() {
  const state = get();
  const maxCols = Math.max(1, ...gridCards().map(([, c]) => c.cols));
  const maxRow = Math.max(1, ...Object.values(state.blockCfg).map((c) => c.rowSpan || 1));

  const spans = [];
  for (let i = 2; i <= maxCols; i += 1) spans.push(`.span-${i} { grid-column: span ${i}; }`);
  const rows = [];
  for (let i = 2; i <= maxRow; i += 1) rows.push(`.rows-${i} { grid-row: span ${i}; }`);

  return `.card--grid {
  display: grid;
  gap: var(--s4);
  grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr));
  align-items: start;
}
.card--grid > .card__title { grid-column: 1 / -1; }
.card--grid > * { min-width: 0; }

${spans.join('\n')}${rows.length ? `\n${rows.join('\n')}` : ''}`;
}

export function gridPlacement() {
  return gridCards().map(([id, c]) => {
    const lines = c.blocks.map((b) => {
      const cfg = get().blockCfg[b];
      const cls = [];
      if (cfg.span > 1) cls.push(`span-${Math.min(cfg.span, c.cols)}`);
      if (cfg.rowSpan > 1) cls.push(`rows-${cfg.rowSpan}`);
      const start = cfg.col > 0 ? `   (pinned to column ${cfg.col})` : '';
      return `    ${BLOCKS[b].label.padEnd(22)}${cls.length ? cls.join(' ') : '—'}${start}`;
    }).join('\n');
    return `${c.title || id}   --cols:${c.cols}\n${lines || '    (empty)'}`;
  }).join('\n\n');
}

export function structureText() {
  const state = get();
  return state.tabs.map((t) => {
    const cards = t.cards.map((cid) => {
      const c = state.cards[cid];
      if (!c) return '';
      const blocks = c.blocks.map((b) => {
        const cfg = state.blockCfg[b];
        const hidden = cfg.hidden.length
          ? `   [hidden: ${cfg.hidden.map((k) => BLOCKS[b].fields[k]).join(', ')}]` : '';
        const sub = cfg.subhead ? `"${cfg.subhead}" — ` : '';
        return `      · ${sub}${BLOCKS[b].label}${hidden}`;
      }).join('\n');
      return `  ${c.title || '(untitled)'}${(c.cols || 1) > 1 ? `   [${c.cols} columns]` : ''}\n${blocks || '      (empty)'}`;
    }).filter(Boolean).join('\n');
    return `${t.label}\n${cards || '  (empty)'}`;
  }).join('\n\n');
}

/** Blocks whose host has been removed from the markup — render.js will throw. */
export function missingHosts() {
  const placed = new Set(Object.values(get().cards).flatMap((c) => c.blocks));
  return Object.keys(BLOCKS).filter((id) => BLOCKS[id].cost === 'js' && !placed.has(id));
}

export function render(el) {
  const state = get();
  const changed = Object.entries(state.metrics)
    .filter(([k, v]) => METRICS[k] !== v)
    .map(([k, v]) => `${k}: ${METRICS[k]} → ${v}`);

  const gone = missingHosts();
  const hidden = Object.entries(state.blockCfg)
    .filter(([, cfg]) => cfg.hidden.length)
    .map(([b, cfg]) => `${BLOCKS[b].label}: ${cfg.hidden.map((k) => BLOCKS[b].fields[k]).join(', ')}`);

  const structMoved =
    JSON.stringify(state.tabs.map((t) => [t.label, t.cards]))
      !== JSON.stringify(DEFAULT_TABS.map((t) => [t.label, t.cards]))
    || JSON.stringify(Object.entries(state.cards).map(([k, c]) => [k, c.title, c.blocks]))
      !== JSON.stringify(Object.entries(DEFAULT_CARDS).map(([k, c]) => [k, c.title, c.blocks]));

  el.innerHTML = `
    <h3>Tokens</h3>
    <p>Replaces the <code>:root</code> block and dark-scheme override at the top of
    <code>style.css</code>. The type and spacing scales are new — the component rules still
    carry hardcoded rem values, so those want swapping to <code>var(--s3)</code> and
    <code>var(--text-sm)</code> as you go. <strong>Save to style.css</strong> rewrites just
    those two blocks and leaves the rest of the file alone.</p>
    <pre id="out-tokens">${escapeHtml(rootCss(state))}</pre>

    ${gridCards().length ? `
      <h3>Card grids</h3>
      <p>Utility classes rather than per-card selectors, so a block keeps its width when you
      move it. Blocks that currently sit loose in a card need a wrapper to hang the class on —
      the JS-rendered ones already have their host <code>div</code>, so those are free.</p>
      <pre>${escapeHtml(gridCss())}</pre>
      <pre>${escapeHtml(gridPlacement())}</pre>` : ''}

    <h3>Structure</h3>
    <p>${structMoved
      ? 'Changed. In <code>index.html</code> this is moving <code>&lt;section class="card"&gt;</code> blocks and their contents between <code>.tabpanel</code> sections, plus the buttons in <code>#tabbar</code> and the <code>TAB_KEYS</code> / <code>TAB_ORDER</code> arrays in <code>render.js</code> and <code>main.js</code>.'
      : 'Unchanged from the current arrangement.'}</p>
    <pre>${escapeHtml(structureText())}</pre>

    ${hidden.length ? `
      <h3>Fields removed</h3>
      <p>Delete these <code>.field</code> elements from <code>index.html</code>. Their
      <code>data-bind</code> paths stay valid in the character shape, so nothing in
      <code>storage.js</code> or <code>rules.js</code> needs touching — the values simply stop
      being editable.</p>
      <pre>${escapeHtml(hidden.join('\n'))}</pre>` : ''}

    ${gone.length ? `
      <h3 class="warn">Guards needed in render.js</h3>
      <p>These hosts are gone from the markup, but <code>render.js</code> still looks them up
      and calls <code>replaceChildren()</code> on the result with no null check:</p>
      <pre>${escapeHtml(gone.map((b) => `${BLOCKS[b].host.padEnd(20)}${BLOCKS[b].label}`).join('\n'))}</pre>
      <p>Cheapest fix is leaving the host in the markup and hiding it with CSS — no JS change,
      at the cost of a dead element. Otherwise add an early return to each renderer.</p>` : ''}

    ${state.metrics.groupSkills ? `
      <h3 class="warn">Skills grouping</h3>
      <p>Grouping by ability rewrites <code>renderSkills()</code>: it needs a
      <code>.skillgroup</code> wrapper with a subhead per ability instead of one flat list.
      That is issue #14, and the only change here that is not markup or CSS.</p>` : ''}

    <h3>What moved</h3>
    <pre>${changed.length ? escapeHtml(changed.join('\n')) : 'No metric changes yet.'}</pre>`;
}

/* ----------------------------------------------------------------- saving */

/**
 * Rewrite the :root and dark blocks inside a real stylesheet, leaving everything
 * else byte-identical. Returns null if either block cannot be found, so a
 * reformatted file fails loudly instead of being half-written.
 */
export function spliceRoot(css, generated) {
  const light = generated.match(/^:root \{[\s\S]*?\n\}/m);
  const dark = generated.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*\n\}/m);
  if (!light || !dark) return null;

  // The closing brace of the inner :root is indented in the real file, so both
  // block-enders have to tolerate leading whitespace. Getting this wrong is how
  // you half-write someone's stylesheet.
  let hits = 0;
  let out = css.replace(/^:root[ \t]*\{[\s\S]*?\n\}/m, () => { hits += 1; return light[0]; });
  out = out.replace(
    /@media[^{]*prefers-color-scheme:\s*dark[^{]*\{[\s\S]*?\n[ \t]*\}[ \t]*\n\}/m,
    () => { hits += 1; return dark[0]; },
  );
  return hits === 2 ? out : null;
}

/**
 * Write straight over style.css using the File System Access API.
 *
 * Chrome and Edge only. Everywhere else this throws and the caller falls back to
 * the clipboard, which is why the button never claims to have saved.
 */
export async function saveToStylesheet(status) {
  if (!window.showOpenFilePicker) {
    throw new Error('This browser has no file access API — use Copy instead.');
  }
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'Stylesheet', accept: { 'text/css': ['.css'] } }],
  });
  const file = await handle.getFile();
  const before = await file.text();
  const after = spliceRoot(before, rootCss(get()));
  if (!after) {
    throw new Error('Could not find both :root blocks in that file — nothing was written.');
  }
  const writable = await handle.createWritable();
  await writable.write(after);
  await writable.close();
  status(`Wrote ${file.name}`);
}

/** Read the app's real stylesheet so the baseline is what is on disk. */
export async function loadStylesheet() {
  const res = await fetch(`${REPO_ROOT}style.css`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`style.css returned ${res.status}`);
  return res.text();
}
