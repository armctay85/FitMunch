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

UDID="$(bash "$ROOT/scripts/boot-pinned-simulator.sh" "iPhone 16" "iPhone 15" "iPhone 14")"
echo "Using 390pt simulator udid=$UDID"
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

LOG="$OUT/xcodebuild.log"
set +e
xcodebuild test \
  -project FitMunch.xcodeproj \
  -scheme FitMunchStoreKit \
  -destination "platform=iOS Simulator,id=$UDID,arch=arm64" \
  -only-testing:FitMunchUITests/BDFDemoAuditUITests/testBDF_DemoAccountScanAndStoreKit \
  -testLanguage en \
  -testRegion AU \
  -parallel-testing-enabled NO \
  -derivedDataPath "${RUNNER_TEMP:-$OUT}/DerivedDataBDF" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY=- \
  2>&1 | python3 - "$CREDS" "$LOG" <<'PY'
import sys
from pathlib import Path
creds_path, log_path = sys.argv[1], sys.argv[2]
secrets = []
try:
    text = Path(creds_path).read_text()
    for line in text.splitlines():
        value = line.strip()
        if value:
            secrets.append(value)
except OSError:
    pass
out = Path(log_path)
# Stream and redact known secrets so the artifact log cannot contain them.
with out.open("w", encoding="utf-8") as fh:
    for raw in sys.stdin:
        line = raw
        for secret in secrets:
            if secret:
                line = line.replace(secret, "***")
        sys.stdout.write(line)
        sys.stdout.flush()
        fh.write(line)
PY
RC=${PIPESTATUS[0]}
set -e

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
  echo "xcodebuild_exit=$RC"
  echo "=== screenshots ==="
  find "$OUT/screenshots" -type f -name '*.png' | sort
  echo "=== notes ==="
  cat "$OUT/notes.txt" 2>/dev/null || true
} | tee "$OUT/summary.txt"

# Do not leave the derived data or an xcresult in the artifact tree.
rm -rf "$OUT/DerivedData" "$OUT"/*.xcresult || true

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
