#!/usr/bin/env bash
# Test-only B/D/F simulator audit at 390pt. Do not merge. Does not touch
# App Store Connect or ios-archive.yml.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/artifacts/bdf-demo-audit"
TMP_SHOTS=/tmp/bdf-demo-audit
CREDS=/tmp/fitmunch-qa-credentials
rm -rf "$OUT" "$TMP_SHOTS"
mkdir -p "$OUT/screenshots" "$TMP_SHOTS"

cleanup() {
  rm -f "$CREDS"
}
trap cleanup EXIT

if [[ -z "${QA_EMAIL:-}" || -z "${QA_PASSWORD:-}" ]]; then
  echo "QA_EMAIL or QA_PASSWORD is unset."
  exit 1
fi
umask 077
printf '%s\n%s\n' "$QA_EMAIL" "$QA_PASSWORD" > "$CREDS"
echo "Demo sign-in will use the secret file. Credentials are not printed."

echo "iphone" > /tmp/pre-asc-audit-device

UDID="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 16e" "iPhone 14")"
echo "Using 390pt simulator udid=$UDID"
xcrun simctl list devices | grep -F "$UDID" || true
echo "main_sha_under_test=$(git rev-parse HEAD)"
bash "$ROOT/scripts/set-simulator-region-au.sh" "$UDID"
xcrun simctl privacy "$UDID" grant photos com.fitmunch.app || true
xcrun simctl privacy "$UDID" grant photos-add com.fitmunch.app || true
xcrun simctl privacy "$UDID" grant camera com.fitmunch.app || true
if [[ -f "$ROOT/scripts/fixtures/sample-receipt.png" ]]; then
  xcrun simctl addmedia "$UDID" "$ROOT/scripts/fixtures/sample-receipt.png"
  echo "Added sample receipt to the simulator library."
else
  echo "Sample receipt fixture is missing."
  exit 1
fi
bash "$ROOT/scripts/warm-simulator-launch.sh" "$UDID"

# Step 1: build-for-testing. Full, unredacted xcodebuild output goes to stdout
# (GitHub secret masking only) and to the artifact log. No credentials are used
# at build time.
DD="${RUNNER_TEMP:-$OUT}/DerivedDataBDF"
BUILD_LOG="$OUT/xcodebuild-build-for-testing.log"
set +e
xcodebuild build-for-testing \
  -project FitMunch.xcodeproj \
  -scheme FitMunchStoreKit \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
  -derivedDataPath "$DD" \
  -resultBundlePath "$OUT/BuildForTesting.xcresult" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=- \
  2>&1 | tee "$BUILD_LOG"
BUILD_RC=${PIPESTATUS[0]}
set -e
echo "build_for_testing_exit=$BUILD_RC" | tee "$OUT/step1.txt"
grep -nE "error:|\*\* .* FAILED \*\*|Testing failed|BUILD (SUCCEEDED|FAILED)|TEST BUILD (SUCCEEDED|FAILED)" "$BUILD_LOG" | head -60 > "$OUT/step1-errors.txt" || true

RC=$BUILD_RC
if [[ "$BUILD_RC" -eq 0 ]]; then
  # Step 2: one B/D/F run, only because Step 1 compiled.
  LOG="$OUT/xcodebuild-test.log"
  set +e
  xcodebuild test-without-building \
    -project FitMunch.xcodeproj \
    -scheme FitMunchStoreKit \
    -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
    -only-testing:FitMunchUITests/BDFDemoAuditUITests/testBDF_DemoAccountScanAndStoreKit \
    -testLanguage en \
    -testRegion AU \
    -parallel-testing-enabled NO \
    -derivedDataPath "$DD" \
    -resultBundlePath "$OUT/BDF-test.xcresult" \
    2>&1 | tee "$LOG"
  RC=${PIPESTATUS[0]}
  set -e
else
  echo "Step 1 failed. Step 2 is not run."
fi

if [[ -d "$TMP_SHOTS" ]]; then
  find "$TMP_SHOTS" -type f -name '*.png' -exec cp {} "$OUT/screenshots/" \;
  if [[ -f "$TMP_SHOTS/notes.txt" ]]; then
    python3 - "$CREDS" "$TMP_SHOTS/notes.txt" "$OUT/notes.txt" <<'PY'
import sys
from pathlib import Path
creds, src, dest = sys.argv[1], sys.argv[2], sys.argv[3]
secrets = [line.strip() for line in Path(creds).read_text().splitlines() if line.strip()]
text = Path(src).read_text()
for secret in secrets:
    text = text.replace(secret, "***")
Path(dest).write_text(text)
PY
  fi
fi

{
  echo "evidence_class=CI macos Simulator / BDF demo audit"
  echo "udid=$UDID"
  echo "build_for_testing_exit=$BUILD_RC"
  echo "xcodebuild_exit=$RC"
  echo "=== screenshots ==="
  find "$OUT/screenshots" -type f -name '*.png' | sort
  echo "=== notes ==="
  cat "$OUT/notes.txt" 2>/dev/null || true
} | tee "$OUT/summary.txt"

# Keep the xcresult bundles. Fail closed if the demo password appears in any
# artifact file (the test pastes it via the pasteboard, so it should not).
if grep -rlF -- "$QA_PASSWORD" "$OUT" > /tmp/bdf-secret-hits 2>/dev/null; then
  echo "Password found in artifact files; deleting them:"
  sed "s|$OUT/||" /tmp/bdf-secret-hits
  while read -r f; do rm -f "$f"; done < /tmp/bdf-secret-hits
  echo "secret_scan=hit_removed" >> "$OUT/summary.txt"
else
  echo "secret_scan=clean" >> "$OUT/summary.txt"
fi

if [[ "$RC" -ne 0 ]]; then
  echo "B/D/F simulator audit failed"
  exit "$RC"
fi

for shot in \
  F-demo-sign-in-upgrade-390.png \
  D-storekit-prices-390.png \
  D-restore-390.png \
  B-camera-prompt-390.png \
  B-scan-result-390.png
do
  if [[ ! -f "$OUT/screenshots/$shot" ]]; then
    echo "Missing screenshot: $shot"
    exit 1
  fi
done

echo "B/D/F simulator audit passed on $UDID"
exit 0
