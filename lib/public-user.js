'use strict';

/**
 * Allowlist serializers for user and profile rows sent in API responses.
 * Never spread a users row into a response: it carries password_hash,
 * stripe_customer_id and the settings JSON. Add a field here only if a
 * client reads it.
 */

const PUBLIC_USER_FIELDS = ['id', 'name', 'email', 'emailVerified', 'createdAt'];

const PUBLIC_PROFILE_FIELDS = [
  'id', 'userId', 'height', 'weight', 'age', 'gender', 'activityLevel', 'fitnessGoal',
  'dietaryPreferences', 'allergies', 'targetCalories', 'targetSteps', 'targetProtein',
  'targetCarbs', 'targetFat', 'updatedAt',
];

function pick(row, fields) {
  const out = {};
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
  return out;
}

// extra: computed values the caller is allowed to add (e.g. subscriptionTier from effectiveTier).
function publicUser(user, extra) {
  if (!user || typeof user !== 'object') return null;
  const out = pick(user, PUBLIC_USER_FIELDS);
  if ('emailVerified' in out) out.emailVerified = out.emailVerified === true;
  if (extra && typeof extra === 'object') Object.assign(out, extra);
  return out;
}

function publicProfile(profile) {
  if (!profile || typeof profile !== 'object') return profile == null ? null : profile;
  return pick(profile, PUBLIC_PROFILE_FIELDS);
}

module.exports = { publicUser, publicProfile, PUBLIC_USER_FIELDS, PUBLIC_PROFILE_FIELDS };
