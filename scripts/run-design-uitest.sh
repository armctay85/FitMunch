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

xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID" \
  -only-testing:FitMunchUITests/DesignFeelUITests/testTabScreenshotsLightAndDark \
  -resultBundlePath "$OUT/screenshots/Test.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=-

VIDEO="$OUT/recording/log-scan-plan-tabs.mp4"
xcrun simctl io "$UDID" recordVideo --codec h264 "$VIDEO" &
RECORD_PID=$!

set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID" \
  -only-testing:FitMunchUITests/DesignFeelUITests/testLogScanPlanAndSwitchTabs \
  -resultBundlePath "$OUT/recording/Test.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=-
FLOW_STATUS=$?
set -e

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

if [[ ! -f "$VIDEO" ]]; then
  echo "Missing screen recording $VIDEO"
  exit 1
fi
