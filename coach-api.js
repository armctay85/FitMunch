'use strict';

const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('./lib/fitmunch-checkout');
const store = require('./lib/coach-store');
const {
  buildCoachPlan,
  applyStoreChoices,
  evaluateCoachClientGate,
  targetsFromLogs,
  PRICE_NOTE,
  DIETITIAN_LINE,
  CLIENT_GATE_HOOK,
} = require('./lib/coach-plan');
const { buildCoachPdf } = require('./lib/coach-pdf');
const { renderSharePage, renderMissing } = require('./lib/coach-share');

const api = express.Router();
const pages = express.Router();

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function sendError(res, err) {
  const status = {
    bad_targets: 400,
    bad_household: 400,
    bad_store: 400,
    bad_stores: 400,
    bad_shopping: 400,
    bad_flags: 400,
    bad_logo: 400,
    no_meals: 400,
    not_your_client: 403,
    client_count_gate: 403,
    not_found: 404,
  }[err.code] || 500;
  const body = {
    success: false,
    error: err.code || 'error',
    message: status === 500 ? 'Could not build that plan.' : err.message,
  };
  if (err.gate) body.gate = err.gate;
  res.status(status).json(body);
}

function requirePt(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorised' });
  }
  try {
    const user = jwt.verify(header.slice(7), jwtSecret());
    if (user.preview && !store.previewEnabled()) {
      return res.status(401).json({ success: false, error: 'Unauthorised' });
    }
    if (user.role !== 'pt') {
      return res.status(403).json({ success: false, error: 'Trainer account required.' });
    }
    req.user = user;
    next();
  } catch (_) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

function cleanName(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
}

function cleanAccent(value) {
  const raw = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : '#1f9d4a';
}

function parseLogo(dataUrl) {
  if (dataUrl == null || dataUrl === '') return { logoDataUrl: null, logo: null };
  if (typeof dataUrl !== 'string' || dataUrl.length > 500000) {
    throw fail('bad_logo', 'Logo must be a PNG or JPEG under 350KB.');
  }
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) throw fail('bad_logo', 'Logo must be a PNG or JPEG.');
  const mime = match[1] === 'jpg' ? 'jpeg' : match[1];
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (buffer.length < 32 || buffer.length > 350000) {
    throw fail('bad_logo', 'Logo must be a PNG or JPEG under 350KB.');
  }
  return {
    logoDataUrl: `data:image/${mime};base64,${buffer.toString('base64')}`,
    logo: { mime, buffer },
  };
}

function logoFromBranding(branding) {
  if (!branding || !branding.logoDataUrl) return null;
  try {
    return parseLogo(branding.logoDataUrl).logo;
  } catch (_) {
    return null;
  }
}

async function gateFor(ptId, clientId) {
  const clients = await store.listClients(ptId);
  const record = await store.getGateRecord(ptId);
  const gate = evaluateCoachClientGate({
    limit: store.limitFor(record),
    clientId,
    rosterIds: clients.map((client) => client.id),
  });
  return { clients, gate };
}

api.get('/preview-status', (_req, res) => {
  res.json({ success: true, enabled: store.previewEnabled() });
});

api.post('/preview-session', (_req, res) => {
  if (!store.previewEnabled()) return res.status(404).json({ success: false, error: 'Not found' });
  const user = store.PREVIEW_PT;
  const token = jwt.sign({
    userId: user.id,
    name: user.name,
    email: user.email,
    role: 'pt',
    preview: true,
  }, jwtSecret(), { expiresIn: '12h' });
  res.json({
    success: true,
    token,
    user: { id: user.id, name: user.name, email: user.email, role: 'pt', preview: true },
  });
});

api.get('/gate', requirePt, async (req, res) => {
  try {
    const { gate } = await gateFor(req.user.userId, null);
    res.json({ success: true, gate, hook: CLIENT_GATE_HOOK });
  } catch (err) {
    sendError(res, err);
  }
});

api.get('/clients', requirePt, async (req, res) => {
  try {
    const clients = await store.listClients(req.user.userId);
    res.json({ success: true, clients });
  } catch (err) {
    sendError(res, err);
  }
});

api.get('/clients/:clientId/targets', requirePt, async (req, res) => {
  try {
    const { clients } = await gateFor(req.user.userId, req.params.clientId);
    const client = clients.find((row) => row.id === req.params.clientId);
    if (!client) return res.status(403).json({ success: false, error: 'not_your_client' });
    const logs = await store.getLogs(client.id);
    const targets = targetsFromLogs(logs);
    res.json({ success: true, client, targets });
  } catch (err) {
    sendError(res, err);
  }
});

