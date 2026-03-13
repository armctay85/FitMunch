# FitMunch Outreach Setup — 5 Minutes

## Step 1: Get Your Facebook Group IDs

For each Facebook group, right-click the group name in your browser and select **"Copy link"**:

### Group 1: PT Business AU
```
Link: https://www.facebook.com/groups/XXXXXXXXXXXXX/
ID: XXXXXXXXXXXXX (the number)
```

### Group 2: Fitness Business Owners AUS
```
Link: https://www.facebook.com/groups/XXXXXXXXXXXXX/
ID: XXXXXXXXXXXXX (the number)
```

### Group 3: Personal Trainers Australia
```
Link: https://www.facebook.com/groups/XXXXXXXXXXXXX/
ID: XXXXXXXXXXXXX (the number)
```

## Step 2: Update Config File

Edit `.ig-config.json` and paste the group IDs:

```json
{
  "facebook": {
    "groupIds": {
      "pt_business_au": "123456789",
      "fitness_business_owners": "987654321",
      "personal_trainers_australia": "456789123"
    }
  }
}
```

## Step 3: Execute Posts

```bash
cd ~/fitmunch
node post-outreach.js post
```

**That's it.** The script posts all 3 FB group messages automatically with rate limiting between each.

---

## What Gets Posted

✅ **Post 1 (PT Business AU):** Pain-led — "TrueCoach is expensive and slow..."
✅ **Post 2 (Fitness Business Owners):** Value-led — features + pricing
✅ **Post 3 (Personal Trainers Australia):** Poll — engagement hook

---

## Expected Output

```
✅ Posted to PT Business AU (ID: 1234567890)
✅ Posted to Fitness Business Owners AUS (ID: 2345678901)
✅ Posted to Personal Trainers Australia (ID: 3456789012)

📊 Results: 3 posted, 0 failed
```

---

## If Posts Fail

Check:
1. Group IDs are correct (9+ digit numbers)
2. You're an admin/mod in those groups
3. Access token is valid (should be fresh from Meta)

Need help? Run: `node post-outreach.js setup`
