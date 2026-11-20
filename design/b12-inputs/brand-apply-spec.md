# FitMunch logo 5g: apply checks (item 1) and item 5 spec
Design Lead, Wed 18 Nov 2026, ~10:30pm AEDT. One-off box-only run (no cloud agent, no image generation, no code changed).
Sources: Drew's pack /workspace/desk/brand/claude-logos-2026-11-18/fitmunch-logo-5g/ (README), approvals /workspace/desk/fitmunch/approvals/drew-approved-claude-review-2026-11-18.md (items 1 and 5), /workspace/desk/ops/elite-recommendation-bar.md, Design Lead section of /workspace/desk/ops/elite-bar-estimates-2026-11-20.md, Wilson's draft /workspace/desk/ops/claude-review-owners-estimates-2026-11-19.md. Repo armctay85/FitMunch main @ b757b03 (read through the GitHub read tools). Live www.fitmunch.com.au read with curl on 18 Nov ~10:15pm AEDT.
The mark is Drew's and is not redrawn anywhere here. Every fix below changes only the variant picked, the size, the spacing or the background.

## (a) Apply checks

**Headline: PASS at 32 px and up, and with the small mark below 32 px. 5 FAILs, all fixed by the pack's own rules (variant or minimum size). No change to the mark.**

Colours used:
- Pack: Forest #0F2A1F, Mint #6EF2B0, Off-white #F3F0E8 (README).
- Live site: --fridge #07130d (header and theme-color), --fridge2 #0c1c14 (footer), --paper #eef2ee, --leaf #1f9d4a (CTA). Source: public/css/fm-tokens.css lines 4–12 on main, and the same values in the live https://www.fitmunch.com.au/css/fm-tokens.css. The header background is .fm-nav in fm-shell.css:88 (background: var(--fridge)).
- The site's #07130d is not the pack's Forest. The contrast between the two is 1.24:1, so they read as two different greens side by side. Item 5 fixes this (see the palette).

Contrast (WCAG):
- Mint on Forest: 10.93:1
- Mint on --fridge: 13.53:1
- Forest on white: 15.31:1
- Forest on --paper: 13.54:1
- Off-white on Forest: 13.45:1
- Mint on white: 1.40:1, which is why the pack says Mint is never used on white.

Renders are in /workspace/desk/design-lead/fitmunch-logo-5g-apply/:

