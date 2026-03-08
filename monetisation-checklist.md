# FitMunch Monetisation Checklist

## TASK 1 — REVENUECAT CONFIGURATION

### ✅ Dashboard Setup
⬜ **1.1 Create RevenueCat Account**
   - Go to [RevenueCat.com](https://www.revenuecat.com) and sign up
   - Create new organization if needed

⬜ **1.2 Create New App in RevenueCat**
   - Click "Add App" in dashboard
   - App Name: `FitMunch`
   - Platform: `iOS`
   - Bundle ID: `com.fitmunch.ios` (must match App Store Connect)
   - ⚠️ **NOTE**: Current Xcode bundle ID is `com.example.FitMunch` - update in Xcode first!

⬜ **1.3 Copy API Key**
   - Navigate to Project Settings → API Keys
   - Copy the **Public SDK Key**
   - Update in `Constants.swift`: `static let revenueCatApiKey = "appl_xxx"`

⬜ **1.4 Configure Entitlement**
   - Go to Products → Entitlements
   - Create new entitlement: `premium`
   - Description: "Unlocks all premium features"

⬜ **1.5 Configure Offering**
   - Go to Products → Offerings
   - Create new offering: `main`
   - Add 3 subscription packages:
     1. **Weekly**: $4.99 AUD
     2. **Monthly**: $9.99 AUD  
     3. **Annual**: $79.99 AUD
   - Set annual as default (best value)

⬜ **1.6 Configure Pricing IDs**
   - For each package, set the App Store Connect Product ID:
     - Weekly: `com.fitmunch.ios.weekly`
     - Monthly: `com.fitmunch.ios.monthly`
     - Annual: `com.fitmunch.ios.annual`

⬜ **1.7 Add Test Users**
   - Go to Project Settings → Test Users
   - Add Drew's email for sandbox testing
   - Enable sandbox mode for testing

## TASK 2 — FREEMIUM GATE VERIFICATION

### ✅ Code Implementation Review
✅ **2.1 Free Tier Limits Enforced**
   - **Daily Meal Limit**: 3 meals/day (checked in `Constants.FreeTier.dailyMealLimit`)
   - **History Access**: 7 days only (checked in `Constants.FreeTier.historyDaysLimit`)
   - **Implementation**: `PremiumManager.hasExceededFreeTier()` and `isFeatureAvailableInFreeTier()`

✅ **2.2 Paywall Trigger Logic**
   - **Trigger 1**: After 4th meal attempt (checked in `HomeViewModel.canLogMeal`)
   - **Trigger 2**: When accessing premium features like full history (checked in `HistoryViewModel.loadMealsForDateRange()`)
   - **Implementation**: `showPaywall = true` when limits exceeded

✅ **2.3 Restore Purchases Working**
   - **Button**: Available in `PaywallView` and `SettingsView`
   - **Function**: Calls `PremiumManager.restorePurchases()`
   - **Feedback**: Shows success/failure alert to user

### ⚠️ Issues Found
- **History limit enforcement**: Code checks premium access but doesn't enforce 7-day limit in free tier
- **Export data**: Premium feature check exists but export functionality not fully implemented

## TASK 3 — PRIVACY MANIFEST

### ✅ PrivacyInfo.xcprivacy Review
✅ **3.1 Data Types Declared**
   - ✅ `NSPrivacyCollectedDataTypeName` - User's name
   - ✅ `NSPrivacyCollectedDataTypeEmailAddress` - User's email
   - ✅ `NSPrivacyCollectedDataTypeFitness` - Fitness goals and data
   - ✅ `NSPrivacyCollectedDataTypeHealth` - Health/nutrition data
   - ✅ All marked as `NSPrivacyCollectedDataTypePurposeAppFunctionality`

✅ **3.2 Tracking Disabled**
   - ✅ `NSPrivacyTracking = false`
   - ✅ `NSPrivacyTrackingDomains` empty array

✅ **3.3 API Access Declared**
   - ✅ `NSPrivacyAccessedAPICategoryUserDefaults` (reason CA92.1)
   - ✅ `NSPrivacyAccessedAPICategoryFileTimestamp` (reason C617.1)

### ✅ Info.plist HealthKit Permissions
✅ **3.4 HealthKit Usage Descriptions**
   - ✅ `NSHealthShareUsageDescription`: "FitMunch uses Health data to help you track your nutrition and fitness goals."
   - ✅ `NSHealthUpdateUsageDescription`: "FitMunch uses Health data to help you track your nutrition and fitness goals."

## TASK 4 — APP STORE CONNECT PREP

### ✅ App Store Connect Configuration
⬜ **4.1 Create New App**
   - Log in to [App Store Connect](https://appstoreconnect.apple.com)
   - Click "+" → "New App"
   - Platform: iOS
   - Name: `FitMunch` (≤30 chars)
   - Primary Language: English
   - Bundle ID: `com.fitmunch.ios` (must match Xcode - currently `com.example.FitMunch`)
   - SKU: `FITMUNCH2026`
   - User Access: Full Access

⬜ **4.2 Set Pricing**
   - Price: Free (with subscriptions)
   - Availability: All territories
   - Subscription pricing set in RevenueCat

⬜ **4.3 Create In-App Purchases**
   - Go to Features → In-App Purchases
   - Create 3 auto-renewable subscriptions:
     1. **Weekly Subscription**
        - Product ID: `com.fitmunch.ios.weekly`
        - Reference Name: `FitMunch Weekly`
        - Subscription Duration: 1 Week
        - Price: $4.99 AUD
     2. **Monthly Subscription**
        - Product ID: `com.fitmunch.ios.monthly`
        - Reference Name: `FitMunch Monthly`
        - Subscription Duration: 1 Month
        - Price: $9.99 AUD
     3. **Annual Subscription**
        - Product ID: `com.fitmunch.ios.annual`
        - Reference Name: `FitMunch Annual`
        - Subscription Duration: 1 Year
        - Price: $79.99 AUD

⬜ **4.4 Configure Subscription Group**
   - Create subscription group: `FitMunch Premium`
   - Add all 3 subscriptions to the group
   - Set annual as default (recommended)

⬜ **4.5 Submit for Review**
   - Fill in all required metadata
   - Upload screenshots (6.7" iPhone required)
   - Submit IAPs for review
   - Submit app for review

## STEP-BY-STEP GUIDE FOR DREW

### Phase 1: RevenueCat Setup (15 minutes)
1. **Sign up at RevenueCat.com** if not already done
2. **Create new app** in RevenueCat dashboard
   - Name: `FitMunch`
   - Platform: `iOS`
   - Bundle ID: `com.fitmunch.ios`
3. **Copy Public SDK Key** from Project Settings → API Keys
4. **Update `Constants.swift`** with the new API key
5. **Configure entitlement** `premium` and offering `main`
6. **Add test users** with your email for sandbox testing

### Phase 2: App Store Connect Setup (30 minutes)
1. **Update Xcode bundle ID** (if needed):
   - Open project in Xcode
   - Go to Target → General → Bundle Identifier
   - Change from `com.example.FitMunch` to `com.fitmunch.ios`
2. **Log in to App Store Connect**
3. **Create new app** with details:
   - Name: `FitMunch`
   - Bundle ID: `com.fitmunch.ios`
   - SKU: `FITMUNCH2026`
   - Price: Free
3. **Create In-App Purchases** (3 subscriptions):
   - Weekly: $4.99 AUD
   - Monthly: $9.99 AUD
   - Annual: $79.99 AUD
4. **Create subscription group** and add all 3

### Phase 3: Testing (1 hour)
1. **Build and run** app in Xcode with test flight
2. **Test free tier limits**:
   - Try to log 4th meal → should show paywall
   - Try to access full history → should show paywall
3. **Test purchases** with sandbox account
4. **Test restore purchases** functionality
5. **Verify privacy manifest** appears during installation

### Phase 4: Submission (30 minutes)
1. **Archive app** in Xcode
2. **Upload to App Store Connect** via Organizer
3. **Complete metadata** in App Store Connect
4. **Upload screenshots** (5 required for 6.7" iPhone)
5. **Submit for review**

## CRITICAL ISSUES TO FIX BEFORE SUBMISSION

1. **Bundle ID mismatch**: Xcode uses `com.example.FitMunch` but App Store Connect needs `com.fitmunch.ios`
   - Current: `PRODUCT_BUNDLE_IDENTIFIER = com.example.FitMunch`
   - Fix: Update in Xcode project settings to `com.fitmunch.ios`

2. **History limit bug**: Free tier should only show 7 days of history
   - Current: Checks premium access but doesn't limit date range
   - Fix: Modify `HistoryViewModel` to filter dates for free users

3. **Export feature incomplete**: Premium feature check exists but export not implemented
   - Current: Menu shows export button for premium users
   - Fix: Implement actual CSV/JSON export functionality

4. **RevenueCat API key**: Still placeholder `appl_xxx`
   - Must be replaced with actual Public SDK Key

5. **Subscription management**: "Manage Subscription" button in Settings doesn't work
   - Current: Opens generic App Store URL
   - Fix: Use RevenueCat's `Purchases.shared.showManageSubscriptions()` or proper deep link

## VERIFICATION SUMMARY

### ✅ Working Correctly
- PremiumManager with RevenueCat integration
- Free tier meal limit enforcement (3 meals/day)
- Paywall triggers on 4th meal attempt
- Restore purchases functionality
- Privacy manifest with all required data types
- HealthKit permissions properly declared
- Subscription UI with pricing cards

### ⚠️ Needs Attention
- History date range limit for free users
- Export data functionality implementation
- RevenueCat API key configuration
- Subscription management deep linking
- App Store Connect IAP creation

### 📋 Next Steps for Drew
1. Complete RevenueCat dashboard setup
2. Create App Store Connect app and IAPs
3. Fix the 2 critical issues (history limit, export)
4. Test thoroughly with sandbox purchases
5. Submit for App Store review

---

**Last Updated**: 2026-03-08  
**Phase**: 6 — Monetisation Complete  
**Status**: Ready for Drew's approval and implementation