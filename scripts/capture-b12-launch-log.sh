#!/usr/bin/env bash
# Fresh install on one simulator, launch to the paywall with the AU StoreKit
# catalog, and write a unified log filtered to RevenueCat plus the FitMunch process.
# Usage: capture-b12-launch-log.sh <label> <device type> <log path>
set -euo pipefail

LABEL="${1:?label}"
DEVICE="${2:?device type}"
OUT="${3:?log path}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p "$(dirname "$OUT")"
: > "$OUT"

UDID="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "$DEVICE")"
echo "$LABEL device=$DEVICE udid=$UDID os=26.2"
bash "$ROOT/scripts/set-simulator-region-au.sh" "$UDID"
bash "$ROOT/scripts/warm-simulator-launch.sh" "$UDID"
xcrun simctl uninstall "$UDID" com.fitmunch.app >/dev/null 2>&1 || true

PREDICATE='subsystem CONTAINS "com.revenuecat" OR process CONTAINS[c] "FitMunch"'
# A tty keeps log stream line-buffered so the offering line is in the file.
script -q "$OUT" xcrun simctl spawn booted log stream \
  --level info \
  --style compact \
  --predicate "$PREDICATE" \
  >/dev/null 2>&1 &
LOG_PID=$!

cleanup() {
  if kill -0 "$LOG_PID" >/dev/null 2>&1; then
    kill -INT "$LOG_PID" >/dev/null 2>&1 || true
    wait "$LOG_PID" >/dev/null 2>&1 || true
  fi
  sync || true
}
trap cleanup EXIT

DERIVED="$ROOT/artifacts/b12-launch-logs/DerivedData"
BUNDLE="$ROOT/artifacts/b12-launch-logs/${LABEL}.xcresult"
rm -rf "$BUNDLE"
set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunchStoreKit \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
  -derivedDataPath "$DERIVED" \
  -only-testing:FitMunchUITests/LaunchLogUITests \
  -testLanguage en \
  -testRegion AU \
  -parallel-testing-enabled NO \
  -resultBundlePath "$BUNDLE" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=-
RC=$?
set -e

sleep 3
echo "launch log $LABEL bytes=$(wc -c < "$OUT" | tr -d ' ') exit=$RC"
exit "$RC"
