#!/usr/bin/env python3
"""Apply the S3 App Store frames to raw simulator captures.

The capture script writes the real SwiftUI shots first. This step wraps each
PNG: solid #157A3C, a soft #15803D glow, the white FitMunch lockup, the
headline and subhead, then the capture scaled to 0.72 of the canvas with a
rounded clip and a flat shadow. Output is the same pixel size, RGB, no alpha.

The lockup is the web wordmark (public/brand/logo-wordmark.svg): the dark
banner rect is dropped, the letters are #FFFFFF, and the broccoli icon keeps
its own greens on a white tile (radius 22% of the tile). The icon is not
redrawn. Headlines use SF Pro when Core Text can hand Pillow a real file,
otherwise the vendored Inter Bold / Inter Medium faces (SIL OFL).
"""

from __future__ import annotations

import math
import re
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
except ImportError as exc:
    raise SystemExit(
        "S3 blocked: Pillow is not installed. It is free. "
        "python3 -m pip install pillow"
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
WORDMARK_SVG = ROOT / "public" / "brand" / "logo-wordmark.svg"
FONT_DIR = ROOT / "marketing" / "appstore" / "fonts"
SVG = "{http://www.w3.org/2000/svg}"

BG = (0x15, 0x7A, 0x3C)
GLOW = (0x15, 0x80, 0x3D)
SHADOW = (0x0B, 0x3D, 0x1E)
WHITE = (255, 255, 255)
SUBHEAD = (0xD9, 0xF2, 0xE1)

# File stem is the capture name. "/" in the spec is the line break.
SCREENS = {
    "scan": {
        "headline": ("Scan your shop.", "See every macro."),
        "subhead": "Every item's macros, a haul score and meal ideas.",
    },
    "plan": {
        "headline": ("Meals planned", "to your macros"),
        "subhead": "Set calories and protein. Get a 7-day plan.",
    },
    "home": {
        "headline": ("Your day of eating,", "at a glance"),
        "subhead": "Calories, protein, carbs and fat, meal by meal.",
    },
    "coach": {
        "headline": ("Ask what", "to eat next"),
        "subhead": "Nutrition and training answers, any time.",
    },
    "settings": {
        "headline": ("Your progress,", "all in one place"),
        "subhead": "Progress, plan and privacy settings together.",
    },
}

SIZES = {
    "iphone-69": (1320, 2868),
    "iphone-67": (1290, 2796),
    "iphone-65": (1242, 2688),
}

BANNED = ("cheap", "#1", "review", "$")


def at(fraction, total):
    return int(round(fraction * total))


def parse_hex(value):
    text = value.strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    return tuple(int(text[i : i + 2], 16) for i in (0, 2, 4))


def parse_offset(value):
    text = value.strip()
    if text.endswith("%"):
        return float(text[:-1]) / 100.0
    return float(text)


def parse_fill(value, gradients):
    text = value.strip()
    if text.lower() == "white":
        return ("solid", WHITE)
    if text.startswith("#"):
        return ("solid", parse_hex(text))
    if text.startswith("url("):
        gid = text.split("#", 1)[1].split(")", 1)[0]
        if gid not in gradients:
            raise SystemExit(f"wordmark fill references unknown gradient {gid}")
        return ("gradient", gradients[gid])
    raise SystemExit(f"wordmark uses an unsupported fill {text}")


def load_wordmark():
    """Read the real wordmark SVG. Skip the dark banner and the tagline."""
    if not WORDMARK_SVG.is_file():
        raise SystemExit(f"missing wordmark asset {WORDMARK_SVG}")
    root = ET.parse(WORDMARK_SVG).getroot()
    gradients = {}
    for grad in root.iter(SVG + "linearGradient"):
        gid = grad.get("id")
        stops = []
        for stop in list(grad):
            if not stop.tag.endswith("stop"):
                continue
            stops.append((parse_offset(stop.get("offset", "0")), parse_hex(stop.get("stop-color"))))
        if not stops:
            continue
        x1 = parse_offset(grad.get("x1", "0%"))
        y1 = parse_offset(grad.get("y1", "0%"))
        x2 = parse_offset(grad.get("x2", "100%"))
        y2 = parse_offset(grad.get("y2", "0%"))
        gradients[gid] = {"line": (x1, y1, x2, y2), "stops": stops}

    group = None
    for node in root.iter(SVG + "g"):
        transform = node.get("transform") or ""
        if "scale" in transform and "translate" in transform:
            group = node
            break
    if group is None:
        raise SystemExit("wordmark SVG has no icon group")
    match = re.search(
        r"translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)\s*scale\(\s*([-\d.]+)\s*\)",
        group.get("transform"),
    )
    if not match:
        raise SystemExit(f"unexpected icon transform {group.get('transform')}")
    translate_x = float(match.group(1))
    translate_y = float(match.group(2))
    group_scale = float(match.group(3))

    shapes = []
    for node in list(group):
        tag = node.tag.rsplit("}", 1)[-1]
        opacity = float(node.get("opacity", "1"))
        fill = parse_fill(node.get("fill", "none"), gradients)
        if tag == "circle":
            shapes.append(
                {
                    "kind": "ellipse",
                    "cx": float(node.get("cx")),
                    "cy": float(node.get("cy")),
                    "rx": float(node.get("r")),
                    "ry": float(node.get("r")),
                    "fill": fill,
                    "opacity": opacity,
                }
            )
        elif tag == "ellipse":
            shapes.append(
                {
                    "kind": "ellipse",
                    "cx": float(node.get("cx")),
                    "cy": float(node.get("cy")),
                    "rx": float(node.get("rx")),
                    "ry": float(node.get("ry")),
                    "fill": fill,
                    "opacity": opacity,
                }
            )
        elif tag == "rect":
            shapes.append(
                {
                    "kind": "rect",
                    "x": float(node.get("x", "0")),
                    "y": float(node.get("y", "0")),
                    "w": float(node.get("width")),
                    "h": float(node.get("height")),
                    "rx": float(node.get("rx", "0")),
                    "fill": fill,
                    "opacity": opacity,
                }
            )
        else:
            raise SystemExit(f"wordmark icon has an unexpected shape {tag}")
    if sum(1 for shape in shapes if shape["kind"] == "ellipse") < 3:
        raise SystemExit("wordmark icon is missing the broccoli florets")

    word = None
    for node in root.iter(SVG + "text"):
        content = "".join(node.itertext()).strip()
        if content == "FitMunch":
            word = node
            break
    if word is None:
        raise SystemExit("wordmark SVG is missing the FitMunch letters")

    layout = {
        "translate_x": translate_x,
        "translate_y": translate_y,
        "group_scale": group_scale,
        "tile_view": 512.0 * group_scale,
        "text_x": float(word.get("x")),
        "text_y": float(word.get("y")),
        "font_size": float(word.get("font-size")),
        "letter_spacing": float(word.get("letter-spacing", "0")),
        "text": "FitMunch",
        "shapes": shapes,
    }
    return layout


def sample_stops(stops, t):
    t = max(0.0, min(1.0, t))
    if t <= stops[0][0]:
        return stops[0][1]
    if t >= stops[-1][0]:
        return stops[-1][1]
    for (o0, c0), (o1, c1) in zip(stops, stops[1:]):
        if o0 <= t <= o1 and o1 > o0:
            u = (t - o0) / (o1 - o0)
            return tuple(int(round(c0[i] + (c1[i] - c0[i]) * u)) for i in range(3))
    return stops[-1][1]


def paint_shape(canvas, shape, ss):
    if shape["kind"] == "ellipse":
        cx = shape["cx"] * ss
        cy = shape["cy"] * ss
        rx = shape["rx"] * ss
        ry = shape["ry"] * ss
        box = (cx - rx, cy - ry, cx + rx, cy + ry)
        rx_px = 0.0
    else:
        box = (
            shape["x"] * ss,
            shape["y"] * ss,
            (shape["x"] + shape["w"]) * ss,
            (shape["y"] + shape["h"]) * ss,
        )
        rx_px = shape["rx"] * ss

    x0 = max(0, int(math.floor(box[0])))
    y0 = max(0, int(math.floor(box[1])))
    x1 = min(canvas.width, int(math.ceil(box[2])))
    y1 = min(canvas.height, int(math.ceil(box[3])))
    if x1 <= x0 or y1 <= y0:
        return canvas
    local_w = x1 - x0
    local_h = y1 - y0
    mask = Image.new("L", (local_w, local_h), 0)
    draw = ImageDraw.Draw(mask)
    local_box = (box[0] - x0, box[1] - y0, box[2] - x0, box[3] - y0)
    if shape["kind"] == "ellipse":
        draw.ellipse(local_box, fill=255)
    else:
        draw.rounded_rectangle(local_box, radius=rx_px, fill=255)

    opacity = shape["opacity"]
    fill_kind, fill = shape["fill"]
    color = Image.new("RGBA", (local_w, local_h))
    pixels = color.load()
    if fill_kind == "solid":
        alpha = int(round(255 * opacity))
        solid = (*fill, alpha)
        for y in range(local_h):
            for x in range(local_w):
                pixels[x, y] = solid
    else:
        x1g, y1g, x2g, y2g = fill["line"]
        dx = x2g - x1g
        dy = y2g - y1g
        den = dx * dx + dy * dy or 1.0
        bw = box[2] - box[0] or 1.0
        bh = box[3] - box[1] or 1.0
        base_alpha = 255.0 * opacity
        for y in range(local_h):
            v = ((y + y0) - box[1]) / bh
            for x in range(local_w):
                u = ((x + x0) - box[0]) / bw
                t = ((u - x1g) * dx + (v - y1g) * dy) / den
                rgb = sample_stops(fill["stops"], t)
                pixels[x, y] = (*rgb, int(round(base_alpha)))

    color.putalpha(ImageChops.multiply(color.getchannel("A"), mask))
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(color, (x0, y0))
    return Image.alpha_composite(canvas, layer)


def render_mark(layout, supersample=2):
    """Broccoli icon from the SVG paths, on a white rounded tile."""
    ss = supersample
    size = 512 * ss
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(tile)
    radius = 0.22 * (size - 1)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=(255, 255, 255, 255))
    canvas = Image.alpha_composite(canvas, tile)
    for shape in layout["shapes"]:
        canvas = paint_shape(canvas, shape, ss)
    return canvas


