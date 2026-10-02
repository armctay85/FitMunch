#!/usr/bin/env bash
# Capture home.png coach.png scan.png plan.png settings.png workout.png history.png from the real SwiftUI app.
# HTML mockup frames are not store art.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/appstore-screenshots"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "=== Available simulators ==="
xcrun simctl list devices available
echo "=== Device types (iPhone) ==="
xcrun simctl list devicetypes | grep -i iPhone || true
echo "=== Runtimes ==="
xcrun simctl list runtimes available

latest_ios_runtime() {
  xcrun simctl list runtimes available \
    | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS[-0-9]*\).*/\1/p' \
    | tail -1
}

# First 36-char UUID on the matching device line. grep -F so names with '(' are safe.
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
      if udid="$(xcrun simctl create "FitMunch $type" "$type" "$runtime")"; then
        echo "$udid"
        return 0
      fi
    fi
  done
  return 1
}

prepare_sim() {
  local udid="$1"
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
}

verify_pngs() {
  local folder="$1"
  local expected_w="$2"
  local expected_h="$3"
  local required w h png
  for required in home coach scan plan settings workout history; do
    png="$folder/$required.png"
    if [[ ! -f "$png" ]]; then
      echo "Missing $png"
      exit 1
    fi
    w="$(sips -g pixelWidth "$png" | awk '/pixelWidth/ {print $2}')"
    h="$(sips -g pixelHeight "$png" | awk '/pixelHeight/ {print $2}')"
    echo "$required.png ${w}x${h}"
    if [[ "$w" != "$expected_w" || "$h" != "$expected_h" ]]; then
      echo "Expected ${expected_w}x${expected_h}, got ${w}x${h}"
      exit 1
    fi
  done
}

# XCUIScreen.screenshot letterboxes this app. The UI test writes a ready file
# per screen; this loop takes a simctl framebuffer shot and acks it.
start_framebuffer_waiter() {
  local udid="$1"
  local folder="$2"
  rm -rf /tmp/fitmunch-shot-ready /tmp/fitmunch-shot-ack /tmp/fitmunch-shot-waiter-stop
  mkdir -p /tmp/fitmunch-shot-ready /tmp/fitmunch-shot-ack "$folder"
  (
    set +e
    while [[ ! -f /tmp/fitmunch-shot-waiter-stop ]]; do
      for name in home coach scan plan settings workout history; do
        if [[ -f "/tmp/fitmunch-shot-ready/$name" && ! -f "/tmp/fitmunch-shot-ack/$name" ]]; then
          sleep 0.35
          if xcrun simctl io "$udid" screenshot "$folder/$name.png"; then
            touch "/tmp/fitmunch-shot-ack/$name"
            echo "Framebuffer wrote $folder/$name.png"
          else
            echo "simctl screenshot failed for $name" >&2
          fi
        fi
      done
      sleep 0.05
    done
  ) &
  echo $! > /tmp/fitmunch-shot-waiter.pid
}

stop_framebuffer_waiter() {
  touch /tmp/fitmunch-shot-waiter-stop
  if [[ -f /tmp/fitmunch-shot-waiter.pid ]]; then
    local pid
    pid="$(cat /tmp/fitmunch-shot-waiter.pid)"
    local tick
    for tick in 1 2 3 4 5 6 7 8 9 10; do
      if ! kill -0 "$pid" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
    rm -f /tmp/fitmunch-shot-waiter.pid
  fi
  rm -f /tmp/fitmunch-shot-waiter-stop
}

reject_letterbox() {
  local folder="$1"
  swift "$ROOT/scripts/reject-letterbox.swift" "$folder"
}

