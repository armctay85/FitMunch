#!/usr/bin/env bash
# Capture home.png coach.png scan.png plan.png settings.png from the real SwiftUI app.
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
  local attempt
  for attempt in 1 2; do
    xcrun simctl boot "$udid" >/dev/null 2>&1 || true
    xcrun simctl bootstatus "$udid" -b || true
    if xcrun simctl list devices | grep -F "$udid" | grep -q Booted; then
      break
    fi
    echo "Boot did not stick for $udid (attempt $attempt)"
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    sleep 2
  done
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
  for required in home coach scan plan settings; do
    png="$folder/$required.png"
    if [[ ! -f "$png" ]]; then
      echo "Missing $png"
      return 1
    fi
    w="$(sips -g pixelWidth "$png" | awk '/pixelWidth/ {print $2}')"
    h="$(sips -g pixelHeight "$png" | awk '/pixelHeight/ {print $2}')"
    echo "$required.png ${w}x${h}"
    if [[ "$w" != "$expected_w" || "$h" != "$expected_h" ]]; then
      echo "Expected ${expected_w}x${expected_h}, got ${w}x${h}"
      return 1
    fi
  done
}

# XCUIScreen.screenshot letterboxes this app. The UI test writes a ready file
# per screen; this loop takes a simctl framebuffer shot and acks it.
start_framebuffer_waiter() {
  local udid="$1"
  local folder="$2"
  stop_framebuffer_waiter
  rm -rf /tmp/fitmunch-shot-ready /tmp/fitmunch-shot-ack /tmp/fitmunch-shot-waiter-stop
  mkdir -p /tmp/fitmunch-shot-ready /tmp/fitmunch-shot-ack "$folder"
  (
    set +e
    while [[ ! -f /tmp/fitmunch-shot-waiter-stop ]]; do
      for name in home coach scan plan settings; do
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

run_capture() {
  local udid="$1"
  local folder="$2"
  local expected_w="$3"
  local expected_h="$4"
  mkdir -p "$folder"
  prepare_sim "$udid"

  echo "Capturing on $udid -> $folder (${expected_w}x${expected_h})"
  rm -rf /tmp/fitmunch-appstore-screenshots
  mkdir -p /tmp/fitmunch-appstore-screenshots
  local attempt rc=1
  local log="$folder/xcodebuild.log"
  for attempt in 1 2 3; do
    rm -rf "$folder/Test.xcresult"
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
      TEST_RUNNER_SCREENSHOT_DIR="$folder" \
      | tee "$log"
    rc=${PIPESTATUS[0]}
    set -e
    stop_framebuffer_waiter
    if [[ "$rc" -eq 0 ]]; then
      break
    fi
    if ! grep -q "Unable to find a device matching" "$log"; then
      echo "xcodebuild failed for $udid (exit $rc)"
      return "$rc"
    fi
    echo "Simulator destination was not visible (attempt $attempt). Booting again."
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    sleep 3
    xcrun simctl boot "$udid" >/dev/null 2>&1 || true
    xcrun simctl bootstatus "$udid" -b || true
    sleep 5
  done
  if [[ "$rc" -ne 0 ]]; then
    return "$rc"
  fi
  if [[ ! -f "$folder/home.png" && -f /tmp/fitmunch-appstore-screenshots/home.png ]]; then
    echo "Copying PNGs from /tmp/fitmunch-appstore-screenshots"
    cp /tmp/fitmunch-appstore-screenshots/*.png "$folder/"
  fi

  verify_pngs "$folder" "$expected_w" "$expected_h" || return 1
  swift "$ROOT/scripts/reject-letterbox.swift" "$folder"
  swift "$ROOT/scripts/ocr-store-screenshots.swift" "$folder"
}

frame_slot() {
  local raw="$1"
  local dest="$2"
  local w="$3"
  local h="$4"
  if ! python3 -c "import PIL" >/dev/null 2>&1; then
    python3 -m pip install --user pillow
  fi
  python3 "$ROOT/scripts/frame-appstore-screenshots.py" "$raw" "$dest" \
    --width "$w" --height "$h" \
    --contact-sheet "$dest/contact-sheet.png"
}

# iPhone slots are captured at the simulator's real pixels. Refusing to scale.
UDID_69="$(find_udid "iPhone 17 Pro Max" "iPhone 16 Pro Max" || create_udid "iPhone 17 Pro Max" "iPhone 16 Pro Max" || true)"
if [[ -z "${UDID_69:-}" ]]; then
  echo "No 6.9-inch simulator (iPhone 17 Pro Max or iPhone 16 Pro Max). Refusing to scale."
  exit 1
fi
run_capture "$UDID_69" "$OUT/iphone-69" 1320 2868
frame_slot "$OUT/iphone-69" "$OUT/iphone-69-framed" 1320 2868

UDID_65="$(find_udid "iPhone 14 Plus" "iPhone 13 Pro Max" "iPhone 12 Pro Max" || create_udid "iPhone 14 Plus" "iPhone 13 Pro Max" "iPhone 12 Pro Max" || true)"
if [[ -n "${UDID_65:-}" ]]; then
  run_capture "$UDID_65" "$OUT/iphone-65" 1284 2778
  frame_slot "$OUT/iphone-65" "$OUT/iphone-65-framed" 1284 2778
else
  UDID_65="$(find_udid "iPhone 11 Pro Max" "iPhone XS Max" || create_udid "iPhone 11 Pro Max" "iPhone XS Max" || true)"
  if [[ -z "${UDID_65:-}" ]]; then
    echo "No 6.5-inch simulator for 1284x2778 or 1242x2688. Refusing to scale."
    exit 1
  fi
  run_capture "$UDID_65" "$OUT/iphone-65" 1242 2688
  frame_slot "$OUT/iphone-65" "$OUT/iphone-65-framed" 1242 2688
fi

echo "Real-app screenshots written to $OUT"
find "$OUT" -name '*.png' -print
