'use strict';
/**
 * FitMunch AI client — one interface, pluggable providers.
 *
 * Customer chat and meal plans: xAI, then OpenAI, then Anthropic.
 * Customer receipt vision: xAI, then OpenAI. No Gemini on either path.
 * A missing key or HTTP 401 tries the next provider. Gemini is never a fallback.
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

// ── PROVIDER DETECTION ──────────────────────────────────────────────────────

function providerName() {
  if (process.env.XAI_API_KEY) return 'xai';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function logAiCall(provider, route, ok) {
  const name = provider || 'none';
  const path = route || '-';
  console.info(`ai_provider=${name} route=${path} ok=${ok ? 'true' : 'false'}`);
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
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const OpenAI = require('openai');
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openai;
  } catch (e) {
    console.error('[ai-client] openai sdk load failed:', e.message);
    return null;
  }
}

// ── RAW HTTPS HELPERS ──────────────────────────────────────────────────────

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: { raw: data } }); }
      });
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

// ── GROK / XAI (OpenAI-compatible endpoint) ────────────────────────────────

async function grokChat({ system, messages, maxTokens, temperature, jsonMode }) {
  const model = grokModel();
  const key = process.env.XAI_API_KEY;
  
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
    
    if (status !== 200) {
      return { ok: false, error: status === 401 ? 'unauthorized' : 'provider_error', status, provider: 'xai' };
    }
    
    const text = data?.choices?.[0]?.message?.content || '';
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
    return { ok: false, error: 'provider_error', provider: 'xai' };
  }
}

async function xaiVision({ imageBase64, mimeType, prompt }) {
  const model = (process.env.GROK_VISION_MODEL || grokModel()).trim();
  const key = process.env.XAI_API_KEY;
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
    if (status !== 200) {
      return { ok: false, error: status === 401 ? 'unauthorized' : 'provider_error', status, provider: 'xai' };
    }
    const text = data?.choices?.[0]?.message?.content || '';
    return { ok: true, provider: 'xai', model, text, status };
  } catch (err) {
    return { ok: false, error: 'provider_error', provider: 'xai' };
  }
}

// ── ANTHROPIC FALLBACK ─────────────────────────────────────────────────────

async function anthropicChat({ system, messages, maxTokens, temperature }) {
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
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body
    );
    
    if (status !== 200) {
      return { ok: false, error: status === 401 ? 'unauthorized' : 'provider_error', status, provider: 'anthropic' };
    }
    
    const text = data?.content?.[0]?.text || '';
    return {
      ok: true,
      provider: 'anthropic',
      model: anthropicModel(),
      text,
      usage: {
        promptTokens: data?.usage?.input_tokens,
        completionTokens: data?.usage?.output_tokens,
      },
    };
  } catch (err) {
    return { ok: false, error: 'provider_error', provider: 'anthropic' };
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
    return {
      ok: true,
      provider: 'openai',
      model: payload.model,
      text,
      usage: {
        promptTokens: r?.usage?.prompt_tokens,
        completionTokens: r?.usage?.completion_tokens,
      },
    };
  } catch (err) {
    const status = err && (err.status || err.statusCode);
    return {
      ok: false,
      error: status === 401 ? 'unauthorized' : 'provider_error',
      status,
      provider: 'openai',
    };
  }
}

async function openaiVision({ imageBase64, mimeType, prompt }) {
  const key = process.env.OPENAI_API_KEY;
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
    if (status !== 200) {
      return { ok: false, error: status === 401 ? 'unauthorized' : 'provider_error', status, provider: 'openai' };
    }
    const text = data?.choices?.[0]?.message?.content || '';
    return { ok: true, provider: 'openai', model, text, status };
  } catch (err) {
    return { ok: false, error: 'provider_error', provider: 'openai' };
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

/** Chat providers in customer order. Gemini is not included. */
function availableProviders() {
  const list = [];
  if (process.env.XAI_API_KEY) list.push('xai');
  if (process.env.OPENAI_API_KEY) list.push('openai');
  if (process.env.ANTHROPIC_API_KEY) list.push('anthropic');
  return list;
}

function visionProviders() {
  const list = [];
  if (process.env.XAI_API_KEY) list.push('xai');
  if (process.env.OPENAI_API_KEY) list.push('openai');
  return list;
}

function tryNext(result) {
  if (!result) return true;
  if (result.error === 'missing_key') return true;
  return result.status === 401;
}

async function chat(opts) {
  const { system, messages = [], maxTokens = 800, temperature = 0.7, jsonMode = false, forceProvider, route } = opts || {};
  
  // Normalize messages
  const normalized = messages
    .map(m => ({ role: m.role, content: String(m.content ?? '') }))
    .filter(m => m.content.length);

  const args = { system, messages: normalized, maxTokens, temperature, jsonMode };

  if (forceProvider) {
    const name = forceProvider === 'grok' ? 'xai' : forceProvider;
    const only = await runProvider(name, args);
    logAiCall(name, route, !!(only.ok && only.text && String(only.text).trim()));
    return only;
  }

  const chain = availableProviders();
  if (!chain.length) return { ok: false, error: 'no_provider' };

  let last = { ok: false, error: 'no_provider' };
  for (const name of chain) {
    last = await runProvider(name, args);
    const answered = !!(last.ok && last.text && String(last.text).trim());
    logAiCall(name, route, answered);
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

/**
 * @param {{ imageBase64: string, mimeType?: string, prompt: string }} opts
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
    logAiCall(name, route, answered);
    if (answered) return last;
    if (tryNext(last)) continue;
    return { ok: false, error: 'unreadable', code: 'unreadable', provider: name, status: last.status };
  }
  return { ok: false, error: 'no_vision_provider', code: 'unavailable' };
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
};
