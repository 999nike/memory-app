(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const CHAT_PATH = '/api/chat';
  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  const FALLBACK_MODEL = 'onnx-community/Qwen2.5-0.5B-Instruct';
  let fallbackGeneratorPromise = null;

  const responseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'usedMemoryTitles', 'proposals'],
    properties: {
      reply: { type: 'string' },
      usedMemoryTitles: { type: 'array', maxItems: 8, items: { type: 'string' } },
      proposals: {
        type: 'array', maxItems: 3,
        items: {
          type: 'object', additionalProperties: false,
          required: ['title', 'content', 'type', 'importance', 'reason'],
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            type: { type: 'string', enum: ['decision', 'fact', 'goal', 'question', 'note'] },
            importance: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
            reason: { type: 'string' }
          }
        }
      }
    }
  };

  window.fetch = async function memoryLocalFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
    if (!isChatRequest(url, method)) return nativeFetch(input, init);

    let body;
    try {
      body = JSON.parse(init.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'The local AI request could not be read.' });
    }

    try {
      if (globalThis.LanguageModel) {
        return await runChromeNative(body);
      }

      if (navigator.gpu) {
        return await runTransformersFallback(body);
      }

      setProviderStatus('No local AI engine', 'error');
      return jsonResponse(503, {
        error: 'This browser exposes neither Chrome on-device AI nor WebGPU. No workspace data was sent to a cloud model.'
      });
    } catch (error) {
      console.error('Local AI request failed:', error);
      setProviderStatus('Local AI error', 'error');
      return jsonResponse(503, {
        error: `Local AI could not answer: ${error?.message || 'unknown error'}. No workspace data was sent to a cloud model.`
      });
    }
  };

  async function runChromeNative(body) {
    const LanguageModelApi = globalThis.LanguageModel;
    const availability = await LanguageModelApi.availability();
    if (availability === 'unavailable') throw new Error('Chrome local model is unavailable on this device');

    if (availability === 'downloadable' || availability === 'downloading') {
      setProviderStatus('Downloading Chrome AI…', 'busy');
    } else {
      setProviderStatus('Chrome AI · on-device', 'local');
    }

    const session = await LanguageModelApi.create({
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          const percent = Math.max(0, Math.min(100, Math.round(Number(event.loaded || 0) * 100)));
          setProviderStatus(`Downloading Chrome AI ${percent}%`, 'busy');
        });
      },
      initialPrompts: [{ role: 'system', content: systemInstruction() }]
    });

    const raw = await session.prompt(buildPrompt(body), {
      responseConstraint: responseSchema,
      omitResponseConstraintInput: true
    });
    session.destroy?.();

    return jsonResponse(200, {
      ...validateOutput(JSON.parse(raw)),
      model: 'chrome/gemini-nano',
      local: true
    });
  }

  async function runTransformersFallback(body) {
    setProviderStatus('Browser AI · loading', 'busy');
    const generator = await getFallbackGenerator();
    setProviderStatus('Browser AI · on-device', 'local');

    const messages = [
      { role: 'system', content: systemInstruction() },
      { role: 'user', content: `${buildPrompt(body)}\n\nReturn ONLY one valid JSON object with keys reply, usedMemoryTitles, proposals. No markdown fences.` }
    ];

    const output = await generator(messages, {
      max_new_tokens: 420,
      do_sample: false,
      repetition_penalty: 1.05,
      return_full_text: false
    });

    const text = extractGeneratedText(output);
    let parsed;
    try {
      parsed = parseJsonObject(text);
    } catch {
      parsed = { reply: text || 'I could not produce a reply.', usedMemoryTitles: [], proposals: [] };
    }

    return jsonResponse(200, {
      ...validateOutput(parsed),
      model: `${FALLBACK_MODEL}/q4-webgpu`,
      local: true
    });
  }

  async function getFallbackGenerator() {
    if (fallbackGeneratorPromise) return fallbackGeneratorPromise;

    fallbackGeneratorPromise = (async () => {
      setProviderStatus('Loading browser AI library…', 'busy');
      const { pipeline, env } = await import(TRANSFORMERS_URL);
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      return pipeline('text-generation', FALLBACK_MODEL, {
        dtype: 'q4',
        device: 'webgpu',
        progress_callback(progress) {
          if (!progress) return;
          if (progress.status === 'progress' && Number.isFinite(progress.progress)) {
            setProviderStatus(`Downloading browser AI ${Math.round(progress.progress)}%`, 'busy');
          } else if (progress.status === 'ready') {
            setProviderStatus('Browser AI · on-device', 'local');
          } else if (progress.file) {
            setProviderStatus('Downloading browser AI…', 'busy');
          }
        }
      });
    })().catch((error) => {
      fallbackGeneratorPromise = null;
      throw error;
    });

    return fallbackGeneratorPromise;
  }

  function systemInstruction() {
    return [
      'You are the AI collaborator inside a private, user-owned Memory Space.',
      'Confirmed memory is trusted context. Locked memory is an explicit user constraint.',
      'You cannot permanently save, edit, delete, or lock memory yourself.',
      'You may only propose durable memory; the user must approve it in the interface.',
      'Only propose something when the user states a durable fact, decision, goal, open question, or note likely to matter later.',
      'Do not propose trivial chat, guesses, temporary wording, or information already present in confirmed memory.',
      'Zero proposals is normal.',
      'usedMemoryTitles must contain only exact titles from confirmed memory that materially affected the answer.',
      'Answer naturally and directly.'
    ].join(' ');
  }

  function buildPrompt(body) {
    const history = Array.isArray(body.history)
      ? body.history.slice(-8).map((item) => `${String(item.role || '').toUpperCase()}: ${String(item.content || '').slice(0, 1800)}`).join('\n\n')
      : '';

    return [
      `CURRENT SPACE: ${String(body.space?.name || 'Memory Space')}`,
      body.space?.description ? `SPACE PURPOSE: ${String(body.space.description)}` : '',
      '',
      String(body.context || '').slice(0, 12000),
      '',
      history ? `RECENT CHAT:\n${history}` : 'RECENT CHAT: none',
      '',
      `USER MESSAGE:\n${String(body.message || '').slice(0, 3500)}`,
      '',
      'If the user merely greets you, reply normally and propose no memory.'
    ].filter(Boolean).join('\n');
  }

  function extractGeneratedText(output) {
    const value = output?.[0]?.generated_text;
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) {
      const last = [...value].reverse().find((item) => item?.role === 'assistant') || value[value.length - 1];
      return String(last?.content || '').trim();
    }
    return String(value || '').trim();
  }

  function parseJsonObject(text) {
    const cleaned = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try { return JSON.parse(cleaned); } catch {}
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('Model did not return JSON');
  }

  function validateOutput(value) {
    const proposals = Array.isArray(value?.proposals) ? value.proposals.slice(0, 3) : [];
    return {
      reply: String(value?.reply || 'I could not produce a reply.').slice(0, 6000),
      usedMemoryTitles: Array.isArray(value?.usedMemoryTitles) ? value.usedMemoryTitles.slice(0, 8).map(String) : [],
      proposals: proposals.map((proposal) => ({
        title: String(proposal?.title || 'Proposed memory').slice(0, 100),
        content: String(proposal?.content || '').slice(0, 1200),
        type: ['decision', 'fact', 'goal', 'question', 'note'].includes(proposal?.type) ? proposal.type : 'note',
        importance: ['critical', 'high', 'normal', 'low'].includes(proposal?.importance) ? proposal.importance : 'normal',
        reason: String(proposal?.reason || 'The AI considered this useful future context.').slice(0, 240)
      })).filter((proposal) => proposal.content)
    };
  }

  function isChatRequest(url, method) {
    if (method !== 'POST' || !url) return false;
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname === CHAT_PATH;
    } catch {
      return url === CHAT_PATH;
    }
  }

  function jsonResponse(status, value) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  async function probeLocalAI() {
    if (globalThis.LanguageModel) {
      try {
        const availability = await globalThis.LanguageModel.availability();
        if (availability === 'available') setProviderStatus('Chrome AI · on-device', 'local');
        else if (availability === 'downloadable') setProviderStatus('Chrome AI · ready to download', 'local');
        else if (availability === 'downloading') setProviderStatus('Downloading Chrome AI…', 'busy');
        else if (navigator.gpu) setProviderStatus('Browser AI · ready', 'local');
        else setProviderStatus('Local AI unavailable', 'error');
        return;
      } catch {}
    }

    if (navigator.gpu) {
      setProviderStatus('Browser AI · ready', 'local');
    } else {
      setProviderStatus('Local AI unavailable', 'error');
    }
  }

  function setProviderStatus(label, mode) {
    globalThis.__memoryAIStatus = { label, mode };
    const apply = () => {
      const status = document.getElementById('aiStatus');
      if (!status) return false;
      status.classList.toggle('busy', mode === 'busy');
      status.classList.toggle('local-provider', mode === 'local');
      status.classList.toggle('provider-error', mode === 'error');
      status.innerHTML = `<span></span> ${escapeHtml(label)}`;
      return true;
    };
    if (apply()) return;
    setTimeout(apply, 80);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(probeLocalAI, 120), { once: true });
  } else {
    setTimeout(probeLocalAI, 120);
  }
})();
