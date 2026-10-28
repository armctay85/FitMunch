#!/usr/bin/env python3
"""Print the FitMunchStoreKit catalog identifier and its resolved path."""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SCHEME = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunchStoreKit.xcscheme"
IDENT = re.compile(r'\bidentifier\s*=\s*"([^"]+)"')


def action_body(text: str, tag: str) -> str:
    start = text.find(f"<{tag}")
    if start < 0:
        return ""
    end = text.find(f"</{tag}>", start)
    if end < 0:
        return text[start:]
    return text[start:end]


def main() -> None:
    if not SCHEME.is_file():
        sys.exit(f"missing {SCHEME}. Run xcodegen generate first.")
    text = SCHEME.read_text()
    print(f"scheme={SCHEME.resolve()}")
    found = False
    for tag in ("LaunchAction", "TestAction"):
        body = action_body(text, tag)
        identifiers = IDENT.findall(body)
        references = [item for item in identifiers if item.endswith(".storekit")]
        if not references:
            print(f"{tag} StoreKitConfigurationFileReference=(none)")
            continue
        found = True
        for identifier in references:
            resolved = (SCHEME.parent / identifier).resolve()
            print(f"{tag} identifier={identifier}")
            print(f"{tag} resolved={resolved} exists={resolved.is_file()}")
    if not found:
        sys.exit(f"{SCHEME.name} has no StoreKit configuration identifier")


if __name__ == "__main__":
    main()
