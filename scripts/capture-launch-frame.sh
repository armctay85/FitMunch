#!/usr/bin/env bash
# Photograph the system launch screen while the app holds it.
# Usage: capture-launch-frame.sh <simulator-udid> <output-directory>
set -u

UDID="${1:?udid}"
OUT="${2:?output directory}"
mkdir -p "$OUT"
DEVICE="${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}"

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

flag_ready() {
  local path
  for path in \
    "$HOME/fitmunch-launch-holding" \
    "$DEVICE/data/tmp/fitmunch-launch-holding" \
    "$DEVICE/data/private/tmp/fitmunch-launch-holding" \
    "$DEVICE/data/Library/Shared/fitmunch-launch-holding"
  do
    if [[ -f "$path" ]]; then
      echo "flag=${path}" >> "$OUT/log.txt"
      return 0
    fi
  done
  return 1
}

burst() {
  echo "bursting launch screenshots" >> "$OUT/log.txt"
  local n=0
  local deadline=$((SECONDS + 16))
  while (( SECONDS < deadline )); do
    shot "$(printf 'frame-%03d.png' "$n")"
    n=$((n + 1))
    sleep 0.3
  done
  echo "burst count=$n" >> "$OUT/log.txt"
}

slow=0
for i in $(seq 1 2400); do
  if (( i % 8 == 0 )); then
    shot "$(printf 'slow-%03d.png' "$slow")"
    slow=$((slow + 1))
  fi
  if app_running || flag_ready || grep -q LAUNCH_FRAME_HOLD "$OUT/log.txt" 2>/dev/null; then
    echo "launch detected at poll ${i}" >> "$OUT/log.txt"
    burst
    break
  fi
  sleep 0.5
done

if ! ls "$OUT"/frame-*.png >/dev/null 2>&1 && ! ls "$OUT"/slow-*.png >/dev/null 2>&1; then
  echo "LAUNCH_FRAME_HOLD was not seen" >> "$OUT/log.txt"
fi

kill "$LOGPID" >/dev/null 2>&1 || true
wait "$LOGPID" >/dev/null 2>&1 || true
exit 0