| # | Check | File | Result | What fails | Smallest fix (mark unchanged) |
|---|---|---|---|---|---|
| 1 | Full mark at 32 px on Forest, --fridge, white (one-colour) and --paper | 01-marks-32-24-20-16-forest-white.png | PASS | none | none |
| 2 | Full mark at 24, 20 and 16 px | 01 | FAIL | The FM counters fill in at 20 and 16 px and are soft at 24 px | Below 32 px use fitmunch-mark-small-* (pack rule) |
| 3 | Small mark at 24, 20 and 16 px on all 4 grounds | 01 | PASS | At 16 px the wheels are 2 px dots, but the trolley and bite silhouette holds | none |
| 4 | Horizontal lockup at 32 px tall (143 px wide): full-colour, reversed, one-colour | 02-lockups-32-16.png | PASS | none | none |
| 5 | Horizontal lockup at 16 px tall (71 px wide) | 02 | FAIL | Below the pack's 120 px minimum width, and the wordmark can't be read | Minimum 27 px tall (= 120 px wide). Below that, use the small mark alone |
| 6 | Stacked lockup at 32 and 16 px tall | 02 | FAIL | The wordmark can't be read | Stacked only at 120 px wide or more (my estimate from the renders). Never in a header or favicon |
| 7 | Site header mock, 1440 and 390, on --fridge and on Forest | 03-site-header-mock.png | PASS | none | Use the horizontal full-colour lockup at 32 px tall. See row 8 for today's markup |
| 8 | Today's header markup: a 32x32 or 28x28 img of logo.svg plus a text "FitMunch" | repo (see the inventory) | FAIL at the 8 slots that are 28 px | 28 px is below 32 px for the full mark | Swap the img and text for the lockup SVG at 32 px tall (aria-label "FitMunch"), or use the small mark in the 28 px slots |
| 9 | PT co-brand spot (coach plan header: trainer logo, divider, FitMunch) on white and Forest at 40 px | 04-pt-cobrand-mock.png | PASS | none | One-colour lockup on white, reversed on Forest, with 1 wheel diameter of clear space (17.4% of the mark's height, 7 px at 40 px) |
| 10 | PT co-brand at 24 px tall (107 px wide) | 04 | FAIL | Below the 120 px minimum | Minimum 27 px tall in the co-brand slot |
| 11 | iOS home-screen grid at 180, 87 and 58 px against the real MyFitnessPal, MacroFactor, Fitbod and Cal AI icons. All 4 were fetched (App Store AU via the iTunes Search API), so there's no OPEN slot | 05-ios-home-grid-light.png, 05-ios-home-grid-dark.png | PASS | On a dark wallpaper the Forest tile edge sinks (Cal AI has the same issue) and the Mint glyph carries it | none |
| 12 | Squint and blur strip (6 px Gaussian) | 06-ios-grid-squint-blur.png | PASS | The trolley still reads as a cart when blurred | none |
| 13 | Pack favicon.svg (the small mark on a Forest tile) at 16 and 32 px | icons/ in the pack | PASS | none | none |

Customer proof: UNTESTED. These are renders and mocks, not a customer test. Drew said no to a real-people test, so the mark is never called customer-tested.

### Where the old mark is used today (to swap in the item 1 PRs)

Website (repo public/, live on www.fitmunch.com.au):
- **Favicon:** `<link rel="icon" type="image/svg+xml" href="/assets/logo.svg"/>` on all 36 HTML pages, e.g. app.html:7. **/favicon.ico returns 404 live**, and no page has a PNG or ICO fallback.
- **Header and footer logo:** /assets/logo.svg in 40 img tags across 35 files:
  - 26 at 32x32
  - 8 at 28x28
  - 1 sized by CSS, at app.html:554
  - 1 set from JS, at app.html:5279 (`mark.src = '/assets/logo.svg'`)
  - Each sits beside the HTML text wordmark .logo-text or .fm-brand.
- **apple-touch-icon:** /assets/apple-touch-icon.png on 4 pages (app.html:8, for-pts.html:16, index.html, login.html).
- **OG images:** /assets/og-image.jpg as og:image on 20 pages and twitter:image on 8; og-image.webp is also in assets.
- **theme-color:** #07130d on 27 pages. The pack says #0F2A1F.
- **Manifest:** public/app_manifest.json (live 200):
  - It uses the off-brand blue #4361ee for theme and background.
  - Its icons icon-192.png and icon-512.png return 404 live, and it marks them "any maskable".
  - No page links it.
  - Replace it with the pack's manifest icons (icon-192, icon-512, icon-512-maskable with purpose "maskable").
- **Other old brand files, live or in the repo:**
  - public/assets/favicon-32.png (live 200, linked from no page)
  - public/assets/logo-512.png (live 200)
  - public/brand/index.html plus logo-icon.svg, logo-social-profile.svg and logo-wordmark.svg (a live /brand/ page)
  - public/FitMunch_broccoli_logo.png (live 200), public/generated-icon.png
  - root FitMunch_broccoli_logo.png, generated-icon.png and app-icon-prompt.md
  - Android Capacitor launcher mipmaps in android/app/src/main/res/mipmap-*/ic_launcher*.png and drawable*/ic_launcher_*.xml (legacy, not shipped on iOS)
- **PT co-brand:** public/js/fm-coach.js, lines 190–191 (trainer logo upload and preview), 239–242, 335 and 341–355. The FitMunch side of that header is where row 9 applies.

iOS app (FitMunch/):
- **AppIcon:** Resources/Assets.xcassets/AppIcon.appiconset/AppIcon.png, a single 1024 universal image.
- **Launch screen:** Info.plist UILaunchScreen uses UIImageName LaunchLogo and UIColorName LaunchBackground.
  - LaunchLogo.imageset holds LaunchLogo@2x.png and @3x.png.
  - LaunchBackground.colorset is white #FFFFFF. Moving it to Forest needs the full-colour mark; on white it needs the one-colour mark (Mint is never used on white).
- **In-app logos:**
  - SettingsView.swift:59 and :101 use Image("LaunchLogo").
  - LaunchFrameCapture.swift:76 uses Image("LaunchLogo").
  - AuthView.swift:23 uses the SF Symbol leaf.circle.fill as a logo stand-in. Replace it with the mark.
  - OnboardingView.swift:73 uses the SF Symbol fork.knife.circle.fill as a logo stand-in. Replace it with the mark.
- **Brand colours:** BrandGreen.colorset (#15803D light, #22C55E dark) and BrandGreenSoft.colorset; DesignSystem/Theme.swift lines 6–63 (see item 5).
- **App Store assets:** the store icon comes from AppIcon.png in the binary. The screenshot frames follow /workspace/desk/design-lead/store-frames-2026-11/fitmunch-store-frame-spec.md, which carries the current wordmark frame, so the frames get the new lockup.

Email templates:
- server/email.js has 5 HTML headers at lines 117, 175, 213, 310 and 434.
- Each uses a text wordmark "Fit<span style=color:#1f9d4a>Munch" on #07130d, with links and buttons in #1f9d4a.
- Fix: use a hosted PNG of the horizontal reversed lockup (pack png/fitmunch-horizontal-reversed-400h.png shown at 32 px tall, alt "FitMunch") on Forest, or the Off-white text wordmark if images are blocked.

## (b) Item 5 spec: unify the app with the dark brand (one page)

**Goal line:** one dark FitMunch system across the web app, the site shell and iOS, so every screen sits beside MacroFactor (our grid's top UI mark, 8.5, against FitMunch iOS 6.8) and looks like one product with one accent, and never like a template with emoji.

**Leader matched: MacroFactor.** It scores top in our grid for UI, paywall and onboarding. One restrained system (a single accent, drawn line icons, real data screens) is the bar item 5 has to clear.

Options:
1. **MacroFactor-grade system on Drew's Forest, Mint and Off-white.** WINNER. One palette, one button, one card, a drawn icon set, real screens.
2. A Cal AI-style mono black and white, photo-first system. Rejected: it throws away Drew's approved colours, and photo-first is a logging pattern, not a system.
3. A MyFitnessPal-style light, dense, blue-led system. Rejected: it fights the dark brand Drew approved and matches the leader we beat on looks, not the one we chase.
4. Keep today's split, with a dark web shell, a light iOS and #1f9d4a/#2bbf5a greens. Rejected: this split is what item 5 exists to fix.

Why 1 wins: it is the only option that keeps Drew's mark and colours and closes the 1.7-point UI gap to MacroFactor in one move.

Customer proof: **UNTESTED.** EQA changed-surface checks and the walkthroughs in P-Web and P-iOS decide pass.

**Palette (tokens).** One token set, used in CSS custom properties and in Theme.swift/xcassets:

| Token | Hex | Use | Contrast |
|---|---|---|---|
| fm-forest | #0F2A1F | App and site background (replaces --fridge #07130d and iOS fmBackground dark #101A14) | Off-white on it 13.45:1 |
| fm-forest-deep | #0A1F16 | Footer and tab bar (replaces --fridge2 #0c1c14) | Off-white on it 15.11:1 |
| fm-surface | #173A2C | Cards and sheets on Forest | Off-white on it 10.99:1; Mint 8.93:1; mute 6.42:1 |
| fm-line | #2A5240 | Card borders and dividers (decorative only) | 1.74:1 on Forest, decorative only. Input borders use fm-mute-dark (7.85:1) |
| fm-mint | #6EF2B0 | The one accent: primary button fill, focus ring, active tab, key numbers | On Forest 10.93:1. Never on white or Off-white (1.40 / 1.23:1) |
| fm-offwhite | #F3F0E8 | Primary text on dark; background for light pages (legal, emails) | Forest on it 13.45:1 |
| fm-mute-dark | #A8BFB3 | Secondary text on dark | 7.85:1 on Forest |
| fm-mute-light | #4F6358 | Secondary text on light | 5.66:1 on Off-white, 6.45:1 on white |
| fm-error-dark / fm-error-light | #FF8F80 / #B3261E | Errors | 6.92:1 on Forest / 5.74:1 on Off-white |

Retire --leaf #1f9d4a as the CTA colour: white text on it is 3.51:1, which fails 4.5:1 for 16 px text. Also retire --green #2bbf5a, iOS buttonFill #15803D, buttonGreen, fmBrand and BrandGreen. Mint replaces them all.

**One button.**
- Primary: fm-mint fill, fm-forest text (10.93:1), 600 weight, 48 px tall (44 pt iOS minimum), radius 12, no shadow. Pressed state is fm-mint at 88%. Focus is a 2 px fm-offwhite ring offset 2 px.
- Secondary: transparent, a 1.5 px fm-mute-dark border, fm-offwhite text.
- On light pages: fm-forest fill with fm-offwhite text.
- One size, full-width on phones.

**One card.**
- fm-surface fill, 1 px fm-line border, radius 16, padding 20 (16 on phones), no drop shadow on dark.
- Title in fm-offwhite at 600 weight, meta in fm-mute-dark.
- Numbers use tabular figures; key numbers are in fm-mint.

**Drawn icon set (replaces every emoji).**
- One family: 24 px grid, 2 px stroke, round caps and joins, 2 px corner radius, fm-offwhite with an fm-mint active state, SVG on web and template-rendered PDF/SVG on iOS. Drawn by Design Lead.
- The shopping list uses a **bag** icon, not a trolley, so the trolley belongs to the logo alone and the mark is never redrawn as an icon.
- Icons needed:
  - home, coach-chat (replaces the robot), plate (meals), dumbbell, barbell, run
  - trend (progress), bowl (meal plan), bag (shopping list), camera-scan, receipt
  - heart, check, close, clipboard (plan), people (clients), warning, bolt (quick), spark (AI), bulb (insight, replaces the brain)
  - install, target, card (billing), scale, download, save, image, menu, arrow-up-right, refresh, link, send, calendar, chat, lock, sign-out, import, plus, celebrate-check
  - food set: egg, plant, legume, prawn, fish, butter/fat, meat, leafy, pan, apple, grain, milk, nut (allergen)
  - About 55 icons.
- iOS has **0 emoji** (it uses 19 SF Symbols). It keeps the SF Symbols, except the two logo stand-ins in item 1.

Emoji in use: **232 across 4 files** on main @ b757b03:
- public/app.html: 210
- public/script.js: 19
- server.js: 2 (console logs only at lines 1623 and 1625, which customers don't see; swap them to plain text)
- public/login.html: 1 (✓ at line 893)

The full list with file and line is in the appendix.

**Imagery: real product screens only.** No fakes and no real customer data.
- Use:
  - /workspace/x-story-plan/screens/fitmunch-ios-plan-inprogress.png and fitmunch-ios-scan-inprogress.png
  - The App Store screenshot set (EQA 8.92) captured from FitMunchUITests/AppStoreScreenshotTests.swift on a QA account
  - Fresh simulator and web captures from the QA test account (drews@mail.grokbot.com sign-ups, demo data)
  - The web /app.html screens once their features pass live twice (the working-first rule)
- Never use the Me/account screen of a real account, real client names, or receipts with a real person's details.

**SEO freeze.** As Wilson ruled, reskins that change only looks (tokens, buttons, cards, icons and logo files) stay outside the SEO freeze. URLs, titles, meta, headings and body copy stay unchanged. Emoji that sit inside copy strings are swapped for an inline SVG with aria-hidden="true", and the words around them stay exactly as they are.

**Acceptance (per PR):**
- EQA 8.5+ with 0 Musts on the changed surface at 390 and 1440 (web), and on 6.9in and 6.1in (iOS).
- 0 emoji left in the files listed in the appendix (grep for the emoji ranges).
- No hex outside the token set in the changed files.
- Every advertised action on the reskinned screen still works in two walkthroughs.

## Owners and nights (proposal, to book with Wilson)

Rules:
- The first design night is Sun 22 Nov.
- Max one design run per night per repo. Web and iOS share armctay85/FitMunch, so it's one run per night in total.
- Each run goes after that night's fix runs and never displaces a P0 or P1.
- Budget is ~4% per night for FitMunch and Wipper combined.
- Usage figures are ESTIMATES (UNTESTED), sized off Wilson's figure that one W&C PR round plus an EQA changed-surface check is ~0.8–1.2%.

| Run | Item | Owner | Night | Est. usage (share of weekly limit) |
|---|---|---|---|---|
| 1a Apply checks + inventory (this file) | 1 | Design Lead (box) | Wed 18 Nov (done) | ~0.2% (this run, combined with 5a) |
| 5a Item 5 spec (this file) | 5 | Design Lead (box) | Wed 18 Nov (done) | (included above) |
| 5b Drawn icon set, ~55 SVGs, plus a token file (CSS and Swift), handed to the leads | 5 | Design Lead (box, not a repo run) | Fri 20 Nov | ~0.4% |
| 5c Web tokens + one button + one card in fm-tokens.css, fm-shell.css and fm-elite.css, on working pages only | 5 | FitMunch Web & Checkout via cloud agent PR | Sun 22 Nov (first design night) | ~0.8% |
| 1c iOS AppIcon.png, LaunchLogo, LaunchBackground to Forest, AuthView and Onboarding stand-ins to the mark | 1 | iOS Lead via cloud agent PR | Mon 23 Nov (rides build 12, TestFlight Wed 25) | ~0.2% |
| 5c fix round | 5 | W&C | Tue 24 Nov | ~0.3% |
| 1b Web brand PR: favicon.ico/svg/PNGs, apple-touch, a new manifest, 40 logo img swaps, theme-color #0F2A1F, OG 1200x630 from the pack, 5 email headers | 1 | W&C via cloud agent PR | Wed 25 Nov build (held unmerged until build 12 is live, so the icon changes once) | ~0.5% |
| 5d iOS: Theme.swift + colorsets to the tokens, one FMButton, one FMCard, drawn icons where an emoji or ad-hoc symbol stands in | 5 | iOS Lead via cloud agent PR | Thu 26 Nov (ships on the build after 12) | ~1.0% |
| 1b fix round | 1 | W&C | Fri 27 Nov | ~0.3% |
| 5e Web emoji to drawn icons (232 places: app.html, script.js, login.html, server.js) | 5 | W&C | Sat 28 Nov | ~0.7% |
| 5d fix round | 5 | iOS Lead | Sun 29 Nov | ~0.3% |
| 5e fix round | 5 | W&C | Mon 30 Nov | ~0.3% |

Totals (estimates):
- Item 1: ~1.2% (DL 0.2, W&C 0.8, iOS 0.2).
- Item 5: ~4.1% (DL 0.6, W&C 2.1, iOS 1.3).
- No single night goes over ~1%, so every night fits the 4% cap alongside fix runs.

Open points for Wilson:
- **1c on build 12:** riding build 12 matches Wilson's draft ("rides build 12"). The elite-bar file says the AppIcon misses build 12, so 1c needs Wilson's call before iOS Lead books Mon 23.
- **Pulled-forward brand PRs:** the approved mark removes the routes, pick and pack rows (Mon 23 to Fri 27 in the elite-bar file), so the brand PRs move earlier than Mon 30 and Tue 1.
- **Batch slots:** the W-B/W-C/i-B/i-C page batches in the elite-bar file shift behind 5c, 5d and 5e (item 5 is their foundation), so Wilson needs to rebook them.
- **Item 5 usage:** my item 5 figure is above Wilson's ~3.0% draft because of the 232 emoji swaps.

## Housekeeping
- Temp extracts (the repo copy, competitor icon downloads and scripts in /workspace/tmp-fm5g) are deleted.
- Only the 7 referenced renders are kept, about 0.7 MB in total. Nothing is over 1 GB.
- This run's usage: about 0.2% of the weekly limit (ESTIMATE). It ran on the box only, with ~40 tool calls, ~120 GitHub file reads and light cairosvg/PIL renders.
- No code was changed. Nothing was published. No company-suffix or tax wording is used.

## Appendix: every emoji in use (main @ b757b03), by file, glyph and line
- public/app.html 🏠 (U+1F3E0): line 626, 649, 2356, 2375
- public/app.html 🤖 (U+1F916): line 627, 650, 824, 943, 1164, 1238, 1252, 2357, 2376
- public/app.html 🍽️ (U+1F37D+FE0F): line 629, 725, 2358, 2377, 4117
- public/app.html 💪 (U+1F4AA): line 630, 730, 835, 864, 953, 1308, 1861, 1890, 2363, 2378, 2911, 3166, 5456
- public/app.html 📈 (U+1F4C8): line 631, 655, 740, 1247, 1351, 1397, 2364, 2383, 3634
- public/app.html 🥗 (U+1F957): line 633, 653, 710, 861, 1162, 1245, 2365, 3322, 3329, 3330, 4117
- public/app.html 🏋️ (U+1F3CB+FE0F): line 634, 654, 720, 934, 955, 1246, 2366, 2892, 3332, 3335, 3549
- public/app.html 🛒 (U+1F6D2): line 635, 657, 735, 903, 1040, 2367, 2384, 2780, 3068, 3325, 4580, 4884
- public/app.html 📸 (U+1F4F8): line 636, 658, 700, 1163, 1225, 1435, 1446, 2359, 2386
- public/app.html ❤️ (U+2764+FE0F): line 638, 659, 2368, 2385, 3128, 3133, 3388, 3548
- public/app.html 💳 (U+1F4B3): line 639, 2372
- public/app.html ⚡ (U+26A1): line 641, 2369
- public/app.html 👥 (U+1F465): line 642, 705, 2370, 2472
- public/app.html 📋 (U+1F4CB): line 643, 651, 715, 1166, 1472, 2371, 2382
- public/app.html 🔗 (U+1F517): line 754
- public/app.html 📨 (U+1F4E8): line 777
- public/app.html 🧠 (U+1F9E0): line 816, 1165, 1203
- public/app.html ⚖️ (U+2696+FE0F): line 836, 1862
- public/app.html 🏃 (U+1F3C3): line 837, 956, 1863
- public/app.html 🌾 (U+1F33E): line 862, 1317
- public/app.html 🥛 (U+1F95B): line 863
- public/app.html ⬇️ (U+2B07+FE0F): line 865, 1475
- public/app.html 🥜 (U+1F95C): line 866
- public/app.html 🥚 (U+1F95A): line 867
- public/app.html 🌱 (U+1F331): line 868
- public/app.html 🫘 (U+1FAD8): line 869
- public/app.html 🦐 (U+1F990): line 870
- public/app.html 🐟 (U+1F41F): line 871
- public/app.html ✨ (U+2728): line 882, 1002, 1683
- public/app.html 💾 (U+1F4BE): line 1023, 1059
- public/app.html 📅 (U+1F4C5): line 1215
- public/app.html 💬 (U+1F4AC): line 1244
- public/app.html 🧈 (U+1F9C8): line 1318
- public/app.html 📲 (U+1F4F2): line 1353, 1473, 3710
- public/app.html 📷 (U+1F4F7): line 1450, 1495
- public/app.html 🖼 (U+1F5BC): line 1451, 1496
- public/app.html ✕ (U+2715): line 1462, 1552, 1562, 1574, 1590, 1616, 1628, 1654, 1666, 1679, 1733, 1749, 1769, 1784, 1855, 1890, 2624, 2781, 2827, 2912, 2991, 3077
- public/app.html 🧾 (U+1F9FE): line 1491, 3827
- public/app.html 👋 (U+1F44B): line 1855, 2430
- public/app.html ✓ (U+2713): line 1909, 2592, 2606, 2695, 2813, 2881, 2931, 3006, 3022, 3028, 3057, 3565, 3651, 4062, 4903, 4966, 4977, 5195, 5494
- public/app.html ☰ (U+2630): line 2360, 2379
- public/app.html 🔒 (U+1F512): line 2398
- public/app.html 🚪 (U+1F6AA): line 2398
- public/app.html ⚠ (U+26A0): line 2706, 2718, 5510, 5510
- public/app.html ✅ (U+2705): line 3486, 3533, 4049, 5421
- public/app.html ⚠️ (U+26A0+FE0F): line 3915, 4540, 4544, 4885
- public/app.html 📥 (U+1F4E5): line 3999
- public/app.html ➕ (U+2795): line 4010
- public/app.html 🍳 (U+1F373): line 4117
- public/app.html 🍎 (U+1F34E): line 4117
- public/app.html 🎉 (U+1F389): line 4803
- public/app.html 🎯 (U+1F3AF): line 5407, 5422
- public/login.html ✓ (U+2713): line 893
- public/script.js 🥩 (U+1F969): line 980
- public/script.js 🥬 (U+1F96C): line 981
- public/script.js 🌾 (U+1F33E): line 982
- public/script.js 🥛 (U+1F95B): line 983
- public/script.js 🥜 (U+1F95C): line 984
- public/script.js 🛒 (U+1F6D2): line 985, 987
- public/script.js 🚀 (U+1F680): line 1863
- public/script.js ✅ (U+2705): line 1876, 1880, 1883, 1920
- public/script.js ❌ (U+274C): line 1885, 1937, 1953
- public/script.js ⚡ (U+26A1): line 1924
- public/script.js 🔄 (U+1F504): line 1930, 1948
- public/script.js 🎯 (U+1F3AF): line 2199
- server.js 🚀 (U+1F680): line 1623
- server.js ❌ (U+274C): line 1625

## Wilson's decisions (18 Nov 2026, late evening AEDT)
- 1c: the AppIcon and launch screen go on build 12. If build 12 is ready before 1c passes, build 12 ships without them and 1c moves to build 13.
- 1b scope now includes the live-site gaps: the /favicon.ico 404, the app_manifest.json colour (#4361ee) and its icons returning 404, and the header colour #07130d, which should be Forest #0F2A1F. No separate run.
- Nothing is booked yet. Ops Lead books the nights in the 6pm plan, and item 5 (~4.1%) may be spread out further because Drew said on 18 Nov at 8:42pm that usage is "too high across the board". Schedule nothing new until that plan lands. The Sat 21 box-only Wipper spec routine stays.
