#!/usr/bin/env bash
# Launch the already built app once outside XCTest.
# A simulator's first XCUIApplication launch takes 29-66s, and XCTest stops
# at about 60s. install, launch, wait, terminate, then the test launch is
# the second one. No -CaptureLaunch, so this writes no hold marker.
# No-ops when FitMunch.app has not been built yet.
# Usage: warm-simulator-launch.sh UDID
set -euo pipefail

UDID="${1:?simulator udid}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

find_app() {
  local root candidate
  local roots=()
  if [[ -n "${RUNNER_TEMP:-}" && -d "${RUNNER_TEMP}" ]]; then
    roots+=("$RUNNER_TEMP")
  fi
  roots+=("$ROOT/artifacts" "$HOME/Library/Developer/Xcode/DerivedData")
  for root in "${roots[@]}"; do
    [[ -d "$root" ]] || continue
    candidate="$(find "$root" -maxdepth 8 -type d -name 'FitMunch.app' -path '*Debug-iphonesimulator/FitMunch.app' -print -quit 2>/dev/null || true)"
    if [[ -n "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

app="$(find_app || true)"
if [[ -z "${app:-}" ]]; then
  echo "warmup: FitMunch.app not built yet, skipped udid=$UDID"
  exit 0
fi

# bootstatus returns immediately when the device is already marked booted,
# including while LaunchServicesMigrator is still on screen. Do not install
# or launch into that window: the test's first frame then lands after the
# launch-cover clock used to expire.
# 0 = quiet, 1 = migration still reported, 2 = log query unavailable.
migration_state() {
  python3 -c '
import subprocess, sys
udid = sys.argv[1]
try:
    proc = subprocess.run(
        [
            "xcrun", "simctl", "spawn", udid, "log", "show",
            "--last", "5s", "--style", "compact",
            "--predicate", "eventMessage CONTAINS \"Data Migration\"",
        ],
        capture_output=True, text=True, timeout=6,
    )
except subprocess.TimeoutExpired:
    sys.exit(1)
text = (proc.stdout or "") + (proc.stderr or "")
if "Waiting on Data Migration" in text:
    sys.exit(1)
if proc.returncode != 0:
    sys.exit(2)
sys.exit(0)
' "$UDID"
}

wait_for_data_migration() {
  local attempt quiet=0 state
  echo "warmup: waiting until data migration is finished udid=$UDID"
  for attempt in $(seq 1 30); do
    if pgrep -lf "CoreSimulator/Devices/${UDID}" 2>/dev/null | grep -E -i "migrat" >/dev/null; then
      quiet=0
      echo "warmup: migrator process still running check=${attempt} udid=$UDID"
      sleep 2
      continue
    fi
    set +e
    migration_state
    state=$?
    set -e
    if [[ "$state" -eq 0 ]]; then
      quiet=$((quiet + 1))
      if (( quiet >= 2 )); then
        echo "warmup: data migration finished after ${attempt} checks udid=$UDID"
        return 0
      fi
    elif [[ "$state" -eq 2 ]]; then
      echo "warmup: migration log unavailable, continuing udid=$UDID"
      return 0
    else
      quiet=0
      echo "warmup: data migration still running check=${attempt} udid=$UDID"
    fi
    sleep 2
  done
  echo "warmup: data migration wait ended, launching anyway udid=$UDID"
  return 0
}

xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b >&2 || true
wait_for_data_migration

start=$(date +%s)
xcrun simctl install "$UDID" "$app" || true
xcrun simctl launch "$UDID" com.fitmunch.app || true
echo "warmup: launched in $(( $(date +%s) - start ))s udid=$UDID app=$app"
sleep 15
xcrun simctl terminate "$UDID" com.fitmunch.app >/dev/null 2>&1 || true
