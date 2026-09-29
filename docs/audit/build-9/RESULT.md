# PRE-ASC device audit RESULT: build 9

Evidence class: **CI macos Simulator / unit+UI**.
This is not a physical iPhone or iPad walk. Do not treat this file as App Review clearance. Do not submit for review from this result.

| Field | Value |
|---|---|
| Marketing version | 1.0 |
| `CURRENT_PROJECT_VERSION` | 9 |
| Branch | `cursor/pre-asc-device-audit-c83a` |
| Head SHA (green iOS job) | `d56ef84b3dac62716c4d5b88b0cebc5183533a56` |
| PR | https://github.com/armctay85/FitMunch/pull/19 |
| Runner | GitHub Actions `macos-26` |
| iPhone | iPhone 14 (`241937B9-77E6-409C-8488-4B7E1F32AD6F`) exit 0 |
| iPad | iPad Air 11-inch (M3) (`EB7D7CC3-7982-4506-A383-843BB8467C05`) exit 0 |
| Screenshot pixels | iPhone 1170x2532 (390x844 pt at 3x). iPad 1640x2360 (820x1180 pt at 2x). |

`XCUIApplication.frame` reported 320x480 during the run. The PNG pixel size is the full simulator framebuffer, not that frame.

## CI proof

| Job | Run | Result |
|---|---|---|
| iOS Build and Test (A–G + sandbox probe) | https://github.com/armctay85/FitMunch/actions/runs/36536711292 | success |
| Web quality | https://github.com/armctay85/FitMunch/actions/runs/36536711272 | success |
| iOS App Store screenshots | https://github.com/armctay85/FitMunch/actions/runs/36536711225 | success |
| Artifact `pre-asc-paywall-screenshots-build-9` | https://github.com/armctay85/FitMunch/actions/runs/36536711292 | id 11020040020 |
| Artifact `pre-asc-audit-build-9` | https://github.com/armctay85/FitMunch/actions/runs/36536711292 | id 11019059594 |

Sellable product IDs are `fitmunch_monthly` and `fitmunch_annual`. `fitmunch_weekly` is not in the app, the StoreKit file, or the paywall. `NSMicrophoneUsageDescription` is removed. Camera and photo-library usage strings stay. Build number stays 9. Archive workflow was not changed and does not submit for review.

Main commit `8a4ea21` failed iOS Build and Test (run https://github.com/armctay85/FitMunch/actions/runs/36548322021). Attempt 1 failed row B on iPad because the test tapped the Camera not available alert's Choose from library and then tapped `scan-choose-library` behind the photo picker. Attempt 2 failed row C on iPhone: `settings-upgrade-premium` existed (accessibility frame y=96, screen frame y=247, visible point {-1,-1}) and the next full swipeUp removed it from the list. PR 25 head `8e726e0` (run https://github.com/armctay85/FitMunch/actions/runs/36551999506) failed row B on both iPhone 14 and iPad Air 11-inch (M3). The alert did appear (`ViewDidAppear`, title Camera not available). `dismissSystemAlerts` then tapped that alert's OK, so the recovery check saw neither the alert nor SafeCameraPicker chrome. That is a test bug, not a hang and not a missing fallback. The table above is the earlier green SHA `d56ef84`. It is not a new A–G PASS for `8a4ea21`. Re-green leaves the fallback alert up, prefers its OK button, skips a second library tap when that alert already opened the library, and scrolls `settings-upgrade-premium` until it is hittable.

## Rows A–G

Status is **CI macos Simulator / unit+UI PASS** on both listed sims. Not physical-device PASS.

| Row | Device | Result | Screenshot |
|---|---|---|---|
| A | iPhone 14 | PASS | A-first-run-iphone.png |
| A | iPad Air 11-inch (M3) | PASS | A-first-run-ipad.png |
| B | iPhone 14 | PASS | B-scan-take-photo-iphone.png |
| B | iPad Air 11-inch (M3) | PASS | B-scan-take-photo-ipad.png |
| C | iPhone 14 | PASS | C-upgrade-paywall-iphone.png |
| C | iPad Air 11-inch (M3) | PASS | C-upgrade-paywall-ipad.png |
| D | iPhone 14 | PASS | D-plans-prices-iphone.png |
| D | iPad Air 11-inch (M3) | PASS | D-plans-prices-ipad.png |
| E | iPhone 14 | PASS | E-retry-iphone.png |
| E | iPad Air 11-inch (M3) | PASS | E-retry-ipad.png |
| F | iPhone 14 | PASS | F-restore-iphone.png |
| F | iPad Air 11-inch (M3) | PASS | F-restore-ipad.png |
| G | iPhone 14 | PASS | G-no-crash-iphone.png |
| G | iPad Air 11-inch (M3) | PASS | G-no-crash-ipad.png |

Row D local prices are monthly 19.99 and annual 149.99. The `FitMunchStoreKit` scheme attaches `FitMunchProducts.storekit`. When the simulator storefront does not return those prices, `-UseLocalStoreKit` renders that same catalog so the audit is not dependent on a US storefront.

## Sandbox fetch (no .storekit file)

`FitMunchSandboxProbe` calls StoreKit for the live IDs. Real products **did load** on both simulators.

| Device | real_sandbox_products_loaded | Prices returned |
|---|---|---|
| iPhone 14 | yes | fitmunch_monthly $12.99, fitmunch_annual $99.99 |
| iPad Air 11-inch (M3) | yes | fitmunch_monthly $12.99, fitmunch_annual $99.99 |

Those are US storefront prices, not A$19.99 and A$149.99. Screenshots: `sandbox-paywall-iphone.png`, `sandbox-paywall-ipad.png`.

## What this does not prove

- Physical iPhone or iPad hardware, or a reviewer Apple ID on iPadOS 27
- That the simulator attached the local .storekit storefront (AUS). The live fetch above is the honest product load.
- Archive submission. Do not App Store submit from this PR.

iPad results are an iPhone-only binary (`TARGETED_DEVICE_FAMILY=1`) in compatibility mode on the iPad Air 11-inch (M3) simulator.
