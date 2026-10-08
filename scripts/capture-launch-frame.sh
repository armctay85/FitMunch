#!/usr/bin/env bash
# Photograph the system launch screen while the app holds it.
# Usage: capture-launch-frame.sh <simulator-udid> <output-directory>
set -u

UDID="${1:?udid}"
OUT="${2:?output directory}"
mkdir -p "$OUT"

# The predicate text itself contains LAUNCH_FRAME_HOLD, so the filter banner
# is not a signal that the app is holding.
xcrun simctl spawn "$UDID" log stream --level info --style compact \
  --predicate 'composedMessage CONTAINS "LAUNCH_FRAME_HOLD"' \
  > "$OUT/log.txt" 2>&1 &
LOGPID=$!
cleanup() {
  kill "$LOGPID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

shot() {
  local name="$1"
  xcrun simctl io "$UDID" screenshot "$OUT/$name" >/dev/null 2>&1 || true
}

app_running() {
  pgrep -f "Devices/${UDID}/.*FitMunch\\.app/FitMunch" >/dev/null 2>&1
}

hold_logged() {
  grep -v Filtering "$OUT/log.txt" 2>/dev/null | grep -q LAUNCH_FRAME_HOLD
}

for i in $(seq 1 2400); do
  if app_running || hold_logged; then
    echo "launch detected at poll ${i}" >> "$OUT/log.txt"
    echo "bursting launch screenshots" >> "$OUT/log.txt"
    n=0
    while (( n < 24 )); do
      shot "$(printf 'frame-%03d.png' "$n")"
      n=$((n + 1))
      sleep 0.35
    done
    echo "burst count=$n" >> "$OUT/log.txt"
    break
  fi
  sleep 0.5
done

if ! ls "$OUT"/frame-*.png >/dev/null 2>&1; then
  echo "LAUNCH_FRAME_HOLD was not seen" >> "$OUT/log.txt"
fi

kill "$LOGPID" >/dev/null 2>&1 || true
wait "$LOGPID" >/dev/null 2>&1 || true
exit 0
