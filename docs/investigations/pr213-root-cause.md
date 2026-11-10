# PR 213 root cause

Investigation branch `cursor/pr213-root-cause-investigation`, started from `8328e4d` (last all-green PR 213 commit). `1aeb260` is evidence only. Nothing here merges, and `.github/workflows/ios-archive.yml` is untouched.

## Launch timeout

**Root cause:** The 6.5 warm-up lives only in `ios-uitest.yml` `run_one` for slug `iphone-11-pro-max`, so every other workflow still lets XCTest be the first launch on a cold simulator, and that first launch crosses the ~60s `XCUIApplication` limit.

**Evidence:**

- Known 6.5 case, fixed on `8328e4d` and green in run `42570991923`: a fresh iPhone 11 Pro Max (`scripts/boot-pinned-simulator.sh` `simctl create`) took 29-66s on the first XCTest launch. After `simctl install`, `simctl launch`, `sleep 15`, `terminate` in `run_one`, the XCTest launch was 9.3s. See `.github/workflows/ios-uitest.yml` (the warm-up that `8328e4d` added, previously lines 137-152).
- `1aeb260` iOS Build and Test log `pr213-1aeb260-build-failed`, line 6527: `PreASCDeviceAuditTests testA_FirstRun` `Failed to launch com.fitmunch.app` at t=61.46s. The launch line is 6524 (`20:57:49`) and the timeout is `20:58:47`. The next test on the same process launched in 9.03s (line 6537).
- That failure is the iPad pass, not the iPhone pass. The iPhone UI suite had already printed `TEST SUCCEEDED` (line 6407). First iPhone launch was 42.05s to the automation session (line 5766) and passed. The iPad destination is iPad Air 11-inch (M3) `926957D7-66BC-4B6B-A0EC-DA0ACCCA873D` (line 5245). It was already in the device list (line 5024). There is no `Creating` line in that log, so this timeout is a cold first launch, not a `simctl create`.
- Design log line 2985 does create a fresh phone: `Creating 'iPhone 11 Pro Max'`. `run-design-uitest.sh` then runs `xcodebuild test` with no warm-up. That job died on the dinner assertion, not on launch.

**Workflows that boot a simulator and call `xcodebuild test` without a warm-up (at `8328e4d`):**

| Caller | Device | Fresh `simctl create`? | Warm-up at 8328e4d |
| --- | --- | --- | --- |
| `ios-uitest.yml` `run_one` slug `iphone-11-pro-max` | iPhone 11 Pro Max, else XS Max | Yes, 11 Pro Max is not on the 26.2 image | Yes |
| `ios-uitest.yml` `run_one` slug `pro-max` | iPhone 17 Pro Max | No, it ships on the image | No |
| `ios-uitest.yml` purchase-sheet step | iPhone 17 Pro Max | No | No |
| `ios-uitest.yml` `run_audit` | 17 Pro Max and 11 Pro Max | 11 Pro Max yes | No |
| `ios-build.yml` via `scripts/run-pre-asc-ci-tests.sh` | iPhone 17 (fallback chain) and iPad Air 11-inch (M3) | Not on the `1aeb260` log | No. This is the 61s failure |
| `scripts/run-design-uitest.sh` | 17 Pro Max, then 11 Pro Max | 11 Pro Max yes (design log 2985) | No |
| `scripts/capture-appstore-screenshots.sh` | 17 Pro Max, first present 6.7 type, 11 Pro Max | 11 Pro Max yes. 6.7 types are created when missing on 26.2 | No. One XCTest retry on `Timed out while launching` |
| `ios-width-capture.yml` | 17 Pro Max and iPhone SE or 13 mini | SE / mini when missing | No. Job is branch-filtered and did not run |
| `scripts/run-flow-recording.sh` | iPhone 17 Pro Max | No | No |

**Fix:** `scripts/warm-simulator-launch.sh` is the same install, launch, 15s, terminate sequence. Every UI-test entry point calls it after the last boot and before `xcodebuild test`. If `FitMunch.app` is not built yet the script prints `warmup: FitMunch.app not built yet` and returns 0. `ios-archive.yml` is not edited.

