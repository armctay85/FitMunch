'use strict';
/**
 * FitMunch AI client. One interface, pluggable providers.
 *
 * Customer chat and meal plans: xAI, then OpenAI, then Anthropic.
 * Customer receipt vision: xAI, then OpenAI.
 * The next provider is tried on a missing key, HTTP 401, 402, 403, 404, 408,
 * 413, 429, any 5xx, or a network or timeout error with no status.
 * HTTP 400, HTTP 422, and content refusals stay on the current provider
 * (the receipt route turns those into 422).
 * Chat requests time out after 20 seconds. Vision gives the first provider
 * VISION_FIRST_TIMEOUT_MS (default 30 seconds; env override clamped to
 * 5..45 seconds) when another provider is configured, and the last provider
 * 20 seconds, so a slow valid read can still finish inside the 90 second
 * function limit. An xAI vision call that fails with no HTTP status (a
 * network error, not that first-provider cut) is retried once, on a short
 * timeout, only when time remains in the budget. Otherwise the chain moves
 * to the next provider immediately.
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
const { AsyncLocalStorage } = require('async_hooks');
const visionDiag = require('./vision-diag');

const REQUEST_TIMEOUT_MS = 20000;
// First vision provider, when another provider can take over. A real read
// can take about 20s, so the default is 30s. The env override is clamped:
// 45s plus the next provider's 20s still fits inside the 90s function limit.
const VISION_FIRST_TIMEOUT_MIN_MS = 5000;
const VISION_FIRST_TIMEOUT_MAX_MS = 45000;
const VISION_FIRST_TIMEOUT_MS = 30000;
// One quick second try after an xAI network error. Not used for the first-provider cut.
const XAI_QUICK_RETRY_MS = 3000;
// Cheapest xAI/OpenAI detail that still reads receipt lines. "low" is
// documented to miss fine detail. "auto" (the default when omitted) can
// pick the slow high-resolution path on a phone photo.
const VISION_DETAIL = 'high';
const FALLTHROUGH_STATUSES = new Set([401, 402, 403, 404, 408, 413, 429]);

function visionFirstTimeoutMs() {
  const raw = process.env.VISION_FIRST_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === '') return VISION_FIRST_TIMEOUT_MS;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return VISION_FIRST_TIMEOUT_MS;
  return Math.min(VISION_FIRST_TIMEOUT_MAX_MS, Math.max(VISION_FIRST_TIMEOUT_MIN_MS, Math.round(n)));
}

// Per-call vision budget. Async-local so a parallel scan cannot change it,
// and so provider functions keep their current arguments (maxTokens and
// jsonMode from the scan-accuracy work pass through unchanged).
const callContext = new AsyncLocalStorage();

function activeTimeoutMs() {
  const store = callContext.getStore();
  const n = store && Number(store.timeoutMs);
  if (Number.isFinite(n) && n >= 1000 && n <= 120000) return Math.round(n);
  return REQUEST_TIMEOUT_MS;
}

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

/** 4xx bodies can quote the prompt, so only their type and code are logged (billing phrases aside). */
function clientErrorLabel(data, err) {
  let e = data && typeof data === 'object' ? data.error : null;
  if (!e || typeof e !== 'object') e = err && typeof err === 'object' && err.error && typeof err.error === 'object' ? err.error : null;
  const bits = [e && e.type, e && e.code].filter((v) => v !== undefined && v !== null && v !== '').map(String);
  return bits.join(' ') || 'client_error';
}

// Provider billing and quota messages, matched case-sensitively at the start of
// the message. Only the fixed phrase is logged, never the rest of the message,
// so echoed prompt text or team ids after the phrase never reach the logs.
const BILLING_PREFIXES = [
  'Your credit balance is too low', // Anthropic
  'You have no credits remaining', // OpenAI
  'You exceeded your current quota', // OpenAI
];
// xAI. Both alternatives are anchored to the start (the QA regex
// /^Your team \S+ (has either )?used all available credits|reached its monthly spending limit/
// left the second branch unanchored).
const XAI_BILLING = /^Your team \S+ (?:has either )?(used all available credits|reached its monthly spending limit)/;
// Fixed phrase per matched alternative, so the log says which limit it was.
const XAI_BILLING_PHRASES = {
  'used all available credits': 'Your team has used all available credits',
  'reached its monthly spending limit': 'Your team has reached its monthly spending limit',
};

