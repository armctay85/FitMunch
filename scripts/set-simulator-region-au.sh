#!/usr/bin/env bash
# Set a simulator's region to Australia before the app launches.
# An unsigned simulator storefront follows the device region. The GitHub
# runner default is US, and that storefront returns USD $12.99 / $99.99.
# Australia is the storefront whose App Store prices are 19.99 / 149.99.
# This does not start SKTestSession and does not invent a price.
set -euo pipefail

UDID="${1:?simulator udid}"
DEVICE_ROOT="$HOME/Library/Developer/CoreSimulator/Devices/$UDID/data"
PREFS="$DEVICE_ROOT/Library/Preferences"
GLOBAL="$PREFS/.GlobalPreferences.plist"

xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
mkdir -p "$PREFS"

/usr/libexec/PlistBuddy -c "Delete :AppleLocale" "$GLOBAL" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :AppleLocale string en_AU" "$GLOBAL"
/usr/libexec/PlistBuddy -c "Delete :AppleLanguages" "$GLOBAL" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :AppleLanguages array" "$GLOBAL"
/usr/libexec/PlistBuddy -c "Add :AppleLanguages:0 string en-AU" "$GLOBAL"
/usr/libexec/PlistBuddy -c "Add :AppleLanguages:1 string en" "$GLOBAL"

# Drop a cached US storefront so the next launch reads the region.
rm -rf \
  "$DEVICE_ROOT/Library/Caches/com.apple.AppleMediaServices" \
  "$DEVICE_ROOT/Library/Caches/com.apple.storekitd" \
  "$DEVICE_ROOT/Library/Caches/com.apple.itunesstored" \
  || true

# Australia's storefront id. storekitd ignores this if it only trusts the region.
STORE="$PREFS/com.apple.itunesstored.plist"
/usr/libexec/PlistBuddy -c "Delete :StorefrontIdentifier" "$STORE" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :StorefrontIdentifier string 143460" "$STORE" || true

xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b || true
xcrun simctl spawn "$UDID" defaults write "Apple Global Domain" AppleLocale -string "en_AU" || true
xcrun simctl spawn "$UDID" defaults write "Apple Global Domain" AppleLanguages -array "en-AU" "en" || true
# SpringBoard reads the region at boot. Shut down once more so the next launch sees Australia.
xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b || true

echo "simulator_region udid=$UDID AppleLocale=$(/usr/libexec/PlistBuddy -c 'Print :AppleLocale' "$GLOBAL" 2>/dev/null || echo missing)"
