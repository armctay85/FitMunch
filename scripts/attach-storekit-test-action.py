#!/usr/bin/env python3
"""Put the run-action catalog on the test action as well.

XcodeGen writes storeKitConfiguration on the run action only.
xcodebuild test reads the test action. The catalog is
FitMunchProducts.storekit, and the scheme region is AU.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEME = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunchStoreKit.xcscheme"
CATALOG = "FitMunchProducts.storekit"


def element_span(text: str, tag: str) -> tuple[int, int]:
    start = text.find(f"<{tag}")
    if start < 0:
        sys.exit(f"{SCHEME.name} has no {tag}")
    end = text.find(f"</{tag}>", start)
    if end < 0:
        sys.exit(f"{SCHEME.name} has an unclosed {tag}")
    return start, end + len(f"</{tag}>")


def reference_element(text: str) -> str:
    start = text.find("<StoreKitConfigurationFileReference")
    if start < 0:
        sys.exit(f"{SCHEME.name} run action has no StoreKit configuration")
    end = text.find("</StoreKitConfigurationFileReference>", start)
    if end < 0:
        sys.exit(f"{SCHEME.name} has an unclosed StoreKit configuration")
    element = text[start:end + len("</StoreKitConfigurationFileReference>")]
    if CATALOG not in element:
        sys.exit(f"{SCHEME.name} catalog is not {CATALOG}: {element}")
    return element


def main() -> None:
    if not SCHEME.is_file():
        sys.exit(f"missing {SCHEME}. Run xcodegen generate first.")
    text = SCHEME.read_text()
    if 'region = "AU"' not in text:
        sys.exit(f"{SCHEME.name} region is not AU")
    launch_start, launch_end = element_span(text, "LaunchAction")
    launch = text[launch_start:launch_end]
    element = reference_element(launch)
    test_start, test_end = element_span(text, "TestAction")
    test = text[test_start:test_end]
    if "StoreKitConfigurationFileReference" in test:
        print(f"{SCHEME.name} test action already uses {CATALOG}")
        return
    open_end = text.find(">", test_start)
    if open_end < 0 or open_end > test_end:
        sys.exit(f"{SCHEME.name} TestAction tag is incomplete")
    snippet = "\n      " + element.replace("\n", "\n      ").strip()
    text = text[:open_end + 1] + snippet + text[open_end + 1:]
    SCHEME.write_text(text)
    print(f"attached {CATALOG} to {SCHEME.name} test action")


if __name__ == "__main__":
    main()
