
# FitMunch Android Testing Instructions

## Getting Started

### 1. Clone the Repository
Clone this repository to your local machine to get all the necessary files for testing.

### 2. Required Tools
- Android Studio (latest version recommended)
- Java Development Kit (JDK) 11 or higher
- Node.js 14 or higher
- Capacitor CLI (`npm install -g @capacitor/cli`)

### 3. Key Files for Testing
- `capacitor.config.json` - Main Capacitor configuration
- `android/` directory - Android project files
- `google_play_submission_checklist.md` - Checklist for Google Play submission
- `generate_prelaunch_report.js` - Script to generate a pre-launch report
- `google_play_content_rating.txt` - Content rating information

## Building and Testing

### Building the App
1. Install dependencies:
   ```
   npm install
   ```

2. Build the Android project:
   ```
   node build_android.js
   ```

3. Open in Android Studio:
   ```
   npx cap open android
   ```

4. Build the APK for testing:
   - In Android Studio, select `Build > Build Bundle(s) / APK(s) > Build APK(s)`
   - For release testing, select `Build > Generate Signed Bundle / APK`

### Critical Issues to Verify
1. **Subscription Manager** - Test that subscriptions initialize correctly:
   - Verify each subscription plan (Free, Basic, Premium, Pro Coach)
   - Test upgrade/downgrade flows
   - Ensure receipt validation works

2. **UI Issues** - Test responsive design on various screen sizes:
   - Focus on Workout Tracking screens
   - Test on small, medium, and large devices
   - Verify layout doesn't break

3. **Content Rating** - Verify content rating survey is completed:
   - Check `google_play_content_rating.txt` for accuracy
   - Ensure all questions are answered appropriately

4. **Receipt Validation** - Test server implementation:
   - Verify purchase receipts are validated properly
   - Test both valid and invalid purchase scenarios

5. **Security** - Implement and test session timeout:
   - Verify timeout functionality works as expected
   - Test authentication flow

## Testing Checklist

### Functional Testing
- [ ] Core features work as expected (meal planning, workout tracking, etc.)
- [ ] User account creation and login
- [ ] Google Fit integration
- [ ] Push notifications
- [ ] Deep linking
- [ ] In-app purchases and subscriptions

### Device Testing
- [ ] Test on Android 8.0 (Oreo)
- [ ] Test on Android 10 (Q)
- [ ] Test on Android 12 (S)
- [ ] Test on Android 14
- [ ] Test on multiple manufacturers (Samsung, Pixel, etc.)
- [ ] Test on various screen sizes

### Performance Testing
- [ ] App startup time is reasonable
- [ ] UI animations are smooth
- [ ] Load times for different sections are acceptable
- [ ] Memory usage is optimized
- [ ] Battery consumption is acceptable

### Google Play Requirements
- [ ] App icons meet requirements
- [ ] Feature graphic (1024x500px) is prepared
- [ ] Screenshots for various devices are ready
- [ ] App description is complete
- [ ] Privacy policy is linked
- [ ] Content rating survey is completed

## Reporting Issues
For each issue found, please include:
1. Device make and model
2. Android version
3. Steps to reproduce
4. Expected behavior
5. Actual behavior
6. Screenshots or video if applicable

## Deliverables
1. Comprehensive testing report
2. List of fixed issues with verification
3. Google Play Store-ready APK/AAB
4. Complete set of store listing assets
5. Documentation of any remaining issues
