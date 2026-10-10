'use strict';
/**
 * FitMunch AI client. One interface, pluggable providers.
 *
 * Customer chat and meal plans: xAI, then OpenAI, then Anthropic.
 * Customer receipt vision: xAI, then OpenAI.
 * The next provider is tried on a missing key, HTTP 401, 403, 404, 408, 429,
 * any 5xx, or a network or timeout error with no status.
 * HTTP 400 and content refusals stay on the current provider.
 * Each raw provider request times out after 20 seconds.
 *
 * Exports:
 *   hasProvider()              → boolean
 *   providerName()             → 'xai' | 'openai' | 'anthropic' | null
 *   chat({ system, messages, maxTokens, temperature, jsonMode, forceProvider, route })
 *                              → { ok, provider, model, text, usage } | { ok:false, error }
 *   chatJson({ ... })          → like chat but parses {...} out of text
 *   vision({ imageBase64, mimeType, prompt, route })
 *                              → { ok, provider, text } | { ok:false, code:'unavailable'|'unreadable' }
 */

const https = require('https');

const REQUEST_TIMEOUT_MS = 20000;
const FALLTHROUGH_STATUSES = new Set([401, 403, 404, 408, 429]);

// ── PROVIDER DETECTION ──────────────────────────────────────────────────────

/** Env key with surrounding whitespace removed. A pasted key ending in a
 * newline makes https.request throw ERR_INVALID_CHAR before anything is sent. */
