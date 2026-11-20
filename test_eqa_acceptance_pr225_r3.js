'use strict';
/**
 * EQA acceptance list, FitMunch support form, PR 225 round 3.
 * Owned by Elite QA. Source list: acceptance-pr225-r3.md (FINAL 20 Nov 2026).
 * The builder commits this file unchanged and adds it to jest.config.js testMatch
 * (test_jest_testmatch_guard.js requires every root test_*.js to be listed).
 * No network: Resend, the DB and the webhook store are mocked in this file. No real sends.
 * Every test name starts with its line ID. Do not edit, skip, loosen or retry.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SUPPORT = 'support@fitmunch.com.au';
const OPS = 'ops-inbox@example.test';
const SECRET = 'whsec_' + Buffer.from('eqa-acceptance-225-r3-secret').toString('base64');
const SAVED = {};
for (const k of ['RESEND_API_KEY', 'RESEND_FROM', 'DATABASE_URL', 'SUPPORT_FORWARD_TO', 'RESEND_INBOUND_WEBHOOK_SECRET']) SAVED[k] = process.env[k];
process.env.RESEND_API_KEY = 're_eqa_acceptance_dummy';
process.env.SUPPORT_FORWARD_TO = OPS;
process.env.RESEND_INBOUND_WEBHOOK_SECRET = SECRET;
delete process.env.DATABASE_URL;
delete process.env.RESEND_FROM;

const sc = require('./lib/support-confirm');
const inbound = require('./lib/resend-inbound');
const counters = require('./lib/shared-counters');
const emailLib = require('./server/email');

const ORIGINAL_FETCH = global.fetch;
const FROM_ENVS = {
  A1: { label: 'chain_default_from (RESEND_FROM unset, code default From)', value: undefined },
  A2: { label: 'chain_resend_from_hello (RESEND_FROM is a hello@ sender)', value: 'FitMunch <hello@fitmunch.com.au>' },
  A3: { label: 'chain_resend_from_support (RESEND_FROM is support@, hypothetical)', value: 'FitMunch <support@fitmunch.com.au>' },
};

let seq = 0;
function uniqueEmail(tag) { seq += 1; return `eqa-${tag}-${seq}@example.test`; }
function lc(v) { return String(v || '').trim().toLowerCase(); }
function addrOf(v) { const m = String(v || '').match(/<([^<>\s]+)>/); return lc(m ? m[1] : v); }
function toList(v) { return (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map(addrOf); }
function replyList(v) { return (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v])).map((x) => String(x)); }

function setFrom(value) { if (value === undefined) delete process.env.RESEND_FROM; else process.env.RESEND_FROM = value; }

/** Mocked Resend send endpoint plus mocked DB. Returns the recorder. */
function installMocks({ failForward = false, failAck = false, storeOk = true, submitter } = {}) {
  const rec = { sends: [], queries: [], order: [] };
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.includes('api.resend.com')) throw new Error('unexpected fetch ' + u);
    const body = JSON.parse(opts.body || '{}');
    const isAck = toList(body.to).includes(lc(submitter));
    rec.sends.push(body);
    rec.order.push(isAck ? 'ack' : 'forward');
    const fail = (isAck && failAck) || (!isAck && failForward);
    if (fail) return { ok: false, status: 502, json: async () => ({ message: 'mock failure' }) };
    return { ok: true, status: 200, json: async () => ({ id: (isAck ? 'email_ack_' : 'email_fwd_') + rec.sends.length }) };
  };
  sc.setSupportQueryForTests(async (sql, params) => {
    const s = String(sql);
    rec.queries.push({ sql: s, params });
    if (/^\s*INSERT/i.test(s)) rec.order.push('store');
    if (!storeOk) { const e = new Error('mock db down'); e.code = 'ECONNREFUSED'; throw e; }
    return { rows: [{ id: 'row-eqa-1' }], rowCount: 1 };
  });
  return rec;
}

