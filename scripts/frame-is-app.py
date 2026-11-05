#!/usr/bin/env python3
"""Exit 0 when a simulator screenshot is the app, not the iOS home screen.

The home screen is a busy icon grid. FitMunch's first screen is a flat page.
"""

import struct
import sys
import zlib


def read_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("not a png")
    pos = 8
    width = height = color = None
    idat = b""
    while pos + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, _bit, color = struct.unpack(">IIBB", chunk[:10])
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    if width is None or color not in (2, 6):
        raise SystemExit("unsupported png")
    bpp = 4 if color == 6 else 3
    raw = zlib.decompress(idat)
    stride = width * bpp
    rows = []
    index = 0
    previous = bytearray(stride)

    def paeth(left, up, up_left):
        estimate = left + up - up_left
        distances = (
            abs(estimate - left),
            abs(estimate - up),
            abs(estimate - up_left),
        )
        return (left, up, up_left)[distances.index(min(distances))]

    for _y in range(height):
        filt = raw[index]
        index += 1
        row = bytearray(raw[index : index + stride])
        index += stride
        if filt == 1:
            for x in range(len(row)):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(len(row)):
                row[x] = (row[x] + previous[x]) & 255
        elif filt == 3:
            for x in range(len(row)):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + previous[x]) // 2)) & 255
        elif filt == 4:
            for x in range(len(row)):
                left = row[x - bpp] if x >= bpp else 0
                up_left = previous[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(left, previous[x], up_left)) & 255
        elif filt != 0:
            raise SystemExit(f"bad png filter {filt}")
        previous = row
        rows.append(row)
    return width, height, bpp, rows


def main():
    width, height, bpp, rows = read_png(sys.argv[1])
    x0, x1 = width // 5, width * 4 // 5
    y0, y1 = height // 5, height * 4 // 5
    step = max(4, width // 80)
    total = 0.0
    total_sq = 0.0
    saturated = 0
    count = 0
    for y in range(y0, y1, step):
        row = rows[y]
        for x in range(x0, x1, step):
            i = x * bpp
            red, green, blue = row[i], row[i + 1], row[i + 2]
            lum = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255.0
            total += lum
            total_sq += lum * lum
            if max(red, green, blue) - min(red, green, blue) > 40:
                saturated += 1
            count += 1
    if count == 0:
        raise SystemExit("empty sample")
    mean = total / count
    variance = max(0.0, total_sq / count - mean * mean)
    std = variance ** 0.5
    color = saturated / count
    # SpringBoard is an icon grid: busy and saturated. The app page is flat.
    print(f"frame-std {std:.4f} color {color:.4f}")
    raise SystemExit(0 if std < 0.20 and color < 0.12 else 2)


if __name__ == "__main__":
    main()
