#!/usr/bin/env python3
"""Generate the app icons.

This is NOT part of running the app — it is a one-off asset generator, kept in the
repo so the icons are reproducible rather than mystery binaries. It uses only the
Python standard library (zlib + struct), so there is nothing to install.

    python3 tools/make-icons.py

Writes icons/icon-192.png, icon-512.png, apple-touch-icon.png and icon.svg.
"""

import math
import os
import struct
import zlib

OXBLOOD = (0x7B, 0x2D, 0x26)
PARCHMENT = (0xF4, 0xED, 0xE0)
GOLD = (0xB0, 0x83, 0x40)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, os.pardir, "icons")

SS = 3  # supersampling factor, for anti-aliased edges


def polygon(cx, cy, radius, sides, rotation=0.0):
    return [
        (
            cx + radius * math.cos(rotation + i * 2 * math.pi / sides),
            cy + radius * math.sin(rotation + i * 2 * math.pi / sides),
        )
        for i in range(sides)
    ]


def inside(point, verts):
    """Even-odd point-in-polygon test."""
    x, y = point
    result = False
    j = len(verts) - 1
    for i, (xi, yi) in enumerate(verts):
        xj, yj = verts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            result = not result
        j = i
    return result


def inside_rounded_rect(point, size, radius, inset=0.0):
    x, y = point
    lo, hi = inset, size - inset
    if not (lo <= x <= hi and lo <= y <= hi):
        return False
    cx = min(max(x, lo + radius), hi - radius)
    cy = min(max(y, lo + radius), hi - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def sample(x, y, size, maskable):
    """Colour of one sample point, or None for transparent."""
    # A maskable icon may be cropped to a circle, so keep the art inside the
    # inner 80% "safe zone" and let the background bleed to the edges.
    scale = 0.78 if maskable else 1.0
    cx = cy = size / 2

    if maskable:
        bg = True
    else:
        bg = inside_rounded_rect((x, y), size, size * 0.22)
    if not bg:
        return None

    r = size * 0.30 * scale
    hexagon = polygon(cx, cy, r, 6, rotation=-math.pi / 2)
    if not inside((x, y), hexagon):
        return OXBLOOD

    # Inner upward triangle, inscribed — reads as a d20.
    triangle = polygon(cx, cy + r * 0.10, r * 0.62, 3, rotation=-math.pi / 2)
    if inside((x, y), triangle):
        return GOLD
    return PARCHMENT


def render(size, maskable):
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc_r = acc_g = acc_b = acc_a = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    colour = sample(x, y, size, maskable)
                    if colour is not None:
                        acc_r += colour[0]
                        acc_g += colour[1]
                        acc_b += colour[2]
                        acc_a += 255
            n = SS * SS
            if acc_a == 0:
                row += bytes((0, 0, 0, 0))
            else:
                opaque = acc_a // 255
                row += bytes(
                    (acc_r // opaque, acc_g // opaque, acc_b // opaque, acc_a // n)
                )
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\x00" + row for row in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as handle:
        handle.write(png)
    print(f"  {os.path.relpath(path)}  ({len(png):,} bytes)")


def svg(size=512):
    cx = cy = size / 2
    r = size * 0.30
    hexagon = polygon(cx, cy, r, 6, rotation=-math.pi / 2)
    triangle = polygon(cx, cy + r * 0.10, r * 0.62, 3, rotation=-math.pi / 2)
    pts = lambda p: " ".join(f"{x:.1f},{y:.1f}" for x, y in p)
    hexcolour = lambda c: "#%02x%02x%02x" % c
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">
  <rect width="{size}" height="{size}" rx="{size * 0.22:.0f}" fill="{hexcolour(OXBLOOD)}"/>
  <polygon points="{pts(hexagon)}" fill="{hexcolour(PARCHMENT)}"/>
  <polygon points="{pts(triangle)}" fill="{hexcolour(GOLD)}"/>
</svg>
"""


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Generating icons:")

    for size, name, maskable in [
        (192, "icon-192.png", False),
        (512, "icon-512.png", False),
        (512, "icon-512-maskable.png", True),
        (180, "apple-touch-icon.png", False),
    ]:
        write_png(os.path.join(OUT_DIR, name), size, render(size, maskable))

    svg_path = os.path.join(OUT_DIR, "icon.svg")
    with open(svg_path, "w", encoding="utf-8") as handle:
        handle.write(svg())
    print(f"  {os.path.relpath(svg_path)}")


if __name__ == "__main__":
    main()