function sign(id, ts, payload) {
  const key = Buffer.from(SECRET.slice(6), 'base64');
  return 'v1,' + crypto.createHmac('sha256', key).update(`${id}.${ts}.${payload}`).digest('base64');
}

/** Resend inbound: the message as support@ receives it, then the signed webhook into the real relay. */
async function relay(received) {
  const sent = [];
  const fetchImpl = async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') === 'GET') {
      if (u.includes('/attachments')) return { ok: true, status: 200, json: async () => ({ data: [] }) };
      return { ok: true, status: 200, json: async () => received };
    }
    sent.push(JSON.parse(opts.body || '{}'));
    return { ok: true, status: 200, json: async () => ({ id: 'relay_' + sent.length }) };
  };
  const payload = JSON.stringify({ type: 'email.received', data: { email_id: received.id, to: received.to, from: received.from } });
  const ts = Math.floor(Date.now() / 1000);
  const headers = { 'svix-id': 'msg_eqa_1', 'svix-timestamp': String(ts), 'svix-signature': sign('msg_eqa_1', ts, payload) };
  const claims = { claim: async () => ({ claimed: true, token: 't' }), markSent: async () => true, release: async () => true };
  const env = { RESEND_INBOUND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 're_eqa_acceptance_dummy', SUPPORT_FORWARD_TO: OPS };
  const result = await inbound.handleResendInbound({ body: Buffer.from(payload), headers }, { env, fetch: fetchImpl, now: Date.now(), claims });
  return { result, sent };
}

function receivedFrom(forward, extraHeaders = {}) {
  const replyTo = forward.reply_to;
  return {
    id: 'rcv_eqa_12345678', from: forward.from, to: [SUPPORT], cc: [], subject: forward.subject,
    text: forward.text || '', html: forward.html || '', created_at: '2026-11-20T03:00:00Z',
    reply_to: replyList(replyTo),
    headers: Object.assign({ from: forward.from, to: SUPPORT, 'reply-to': replyList(replyTo).join(', ') }, extraHeaders),
    attachments: [],
  };
}

/** The real chain: submit, the real forward payload, then the real relay if the forward goes via support@. */
async function chain(fromValue, body = {}) {
  setFrom(fromValue);
  const submitter = body.email || uniqueEmail('chain');
  const rec = installMocks({ submitter });
  const r = await sc.sendSupportConfirmation(Object.assign({ name: 'Ada', subject: 'Billing', message: 'Need a hand with my plan' }, body, { email: submitter }));
  const outbound = rec.sends.filter((s) => !toList(s.to).includes(lc(submitter)));
  const viaSupport = outbound.find((s) => toList(s.to).includes(SUPPORT));
  const direct = outbound.find((s) => toList(s.to).includes(OPS));
  let out;
  if (viaSupport) {
    const rel = await relay(receivedFrom(viaSupport));
    out = { path: 'relay', relayStatus: rel.result && rel.result.status, opsCopies: rel.sent.length, ops: rel.sent[0] || null, forward: viaSupport };
  } else if (direct) {
    out = { path: 'direct', relayStatus: null, opsCopies: outbound.filter((s) => toList(s.to).includes(OPS)).length, ops: direct, forward: direct };
  } else {
    out = { path: 'none', relayStatus: null, opsCopies: 0, ops: null, forward: null };
  }
  return Object.assign(out, { status: r.status, submitter, rec });
}

/** The A1 to A3 assertion as one function, so A5 can prove it bites. */
function opsReplyVerdict(c) {
  const got = c.ops ? replyList(c.ops.reply_to).map(addrOf) : [];
  return { path: c.path, opsCopies: c.opsCopies, ops_reply_to: got.length ? got : null, wanted: [c.submitter], ok: c.opsCopies === 1 && got.length === 1 && got[0] === c.submitter };
}

beforeEach(async () => {
  if (typeof counters.resetSharedCountersForTests === 'function') await counters.resetSharedCountersForTests();
  process.env.RESEND_API_KEY = 're_eqa_acceptance_dummy';
  process.env.SUPPORT_FORWARD_TO = OPS;
  delete process.env.DATABASE_URL;
  setFrom(undefined);
});

