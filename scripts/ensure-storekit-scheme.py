#!/usr/bin/env python3
"""Keep StoreKit configuration files off the generated schemes.

xcodebuild test on Xcode 26.6 does not apply StoreKitConfigurationFileReference.
With that reference present, SKTestSession fails to save the catalog
(SKInternalErrorDomain Code=3) and Product.products stays on the live US store.
Without it, SKTestSession(contentsOf:) loads FitMunchProducts.storekit.
The paywall installs that session only for -UseLocalStoreKit.
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
