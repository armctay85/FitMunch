#!/usr/bin/env python3
"""Frame native simulator captures in the FitMunch storyboard style.

Expects raw simctl shots at the canvas size, with the status bar
overridden to 9:41 and demo data seeded by ScreenshotLaunch. Supported
canvases: 1320x2868, 1242x2688, and 1284x2778. The capture is placed at
88% of the canvas width. A smaller simulator is never scaled up.

Headlines are a heavy grotesk at 96 to 110pt, two lines maximum, and
40 characters maximum. Build 9 has no shopping-list screen, so that
frame is omitted.

Usage:
  python3 scripts/frame-appstore-screenshots.py RAW_DIR OUT_DIR
      [--width 1320 --height 2868]
      [--stamp "pipeline test, not for upload"]
      [--contact-sheet path.png]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

# dark=True uses the darker green so the set has a rhythm.
# Shopping-list frame is omitted: the iOS app has no shopping-list screen.
CAPTIONS = [
    ("01-scan.png", "scan.png", "Scan your shop. Know your macros.", False),
    ("02-home.png", "home.png", "Hit your protein. Every day.", True),
    ("03-meals.png", "plan.png", "High-protein week, built from your shop.", False),
    ("04-coach.png", "coach.png", "Ask your AI coach anything.", True),
    ("05-workout.png", "workout.png", "Train with a plan that fits your week.", False),
    ("06-start.png", "settings.png", "Free to start. Built in Australia.", True),
]

ALLOWED = {(1320, 2868), (1242, 2688), (1284, 2778)}
BRAND = (0x15, 0x80, 0x3D)
BRAND_DARK = (0x0B, 0x3D, 0x22)
WHITE = (255, 255, 255)
STAMP = (232, 245, 236)
DEVICE_WIDTH = 0.88
FONT_PATH = Path(__file__).resolve().parent / "fonts" / "BricolageGrotesque-ExtraBold.ttf"


def load_font(size: int) -> ImageFont.FreeTypeFont:
    if not FONT_PATH.exists():
        raise SystemExit(f"missing font {FONT_PATH}")
    return ImageFont.truetype(str(FONT_PATH), size)


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
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, image.size[0] - 1, image.size[1] - 1),
        radius=radius,
        fill=255,
    )
    image.putalpha(mask)
    return image


def headline_size(canvas_w: int) -> int:
    scaled = round(110 * canvas_w / 1320)
    return max(96, min(110, scaled))


def fit_lines(text: str, max_width: int, max_height: int, canvas_w: int) -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    if len(text) > 40:
        raise SystemExit(f"caption is {len(text)} chars, maximum is 40: {text}")
    size = headline_size(canvas_w)
    while size >= 96:
        font = load_font(size)
        lines = wrap(text, font, max_width)
        line_gap = int(size * 0.12)
        line_height = size + line_gap
        block = line_height * len(lines) - line_gap
        if len(lines) <= 2 and block <= max_height:
            return font, lines, line_height
        size -= 2
    raise SystemExit(f"caption does not fit in 2 lines at 96pt: {text}")


def frame_one(
    src: Path,
    dest: Path,
    headline: str,
    stamp: str | None,
    canvas_size: tuple[int, int],
    dark: bool,
) -> None:
    shot = Image.open(src).convert("RGBA")
    if shot.size != canvas_size:
        raise SystemExit(
            f"{src.name} is {shot.size[0]}x{shot.size[1]}, expected {canvas_size[0]}x{canvas_size[1]}. "
            "Do not scale a smaller simulator into the frame."
        )

    width, height = canvas_size
    bg = BRAND_DARK if dark else BRAND
    canvas = Image.new("RGBA", canvas_size, bg + (255,))
    phone_w = int(width * DEVICE_WIDTH)
    phone_h = int(phone_w * shot.height / shot.width)
    bottom = max(12, int(height * 0.006))
    y_shot = height - bottom - phone_h
    text_width = int(width * 0.90)

    stamp_block = 0
    stamp_font = None
    if stamp:
        stamp_font = load_font(22)
        stamp_block = 30

    top_pad = int(height * 0.008)
    gap = int(height * 0.008)
    headline_room = y_shot - top_pad - stamp_block - gap
    font, lines, line_height = fit_lines(headline, text_width, headline_room, width)
    text_block = line_height * len(lines) - int(font.size * 0.14)
    content_h = stamp_block + text_block
    y = top_pad + max(0, (headline_room - content_h) // 2)

    draw = ImageDraw.Draw(canvas)
    if stamp and stamp_font is not None:
        tw = stamp_font.getlength(stamp)
        draw.text(((width - tw) / 2, y), stamp, font=stamp_font, fill=STAMP)
        y += stamp_block

    for line in lines:
        tw = font.getlength(line)
        draw.text(((width - tw) / 2, y), line, font=font, fill=WHITE)
        y += line_height

    radius = max(36, int(phone_w * 0.125))
    resized = rounded(shot.resize((phone_w, phone_h), Image.Resampling.LANCZOS), radius)
    x = (width - phone_w) // 2
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (x, y_shot + 16, x + phone_w, y_shot + phone_h + 26),
        radius=radius,
        fill=(0, 0, 0, 80),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(resized, (x, y_shot), resized)

    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(dest, "PNG", optimize=True)
    print(
        f"{dest.name} {width}x{height} device {phone_w}x{phone_h} "
        f"({phone_w / width:.0%} wide) {font.size}pt"
    )


def contact_sheet(frames: list[Path], dest: Path, stamp: str | None) -> None:
    thumbs = []
    thumb_w = 360
    for path in frames:
        image = Image.open(path).convert("RGB")
        thumb_h = int(thumb_w * image.height / image.width)
        thumbs.append(image.resize((thumb_w, thumb_h), Image.Resampling.LANCZOS))

    cols = 4
    gap = 28
    banner_h = 88 if stamp else 24
    rows = (len(thumbs) + cols - 1) // cols
    sheet_w = cols * thumb_w + (cols + 1) * gap
    sheet_h = banner_h + rows * (thumbs[0].height + gap) + gap
    sheet = Image.new("RGB", (sheet_w, sheet_h), BRAND)
    draw = ImageDraw.Draw(sheet)
    if stamp:
        font = load_font(36)
        tw = font.getlength(stamp)
        draw.text(((sheet_w - tw) / 2, 26), stamp, font=font, fill=WHITE)
    for index, thumb in enumerate(thumbs):
        col = index % cols
        row = index // cols
        x = gap + col * (thumb_w + gap)
        y = banner_h + gap + row * (thumb.height + gap)
        sheet.paste(thumb, (x, y))
    dest.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(dest, "PNG", optimize=True)
    print(f"contact sheet {dest} {sheet.size[0]}x{sheet.size[1]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Frame FitMunch captures.")
    parser.add_argument("raw_dir", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--width", type=int, default=1320)
    parser.add_argument("--height", type=int, default=2868)
    parser.add_argument("--stamp", default="", help="Label burned onto each frame, such as a pipeline test.")
    parser.add_argument("--contact-sheet", type=Path, default=None)
    args = parser.parse_args()
    canvas_size = (args.width, args.height)
    if canvas_size not in ALLOWED:
        raise SystemExit(f"unsupported canvas {args.width}x{args.height}")
    stamp = args.stamp.strip() or None

    written: list[Path] = []
    for filename, source_name, headline, dark in CAPTIONS:
        src = args.raw_dir / source_name
        if not src.exists():
            raise SystemExit(f"missing {src}")
        dest = args.out_dir / filename
        frame_one(src, dest, headline, stamp, canvas_size, dark)
        written.append(dest)

    if args.contact_sheet is not None:
        contact_sheet(written, args.contact_sheet, stamp)


if __name__ == "__main__":
    main()
