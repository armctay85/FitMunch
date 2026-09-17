#!/usr/bin/env bash
# Run FitMunchTests + PRE-ASC UI rows A–E on GitHub Actions macos simulators.
# Evidence class: CI macos Simulator / unit+UI. Not a physical-device pass.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${PRE_ASC_AUDIT_OUT:-$ROOT/artifacts/pre-asc-audit}"
rm -rf "$OUT"
mkdir -p "$OUT"

{
  echo "=== xcodebuild -version ==="
  xcodebuild -version || true
  echo "=== Available simulators ==="
  xcrun simctl list devices available || true
} | tee "$OUT/simulators.txt"

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
      echo "$candidate|$udid"
      return 0
    fi
  done
  return 1
}

latest_ios_runtime() {
  xcrun simctl list runtimes available \
    | sed -n 's/.*\(com\.apple\.CoreSimulator\.SimRuntime\.iOS[-0-9]*\).*/\1/p' \
    | tail -1
}

create_named() {
  local type="$1"
  local runtime
  runtime="$(latest_ios_runtime)"
  [[ -n "$runtime" ]] || return 1
  xcrun simctl list devicetypes | grep -F "$type" >/dev/null || return 1
  local udid
  udid="$(xcrun simctl create "FitMunch Audit $type" "$type" "$runtime")"
  echo "$type|$udid"
}

IPHONE_PICK="$(find_udid \
  "iPhone 17 Pro" "iPhone 17" "iPhone 16 Pro" "iPhone 16" "iPhone 15 Pro" "iPhone 15" \
  || create_named "iPhone 17 Pro" \
  || create_named "iPhone 16 Pro" \
  || create_named "iPhone 15 Pro" \
  || true)"

IPAD_PICK="$(find_udid \
  "iPad Air 11-inch (M3)" "iPad Air 13-inch (M3)" "iPad Air 11-inch" \
  "iPad Pro 11-inch (M4)" "iPad Pro 11-inch" "iPad (10th generation)" \
  || create_named "iPad Air 11-inch (M3)" \
  || create_named "iPad Pro 11-inch (M4)" \
  || create_named "iPad Air 11-inch" \
  || true)"

if [[ -z "${IPHONE_PICK:-}" ]]; then
  echo "No iPhone simulator available" | tee "$OUT/summary.txt"
  exit 1
fi

IPHONE_NAME="${IPHONE_PICK%%|*}"
IPHONE_UDID="${IPHONE_PICK##*|}"
echo "iPhone=$IPHONE_NAME udid=$IPHONE_UDID" | tee "$OUT/destination-iphone.txt"

run_tests() {
  local label="$1"
  local udid="$2"
  local bundle="$OUT/${label}.xcresult"
  echo "=== xcodebuild test ($label) destination id=$udid ==="
  xcodebuild test \
    -project FitMunch.xcodeproj \
    -scheme FitMunch \
    -destination "platform=iOS Simulator,id=$udid" \
    -only-testing:FitMunchTests \
    -only-testing:FitMunchUITests/PreASCDeviceAuditTests \
    -only-testing:FitMunchUITests/ReviewCrashGuardTests \
    -resultBundlePath "$bundle" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY=-
}

set +e
run_tests "iphone" "$IPHONE_UDID"
IPHONE_RC=$?
set -e
echo "iphone_exit=$IPHONE_RC" | tee "$OUT/iphone-exit.txt"

IPAD_RC=0
IPAD_NOTE="not-run"
if [[ -n "${IPAD_PICK:-}" ]]; then
  IPAD_NAME="${IPAD_PICK%%|*}"
  IPAD_UDID="${IPAD_PICK##*|}"
  echo "iPad=$IPAD_NAME udid=$IPAD_UDID" | tee "$OUT/destination-ipad.txt"
  set +e
  run_tests "ipad" "$IPAD_UDID"
  IPAD_RC=$?
  set -e
  echo "ipad_exit=$IPAD_RC" | tee "$OUT/ipad-exit.txt"
  IPAD_NOTE="$IPAD_NAME exit=$IPAD_RC"
else
  echo "No iPad simulator on this runner" | tee "$OUT/destination-ipad.txt"
fi

{
  echo "evidence_class=CI macos Simulator / unit+UI"
  echo "iphone=$IPHONE_NAME"
  echo "iphone_exit=$IPHONE_RC"
  echo "ipad=$IPAD_NOTE"
  echo "tests=FitMunchTests,PreASCDeviceAuditTests,ReviewCrashGuardTests"
} | tee "$OUT/summary.txt"

if [[ "$IPHONE_RC" -ne 0 ]]; then
  echo "PRE-ASC iPhone simulator tests failed ($IPHONE_RC)"
  exit "$IPHONE_RC"
fi

echo "PRE-ASC iPhone simulator tests passed. iPad: $IPAD_NOTE"
exit 0
