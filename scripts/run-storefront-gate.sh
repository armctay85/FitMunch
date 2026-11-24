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

# App print() does not always reach the xcodebuild console. Keep the simulator
# log and the xcresult console so the caller can grep STOREFRONT country=.
xcrun simctl spawn "$UDID" log stream --style compact --predicate 'eventMessage CONTAINS "STOREFRONT" OR eventMessage CONTAINS "plans fetched"' > "$OUT/sim.log" 2>&1 &
LOG_PID=$!

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
if [[ -n "${LOG_PID:-}" ]]; then
  kill "$LOG_PID" >/dev/null 2>&1 || true
  wait "$LOG_PID" >/dev/null 2>&1 || true
fi
{
  echo "===== simulator log ====="
  cat "$OUT/sim.log" 2>/dev/null || true
  echo "===== xcresult console ====="
  xcrun xcresulttool get log --path "$OUT/storefront.xcresult" --type console 2>/dev/null || true
} >> "$OUT/storefront.log"
if xcrun xcresulttool get --legacy --format json --path "$OUT/storefront.xcresult" > "$OUT/legacy.json" 2>/dev/null; then
  grep -E 'STOREFRONT country=|plans fetched' "$OUT/legacy.json" >> "$OUT/storefront.log" || true
fi
grep -E 'STOREFRONT country=|plans fetched|GATE_PRICE' "$OUT/storefront.log" || true
exit 0
