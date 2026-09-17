#!/usr/bin/env bash
# Fail CI when camera / photo-library APIs are referenced without usage strings.
# ITMS-90683: processed Info.plist omitted NSCameraUsageDescription while
# SafeCameraPicker referenced AVCapture. Source plist alone is not enough;
# project.yml must also set info.properties and INFOPLIST_KEY_*.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

fail() {
  echo "PRE-ASC camera gate FAILED (ITMS-90683 class): $*" >&2
  exit 1
}

SWIFT_FILES=()
while IFS= read -r file; do
  SWIFT_FILES+=("$file")
done < <(find FitMunch -name '*.swift' -type f | sort)

if [ "${#SWIFT_FILES[@]}" -eq 0 ]; then
  fail "no Swift sources under FitMunch/"
fi

CAMERA_HITS="$(grep -nE 'AVCapture(Session|Device|PhotoOutput)|UIImagePickerController|sourceType\s*=\s*\.camera' "${SWIFT_FILES[@]}" || true)"
PHOTO_HITS="$(grep -nE 'PhotosPicker|PHPickerViewController|PHPhotoLibrary|photoLibrary' "${SWIFT_FILES[@]}" || true)"
PICKER_CRASH="$(grep -nE 'UIImagePickerController\(|UIImagePickerController\.isSourceTypeAvailable|sourceType\s*=\s*\.camera' "${SWIFT_FILES[@]}" || true)"

if [ -n "$PICKER_CRASH" ]; then
  echo "$PICKER_CRASH"
  fail "UIImagePickerController camera presentation is banned (iPad 2.1a crash). Use SafeCameraPicker."
fi

plist_string() {
  local file="$1"
  local key="$2"
  python3 - "$file" "$key" <<'PY'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
key = sys.argv[2]
needle = f"<key>{key}</key>"
idx = text.find(needle)
if idx < 0:
    sys.exit(2)
rest = text[idx + len(needle):]
start = rest.find("<string>")
end = rest.find("</string>")
if start < 0 or end < 0 or end <= start:
    sys.exit(3)
value = rest[start + len("<string>"):end].strip()
if not value:
    sys.exit(4)
print(value)
PY
}

require_plist_key() {
  local key="$1"
  local why="$2"
  if ! grep -q "<key>${key}</key>" FitMunch/Resources/Info.plist; then
    fail "FitMunch/Resources/Info.plist missing ${key} (${why})"
  fi
  local value
  if ! value="$(plist_string FitMunch/Resources/Info.plist "$key")"; then
    fail "FitMunch/Resources/Info.plist ${key} is empty (${why})"
  fi
  echo "OK Info.plist ${key}=${value}"
}

require_project_camera() {
  if ! grep -q 'INFOPLIST_KEY_NSCameraUsageDescription' project.yml; then
    fail "project.yml missing INFOPLIST_KEY_NSCameraUsageDescription (processed plist drop)"
  fi
  if ! grep -q 'NSCameraUsageDescription:' project.yml; then
    fail "project.yml info.properties missing NSCameraUsageDescription"
  fi
  if ! grep -q 'photograph grocery receipts' project.yml; then
    fail "project.yml camera usage string is missing or placeholder"
  fi
  echo "OK project.yml NSCameraUsageDescription (info.properties + INFOPLIST_KEY)"
}

if [ -n "$CAMERA_HITS" ]; then
  echo "Camera API references:"
  echo "$CAMERA_HITS"
  require_plist_key "NSCameraUsageDescription" "camera APIs referenced"
  require_project_camera
else
  echo "No camera API references; skipping camera usage requirement."
fi

if [ -n "$PHOTO_HITS" ]; then
  echo "Photo library API references:"
  echo "$PHOTO_HITS"
  require_plist_key "NSPhotoLibraryUsageDescription" "PhotosPicker / library APIs referenced"
  if ! grep -q 'INFOPLIST_KEY_NSPhotoLibraryUsageDescription' project.yml; then
    fail "project.yml missing INFOPLIST_KEY_NSPhotoLibraryUsageDescription (processed plist drop)"
  fi
  echo "OK project.yml NSPhotoLibraryUsageDescription (info.properties + INFOPLIST_KEY)"
fi

echo "PRE-ASC camera gate passed."