function envKey(name) {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

function providerName() {
  if (envKey('XAI_API_KEY')) return 'xai';
  if (envKey('OPENAI_API_KEY')) return 'openai';
  if (envKey('ANTHROPIC_API_KEY')) return 'anthropic';
  return null;
}

function statusToken(status) {
  if (status === undefined || status === null || status === '') return '-';
  return String(status);
}

/**
 * Log-safe provider error snippet: one line, at most 200 characters, with
 * keys, bearer tokens and long base64 or hex runs removed. Callers pass only
 * the provider's own error message or the exception message, never the
 * prompt, messages or image.
 */
function errorSnippet(raw) {
  if (raw === undefined || raw === null) return '';
  return String(raw)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, '[jwt]')
    .replace(/\b(Basic|Bearer)\s+[^\s"',;]+/gi, '$1 [redacted]')
    .replace(/(x-api-key|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1$2[redacted]')
    .replace(/[A-Za-z0-9_\-]{32,}/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-ant-|sk-|xai-)[A-Za-z0-9_\-]+/g, '[redacted-key]')
    .replace(/[A-Fa-f0-9]{24,}/g, '[redacted]')
    .replace(/[A-Za-z0-9+/]{24,}={0,2}/g, '[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);
}

const LOGGABLE_4XX = new Set([401, 403, 404, 408, 429]);

/** Other 4xx bodies can quote the prompt, so only their type and code are logged. */
function clientErrorLabel(data, err) {
  let e = data && typeof data === 'object' ? data.error : null;
  if (!e || typeof e !== 'object') e = err && typeof err === 'object' && err.error && typeof err.error === 'object' ? err.error : null;
  const bits = [e && e.type, e && e.code].filter((v) => v !== undefined && v !== null && v !== '').map(String);
  return bits.join(' ') || 'client_error';
}

// Provider billing and quota messages, matched case-sensitively at the start of
// the message so echoed user input that merely mentions credit is not logged.
const BILLING_PREFIXES = [
  'Your credit balance is too low', // Anthropic
  'You have no credits remaining', // OpenAI
  'You exceeded your current quota', // OpenAI
];

function isBillingMessage(message) {
  const m = message.replace(/^\s+/, '');
  if (BILLING_PREFIXES.some((p) => m.startsWith(p))) return true;
  // xAI
  return m.startsWith('Your team ') && (m.includes('used all available credits') || m.includes('spending limit'));
}

// Billing and quota errors are account state, not user input, so their text is
// logged even on a 4xx that otherwise logs type and code only.
function billingMessage(data, err) {
  let e = data && typeof data === 'object' ? data.error : null;
  if (!e || typeof e !== 'object') e = err && typeof err === 'object' && err.error && typeof err.error === 'object' ? err.error : null;
  if (!e) return null;
  const message = typeof e.message === 'string' ? e.message : '';
  if (e.type === 'billing_error') return message || 'billing_error';
  if (message && isBillingMessage(message)) return message;
  return null;
}

function providerErrorMessage(data, err, status) {
  const code = Number(status);
  if (Number.isInteger(code) && code >= 400 && code <= 499 && !LOGGABLE_4XX.has(code)) {
    const billing = billingMessage(data, err);
    if (billing !== null) return billing;
    return clientErrorLabel(data, err);
  }
  if (data && typeof data === 'object') {
    const e = data.error;
    if (e && typeof e === 'object' && typeof e.message === 'string') return e.message;
    if (typeof e === 'string') return e;
    if (typeof data.message === 'string') return data.message;
  }
  if (err && typeof err === 'object') {
    const nested = err.error;
    if (nested && typeof nested === 'object' && typeof nested.message === 'string') return nested.message;
    const parts = [err.code, err.message].filter((v) => typeof v === 'string' && v);
    if (parts.length) return parts.join(' ');
  }
  return '';
}

function logAiCall(provider, route, ok, status, errorMessage) {
  const name = provider || 'none';
  const path = route || '-';
  let line = `ai_provider=${name} route=${path} ok=${ok ? 'true' : 'false'} status=${statusToken(status)}`;
  if (!ok) line += ` err=${JSON.stringify(errorSnippet(errorMessage))}`;
  console.info(line);
}

function hasProvider() {
  return providerName() !== null;
}

// ── MODEL NAMES ─────────────────────────────────────────────────────────────

function grokModel() { return (process.env.GROK_CHAT_MODEL || 'grok-4.3').trim(); }
function openaiModel() { return (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini').trim(); }
function anthropicModel() { return (process.env.ANTHROPIC_CHAT_MODEL || 'claude-haiku-4-5').trim(); }

// ── OPENAI (cached SDK) ────────────────────────────────────────────────────

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  if (!envKey('OPENAI_API_KEY')) return null;
  try {
    const OpenAI = require('openai');
    _openai = new OpenAI({
      apiKey: envKey('OPENAI_API_KEY'),
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    return _openai;
  } catch (e) {
    console.error('[ai-client] openai sdk load failed:', e.message);
    return null;
  }
}

// ── RAW HTTPS HELPERS ──────────────────────────────────────────────────────

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn(value);
    };
    const req = https.request({
      hostname,
      path,
      method: 'POST',
      timeout: REQUEST_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { finish(resolve, { status: res.statusCode, data: JSON.parse(data) }); }
        catch { finish(resolve, { status: res.statusCode, data: { raw: data } }); }
      });
    });
    const deadline = () => {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      finish(reject, err);
      req.destroy(err);
    };
    timer = setTimeout(deadline, REQUEST_TIMEOUT_MS);
    req.on('timeout', deadline);
    req.on('error', (err) => finish(reject, err));
    req.write(body);
    req.end();
  });
}

function isContentRefusal(data, err) {
  const bits = [];
  if (data && typeof data === 'object') {
    const bodyError = data.error;
    if (bodyError && typeof bodyError === 'object') {
      if (bodyError.code) bits.push(bodyError.code);
      if (bodyError.type) bits.push(bodyError.type);
    } else if (typeof bodyError === 'string') {
      bits.push(bodyError);
    }
    const choice = data.choices && data.choices[0];
    if (choice) {
      if (choice.finish_reason) bits.push(choice.finish_reason);
      if (choice.message && choice.message.refusal) bits.push('refusal');
    }
    if (data.stop_reason) bits.push(data.stop_reason);
    if (data.type && data.type !== 'error') bits.push(data.type);
  }
  if (err && typeof err === 'object') {
    if (err.code && err.code !== 'ETIMEDOUT') bits.push(err.code);
    if (err.type) bits.push(err.type);
    const nested = err.error;
    if (nested && typeof nested === 'object') {
      if (nested.code) bits.push(nested.code);
      if (nested.type) bits.push(nested.type);
    }
  }
  return /content_filter|content_policy|content_refusal|\brefusal\b/i.test(bits.join(' '));
}

function failureResult(provider, status, data, err) {
  let error = 'provider_error';
  if (status === 401) error = 'unauthorized';
  else if (isContentRefusal(data, err)) error = 'content_refusal';
  const result = { ok: false, error, provider, errorMessage: errorSnippet(providerErrorMessage(data, err, status)) };
  if (status !== undefined && status !== null && status !== '') result.status = status;
  return result;
}

// ── GROK / XAI (OpenAI-compatible endpoint) ────────────────────────────────

async function grokChat({ system, messages, maxTokens, temperature, jsonMode }) {
  const model = grokModel();
  const key = envKey('XAI_API_KEY');
  if (!key) return { ok: false, error: 'missing_key', status: 401, provider: 'xai' };

  const msgs = [
    ...(system ? [{ role: 'system', content: system }] : []),
    ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];

  if (!msgs.length) msgs.push({ role: 'user', content: 'Hello' });

  const body = JSON.stringify({
    model,
    messages: msgs,
    max_tokens: maxTokens || 800,
    temperature: temperature || 0.7,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });

  try {
    const { status, data } = await httpsPost(
      'api.x.ai',
      '/v1/chat/completions',
      { 'Authorization': `Bearer ${key}` },
      body
    );

    if (status !== 200) return failureResult('xai', status, data);

    const text = data?.choices?.[0]?.message?.content || '';
    if (!String(text).trim() && isContentRefusal(data)) return failureResult('xai', status, data);
    return {
      ok: true,
      provider: 'xai',
      status,
      model,
      text,
      usage: {
        promptTokens: data?.usage?.prompt_tokens,
        completionTokens: data?.usage?.completion_tokens,
      },
    };
  } catch (err) {
    return failureResult('xai', err && (err.status || err.statusCode), null, err);
  }
}

async function xaiVision({ imageBase64, mimeType, prompt }) {
  const model = (process.env.GROK_VISION_MODEL || grokModel()).trim();
  const key = envKey('XAI_API_KEY');
  if (!key) return { ok: false, error: 'missing_key', status: 401, provider: 'xai' };
  const body = JSON.stringify({
    model,
    max_tokens: 2000,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt || 'Read this receipt.' },
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } },
      ],
    }],
  });
  try {
    const { status, data } = await httpsPost(
      'api.x.ai',
      '/v1/chat/completions',
      { Authorization: `Bearer ${key}` },
      body
    );
    if (status !== 200) return failureResult('xai', status, data);
    const text = data?.choices?.[0]?.message?.content || '';
    if (!String(text).trim() && isContentRefusal(data)) return failureResult('xai', status, data);
    return { ok: true, provider: 'xai', model, text, status };
  } catch (err) {
    return failureResult('xai', err && (err.status || err.statusCode), null, err);
  }
}