capture_pngs() {
  local udid="$1"
  local folder="$2"
  mkdir -p "$folder"
  prepare_sim "$udid"

  echo "Capturing on $udid -> $folder"
  rm -rf /tmp/fitmunch-appstore-screenshots
  mkdir -p /tmp/fitmunch-appstore-screenshots
  start_framebuffer_waiter "$udid" "$folder"
  set +e
  xcodebuild test \
    -project FitMunch.xcodeproj \
    -scheme FitMunch \
    -destination "platform=iOS Simulator,id=$udid" \
    -only-testing:FitMunchUITests/AppStoreScreenshotTests \
    -resultBundlePath "$folder/Test.xcresult" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY=- \
    TEST_RUNNER_SCREENSHOT_DIR="$folder"
  local status=$?
  set -e
  stop_framebuffer_waiter
  if [[ "$status" -ne 0 ]]; then
    echo "xcodebuild test failed ($status)"
    exit "$status"
  fi
  if [[ ! -f "$folder/home.png" && -f /tmp/fitmunch-appstore-screenshots/home.png ]]; then
    echo "Copying PNGs from /tmp/fitmunch-appstore-screenshots"
    cp /tmp/fitmunch-appstore-screenshots/*.png "$folder/"
  fi
  reject_letterbox "$folder"
}

run_capture() {
  local udid="$1"
  local folder="$2"
  local expected_w="$3"
  local expected_h="$4"
  echo "Expected ${expected_w}x${expected_h}"
  capture_pngs "$udid" "$folder"
  verify_pngs "$folder" "$expected_w" "$expected_h"
  swift "$ROOT/scripts/ocr-store-screenshots.swift" "$folder"
}

scale_real_shots() {
  local src="$1"
  local dest="$2"
  local w="$3"
  local h="$4"
  mkdir -p "$dest"
  local name
  for name in home coach scan plan settings workout history; do
    sips -z "$h" "$w" "$src/$name.png" --out "$dest/$name.png" >/dev/null
  done
  verify_pngs "$dest" "$w" "$h"
  swift "$ROOT/scripts/ocr-store-screenshots.swift" "$dest"
}

UDID_69="$(find_udid "iPhone 17 Pro Max" "iPhone 16 Pro Max" || create_udid "iPhone 17 Pro Max" "iPhone 16 Pro Max" || true)"
UDID_67="$(find_udid "iPhone 16 Plus" "iPhone 15 Pro Max" "iPhone 15 Plus" "iPhone 14 Pro Max" || create_udid "iPhone 16 Plus" "iPhone 15 Pro Max" "iPhone 15 Plus" "iPhone 14 Pro Max" || true)"

if [[ -z "${UDID_69:-}" && -z "${UDID_67:-}" ]]; then
  echo "No large iPhone simulator could be found or created."
  exit 1
fi

if [[ -n "${UDID_69:-}" ]]; then
  run_capture "$UDID_69" "$OUT/iphone-69" 1320 2868
fi

if [[ -n "${UDID_67:-}" ]]; then
  run_capture "$UDID_67" "$OUT/iphone-67" 1290 2796
elif [[ -d "$OUT/iphone-69" ]]; then
  echo "No 6.7-inch simulator on this runner. Scaling the real 6.9-inch SwiftUI shots to 1290x2796."
  scale_real_shots "$OUT/iphone-69" "$OUT/iphone-67" 1290 2796
fi

if [[ ! -d "$OUT/iphone-67" ]]; then
  echo "6.7-inch 1290x2796 capture is required."
  exit 1
fi

# 13-inch iPad slot. Build 9 is iPhone-only, so this is the same SwiftUI app
# in iPad compatibility mode. Do not change TARGETED_DEVICE_FAMILY.
ipad_type_name() {
  xcrun simctl list devicetypes \
    | grep -F "iPad Pro 13-inch" \
    | head -1 \
    | sed -E 's/^[[:space:]]+//; s/ \(com\.apple\.CoreSimulator\.SimDeviceType\..*$//'
}

UDID_IPAD="$(find_udid "iPad Pro 13-inch (M5)" "iPad Pro 13-inch (M4)" || true)"
if [[ -z "${UDID_IPAD:-}" ]]; then
  IPAD_TYPE="$(ipad_type_name || true)"
  if [[ -n "${IPAD_TYPE:-}" ]]; then
    UDID_IPAD="$(create_udid "$IPAD_TYPE" || true)"
  fi
fi

if [[ -z "${UDID_IPAD:-}" ]]; then
  echo "No 13-inch iPad Pro simulator could be found or created."
  exit 1
fi

capture_pngs "$UDID_IPAD" "$OUT/ipad-13"
RAW_PNG="$OUT/ipad-13/home.png"
if [[ ! -f "$RAW_PNG" ]]; then
  echo "13-inch iPad capture did not write home.png"
  exit 1
fi
RAW_W="$(sips -g pixelWidth "$RAW_PNG" | awk '/pixelWidth/ {print $2}')"
RAW_H="$(sips -g pixelHeight "$RAW_PNG" | awk '/pixelHeight/ {print $2}')"
if [[ "$RAW_W" == "2064" && "$RAW_H" == "2752" ]]; then
  verify_pngs "$OUT/ipad-13" 2064 2752
  swift "$ROOT/scripts/ocr-store-screenshots.swift" "$OUT/ipad-13"
else
  echo "iPad capture was ${RAW_W}x${RAW_H}. Scaling the real SwiftUI shots to 2064x2752."
  mkdir -p "$OUT/ipad-13-native"
  find "$OUT/ipad-13" -maxdepth 1 -name '*.png' -exec cp {} "$OUT/ipad-13-native/" \;
  scale_real_shots "$OUT/ipad-13-native" "$OUT/ipad-13" 2064 2752
fi

echo "Real-app screenshots written to $OUT"
find "$OUT" -name '*.png' -print
