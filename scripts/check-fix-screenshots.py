#!/usr/bin/env python3
"""Confirm the build 11 fix shots are the requested pixel sizes."""

import sys
from pathlib import Path

EXPECTED = {
    "iphone-6.9in": (1320, 2868),
    "iphone-6.5in": (1284, 2778),
}
REQUIRED = [
    "paywall-plans.png",
    "scan-blocked.png",
    "plan-offline.png",
    "plan-training.png",
    "me-about.png",
    "today-offline.png",
    "auth-error.png",
]


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[12:16] != b"IHDR":
        raise SystemExit(f"{path} is not a PNG")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    return width, height


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/fix-capture/screens")
    missing: list[str] = []
    for folder, size in EXPECTED.items():
        for name in REQUIRED:
            path = root / folder / name
            if not path.exists():
                missing.append(str(path))
                continue
            actual = png_size(path)
            print(f"{path} {actual[0]}x{actual[1]}")
            if actual != size:
                missing.append(f"{path} got {actual[0]}x{actual[1]}")
    if missing:
        raise SystemExit("screenshot check failed:\n" + "\n".join(missing))


if __name__ == "__main__":
    main()
