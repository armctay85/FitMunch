#!/usr/bin/env python3
"""Place a short benefit headline on real SwiftUI App Store captures.

Reads raw simulator PNGs and writes 1290x2796 and 2064x2752 frames.
Does not draw a fake device or a fake screen. The pixels under the headline
are the captured app.

Usage:
  python3 scripts/frame-appstore-screenshots.py RAW_DIR OUT_DIR WIDTH HEIGHT
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HEADLINES = [
    ("01-home.png", "home.png", "See today's calories and macros"),
    ("02-coach.png", "coach.png", "Ask what to eat after training"),
    ("03-meals.png", "plan.png", "Plan a high-protein week"),
    ("04-workout.png", "workout.png", "A weekly gym or home plan"),
    ("05-scan.png", "scan.png", "Scan a Woolies or Coles receipt"),
    ("06-history.png", "history.png", "Look back across the week"),
    ("07-settings.png", "settings.png", "Metric units and notifications"),
]

FONT_BOLD = "/usr/share/fonts/truetype/macos/Inter-Bold.ttf"
BG = (244, 247, 242)
INK = (16, 42, 32)
ACCENT = (22, 163, 74)


def load_font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD, size)


def wrap(text: str, font: ImageFont.FreeTypeFont, max_width: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = word if not current else f"{current} {word}"
        if font.getlength(trial) <= max_width:
            current = trial
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def rounded(image: Image.Image, radius: int) -> Image.Image:
    image = image.convert("RGBA")
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.size[0], image.size[1]), radius=radius, fill=255)
    image.putalpha(mask)
    return image


def frame_one(src: Path, dest: Path, width: int, height: int, headline: str) -> None:
    shot = Image.open(src).convert("RGBA")
    canvas = Image.new("RGBA", (width, height), BG + (255,))
    draw = ImageDraw.Draw(canvas)

    side = int(width * 0.055)
    top = int(height * 0.045)
    bottom = int(height * 0.028)
    text_width = width - side * 2
    font_size = 78 if width < 1800 else 104
    font = load_font(font_size)
    lines = wrap(headline, font, text_width)
    while len(lines) > 2 and font_size > 48:
        font_size -= 4
        font = load_font(font_size)
        lines = wrap(headline, font, text_width)

    line_gap = int(font_size * 0.18)
    line_height = font_size + line_gap
    text_block = line_height * len(lines)
    y = top
    for line in lines:
        tw = font.getlength(line)
        draw.text(((width - tw) / 2, y), line, font=font, fill=INK)
        y += line_height

    bar_w = int(min(text_width, max(font.getlength(line) for line in lines)) * 0.28)
    bar_w = max(bar_w, 96)
    bar_y = y + int(font_size * 0.08)
    draw.rounded_rectangle(
        ((width - bar_w) / 2, bar_y, (width + bar_w) / 2, bar_y + max(8, width // 160)),
        radius=8,
        fill=ACCENT,
    )

    content_top = int(bar_y + max(8, width // 160) + height * 0.028)
    box_w = width - side * 2
    box_h = height - content_top - bottom
    scale = min(box_w / shot.width, box_h / shot.height)
    new_size = (max(1, int(shot.width * scale)), max(1, int(shot.height * scale)))
    resized = shot.resize(new_size, Image.Resampling.LANCZOS)
    radius = max(28, int(new_size[0] * 0.045))
    resized = rounded(resized, radius)

    x = (width - new_size[0]) // 2
    y_shot = content_top + (box_h - new_size[1]) // 2
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x, y_shot + 12, x + new_size[0], y_shot + new_size[1] + 18),
        radius=radius,
        fill=(16, 42, 32, 48),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(resized, (x, y_shot), resized)
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(dest, "PNG", optimize=True)
    print(f"{dest.name} {width}x{height} from {src.name}")


def main() -> None:
    if len(sys.argv) != 5:
        raise SystemExit("usage: frame-appstore-screenshots.py RAW_DIR OUT_DIR WIDTH HEIGHT")
    raw = Path(sys.argv[1])
    out = Path(sys.argv[2])
    width = int(sys.argv[3])
    height = int(sys.argv[4])
    for filename, source_name, headline in HEADLINES:
        src = raw / source_name
        if not src.exists():
            raise SystemExit(f"missing {src}")
        frame_one(src, out / filename, width, height, headline)


if __name__ == "__main__":
    main()
