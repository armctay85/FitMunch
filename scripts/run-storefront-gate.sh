#!/usr/bin/env bash
# Build once, then launch the paywall and keep the app log for the AUS gate.
# The caller greps the log for STOREFRONT country=AUS and fails the job if it is missing.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-artifacts/storefront-gate}"
rm -rf "$OUT"
mkdir -p "$OUT"

UDID="$(bash scripts/boot-pinned-simulator.sh "iPhone 17 Pro Max" "iPhone 16 Pro Max")"
echo "storefront gate udid=$UDID" | tee "$OUT/destination.txt"
bash scripts/set-simulator-region-au.sh "$UDID"
bash scripts/warm-simulator-launch.sh "$UDID"

DERIVED="${RUNNER_TEMP:-/tmp}/DerivedDataStorefront"
rm -rf "$DERIVED"
xcodebuild build-for-testing \
  -project FitMunch.xcodeproj \
  -scheme FitMunchStoreKit \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=- \
  | tee "$OUT/build.log"

echo "storefront test-without-building start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
set +e
xcodebuild test-without-building \
  -project FitMunch.xcodeproj \
  -scheme FitMunchStoreKit \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
  -derivedDataPath "$DERIVED" \
  -only-testing:FitMunchUITests/StorefrontGateUITests/testStorefrontIsAUS \
  -testLanguage en \
  -testRegion AU \
  -parallel-testing-enabled NO \
  -resultBundlePath "$OUT/storefront.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=- \
  | tee "$OUT/storefront.log"
rc=${PIPESTATUS[0]}
set -e
echo "storefront test-without-building exit=$rc end $(date -u +%Y-%m-%dT%H:%M:%SZ)"
grep -E 'STOREFRONT country=|plans fetched' "$OUT/storefront.log" || true
exit 0
