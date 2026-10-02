#!/usr/bin/env python3
"""Place a bold white headline over a FitMunch-green frame.

The phone is the real SwiftUI capture, about 80% of the canvas, with no
crop and no stretch. The background is a dark green vertical gradient.

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
GREEN_TOP = (7, 40, 26)
GREEN_BOTTOM = (22, 92, 52)
WHITE = (255, 255, 255)


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


def vertical_gradient(width: int, height: int) -> Image.Image:
    column = Image.new("RGB", (1, height))
    pixels = column.load()
    span = max(1, height - 1)
    for y in range(height):
        t = y / span
        pixels[0, y] = tuple(int(GREEN_TOP[i] + (GREEN_BOTTOM[i] - GREEN_TOP[i]) * t) for i in range(3))
    return column.resize((width, height), Image.Resampling.BILINEAR)


def rounded(image: Image.Image, radius: int) -> Image.Image:
    image = image.convert("RGBA")
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.size[0] - 1, image.size[1] - 1), radius=radius, fill=255)
    image.putalpha(mask)
    return image


def frame_one(src: Path, dest: Path, width: int, height: int, headline: str) -> None:
    shot = Image.open(src).convert("RGBA")
    canvas = vertical_gradient(width, height).convert("RGBA")

    bottom_gap = int(height * 0.028)
    phone_h = int(height * 0.80)
    phone_w = max(1, int(phone_h * shot.width / shot.height))
    max_w = int(width * 0.86)
    if phone_w > max_w:
        phone_w = max_w
        phone_h = max(1, int(phone_w * shot.height / shot.width))

    text_width = int(width * 0.88)
    font_size = 96 if width < 1800 else 118
    font = load_font(font_size)
    lines = wrap(headline, font, text_width)
    while len(lines) > 2 and font_size > 56:
        font_size -= 4
        font = load_font(font_size)
        lines = wrap(headline, font, text_width)

    line_gap = int(font_size * 0.16)
    line_height = font_size + line_gap
    text_block = line_height * len(lines) - line_gap
    top_room = height - bottom_gap - phone_h
    min_room = text_block + int(height * 0.06)
    if top_room < min_room:
        phone_h = max(1, height - bottom_gap - min_room)
        phone_w = max(1, int(phone_h * shot.width / shot.height))
        if phone_w > max_w:
            phone_w = max_w
            phone_h = max(1, int(phone_w * shot.height / shot.width))
        top_room = height - bottom_gap - phone_h

    y_text = max(int(height * 0.02), (top_room - text_block) // 2)
    draw = ImageDraw.Draw(canvas)
    y = y_text
    for line in lines:
        tw = font.getlength(line)
        draw.text(((width - tw) / 2, y), line, font=font, fill=WHITE)
        y += line_height

    resized = shot.resize((phone_w, phone_h), Image.Resampling.LANCZOS)
    radius = max(36, int(phone_w * 0.125))
    resized = rounded(resized, radius)

    x = (width - phone_w) // 2
    y_shot = height - bottom_gap - phone_h
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x, y_shot + 18, x + phone_w, y_shot + phone_h + 28),
        radius=radius,
        fill=(0, 0, 0, 90),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(resized, (x, y_shot), resized)

    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(dest, "PNG", optimize=True)
    ratio = phone_h / height
    print(f"{dest.name} {width}x{height} phone {phone_w}x{phone_h} ({ratio:.0%}) from {src.name}")


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
