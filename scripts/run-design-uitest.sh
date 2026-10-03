#!/usr/bin/env bash
# Light and dark screenshots of the five tabs, plus a short recording of
# log a meal, scan, generate a plan, and switch tabs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/design-uitest"
rm -rf "$OUT"
mkdir -p "$OUT/screenshots/light" "$OUT/screenshots/dark" "$OUT/recording"

latest_ios_runtime() {
  xcrun simctl list runtimes available \
    | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS[-0-9]*\).*/\1/p' \
    | tail -1
}

udid_for() {
  local name="$1"
  xcrun simctl list devices available \
    | grep -F "$name (" \
    | head -1 \
    | grep -oE '[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}' \
    | head -1
}

find_udid() {
  local candidate udid
  for candidate in "$@"; do
    udid="$(udid_for "$candidate")"
    if [[ -n "$udid" ]]; then
      echo "$udid"
      return 0
    fi
  done
  return 1
}

create_udid() {
  local runtime type udid
  runtime="$(latest_ios_runtime)"
  if [[ -z "$runtime" ]]; then
    echo "No iOS simulator runtime" >&2
    return 1
  fi
  for type in "$@"; do
    if xcrun simctl list devicetypes | grep -F "$type" >/dev/null; then
      echo "Creating simulator '$type' on $runtime" >&2
      if udid="$(xcrun simctl create "FitMunch Design $type" "$type" "$runtime")"; then
        echo "$udid"
        return 0
      fi
    fi
  done
  return 1
}

UDID="$(find_udid "iPhone 17 Pro Max" "iPhone 16 Pro Max" || create_udid "iPhone 17 Pro Max" "iPhone 16 Pro Max" || true)"
if [[ -z "${UDID:-}" ]]; then
  echo "No iPhone 17 Pro Max or iPhone 16 Pro Max simulator."
  exit 1
fi

echo "Using simulator $UDID"
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b

rm -rf /tmp/fitmunch-design-uitest
mkdir -p /tmp/fitmunch-design-uitest/light /tmp/fitmunch-design-uitest/dark

DERIVED="$OUT/DerivedData"

set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$DERIVED" \
  -only-testing:FitMunchUITests/DesignFeelUITests/testTabScreenshotsLightAndDark \
  -only-testing:FitMunchUITests/DesignFeelUITests/testPaywallShot \
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
set +e
xcodebuild test-without-building \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID" \
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
