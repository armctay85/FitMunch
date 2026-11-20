# FitMunch iOS: Claude feedback register (desk audit)
Ops Lead desk audit, Sat 21 Nov 2026, ~8:50am AEDT. Read only: no code, no builds, no App Store Connect (ASC) changes.
Asked by Drew, 21 Nov 8:44am AEDT: "confirm all the Claude feedback inc. images logos etc has been completed and applied to the iOS submission".

## Bottom line
- **No Claude feedback item is in the iOS submission.** Build 11 was submitted on **5 Nov 2026, 6:47pm AEDT** (desk/fitmunch/asc-rejection/rejection-text.md, last line). The Claude audit reached us **13 days later**, on 18 Nov, and Drew approved its 6 items at 10:30am that day (desk/fitmunch/approvals/drew-approved-claude-review-2026-11-18.md, line 1). Build 11 couldn't contain them.
- **Nothing has been applied since.** Build 11 came from commit 907d44d (fitmunch-asc/audit/build11/AUDIT-build11-f7feef1.md, line 20). Only 2 commits have landed on origin/main since then: b757b03 (#221) and 9ae188d (#225, the support form). Neither touches the iOS icon, launch screen, colours or images. `git diff 907d44d origin/main -- FitMunch/Resources` is empty (run 21 Nov 8:47am AEDT).
- **It was always planned for later builds.** The schedule put the new app icon on **build 12** (Mon 23 Nov build, TestFlight Wed 25; build 13 if EQA isn't passed first). The iOS reskin is set for Thu 26 Nov, and the rest ship on "the build after 12" (ops/claude-review-owners-estimates-2026-11-19.md, rows 1 and 5; ops/elite-bar-estimates-2026-11-20.md, lines 389 and 495). None of those runs has happened.
- **Counts (18 rows that apply to the iOS app or its listing): DONE 1, PARTIAL 2, NOT DONE 13, OPEN 2.** Another 10 items are web-only, Stripe-only or not approved. They're listed at the end and not counted.

Visual proof: desk/fitmunch/evidence-2026-11-21/appicon-build11-vs-approved-pack.png. The left image is the build 11 AppIcon (broccoli over a barbell, from 907d44d). The right image is Drew's approved trolley-bite FM icon from the pack.

## Sources searched
- `rg -il claude` under /workspace/desk, /workspace/fitmunch-asc and /workspace/goals (the goals folder has no hits). Then a `find -iname '*claude*'` across the box.
- FitMunch Claude sources found:
  - (S1) desk/fitmunch/approvals/drew-approved-claude-review-2026-11-18.md: the 6 approved items plus the not-approved list.
  - (S2) desk/brand/claude-logos-2026-11-18/fitmunch-logo-5g/README.md: the logo pack.
  - (S3) desk/ops/claude-review-owners-estimates-2026-11-19.md: owners and nights.
  - (S4) desk/design-lead/fitmunch-logo-5g-apply-2026-11-18.md: apply checks, the inventory of where the old mark is used, and the item 5 spec.
  - (S5) desk/ops/elite-bar-estimates-2026-11-20.md: the Design Lead and iOS Lead dated rows.
  - (S6) desk/fitmunch/briefs/workout-save-brief-2026-11-20.md:94: Claude saw a failed gym-plan answer drop the counter from 10 to 9.
- Memory journal, 18 Nov 10:30am: the Claude audit scored the app 5.7/10, with the gym plan at 1/10.
- **OPEN:** Drew's original Claude audit file is not on the box. Only the approved summary (S1) and the logo pack (S2) are here. If the original has iOS items beyond S1, they aren't in this register. Transcript search wasn't available from this executor session.
- Not Claude: the FitMunch teardown (ops/fitmunch-product-teardown-2026-11-17.md:45) says "a Cursor coding agent drew the current logo on 2 Jul 2026 ... nothing shows it was Claude". The Wipper Claude review (desk/wipper/approvals-drew-claude-review-2026-11-18.md) is out of scope for iOS.

## Register (applies to iOS)
Build 11 = 907d44d. "Main" = origin/main 9ae188d, fetched 21 Nov 8:47am AEDT.

| # | Claude item (source) | What was asked | In build 11? | In ASC listing? | Evidence | Status |
|---|---|---|---|---|---|---|
| 1.1 | Logo master, app icon (S1 line 4; S4 line 71) | Trolley-bite FM as the app icon (Forest #0F2A1F, Mint #6EF2B0) | No. AppIcon.png is the old broccoli and barbell, last changed in 0c7bb4d (14 Oct) | No. The store icon comes from the binary (S4 line 81) | FitMunch/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png at 907d44d, md5 27cb75bd…; evidence-2026-11-21/appicon-build11-vs-approved-pack.png | NOT DONE |
| 1.2 | Logo, launch screen (S4 lines 72-74) | LaunchLogo to the new mark, LaunchBackground to Forest | No. LaunchBackground is white #FFFFFF and LaunchLogo is the old mark | n/a | LaunchBackground.colorset/Contents.json at 907d44d (red, green and blue all 0xFF) | NOT DONE |
| 1.3 | Logo, in-app stand-ins (S4 lines 75-79) | Replace the SF Symbol stand-ins with the mark | No. AuthView.swift:23 uses `leaf.circle.fill`, OnboardingView.swift:73 uses `fork.knife.circle.fill`, and SettingsView uses the old LaunchLogo | n/a | 907d44d source, read 21 Nov | NOT DONE |
| 1.4 | Logo, App Store icon (S4 line 81) | The new mark on the listing | n/a | No, it comes from the build 11 binary | as 1.1 | NOT DONE |
| 1.5 | Logo, screenshot frames (S4 line 81; S5 line 414) | Store frames carry the new lockup | n/a | No. Every store set on the box uses the bright-green frame and the old wordmark (/workspace/store-package-r10/contact-sheet-r10.png). The live ASC screenshot set wasn't re-read on 20 Nov (**OPEN** which exact files are live), but no new-brand frame exists anywhere on the box | contact sheet; fitmunch-asc/build11-shots/ (4 shots per size: home, scan, coach, settings) | NOT DONE |
| 1.6 | Logo legibility check at 16 and 32 px (S1 line 4) | EQA legibility at small sizes | Render checks only: PASS at 32 px and up, and with the small mark below 32 px (S4 line 8). No EQA on an app build | n/a | design-lead/fitmunch-logo-5g-apply/*.png | PARTIAL |
| 2.1 | Real gym plan (S1 line 5) | A real training plan from the customer's targets | No. WorkoutPlanGenerator.swift is a static "parity mirror" of web templates (gym beginner, intermediate and advanced, plus home). iOS row 3b (FM-60) "is not in build 11" (S5 line 302) | Listing promises "a weekly workout plan you can tick off" (appstore-metadata.md) | 907d44d WorkoutPlanGenerator.swift:1-4 | NOT DONE |
| 2.2 | Failed AI answers never cost an action (S1 line 5; S6 line 94) | Server must not charge an AI action on a failed answer | No. It's a server fix (D2 in the workout-save brief), and nothing beyond #221 and #225 has merged | n/a | git log 907d44d..origin/main | NOT DONE |
| 3 | Ask about allergies first (S1 line 6) | Ask for allergies before generating food | No. The iOS app has **0** "allerg" matches in FitMunch/ (907d44d and main). iOS Plan calls the same /api/meal-plan/generate (MealPlanView.swift:3) with no allergy input. Allergy PRs 224 and 223 are built, not merged (Wilson, Sat 21 status) | n/a | git grep -i allerg | NOT DONE |
| 4.3 | Duplicate plan on generate (S1 line 7) | No duplicate plan when tapping generate | Unknown on iOS. No iOS test for a double tap. Plan shows "Build my week" and "Generate 7-day plan" together (design-lead/ios-b11-pixel-notes.md, finding 5) | n/a | none | OPEN |
| 4.4 | Blank or partial loading, missing number in the free banner (S1 line 7) | No blank states; the free banner shows its number | Unknown on iOS. Today loading scored 6 and Plan loading scored 6 (pixel notes, lines 53-73). No check against this exact defect | n/a | design-lead/b11/rows.tsv | OPEN |
| 5.1 | One palette (S1 line 8; S4 lines 104-118) | Forest, Mint and Off-white tokens replace the old greens | No. Theme.swift still uses BrandGreen #15803D, buttonGreen #167A36 and green #2BBF5A, with fmBackground #F4F6F2 (light) | Frames are bright green | 907d44d DesignSystem/Theme.swift lines 6-40 | NOT DONE |
| 5.2 | One button (S4 lines 120-124) | Mint fill, Forest text, 48 px | No. Buttons use buttonFill #15803D with white text | n/a | Theme.swift | NOT DONE |
| 5.3 | One card (S4 lines 126-129) | fm-surface card on Forest | No. Cards are white or light (screenshot fitmunch-asc/build11-shots/iphone-69/home.png) | Same in the listing shots | screenshot | NOT DONE |
| 5.4 | Drawn icons replace emoji (S1 line 8; S4 line 141) | Remove emoji | Already true on iOS. The spec says iOS has 0 emoji and keeps its SF Symbols. The emoji grep on FitMunch/*.swift at 907d44d returned 0 | n/a | S4 line 141; grep 21 Nov | DONE (nothing to change on iOS; the drawn set, 5b, isn't drawn yet and is web-facing) |
| 5.5 | Unify the app with the **dark** brand (S1 line 8) | One dark Forest system on iOS | No. Page background is #F4F6F2 in light mode and #101A14 in dark mode, following the device or the Me > Dark Mode toggle. It's not the Forest system, and the listing shots are light | No | home.png, contact sheet | NOT DONE |
| 5.6 | Real product screens as imagery (S1 line 8; S4 lines 151-157) | Real screens, no fakes | Listing shots are real app screens captured by UI test, but with seeded demo data (FitMunch/Utilities/ScreenshotLaunch.swift; S5 line 188: "not customer proof"). Old brand, and the Plan shot was dropped (AUDIT-build11 line 20) | Partly | contact sheet; AUDIT-build11 line 20 | PARTIAL |
| 6.2 | Even protein across meals (S1 line 9) | Even out protein in the generated plan | No. It's a server fix on the shared meal-plan route. Item 6 has no night booked (S3 row 6, "OPEN") | n/a | S3 row 6 | NOT DONE |

## Claude items that don't apply to iOS (listed, not counted)
- 4.1 Blurred hero image: web home page.
- 4.2 Plan versus shopping list mismatch: iOS has no shopping list (PaywallView.swift:442, "No shopping list").
- 4.5 Price spacing gap: web.
- 6.1 Shopping list in shop sizes: no iOS shopping list.
- 6.3 Real swaps with their own numbers: no swap feature on iOS (0 "swap" matches in FitMunch/).
- Not approved: Stripe tab name "Develoop", Klarna, GST wording, ABN in the footer, and the API/MCP surface (S1 line 11). These are web or Stripe.

## What has been done (design only, nothing in the app)
- 18 Nov ~10:30pm AEDT: Design Lead's apply checks and inventory (1a) and the item 5 spec (5a). Renders are in design-lead/fitmunch-logo-5g-apply/ (S4, S3 rows 1 and 5).
- The receipt price label copy was approved by Wilson on 18 Nov (S5 line 482). It isn't in the app.

## What it takes to say "applied to the iOS submission"
A new build (12 or later) must carry 1.1-1.3 and 5.1-5.5. The ASC listing then needs a new icon (from that binary) and new frames (1.5, 5.6). Items 2.1, 2.2, 3 and 6.2 need their server or iOS fixes to pass first. Each item needs EQA 8.5+ with 0 Musts, plus a walkthrough on iPhone and iPad. The acceptance list is in briefs/ios-resubmit-acceptance-2026-11-21.md, section K.