def measure(font, text, tracking):
    if not text:
        return 0.0
    width = 0.0
    for index, char in enumerate(text):
        width += font.getlength(char)
        if index != len(text) - 1:
            width += tracking
    return width


def draw_tracked(draw, x, baseline, text, font, fill, tracking):
    for index, char in enumerate(text):
        draw.text((x, baseline), char, font=font, fill=fill, anchor="ls")
        x += font.getlength(char)
        if index != len(text) - 1:
            x += tracking
    return x


def wrap_subhead(text, font, max_width):
    if measure(font, text, 0) <= max_width:
        return [text]
    words = text.split()
    dangling = {"a", "an", "and", "or", "the", "to", "of"}
    best = None
    for split in range(1, len(words)):
        left_words = words[:split]
        right_words = words[split:]
        left = " ".join(left_words)
        right = " ".join(right_words)
        left_w = measure(font, left, 0)
        right_w = measure(font, right, 0)
        if left_w > max_width or right_w > max_width:
            continue
        orphan = 0 if len(left_words) >= 2 and len(right_words) >= 2 else 1
        ended = left_words[-1].strip(".,").lower()
        hang = 1 if ended in dangling else 0
        score = (orphan, hang, abs(left_w - right_w))
        if best is None or score < best[0]:
            best = (score, [left, right])
    if best is None:
        raise SystemExit(f"subhead does not fit on two lines: {text}")
    lines = best[1]
    if " ".join(lines) != text:
        raise SystemExit(f"subhead wrap changed the copy: {lines}")
    return lines


