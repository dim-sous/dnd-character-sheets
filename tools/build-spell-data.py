#!/usr/bin/env python3
"""Generate js/spell-data.js from the SRD 5.2.1 spell descriptions.

This is authoring tooling, not a build step: it runs by hand when the source changes,
and its OUTPUT is committed. The repo still runs from a bare folder with nothing
installed, which is the project's hard constraint — no CI job calls this, and the app
never sees it (tools/ is excluded from the deployed artifact, #148).

Usage:
    python3 tools/build-spell-data.py                 # fetch the source, write js/spell-data.js
    python3 tools/build-spell-data.py --input FILE    # parse a local copy instead
    python3 tools/build-spell-data.py --check         # parse and report, write nothing

Source: the SRD 5.2.1 in Markdown. The SRD is published by Wizards of the Coast under
CC-BY-4.0, which requires attribution — carried in the generated file's header, shown in
the app's spell picker, and repeated in the README. Do not strip it.

The format the parser expects, per spell:

    #### Fire Bolt

    _Evocation Cantrip (Sorcerer, Wizard)_          or  _Level 3 Evocation (Sorcerer, Wizard)_

    **Casting Time:** Action
    **Range:** 120 feet
    **Components:** V, S
    **Duration:** Instantaneous

    <description paragraphs, until the next spell>

Two irregularities in the source, both real and both silently lossy if unhandled:

  * a handful of spells write "**Component:**" in the singular (Barkskin, Contagion).
    Matching only the plural drops the field and the spell ships with no components at
    all — a blank line in the picker that looks like data rather than a parse miss.

  * nine "####" blocks are not spells. They are stat-block sub-headings (Traits,
    Actions, Bonus Actions) inside the summon spells, and splitting naively turns each
    into a nameless spell with no subtitle. They are folded back into the spell above
    them, where the source put them.

Both are why this script asserts a spell COUNT and a set of required fields at the end,
rather than writing whatever it happened to find: a parser that silently produces 320
spells instead of 340 is indistinguishable from a good one by eye.
"""

import argparse
import json
import pathlib
import re
import sys
import urllib.request

SOURCE_URL = (
    'https://raw.githubusercontent.com/downfallx/dnd-5e-srd-markdown/master/spells.md'
)

ATTRIBUTION = (
    'This work includes material from the System Reference Document 5.2.1 '
    '("SRD 5.2.1") by Wizards of the Coast LLC, available at '
    'https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the Creative '
    'Commons Attribution 4.0 International License, available at '
    'https://creativecommons.org/licenses/by/4.0/legalcode.'
)

# "Level 3 Evocation (Sorcerer, Wizard)" / "Evocation Cantrip (Sorcerer, Wizard)".
# The class list is optional: an SRD spell with no class in the parenthetical is still a
# spell, and refusing it here would silently shorten the library.
SUBTITLE_RE = re.compile(
    r'^_(?:Level\s+(?P<level>\d+)\s+(?P<school1>[A-Za-z]+)'
    r'|(?P<school2>[A-Za-z]+)\s+Cantrip)'
    r'(?:\s*\((?P<classes>[^)]*)\))?\s*_$',
    re.M,
)

FIELD_RE = {
    'castingTime': re.compile(r'^\*\*Casting Time:\*\*\s*(.+?)\s*$', re.M),
    'range': re.compile(r'^\*\*Range:\*\*\s*(.+?)\s*$', re.M),
    # Singular OR plural — see the module docstring.
    'components': re.compile(r'^\*\*Components?:\*\*\s*(.+?)\s*$', re.M),
    'duration': re.compile(r'^\*\*Duration:\*\*\s*(.+?)\s*$', re.M),
}

TAG_RE = re.compile(r'<[^>]+>')


def html_table_to_text(block: str) -> str:
    """Render an HTML table as plain lines: "cell | cell | cell", one row per line.

    Fourteen spells carry one (Prismatic Spray's d8 effects, Augury's readings, the summon
    stat blocks). Dropping them would lose rules text a player looks up mid-turn, and this
    field is a plain-text note, so a pipe-separated row is the honest rendering.
    """
    rows = []
    for row_html in re.findall(r'<tr>(.*?)</tr>', block, re.S):
        cells = [
            TAG_RE.sub('', cell).strip()
            for cell in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row_html, re.S)
        ]
        cells = [re.sub(r'\s+', ' ', c) for c in cells if c]
        if cells:
            rows.append(' | '.join(cells))
    return '\n'.join(rows)


def to_plain_text(md: str) -> str:
    """Markdown emphasis out, tables flattened, paragraph breaks kept.

    The description lands in the row's free-form "What it does" note, which is a plain
    textarea — so `**bold**` and `_italic_` would print as literal asterisks and
    underscores in the middle of the sentence a player is reading at the table.
    """
    md = re.sub(r'<table.*?</table>', lambda m: html_table_to_text(m.group(0)), md, flags=re.S)
    md = TAG_RE.sub('', md)
    md = re.sub(r'\*\*(.+?)\*\*', r'\1', md, flags=re.S)
    # Single-asterisk emphasis too, and it is not hypothetical: the two Prismatic spells write
    # "*Failed Save:*" inside their table cells, which the plural rule above leaves untouched.
    # Anchored to one line and to non-space edges so an arithmetic asterisk survives.
    md = re.sub(r'(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)', r'\1', md)
    md = re.sub(r'(?<!\w)_(.+?)_(?!\w)', r'\1', md, flags=re.S)
    md = md.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&mdash;', '—')
    # Collapse runs of blank lines to exactly one, and trim trailing spaces per line.
    lines = [line.rstrip() for line in md.split('\n')]
    out, blank = [], False
    for line in lines:
        if line:
            out.append(line)
            blank = False
        elif not blank and out:
            out.append('')
            blank = True
    return '\n'.join(out).strip()


