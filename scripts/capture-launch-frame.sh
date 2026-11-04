#!/usr/bin/env bash
# Photograph the system launch screen while the app holds it.
# Usage: capture-launch-frame.sh <simulator-udid> <output-directory>
set -u

UDID="${1:?udid}"
OUT="${2:?output directory}"
mkdir -p "$OUT"

# The predicate text itself contains LAUNCH_FRAME_HOLD, so the filter banner
# is not a signal that the app is holding.
# A redirected log stream block-buffers, so the hold line only showed up when
# this process was killed. A pty flushes each line while the app is still holding.
python3 -u -c '
import os, pty, select, signal, subprocess, sys
path, udid = sys.argv[1], sys.argv[2]
out = open(path, "w", buffering=1)
master, slave = pty.openpty()
proc = subprocess.Popen(
    [
        "xcrun", "simctl", "spawn", udid, "log", "stream",
        "--level", "info", "--style", "compact",
        "--predicate", "composedMessage CONTAINS \"LAUNCH_FRAME_HOLD\"",
    ],
    stdin=slave, stdout=slave, stderr=slave, close_fds=True,
)
os.close(slave)

def stop(_signum, _frame):
    proc.terminate()
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
while True:
    if proc.poll() is not None:
        break
    ready, _, _ = select.select([master], [], [], 0.5)
    if not ready:
        continue
    try:
        data = os.read(master, 4096)
    except OSError:
        break
    if not data:
        break
    out.write(data.decode("utf-8", "replace"))
    out.flush()
' "$OUT/log.txt" "$UDID" >/dev/null 2>&1 &
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

# Per-device file written at the start of the hold. A shared /tmp or $HOME
# marker would still be present from the other simulator.
DEVICE="$HOME/Library/Developer/CoreSimulator/Devices/${UDID}"
MARKER="$DEVICE/data/fitmunch-launch-holding"
rm -f "$MARKER"
find "$DEVICE" -name 'fitmunch-launch-confirmed' -delete >/dev/null 2>&1 || true
find "$DEVICE" -name 'fitmunch-launch-holding' -delete >/dev/null 2>&1 || true

hold_ready() {
  [[ -f "$MARKER" ]] && return 0
  if find "$DEVICE/data" -name 'fitmunch-launch-holding' -mmin -3 2>/dev/null | grep -q .; then
    return 0
  fi
  hold_logged
}

# Ready before xcodebuild launches. Shooting on process-exists captured the
# frame after the cover had already gone on iPhone 11 Pro Max.
echo "watcher ready" >> "$OUT/log.txt"
touch "$OUT/watcher-ready"

confirm_hold() {
  local device="$HOME/Library/Developer/CoreSimulator/Devices/${UDID}"
  local found
  found=$(find "$device" -name 'fitmunch-launch-holding' -mmin -5 2>/dev/null | head -n 8 || true)
  if [[ -n "$found" ]]; then
    while IFS= read -r file; do
      echo seen > "$(dirname "$file")/fitmunch-launch-confirmed"
    done <<< "$found"
  fi
  echo seen > "$device/data/fitmunch-launch-confirmed"
}

# Do not shoot merely because the process exists. That frame is past the
# launch cover. Wait until the hold file or the hold log line is real.
for i in $(seq 1 240); do
  if hold_ready; then
    echo "launch detected at poll ${i}" >> "$OUT/log.txt"
    echo "bursting launch screenshots" >> "$OUT/log.txt"
    n=0
    while (( n < 16 )); do
      shot "$(printf 'frame-%03d.png' "$n")"
      n=$((n + 1))
      sleep 0.25
    done
    echo "burst count=$n" >> "$OUT/log.txt"
    confirm_hold
    echo "watcher confirmed" >> "$OUT/log.txt"
    break
  fi
  sleep 0.25
done

if ! ls "$OUT"/frame-*.png >/dev/null 2>&1; then
  echo "LAUNCH_FRAME_HOLD was not seen" >> "$OUT/log.txt"
fi

kill "$LOGPID" >/dev/null 2>&1 || true
wait "$LOGPID" >/dev/null 2>&1 || true
exit 0