def relative_luminance(rgb):
    def channel(value):
        c = value / 255.0
        if c <= 0.04045:
            return c / 12.92
        return ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(foreground, background):
    lighter = max(relative_luminance(foreground), relative_luminance(background))
    darker = min(relative_luminance(foreground), relative_luminance(background))
    return (lighter + 0.05) / (darker + 0.05)


def assert_copy():
    ratio = contrast_ratio(WHITE, BG)
    if ratio < 5.4:
        raise SystemExit(f"white on #157A3C contrast is {ratio:.2f}, below 5.4")
    for name, screen in SCREENS.items():
        for line in screen["headline"]:
            if len(line.split()) < 2:
                raise SystemExit(f"{name} headline has an orphan line: {line}")
            if len(screen["headline"]) > 2:
                raise SystemExit(f"{name} headline is more than 2 lines")
        blob = " ".join(screen["headline"]) + " " + screen["subhead"]
        lower = blob.lower()
        for token in BANNED:
            if token in lower:
                raise SystemExit(f"{name} copy contains {token}")


def open_face(path, size, weight, optical):
    try:
        font = ImageFont.truetype(str(path), size)
    except OSError:
        return None
    try:
        axes = font.get_variation_axes() or []
    except Exception:
        return font
    if not axes:
        return font
    values = []
    for axis in axes:
        name = axis.get("name", b"")
        if isinstance(name, bytes):
            name = name.decode("ascii", "ignore")
        tag = str(axis.get("tag", name)).lower()
        default = axis.get("default", (axis["minimum"] + axis["maximum"]) / 2)
        if "wght" in tag or "weight" in tag:
            values.append(max(axis["minimum"], min(axis["maximum"], weight)))
        elif "opsz" in tag or "optical" in tag:
            picked = axis["maximum"] if optical == "display" else axis["minimum"]
            values.append(max(axis["minimum"], min(axis["maximum"], picked)))
        else:
            values.append(default)
    try:
        font.set_variation_by_axes(values)
    except Exception:
        return None
    return font


