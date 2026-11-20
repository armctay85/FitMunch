# FitMunch iOS resubmission: customer acceptance matrix (gate)
Ops Lead, Sat 21 Nov 2026, ~8:50am AEDT. This is the acceptance list for the next App Review submission (build 12 or later, app 6760215679, bundle com.fitmunch.app). It adds to the gate skill fitmunch-pre-asc-device-audit, rows A-I, and replaces nothing in it.
Inputs: ios-test-coverage-2026-11-21.md (the gaps) and ios-claude-feedback-register-2026-11-21.md (the brand items).

## Gate rules
- **Every row runs on both devices:**
  - **iPhone:** a 6.1in-class phone (iPhone 16e or 16), or TestFlight on a real device. The pass device is real or TestFlight wherever the row says DEV.
  - **iPad:** iPad Air 11-inch (M3), simulator or TestFlight. That's Apple's review device (rejection-text.md), and the app runs there in compatibility mode.
- **Run on the exact build being submitted:**
  - Build number and commit go at the top of every evidence file.
  - Use the prod API, a fresh QA account (drews@mail.grokbot.com aliases, [QA TEST] marked) and the demo review account.
  - **No seeded or screenshot launch flags. No `-UseLocalStoreKit`** on SBX rows.
- **Evidence for every row, saved under /workspace/fitmunch-asc/audit/build<N>/acceptance/<row-id>-{iphone|ipad}.png:**
  - a screenshot of each step's input and output
  - a screen recording for the flow rows
  - a short note with the steps, the device, PASS or FAIL, and the time in AEDT
- **Who runs it and how often:**
  - EQA or Ops Lead runs every row, never the builder.
  - Run every row twice for PASS: run1 and run2, no code change between them.
- **Score bar:** EQA 8.5+ with 0 Musts on the visual rows.
- **One FAIL anywhere means no resubmission.**
- **SBX** means a real Apple sandbox purchase, made with a Sandbox Apple ID on a TestFlight or development build against Apple's sandbox. A local .storekit file doesn't count.

## A. Install, launch, account
| ID | Screen | Input | Expected output (pass condition) |
|---|---|---|---|
| A1 | Cold launch | Fresh install, logged out, no network prompt pre-granted | Launch screen shows the **new FM mark on Forest** (once 1.2 ships). The first screen appears in under 3s with no crash. No camera or photo prompt at launch |
| A2 | Register | Name, new email, password of 8+ characters | Account created. The prod GET /api/auth/me returns that name and email. The app lands on onboarding or tabs |
| A3 | Register, bad input | Empty name, a malformed email, a 7-character password | The inline error names the field. No crash. The button stays disabled or shows the error |
| A4 | Register, existing email | An email already in use | Clear "already registered" copy (the server string), not "Session expired" |
| A5 | Sign in | Demo review account (credentials from the secret path, never pasted into evidence) | Tabs appear within 5s. Me shows the demo name. Same result on iPad |
| A6 | Sign in, wrong password | A valid email with a wrong password | Shows "Invalid email or password." (the server string). The field keeps focus. Fixes the E2 Auth error FAIL |
| A7 | Log Out | Me > Log Out | Returns to Auth. Relaunching stays logged out (the Keychain token is cleared) |
| A8 | Delete Account | Me > Delete Account > Delete Everything, on a fresh QA account | The confirmation copy is clear and the app returns to Auth. Signing in again with the same credentials **fails**. Prod /api/auth/login returns 401. Evidence from both the app and the API |
| A9 | Session expiry | Revoke the token server-side, then open Coach | Shows "Session expired. Please sign in again." and the sign-in screen. No crash |

## B. Onboarding and consent
| ID | Screen | Input | Expected output |
|---|---|---|---|
| B1 | Onboarding welcome, goals, plan step | Goal = lose; sex, age, height and weight; activity | Calorie and protein targets show numbers. Relaunch, and Today shows the same targets |
| B2 | Onboarding validation | Skip the required fields | "Name and email required" (or the field-specific message). Can't advance |
| B3 | Onboarding allergies (**new; Claude item 3**) | Pick peanut, plus "no other" | The allergy is saved to the profile, and the server profile shows it. The question comes **before** any AI food output |
| B4 | AI consent: Not now | First Coach send, then Not now | Coach, Scan AI and Plan stay off with the explanation copy. Today and Me still work |
| B5 | AI consent: Allow | Allow | The first Coach, Scan and Plan calls proceed. Me > Privacy shows AI on. Toggling it off re-blocks them |