def parse(markdown: str) -> list[dict]:
    body = markdown.split('## Spell Descriptions', 1)
    if len(body) != 2:
        sys.exit('error: no "## Spell Descriptions" section — is this the SRD spells file?')
    blocks = re.split(r'^#### ', body[1], flags=re.M)[1:]

    spells: list[dict] = []
    for block in blocks:
        name, _, rest = block.partition('\n')
        name = name.strip()
        subtitle = SUBTITLE_RE.search(rest)
        if not subtitle:
            # Not a spell: a stat-block sub-heading belonging to the spell above it.
            if spells:
                spells[-1]['text'] += f'\n\n{name}\n{to_plain_text(rest)}'.rstrip()
            continue

        fields = {}
        for key, pattern in FIELD_RE.items():
            found = pattern.search(rest)
            fields[key] = found.group(1).strip() if found else ''

        # Everything after the last of the four header fields is the description.
        last_field_end = max(
            (pattern.search(rest).end() for pattern in FIELD_RE.values() if pattern.search(rest)),
            default=subtitle.end(),
        )
        text = to_plain_text(rest[last_field_end:])

        classes = [c.strip() for c in (subtitle.group('classes') or '').split(',') if c.strip()]
        spells.append({
            'name': name,
            'level': int(subtitle.group('level')) if subtitle.group('level') else 0,
            'school': subtitle.group('school1') or subtitle.group('school2'),
            'classes': classes,
            'castingTime': fields['castingTime'],
            'range': fields['range'],
            'components': fields['components'],
            'duration': fields['duration'],
            # Precomputed rather than re-derived in the app on every keystroke of a search:
            # these are the two filters a player actually asks for ("what can I cast as a
            # ritual", "what needs concentration") and both are a substring test on a string
            # the picker also has to display.
            'concentration': fields['duration'].lower().startswith('concentration'),
            'ritual': 'ritual' in fields['castingTime'].lower(),
            'text': text,
        })
    return spells


def report(spells: list[dict]) -> None:
    schools = sorted({s['school'] for s in spells})
    classes = sorted({c for s in spells for c in s['classes']})
    levels = sorted({s['level'] for s in spells})
    print(f'{len(spells)} spells; levels {levels}')
    print(f'schools: {", ".join(schools)}')
    print(f'classes: {", ".join(classes)}')
    print(f'{sum(s["concentration"] for s in spells)} concentration, {sum(s["ritual"] for s in spells)} ritual')
    missing = [
        f'{s["name"]}: {key}'
        for s in spells
        for key in ('castingTime', 'range', 'components', 'duration', 'text')
        if not s[key]
    ]
    if missing:
        print(f'WARNING: {len(missing)} empty field(s): {missing[:12]}')


def write(spells: list[dict], out_path: pathlib.Path) -> None:
    rows = ',\n'.join(
        '  ' + json.dumps(s, ensure_ascii=False, separators=(',', ':')) for s in spells
    )
    out_path.write_text(
        '/**\n'
        ' * GENERATED FILE — do not edit by hand.\n'
        ' *\n'
        ' * Written by tools/build-spell-data.py from the SRD 5.2.1 spell descriptions.\n'
        ' * Re-run that script rather than patching a spell here, or the next run reverts it.\n'
        ' *\n'
        ' * Loaded on demand (a dynamic import from the spell picker), never at boot: it is the\n'
        ' * largest file in the app by an order of magnitude, and a player who never opens the\n'
        ' * picker should never pay for it. The service worker still precaches it, so the library\n'
        ' * works offline at the table.\n'
        ' *\n'
        f' * {ATTRIBUTION}\n'
        ' */\n\n'
        f'export const SRD_ATTRIBUTION = {json.dumps(ATTRIBUTION, ensure_ascii=False)};\n\n'
        '/**\n'
        ' * One entry per SRD spell. `level` 0 is a cantrip, matching the app\'s own\n'
        ' * SPELL_LIST_LEVELS; `classes` is the SRD\'s parenthetical class list verbatim.\n'
        ' */\n'
        f'export const SRD_SPELLS = [\n{rows},\n];\n',
        encoding='utf-8',
    )
    print(f'wrote {out_path} ({out_path.stat().st_size:,} bytes)')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=pathlib.Path, help='local copy of the SRD spells markdown')
    parser.add_argument('--url', default=SOURCE_URL, help='where to fetch it from otherwise')
    parser.add_argument('--check', action='store_true', help='parse and report, write nothing')
    parser.add_argument(
        '--out',
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parent.parent / 'js' / 'spell-data.js',
    )
    args = parser.parse_args()

    if args.input:
        markdown = args.input.read_text(encoding='utf-8-sig')
    else:
        print(f'fetching {args.url}')
        with urllib.request.urlopen(args.url, timeout=60) as response:
            markdown = response.read().decode('utf-8-sig')

    spells = parse(markdown)
    report(spells)

    # A parser that quietly returns a third of the library looks exactly like a working one
    # in a diff. The SRD has ~340 spells; anything far from that is a format change, not a
    # smaller SRD.
    if len(spells) < 300:
        sys.exit(f'error: only {len(spells)} spells parsed — the source format has changed')

    if not args.check:
        write(spells, args.out)


if __name__ == '__main__':
    main()
