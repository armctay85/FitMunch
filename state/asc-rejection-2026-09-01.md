# ASC Rejection: FitMunch 1.0 build 6 (2026-09-01)

Build 6 was CI-green and still rejected. Do not treat a green simulator build as App Review proof.

## Guideline 2.1(a): Crash
Settings → tap Upgrade → crash.

## Guideline 2.1(a): Crash
Scan → Take a photo → crash on iPad.

## Guideline 2.1(b): Completeness
Premium plans did not load from the App Store on the subscription page.

## What is not enough
Build 8 added `NSCameraUsageDescription` so ITMS-90683 would upload. That is an upload gate, not a runtime fix and not an App Review gate.

Device audit and automated checks: `docs/PRE_ASC_DEVICE_AUDIT.md`.
