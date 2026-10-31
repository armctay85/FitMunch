#!/usr/bin/env bash
# Simulator recording of onboarding, the StoreKit paywall, Today, a meal log,
# then Plan, Scan, Coach, and Me. Does not archive or upload to App Store Connect.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/flow-recording"
rm -rf "$OUT"
mkdir -p "$OUT"

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
      if udid="$(xcrun simctl create "FitMunch Flow $type" "$type" "$runtime")"; then
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
bash "$ROOT/scripts/set-simulator-region-au.sh" "$UDID"

rm -rf /tmp/fitmunch-flow-recording
mkdir -p /tmp/fitmunch-flow-recording

VIDEO="$OUT/main-flows.mp4"
rm -f /tmp/fitmunch-flow-recording/app-ready /tmp/fitmunch-flow-recording/record-ready

set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunchStoreKit \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$OUT/DerivedData" \
  -only-testing:FitMunchUITests/FlowRecordingUITests/testMainFlowsForRecording \
  -testLanguage en \
  -testRegion AU \
  -parallel-testing-enabled NO \
  -resultBundlePath "$OUT/Test.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=- &
XCODE_PID=$!

RECORD_PID=""
for _ in $(seq 1 180); do
  if [[ -f /tmp/fitmunch-flow-recording/app-ready ]]; then
    xcrun simctl io "$UDID" recordVideo --codec h264 "$VIDEO" &
    RECORD_PID=$!
    sleep 1
    touch /tmp/fitmunch-flow-recording/record-ready
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
  touch /tmp/fitmunch-flow-recording/record-ready
fi

wait "$XCODE_PID"
FLOW_STATUS=$?
set -e

sleep 2
kill -INT "$RECORD_PID" >/dev/null 2>&1 || true
wait "$RECORD_PID" || true

echo "Recording:"
find "$OUT" -name '*.mp4' -print

if [[ "$FLOW_STATUS" -ne 0 ]]; then
  echo "Flow recording UI test failed ($FLOW_STATUS)"
  exit "$FLOW_STATUS"
fi

if [[ ! -f "$VIDEO" ]]; then
  echo "Missing screen recording $VIDEO"
  exit 1
fi
