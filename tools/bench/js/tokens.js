/**
 * Every derived design value, as pure functions.
 *
 * No DOM, no state. Same reason rules.js is pure in the app: it means the export
 * and the live preview cannot disagree, because they call the same function.
 */

const rem = (px) => `${(px / 16).toFixed(3)}rem`;

export function typeScale(base, ratio) {
  return {
    '--text-xs':   rem(base / ratio / ratio),
    '--text-sm':   rem(base / ratio),
    '--text-base': rem(base),
    '--text-md':   rem(base * ratio),
    '--text-lg':   rem(base * ratio * ratio),
    '--text-xl':   rem(base * ratio ** 4),
    '--text-2xl':  rem(base * ratio ** 6),
  };
}

export function spaceScale(unit) {
  return {
    '--s1': rem(unit), '--s2': rem(unit * 1.5), '--s3': rem(unit * 2),
    '--s4': rem(unit * 3), '--s5': rem(unit * 4), '--s6': rem(unit * 6),
  };
}

export function shadowFor(level, scheme) {
  if (level === 0) return 'none';
  const rgb = scheme === 'dark' ? '0, 0, 0' : '60, 44, 26';
  const a1 = scheme === 'dark' ? 0.3 : 0.09;
  const a2 = scheme === 'dark' ? 0.22 : 0.06;
  return `0 ${level}px ${level * 2}px rgba(${rgb}, ${(a1 * level / 2).toFixed(3)}), `
       + `0 ${level * 2}px ${level * 7}px rgba(${rgb}, ${(a2 * level / 2).toFixed(3)})`;
}

/** The full custom-property set for one scheme, ready to set on an element. */
export function tokensFor(state, scheme) {
  const m = state.metrics;
  const palette = scheme === 'dark' ? state.dark : state.light;
  const out = {};
  for (const [k, v] of Object.entries(palette)) out[`--${k}`] = v;
  Object.assign(out, typeScale(m.textBase, m.scale), spaceScale(m.space));
  out['--radius'] = `${m.radius}px`;
  out['--bw'] = `${m.bw}px`;
  out['--tap'] = `${m.tap}px`;
  out['--tabbar-h'] = `${m.tabbar}px`;
  out['--topbar-h'] = `${m.topbar}px`;
  out['--cardpad'] = rem(m.cardpad);
  out['--cardgap'] = rem(m.cardgap);
  out['--shadow'] = shadowFor(m.shadow, scheme);
  out['--titleface'] = m.titleface === 'serif' ? 'var(--serif)' : 'var(--sans)';
  return out;
}

export function applyTokens(el, state, scheme) {
  for (const [k, v] of Object.entries(tokensFor(state, scheme))) el.style.setProperty(k, v);
}

/* ------------------------------------------------------------------ export */

const pad = (k) => ' '.repeat(Math.max(1, 12 - k.length));

export function rootCss(state) {
  const m = state.metrics;
  const palette = (obj) => Object.entries(obj).map(([k, v]) => `  --${k}:${pad(k)}${v};`).join('\n');
  const scale = (obj) => Object.entries(obj).map(([k, v]) => `  ${k}:${pad(k)}${v};`).join('\n');

  return `:root {
${palette(state.light)}

  /* type scale — base ${m.textBase}px, ratio ${m.scale} */
${scale(typeScale(m.textBase, m.scale))}

  /* spacing scale — ${m.space}px unit */
${scale(spaceScale(m.space))}

  --radius: ${m.radius}px;
  --bw: ${m.bw}px;
  --tap: ${m.tap}px;
  --topbar-h: ${rem(m.topbar)};
  --tabbar-h: ${rem(m.tabbar)};
  --cardpad: ${rem(m.cardpad)};
  --cardgap: ${rem(m.cardgap)};
  --shadow: ${shadowFor(m.shadow, 'light')};

  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --titleface: ${m.titleface === 'serif' ? 'var(--serif)' : 'var(--sans)'};
}

@media (prefers-color-scheme: dark) {
  :root {
${palette(state.dark)}
    --shadow: ${shadowFor(m.shadow, 'dark')};
  }
}`;
}

/**
 * Parse the palette out of a real stylesheet.
 *
 * Deliberately narrow: it reads the first :root block for the light scheme and the
 * :root inside the prefers-color-scheme: dark media query for the other. Anything
 * it cannot find is left at the caller's fallback rather than guessed at.
 */
export function parseRoot(css, keys) {
  const grab = (block) => {
    const found = {};
    if (!block) return found;
    for (const key of keys) {
      const m = block.match(new RegExp(`--${key}\\s*:\\s*([^;]+);`));
      if (m) found[key] = m[1].trim();
    }
    return found;
  };

  const lightBlock = css.match(/:root\s*\{([\s\S]*?)\}/);
  const darkOuter = css.match(/@media[^{]*prefers-color-scheme:\s*dark[^{]*\{([\s\S]*?)\n\}/);
  const darkBlock = darkOuter ? darkOuter[1].match(/:root\s*\{([\s\S]*?)\}/) : null;

  return {
    light: grab(lightBlock && lightBlock[1]),
    dark: grab(darkBlock && darkBlock[1]),
  };
}

/** Pull a numeric px value like `--radius: 10px` back out of a stylesheet. */
export function parsePx(css, name) {
  const m = css.match(new RegExp(`--${name}\\s*:\\s*([\\d.]+)px`));
  return m ? Number(m[1]) : null;
}
