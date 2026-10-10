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
MARKER="$HOME/Library/Developer/CoreSimulator/Devices/${UDID}/data/fitmunch-launch-holding"
rm -f "$MARKER"

hold_ready() {
  [[ -f "$MARKER" ]] && return 0
  hold_logged
}

# Do not shoot merely because the process exists. That frame is black, and on
# iPhone 11 Pro Max the screenshot call does not return until the hold is over.
app_polls=0
for i in $(seq 1 2400); do
  if app_running; then
    app_polls=$((app_polls + 1))
  fi
  if hold_ready || (( app_polls >= 40 )); then
    echo "launch detected at poll ${i} app_polls=${app_polls}" >> "$OUT/log.txt"
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
