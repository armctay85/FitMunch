'use strict';
/**
 * FitMunch AI client — one interface, pluggable providers.
 *
 * Provider selection (highest priority first):
 *   1. GEMINI_API_KEY     → Gemini 2.5 Flash (free tier). Text + Vision.
 *   2. XAI_API_KEY        → Grok 4.3 (xAI). Coaching + notifications.
 *   3. OPENAI_API_KEY     → GPT-4o-mini fallback.
 *   4. ANTHROPIC_API_KEY  → Claude Haiku last resort.
 *   5. none               → returns { ok: false, error: 'no_provider' }
 *
 * Exports:
 *   hasProvider()              → boolean
 *   providerName()             → 'gemini' | 'grok' | 'openai' | 'anthropic' | null
 *   chat({ system, messages, maxTokens, temperature, jsonMode, forceProvider })
 *                              → { ok, provider, model, text, usage } | { ok:false, error }
 *   chatJson({ ... })          → like chat but parses {...} out of text
 *   vision({ imageBase64, mimeType, prompt })
 *                              → { ok, provider, text } — uses Gemini Vision or falls back
 */

const https = require('https');

// ── PROVIDER DETECTION ──────────────────────────────────────────────────────

function providerName() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.XAI_API_KEY) return 'grok';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function hasProvider() {
  return providerName() !== null;
}

// ── MODEL NAMES ─────────────────────────────────────────────────────────────

function geminiModel() { return (process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash').trim(); }
function geminiVisionModel() { return (process.env.GEMINI_VISION_MODEL || 'gemini-2.5-pro').trim(); }
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

// ── GEMINI TEXT CHAT ───────────────────────────────────────────────────────

async function geminiChat({ system, messages, maxTokens, temperature, jsonMode }) {
  const model = geminiModel();
  const key = process.env.GEMINI_API_KEY;
  const contents = [];
  
  // Combine system prompt into first user message if present
  if (system) {
    contents.push({ role: 'user', parts: [{ text: system + '\n\n---\n\n' + (messages[0]?.content || '') }] });
    // Add remaining messages
    for (let i = 1; i < messages.length; i++) {
      const m = messages[i];
      const role = m.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: m.content }] });
    }
  } else {
    for (const m of messages) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: m.content }] });
    }
  }
  
  // If no messages after system merge, add a minimal one
  if (!contents.length || (contents.length === 1 && !contents[0].parts[0].text)) {
    contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
  }

  const body = JSON.stringify({
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens || 800,
      temperature: temperature || 0.7,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  });

  try {
    // Key goes in a header (not the URL path) so stray whitespace/newlines in
    // the env var can't trigger Node's "Request path contains unescaped characters".
    const { status, data } = await httpsPost(
      'generativelanguage.googleapis.com',
      `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': (key || '').trim() }, body
    );
    
    if (status !== 200) {
      return { ok: false, error: data?.error?.message || `gemini_${status}`, provider: 'gemini' };
    }
    
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return {
      ok: true,
      provider: 'gemini',
      model,
      text,
      usage: {
        promptTokens: data?.usageMetadata?.promptTokenCount,
        completionTokens: data?.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || 'gemini_error', provider: 'gemini' };
  }
}

// ── GEMINI VISION ──────────────────────────────────────────────────────────

async function geminiVision({ imageBase64, mimeType, prompt }) {
  const model = geminiVisionModel();
  const key = process.env.GEMINI_API_KEY;
  
  const body = JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        { text: prompt || 'Describe this image in detail.' },
        { inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } },
      ],
    }],
    generationConfig: { maxOutputTokens: 2000, temperature: 0.1 },
  });

  try {
    const { status, data } = await httpsPost(
      'generativelanguage.googleapis.com',
      `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': (key || '').trim() }, body
    );
    
    if (status !== 200) {
      return { ok: false, error: data?.error?.message || `gemini_vision_${status}`, provider: 'gemini' };
    }
    
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { ok: true, provider: 'gemini', model, text };
  } catch (err) {
    return { ok: false, error: err.message || 'gemini_vision_error', provider: 'gemini' };
  }
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
      return { ok: false, error: data?.error?.message || `grok_${status}`, provider: 'grok' };
    }
    
    const text = data?.choices?.[0]?.message?.content || '';
    return {
      ok: true,
      provider: 'grok',
      model,
      text,
      usage: {
        promptTokens: data?.usage?.prompt_tokens,
        completionTokens: data?.usage?.completion_tokens,
      },
    };
  } catch (err) {
    return { ok: false, error: err.message || 'grok_error', provider: 'grok' };
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
      return { ok: false, error: data?.error?.message || `anthropic_${status}`, provider: 'anthropic' };
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
    return { ok: false, error: err.message || 'anthropic_error', provider: 'anthropic' };
  }
}

// ── OPENAI CHAT ────────────────────────────────────────────────────────────

async function openaiChat({ system, messages, maxTokens, temperature, jsonMode }) {
  const client = getOpenAI();
  if (!client) return { ok: false, error: 'openai_sdk_unavailable', provider: 'openai' };
  
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
    return { ok: false, error: err.message || 'openai_error', provider: 'openai' };
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
 *   forceProvider?: 'gemini'|'grok'|'openai'|'anthropic'
 * }} opts
 */
function runProvider(name, args) {
  switch (name) {
    case 'gemini': return geminiChat(args);
    case 'grok':   return grokChat(args);
    case 'openai': return openaiChat(args);
    case 'anthropic': return anthropicChat(args);
    default: return Promise.resolve({ ok: false, error: `unknown_provider:${name}` });
  }
}

/** Configured providers in priority order. */
function availableProviders() {
  const list = [];
  if (process.env.GEMINI_API_KEY) list.push('gemini');
  if (process.env.XAI_API_KEY) list.push('grok');
  if (process.env.OPENAI_API_KEY) list.push('openai');
  if (process.env.ANTHROPIC_API_KEY) list.push('anthropic');
  return list;
}

async function chat(opts) {
  const { system, messages = [], maxTokens = 800, temperature = 0.7, jsonMode = false, forceProvider } = opts || {};
  
  // Normalize messages
  const normalized = messages
    .map(m => ({ role: m.role, content: String(m.content ?? '') }))
    .filter(m => m.content.length);

  const args = { system, messages: normalized, maxTokens, temperature, jsonMode };

  // If a provider is forced, use only that one.
  if (forceProvider) return runProvider(forceProvider, args);

  // Otherwise try each configured provider in order; cascade on failure so a
  // single misconfigured provider doesn't take the whole feature down.
  const chain = availableProviders();
  if (!chain.length) return { ok: false, error: 'no_provider' };

  let last = { ok: false, error: 'no_provider' };
  for (const name of chain) {
    last = await runProvider(name, args);
    if (last.ok && last.text && last.text.trim()) return last;
    console.warn(`[ai-client] provider ${name} failed: ${last.error || 'empty response'} — trying next`);
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
  const { imageBase64, mimeType, prompt } = opts || {};
  // Prefer Gemini Vision if available
  if (process.env.GEMINI_API_KEY) {
    return geminiVision({ imageBase64, mimeType, prompt });
  }
  // Fall back to a text-only estimate (no vision without Gemini or Claude)
  return { ok: false, error: 'no_vision_provider', provider: providerName() || 'none' };
}

module.exports = {
  hasProvider,
  providerName,
  geminiModel,
  geminiVisionModel,
  grokModel,
  openaiModel,
  anthropicModel,
  chat,
  chatJson,
  vision,
};
