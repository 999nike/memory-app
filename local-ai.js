(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const CHAT_PATH = '/api/chat';
  const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
  const FALLBACK_MODEL = 'onnx-community/SmolLM2-360M-Instruct-ONNX';
  const FALLBACK_DTYPE = 'q4f16';
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
      if (globalThis.LanguageModel) return await runChromeNative(body);
      if (navigator.gpu) return await runTransformersFallback(body);

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
    const userText = String(body.message || '').trim();

    // Do not wake a few-hundred-MB model just to answer a greeting.
    if (isGreeting(userText)) {
      setProviderStatus('Mobile AI · ready', 'local');
      return jsonResponse(200, {
        reply: 'Hi. I’m here in this Memory Space. What do you want to work on?',
        usedMemoryTitles: [],
        proposals: [],
        model: 'local/greeting-fast-path',
        local: true
      });
    }

    setProviderStatus('Mobile AI · loading', 'busy');
    const generator = await getFallbackGenerator();
    setProviderStatus('Mobile AI · thinking', 'busy');

    const context = compactContext(body.context || '');
    const history = compactHistory(body.history || []);
    const messages = [
      {
        role: 'system',
        content: [
          'You are the assistant inside a private user-owned memory workspace.',
          'Answer the user directly and naturally.',
          'Use relevant workspace context when it helps.',
          'Be concise unless the user asks for detail.',
          'Never output template labels, dataset markers, placeholder text, or meta-instructions.',
          'Do not claim that memory was permanently saved; the user approves memory separately.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          context ? `Workspace memory:\n${context}` : '',
          history ? `Recent chat:\n${history}` : '',
          `Current user message:\n${userText}`
        ].filter(Boolean).join('\n\n')
      }
    ];

    const output = await generator(messages, {
      max_new_tokens: 120,
      do_sample: true,
      temperature: 0.65,
      top_p: 0.9,
      top_k: 40,
      repetition_penalty: 1.14,
      no_repeat_ngram_size: 4,
      return_full_text: false
    });

    let reply = cleanReply(extractGeneratedText(output));

    if (!reply || looksDegenerate(reply)) {
      console.warn('Blocked unusable local model output:', reply);
      const retry = await generator([
        { role: 'system', content: 'Answer plainly in one short sentence. Output only the answer.' },
        { role: 'user', content: userText }
      ], {
        max_new_tokens: 56,
        do_sample: false,
        repetition_penalty: 1.18,
        no_repeat_ngram_size: 4,
        return_full_text: false
      });
      reply = cleanReply(extractGeneratedText(retry));
    }

    if (!reply || looksDegenerate(reply)) {
      reply = 'The local model produced an unusable reply, so I blocked it instead of showing template garbage. Try rephrasing that message.';
    }

    setProviderStatus('Mobile AI · on-device', 'local');

    return jsonResponse(200, {
      reply,
      usedMemoryTitles: findUsedMemoryTitles(body.context || '', reply),
      proposals: buildObviousProposal(userText),
      model: `${FALLBACK_MODEL}/${FALLBACK_DTYPE}-webgpu`,
      local: true
    });
  }

  async function getFallbackGenerator() {
    if (fallbackGeneratorPromise) return fallbackGeneratorPromise;

    fallbackGeneratorPromise = (async () => {
      setProviderStatus('Loading mobile AI…', 'busy');
      const { pipeline, env } = await import(TRANSFORMERS_URL);
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      return pipeline('text-generation', FALLBACK_MODEL, {
        dtype: FALLBACK_DTYPE,
        device: 'webgpu',
        progress_callback(progress) {
          if (!progress) return;
          if (progress.status === 'progress' && Number.isFinite(progress.progress)) {
            setProviderStatus(`Downloading mobile AI ${Math.round(progress.progress)}%`, 'busy');
          } else if (progress.status === 'ready') {
            setProviderStatus('Mobile AI · on-device', 'local');
          } else if (progress.file) {
            setProviderStatus('Downloading mobile AI…', 'busy');
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
      'You are the AI collaborator inside a private user-owned Memory Space.',
      'Confirmed memory is trusted context and locked memory is an explicit user constraint.',
      'You cannot permanently save memory yourself.',
      'Only propose durable memory when it is likely to matter later; zero proposals is normal.',
      'Never claim a proposal is saved before user approval.',
      'Answer naturally and directly.'
    ].join(' ');
  }

  function buildPrompt(body) {
    const history = Array.isArray(body.history)
      ? body.history.slice(-4).map((item) => `${String(item.role || '').toUpperCase()}: ${String(item.content || '').slice(0, 700)}`).join('\n\n')
      : '';

    return [
      `CURRENT SPACE: ${String(body.space?.name || 'Memory Space')}`,
      body.space?.description ? `PURPOSE: ${String(body.space.description).slice(0, 500)}` : '',
      '',
      String(body.context || '').slice(0, 4500),
      '',
      history ? `RECENT CHAT:\n${history}` : 'RECENT CHAT: none',
      '',
      `USER MESSAGE:\n${String(body.message || '').slice(0, 1600)}`,
      '',
      'For a greeting, just greet the user and propose no memory.'
    ].filter(Boolean).join('\n');
  }

  function compactContext(value) {
    const text = String(value || '');
    const lines = text.split('\n').filter((line) => line.trim());
    const useful = lines
      .filter((line) => !/^Source:/i.test(line.trim()))
      .filter((line) => !/^MEMORY RULE:/i.test(line.trim()))
      .slice(0, 18);
    return useful.join('\n').slice(0, 2200);
  }

  function compactHistory(history) {
    if (!Array.isArray(history)) return '';
    return history
      .filter((item) => !looksDegenerate(String(item?.content || '')))
      .slice(-4)
      .map((item) => {
        const role = item?.role === 'assistant' ? 'AI' : 'User';
        return `${role}: ${String(item?.content || '').slice(0, 320)}`;
      })
      .join('\n')
      .slice(0, 1200);
  }

  function buildObviousProposal(text) {
    const value = String(text || '').trim();
    if (!value || value.length < 8) return [];

    const lower = value.toLowerCase();
    const explicitMemory = /\b(remember|save this|keep this|important to remember|don['’]?t forget)\b/.test(lower);
    const decision = /\b(i decided|we decided|decision is|must always|must never)\b/.test(lower);
    const goal = /\b(my goal is|our goal is|the goal is|i want to build|we want to build)\b/.test(lower);
    const personalFact = /\b(my favourite|my favorite|i prefer|i always use|my number is)\b/.test(lower);

    if (!(explicitMemory || decision || goal || personalFact)) return [];

    const type = decision ? 'decision' : goal ? 'goal' : 'fact';
    const importance = explicitMemory || decision ? 'high' : 'normal';
    const title = type === 'decision' ? 'User decision' : type === 'goal' ? 'User goal' : 'User fact';

    return [{
      title,
      content: value.slice(0, 900),
      type,
      importance,
      reason: 'The user phrased this as durable information. Review it before saving.'
    }];
  }

  function isGreeting(text) {
    return /^(hi|hello|hey|hiya|yo|good (morning|afternoon|evening))[.! ]*$/i.test(String(text || '').trim());
  }

  function cleanReply(text) {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^\s*(assistant|ai)\s*:\s*/i, '')
      .replace(/\[(replies?|response|assistant|contented|content)\]/gi, '')
      .replace(/<\|(?:im_start|im_end|endoftext)\|>/g, '')
      .replace(/\s{3,}/g, ' ')
      .trim()
      .slice(0, 1800);
  }

  function looksDegenerate(text) {
    const value = String(text || '').trim();
    if (!value) return true;

    if (/\[(replies?|response|contented|content|assistant)\]/i.test(value)) return true;
    if (/\b(format constraints?|enumeration format|continue your response|specific content style|responding briefly after)\b/i.test(value)) return true;
    if ((value.match(/\[/g) || []).length >= 3) return true;

    const words = value.toLowerCase().match(/[a-z0-9']+/g) || [];
    if (words.length < 2) return false;

    const counts = new Map();
    for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
    const maxWordRatio = Math.max(...counts.values()) / words.length;
    if (words.length >= 8 && maxWordRatio > 0.32) return true;

    const trigrams = [];
    for (let index = 0; index <= words.length - 3; index += 1) {
      trigrams.push(words.slice(index, index + 3).join(' '));
    }
    if (trigrams.length >= 4 && new Set(trigrams).size / trigrams.length < 0.62) return true;

    return false;
  }

  function findUsedMemoryTitles(context, reply) {
    const result = [];
    const replyWords = new Set((String(reply || '').toLowerCase().match(/[a-z0-9']{4,}/g) || []));
    const titlePattern = /^- \[[^\]]+\] \[[^\]]+\] (.+)$/gm;
    let match;
    while ((match = titlePattern.exec(String(context || ''))) && result.length < 6) {
      const title = match[1].trim();
      const titleWords = (title.toLowerCase().match(/[a-z0-9']{4,}/g) || []);
      if (titleWords.some((word) => replyWords.has(word))) result.push(title);
    }
    return result;
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

  function validateOutput(value) {
    const proposals = Array.isArray(value?.proposals) ? value.proposals.slice(0, 3) : [];
    return {
      reply: String(value?.reply || 'I could not produce a reply.').slice(0, 4000),
      usedMemoryTitles: Array.isArray(value?.usedMemoryTitles) ? value.usedMemoryTitles.slice(0, 8).map(String) : [],
      proposals: proposals.map((proposal) => ({
        title: String(proposal?.title || 'Proposed memory').slice(0, 100),
        content: String(proposal?.content || '').slice(0, 900),
        type: ['decision', 'fact', 'goal', 'question', 'note'].includes(proposal?.type) ? proposal.type : 'note',
        importance: ['critical', 'high', 'normal', 'low'].includes(proposal?.importance) ? proposal.importance : 'normal',
        reason: String(proposal?.reason || 'The AI considered this useful future context.').slice(0, 220)
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
        else if (navigator.gpu) setProviderStatus('Mobile AI · ready', 'local');
        else setProviderStatus('Local AI unavailable', 'error');
        return;
      } catch {}
    }

    if (navigator.gpu) setProviderStatus('Mobile AI · ready', 'local');
    else setProviderStatus('Local AI unavailable', 'error');
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
