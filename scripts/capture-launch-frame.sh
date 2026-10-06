#!/usr/bin/env bash
# Wait until the app under test holds its launch screen, then photograph it.
# Usage: capture-launch-frame.sh <simulator-udid> <output-directory>
set -u

UDID="${1:?udid}"
OUT="${2:?output directory}"
mkdir -p "$OUT"
DEVICE="${HOME}/Library/Developer/CoreSimulator/Devices/${UDID}"

xcrun simctl spawn "$UDID" log stream --level info --style compact \
  --predicate 'eventMessage CONTAINS "LAUNCH_FRAME_HOLD" OR composedMessage CONTAINS "LAUNCH_FRAME_HOLD"' \
  > "$OUT/log.txt" 2>&1 &
LOGPID=$!
cleanup() {
  kill "$LOGPID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

hit=0
for i in $(seq 1 2400); do
  if grep -q LAUNCH_FRAME_HOLD "$OUT/log.txt" 2>/dev/null; then
    echo "saw LAUNCH_FRAME_HOLD in the device log at poll ${i}" >> "$OUT/log.txt"
    hit=1
    break
  fi
  if (( i % 2 == 0 )); then
    found="$(find \
      "$DEVICE/data/Containers/Data/Application" \
      "$DEVICE/data/tmp" \
      "$DEVICE/data/private/tmp" \
      "$DEVICE/data/Library" \
      -name fitmunch-launch-holding -print -quit 2>/dev/null || true)"
    if [[ -n "$found" ]]; then
      echo "flag=${found}" >> "$OUT/log.txt"
      hit=1
      break
    fi
  fi
  sleep 1
done

if [[ "$hit" == "1" ]]; then
  sleep 0.35
  xcrun simctl io "$UDID" screenshot "$OUT/launch.png" || echo "screenshot failed" >> "$OUT/log.txt"
  sleep 0.45
  xcrun simctl io "$UDID" screenshot "$OUT/launch-b.png" || true
else
  echo "LAUNCH_FRAME_HOLD was not seen" >> "$OUT/log.txt"
fi

kill "$LOGPID" >/dev/null 2>&1 || true
wait "$LOGPID" >/dev/null 2>&1 || true
exit 0
