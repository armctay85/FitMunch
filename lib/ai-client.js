'use strict';
/**
 * FitMunch AI client — one interface, pluggable providers.
 *
 * Provider selection (highest priority first):
 *   1. OPENAI_API_KEY   → OpenAI (your ChatGPT account's API key). Default model: gpt-4o-mini.
 *   2. ANTHROPIC_API_KEY → Claude Haiku fallback.
 *   3. none             → returns { ok: false, reason: 'no_provider' } and the route should fall back.
 *
 * Exports:
 *   hasProvider()              → boolean
 *   providerName()             → 'openai' | 'anthropic' | null
 *   chat({ system, messages, maxTokens, temperature, jsonMode })
 *                              → { ok, provider, model, text, usage } | { ok:false, error }
 *   chatJson({ system, messages, ... }) → like chat but parses {...} out of text
 *
 * No streaming yet — routes respond with a single JSON blob so the browser can keep simple fetch().
 */

const https = require('https');

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const OpenAI = require('openai');
    _openai = new OpenAI.default ? new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY })
                                 : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return _openai;
  } catch (e) {
    console.error('[ai-client] openai sdk load failed:', e.message);
    return null;
  }
}

function openaiModel() {
  return (process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini').trim();
}

function anthropicModel() {
  return (process.env.ANTHROPIC_CHAT_MODEL || 'claude-haiku-4-5').trim();
}

function providerName() {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function hasProvider() {
  return providerName() !== null;
}

/** @typedef {{ role: 'system'|'user'|'assistant', content: string }} ChatMsg */

/**
 * @param {{ system?: string, messages: ChatMsg[], maxTokens?: number, temperature?: number, jsonMode?: boolean }} opts
 */
async function chat(opts) {
  const { system, messages = [], maxTokens = 800, temperature = 0.7, jsonMode = false } = opts || {};
  const provider = providerName();
  if (!provider) return { ok: false, error: 'no_provider' };

  const normalized = messages
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
      content: String(m.content ?? ''),
    }))
    .filter((m) => m.content.length);

  if (provider === 'openai') {
    const client = getOpenAI();
    if (!client) return { ok: false, error: 'openai_sdk_unavailable' };
    const payload = {
      model: openaiModel(),
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...normalized.filter((m) => m.role !== 'system'),
      ],
      max_tokens: maxTokens,
      temperature,
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

  // Anthropic fallback (raw HTTPS, no SDK dep).
  const anthroSystem = system || undefined;
  const anthroMessages = normalized
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));
  const body = JSON.stringify({
    model: anthropicModel(),
    max_tokens: maxTokens,
    temperature,
    ...(anthroSystem ? { system: anthroSystem } : {}),
    messages: anthroMessages,
  });
  return await new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const r = JSON.parse(data);
            if (r.error) return resolve({ ok: false, error: r.error.message, provider: 'anthropic' });
            const text = r?.content?.[0]?.text || '';
            resolve({
              ok: true,
              provider: 'anthropic',
              model: anthropicModel(),
              text,
              usage: {
                promptTokens: r?.usage?.input_tokens,
                completionTokens: r?.usage?.output_tokens,
              },
            });
          } catch (e) {
            resolve({ ok: false, error: 'anthropic_parse_error', provider: 'anthropic' });
          }
        });
      }
    );
    req.on('error', (err) => resolve({ ok: false, error: err.message || 'anthropic_request_error', provider: 'anthropic' }));
    req.write(body);
    req.end();
  });
}

/** Like chat, but attempts to extract and parse a single JSON object from the response. */
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

module.exports = {
  hasProvider,
  providerName,
  openaiModel,
  anthropicModel,
  chat,
  chatJson,
};
