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

fast_flag() {
  local path
  for path in \
    "$DEVICE/data/tmp/fitmunch-launch-holding" \
    "$DEVICE/data/private/tmp/fitmunch-launch-holding" \
    "$DEVICE/data/Library/Shared/fitmunch-launch-holding"
  do
    if [[ -f "$path" ]]; then
      echo "flag=${path}"
      return 0
    fi
  done
  return 1
}

hit=0
for i in $(seq 1 2400); do
  if grep -q LAUNCH_FRAME_HOLD "$OUT/log.txt" 2>/dev/null; then
    echo "saw LAUNCH_FRAME_HOLD in the device log at poll ${i}" >> "$OUT/log.txt"
    hit=1
    break
  fi
  if flag_path="$(fast_flag)"; then
    echo "${flag_path} at poll ${i}" >> "$OUT/log.txt"
    hit=1
    break
  fi
  if (( i % 3 == 0 )); then
    found="$(find \
      "$DEVICE/data/Containers/Data/Application" \
      "$DEVICE/data/tmp" \
      "$DEVICE/data/private/tmp" \
      "$DEVICE/data/Library" \
      -maxdepth 5 \
      -name fitmunch-launch-holding -print -quit 2>/dev/null || true)"
    if [[ -n "$found" ]]; then
      echo "flag=${found}" >> "$OUT/log.txt"
      hit=1
      break
    fi
  fi
  sleep 0.5
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
