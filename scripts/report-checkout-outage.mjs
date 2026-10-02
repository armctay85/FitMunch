#!/usr/bin/env node
/**
 * Read-only checkout outage report, 29 Sep 2026 through 3 Oct 2026
 * (Australia/Sydney calendar days).
 *
 * Lists Stripe Checkout Sessions (complete, expired, open) with amount and
 * product, customers created in that window, per day, and login 500s when a
 * log source is reachable. Writes CSV to stdout. Does not create, update, or
 * delete anything in Stripe.
 *
 *   STRIPE_READONLY_KEY=rk_live_... node scripts/report-checkout-outage.mjs > checkout-outage.csv
 *
 * STRIPE_READONLY_KEY is preferred (an rk_ key with Checkout Session read and
 * Customer read). STRIPE_SECRET_KEY is used only when the read-only key is
 * unset, and only for list/retrieve calls. A missing key prints these
 * instructions and exits 1.
 *
 * Login 500s: set FITMUNCH_LOG_FILE to a log export, or VERCEL_TOKEN plus
 * VERCEL_PROJECT_ID. If neither works, the CSV says login_500,unreachable.
 */

import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const WINDOW_START = '2026-09-29';
const WINDOW_END = '2026-10-03';
const TIME_ZONE = 'Australia/Sydney';
const START_UNIX = Date.parse('2026-09-29T00:00:00+10:00') / 1000;
const END_UNIX = Date.parse('2026-10-04T00:00:00+10:00') / 1000;

const DAYS = [];
{
  const cursor = new Date(Date.parse('2026-09-29T00:00:00+10:00'));
  const end = new Date(Date.parse('2026-10-04T00:00:00+10:00'));
  while (cursor < end) {
    DAYS.push(sydneyDay(cursor.getTime() / 1000));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}

function sydneyDay(unixSeconds) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(fields) {
  return fields.map(csvCell).join(',');
}

function keySource() {
  const readonly = String(process.env.STRIPE_READONLY_KEY || '').trim();
  const secret = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (readonly) return { key: readonly, source: 'STRIPE_READONLY_KEY' };
  if (secret) return { key: secret, source: 'STRIPE_SECRET_KEY' };
  return null;
}

function assertListKey(key) {
  if (/^(sk|rk)_(test|live)_/.test(key)) return;
  console.error('The Stripe key must be an sk_ or rk_ key. Nothing was called.');
  process.exit(1);
}

function productOf(session) {
  const meta = session.metadata || {};
  return meta.plan || meta.product || meta.merchant || '';
}

function priceIdOf(session) {
  const meta = session.metadata || {};
  if (meta.priceId) return meta.priceId;
  const line = session.line_items && session.line_items.data && session.line_items.data[0];
  const price = line && line.price;
  return (price && price.id) || '';
}

async function listAll(iterator) {
  const rows = [];
  for await (const row of iterator) rows.push(row);
  return rows;
}

async function priceAmounts(stripe, sessions) {
  const ids = [...new Set(sessions.map(priceIdOf).filter(Boolean))];
  const amounts = new Map();
  for (const id of ids) {
    try {
      const price = await stripe.prices.retrieve(id);
      amounts.set(id, price.unit_amount == null ? '' : price.unit_amount);
    } catch (err) {
      console.error(`price ${id} was not retrieved: ${err.message}`);
      amounts.set(id, '');
    }
  }
  return amounts;
}

async function login500s() {
  const file = String(process.env.FITMUNCH_LOG_FILE || '').trim();
  if (file) {
    if (!fs.existsSync(file)) {
      return { reachable: false, source: 'FITMUNCH_LOG_FILE', count: '', note: `missing ${file}` };
    }
    const text = fs.readFileSync(file, 'utf8');
    const count = text.split(/\n/).filter((line) => /login/i.test(line) && /\b500\b/.test(line)).length;
    return { reachable: true, source: 'FITMUNCH_LOG_FILE', count, note: file };
  }
  const token = String(process.env.VERCEL_TOKEN || '').trim();
  const projectId = String(process.env.VERCEL_PROJECT_ID || '').trim();
  if (!token || !projectId) {
    return {
      reachable: false,
      source: '',
      count: '',
      note: 'no FITMUNCH_LOG_FILE and no VERCEL_TOKEN plus VERCEL_PROJECT_ID',
    };
  }
  const team = String(process.env.VERCEL_TEAM_ID || '').trim();
  const url = new URL(`https://api.vercel.com/v1/projects/${projectId}/logs`);
  url.searchParams.set('since', String(Math.floor(START_UNIX * 1000)));
  url.searchParams.set('until', String(Math.floor(END_UNIX * 1000)));
  if (team) url.searchParams.set('teamId', team);
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return { reachable: false, source: 'vercel', count: '', note: `vercel logs HTTP ${res.status}` };
    }
    const body = await res.json();
    const rows = body.logs || body.rows || body.data || [];
    const count = rows.filter((row) => {
      const text = JSON.stringify(row);
      return /login/i.test(text) && /\b500\b/.test(text);
    }).length;
    return { reachable: true, source: 'vercel', count, note: 'vercel runtime logs' };
  } catch (err) {
    return { reachable: false, source: 'vercel', count: '', note: err.message };
  }
}

