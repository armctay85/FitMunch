#!/usr/bin/env python3
"""Choose the system launch screenshot: white field, green mark, no tab bar."""

import struct
import sys
import zlib
from pathlib import Path


def read_png(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    pos = 8
    width = height = color = None
    idat = b""
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        pos += 8
        chunk = data[pos : pos + length]
        pos += length + 4
        if kind == b"IHDR":
            width, height, _bit, color, _comp, _filt, _inter = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    raw = zlib.decompress(idat)
    bpp = {2: 3, 6: 4}[color]
    stride = width * bpp
    rows = []
    index = 0
    prev = bytearray(stride)

    def paeth(a, b, c):
        estimate = a + b - c
        pa, pb, pc = abs(estimate - a), abs(estimate - b), abs(estimate - c)
        if pa <= pb and pa <= pc:
            return a
        return b if pb <= pc else c

    for _y in range(height):
        filt = raw[index]
        index += 1
        row = bytearray(raw[index : index + stride])
        index += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(a, b, c)) & 255
        elif filt != 0:
            raise SystemExit(f"unsupported PNG filter {filt} in {path}")
        rows.append(row)
        prev = row
    return width, height, bpp, rows


def score(path: Path):
    width, height, bpp, rows = read_png(path)
    white = green = dark_bottom = dark_top = 0
    samples = center_samples = bottom_samples = top_samples = 0
    for y in range(0, height, 8):
        row = rows[y]
        for x in range(0, width, 8):
            i = x * bpp
            red, green_c, blue = row[i], row[i + 1], row[i + 2]
            samples += 1
            if red > 245 and green_c > 245 and blue > 245:
                white += 1
            if height * 0.32 < y < height * 0.68 and width * 0.28 < x < width * 0.72:
                center_samples += 1
                if green_c > 140 and green_c > red + 30 and green_c > blue + 10 and red < 120:
                    green += 1
            if y > height * 0.90:
                bottom_samples += 1
                if red < 90 and green_c < 90 and blue < 90:
                    dark_bottom += 1
            if height * 0.08 < y < height * 0.20:
                top_samples += 1
                if red < 40 and green_c < 40 and blue < 40:
                    dark_top += 1
    white_ratio = white / max(samples, 1)
    green_ratio = green / max(center_samples, 1)
    dark_bottom_ratio = dark_bottom / max(bottom_samples, 1)
    dark_top_ratio = dark_top / max(top_samples, 1)
    value = white_ratio * 3 + green_ratio * 6 - dark_bottom_ratio * 5 - dark_top_ratio * 3
    # The system launch screen is almost entirely white. Today and the paywall are not.
    ok = white_ratio > 0.85 and green_ratio > 0.008 and dark_bottom_ratio < 0.08 and dark_top_ratio < 0.12
    print(
        f"{path.name} {width}x{height} white={white_ratio:.3f} green={green_ratio:.3f} "
        f"dark_bottom={dark_bottom_ratio:.3f} dark_top={dark_top_ratio:.3f} "
        f"score={value:.3f} ok={ok}"
    )
    return ok, value, path


def main() -> None:
    source = Path(sys.argv[1])
    dest = Path(sys.argv[2])
    candidates = sorted(path for path in source.glob("*.png") if path.is_file())
    if not candidates:
        log = source / "log.txt"
        if log.is_file():
            print(log.read_text()[-2000:])
        sys.exit(f"no launch screenshot in {source}")
    ranked = []
    for path in candidates:
        try:
            ranked.append(score(path))
        except SystemExit as error:
            print(f"skip {path.name}: {error}")
        except Exception as error:
            print(f"skip {path.name}: {error}")
    if not ranked:
        sys.exit(f"no readable launch screenshot in {source}")
    ranked.sort(key=lambda item: item[1], reverse=True)
    ok, _value, path = ranked[0]
    if not ok:
        sys.exit("no candidate looks like the system launch screen")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(path.read_bytes())
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