afterAll(() => {
  global.fetch = ORIGINAL_FETCH;
  sc.setSupportQueryForTests(null);
  for (const [k, v] of Object.entries(SAVED)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

{
  for (const id of ['A1', 'A2', 'A3']) {
    test(`${id} ${FROM_ENVS[id].label}: the copy ops receives has reply_to = submitter`, async () => {
      const c = await chain(FROM_ENVS[id].value);
      expect(c.status).toBe(200);
      const v = opsReplyVerdict(c);
      expect({ path: v.path, opsCopies: v.opsCopies, ops_reply_to: v.ops_reply_to, ok: v.ok }).toEqual({ path: v.path, opsCopies: 1, ops_reply_to: v.wanted, ok: true });
    });
  }

  test('A4 chain drives the real code: real forward payload, then the real handleResendInbound, or proof the relay is not in the path', async () => {
    const c = await chain(undefined);
    expect(['relay', 'direct']).toContain(c.path);
    expect(c.ops).toBeTruthy();
    if (c.path === 'relay') {
      expect(typeof inbound.handleResendInbound).toBe('function');
      expect(c.relayStatus).toBe(200);
      expect(c.opsCopies).toBe(1);
      expect(toList(c.ops.to)).toEqual([OPS]);
    } else {
      // Option (b): nothing goes to support@, the form forward itself reaches SUPPORT_FORWARD_TO.
      expect(c.rec.sends.filter((s) => toList(s.to).includes(SUPPORT))).toHaveLength(0);
      expect(toList(c.ops.to)).toEqual([OPS]);
    }
  });

  for (const id of ['A1', 'A2', 'A3']) {
    test(`A5 break check for ${id}: ops copy reply_to set back to a From address turns the ${id} assertion red`, async () => {
      const c = await chain(FROM_ENVS[id].value);
      expect(c.ops).toBeTruthy();
      const fromInbound = addrOf(c.forward && c.forward.from);
      const fromOps = addrOf(c.ops.from);
      for (const bad of [fromInbound, fromOps]) {
        const broken = Object.assign({}, c, { ops: Object.assign({}, c.ops, { reply_to: bad }) });
        expect(opsReplyVerdict(broken).ok).toBe(false);
      }
      const removed = Object.assign({}, c, { ops: Object.assign({}, c.ops) });
      delete removed.ops.reply_to;
      expect(opsReplyVerdict(removed).ok).toBe(false);
      // The verdict is green only for the submitter itself.
      const fixed = Object.assign({}, c, { opsCopies: 1, ops: Object.assign({}, c.ops, { reply_to: c.submitter }) });
      expect(opsReplyVerdict(fixed).ok).toBe(true);
    });
  }

  const A6 = [
    ['A6 inbound Reply-To with two addresses', { 'reply-to': 'one@example.test, two@example.test' }, ['one@example.test', 'two@example.test']],
    ['A6 inbound Reply-To with CR/LF header break', { 'reply-to': 'one@example.test\r\nBcc: evil@example.test' }, ['one@example.test\r\nBcc: evil@example.test']],
    ['A6 inbound reply_to array of two', {}, ['one@example.test', 'two@example.test']],
  ];
  for (const [name, hdr, top] of A6) {
    test(`${name}: ops copy has at most one safe reply-to, never two recipients`, async () => {
      setFrom(undefined);
      const forward = { from: 'FitMunch <hello@fitmunch.com.au>', to: [SUPPORT], subject: 'Billing', text: 'x', html: '<p>x</p>', reply_to: top };
      const rel = await relay(receivedFrom(forward, hdr));
      expect(rel.sent.length).toBeLessThan(2);
      for (const s of rel.sent) {
        const r = replyList(s.reply_to);
        expect(r.length).toBeLessThan(2);
        for (const a of r) {
          expect(a).not.toMatch(/[\r\n,;]/);
          expect((a.match(/@/g) || []).length).toBe(1);
          expect(addrOf(a)).not.toBe('evil@example.test');
        }
      }
    });
  }
  test('A6 form layer: a reply-to with CR/LF or two addresses never reaches a send', async () => {
    const rec = installMocks({ submitter: 'nobody@example.test' });
    for (const bad of ['one@example.test\r\nBcc: evil@example.test', 'one@example.test, two@example.test', ['one@example.test', 'two@example.test']]) {
      await emailLib.sendSupportInboxEmail({ replyTo: bad, name: 'Ada', subject: 'Hi', message: 'm' });
    }
    for (const s of rec.sends) {
      const r = replyList(s.reply_to);
      expect(r.length).toBeLessThan(2);
      for (const a of r) expect(a).not.toMatch(/[\r\n,;\s]/);
    }
  });

  test('A7 SUPPORT_FORWARD_TO unset: the forward is recorded as failed and logged, never reported as sent, and the message is still stored', async () => {
    delete process.env.SUPPORT_FORWARD_TO;
    const submitter = uniqueEmail('a7');
    const rec = installMocks({ submitter });
    const logged = [];
    const orig = { error: console.error, warn: console.warn, log: console.log };
    for (const k of ['error', 'warn', 'log']) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
    let r;
    try { r = await sc.sendSupportConfirmation({ email: submitter, name: 'Ada', subject: 'Billing', message: 'a7 keep me' }); } finally { Object.assign(console, orig); }
    expect(r.status).toBe(200);
    expect(r.body && r.body.forward_status).toBe('failed');
    const insert = rec.queries.find((qq) => /^\s*INSERT INTO support_messages/i.test(qq.sql));
    expect(Boolean(insert && insert.params.includes('a7 keep me'))).toBe(true);
    const sentFlags = [];
    for (const qq of rec.queries.filter((x) => /^\s*UPDATE support_messages/i.test(x.sql))) {
      const set = (qq.sql.match(/SET([\s\S]*?)WHERE/i) || [])[1] || '';
      for (const part of set.split(',')) {
        const m = part.match(/(\w+)\s*=\s*\$(\d+)/);
        if (m && /forward/i.test(m[1]) && qq.params[Number(m[2]) - 1] === 'sent') sentFlags.push(m[1]);
      }
    }
    expect(sentFlags).toEqual([]);
    expect(logged.some((l) => /forward/i.test(l) && /(fail|unset|missing)/i.test(l))).toBe(true);
  });

  test('A8 one delivery to ops: never both a send via support@ and a direct send to SUPPORT_FORWARD_TO, and the relay does not loop its own copy', async () => {
    const c = await chain(undefined);
    const viaSupport = c.rec.sends.filter((x) => toList(x.to).includes(SUPPORT)).length;
    const direct = c.rec.sends.filter((x) => toList(x.to).includes(OPS)).length;
    expect({ both: viaSupport > 0 && direct > 0, opsCopies: c.opsCopies }).toEqual({ both: false, opsCopies: 1 });
    if (c.path === 'relay') {
      // The ops copy coming back into support@ must not be relayed again.
      const back = receivedFrom(c.ops);
      back.headers = Object.assign({}, c.ops.headers || {}, back.headers, { to: SUPPORT });
      const echo = await relay(back);
      expect(echo.sent).toHaveLength(0);
    } else {
      expect(toList(c.ops.to)).not.toContain(SUPPORT);
    }
  });

  test('B1 all_ok: 200, order store then forward then ack, 1 ack', async () => {
    const submitter = uniqueEmail('b1');
    const rec = installMocks({ submitter });
    const r = await sc.sendSupportConfirmation({ email: submitter, name: 'Ada', subject: 'Billing', message: 'Need a hand' });
    expect(r.status).toBe(200);
    expect(rec.order).toEqual(['store', 'forward', 'ack']);
    expect(rec.order.filter((x) => x === 'ack')).toHaveLength(1);
  });
  test('B2 both_fail (store and forward fail): 503, 0 acks', async () => {
    const submitter = uniqueEmail('b2');
    const rec = installMocks({ submitter, storeOk: false, failForward: true });
    const r = await sc.sendSupportConfirmation({ email: submitter, message: 'm2' });
    expect(r.status).toBe(503);
    expect(rec.order.filter((x) => x === 'ack')).toHaveLength(0);
  });
  test('B3 forward_only_ok_store_fail: 200, 1 ack', async () => {
    const submitter = uniqueEmail('b3');
    const rec = installMocks({ submitter, storeOk: false });
    const r = await sc.sendSupportConfirmation({ email: submitter, message: 'm3' });
    expect(r.status).toBe(200);
    expect(rec.order.filter((x) => x === 'ack')).toHaveLength(1);
  });
  test('B4 store_only_ok_forward_fail: 200, forward_status failed, row stored, 1 ack', async () => {
    const submitter = uniqueEmail('b4');
    const rec = installMocks({ submitter, failForward: true });
    const r = await sc.sendSupportConfirmation({ email: submitter, message: 'm4' });
    expect(r.status).toBe(200);
    expect(r.body && r.body.forward_status).toBe('failed');
    expect(rec.queries.filter((q) => /^\s*INSERT/i.test(q.sql))).toHaveLength(1);
    expect(rec.order.filter((x) => x === 'ack')).toHaveLength(1);
  });
  test('B5 ack_send_fails_after_ok: 200, ack_failed logged, message kept', async () => {
    const submitter = uniqueEmail('b5');
    const rec = installMocks({ submitter, failAck: true });
    const logged = [];
    const orig = console.error;
    console.error = (...a) => { logged.push(a.map(String).join(' ')); };
    let r;
    try { r = await sc.sendSupportConfirmation({ email: submitter, message: 'm5 keep me' }); } finally { console.error = orig; }
    expect(r.status).toBe(200);
    expect(logged.some((l) => l.includes('ack_failed'))).toBe(true);
    const insert = rec.queries.find((q) => /^\s*INSERT/i.test(q.sql));
    expect(insert && insert.params.includes('m5 keep me')).toBe(true);
    expect(rec.queries.some((q) => /^\s*DELETE/i.test(q.sql))).toBe(false);
  });

  const C1 = [
    ['C1 bad email', { email: 'not-an-email', message: 'x' }],
    ['C1 CR/LF in email', { email: 'a@b.test\r\nBcc: z@evil.test', message: 'x' }],
    ['C1 list of emails', { email: 'a@b.test,c@d.test', message: 'x' }],
    ['C1 empty message', { email: 'c1-empty@example.test', message: '   ' }],
  ];
  for (const [name, body] of C1) {
    test(`${name}: 400, 0 sends, 0 rows`, async () => {
      const rec = installMocks({ submitter: 'none@example.test' });
      const r = await sc.sendSupportConfirmation(body);
      expect(r.status).toBe(400);
      expect(rec.sends).toHaveLength(0);
      expect(rec.queries.filter((q) => /^\s*INSERT/i.test(q.sql))).toHaveLength(0);
    });
  }

  test('C2 CR/LF/tab in subject and name, script tag in message: flattened or escaped in every forward line', async () => {
    const c = await chain(undefined, { name: 'Ada\r\n\tBcc: x@evil.test', subject: 'Hi\r\n\tBcc: y@evil.test', message: 'Line one\nLine two <script>alert(1)</script>' });
    const copies = [c.forward, c.ops].filter(Boolean);
    expect(copies.length).toBeGreaterThan(0);
    for (const m of copies) {
      expect(String(m.subject)).not.toMatch(/[\r\n\t]/);
      const lines = String(m.text || '').split('\n');
      for (const l of lines.filter((x) => /^(Name|Subject|Reply-to|From|To):/i.test(x))) expect(l).not.toMatch(/[\r\t]|Bcc: [xy]@evil\.test.*\n/);
      expect(String(m.text || '').split('\n').filter((l) => /^Bcc:/i.test(l))).toHaveLength(0);
      expect(String(m.html || '')).not.toMatch(/<script/i);
      expect(String(m.html || '')).toMatch('&lt;script&gt;');
    }
  });

  test('C3 full message text is in the forward text and HTML', async () => {
    const message = 'First line of my question\nSecond line with detail\nThird line: order 12345';
    const c = await chain(undefined, { message });
    for (const m of [c.forward, c.ops].filter(Boolean)) {
      expect(String(m.text || '')).toContain(message);
      for (const line of message.split('\n')) expect(String(m.html || '')).toContain(line);
    }
  });

  test('C4 migration, support_messages block only: every statement on support_messages is CREATE TABLE/INDEX IF NOT EXISTS, none is DROP, DELETE, TRUNCATE or ALTER', () => {
    // Scoped to statements that name support_messages. Other statements in the same migration string
    // (for example PR 224's ALTER TABLE users ... role) are not this row's business.
    const src = fs.readFileSync(path.join(__dirname, 'lib', 'db-migrate.js'), 'utf8').replace(/--[^\n]*/g, '');
    const stmts = src.split(/[;`]/).filter((st) => /support_messages/i.test(st)).map((st) => st.trim());
    expect(stmts.length).toBeGreaterThan(0);
    for (const st of stmts) {
      expect(st).toMatch(/^CREATE (TABLE|(UNIQUE )?INDEX) IF NOT EXISTS\b/i);
      expect(st).not.toMatch(/\b(DROP|DELETE|TRUNCATE|ALTER)\b/i);
    }
  });

  test('D1 merge order with PR 223: exactly one CREATE TABLE support_messages, and every column the form writes is in it', () => {
    const mig = fs.readFileSync(path.join(__dirname, 'lib', 'db-migrate.js'), 'utf8');
    const creates = [...mig.matchAll(/CREATE TABLE IF NOT EXISTS support_messages\s*\(([\s\S]*?)\n\);/gi)];
    expect(creates.length).toBe(1);
    const cols = new Set(creates[0][1].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((w) => /^[a-z_]+$/i.test(w)).map((w) => w.toLowerCase()));
    const srcDir = path.join(__dirname, 'lib');
    const writers = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');
    const used = new Set();
    for (const m of writers.matchAll(/INSERT INTO support_messages\s*\(([^)]*)\)/gi)) m[1].split(',').forEach((c) => used.add(c.trim().toLowerCase()));
    for (const m of writers.matchAll(/UPDATE support_messages\s+SET\s+([^`]*?)\s+WHERE/gi)) m[1].split(',').forEach((c) => used.add(c.split('=')[0].trim().toLowerCase()));
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((c) => !cols.has(c)).sort()).toEqual([]);
  });

  // Permanent rows from EQA r1 and r2 verdicts that are Shoulds (not blockers this round).
  test.todo('R1-S1 / R2-S1 Should: forward_status=failed row has no retry, alert or admin view (lib/support-confirm.js:150-191)');
  test.todo('R1-S2 / R2-S2 Should: ack-only failure still says a confirmation is on its way (public/support.html)');
  test.todo('R1-S3 Should: abuse limits, no honeypot or Turnstile, name echoed in ack');
  test.todo('R1-S4 Should: forward HTML collapses line breaks');
  test.todo('R1-S5 Should: no "[Help form]" marker in the forward subject');
  test.todo('R1-S6 Should: support_messages retention and account-deletion purge');
  test.todo('R1-S7 / R2-S7 Should: SUPPORT_FORWARD_TO unset makes the relay return 200 and drop support@ mail');
  test.todo('R1-S8 Should: PR body quotes CI counts, not a local run');
  test.todo('R1-S9 Should: a message over 4000 characters says "Enter a message."');
  test.todo('R2-S10 Should: ack on forward-only success trusts the relay (closed by option b)');
  test.todo('R2-S11 Should: insert with rowCount but no id leaves delivery columns failed');
  test.todo('R2-S12 Should: builder evidence must read the full env list and test the whole chain');
}