api.get('/branding', requirePt, async (req, res) => {
  try {
    const branding = await store.getBranding(req.user.userId);
    res.json({ success: true, branding });
  } catch (err) {
    sendError(res, err);
  }
});

api.put('/branding', requirePt, async (req, res) => {
  try {
    const body = req.body || {};
    const logo = parseLogo(body.logoDataUrl);
    const branding = await store.saveBranding(req.user.userId, {
      practiceName: cleanName(body.practiceName),
      accent: cleanAccent(body.accent),
      logoDataUrl: logo.logoDataUrl,
    });
    res.json({ success: true, branding });
  } catch (err) {
    sendError(res, err);
  }
});

api.get('/plans', requirePt, async (req, res) => {
  try {
    const rows = await store.listPlans(req.user.userId);
    res.json({
      success: true,
      plans: rows.map((row) => store.publicPlan(row)),
    });
  } catch (err) {
    sendError(res, err);
  }
});

api.get('/plans/:id', requirePt, async (req, res) => {
  try {
    const row = await store.getPlan(req.params.id, req.user.userId);
    if (!row) return res.status(404).json({ success: false, error: 'not_found' });
    res.json({ success: true, plan: await store.withAdherence(row) });
  } catch (err) {
    sendError(res, err);
  }
});

api.post('/plans', requirePt, async (req, res) => {
  try {
    const body = req.body || {};
    const { clients, gate } = await gateFor(req.user.userId, body.clientId);
    const client = clients.find((row) => row.id === String(body.clientId || ''));
    if (!client) {
      if (!gate.allowed) {
        return res.status(403).json({ success: false, error: 'client_count_gate', gate });
      }
      return res.status(403).json({ success: false, error: 'not_your_client', gate });
    }
    if (!gate.allowed) {
      return res.status(403).json({ success: false, error: 'client_count_gate', gate });
    }
    const plan = buildCoachPlan({
      kcal: body.kcal,
      protein: body.protein,
      carbs: body.carbs,
      fat: body.fat,
      flags: body.flags,
      householdSize: body.householdSize,
      storeId: body.storeId,
    });
    const row = await store.createPlan({
      ptId: req.user.userId,
      clientId: client.id,
      clientLabel: client.label,
      plan,
      source: body.source === 'logs' ? 'logs' : 'manual',
    });
    res.status(201).json({ success: true, plan: await store.withAdherence(row), gate });
  } catch (err) {
    sendError(res, err);
  }
});

api.put('/plans/:id/stores', requirePt, async (req, res) => {
  try {
    const row = await store.getPlan(req.params.id, req.user.userId);
    if (!row) return res.status(404).json({ success: false, error: 'not_found' });
    row.plan.shopping = applyStoreChoices(row.plan.shopping, (req.body || {}).stores);
    await store.writePlan(row);
    res.json({ success: true, plan: await store.withAdherence(row) });
  } catch (err) {
    sendError(res, err);
  }
});

api.post('/plans/:id/send', requirePt, async (req, res) => {
  try {
    const row = await store.getPlan(req.params.id, req.user.userId);
    if (!row) return res.status(404).json({ success: false, error: 'not_found' });
    const updated = await store.markStatus(row, 'send');
    res.json({ success: true, plan: await store.withAdherence(updated) });
  } catch (err) {
    sendError(res, err);
  }
});

async function sharedRow(token) {
  const row = await store.getByToken(token);
  if (!row || !row.token) return null;
  return store.markStatus(row, 'view');
}

pages.get('/coach', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'coach.html'));
});

pages.get('/c/:token/pdf', async (req, res, next) => {
  try {
    const row = await sharedRow(req.params.token);
    if (!row) return res.status(404).type('html').send(renderMissing());
    const branding = await store.getBranding(row.ptId);
    const pdf = buildCoachPdf({
      branding: {
        practiceName: branding.practiceName,
        accent: branding.accent,
        logo: logoFromBranding(branding),
      },
      plan: row.plan,
      clientLabel: row.clientLabel,
    });
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    res.type('application/pdf');
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

pages.get('/c/:token', async (req, res, next) => {
  try {
    const row = await sharedRow(req.params.token);
    if (!row) return res.status(404).type('html').send(renderMissing());
    const branding = await store.getBranding(row.ptId);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    res.type('html').send(renderSharePage({ planRow: row, branding }));
  } catch (err) {
    next(err);
  }
});

module.exports = { api, pages, PRICE_NOTE, DIETITIAN_LINE };
