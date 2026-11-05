#!/usr/bin/env bash
# Light and dark screenshots of the five tabs, plus a short recording of
# log a meal, scan, generate a plan, and switch tabs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/design-uitest"
rm -rf "$OUT"
mkdir -p "$OUT/screenshots/light" "$OUT/screenshots/dark" "$OUT/recording"

UDID="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 17 Pro Max" "iPhone 16 Pro Max")"
echo "Using simulator $UDID"

rm -rf /tmp/fitmunch-design-uitest
mkdir -p /tmp/fitmunch-design-uitest/light /tmp/fitmunch-design-uitest/dark

DERIVED="$OUT/DerivedData"

rm -rf "$OUT/screenshots/Test.xcresult"
set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
  -derivedDataPath "$DERIVED" \
  -only-testing:FitMunchUITests/DesignFeelUITests/testTabScreenshotsLightAndDark \
  -only-testing:FitMunchUITests/DesignFeelUITests/testPaywallShot \
  -only-testing:FitMunchUITests/TabBarClearanceUITests \
  -resultBundlePath "$OUT/screenshots/Test.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=-
SHOT_STATUS=$?
set -e

VIDEO="$OUT/recording/log-scan-plan-tabs.mp4"
rm -f /tmp/fitmunch-design-uitest/app-ready /tmp/fitmunch-design-uitest/record-ready

# Start the flow test first. Recording begins only after the app writes app-ready,
# so the file does not open on the springboard while xcodebuild is still starting.
rm -rf "$OUT/recording/Test.xcresult"
set +e
xcodebuild test-without-building \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
  -derivedDataPath "$DERIVED" \
  -only-testing:FitMunchUITests/DesignFeelUITests/testLogScanPlanAndSwitchTabs \
  -resultBundlePath "$OUT/recording/Test.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=- &
XCODE_PID=$!

RECORD_PID=""
for _ in $(seq 1 180); do
  if [[ -f /tmp/fitmunch-design-uitest/app-ready ]]; then
    xcrun simctl io "$UDID" recordVideo --codec h264 "$VIDEO" &
    RECORD_PID=$!
    sleep 1
    touch /tmp/fitmunch-design-uitest/record-ready
    break
  fi
  if ! kill -0 "$XCODE_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ -z "$RECORD_PID" ]]; then
  echo "App was not ready before the flow test ended. Recording from here."
  xcrun simctl io "$UDID" recordVideo --codec h264 "$VIDEO" &
  RECORD_PID=$!
  touch /tmp/fitmunch-design-uitest/record-ready
fi

wait "$XCODE_PID"
FLOW_STATUS=$?
set -e

# Let the last frames land, then ask simctl to finish the file.
sleep 2
kill -INT "$RECORD_PID" >/dev/null 2>&1 || true
wait "$RECORD_PID" || true

if [[ -d /tmp/fitmunch-design-uitest/light ]]; then
  cp -R /tmp/fitmunch-design-uitest/light/. "$OUT/screenshots/light/"
fi
if [[ -d /tmp/fitmunch-design-uitest/dark ]]; then
  cp -R /tmp/fitmunch-design-uitest/dark/. "$OUT/screenshots/dark/"
fi

echo "Screenshots:"
find "$OUT/screenshots" -name '*.png' -print
echo "Recording:"
find "$OUT/recording" -name '*.mp4' -print

if [[ "$SHOT_STATUS" -ne 0 ]]; then
  echo "Design screenshot UI test failed ($SHOT_STATUS)"
  exit "$SHOT_STATUS"
fi

if [[ "$FLOW_STATUS" -ne 0 ]]; then
  echo "Design flow UI test failed ($FLOW_STATUS)"
  exit "$FLOW_STATUS"
fi

# 6.5-inch (iPhone 11 Pro Max, 414x896). The 6.9 run above already executed
# TabBarClearanceUITests. This pass is the second size only, once.
UDID_65="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 11 Pro Max" "iPhone XS Max")"
echo "Using 6.5 simulator $UDID_65"
rm -rf "$OUT/screenshots/TabBarClearance-6.5.xcresult"
set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID_65,arch=arm64" \
  -derivedDataPath "$DERIVED" \
  -only-testing:FitMunchUITests/TabBarClearanceUITests \
  -resultBundlePath "$OUT/screenshots/TabBarClearance-6.5.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=-
CLEAR_65=$?
set -e
if [[ "$CLEAR_65" -ne 0 ]]; then
  echo "6.5 tab bar clearance UI test failed ($CLEAR_65)"
  exit "$CLEAR_65"
fi

for required in today plan scan coach me; do
  if [[ ! -f "$OUT/screenshots/light/${required}.png" || ! -f "$OUT/screenshots/dark/${required}.png" ]]; then
    echo "Missing light or dark screenshot: ${required}.png"
    exit 1
  fi
done

for folder in light dark; do
  if [[ ! -f "$OUT/screenshots/${folder}/paywall.png" ]]; then
    echo "Missing ${folder} paywall screenshot"
    exit 1
  fi
done

if [[ ! -f "$VIDEO" ]]; then
  echo "Missing screen recording $VIDEO"
  exit 1
fi