// ── ANTHROPIC FALLBACK ─────────────────────────────────────────────────────

async function anthropicChat({ system, messages, maxTokens, temperature }) {
  const key = envKey('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'missing_key', status: 401, provider: 'anthropic' };
  const body = JSON.stringify({
    model: anthropicModel(),
    max_tokens: maxTokens || 800,
    temperature: temperature || 0.7,
    ...(system ? { system } : {}),
    messages: messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  });

  try {
    const { status, data } = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body
    );

    if (status !== 200) return failureResult('anthropic', status, data);

    const text = data?.content?.[0]?.text || '';
    if (!String(text).trim() && isContentRefusal(data)) return failureResult('anthropic', status, data);
    return {
      ok: true,
      provider: 'anthropic',
      status,
      model: anthropicModel(),
      text,
      usage: {
        promptTokens: data?.usage?.input_tokens,
        completionTokens: data?.usage?.output_tokens,
      },
    };
  } catch (err) {
    return failureResult('anthropic', err && (err.status || err.statusCode), null, err);
  }
}

// ── OPENAI CHAT ────────────────────────────────────────────────────────────

async function openaiChat({ system, messages, maxTokens, temperature, jsonMode }) {
  const client = getOpenAI();
  if (!client) return { ok: false, error: 'missing_key', status: 401, provider: 'openai' };

  const payload = {
    model: openaiModel(),
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ],
    max_tokens: maxTokens || 800,
    temperature: temperature || 0.7,
  };
  if (jsonMode) payload.response_format = { type: 'json_object' };

  try {
    const r = await client.chat.completions.create(payload);
    const text = r?.choices?.[0]?.message?.content || '';
    if (!String(text).trim() && isContentRefusal(r)) return failureResult('openai', 200, r);
    return {
      ok: true,
      provider: 'openai',
      status: 200,
      model: payload.model,
      text,
      usage: {
        promptTokens: r?.usage?.prompt_tokens,
        completionTokens: r?.usage?.completion_tokens,
      },
    };
  } catch (err) {
    const status = err && (err.status || err.statusCode);
    return failureResult('openai', status, null, err);
  }
}

