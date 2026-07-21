#!/usr/bin/env python3
"""Stamp service-worker.js with a generated cache version and precache list.

This is NOT part of running the app — it is a deploy-time step, kept in the repo so
the stamping is reproducible rather than a mystery. It uses only the Python standard
library, so there is nothing to install.

    python3 tools/stamp-sw.py            # rewrite service-worker.js in place
    python3 tools/stamp-sw.py --print    # show what it would write, touch nothing

It fixes two release hazards, both caused by hand-maintained constants:

1. CACHE_VERSION had to be bumped by hand on every deploy. Forget, and the cache-first
   worker keeps serving the old build — which looks exactly like "my change is broken".
2. SHELL had to list every precached file by hand. Forget a new file, and the app works
   perfectly online and 404s at the table with no signal.

The version is a hash of the precached files' *contents*, so a docs-only change does not
needlessly bust every player's cache.

Note that service-worker.js stays a valid, working file in the repo — this rewrites two
real values rather than filling in placeholders. That matters because localhost is a
secure context, so the worker registers under Live Server too; a repo copy full of
placeholders would break local development.
"""

import argparse
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, os.pardir))
WORKER = os.path.join(ROOT, "service-worker.js")

# Only files the browser actually fetches. An allowlist rather than a denylist: a new
# file type is far more likely to be a stray note than something the app needs offline,
# and precaching junk is a silent cost paid by every phone.
PRECACHE_SUFFIXES = (
    ".html", ".css", ".js", ".webmanifest", ".json",
    ".svg", ".png", ".woff2",
)

# Never walked into. tools/ and .github/ are development-time; backups/ is exported
# character data (user data, gitignored) and must not be baked into a deploy.
SKIP_DIRS = {".git", ".github", "tools", "backups", "node_modules"}

# The worker cannot meaningfully precache itself: the browser fetches it out of band
# and caching it is how you get a worker that can never update.
SKIP_FILES = {"service-worker.js"}

# The bare directory URL is what a cold launch at the site root actually requests, and
# it is a distinct cache entry from './index.html'. It has no file of its own to walk to,
# so it is prepended by hand. The fetch handler's navigate fallback would paper over a
# miss here, but only after a failed request — precaching it keeps the offline open clean.
ROOT_URL = "./"


def collect(root):
    """Return the precache paths, as './'-prefixed relative URLs, sorted."""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        # Mutate in place so os.walk does not descend into them at all.
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for name in sorted(filenames):
            if name in SKIP_FILES or name.startswith("."):
                continue
            if not name.endswith(PRECACHE_SUFFIXES):
                continue
            rel = os.path.relpath(os.path.join(dirpath, name), root)
            found.append("./" + rel.replace(os.sep, "/"))
    return sorted(found)


def version_for(root, paths):
    """Short content hash over the precached files.

    Both the path and the bytes go into the digest, so renaming a file changes the
    version even when its contents are untouched.
    """
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.encode("utf-8"))
        with open(os.path.join(root, path[2:]), "rb") as handle:
            digest.update(handle.read())
    return digest.hexdigest()[:12]


def render(source, version, paths):
    """Replace the CACHE_VERSION and SHELL literals, leaving the rest untouched."""
    listing = "\n".join(f"  '{path}'," for path in [ROOT_URL, *paths])

    source, version_hits = re.subn(
        r"^const CACHE_VERSION = '[^']*';$",
        f"const CACHE_VERSION = '{version}';",
        source,
        count=1,
        flags=re.MULTILINE,
    )
    source, shell_hits = re.subn(
        r"^const SHELL = \[\n.*?^\];$",
        f"const SHELL = [\n{listing}\n];",
        source,
        count=1,
        flags=re.MULTILINE | re.DOTALL,
    )

    # A silent no-op here would ship an unstamped worker and reintroduce both hazards,
    # so refuse loudly instead. This fires if someone reformats those declarations.
    if version_hits != 1:
        raise SystemExit("stamp-sw: could not find the CACHE_VERSION declaration")
    if shell_hits != 1:
        raise SystemExit("stamp-sw: could not find the SHELL declaration")
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--print",
        dest="dry_run",
        action="store_true",
        help="show the version and precache list without writing anything",
    )
    args = parser.parse_args()

    paths = collect(ROOT)
    version = version_for(ROOT, paths)

    with open(WORKER, encoding="utf-8") as handle:
        before = handle.read()
    after = render(before, version, paths)

    # Deliberately no "is it already stamped?" check mode. The repo copy is never
    # committed stamped — stamping happens on deploy — so such a check would report
    # "stale" forever and mean nothing.
    if args.dry_run:
        print(f"stamp-sw: {version}")
        for path in [ROOT_URL, *paths]:
            print(f"  {path}")
        return 0

    if before != after:
        with open(WORKER, "w", encoding="utf-8") as handle:
            handle.write(after)
    print(f"stamp-sw: {version}, {len(paths)} files precached")
    return 0


if __name__ == "__main__":
    sys.exit(main())
