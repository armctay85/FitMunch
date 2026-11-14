#!/usr/bin/env bash
# Photograph the system launch screen while the app holds it.
# Usage: capture-launch-frame.sh <simulator-udid> <output-directory>
set -u

UDID="${1:?udid}"
OUT="${2:?output directory}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

# Let the log stream open log.txt before we append. Its open truncates.
sleep 0.3

shot() {
  local name="$1"
  xcrun simctl io "$UDID" screenshot "$OUT/$name" >/dev/null 2>&1 || true
}

hold_logged() {
  [[ -f "$OUT/log.txt" ]] || return 1
  # The predicate banner also contains LAUNCH_FRAME_HOLD. The app line is
  # "FitMunch[pid] ... LAUNCH_FRAME_HOLD".
  grep LAUNCH_FRAME_HOLD "$OUT/log.txt" 2>/dev/null | grep -v Filtering | grep -q 'FitMunch\['
}

# The app writes fitmunch-launch-holding to its container, NSTemporaryDirectory,
# /tmp, SIMULATOR_SHARED_RESOURCES_DIRECTORY ($DEVICE/data), and the host home.
# A recursive find of a freshly migrated device tree made each poll take seconds,
# so the burst started after the cover had already gone.
DEVICE="$HOME/Library/Developer/CoreSimulator/Devices/${UDID}"
CONTAINER=""

refresh_container() {
  CONTAINER="$(xcrun simctl get_app_container "$UDID" com.fitmunch.app data 2>/dev/null || true)"
}

marker_paths() {
  local suffix="$1"
  printf '%s\n' \
    "$DEVICE/data/fitmunch-launch-${suffix}" \
    "$DEVICE/data/tmp/fitmunch-launch-${suffix}" \
    "/tmp/fitmunch-launch-${suffix}" \
    "$HOME/fitmunch-launch-${suffix}"
  if [[ -n "$CONTAINER" ]]; then
    printf '%s\n' \
      "$CONTAINER/fitmunch-launch-${suffix}" \
      "$CONTAINER/tmp/fitmunch-launch-${suffix}"
  fi
}

clear_markers() {
  local path
  while IFS= read -r path; do
    rm -f "$path"
  done < <(marker_paths holding)
  while IFS= read -r path; do
    rm -f "$path"
  done < <(marker_paths confirmed)
}

hold_ready() {
  # The log line is written when the cover task starts. Check it before any
  # filesystem probe so a slow simctl call cannot miss the hold window.
  hold_logged && return 0
  local path
  while IFS= read -r path; do
    [[ -f "$path" ]] && return 0
  done < <(marker_paths holding)
  return 1
}

refresh_container
clear_markers

# Ready before xcodebuild launches. Shooting on process-exists captured the
# frame after the cover had already gone on iPhone 11 Pro Max.
echo "watcher ready" >> "$OUT/log.txt"
touch "$OUT/watcher-ready"

confirm_hold() {
  refresh_container
  local path
  while IFS= read -r path; do
    local dir
    dir="$(dirname "$path")"
    mkdir -p "$dir" 2>/dev/null || true
    echo seen > "$path" 2>/dev/null || true
  done < <(marker_paths confirmed)
  echo "watcher confirmed" >> "$OUT/log.txt"
}

frame_accepted() {
  python3 "$ROOT/scripts/pick-launch-frame.py" "$OUT" "$OUT/accepted-launch.png" >> "$OUT/log.txt" 2>&1
}

# Do not shoot merely because the process exists. That frame is past the
# launch cover. Wait until the hold file or the hold log line is real.
# xcodebuild is still compiling when this loop starts. Keep waiting until
# the cover writes the hold. 0.25s * 1500 is 6.25 minutes.
for i in $(seq 1 1500); do
  if hold_ready; then
    echo "launch detected at poll ${i} $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/log.txt"
    echo "bursting launch screenshots" >> "$OUT/log.txt"
    n=0
    accepted=0
    while (( n < 12 )); do
      shot "$(printf 'frame-%03d.png' "$n")"
      n=$((n + 1))
      echo "shot n=$n $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT/log.txt"
      # Confirm only after a frame passes the existing launch-screen picker.
      # A post-launch Today shot must not dismiss the cover.
      if frame_accepted; then
        accepted=1
        echo "burst count=$n" >> "$OUT/log.txt"
        confirm_hold
        break
      fi
    done
    if (( accepted == 0 )); then
      echo "burst count=$n no launch frame" >> "$OUT/log.txt"
    fi
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
