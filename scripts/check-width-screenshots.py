#!/usr/bin/env python3
"""Confirm batch 2 shots are 375pt and 440pt wide."""

import sys
from pathlib import Path

# Point width times the device scale. SE is 375 at 2x. A mini fallback is 375 at 3x.
# Pro Max 6.9in is 440 at 3x.
EXPECTED = {
    "width-375": {750, 1125},
    "width-440": {1320},
}
REQUIRED = [
    "today-empty.png",
    "me-about.png",
    "me-privacy.png",
    "coach-blocked.png",
    "scan-offline.png",
    "scan-result-offline.png",
    "onboarding-goals.png",
    "onboarding-plan.png",
    "paywall-restore.png",
]


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if data[12:16] != b"IHDR":
        raise SystemExit(f"{path} is not a PNG")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    return width, height


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/width-capture/screens")
    missing: list[str] = []
    for folder, widths in EXPECTED.items():
        for name in REQUIRED:
            path = root / folder / name
            if not path.exists():
                missing.append(str(path))
                continue
            actual = png_size(path)
            print(f"{path} {actual[0]}x{actual[1]}")
            if actual[0] not in widths or actual[1] <= actual[0]:
                missing.append(f"{path} got {actual[0]}x{actual[1]}")
    if missing:
        raise SystemExit("screenshot check failed:\n" + "\n".join(missing))


if __name__ == "__main__":
    main()
