'use strict';
/**
 * Jest keeps one Node process for --runInBand. Each file that loads storage,
 * the API, or a migrate helper builds a pg.Pool (storage uses max 20) and
 * nothing used to call pool.end(). Idle clients stay up for 30s, so a run
 * that opens several of those pools hits Postgres "sorry, too many clients".
 * Close only pools this file already created.
 */
function loaded(suffix) {
  return Object.keys(require.cache || {}).some((k) => k.replace(/\\/g, '/').endsWith(suffix));
}

async function endNamed(suffix, requestPath, name) {
  if (!loaded(suffix)) return;
  let mod;
  try { mod = require(requestPath); } catch (_) { return; }
  const fn = mod && mod[name];
  if (typeof fn !== 'function') return;
  try { await fn(); } catch (_) { /* already closed */ }
}

async function endAppPools() {
  await endNamed('/server/storage.js', '../server/storage.js', 'endPoolForTests');
  await endNamed('/lib/db-migrate.js', '../lib/db-migrate', 'endPoolForTests');
  await endNamed('/lib/ai-usage.js', '../lib/ai-usage', 'endPoolForTests');
  await endNamed('/lib/coach-store.js', '../lib/coach-store', 'endPoolForTests');
  await endNamed('/api_server.js', '../api_server', '_endDbForTests');
}

module.exports = { endAppPools };