## C. Today and logging
| ID | Screen | Input | Expected output |
|---|---|---|---|
| C1 | Today empty | New account | "No meals logged today" shows. Rings show 0 against the targets from B1 |
| C2 | Log meal | Breakfast, "Oats with milk", 350 cal, 15P/50C/8F | The meal appears under Breakfast. The rings and Daily Summary add up exactly (350 cal, Remaining = target − 350). Prod /api/meals/log has the row |
| C3 | Log meal, bad input | Blank name, negative calories, text in the number fields | Blocked with clear copy. Nothing is saved |
| C4 | Free limit | Log a 4th meal on a free account | The paywall opens (per the Review Notes). The first 3 meals stay intact |
| C5 | Delete meal | Tap the bin on a meal | The meal is removed and the totals recompute. It stays gone after a relaunch |
| C6 | Date switch | Back one day, then forward | The previous day shows its own meals. The forward arrow is disabled on today |
| C7 | Meal detail (DetailView) | Tap a meal | Items and macros match what was logged. Back returns to Today |
| C8 | Offline | Airplane mode, then open Today | The offline notice shows once (not twice). No blank screen |

## D. Plan: meals and training
| ID | Screen | Input | Expected output |
|---|---|---|---|
| D1 | Generate a 7-day plan | Premium or a trial account, targets from B1, peanut allergy from B3 | 7 days × meals load. A loading state shows with no blank screen. Each day sits within ±10% of the calorie target, and protein is spread across meals (**Claude 6.2**). **0 items containing peanut**, checked by EQA's allergen list. "Prices vary by store and week." shows |
| D2 | Double tap generate | Tap Generate twice fast | One plan, not two (**Claude 4.3**). One AI action is charged, as the /api/ai/usage delta shows |
| D3 | Generation fails | Force a timeout (EQA harness) or go offline | A clear error and Retry. **The AI action count is unchanged** (**Claude 2.2**) |
| D4 | Plan relaunch | Kill the app and reopen | The same plan is still there (saved) |
| D5 | Training plan | Gym, Intermediate; then Home | The plan is **built from the user's targets and goal** (**Claude 2.1**, FM-60). Every exercise has sets, reps and rest. Ticking off persists after a relaunch |
| D6 | Free user on Plan | Free account, tap Generate | The paywall opens. No blank screen |

## E. Scan (receipt)
| ID | Screen | Input | Expected output |
|---|---|---|---|
| E1 | Camera permission | Scan > Take photo, **on a real device (DEV)** | The camera prompt uses the Info.plist string. Allow opens the camera. Don't Allow gives clear copy plus Choose from library |
| E2 | Real receipt, camera (DEV) | A photo of a real Australian supermarket receipt (no personal details) | The items are read. Each line shows macros, or "Not in our food list yet". A haul score shows. Same receipt on web gives the same macros (±5%) |
| E3 | Receipt from the photo library | The same receipt from Photos (iPhone and iPad) | Same as E2 |
| E4 | Unreadable photo | A blurred or non-receipt photo | "Couldn't read" plus Retake. No AI action charged on the fail |
| E5 | Price label | Any receipt with prices | Cost lines read "Paid $X on d Mon (your receipt)", and are never shown as a current price (approved label). No store names |
| E6 | Log the haul to today | Tap "Log haul to today's meals" | Today's totals rise by the shown amounts |
| E7 | Offline scan | Airplane mode | Offline copy. No hang |

## F. Coach
| ID | Screen | Input | Expected output |
|---|---|---|---|
| F1 | Ask Coach | "What should I eat after training?" | A relevant answer within 20s. It mentions protein and nothing unsafe or medical. The usage meter goes down by exactly 1 |
| F2 | Allergy-aware answer | "Give me a snack idea" with a peanut allergy | No peanut in the answer |
| F3 | Coach fails | Force a server error | Error copy plus retry. **The meter is unchanged** |
| F4 | Free limit | Exhaust 10 free actions | Clear limit copy and a path to the paywall |
| F5 | Long answer layout | An answer of more than 15 lines | Scrolls. The last line clears the tab bar (iPhone and iPad) |

