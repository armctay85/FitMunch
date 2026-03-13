#!/usr/bin/env node
/**
 * Instagram & Facebook Poster for FitMunch
 * Posts content to IG business account + FB groups
 */

const https = require('https');

const IG_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_BUSINESS_ACCOUNT_ID = process.env.IG_BUSINESS_ACCOUNT_ID || ''; // set via env

if (!IG_TOKEN) {
  console.error('Error: INSTAGRAM_ACCESS_TOKEN not set');
  process.exit(1);
}

/**
 * Post to Instagram Business Account
 * Requires: image URL, caption
 */
async function postToIG(imageUrl, caption) {
  return new Promise((resolve, reject) => {
    // First, create a media object
    const mediaBody = JSON.stringify({
      image_url: imageUrl,
      caption: caption,
    });

    const mediaReq = https.request({
      hostname: 'graph.instagram.com',
      path: `/${IG_BUSINESS_ACCOUNT_ID}/media?access_token=${IG_TOKEN}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(mediaBody) }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          if (resp.error) {
            reject(new Error(`IG API error: ${resp.error.message}`));
          } else {
            // Publish the media
            const mediaId = resp.id;
            const pubReq = https.request({
              hostname: 'graph.instagram.com',
              path: `/${mediaId}/publish?access_token=${IG_TOKEN}`,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            }, pubRes => {
              let pubData = '';
              pubRes.on('data', d => pubData += d);
              pubRes.on('end', () => {
                const pubResp = JSON.parse(pubData);
                resolve(pubResp);
              });
            });
            pubReq.on('error', reject);
            pubReq.write('{}');
            pubReq.end();
          }
        } catch(e) { reject(e); }
      });
    });
    mediaReq.on('error', reject);
    mediaReq.write(mediaBody);
    mediaReq.end();
  });
}

/**
 * Post to Facebook Group
 * Requires: groupId, message
 */
async function postToFBGroup(groupId, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message });
    const req = https.request({
      hostname: 'graph.facebook.com',
      path: `/${groupId}/feed?access_token=${IG_TOKEN}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const resp = JSON.parse(data);
          if (resp.error) {
            reject(new Error(`FB API error: ${resp.error.message}`));
          } else {
            resolve(resp);
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Export for use
module.exports = { postToIG, postToFBGroup };

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === 'ig' && args[1] && args[2]) {
    postToIG(args[1], args[2])
      .then(r => console.log('✅ Posted to IG:', JSON.stringify(r)))
      .catch(e => console.error('❌ IG Error:', e.message));
  } else if (args[0] === 'fb' && args[1] && args[2]) {
    postToFBGroup(args[1], args[2])
      .then(r => console.log('✅ Posted to FB group:', JSON.stringify(r)))
      .catch(e => console.error('❌ FB Error:', e.message));
  } else {
    console.log('Usage:');
    console.log('  node ig-poster.js ig <image_url> "<caption>"');
    console.log('  node ig-poster.js fb <group_id> "<message>"');
    process.exit(1);
  }
}
