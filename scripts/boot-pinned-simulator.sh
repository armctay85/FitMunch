#!/usr/bin/env bash
# Boot one simulator of a pinned device type on iOS 26.2.
# Usage: boot-pinned-simulator.sh "iPhone 17 Pro Max" ["iPhone 16 Pro Max" ...]
# Prints the UDID on stdout. Logs go to stderr.
# The boot is tried once more if bootstatus fails. Tests are not run here.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OS_VERSION="${FITMUNCH_SIM_OS:-26.2}"

if [[ "$#" -lt 1 ]]; then
  echo "device type required" >&2
  exit 1
fi

runtime="$(python3 "$ROOT/scripts/ios-simulator-on-version.py" runtime "$OS_VERSION")"
if [[ -z "$runtime" ]]; then
  echo "iOS $OS_VERSION simulator runtime is not installed" >&2
  exit 1
fi

udid=""
chosen=""
for type in "$@"; do
  udid="$(python3 "$ROOT/scripts/ios-simulator-on-version.py" udid "$type" "$OS_VERSION" || true)"
  if [[ -n "$udid" ]]; then
    chosen="$type"
    break
  fi
done

if [[ -z "$udid" ]]; then
  for type in "$@"; do
    if xcrun simctl list devicetypes | grep -F "$type (" >/dev/null; then
      echo "Creating '$type' on $runtime" >&2
      if udid="$(xcrun simctl create "FitMunch $type" "$type" "$runtime")"; then
        chosen="$type"
        break
      fi
      udid=""
    fi
  done
fi

if [[ -z "${udid:-}" || -z "$chosen" ]]; then
  echo "No simulator for [$*] on iOS $OS_VERSION" >&2
  exit 1
fi

echo "Pinned simulator type=$chosen udid=$udid runtime=$runtime os=$OS_VERSION" >&2

# One booted simulator. A second runtime beside a long session made CoreSimulator
# drop every destination (xcodebuild exit 70).
xcrun simctl shutdown all >/dev/null 2>&1 || true

boot_once() {
  xcrun simctl boot "$udid" >/dev/null 2>&1 || true
  # bootstatus writes its progress to stdout. Callers capture stdout as the UDID.
  xcrun simctl bootstatus "$udid" -b >&2
}

if ! boot_once; then
  echo "Boot failed for $udid. Retrying the boot once." >&2
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  sleep 2
  boot_once
fi

if ! xcrun simctl list devices available | grep -q "$udid"; then
  echo "Simulator $udid is not in the available device list after boot" >&2
  exit 1
fi

printf '%s\n' "$udid"