function instructions() {
  console.error('No Stripe key in the environment. This script did not call Stripe.');
  console.error('');
  console.error('Run (read-only; CSV on stdout):');
  console.error('  STRIPE_READONLY_KEY=rk_live_... node scripts/report-checkout-outage.mjs > checkout-outage.csv');
  console.error('');
  console.error('An rk_ key with Checkout Sessions read and Customers read is enough.');
  console.error('STRIPE_SECRET_KEY is used only if STRIPE_READONLY_KEY is unset, and only for list/retrieve.');
  console.error(`Window: ${WINDOW_START} through ${WINDOW_END} (${TIME_ZONE}).`);
  console.error('Login 500s need FITMUNCH_LOG_FILE or VERCEL_TOKEN and VERCEL_PROJECT_ID.');
}

async function main() {
  const selected = keySource();
  if (!selected) {
    instructions();
    process.exit(1);
  }
  assertListKey(selected.key);
  const Stripe = require('stripe');
  const mode = selected.key.includes('_live_') ? 'live' : 'test';
  console.error(`Reading Stripe (${selected.source}, ${mode}). No writes.`);
  console.error(`Window ${WINDOW_START} through ${WINDOW_END} ${TIME_ZONE}.`);

  const stripe = new Stripe(selected.key);
  const sessions = await listAll(stripe.checkout.sessions.list({
    created: { gte: START_UNIX, lt: END_UNIX },
    limit: 100,
  }));
  const customers = await listAll(stripe.customers.list({
    created: { gte: START_UNIX, lt: END_UNIX },
    limit: 100,
  }));
  const prices = await priceAmounts(stripe, sessions);
  const logs = await login500s();

  const header = ['day', 'kind', 'status', 'count', 'amount_cents', 'currency', 'product', 'id', 'note'];
  const lines = [csvRow(header)];

  const byDayStatus = new Map();
  for (const day of DAYS) {
    for (const status of ['complete', 'expired', 'open']) {
      byDayStatus.set(`${day}|${status}`, 0);
    }
  }
  for (const session of sessions) {
    const day = sydneyDay(session.created);
    const status = session.status || '';
    const key = `${day}|${status}`;
    byDayStatus.set(key, (byDayStatus.get(key) || 0) + 1);
    const priceId = priceIdOf(session);
    const unit = priceId ? prices.get(priceId) : '';
    const note = [
      priceId ? `price=${priceId}` : '',
      unit === '' || unit == null ? '' : `price_unit_amount=${unit}`,
      session.livemode ? 'livemode' : 'testmode',
    ].filter(Boolean).join(' ');
    lines.push(csvRow([
      day,
      'session',
      status,
      1,
      session.amount_total == null ? '' : session.amount_total,
      session.currency || '',
      productOf(session),
      session.id,
      note,
    ]));
  }
  for (const day of DAYS) {
    for (const status of ['complete', 'expired', 'open']) {
      lines.push(csvRow([
        day,
        'session_count',
        status,
        byDayStatus.get(`${day}|${status}`) || 0,
        '',
        '',
        '',
        '',
        '',
      ]));
    }
  }

  const customersByDay = new Map(DAYS.map((day) => [day, 0]));
  for (const customer of customers) {
    const day = sydneyDay(customer.created);
    customersByDay.set(day, (customersByDay.get(day) || 0) + 1);
    lines.push(csvRow([
      day,
      'customer',
      '',
      1,
      '',
      '',
      (customer.metadata && (customer.metadata.product || customer.metadata.brand)) || '',
      customer.id,
      '',
    ]));
  }
  for (const day of DAYS) {
    lines.push(csvRow([
      day,
      'customer_count',
      '',
      customersByDay.get(day) || 0,
      '',
      '',
      '',
      '',
      '',
    ]));
  }

  lines.push(csvRow([
    '',
    'login_500',
    logs.reachable ? 'reachable' : 'unreachable',
    logs.reachable ? logs.count : '',
    '',
    '',
    '',
    '',
    logs.note || logs.source || '',
  ]));

  process.stdout.write(`${lines.join('\n')}\n`);

  console.error('');
  console.error('day         complete  expired  open  customers');
  for (const day of DAYS) {
    const complete = byDayStatus.get(`${day}|complete`) || 0;
    const expired = byDayStatus.get(`${day}|expired`) || 0;
    const open = byDayStatus.get(`${day}|open`) || 0;
    const customerCount = customersByDay.get(day) || 0;
    console.error(
      `${day}  ${String(complete).padStart(8)}  ${String(expired).padStart(7)}  ${String(open).padStart(4)}  ${String(customerCount).padStart(9)}`
    );
  }
  console.error(`login 500s: ${logs.reachable ? logs.count : `unreachable (${logs.note})`}`);
  console.error(`sessions ${sessions.length}, customers ${customers.length}`);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
