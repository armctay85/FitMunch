#!/usr/bin/env python3
"""Keep StoreKit configuration files off the generated schemes.

Jobs that want the Australia catalog attach it themselves. This script
removes the configuration so the remaining schemes do not override product
requests.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEME_DIR = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes"
REFERENCE = re.compile(
    r"\s*<StoreKitConfigurationFileReference\b.*?</StoreKitConfigurationFileReference>\s*",
    re.S,
)


def main() -> None:
    if not SCHEME_DIR.is_dir():
        sys.exit(f"missing {SCHEME_DIR}. Run xcodegen generate first.")
    for scheme in sorted(SCHEME_DIR.glob("*.xcscheme")):
        original = scheme.read_text()
        updated = REFERENCE.sub("\n", original)
        if updated != original:
            scheme.write_text(updated)
            print(f"removed StoreKitConfigurationFileReference from {scheme.name}")
        else:
            print(f"{scheme.name} has no StoreKit configuration")
        if "StoreKitConfigurationFileReference" in scheme.read_text():
            sys.exit(f"{scheme.name} still references a StoreKit configuration")


if __name__ == "__main__":
    main()