## G. Paywall, purchase, restore (SBX, the reason Apple rejected us)
| ID | Screen | Input | Expected output |
|---|---|---|---|
| G1 | Reach the paywall (exact Review Notes steps) | Demo account: Me > Upgrade, on **iPad Air 11 M3** and iPhone | Monthly and Annual load from **Apple's sandbox** within 10s. No Weekly card. The Review Notes steps match the screen exactly |
| G2 | Prices and storefront | Sandbox account on an AU storefront; repeat on a US storefront | AU shows A$19.99/month and A$149.99/year. US shows Apple's USD price. Trial copy shows only if an intro offer **actually exists in ASC** |
| G3 | Paywall layout | iPhone 390pt and iPad | The headline is complete (sandbox-paywall-ipad.png showed "Eat to your goals with" cut off). Terms and Privacy work. All tap targets are at least 44pt |
| G4 | Buy Monthly (SBX) | Tap Monthly > confirm with the Sandbox Apple ID | The Apple sheet shows the right product and price. After it succeeds, Premium unlocks (the 4th meal logs, Plan generates). Me shows Premium. RevenueCat shows the transaction |
| G5 | Buy Annual (SBX) | A fresh sandbox account | Same as G4, for Annual |
| G6 | Cancel the sheet | Open the purchase, then cancel | Back on the paywall. No error, no unlock |
| G7 | Restore, with a purchase (SBX) | Delete and reinstall, sign in, then Restore | Premium comes back. Shows "Restored" |
| G8 | Restore, with no purchase | A fresh sandbox account, Restore | Shows "No purchases to restore" |
| G9 | Plans fail to load | Network off on the paywall | Error, then Retry and Restore. Retry works once back online |
| G10 | Renewal or expiry (SBX accelerated) | Wait for the sandbox renewal or expiry | It renews, or locks again on expiry with no crash |

## H. ASC setup (gate row H, desk-checked in ASC before submit)
| ID | Check | Pass condition |
|---|---|---|
| H1 | Subscriptions attached | fitmunch_monthly and fitmunch_annual appear in the version's "In-App Purchases and Subscriptions" section. Weekly is not attached |
| H2 | Availability | Both are on sale in all countries the app is sold in (at least AU and US), not "2 of 175" |
| H3 | Intro offer | Either a 14-day intro offer exists on both in ASC, or the Review Notes, app copy and metadata stop claiming one |
| H4 | Review Notes accuracy | Every sentence is true for this build. Delete "we confirmed a sandbox purchase completes" unless G4 evidence exists. Steps match G1 exactly. Name iPad compatibility mode |
| H5 | Agreements | The Paid Apps Agreement is active and the updated Developer Program License Agreement is accepted |
| H6 | Demo account | Sign-in works on the build (A5) and its details are in the Sign-In Information fields |
| H7 | Review screenshots on the subscriptions | Present and showing the current paywall |
| H8 | Release | Set to manual release (Drew's yes, 21 Nov) |

## I. iPad (gate row I)
| ID | Check | Pass condition |
|---|---|---|
| I1 | Every row in A-G | Run on the iPad Air 11 M3 as well as the iPhone, with screenshots of both |
| I2 | Orientation | Compatibility-mode window in portrait and landscape. No clipped content |

## J. Metadata match (gate row G)
| ID | Check | Pass condition |
|---|---|---|
| J1 | Description and subtitle claims | Every claim in appstore-metadata.md is shown working in rows A-G (meal plan, receipt scan, Coach, workout plan, AI consent, prices) |
| J2 | Screenshots | Every listing screenshot is captured from this build, with no feature that fails a row. The Plan shot isn't truncated |

## K. Brand (Claude items, needed before Drew's "applied to the submission" can be claimed)
| ID | Check | Pass condition |
|---|---|---|
| K1 | App icon | AppIcon.png in the submitted binary is the trolley-bite FM from the pack (svg/fitmunch-app-icon.svg). The home screen in light, dark and tinted modes is legible |
| K2 | Launch screen | Forest background with the full-colour mark |
| K3 | In-app marks | AuthView and Onboarding use the mark, not SF Symbol stand-ins. Settings uses the new mark |
| K4 | Palette, button, card | Forest, Mint and Off-white tokens only. No #15803D, #167A36 or #2BBF5A left in Theme.swift |
| K5 | Store screenshots | New frames on Forest with the new lockup, captured from this build. Real screens, not mockups |
| K6 | Store icon | ASC shows the new icon once the build is attached |
| K7 | EQA | Visual verdict 8.5+ with 0 Musts at 6.9in, 6.1in and on iPad |

## Sign-off
RESULT = PASS only if every row above is PASS twice, with evidence paths filled in. Drew is told the result with the evidence index, never "should be fine now".
