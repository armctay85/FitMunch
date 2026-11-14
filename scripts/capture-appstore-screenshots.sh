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
  local require_settings="$4"
  local required w h png
  local names=(home coach scan plan)
  if [[ "$require_settings" == "1" ]]; then
    names+=(settings)
  fi
  for required in "${names[@]}"; do
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

run_capture() {
  local udid="$1"
  local folder="$2"
  local expected_w="$3"
  local expected_h="$4"
  mkdir -p "$folder"
  prepare_sim "$udid"
  bash "$ROOT/scripts/warm-simulator-launch.sh" "$udid"

  echo "Capturing on $udid -> $folder (${expected_w}x${expected_h})"
  rm -rf /tmp/fitmunch-appstore-screenshots
  mkdir -p /tmp/fitmunch-appstore-screenshots
  local rc=1
  local log="$folder/xcodebuild.log"
  rm -rf "$folder/Test.xcresult"
  local require_settings=1
  echo "Me capture uses the screenshot persona. It does not sign in."
  set +e
  local attempt
  for attempt in 1 2; do
    rm -rf "$folder/Test.xcresult"
    xcodebuild test \
      -project FitMunch.xcodeproj \
      -scheme FitMunch \
      -destination "platform=iOS Simulator,id=$udid,arch=arm64" \
      -only-testing:FitMunchUITests/AppStoreScreenshotTests \
      -resultBundlePath "$folder/Test.xcresult" \
      CODE_SIGNING_ALLOWED=NO \
      CODE_SIGNING_REQUIRED=NO \
      CODE_SIGN_IDENTITY=- \
      TEST_RUNNER_SCREENSHOT_DIR="$folder" \
      | tee "$log"
    rc=${PIPESTATUS[0]}
    if [[ "$rc" -eq 0 ]]; then
      break
    fi
    if [[ "$attempt" -eq 1 ]] && grep -q "Timed out while launching" "$log"; then
      echo "Launch timed out for $udid. Retrying once."
      continue
    fi
    break
  done
  set -e
  if [[ "$rc" -ne 0 ]]; then
    echo "xcodebuild failed for $udid (exit $rc)"
    return "$rc"
  fi
  if [[ ! -f "$folder/home.png" && -f /tmp/fitmunch-appstore-screenshots/home.png ]]; then
    echo "Copying PNGs from /tmp/fitmunch-appstore-screenshots"
    cp /tmp/fitmunch-appstore-screenshots/*.png "$folder/"
  fi

  verify_pngs "$folder" "$expected_w" "$expected_h" "$require_settings" || return 1
  if [[ "$require_settings" == "1" ]]; then
    swift "$ROOT/scripts/ocr-store-screenshots.swift" "$folder"
  else
    swift "$ROOT/scripts/ocr-store-screenshots.swift" "$folder" --skip-settings
  fi
}

UDID_69="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 17 Pro Max" "iPhone 16 Pro Max")"
run_capture "$UDID_69" "$OUT/iphone-69" 1320 2868

UDID_67="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 16 Plus" "iPhone 15 Plus" "iPhone 14 Plus" "iPhone 15 Pro Max" "iPhone 14 Pro Max")"
run_capture "$UDID_67" "$OUT/iphone-67" 1290 2796

# 6.5 inch App Store slot. 11 Pro Max is 414x896 at 3x, 1242x2688.
UDID_65="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 11 Pro Max" "iPhone XS Max")"
run_capture "$UDID_65" "$OUT/iphone-65" 1242 2688

if [[ ! -d "$OUT/iphone-67" ]]; then
  echo "6.7-inch 1290x2796 capture is required."
  exit 1
fi

# S3 frames wrap the raw captures. OCR has already run on the unframed UI.
echo "Applying S3 frames to the raw captures"
python3 "$ROOT/scripts/frame-store-screenshots.py" "$OUT"

echo "Real-app screenshots written to $OUT"
find "$OUT" -name '*.png' -print
