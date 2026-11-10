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

start=$(date +%s)
xcrun simctl install "$UDID" "$app" || true
xcrun simctl launch "$UDID" com.fitmunch.app || true
echo "warmup: launched in $(( $(date +%s) - start ))s udid=$UDID app=$app"
sleep 15
xcrun simctl terminate "$UDID" com.fitmunch.app >/dev/null 2>&1 || true
