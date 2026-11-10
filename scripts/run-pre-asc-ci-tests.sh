#!/usr/bin/env bash
# PRE-ASC rows A–G on a 390pt-class iPhone simulator and iPad Air 11-inch (M3).
# Row D (local StoreKit config beside the app) is XCTSkipped: that session
# fails with SKInternalErrorDomain Code=3. The isolated proof stays a separate
# step. A second scheme fetches live product IDs and records the honest result.
# Evidence class: CI macos Simulator / unit+UI. Not a physical-device pass.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${PRE_ASC_AUDIT_OUT:-$ROOT/artifacts/pre-asc-audit}"
rm -rf "$OUT" /tmp/pre-asc-audit /tmp/pre-asc-audit-device /tmp/pre-asc-audit-mode
mkdir -p "$OUT" /tmp/pre-asc-audit/screenshots

{
  echo "=== xcodebuild -version ==="
  xcodebuild -version || true
  echo "=== Available simulators ==="
  xcrun simctl list devices available || true
  echo "=== Device types ==="
  xcrun simctl list devicetypes | grep -E 'iPhone|iPad Air 11' || true
} | tee "$OUT/simulators.txt"

# 390pt phones: iPhone 14, 13, 12. Pinned to iOS 26.2 with the iPad.
IPHONE_UDID="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 14" "iPhone 13" "iPhone 12" "iPhone 17" "iPhone 16")"
IPAD_UDID="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPad Air 11-inch (M3)")"
echo "iPhone udid=$IPHONE_UDID os=26.2" | tee "$OUT/destination-iphone.txt"
echo "iPad udid=$IPAD_UDID os=26.2" | tee "$OUT/destination-ipad.txt"

boot_sim() {
  local udid="$1"
  bash scripts/set-simulator-region-au.sh "$udid"
}

run_xcode() {
  local label="$1"
  local device="$2"
  local udid="$3"
  local scheme="$4"
  local mode="$5"
  shift 5
  local bundle="$OUT/${label}.xcresult"
  local rc=1
  local log="$OUT/${label}.log"
  echo "$mode" > /tmp/pre-asc-audit-mode
  echo "$device" > /tmp/pre-asc-audit-device
  rm -rf "$bundle"
  boot_sim "$udid"
  # The iPad's first XCTest launch timed out at 61s. Warm after the region reboot.
  bash "$ROOT/scripts/warm-simulator-launch.sh" "$udid"
  echo "=== xcodebuild test scheme=$scheme label=$label mode=$mode ==="
  xcodebuild test \
    -project FitMunch.xcodeproj \
    -scheme "$scheme" \
    -destination "platform=iOS Simulator,id=$udid,arch=arm64" \
    -testLanguage en \
    -testRegion AU \
    -resultBundlePath "$bundle" \
    "$@" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY=- \
    2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  return "$rc"
}

# SKTestSession.buyProduct throws notEntitled on the iOS 26.5 runtime and
# Product.products then falls through to the live store, which has fitmunch_weekly.
# The same session on iOS 26.2 loads only the local catalog and entitles the purchase.
# The catalog proof already runs on 26.2. These unit tests use that runtime too.
storekit_udid() {
  bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 17 Pro" "iPhone 17 Pro Max"
}

set +e
STOREKIT_UDID="$(storekit_udid || true)"
if [[ -z "${STOREKIT_UDID:-}" ]]; then
  echo "iOS 26.2 simulator is required for StoreKitLifecycleTests" | tee "$OUT/storekit-runtime.txt"
  STOREKIT_RC=1
else
  echo "storekit_unit udid=$STOREKIT_UDID os=26.2" | tee "$OUT/storekit-runtime.txt"
  run_xcode "iphone-storekit" "iphone" "$STOREKIT_UDID" "FitMunch" "local" \
    -only-testing:FitMunchTests \
    -skip-testing:FitMunchTests/FitMunchProductsStoreKitTests \
    -parallel-testing-enabled NO
  STOREKIT_RC=$?
fi

run_xcode "iphone" "iphone" "$IPHONE_UDID" "FitMunchStoreKit" "local" \
  -only-testing:FitMunchUITests/PreASCDeviceAuditTests \
  -only-testing:FitMunchUITests/ReviewCrashGuardTests
IPHONE_RC=$?

run_xcode "ipad" "ipad" "$IPAD_UDID" "FitMunchStoreKit" "local" \
  -only-testing:FitMunchUITests/PreASCDeviceAuditTests \
  -only-testing:FitMunchUITests/ReviewCrashGuardTests