## M1 Dinner title cut by Generate

**Root cause:** `contentMargins(.bottom, 16, for: .scrollContent)` pads the tail of the scroll content, not the resting fold, and `1aeb260`'s `PlanFoldGuard` never removed the row, so the Monday dinner title still crosses the scroll view's bottom edge.

**Evidence (design log `pr213-1aeb260-design-failed`, 6.5 pass):**

- Scroll view frame `{{0.0, 356.0}, {414.0, 323.7}}` (line 3452). maxY = 356 + 323.7 = 679.7.
- `PLAN_REST fold=679.6666666666666 generateMinY=696.0` (line 3458). The fold is the scroll view's maxY, not the green button. The 16.3pt gap is the bar's top padding (`Theme.Spacing.four` is 16) plus the hairline.
- Dinner title `(32.0, 663.0, 203.33333333333331, 20.333333333333258)` (line 3459). maxY = 683.33, which is 3.66pt past the fold and still 12.7pt above the button.
- Assertion: `TabBarClearanceUITests.swift:117` `Plan at rest: 'Salmon, potatoes, greens' ... is cut by Generate (fold 679.67)`.
- The title was still in the accessibility tree, so the fold guard's `opacity(0)` and `accessibilityHidden` did not apply. There is no fade or gradient on the bar (`Theme.fmBackground` is opaque). The line box is clipped by the scroll view's bottom, which is the top of the Generate bar.
- A 16pt content margin at the end of the content would have lifted the tail, not the row that happens to sit on the resting viewport. That is why the sibling bar (scroll shortened to the bar) still left a partial title.

**Fix:** Store and audit launches (`keepsPlanSummaryVisible`) no longer scroll a partial row under that edge. `ViewThatFits` keeps the largest prefix of the week that fits above the bar, with 16pt of padding inside the fitted height, so the lowest line's maxY is at or above the fold minus 8pt. The fold the tests read is `plan-fold`, a 1pt marker on the top edge of the bar. `TabBarClearanceUITests` and `AppStoreScreenshotTests` measure that at rest, before any drag. Normal launches still scroll Monday dinner to the bottom of the sibling scroll view.

## M2 QA persona on Me screenshots

**Root cause:** The Me store capture signs in with `QA_EMAIL` and requires the label `FitMunch QA`, so the three settings shots show the internal mailbox `hello+qa@fitmunch.com.au`.

**Evidence:**

- Elite QA r6 workbook, Defects M2: all 3 Me shots show `FitMunch QA` and `hello+qa@fitmunch.com.au`. Shots sheet row for 6.9 settings says the same. Verdict line: demo data auto-fail.
- `FitMunchUITests/AppStoreScreenshotTests.swift` `testCaptureSignedInMe` at `8328e4d` (lines 51-72) reads `QA_EMAIL` / `QA_PASSWORD`, signs in, and asserts `FitMunch QA`. It does not pass `-AppStoreScreenshots`.
- `ScreenshotLaunch.PersonaGate` (`FitMunch/Utilities/ScreenshotLaunch.swift`) is only applied from `AuthManager` when that flag is set, and only in Debug. The Me test never took that path. `prepareSession` was also clearing `userDisplayName` and `userEmail` instead of seeding them.

**Fix:** `testCaptureSignedInMe` launches with `-AppStoreScreenshots` and expects the seed persona `Alex Morgan` / `alex.morgan@icloud.com`. The test rejects `FitMunch QA`, `hello+qa`, and the tokens `QA`, `test`, `example`, and `+` in that persona. Real login, flow recording, and `AuthManager.bootstrap` for a normal session are unchanged. `capture-appstore-screenshots.sh` always requires `settings.png` and does not write the QA credential file.

## M3 Release reads audit launch args

