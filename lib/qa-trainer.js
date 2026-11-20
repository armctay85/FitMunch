'use strict';

/**
 * QA trainer allowlist. Empty by default.
 * Same parsing as SMOKE_ACCOUNT_IDS: comma separated, trimmed, exact id match.
 * No wildcard, no prefix, no email match.
 */
function qaTrainerAccountIds(env = process.env) {
  return String((env && env.QA_TRAINER_ACCOUNT_IDS) || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function isQaTrainerAccount(userId, env = process.env) {
  if (userId === undefined || userId === null) return false;
  const id = String(userId).trim();
  return !!id && qaTrainerAccountIds(env).includes(id);
}

module.exports = { qaTrainerAccountIds, isQaTrainerAccount };
