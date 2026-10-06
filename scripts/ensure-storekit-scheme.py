#!/usr/bin/env python3
"""Put FitMunchProducts.storekit on the FitMunchStoreKit Run and Test actions.

xcodebuild test reads the Test action. A Run-only StoreKit configuration
leaves Product.products(for:) empty, and the paywall must not invent prices.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEME = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunchStoreKit.xcscheme"
CLEAN = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunch.xcscheme"
IDENTIFIER = "container:FitMunchUITests/FitMunchProducts.storekit"
REFERENCE = f"""      <StoreKitConfigurationFileReference
         identifier = "{IDENTIFIER}">
      </StoreKitConfigurationFileReference>
"""


def expand_empty(xml: str, tag: str) -> str:
    return re.sub(
        rf"<{tag}\b([^<>]*)/>",
        lambda match: f"<{tag}{match.group(1)}>\n</{tag}>",
        xml,
        count=1,
    )


def patch_action(xml: str, tag: str) -> str:
    xml = expand_empty(xml, tag)
    pattern = re.compile(rf"(<{tag}\b[^>]*>)(.*?)(</{tag}>)", re.S)
    match = pattern.search(xml)
    if not match:
        sys.exit(f"{SCHEME.name} has no <{tag}> block")
    body = re.sub(
        r"\s*<StoreKitConfigurationFileReference\b.*?</StoreKitConfigurationFileReference>\s*",
        "\n",
        match.group(2),
        count=0,
        flags=re.S,
    ).rstrip()
    replacement = match.group(1) + body + "\n" + REFERENCE + match.group(3)
    return xml[: match.start()] + replacement + xml[match.end() :]


def main() -> None:
    if not SCHEME.is_file():
        sys.exit(f"missing {SCHEME}. Run xcodegen generate first.")
    xml = SCHEME.read_text()
    xml = patch_action(xml, "LaunchAction")
    xml = patch_action(xml, "TestAction")
    SCHEME.write_text(xml)
    updated = SCHEME.read_text()
    for tag in ("LaunchAction", "TestAction"):
        block = re.search(rf"<{tag}\b.*?</{tag}>", updated, re.S)
        if not block or IDENTIFIER not in block.group(0):
            sys.exit(f"{tag} is missing {IDENTIFIER}")
    if CLEAN.is_file() and "StoreKitConfigurationFileReference" in CLEAN.read_text():
        sys.exit("FitMunch.xcscheme must not attach a StoreKit configuration")
    print(f"StoreKit configuration set on Run and Test: {IDENTIFIER}")


if __name__ == "__main__":
    main()
