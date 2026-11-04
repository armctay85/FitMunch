#!/usr/bin/env bash
# Simulator recording of onboarding, the StoreKit paywall, Today, a meal log,
# then Plan, Scan, Coach, and Me. Does not archive or upload to App Store Connect.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/flow-recording"
rm -rf "$OUT"
mkdir -p "$OUT"

UDID="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 17 Pro Max" "iPhone 16 Pro Max")"
echo "Using simulator $UDID"
bash "$ROOT/scripts/set-simulator-region-au.sh" "$UDID"

rm -rf /tmp/fitmunch-flow-recording
mkdir -p /tmp/fitmunch-flow-recording
if [[ -n "${QA_EMAIL:-}" && -n "${QA_PASSWORD:-}" ]]; then
  umask 077
  printf '%s\n%s\n' "$QA_EMAIL" "$QA_PASSWORD" > /tmp/fitmunch-qa-credentials
  echo "Me recording will sign in. Credentials are not printed."
else
  echo "QA_EMAIL or QA_PASSWORD is unset."
fi

VIDEO="$OUT/main-flows.mp4"
rm -f /tmp/fitmunch-flow-recording/app-ready /tmp/fitmunch-flow-recording/record-ready

rm -rf "$OUT/Test.xcresult"
set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunchStoreKit \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
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
rm -f /tmp/fitmunch-qa-credentials
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
