#!/usr/bin/env python3
"""Generate StackNote PWA icons using only the Python standard library.

Design: dark navy rounded square, with two overlapping "note cards" in an
indigo -> cyan gradient and three text lines on the front card.

Run:  python3 tools/generate-icons.py
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

BG_TOP = (10, 15, 28)
BG_BOTTOM = (22, 34, 74)
ACCENT_TOP = (99, 102, 241)
ACCENT_BOTTOM = (34, 211, 238)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def sdf(x, y, x0, y0, x1, y1, r):
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    hw, hh = (x1 - x0) / 2, (y1 - y0) / 2
    qx = abs(x - cx) - (hw - r)
    qy = abs(y - cy) - (hh - r)
    return min(max(qx, qy), 0.0) + math.hypot(max(qx, 0.0), max(qy, 0.0)) - r


def back_sheet(x, y):
    return sdf(x, y, 0.30, 0.15, 0.82, 0.68, 0.075) <= 0


def front_sheet(x, y):
    return sdf(x, y, 0.18, 0.30, 0.70, 0.84, 0.075) <= 0


def text_line(x, y):
    return (sdf(x, y, 0.255, 0.435, 0.625, 0.478, 0.019) <= 0 or
            sdf(x, y, 0.255, 0.525, 0.625, 0.568, 0.019) <= 0 or
            sdf(x, y, 0.255, 0.615, 0.510, 0.658, 0.019) <= 0)


def background(x, y):
    bg = list(mix(BG_TOP, BG_BOTTOM, y))
    g1 = math.exp(-((x - 0.18) ** 2 + (y - 0.10) ** 2) / (2 * 0.34 ** 2)) * 0.20
    g2 = math.exp(-((x - 0.88) ** 2 + (y - 0.92) ** 2) / (2 * 0.40 ** 2)) * 0.16
    for i in range(3):
        bg[i] += (ACCENT_TOP[i] - bg[i]) * g1 + (ACCENT_BOTTOM[i] - bg[i]) * g2
    if -0.008 <= sdf(x, y, 0, 0, 1, 1, 0.225) <= 0:
        bg = [min(255.0, c + 26) for c in bg]
    return bg


def render(size, ss=2, square=False, shrink=1.0):
    inv = 1.0 / (ss * ss)
    rows = []
    for py in range(size):
        row = []
        for px in range(size):
            r_total = g_total = b_total = a_total = 0.0
            for sy in range(ss):
                yy = (py + (sy + 0.5) / ss) / size
                for sx in range(ss):
                    xx = (px + (sx + 0.5) / ss) / size
                    gx = 0.5 + (xx - 0.5) / shrink
                    gy = 0.5 + (yy - 0.5) / shrink
                    bg = background(xx, yy)
                    accent = mix(ACCENT_TOP, ACCENT_BOTTOM, max(0.0, min(1.0, (gy - 0.28) / 0.58)))
                    if front_sheet(gx, gy):
                        col = BG_TOP if text_line(gx, gy) else accent
                    elif back_sheet(gx, gy):
                        col = tuple(bg[i] * 0.55 + accent[i] * 0.45 for i in range(3))
                    else:
                        col = bg
                    alpha = 1.0 if square else (1.0 if sdf(xx, yy, 0, 0, 1, 1, 0.225) <= 0 else 0.0)
                    r_total += col[0] * alpha
                    g_total += col[1] * alpha
                    b_total += col[2] * alpha
                    a_total += alpha
            row.append((int(r_total * inv + 0.5), int(g_total * inv + 0.5),
                        int(b_total * inv + 0.5), int(a_total * inv * 255 + 0.5)))
        rows.append(row)
    return rows


def write_png(path, rows):
    h, w = len(rows), len(rows[0])
    raw = bytearray()
    for row in rows:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((max(0, min(255, r)), max(0, min(255, g)),
                          max(0, min(255, b)), max(0, min(255, a))))

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    blob = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(blob)
    return len(blob)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, dict(ss=3)),
        ("icon-512.png", 512, dict(ss=2)),
        ("icon-maskable-512.png", 512, dict(ss=2, square=True, shrink=1.28)),
        ("apple-touch-icon.png", 180, dict(ss=3, square=True)),
    ]
    for name, size, kw in jobs:
        path = os.path.join(OUT, name)
        n = write_png(path, render(size, **kw))
        print("%s: %dx%d, %d bytes" % (path, size, size, n))
