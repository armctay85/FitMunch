#!/usr/bin/env bash
# Capture home.png coach.png scan.png plan.png settings.png from the real SwiftUI app.
# HTML mockup frames are not store art.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/appstore-screenshots"
rm -rf "$OUT"
mkdir -p "$OUT"

list_available() {
  xcrun simctl list devices available
}

pick_device() {
  local candidate
  for candidate in "$@"; do
    if list_available | grep -F "$candidate (" >/dev/null; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

udid_for() {
  xcrun simctl list devices available | awk -v name="$1" '
    $0 ~ name " (" {
      if (match($0, /\(([A-F0-9-]+)\)/)) {
        print substr($0, RSTART+1, RLENGTH-2)
        exit
      }
    }'
}

prepare_sim() {
  local name="$1"
  local udid
  udid="$(udid_for "$name")"
  if [[ -z "$udid" ]]; then
    echo "No UDID for $name"
    return 1
  fi
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$udid" -b
  xcrun simctl status_bar "$udid" override \
    --time "9:41" \
    --dataNetwork wifi \
    --wifiMode active \
    --wifiBars 3 \
    --cellularMode active \
    --batteryState charged \
    --batteryLevel 100 || true
  echo "$udid"
}

run_capture() {
  local dest_name="$1"
  local folder="$2"
  local expected_w="$3"
  local expected_h="$4"
  mkdir -p "$folder"

  echo "Capturing on $dest_name -> $folder"
  xcodebuild test \
    -project FitMunch.xcodeproj \
    -scheme FitMunch \
    -destination "platform=iOS Simulator,name=$dest_name" \
    -only-testing:FitMunchUITests/AppStoreScreenshotTests \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY=- \
    TEST_RUNNER_SCREENSHOT_DIR="$folder"

  local required
  for required in home coach scan plan settings; do
    local png="$folder/$required.png"
    if [[ ! -f "$png" ]]; then
      echo "Missing $png"
      exit 1
    fi
    local w h
    w="$(sips -g pixelWidth "$png" | awk '/pixelWidth/ {print $2}')"
    h="$(sips -g pixelHeight "$png" | awk '/pixelHeight/ {print $2}')"
    echo "$required.png ${w}x${h}"
    if [[ "$w" != "$expected_w" || "$h" != "$expected_h" ]]; then
      echo "Expected ${expected_w}x${expected_h} for $dest_name, got ${w}x${h}"
      exit 1
    fi
  done

  swift "$ROOT/scripts/ocr-store-screenshots.swift" "$folder"
}

IPHONE_67="$(pick_device "iPhone 16 Plus" "iPhone 15 Pro Max" "iPhone 15 Plus" "iPhone 14 Pro Max" || true)"
IPHONE_69="$(pick_device "iPhone 17 Pro Max" "iPhone 16 Pro Max" || true)"

if [[ -z "${IPHONE_67:-}" && -z "${IPHONE_69:-}" ]]; then
  echo "No large iPhone simulator available:"
  list_available
  exit 1
fi

if [[ -n "${IPHONE_67:-}" ]]; then
  prepare_sim "$IPHONE_67"
  run_capture "$IPHONE_67" "$OUT/iphone-67" 1290 2796
else
  echo "No 6.7-inch simulator. 1290x2796 will be missing."
fi

if [[ -n "${IPHONE_69:-}" ]]; then
  prepare_sim "$IPHONE_69"
  run_capture "$IPHONE_69" "$OUT/iphone-69" 1320 2868
else
  echo "No 6.9-inch simulator. ASC still accepts 1290x2796 in the 6.9-inch class."
fi

if [[ ! -d "$OUT/iphone-67" && ! -d "$OUT/iphone-69" ]]; then
  echo "No screenshot folders were produced."
  exit 1
fi

# At least one accepted large-iPhone size must exist.
if [[ ! -d "$OUT/iphone-67" ]]; then
  echo "6.7-inch 1290x2796 capture is required."
  exit 1
fi

echo "Real-app screenshots written to $OUT"
find "$OUT" -name '*.png' -print
