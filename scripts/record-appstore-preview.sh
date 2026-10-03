#!/usr/bin/env bash
# Record one App Preview from the build 10 screenshot walk.
# Output is 886x1920 H.264, 15 to 25 seconds, accepted for the 6.5-inch
# and 6.9-inch slots. No prices, totals, savings, specials, or catalogue
# dates are burned in. This script does not upload to App Store Connect.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: record-appstore-preview.sh UDID OUTPUT.mov" >&2
  exit 2
fi

UDID="$1"
OUT="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
RAW="$(mktemp "${TMPDIR:-/tmp}/fitmunch-preview.XXXXXX.mov")"
mkdir -p "$(dirname "$OUT")"

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  brew install ffmpeg
fi

xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override \
  --time "9:41" \
  --dataNetwork wifi \
  --wifiMode active \
  --wifiBars 3 \
  --cellularMode active \
  --batteryState charged \
  --batteryLevel 100 || true

xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$RAW" &
REC_PID=$!
stop_recording() {
  if kill -0 "$REC_PID" 2>/dev/null; then
    kill -INT "$REC_PID" 2>/dev/null || true
    wait "$REC_PID" 2>/dev/null || true
  fi
}

set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunch \
  -destination "platform=iOS Simulator,id=$UDID" \
  -only-testing:FitMunchUITests/AppStoreScreenshotTests/testWalkScreensForPreview \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=- \
  TEST_RUNNER_SCREENSHOT_DWELL=2.4
STATUS=$?
set -e
stop_recording

if [[ "$STATUS" -ne 0 ]]; then
  echo "Preview walk failed ($STATUS)" >&2
  exit "$STATUS"
fi

if [[ ! -s "$RAW" ]]; then
  echo "Simulator recording was empty" >&2
  exit 1
fi

DURATION="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$RAW")"
read -r ACTION START <<EOF
$(python3 -c "d=float('$DURATION');
print('short 0') if d < 15 else print('trim %.3f' % (d - 22)) if d > 25 else print('keep 0')")
EOF

if [[ "$ACTION" == "short" ]]; then
  echo "Preview recording is ${DURATION}s, shorter than 15 seconds." >&2
  exit 1
fi

FFMPEG_ARGS=(-y)
if [[ "$ACTION" == "trim" ]]; then
  FFMPEG_ARGS+=(-ss "$START" -t 22)
fi
FFMPEG_ARGS+=(
  -i "$RAW"
  -vf "scale=886:1920:force_original_aspect_ratio=increase,crop=886:1920"
  -r 30
  -c:v libx264
  -pix_fmt yuv420p
  -an
  -movflags +faststart
  "$OUT"
)
ffmpeg "${FFMPEG_ARGS[@]}"

OUT_DURATION="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT")"
python3 -c "d=float('$OUT_DURATION'); raise SystemExit(0 if 15 <= d <= 25 else 1)" \
  || { echo "Encoded preview is ${OUT_DURATION}s, expected 15 to 25 seconds." >&2; exit 1; }

echo "App preview ${OUT} ${OUT_DURATION}s at 886x1920"
rm -f "$RAW"
