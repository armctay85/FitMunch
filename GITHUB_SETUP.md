# GitHub Setup Instructions

The FitMunch project has been created locally. To push to GitHub:

## 1. Create a GitHub Repository

1. Go to https://github.com/new
2. Create a new private repository named "FitMunch"
3. Do NOT initialize with README, .gitignore, or license

## 2. Update Git Remote

Run the following commands in the FitMunch directory:

```bash
cd ~/TonyApps/FitMunch
git remote remove origin
git remote add origin git@github.com:[YOUR_USERNAME]/FitMunch.git
```

Replace `[YOUR_USERNAME]` with your actual GitHub username.

## 3. Push to GitHub

```bash
git branch -M main
git push -u origin main
```

## 4. Configure GitHub Actions Secrets (Optional)

If you want to use GitHub Actions for CI/CD, configure these secrets in your repository settings:

1. Go to Repository Settings → Secrets and variables → Actions
2. Add the following secrets:
   - `REVENUECAT_API_KEY`: Your RevenueCat API key
   - `APPLE_CERTIFICATES`: Apple distribution certificate (for App Store builds)

## 5. Verify Setup

Check that the repository is properly set up:

```bash
git remote -v
git log --oneline -3
```

## Notes

- The project uses Swift 5.9+ and requires Xcode 15.0+
- RevenueCat API key needs to be updated in `FitMunch/Utilities/Constants.swift`
- App icons and assets need to be added to `Resources/Assets.xcassets`