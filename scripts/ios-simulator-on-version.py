#!/usr/bin/env python3
"""Find a simulator runtime or device for one iOS version.

Usage:
  ios-simulator-on-version.py runtime 26.2
  ios-simulator-on-version.py udid "iPhone SE (3rd generation)" 26.2

Prints the runtime identifier or device UDID. Prints nothing when that
version or device is not installed. Version match is exact, so 26.2 does
not select 26.5 or 26.20.
"""

import json
import subprocess
import sys


def runtime_identifier(document, version):
    for runtime in document.get("runtimes", []):
        if runtime.get("version") == version and runtime.get("isAvailable", True):
            return runtime.get("identifier") or ""
    return ""


def _bucket_for_version(buckets, identifier, version):
    chosen = buckets.get(identifier, [])
    if chosen or not identifier:
        return chosen
    token = "iOS-" + version.replace(".", "-")
    for key, devices in buckets.items():
        start = key.find(token)
        if start < 0:
            continue
        after = key[start + len(token):start + len(token) + 1]
        if after.isdigit():
            continue
        return devices
    return []


def device_udid(document, identifier, name, version):
    buckets = document.get("devices", {})
    for device in _bucket_for_version(buckets, identifier, version):
        if device.get("name") == name and device.get("isAvailable", True):
            return device.get("udid") or ""
    return ""


def _simctl_json(*args):
    raw = subprocess.check_output(["xcrun", "simctl", "list", *args, "available", "-j"])
    return json.loads(raw)


def main(argv):
    if len(argv) == 3 and argv[1] == "runtime":
        print(runtime_identifier(_simctl_json("runtimes"), argv[2]))
        return 0
    if len(argv) == 4 and argv[1] == "udid":
        version = argv[3]
        runtimes = _simctl_json("runtimes")
        identifier = runtime_identifier(runtimes, version)
        if not identifier:
            return 0
        print(device_udid(_simctl_json("devices"), identifier, argv[2], version))
        return 0
    sys.exit("usage: ios-simulator-on-version.py runtime VERSION | udid NAME VERSION")


if __name__ == "__main__":
    main(sys.argv)
