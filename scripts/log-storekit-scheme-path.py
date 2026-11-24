#!/usr/bin/env python3
"""Print the FitMunchStoreKit catalog identifier and its resolved path.

Xcode resolves StoreKitConfigurationFileReference from the project container.
For a scheme under xcshareddata/xcschemes that container is SCHEME.parent.parent
(the xcshareddata directory), not the xcschemes directory itself.
"""

from pathlib import Path
import re
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SCHEME = ROOT / "FitMunch.xcodeproj/xcshareddata/xcschemes/FitMunchStoreKit.xcscheme"
IDENT = re.compile(r'\bidentifier\s*=\s*"([^"]+)"')
BROKEN_IDENTIFIER = "../../../FitMunchUITests/FitMunchProducts.storekit"


def action_body(text: str, tag: str) -> str:
    start = text.find(f"<{tag}")
    if start < 0:
        return ""
    end = text.find(f"</{tag}>", start)
    if end < 0:
        return text[start:]
    return text[start:end]


def prove_broken() -> int:
    """Resolve the old ../../../ identifier the Xcode way. It must miss."""
    started = time.perf_counter()
    identifier = BROKEN_IDENTIFIER
    base = SCHEME.parent.parent
    resolved = (base / identifier).resolve()
    elapsed = time.perf_counter() - started
    inside = str(resolved).startswith(str(ROOT.resolve()) + "/")
    print(f"BROKEN identifier={identifier}")
    print(f"BROKEN resolved={resolved} exists={resolved.is_file()} inside={inside} seconds={elapsed:.3f}")
    if inside and resolved.is_file():
        print("broken path resolved to a catalog inside the checkout")
        return 0
    return 1


def main() -> None:
    if "--prove-broken" in sys.argv:
        sys.exit(prove_broken())
    if not SCHEME.is_file():
        sys.exit(f"missing {SCHEME}. Run xcodegen generate first.")
    text = SCHEME.read_text()
    print(f"scheme={SCHEME.resolve()}")
    found = False
    missing = False
    for tag in ("LaunchAction", "TestAction"):
        body = action_body(text, tag)
        identifiers = IDENT.findall(body)
        references = [item for item in identifiers if item.endswith(".storekit")]
        if not references:
            print(f"{tag} StoreKitConfigurationFileReference=(none)")
            missing = True
            continue
        found = True
        for identifier in references:
            resolved = (SCHEME.parent.parent / identifier).resolve()
            exists = resolved.is_file()
            print(f"{tag} identifier={identifier}")
            print(f"{tag} resolved={resolved} exists={exists}")
            if not exists:
                missing = True
    if not found:
        sys.exit(f"{SCHEME.name} has no StoreKit configuration identifier")
    if missing:
        sys.exit(1)


if __name__ == "__main__":
    main()