def font_label(font):
    try:
        family, style = font.getname()
    except Exception:
        return "unknown"
    return f"{family} {style}".strip()


def sf_file_from_coretext(queries):
    if sys.platform != "darwin":
        return None
    swift = """
import CoreText
import Foundation
let queries = CommandLine.arguments.dropFirst()
for query in queries {
  let font = CTFontCreateWithName(query as CFString, 12, nil)
  let ps = CTFontCopyPostScriptName(font) as String
  let family = CTFontCopyFamilyName(font) as String
  let joined = ps + " " + family
  if !joined.localizedCaseInsensitiveContains("SF") { continue }
  guard let url = CTFontCopyAttribute(font, kCTFontURLAttribute) as? URL else { continue }
  print("\\(query)\\t\\(ps)\\t\\(url.path)")
}
"""
    try:
        result = subprocess.run(
            ["swift", "-e", swift, *queries],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    found = {}
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and Path(parts[2]).is_file():
            found[parts[0]] = parts[2]
    return found or None


def find_static_sf(tokens):
    roots = [
        Path("/System/Library/Fonts"),
        Path("/Library/Fonts"),
        Path.home() / "Library/Fonts",
    ]
    hits = []
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if path.suffix.lower() not in {".otf", ".ttf", ".ttc"}:
                continue
            stem = path.stem.lower().replace(" ", "").replace("-", "")
            if all(token in stem for token in tokens):
                hits.append(path)
    return hits


def resolve_fonts():
    """SF Pro Display Bold and SF Pro Text Medium, else vendored Inter."""
    inter_bold = FONT_DIR / "Inter-Bold.ttf"
    inter_medium = FONT_DIR / "Inter-Medium.ttf"
    if not inter_bold.is_file() or not inter_medium.is_file():
        raise SystemExit(
            "S3 blocked: Inter Bold and Inter Medium are not in "
            f"{FONT_DIR}. Those faces are the free fallback. Not buying a font."
        )

    display = find_static_sf(("sfpro", "display", "bold")) or find_static_sf(("sf", "display", "bold"))
    text = find_static_sf(("sfpro", "text", "medium")) or find_static_sf(("sf", "text", "medium"))
    if display and text:
        return {
            "headline": display[0],
            "subhead": text[0],
            "headline_weight": 700,
            "subhead_weight": 500,
            "headline_optical": "display",
            "subhead_optical": "text",
            "source": "sf-static",
        }

    variable = None
    for candidate in (
        Path("/System/Library/Fonts/SFNS.ttf"),
        Path("/System/Library/Fonts/SF-Pro.ttf"),
    ):
        if candidate.is_file():
            variable = candidate
            break
    if variable is None:
        probed = sf_file_from_coretext(
            [
                "SFProDisplay-Bold",
                ".SFNSDisplay-Bold",
                "SFProText-Medium",
                ".SFNS-Medium",
                ".SFNSText-Medium",
            ]
        )
        if probed:
            bold_path = probed.get("SFProDisplay-Bold") or probed.get(".SFNSDisplay-Bold")
            medium_path = (
                probed.get("SFProText-Medium")
                or probed.get(".SFNS-Medium")
                or probed.get(".SFNSText-Medium")
            )
            if bold_path and medium_path:
                return {
                    "headline": Path(bold_path),
                    "subhead": Path(medium_path),
                    "headline_weight": 700,
                    "subhead_weight": 500,
                    "headline_optical": "display",
                    "subhead_optical": "text",
                    "source": "sf-coretext",
                }
            variable = Path(next(iter(probed.values())))

    if variable is not None:
        return {
            "headline": variable,
            "subhead": variable,
            "headline_weight": 700,
            "subhead_weight": 500,
            "headline_optical": "display",
            "subhead_optical": "text",
            "source": "sf-variable",
        }

    return {
        "headline": inter_bold,
        "subhead": inter_medium,
        "headline_weight": 700,
        "subhead_weight": 500,
        "headline_optical": None,
        "subhead_optical": None,
        "source": "inter",
    }


def load_pair(spec, headline_size, subhead_size):
    headline = open_face(spec["headline"], headline_size, spec["headline_weight"], spec["headline_optical"])
    subhead = open_face(spec["subhead"], subhead_size, spec["subhead_weight"], spec["subhead_optical"])
    inter_bold = FONT_DIR / "Inter-Bold.ttf"
    inter_medium = FONT_DIR / "Inter-Medium.ttf"
    if headline is None or subhead is None:
        headline = open_face(inter_bold, headline_size, 700, None)
        subhead = open_face(inter_medium, subhead_size, 500, None)
        return headline, subhead, "Inter Bold", "Inter Medium"
    h_label = font_label(headline)
    s_label = font_label(subhead)
    if spec["source"] == "inter":
        return headline, subhead, h_label, s_label
    # A failed name match means Core Text substituted a different family.
    if "sf" not in h_label.lower() and "sf" not in Path(spec["headline"]).name.lower():
        headline = open_face(inter_bold, headline_size, 700, None)
        subhead = open_face(inter_medium, subhead_size, 500, None)
        return headline, subhead, font_label(headline), font_label(subhead)
    return headline, subhead, h_label, s_label


def fit_headline_size(width, spec):
    start = at(0.085, width)
    floor = at(0.073, width)
    max_width = 0.86 * width
    chosen = floor
    for size in range(start, floor - 1, -1):
        font, _, _, _ = load_pair(spec, size, max(1, size // 2))
        tracking = -0.005 * size
        if all(measure(font, line, tracking) <= max_width for line in next(iter(SCREENS.values()))["headline"]):
            # Check every screen, not just the first.
            ok = True
            for screen in SCREENS.values():
                if any(measure(font, line, tracking) > max_width for line in screen["headline"]):
                    ok = False
                    break
            if ok:
                chosen = size
                break
    return chosen


def glow_background(width, height):
    cx = 0.5 * width
    cy = 0.12 * height
    radius = 0.9 * width
    radius2 = radius * radius
    buf = bytearray(width * height * 3)
    index = 0
    for y in range(height):
        dy = (y + 0.5) - cy
        dy2 = dy * dy
        for x in range(width):
            dx = (x + 0.5) - cx
            dist2 = dx * dx + dy2
            if dist2 >= radius2:
                t = 0.0
            else:
                t = 1.0 - math.sqrt(dist2) / radius
                t = t * t * (3.0 - 2.0 * t)
            buf[index] = int(round(BG[0] + (GLOW[0] - BG[0]) * t))
            buf[index + 1] = int(round(BG[1] + (GLOW[1] - BG[1]) * t))
            buf[index + 2] = int(round(BG[2] + (GLOW[2] - BG[2]) * t))
            index += 3
    return Image.frombytes("RGB", (width, height), bytes(buf))


def rounded_mask(width, height, radius):
    scale = 4
    big = Image.new("L", (width * scale, height * scale), 0)
    draw = ImageDraw.Draw(big)
    draw.rounded_rectangle(
        (0, 0, width * scale - 1, height * scale - 1),
        radius=radius * scale,
        fill=255,
    )
    return big.resize((width, height), Image.Resampling.LANCZOS)


def build_base(width, height, layout, mark, lockup_font):
    background = glow_background(width, height)
    # Centre of the glow is #15803D. A corner outside the radius stays #157A3C.
    cx, cy = width // 2, at(0.12, height)
    if background.getpixel((cx, cy)) != GLOW:
        raise SystemExit(f"glow centre is {background.getpixel((cx, cy))}, want {GLOW}")
    radius = 0.9 * width
    corner = background.getpixel((0, height - 1))
    if math.hypot(cx, (height - 1) - cy) > radius and corner != BG:
        raise SystemExit(f"field outside the glow is {corner}, want {BG}")
    background = background.convert("RGBA")
    ui_w = at(0.72, width)
    ui_h = at(0.72, height)
    ui_x = (width - ui_w) // 2
    ui_y = at(0.245, height)
    sx = ui_w / width
    sy = ui_h / height
    if abs(sx - sy) / ((sx + sy) / 2) > 0.005:
        raise SystemExit(f"UI scale is not uniform: x={sx:.4f} y={sy:.4f}")
    radius = 0.055 * ui_w
    mask = rounded_mask(ui_w, ui_h, radius)
    offset = at(0.012, height)
    blur = 0.03 * height
    pad = int(math.ceil(blur * 2))
    shadow = Image.new("RGBA", (width, height + pad), (0, 0, 0, 0))
    plate = Image.new("RGBA", (ui_w, ui_h), (*SHADOW, 255))
    plate.putalpha(mask.point(lambda value: value * 35 // 100))
    shadow.paste(plate, (ui_x, ui_y + offset), plate)
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    background = Image.alpha_composite(background, shadow.crop((0, 0, width, height)))

    tile_px = at(0.024, height)
    tile = mark.resize((tile_px, tile_px), Image.Resampling.LANCZOS)
    tile_view = layout["tile_view"]
    font_px = max(1, int(round(layout["font_size"] * tile_px / tile_view)))
    word_font = open_face(lockup_font, font_px, 700, None)
    if word_font is None:
        raise SystemExit("S3 blocked: could not load Inter Bold for the wordmark")
    tracking = layout["letter_spacing"] * font_px / layout["font_size"]
    text_w = measure(word_font, layout["text"], tracking)
    gap = (layout["text_x"] - (layout["translate_x"] + tile_view)) * tile_px / tile_view
    baseline = (layout["text_y"] - layout["translate_y"]) * tile_px / tile_view
    lockup_w = tile_px + gap + text_w
    lockup = Image.new("RGBA", (max(1, int(math.ceil(lockup_w))), tile_px), (0, 0, 0, 0))
    lockup.paste(tile, (0, 0), tile)
    draw = ImageDraw.Draw(lockup)
    draw_tracked(draw, tile_px + gap, baseline, layout["text"], word_font, (*WHITE, 255), tracking)
    lockup_x = (width - lockup.width) // 2
    lockup_y = at(0.040, height)
    inset = 0.04 * width
    if lockup_x < inset or lockup_x + lockup.width > width - inset:
        raise SystemExit("wordmark enters the 0.04W safe zone")
    layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    layer.paste(lockup, (lockup_x, lockup_y), lockup)
    background = Image.alpha_composite(background, layer)
    return background, {
        "ui_w": ui_w,
        "ui_h": ui_h,
        "ui_x": ui_x,
        "ui_y": ui_y,
        "mask": mask,
        "sx": sx,
        "sy": sy,
    }


def draw_copy(canvas, width, height, screen, headline_font, subhead_font, headline_size, subhead_size):
    draw = ImageDraw.Draw(canvas)
    tracking = -0.005 * headline_size
    max_headline = 0.86 * width
    headline_top = at(0.082, height)
    ascent, _descent = headline_font.getmetrics()
    line_box = headline_size * 1.06
    for index, line in enumerate(screen["headline"]):
        if measure(headline_font, line, tracking) > max_headline:
            raise SystemExit(f"headline overflows after fit: {line}")
        line_w = measure(headline_font, line, tracking)
        x = (width - line_w) / 2
        baseline = headline_top + ascent + index * line_box
        draw_tracked(draw, x, baseline, line, headline_font, (*WHITE, 255), tracking)
    sub_top = headline_top + len(screen["headline"]) * line_box + 0.012 * height
    max_sub = 0.80 * width
    lines = wrap_subhead(screen["subhead"], subhead_font, max_sub)
    if len(lines) > 2:
        raise SystemExit("subhead exceeded 2 lines")
    sub_ascent, _sub_descent = subhead_font.getmetrics()
    sub_box = subhead_size * 1.25
    for index, line in enumerate(lines):
        line_w = measure(subhead_font, line, 0)
        x = (width - line_w) / 2
        if x < 0.04 * width:
            raise SystemExit(f"subhead enters the safe zone: {line}")
        baseline = sub_top + sub_ascent + index * sub_box
        draw.text((x, baseline), line, font=subhead_font, fill=(*SUBHEAD, 255), anchor="ls")
    return canvas


def frame_capture(raw, base, geom, screen, fonts):
    shot = raw.convert("RGB")
    width, height = base.size
    if shot.size != (width, height):
        raise SystemExit(f"capture is {shot.size[0]}x{shot.size[1]}, expected {width}x{height}")
    ui = shot.resize((geom["ui_w"], geom["ui_h"]), Image.Resampling.LANCZOS).convert("RGBA")
    ui.putalpha(geom["mask"])
    canvas = base.copy()
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(ui, (geom["ui_x"], geom["ui_y"]), ui)
    canvas = Image.alpha_composite(canvas, layer)
    canvas = draw_copy(
        canvas,
        width,
        height,
        screen,
        fonts["headline"],
        fonts["subhead"],
        fonts["headline_size"],
        fonts["subhead_size"],
    )
    alpha = canvas.getchannel("A")
    lo, hi = alpha.getextrema()
    if lo != 255 or hi != 255:
        raise SystemExit("frame still has transparent pixels")
    return canvas.convert("RGB")


def png_info(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path} is not a PNG")
    pos = 8
    width = height = color = None
    trns = False
    while pos + 8 <= len(data):
        length, kind = struct.unpack(">I4s", data[pos : pos + 8])
        pos += 12 + length
        if kind == b"IHDR":
            width, height, _bit, color = struct.unpack(">IIBB", data[pos - length - 4 : pos - length + 6])
        elif kind == b"tRNS":
            trns = True
        elif kind == b"IEND":
            break
    return width, height, color, trns


def frame_tree(out_dir):
    assert_copy()
    layout = load_wordmark()
    mark = render_mark(layout)
    spec = resolve_fonts()
    print(f"Frame font source: {spec['source']}")
    framed = []
    for folder, (width, height) in SIZES.items():
        directory = out_dir / folder
        if not directory.is_dir():
            raise SystemExit(f"missing capture folder {directory}")
        headline_size = fit_headline_size(width, spec)
        subhead_size = at(0.039, width)
        headline_font, subhead_font, h_label, s_label = load_pair(spec, headline_size, subhead_size)
        print(
            f"{folder}: headline {headline_size}px {h_label}, "
            f"subhead {subhead_size}px {s_label}"
        )
        base, geom = build_base(width, height, layout, mark, FONT_DIR / "Inter-Bold.ttf")
        fonts = {
            "headline": headline_font,
            "subhead": subhead_font,
            "headline_size": headline_size,
            "subhead_size": subhead_size,
        }
        for stem, screen in SCREENS.items():
            path = directory / f"{stem}.png"
            if not path.is_file():
                raise SystemExit(f"missing raw capture {path}")
            with Image.open(path) as raw:
                raw.load()
                image = frame_capture(raw, base, geom, screen, fonts)
            image.save(path, format="PNG")
            got_w, got_h, color, trns = png_info(path)
            if (got_w, got_h) != (width, height) or color != 2 or trns:
                raise SystemExit(
                    f"{path} saved as {got_w}x{got_h} color={color} trns={trns}, want RGB {width}x{height}"
                )
            print(
                f"{folder}/{stem}.png {got_w}x{got_h} color={color} alpha=no "
                f"scale_x={geom['sx']:.6f} scale_y={geom['sy']:.6f}"
            )
            framed.append(path)
    if len(framed) != 15:
        raise SystemExit(f"framed {len(framed)} shots, want 15")
    return framed


def main(argv):
    if len(argv) != 2:
        raise SystemExit("usage: frame-store-screenshots.py <artifacts/appstore-screenshots>")
    out_dir = Path(argv[1])
    if not out_dir.is_dir():
        raise SystemExit(f"missing screenshot directory {out_dir}")
    frame_tree(out_dir)
    print(f"Framed 15 store shots in {out_dir}")


if __name__ == "__main__":
    main(sys.argv)
