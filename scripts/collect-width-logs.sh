#!/usr/bin/env bash
# Save crash reports, the simulator console, and the xcresult for one width.
# Always exits 0 so a missing report does not hide the test result.
set -u

folder="${1:?folder}"
udid="${2:?udid}"
root="artifacts/width-capture"
dest="$root/logs/$folder"
mkdir -p "$dest"

cp "$root/${folder}.log" "$dest/xcodebuild.log" 2>/dev/null || true
if [[ -d "$root/${folder}.xcresult" ]]; then
  rm -rf "$dest/xcresult"
  cp -R "$root/${folder}.xcresult" "$dest/xcresult" || true
fi

copy_recent() {
  local dir="$1"
  [[ -d "$dir" ]] || return 0
  find "$dir" -type f \( \
    -name '*.ips' -o -name '*.crash' -o -name '*hang*' -o -name '*watchdog*' -o -name '*spin*' \
  \) -mmin -40 -exec cp {} "$dest/" \; 2>/dev/null || true
}

copy_recent "$HOME/Library/Logs/DiagnosticReports"
copy_recent "$HOME/Library/Developer/CoreSimulator/Devices/$udid/data/Library/Logs/DiagnosticReports"
copy_recent "$HOME/Library/Developer/CoreSimulator/Devices/$udid/data/Library/Logs/CrashReporter"

python3 - <<PY || true
import subprocess
cmd = [
    "xcrun", "simctl", "spawn", "$udid", "log", "show",
    "--last", "20m", "--style", "compact",
    "--predicate",
    'processImagePath CONTAINS "FitMunch" OR eventMessage CONTAINS "LOCAL_STOREKIT" OR eventMessage CONTAINS "ONBOARDING_"',
]
try:
    with open("$dest/oslog.txt", "w") as out, open("$dest/oslog.err", "w") as err:
        proc = subprocess.run(cmd, stdout=out, stderr=err, timeout=45)
    raise SystemExit(proc.returncode)
except subprocess.TimeoutExpired:
    with open("$dest/oslog.err", "a") as err:
        err.write("log show timed out after 45s\n")
PY

{
  echo "folder=$folder"
  echo "udid=$udid"
  echo "files:"
  find "$dest" -maxdepth 2 -type f | sort
} > "$dest/manifest.txt" || true

exit 0
