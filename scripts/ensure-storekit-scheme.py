#!/usr/bin/env python3
"""Put FitMunchProducts.storekit on the FitMunchStoreKit Run and Test actions.

xcodebuild test reads the Test action. Relative identifiers were ignored on
Xcode 26.6: both ../ and ../../../ left Product.products on the live US store.
The identifier written here is the absolute path of the catalog file.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEME = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunchStoreKit.xcscheme"
CLEAN = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunch.xcscheme"
SOURCE = ROOT / "FitMunchUITests/FitMunchProducts.storekit"


def reference(identifier: str) -> str:
    return f"""      <StoreKitConfigurationFileReference
         identifier = "{identifier}">
      </StoreKitConfigurationFileReference>
"""


def expand_empty(xml: str, tag: str) -> str:
    return re.sub(
        rf"<{tag}\b([^<>]*)/>",
        lambda match: f"<{tag}{match.group(1)}>\n</{tag}>",
        xml,
        count=1,
    )


def patch_action(xml: str, tag: str, identifier: str) -> str:
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
    replacement = match.group(1) + body + "\n" + reference(identifier) + match.group(3)
    return xml[: match.start()] + replacement + xml[match.end() :]


def main() -> None:
    if not SCHEME.is_file():
        sys.exit(f"missing {SCHEME}. Run xcodegen generate first.")
    if not SOURCE.is_file():
        sys.exit(f"missing {SOURCE}")
    identifier = str(SOURCE.resolve())
    xml = SCHEME.read_text()
    xml = patch_action(xml, "LaunchAction", identifier)
    xml = patch_action(xml, "TestAction", identifier)
    SCHEME.write_text(xml)
    updated = SCHEME.read_text()
    for tag in ("LaunchAction", "TestAction"):
        block = re.search(rf"<{tag}\b.*?</{tag}>", updated, re.S)
        if not block or identifier not in block.group(0):
            sys.exit(f"{tag} is missing {identifier}")
        print(f"{tag} StoreKitConfigurationFileReference identifier={identifier}")
    if CLEAN.is_file() and "StoreKitConfigurationFileReference" in CLEAN.read_text():
        sys.exit("FitMunch.xcscheme must not attach a StoreKit configuration")


if __name__ == "__main__":
    main()
