#!/usr/bin/env python3
"""Put FitMunchProducts.storekit on the FitMunchStoreKit Run and Test actions.

xcodebuild test reads the Test action. The identifier is a path relative to
the .xcscheme file (xcshareddata/xcschemes is three levels below the repo).
A container: id and a single ../ are ignored, and Product.products then
returns the live US store.
"""

from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEME = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunchStoreKit.xcscheme"
CLEAN = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunch.xcscheme"
SOURCE = ROOT / "FitMunchUITests/FitMunchProducts.storekit"
# From xcshareddata/xcschemes back to the repo root, then into FitMunchUITests.
IDENTIFIER = "../../../FitMunchUITests/FitMunchProducts.storekit"
REFERENCE = f"""      <StoreKitConfigurationFileReference
         identifier = "{IDENTIFIER}">
      </StoreKitConfigurationFileReference>
"""


def expand_empty(xml: str, tag: str) -> str:
    import re

    return re.sub(
        rf"<{tag}\b([^<>]*)/>",
        lambda match: f"<{tag}{match.group(1)}>\n</{tag}>",
        xml,
        count=1,
    )


def patch_action(xml: str, tag: str) -> str:
    import re

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


def place_bundle_relative_copy() -> None:
    """Some Xcode builds resolve the identifier from the .xcodeproj bundle."""
    bundle = ROOT / "FitMunch.xcodeproj"
    target = (bundle / IDENTIFIER).resolve()
    if target == SOURCE.resolve():
        return
    if not SOURCE.is_file():
        sys.exit(f"missing {SOURCE}")
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SOURCE, target)
    except OSError as error:
        print(f"bundle-relative copy skipped: {error}")
        return
    print(f"copied StoreKit file for bundle-relative lookup: {target}")


def main() -> None:
    if not SCHEME.is_file():
        sys.exit(f"missing {SCHEME}. Run xcodegen generate first.")
    if not SOURCE.is_file():
        sys.exit(f"missing {SOURCE}")
    scheme_resolved = (SCHEME.parent / IDENTIFIER).resolve()
    if scheme_resolved != SOURCE.resolve():
        sys.exit(f"scheme-relative path resolved to {scheme_resolved}, expected {SOURCE.resolve()}")
    place_bundle_relative_copy()
    xml = SCHEME.read_text()
    xml = patch_action(xml, "LaunchAction")
    xml = patch_action(xml, "TestAction")
    SCHEME.write_text(xml)
    updated = SCHEME.read_text()
    import re

    for tag in ("LaunchAction", "TestAction"):
        block = re.search(rf"<{tag}\b.*?</{tag}>", updated, re.S)
        if not block or IDENTIFIER not in block.group(0):
            sys.exit(f"{tag} is missing {IDENTIFIER}")
        print(f"{tag} StoreKitConfigurationFileReference identifier={IDENTIFIER}")
    if CLEAN.is_file() and "StoreKitConfigurationFileReference" in CLEAN.read_text():
        sys.exit("FitMunch.xcscheme must not attach a StoreKit configuration")
    print(f"scheme-relative file exists: {scheme_resolved}")


if __name__ == "__main__":
    main()