async function openaiVision({ imageBase64, mimeType, prompt }) {
  const key = envKey('OPENAI_API_KEY');
  if (!key) return { ok: false, error: 'missing_key', status: 401, provider: 'openai' };
  const model = (process.env.OPENAI_VISION_MODEL || openaiModel()).trim();
  const body = JSON.stringify({
    model,
    max_tokens: 2000,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt || 'Read this receipt.' },
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } },
      ],
    }],
  });
  try {
    const { status, data } = await httpsPost(
      'api.openai.com',
      '/v1/chat/completions',
      { Authorization: `Bearer ${key}` },
      body
    );
    if (status !== 200) return failureResult('openai', status, data);
    const text = data?.choices?.[0]?.message?.content || '';
    if (!String(text).trim() && isContentRefusal(data)) return failureResult('openai', status, data);
    return { ok: true, provider: 'openai', model, text, status };
  } catch (err) {
    return failureResult('openai', err && (err.status || err.statusCode), null, err);
  }
}

// ── MAIN CHAT ROUTER ───────────────────────────────────────────────────────

/**
 * @param {{
 *   system?: string,
 *   messages: Array<{role:string, content:string}>,
 *   maxTokens?: number,
 *   temperature?: number,
 *   jsonMode?: boolean,
 *   forceProvider?: 'xai'|'openai'|'anthropic',
 *   route?: string
 * }} opts
 */
function runProvider(name, args) {
  switch (name) {
    case 'xai':
    case 'grok': return grokChat(args);
    case 'openai': return openaiChat(args);
    case 'anthropic': return anthropicChat(args);
    default: return Promise.resolve({ ok: false, error: 'provider_disabled', status: 401 });
  }
}

function runVision(name, args) {
  switch (name) {
    case 'xai': return xaiVision(args);
    case 'openai': return openaiVision(args);
    default: return Promise.resolve({ ok: false, error: 'provider_disabled', status: 401 });
  }
}

function availableProviders() {
  const list = [];
  if (envKey('XAI_API_KEY')) list.push('xai');
  if (envKey('OPENAI_API_KEY')) list.push('openai');
  if (envKey('ANTHROPIC_API_KEY')) list.push('anthropic');
  return list;
}