**Root cause:** `MealPlanView.keepsPlanSummaryVisible` called `ProcessInfo.processInfo.arguments.contains` for `-FlowQA` and any `-Audit` prefix with no `#if DEBUG`, so a Release build still changed behavior for those arguments.

**Evidence:** `FitMunch/Views/MealPlanView.swift` at `8328e4d`, lines 107-113. `AuditLaunch.flag()` (lines 34-40 of `AuditLaunch.swift`) is already Debug-only and documents that Release ignores every flag. `ScreenshotLaunch.isActive` is Debug-only. The new direct `ProcessInfo` reads bypassed that. Elite QA r6 Defects M3 and the Security sheet both mark this as the hygiene failure. `1aeb260` wrapped the reads in `#if DEBUG` inside the view. This branch goes through `AuditLaunch` instead, so there is one Debug gate.

**Fix:** `keepsPlanSummaryVisible` uses `ScreenshotLaunch.isActive`, `AuditLaunch.isFlowQA`, and a new `AuditLaunch.isAnyAudit`. `isFlowQA` uses the existing Debug-only `flag()`. `isAnyAudit` checks the `-Audit` prefix only inside `#if DEBUG` and returns false in Release. Release does not read those arguments.

## Price line

The plan and scan copy stays exactly `Prices vary by store and week.` This change does not add `cheap`, `Pty Ltd`, or `inc. GST`. StoreKit prices stay on `displayPrice`.

## CI

Green SHA: `f10607a1cc14d6ed87774a45c3915f22f1ce6208` on draft PR https://github.com/armctay85/FitMunch/pull/216. No RevenueCat download flake on this SHA. `ios-archive.yml` was not run (workflow_dispatch only) and was not edited.

| Job | Run | Conclusion |
| --- | --- | --- |
| iOS full-screen UITest | [42752618441](https://github.com/armctay85/FitMunch/actions/runs/42752618441) | Pass. 6.9 warmup 44s, then XCTest launch 8.3s, `440x956`. 6.5 warmup 101s, then XCTest launch 17.3s, `414x896`. No launch timeout. screen-audit skipped (not this branch). |
| iOS design UI tests | [42752618262](https://github.com/armctay85/FitMunch/actions/runs/42752618262) | Pass, including `TabBarClearanceUITests`. 6.9 rest: last meal maxY 656.7, fold 739, limit 731. 6.5 rest: last meal maxY 638.7, fold 679, limit 671. Both end on the lunch line, at least 8pt above the fold, measured before any drag. |
| iOS Build and Test | [42752618167](https://github.com/armctay85/FitMunch/actions/runs/42752618167) | Pass. Pre-ASC warmed the iPad (`926957D7`) in 48s before XCTest, then again in 18s, and printed `PRE-ASC simulator audit passed`. The 61s `testA_FirstRun` timeout did not recur. |
| iOS App Store screenshots | [42752618190](https://github.com/armctay85/FitMunch/actions/runs/42752618190) | Pass. 6.5 and 6.9 Plan and Me shots saved from this run. Me shows Alex Morgan, `alex.morgan@icloud.com`. Plan price line is `Prices vary by store and week.` |
| iOS flow recording | [42752618454](https://github.com/armctay85/FitMunch/actions/runs/42752618454) | Pass. |
| Jest | [42752618482](https://github.com/armctay85/FitMunch/actions/runs/42752618482) | Pass. |
| Web quality (`test`, `ship-safety`) | [42752618232](https://github.com/armctay85/FitMunch/actions/runs/42752618232) | Pass. |
| Build 11 width capture | [42752618215](https://github.com/armctay85/FitMunch/actions/runs/42752618215) | Skipped. The job only runs for two named branches. |

An earlier SHA on this branch, `1be06fd`, failed only design UI tests ([42746323465](https://github.com/armctay85/FitMunch/actions/runs/42746323465)): `DesignFeelUITests` still expected `alex@example.com`. `f10607a` points that assertion at `alex.morgan@icloud.com`. The other jobs were already green on `1be06fd` and are green again on `f10607a`.
