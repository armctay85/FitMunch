#!/usr/bin/env node
/**
 * FitMunch Outreach Automation
 * Posts to FB groups + IG with one command
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const configPath = path.join(__dirname, '.ig-config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ Config not found. Run: node post-outreach.js setup');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const FACEBOOK_POSTS = [
  {
    groupId: config.facebook.groupIds.pt_business_au,
    groupName: 'PT Business AU',
    text: `Honest question for the PTs in here — how much are you actually paying for your client management software?

I was using TrueCoach at $99/mo and constantly dealing with:
- Slow loading times in Australian hours (US servers)
- Client cap paywalls every time I wanted to grow
- No GST-compliant invoice exports

Built a new platform specifically for AU trainers. Unlimited clients from $59/mo, AEST support, and GST sorted out of the box.

14-day free trial if anyone wants to test it: fitmunch.com.au

Not trying to sell you — genuinely curious if others have had the same experience.`
  },
  {
    groupId: config.facebook.groupIds.fitness_business_owners,
    groupName: 'Fitness Business Owners AUS',
    text: `For any PTs still using spreadsheets or cobbling together apps to manage clients — there's now an AU-built option worth looking at.

FitMunch: PT client management platform
✅ Unlimited clients ($59/mo Starter, $99/mo Pro)
✅ Workout + nutrition planning
✅ Client progress tracking + check-ins
✅ Australian pricing in AUD, GST-ready
✅ Servers in AU (no lag)
✅ 14-day free trial

Compared to TrueCoach (~$140 AUD/mo) and PT Distinction (no mobile app at all) — we're cheaper and actually built for how Aussie PTs work.

fitmunch.com.au`
  },
  {
    groupId: config.facebook.groupIds.personal_trainers_australia,
    groupName: 'Personal Trainers Australia',
    text: `Quick poll for PTs: What's your biggest frustration with your current client management software?

A) Too expensive / client cap paywalls
B) US-based = lag during my working hours
C) No proper GST/invoicing for AU
D) The mobile app is garbage
E) I just use WhatsApp and spreadsheets tbh

Asking because we're building something specifically for AU PTs and want to make sure we're solving the right problems. Happy to share what we've built if anyone's interested 🙋`
  }
];

/**
 * Post to Facebook Group
 */
function postToFB(groupId, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message });
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/${groupId}/feed?access_token=${config.instagram.accessToken}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          resolve(resp);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Main execution
 */
async function execute() {
  console.log('🦞 Starting FitMunch Outreach Posts...\n');

  // Validate config
  if (!config.instagram.businessAccountId.includes('ENTER')) {
    console.log('✅ IG Account ID set');
  } else {
    console.warn('⚠️  IG Account ID not configured (optional for now)\n');
  }

  let posted = 0;
  let failed = 0;

  for (const fbPost of FACEBOOK_POSTS) {
    if (fbPost.groupId.includes('ENTER')) {
      console.log(`⏭️  SKIPPING "${fbPost.groupName}" — group ID not set`);
      continue;
    }

    try {
      const result = await postToFB(fbPost.groupId, fbPost.text);
      if (result.id) {
        console.log(`✅ Posted to ${fbPost.groupName} (ID: ${result.id})`);
        posted++;
      } else if (result.error) {
        console.error(`❌ ${fbPost.groupName}: ${result.error.message}`);
        failed++;
      }
    } catch (err) {
      console.error(`❌ ${fbPost.groupName}: ${err.message}`);
      failed++;
    }

    // Rate limiting: wait 2s between posts
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n📊 Results: ${posted} posted, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

// CLI
const cmd = process.argv[2];
if (cmd === 'setup') {
  console.log('Config template created at: .ig-config.json');
  console.log('\nTo get your IDs:');
  console.log('1. IG Business Account ID: Instagram Settings → Account → Account ID');
  console.log('2. FB Group IDs: Right-click group → copy URL, ID is the number\n');
  console.log('Then run: node post-outreach.js post');
} else if (cmd === 'post' || !cmd) {
  execute();
} else {
  console.log('Usage: node post-outreach.js [setup|post]');
  process.exit(1);
}