function visionProviders() {
  const list = [];
  if (envKey('XAI_API_KEY')) list.push('xai');
  if (envKey('OPENAI_API_KEY')) list.push('openai');
  return list;
}

function httpStatus(status) {
  if (status === undefined || status === null || status === '') return null;
  const code = Number(status);
  if (!Number.isInteger(code)) return null;
  return code;
}

function tryNext(result) {
  if (!result) return true;
  if (result.error === 'missing_key') return true;
  const status = httpStatus(result.status);
  if (status != null) {
    if (FALLTHROUGH_STATUSES.has(status)) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  }
  if (result.ok) return false;
  if (result.error === 'content_refusal' || result.refusal === true) return false;
  return true;
}

async function chat(opts) {
  const { system, messages = [], maxTokens = 800, temperature = 0.7, jsonMode = false, forceProvider, route } = opts || {};

  const normalized = messages
    .map(m => ({ role: m.role, content: String(m.content ?? '') }))
    .filter(m => m.content.length);

  const args = { system, messages: normalized, maxTokens, temperature, jsonMode };

  if (forceProvider) {
    const name = forceProvider === 'grok' ? 'xai' : forceProvider;
    const only = await runProvider(name, args);
    logAiCall(name, route, !!(only.ok && only.text && String(only.text).trim()), only.status, only.errorMessage || only.error);
    return only;
  }

  const chain = availableProviders();
  if (!chain.length) return { ok: false, error: 'no_provider' };

  let last = { ok: false, error: 'no_provider' };
  for (const name of chain) {
    last = await runProvider(name, args);
    const answered = !!(last.ok && last.text && String(last.text).trim());
    logAiCall(name, route, answered, last.status, last.errorMessage || last.error);
    if (answered) return last;
    if (tryNext(last)) continue;
    return last;
  }
  return last;
}

// ── CHAT → JSON HELPER ─────────────────────────────────────────────────────

async function chatJson(opts) {
  const res = await chat({ ...opts, jsonMode: true });
  if (!res.ok) return res;
  const match = res.text.match(/\{[\s\S]*\}/);
  if (!match) return { ...res, ok: false, error: 'no_json_in_response' };
  try {
    return { ...res, data: JSON.parse(match[0]) };
  } catch (e) {
    return { ...res, ok: false, error: 'json_parse_failed' };
  }
}

// ── VISION FUNCTION ────────────────────────────────────────────────────────

function visionStopped(last, name) {
  const status = last && last.status;
  const refusal = !!(last && (last.error === 'content_refusal' || last.refusal === true));
  const unreadable = refusal || Number(status) === 400;
  return {
    ok: false,
    error: (last && last.error) || 'provider_error',
    code: unreadable ? 'unreadable' : 'unavailable',
    provider: (last && last.provider) || name,
    status,
  };
}

/**
 * @param {{ imageBase64: string, mimeType?: string, prompt: string, route?: string }} opts
 */
async function vision(opts) {
  const { imageBase64, mimeType, prompt, route } = opts || {};
  const chain = visionProviders();
  if (!chain.length) {
    return { ok: false, error: 'no_vision_provider', code: 'unavailable' };
  }

  let last = { ok: false, error: 'no_vision_provider', code: 'unavailable' };
  for (const name of chain) {
    last = await runVision(name, { imageBase64, mimeType, prompt });
    const answered = !!(last.ok && last.text && String(last.text).trim());
    logAiCall(name, route, answered, last.status, last.errorMessage || last.error);
    if (answered) return last;
    if (tryNext(last)) continue;
    return visionStopped(last, name);
  }
  return visionStopped(last, last.provider);
}

module.exports = {
  hasProvider,
  providerName,
  grokModel,
  openaiModel,
  anthropicModel,
  chat,
  chatJson,
  vision,
  availableProviders,
  visionProviders,
  tryNext,
  errorSnippet,
  httpsPost,
  REQUEST_TIMEOUT_MS,
};