IPAD_RC=$?

run_xcode "iphone-sandbox" "iphone" "$IPHONE_UDID" "FitMunchSandboxProbe" "sandbox" \
  -only-testing:FitMunchUITests/SandboxProductProbeTests
IPHONE_SANDBOX_RC=$?

run_xcode "ipad-sandbox" "ipad" "$IPAD_UDID" "FitMunchSandboxProbe" "sandbox" \
  -only-testing:FitMunchUITests/SandboxProductProbeTests
IPAD_SANDBOX_RC=$?
set -e

mkdir -p "$OUT/screenshots"
if [[ -d /tmp/pre-asc-audit ]]; then
  cp -R /tmp/pre-asc-audit/. "$OUT/"
fi

set +e
python3 - "$OUT/rows.tsv" "$OUT/audit-table.md" <<'PY'
import sys
from pathlib import Path
rows_path, out_path = sys.argv[1:]
text = Path(rows_path).read_text() if Path(rows_path).exists() else ""
found = {}
for line in text.splitlines():
    parts = line.split("\t")
    if len(parts) < 4:
        continue
    found[(parts[0], parts[1])] = (parts[2], parts[3])
lines = ["| Row | Device | Result | Screenshot |", "|---|---|---|---|"]
missing = False
for row in "ABCDEFG":
    for device in ("iphone", "ipad"):
        status, shot = found.get((row, device), ("FAIL", "missing"))
        # Row D needs a local StoreKit config beside the app. That is skipped.
        if row == "D" and status == "SKIP":
            lines.append(f"| {row} | {device} | {status} | {shot} |")
            continue
        if status != "PASS" or shot == "missing":
            missing = True
        lines.append(f"| {row} | {device} | {status} | {shot} |")
Path(out_path).write_text("\n".join(lines) + "\n")
sys.exit(1 if missing else 0)
PY
TABLE_RC=$?
set -e

{
  echo "evidence_class=CI macos Simulator / unit+UI"
  echo "iphone=iOS-26.2"
  echo "iphone_udid=$IPHONE_UDID"
  echo "iphone_exit=$IPHONE_RC"
  echo "storekit_unit_udid=${STOREKIT_UDID:-missing}"
  echo "storekit_unit_exit=$STOREKIT_RC"
  echo "ipad=iPad Air 11-inch (M3)"
  echo "ipad_udid=$IPAD_UDID"
  echo "ipad_exit=$IPAD_RC"
  echo "iphone_sandbox_exit=$IPHONE_SANDBOX_RC"
  echo "ipad_sandbox_exit=$IPAD_SANDBOX_RC"
  echo "audit_table_exit=$TABLE_RC"
  echo "local_scheme=FitMunchStoreKit"
  echo "local_storekit=FitMunchUITests/FitMunchProducts.storekit"
  echo "sandbox_scheme=FitMunchSandboxProbe"
  if [[ -f "$OUT/sizes.txt" ]]; then
    echo "=== screenshot point sizes ==="
    cat "$OUT/sizes.txt"
  fi
  echo "=== sandbox reports ==="
  for report in "$OUT"/sandbox-fetch-*.txt; do
    [[ -f "$report" ]] || continue
    echo "--- $(basename "$report") ---"
    cat "$report"
  done
  echo "=== audit table ==="
  cat "$OUT/audit-table.md" || true
} | tee "$OUT/summary.txt"

fail=0
for code in "$STOREKIT_RC" "$IPHONE_RC" "$IPAD_RC" "$IPHONE_SANDBOX_RC" "$IPAD_SANDBOX_RC" "$TABLE_RC"; do
  if [[ "$code" -ne 0 ]]; then
    fail=1
  fi
done

for shot in \
  A-first-run-iphone.png A-first-run-ipad.png \
  B-scan-take-photo-iphone.png B-scan-take-photo-ipad.png \
  C-upgrade-paywall-iphone.png C-upgrade-paywall-ipad.png \
  E-retry-iphone.png E-retry-ipad.png \
  F-restore-iphone.png F-restore-ipad.png \
  G-no-crash-iphone.png G-no-crash-ipad.png \
  sandbox-paywall-iphone.png sandbox-paywall-ipad.png
do
  if [[ ! -f "$OUT/screenshots/$shot" ]]; then
    echo "Missing screenshot: $shot"
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "PRE-ASC simulator audit failed"
  exit 1
fi

echo "PRE-ASC simulator audit passed on iOS 26.2 iPhone $IPHONE_UDID and iPad $IPAD_UDID"
exit 0
