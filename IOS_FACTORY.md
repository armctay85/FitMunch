# FitMunch iOS Factory — Canonical Runbook

Last verified: **2026-07-02** (both workflows run green on demand — evidence below).
Read this before touching the iOS lane. It replaces all older iOS docs/claims.

## What the factory is

There is no local Mac. The entire iOS build/sign/ship pipeline runs on **GitHub
Actions macOS runners**:

| Lane | Workflow | Trigger | Proven |
|---|---|---|---|
| Build + simulator test | `.github/workflows/ios-build.yml` | push/PR touching `FitMunch/**` or `project.yml`, or manual dispatch | ✅ run 28561779562 (2026-07-02, 1m21s) |
| Signed archive → IPA → ASC upload | `.github/workflows/ios-archive.yml` | manual dispatch, or push to `deploy` branch | ✅ run 28561869447 (2026-07-02, 1m22s — archive/export/sign all green, ASC upload deliberately skipped) |

The 2026-07-02 fix that revived it: the Xcode project depends on
`RevenueCat.xcframework` at repo root which is **not vendored** — both workflows
now download it (v5.14.4) before building. That missing download was why every
build failed for months.

## Signing state (all in GitHub repo secrets, set 2026-03-19)

`CERTIFICATES_P12`, `CERTIFICATES_PASSWORD`, `KEYCHAIN_PASSWORD`,
`PROVISIONING_PROFILE`, `PROVISIONING_PROFILE_NAME`, `ASC_USERNAME`, `ASC_PASSWORD`.
Team `48SW62N9BZ`, bundle `com.fitmunch.ios`, manual signing.
**Certificates proven still valid 2026-07-02** (archive lane signed successfully).
Distribution certs expire ~1 year from issue — expect renewal ~March 2027.

## THE ONE BLOCKER (human step, ~5 minutes)

Historical ASC uploads (2026-03-29) failed with: *Apple could not find a suitable
app record for bundle `com.fitmunch.ios`*.

**Drew must create the app record once** (agents cannot without an ASC API key):
1. https://appstoreconnect.apple.com → My Apps → **+** → New App
2. Platform iOS, Name **FitMunch**, Language en-AU, Bundle ID `com.fitmunch.ios`
   (if the bundle ID isn't offered, first register it at
   https://developer.apple.com/account/resources/identifiers → Identifiers → + → App ID)
3. SKU: `fitmunch-ios`

Then ship to TestFlight with one command (or Actions UI → iOS Archive & Upload → Run):

```
gh workflow run "iOS Archive & Upload" --repo armctay85/FitMunch -f upload_to_asc=true
```

Optional but recommended: give agents an **App Store Connect API key**
(Users & Access → Integrations → App Store Connect API → Team key, App Manager role)
so they can automate metadata/TestFlight/review via the `appledev`/`app-store-connect`
skills. Store as repo secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`.

## Honest product state of the Swift app

~3,300 lines of complete SwiftUI: Onboarding, Home (meal logging), History, Detail,
Settings, Paywall. RevenueCat wired (key in Info.plist, `premium` entitlement,
`main` offering), free tier limits (3 meals/day, 7-day history), HealthKit usage
strings, privacy manifest (`PrivacyInfo.xcprivacy`).

**It is a standalone local meal tracker. It does NOT talk to the FitMunch backend** —
no login, no AI coach, no receipt scanner, no sync with fitmunch.com.au accounts.

### Ship strategy
- **v1.0 (now)**: ship the standalone tracker to TestFlight → App Store. It's a real,
  reviewable app and it claims the store presence + starts RevenueCat revenue.
  Before submission: replace `idYOUR_APP_ID` placeholder in `SettingsView.swift`
  (review link) with the real App Store ID once the record exists.
- **v1.1 (product parity)**: wire the app to the live API (`/api/auth/*`, `/api/ai/*`,
  `/api/receipt/scan`, `/api/meals/*`) so iOS gets the AI coach + receipt scanner —
  that's when iOS becomes the real FitMunch. The backend is already live and verified.

### RevenueCat prerequisites for the paywall to actually sell
1. ASC app record exists (blocker above)
2. Create IAP subscription products in ASC (e.g. `fm_premium_monthly` A$19.99,
   14-day free trial) — needs Paid Apps agreement signed in ASC
3. In RevenueCat dashboard: attach products to entitlement `premium`, offering `main`
4. The app then sells without code changes

## Rules for agents
- Never claim the iOS lane is broken/blocked without running the two workflows above.
- Never re-add iOS builds to every push — path filters exist so web work stays quiet.
- Log evidence (run IDs) in the proof ledger when you touch this lane.