function billingPhrase(message) {
  const m = message.replace(/^\s+/, '');
  const prefix = BILLING_PREFIXES.find((p) => m.startsWith(p));
  if (prefix) return prefix;
  const x = XAI_BILLING.exec(m);
  if (x) return XAI_BILLING_PHRASES[x[1]];
  return null;
}

// Billing and quota errors are account state, not user input. Returns only a
// fixed phrase (or 'billing_error'), or null when the error is not billing.
function billingMessage(data, err) {
  let e = data && typeof data === 'object' ? data.error : null;
  if (!e || typeof e !== 'object') e = err && typeof err === 'object' && err.error && typeof err.error === 'object' ? err.error : null;
  if (!e) return null;
  if (e.type === 'billing_error') return 'billing_error';
  const message = typeof e.message === 'string' ? e.message : '';
  return message ? billingPhrase(message) : null;
}

function providerErrorMessage(data, err, status) {
  const code = Number(status);
  if (Number.isInteger(code) && code >= 400 && code <= 499) {
    const billing = billingMessage(data, err);
    if (billing !== null) return billing;
    // Any 4xx body can echo the prompt: log type and code only.
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

function tokenCount(v) {
  const n = Number(v);
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * Normalised token usage from a raw provider body.
 * xAI and OpenAI: usage.prompt_tokens / completion_tokens.
 * Anthropic: usage.input_tokens / output_tokens.
 */
function usageFrom(provider, data) {
  const u = data && typeof data === 'object' ? data.usage : null;
  if (!u || typeof u !== 'object') return { promptTokens: undefined, completionTokens: undefined };
  if (provider === 'anthropic') return { promptTokens: u.input_tokens, completionTokens: u.output_tokens };
  return { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens };
}

/**
 * One ai_provider= line per provider attempt with tokens_in= and tokens_out=
 * ('-' when absent), plus err= on failure. On success a separate background
 * `ai_tokens provider=<p> tokens_day=<n>` line follows, today's running total
 * (Sydney date) for that provider. Never logs content.
 */
function logAiCall(provider, route, ok, status, errorMessage, usage) {
  const name = provider || 'none';
  const path = route || '-';
  const tin = tokenCount(usage && usage.promptTokens);
  const tout = tokenCount(usage && usage.completionTokens);
  let line = `ai_provider=${name} route=${path} ok=${ok ? 'true' : 'false'} status=${statusToken(status)}`;
  line += ` tokens_in=${tin === null ? '-' : tin} tokens_out=${tout === null ? '-' : tout}`;
  if (!ok) line += ` err=${JSON.stringify(errorSnippet(errorMessage))}`;
  console.info(line);
  if (ok) {
    // Off the response path: a slow or failing store never delays the answer.
    let p;
    try { p = require('./ai-usage').recordTokens(name, tin || 0, tout || 0); } catch (_) { p = null; }
    const done = Promise.resolve(p)
      .then((day) => console.info(`ai_tokens provider=${name} tokens_day=${day === null || day === undefined ? '-' : day}`))
      .catch(() => {});
    // Keep the Vercel function alive until the day total is written.
    try { require('@vercel/functions').waitUntil(done); } catch (_) { /* off Vercel it just runs */ }
    return done;
  }
  return Promise.resolve();
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

function httpsPost(hostname, path, headers, body, signal) {
  const limit = activeTimeoutMs();
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
      timeout: limit,
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
    timer = setTimeout(deadline, limit);
    req.on('timeout', deadline);
    // The caller's time budget ran out: drop the request instead of letting it run on.
    if (signal) {
      const abort = () => {
        const err = new Error('aborted');
        err.code = 'ABORT_ERR';
        finish(reject, err);
        req.destroy(err);
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
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
  const errCode = err && err.code;
  if (status === 401) error = 'unauthorized';
  else if (errCode === 'ETIMEDOUT' || errCode === 'ESOCKETTIMEDOUT' || errCode === 'ABORT_ERR') error = 'timeout';
  else if (isContentRefusal(data, err)) error = 'content_refusal';
  const result = { ok: false, error, provider, errorMessage: errorSnippet(providerErrorMessage(data, err, status)) };
  if (status !== undefined && status !== null && status !== '') result.status = status;
  return result;
}

// ── GROK / XAI (OpenAI-compatible endpoint) ────────────────────────────────

async function grokChat({ system, messages, maxTokens, temperature, jsonMode, signal }) {
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
      body,
      signal
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

function visionImagePart(mimeType, imageBase64) {
  return {
    type: 'image_url',
    image_url: {
      url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`,
      detail: VISION_DETAIL,
    },
  };
}

/**
 * grok-4.3 is the current vision model (image in, text out). It is not a
 * retired id. Its default reasoning effort is "low", which spends the vision
 * budget before the receipt is read, so vision asks for "none".
 * reasoning_effort is only accepted by grok-4.3. Other ids omit it, because
 * a 400 would stop the chain as unreadable instead of failing over.
 * Chat completions is the legacy endpoint; image_url parts are still the
 * documented shape there. The Responses API uses a different body.
 */
function xaiVisionReasoning(model) {
  if (/^grok-4\.3(?:$|[-.])/.test(String(model || ''))) return { reasoning_effort: 'none' };
  return {};
}

function visionRequestBody({ model, imageBase64, mimeType, prompt, maxTokens, temperature, jsonMode, reasoning }) {
  const body = {
    model,
    max_tokens: maxTokens || 2000,
    temperature: temperature == null ? 0.1 : temperature,
    ...(reasoning || {}),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt || 'Read this receipt.' },
        visionImagePart(mimeType, imageBase64),
      ],
    }],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  return JSON.stringify(body);
}

function jsonModeRejected(result) {
  const msg = result && (result.errorMessage || result.error || '');
  return !!(result && result.status === 400 && /response_format|json_object|json_schema/i.test(String(msg)));
}

async function xaiVision({ imageBase64, mimeType, prompt, maxTokens, temperature, jsonMode }) {
  const model = (process.env.GROK_VISION_MODEL || grokModel()).trim();
  const key = envKey('XAI_API_KEY');
  if (!key) return { ok: false, error: 'missing_key', status: 401, provider: 'xai' };
  const send = (useJson) => httpsPost(
    'api.x.ai',
    '/v1/chat/completions',
    { Authorization: `Bearer ${key}` },
    visionRequestBody({
      model, imageBase64, mimeType, prompt, maxTokens, temperature, jsonMode: useJson, reasoning: xaiVisionReasoning(model),
    })
  );
  try {
    let useJson = !!jsonMode;
    let { status, data } = await send(useJson);
    if (status !== 200 && useJson && jsonModeRejected(failureResult('xai', status, data))) {
      useJson = false;
      ({ status, data } = await send(false));
    }
    if (status !== 200) return failureResult('xai', status, data);
    const text = data?.choices?.[0]?.message?.content || '';
    if (!String(text).trim() && isContentRefusal(data)) return failureResult('xai', status, data);
    return { ok: true, provider: 'xai', model, text, status, usage: usageFrom('xai', data) };
  } catch (err) {
    return failureResult('xai', err && (err.status || err.statusCode), null, err);
  }
}

// ── ANTHROPIC FALLBACK ─────────────────────────────────────────────────────

/**
 * Anthropic needs the first message to be from the user and roles to
 * alternate. Coach history can start with the coach's reply or repeat a
 * role, so: keep text parts only, drop system and empty messages, drop
 * leading and trailing assistant messages, and merge consecutive same-role
 * messages with a blank line.
 */
function messageText(content) {
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
  }
  return String(content ?? '').trim();
}

function normaliseAnthropicMessages(messages) {
  const out = [];
  for (const m of messages || []) {
    if (!m || m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = messageText(m.content);
    if (!text) continue;
    if (!out.length && role === 'assistant') continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content = `${prev.content}\n\n${text}`;
    else out.push({ role, content: text });
  }
  // Anthropic rejects a final assistant turn on models without prefill.
  while (out.length && out[out.length - 1].role === 'assistant') out.pop();
  return out;
}

async function anthropicChat({ system, messages, maxTokens, temperature, signal }) {
  const key = envKey('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'missing_key', status: 401, provider: 'anthropic' };
  const normalised = normaliseAnthropicMessages(messages);
  if (!normalised.some((m) => m.role === 'user')) {
    return { ok: false, error: 'no_user_message', provider: 'anthropic', errorMessage: 'no user message to send' };
  }
  const body = JSON.stringify({
    model: anthropicModel(),
    max_tokens: maxTokens || 800,
    temperature: temperature || 0.7,
    ...(system ? { system } : {}),
    messages: normalised,
  });

  try {
    const { status, data } = await httpsPost(
      'api.anthropic.com',
      '/v1/messages',
      {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body,
      signal
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

async function openaiChat({ system, messages, maxTokens, temperature, jsonMode, signal }) {
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
    const r = await client.chat.completions.create(payload, signal ? { signal } : undefined);
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

async function openaiVision({ imageBase64, mimeType, prompt, maxTokens, temperature, jsonMode }) {
  const key = envKey('OPENAI_API_KEY');
  if (!key) return { ok: false, error: 'missing_key', status: 401, provider: 'openai' };
  const model = (process.env.OPENAI_VISION_MODEL || openaiModel()).trim();
  const send = (useJson) => httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    { Authorization: `Bearer ${key}` },
    visionRequestBody({ model, imageBase64, mimeType, prompt, maxTokens, temperature, jsonMode: useJson })
  );
  try {
    let { status, data } = await send(!!jsonMode);
    if (status !== 200 && jsonMode && jsonModeRejected(failureResult('openai', status, data))) {
      ({ status, data } = await send(false));
    }
    if (status !== 200) return failureResult('openai', status, data);
    const text = data?.choices?.[0]?.message?.content || '';
    if (!String(text).trim() && isContentRefusal(data)) return failureResult('openai', status, data);
    return { ok: true, provider: 'openai', model, text, status, usage: usageFrom('openai', data) };
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
const MIN_ATTEMPT_MS = 2500;
function withDeadline(promise, ms, provider, controller) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve({ ok: false, error: 'timeout', errorMessage: 'time budget exceeded', status: 504, provider });
    }, ms);
  });
  return Promise.race([Promise.resolve(promise).catch((e) => ({ ok: false, error: 'provider_error', errorMessage: e && e.message, provider })), timeout])
    .finally(() => clearTimeout(timer));
}

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
  if (!Number.isInteger(code) || code <= 0) return null;
  return code;
}

function tryNext(result) {
  if (!result) return true;
  if (result.error === 'missing_key') return true;
  const status = httpStatus(result.status);
  if (status != null) {
    if (FALLTHROUGH_STATUSES.has(status)) return true;
    if (status >= 500 && status <= 599) return true;
    // Timeout with a non-refusal status still moves on. 400 and 422 stay:
    // those are the unreadable-receipt responses.
    if (result.error === 'timeout' && status !== 400 && status !== 422) return true;
    return false;
  }
  if (result.ok) return false;
  if (result.error === 'content_refusal' || result.refusal === true) return false;
  return true;
}

async function chat(opts) {
  const { system, messages = [], maxTokens = 800, temperature = 0.7, jsonMode = false, forceProvider, route, signal, budgetMs } = opts || {};

  const normalized = messages
    .map(m => ({ role: m.role, content: String(m.content ?? '') }))
    .filter(m => m.content.length);

  const args = { system, messages: normalized, maxTokens, temperature, jsonMode, signal };

  if (forceProvider) {
    const name = forceProvider === 'grok' ? 'xai' : forceProvider;
    const only = await runProvider(name, args);
    logAiCall(name, route, !!(only.ok && only.text && String(only.text).trim()), only.status, only.errorMessage || only.error, only.usage);
    return only;
  }

  const chain = availableProviders();
  if (!chain.length) return { ok: false, error: 'no_provider' };

  // Optional time budget for the whole chain: each provider gets what is left,
  // and no fallback starts once less than MIN_ATTEMPT_MS remains.
  const budget = Number(budgetMs) > 0 ? Number(budgetMs) : 0;
  const started = Date.now();
  let last = { ok: false, error: 'no_provider' };
  for (const name of chain) {
    if (signal && signal.aborted) return { ok: false, error: 'aborted' };
    if (budget) {
      const left = budget - (Date.now() - started);
      if (left < MIN_ATTEMPT_MS) {
        if (last && last.error === 'no_provider') last = { ok: false, error: 'timeout', status: 504, provider: name };
        break;
      }
      // Each attempt gets its own controller: on the deadline the provider
      // request is aborted, so a slow call never runs (or bills) after fallback.
      const ctrl = new AbortController();
      const passOn = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', passOn, { once: true });
      try {
        last = await withDeadline(runProvider(name, { ...args, signal: ctrl.signal }), left, name, ctrl);
      } finally {
        if (signal) signal.removeEventListener('abort', passOn);
      }
    } else {
      last = await runProvider(name, args);
    }
    const answered = !!(last.ok && last.text && String(last.text).trim());
    logAiCall(name, route, answered, last.status, last.errorMessage || last.error, last.usage);
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
  const code = Number(status);
  const unreadable = refusal || code === 400 || code === 422;
  return {
    ok: false,
    error: (last && last.error) || 'provider_error',
    code: unreadable ? 'unreadable' : 'unavailable',
    provider: (last && last.provider) || name,
    status,
    errorClass: visionDiag.classify(last),
    diag: visionDiag.summary(),
  };
}

function noteVision(name, result, started) {
  visionDiag.record({
    provider: (result && result.provider) || name,
    status: result && result.status,
    errorClass: visionDiag.classify(result),
    durationMs: Math.max(0, Date.now() - started),
    at: Date.now(),
  });
}

/** Network failure with no HTTP status. The first-provider cut is a timeout, not this. */
function networkNoStatus(result) {
  if (!result || result.ok) return false;
  if (httpStatus(result.status) != null) return false;
  if (result.error === 'timeout' || result.error === 'missing_key' || result.error === 'content_refusal' || result.error === 'unauthorized') return false;
  return true;
}

/**
 * Receipt vision. The first provider is limited to visionFirstTimeoutMs()
 * (default VISION_FIRST_TIMEOUT_MS, 30s) when another provider follows, so a
 * hung call fails over and a slow valid read can finish. The last provider
 * keeps REQUEST_TIMEOUT_MS.
 * xAI gets one short retry after a network error with no status, and only
 * when that retry still fits in the same budget. A timeout fails over at once.
 * Each attempt is passed through with maxTokens, temperature, and jsonMode.
 * jsonMode asks for a single JSON object. A provider that rejects
 * response_format is retried once without it, still on that provider.
 * @param {{ imageBase64: string, mimeType?: string, prompt: string, route?: string, maxTokens?: number, temperature?: number, jsonMode?: boolean }} opts
 */
async function vision(opts) {
  const { imageBase64, mimeType, prompt, route, maxTokens, temperature, jsonMode } = opts || {};
  const chain = visionProviders();
  if (!chain.length) {
    return { ok: false, error: 'no_vision_provider', code: 'unavailable', errorClass: 'no_provider', diag: visionDiag.summary() };
  }

  const attempt = { imageBase64, mimeType, prompt, maxTokens, temperature, jsonMode };

  let last = { ok: false, error: 'no_vision_provider', code: 'unavailable' };
  for (let i = 0; i < chain.length; i += 1) {
    const name = chain[i];
    const budgetMs = i === 0 && chain.length > 1 ? visionFirstTimeoutMs() : REQUEST_TIMEOUT_MS;
    const budgetStarted = Date.now();
    let timeoutMs = budgetMs;
    let tries = 0;
    for (;;) {
      const started = Date.now();
      last = await callContext.run({ timeoutMs }, () => runVision(name, attempt));
      noteVision(name, last, started);
      const answered = !!(last.ok && last.text && String(last.text).trim());
      logAiCall(name, route, answered, last.status, last.errorMessage || last.error, last.usage);
      if (answered) return last;
      if (!tryNext(last)) return visionStopped(last, name);
      const left = budgetMs - (Date.now() - budgetStarted);
      const retry = name === 'xai' && tries === 0 && networkNoStatus(last) && left >= XAI_QUICK_RETRY_MS;
      if (!retry) break;
      timeoutMs = Math.min(left, XAI_QUICK_RETRY_MS);
      tries += 1;
    }
  }
  return visionStopped(last, last && last.provider);
}

module.exports = {
  _logAiCallForTests: logAiCall,
  hasProvider,
  providerName,
  grokModel,
  openaiModel,
  anthropicModel,
  chat,
  chatJson,
  vision,
  visionRequestBody,
  availableProviders,
  visionProviders,
  tryNext,
  errorSnippet,
  normaliseAnthropicMessages,
  usageFrom,
  httpsPost,
  REQUEST_TIMEOUT_MS,
  VISION_FIRST_TIMEOUT_MS,
  visionFirstTimeoutMs,
  XAI_QUICK_RETRY_MS,
  VISION_DETAIL,
  MIN_ATTEMPT_MS,
  _withDeadlineForTests: withDeadline,
};
