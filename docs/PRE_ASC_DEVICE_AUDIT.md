# Pre-ASC Device Audit (FitMunch iOS)

Hard gate. Do not submit App Review until every item below is proven.
CI-green is not enough. Build 6 (2026-09-01) and ITMS-90683 on build 7 were CI-green rejects.

This document is the repo checklist for `state/asc-rejection-2026-09-01.md` and `state/asc-rejection-2026-08-05.md`.
It does not upload a binary and it does not submit for review.

## Never submit without proof

1. Automated gates in this repo are green (camera usage, IAP product IDs, archive plist).
2. A human or device farm has walked the three App Review crash classes on **iPhone and iPad**.
3. Subscription plans are visible from the App Store sandbox (or the recoverable empty state is shown, never a silent blank).
4. The next archive build number is new. Do not re-upload a duplicate `CFBundleVersion`.

Archive/upload (`deploy` / workflow_dispatch) is not App Review. Do not click Submit for Review from a CI-only pass.

## Rejection classes this audit covers

| Guideline | What Apple did | Device | Required proof |
|---|---|---|---|
| 2.1(a) | Settings → Upgrade crashed | iPhone (also iPad) | Paywall opens. App stays up. No `Purchases.shared` before configure. |
| 2.1(a) | Scan → Take a photo crashed | iPad Air 11-inch (M3) | Camera opens or library fallback alert. Never `UIImagePickerController` for camera. |
| 2.1(b) | Premium plans did not load from the App Store | iPad | Monthly and annual cards, or "Couldn't load App Store plans" + Retry. Never a blank page. |
| ITMS-90683 | Processed Info.plist omitted `NSCameraUsageDescription` | Transporter | Archived `.app` Info.plist has a non-empty camera string. |

## Product IDs (do not invent new ones)

Source of truth in repo: `FitMunch/Utilities/Constants.swift`, `asc-setup.js`, `asc-update.js`.

| Product ID | Role | Paywall |
|---|---|---|
| `fitmunch_monthly` | Monthly Premium | Sellable |
| `fitmunch_annual` | Annual Premium | Sellable |
| `fitmunch_weekly` | Weekly Premium | Skip when StoreKit title is empty (`MISSING_METADATA`) |
| `fitmunch_lifetime` | Lifetime (ASC only) | Not sold on this paywall |

Entitlement: `premium`. Offering: `main`, then StoreKit product IDs, then StoreKit 2.

## Automated gates (must stay in CI)

Run from repo root. These fail the PR if they regress.

```bash
bash scripts/check-ios-camera-usage.sh
npx jest --runInBand test_pre_asc_gate.js test_pay_path.js test_ios_store_art.js
```

| Gate | Where | What it proves |
|---|---|---|
| `scripts/check-ios-camera-usage.sh` | Web quality + iOS build + iOS archive (before archive) | Camera APIs exist ⇒ `NSCameraUsageDescription` is in `Info.plist` and `project.yml` (`info.properties` and `INFOPLIST_KEY_*`). Photo library APIs ⇒ `NSPhotoLibraryUsageDescription`. No `UIImagePickerController` camera presentation. |
| `FitMunchTests/CameraUsagePlistTests` | Xcode unit tests | Host app bundle still has the camera string after processing (ITMS-90683 class). |
| `FitMunchTests/PaywallCatalogTests` | Xcode unit tests | Monthly/annual IDs stay sellable. Weekly missing metadata cannot empty the catalog. |
| Archive job processed-plist check | `.github/workflows/ios-archive.yml` | Refuses to export if the `.app` Info.plist camera string is missing. |
| Archive job | same workflow | Uploads to App Store Connect only. Must not call Submit for Review. |

`ios-build.yml` compiling is not this audit. A green simulator build does not prove iPad camera or sandbox IAP.

## Device matrix (manual, both required)

App Review runs iPhone-only binaries on iPad in compatibility mode. Test that mode.

### iPhone (physical or recent simulator)

- [ ] Cold launch, sign in or ReviewGuards path, tab bar visible
- [ ] Settings → Upgrade (and Upgrade to Premium) opens the paywall
- [ ] Paywall shows Monthly / Annual from the App Store, or the retry empty state
- [ ] Pull to refresh on the paywall reloads plans
- [ ] Scan → Take a photo: permission prompt uses the receipt-scanning string
- [ ] Scan → Take a photo: capture or a recoverable "Camera not available" / library path
- [ ] Scan → Choose from library still works
- [ ] Close paywall. App still running. No freeze.

### iPad (physical Air / recent iPad, compatibility mode)

- [ ] Settings is reachable (More tab if needed)
- [ ] Settings → Upgrade opens the paywall (full-screen, tappable row)
- [ ] Scan → Take a photo does **not** crash
- [ ] Denied / missing camera shows the library fallback, not a black screen
- [ ] Subscription page is not blank

## Runtime paths the code must keep

### Upgrade (2.1a)

- Settings Upgrade is a full-width `List` row with `.contentShape(Rectangle())`.
- Present `PaywallView` as `fullScreenCover`, not a sheet.
- `PremiumManager` never reads `Purchases.shared` unless `Purchases.isConfigured`.
- Paywall renders `PaywallPlan` values only. No force unwrap of RevenueCat packages.

### Scan / camera (2.1a + ITMS-90683)

- `SafeCameraPicker` is an `AVCaptureSession` view controller, full screen.
- Hardware check uses `AVCaptureDevice.DiscoverySession`, not a system image picker.
- Permission string lives in **both** `FitMunch/Resources/Info.plist` and `project.yml`.
- If hardware, permission, or session fails: alert + Choose from library.
- Do not reintroduce `UIImagePickerController` as the camera cover.

### Subscription load (2.1b)

Load order:

1. RevenueCat `offerings.current`
2. RevenueCat offering `main`
3. RevenueCat products `fitmunch_monthly`, `fitmunch_annual`
4. StoreKit 2 `Product.products(for:)` for the same IDs

If all four miss: show `Couldn't load App Store plans`, Retry, Continue on the web.
Never the old copy `Premium plans did not load from the App Store.`

## Archive and review split

| Action | Allowed from CI? |
|---|---|
| Build / unit / camera-usage script | Yes |
| Archive IPA | Yes, new build number |
| Upload to App Store Connect | Yes, after archive gates |
| Submit for App Review | **No** until this checklist is ticked on iPhone and iPad |

## Out of scope

- Stripe / website / web `$19.99` checkout
- Inventing new IAP product IDs
- Merging this work as "ready for Review" without device proof
