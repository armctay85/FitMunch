# GitHub Secrets Setup Guide for FitMunch

## Required Secrets for Archive Workflow

To run the archive workflow (`.github/workflows/ios-archive.yml`), you need to set these GitHub Secrets in your repository:

### 1. **CERTIFICATES_P12** (Base64-encoded .p12 file)
**How to get it:**
1. Open Keychain Access on macOS
2. Find your Apple Distribution certificate
3. Export as `.p12` file (with password)
4. Convert to base64:
   ```bash
   base64 -i certificate.p12 -o p12_base64.txt
   ```
5. Copy contents of `p12_base64.txt`

**Secret Value:** Base64 string of .p12 file

### 2. **CERTIFICATE_PASSWORD** (Password for .p12 file)
**Value:** The password you set when exporting the .p12

### 3. **ASC_USERNAME** (App Store Connect Username)
**Value:** Your Apple ID email (e.g., `drew@example.com`)

### 4. **ASC_APP_SPECIFIC_PASSWORD** (App-Specific Password)
**How to create:**
1. Go to https://appleid.apple.com
2. Sign in with your Apple ID
3. Under Security → App-Specific Passwords
4. Generate new password for "GitHub Actions"
5. Copy the 16-character password

**Value:** 16-character app-specific password

### 5. **ASC_ISSUER_ID** (App Store Connect Issuer ID)
**Value:** `5e0496e7-e4ec-4467-a06a-210c64365371`

### 6. **ASC_KEY_ID** (App Store Connect Key ID)
**Value:** `548GZGCWZ9`

### 7. **ASC_PRIVATE_KEY** (Base64-encoded .p8 file)
**How to get it:**
1. The .p8 file is already at:
   `C:\Users\Drew\.openclaw\media\inbound\AuthKey_548GZGCWZ9---83cc6f87-2a9e-4428-8c60-5c875f005a9a`
2. Convert to base64:
   ```bash
   base64 -i AuthKey_548GZGCWZ9.p8 -o p8_base64.txt
   ```
3. Copy contents of `p8_base64.txt`

**Value:** Base64 string of .p8 private key

## How to Set GitHub Secrets

### Via GitHub Web Interface:
1. Go to your repository: `https://github.com/armctay85/FitMunch`
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret with the exact names above

### Via GitHub CLI:
```bash
gh secret set CERTIFICATES_P12 --body "$(cat p12_base64.txt)"
gh secret set CERTIFICATE_PASSWORD --body "your_password"
gh secret set ASC_USERNAME --body "your_apple_id@email.com"
gh secret set ASC_APP_SPECIFIC_PASSWORD --body "xxxx-xxxx-xxxx-xxxx"
gh secret set ASC_ISSUER_ID --body "5e0496e7-e4ec-4467-a06a-210c64365371"
gh secret set ASC_KEY_ID --body "548GZGCWZ9"
gh secret set ASC_PRIVATE_KEY --body "$(cat p8_base64.txt)"
```

## Testing the Setup

### 1. First, test the build workflow:
- Push any commit to trigger the `ios-build.yml` workflow
- Verify it passes on GitHub Actions

### 2. Then run the archive workflow:
1. Go to **Actions** tab
2. Select **iOS Archive** workflow
3. Click **Run workflow**
4. Select branch: `main`
5. Click **Run workflow**

### Expected Output:
- ✅ Build archives successfully
- ✅ IPA exported
- ✅ Uploaded to App Store Connect
- ✅ Build appears in ASC for FitMunch app

## Troubleshooting

### Common Issues:

1. **Certificate errors:**
   - Ensure .p12 is Apple Distribution (not Development)
   - Check certificate hasn't expired
   - Verify password is correct

2. **ASC authentication errors:**
   - Verify app-specific password is valid
   - Check Apple ID has proper permissions
   - Ensure .p8 key is correct and not expired

3. **Build errors:**
   - Check bundle ID matches ASC (`com.fitmunch.ios`)
   - Verify Xcode project builds locally first
   - Check for missing dependencies

## Next Steps After Secrets Setup

1. **Run archive workflow** to upload first build
2. **Create app icon** using DALL-E prompt in `app-icon-prompt.md`
3. **Generate screenshots** following `screenshot-specs.md`
4. **Upload assets** to App Store Connect
5. **Submit for review**

## Security Notes

- Never commit secrets to git
- Use GitHub Secrets for all sensitive data
- Rotate app-specific passwords periodically
- Monitor GitHub Actions logs for security issues
- Revoke certificates if compromised