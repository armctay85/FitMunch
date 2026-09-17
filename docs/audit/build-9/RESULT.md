# PRE-ASC device audit RESULT: build 9

Evidence class: **CI macos Simulator / unit+UI**.
This is not a physical iPhone or iPad walk. Do not treat this file as App Review clearance. Do not submit for review from this result.

| Field | Value |
|---|---|
| Marketing version | 1.0 |
| `CURRENT_PROJECT_VERSION` | 9 |
| Branch | `cursor/pre-asc-device-audit-c83a` |
| Head SHA (green iOS job) | `a7725e9e472eca9b41474a17c1c767c8f97721ca` |
| PR | https://github.com/armctay85/FitMunch/pull/19 |
| Runner | GitHub Actions `macos-26` (same factory as ios-archive) |
| Xcode | 26.6 (17F113) |
| Sim OS | iOS 26.2 |
| iPhone | iPhone 17 Pro (`5FEB61C5-E3F5-471D-AE23-8A07438D5E92`) exit 0 |
| iPad | iPad Air 11-inch (M3) (`EB7D7CC3-7982-4506-A383-843BB8467C05`) exit 0 |

## CI proof

| Job | Run | Result |
|---|---|---|
| iOS Build and Test (camera script + unit + A–E UI) | https://github.com/armctay85/FitMunch/actions/runs/35272203570 | success (11m31s) |
| Job log | https://github.com/armctay85/FitMunch/actions/runs/35272203570/job/105374057185 | success |
| Artifact `pre-asc-audit-build-9` | same run (xcresult + `summary.txt`) | uploaded |
| Web quality (Jest + `check-ios-camera-usage.sh`) | https://github.com/armctay85/FitMunch/actions/runs/35272203558 | success |
| Prior iOS run (photo-library plist miss) | https://github.com/armctay85/FitMunch/actions/runs/35270302481 | failure, then fixed on this branch |

`scripts/check-ios-camera-usage.sh`, `CameraUsagePlistTests`, and `PaywallCatalogTests` passed on the green iOS run (host bundle has camera + photo-library strings; sellable IDs are `fitmunch_monthly` / `fitmunch_annual`).

## Rows A–E

Status is **CI macos Simulator / unit+UI PASS** on both listed sims. Not physical-device PASS.

| Row | What | Status | Proof |
|---|---|---|---|
| A | App launches without crash | PASS (CI sim) | `testA_AppLaunchesWithoutCrash` passed on iPhone 17 Pro and iPad Air 11-inch (M3). Tab bar appeared under `-ReviewGuards`. Attachment `A-launch` in xcresult. |
| B | Scan entry + camera/library path does not crash | PASS (CI sim) | `testB_ScanCameraOrLibraryDoesNotCrash` + `testTakePhotoDoesNotCrashWhenCameraMissing` passed on both sims. Take a photo did not kill the process. Path is `SafeCameraPicker` / library fallback, not `UIImagePickerController` camera. Simulator has no camera hardware, so this does not prove a live AVCapture capture. |
| C/D | Upgrade opens paywall; plans **or** explicit Retry empty; never silent blank | PASS (CI sim) | `testCD_UpgradeOpensPaywallPlansOrRetry` + `testUpgradeOpensPaywallWithoutCrashing` passed on both sims. Paywall appeared. Test requires `paywall-plans` / subscribe **or** `paywall-retry` / "Couldn't load App Store plans". Old copy "Premium plans did not load from the App Store." must be absent. This is not proof that ASC sandbox products resolved; CI StoreKit often misses products. |
| E | Free path reachable | PASS (CI sim) | `testE_FreePathReachable` passed on both sims. ReviewGuards session shows Free Tier / Upgrade. Home/Today reachable. Relaunch without ReviewGuards shows Create Free Account / Sign In. |

iPad results are iPhone-only binary (`TARGETED_DEVICE_FAMILY=1`) in compatibility mode on iPad Air 11-inch (M3) Simulator. That matches how App Review loads an iPhone app on iPad. It is still a simulator, not the physical Air Apple used on 2026-09-01.

## What this does not prove

- Physical iPhone or iPad hardware, camera permission sheet wording, or a real shutter capture
- App Store Connect sandbox product load for a reviewer Apple ID
- Archive/IPA processed plist on a signed device build (unit tests proved the **simulator host** plist)
- App Review submission readiness beyond CI

## Local gates confirmed before the green run

- Build number 9 in `project.yml` and `ios-archive.yml`
- `bash scripts/check-ios-camera-usage.sh` pass
- Jest: `test_pre_asc_gate.js`, `test_pay_path.js`, `test_ios_store_art.js`

## Follow-up on this branch (already landed)

The first macos test run failed only because the processed host plist dropped `NSPhotoLibraryUsageDescription` (same class as ITMS-90683). `project.yml` now sets that key in `info.properties` and `INFOPLIST_KEY_*`. Camera string was already present. After that fix, unit + A–E UI went green on iPhone and iPad sims.

Do not App Store submit from this PR.
