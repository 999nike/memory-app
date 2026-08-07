(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const CHAT_PATH = '/api/chat';

  const responseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'usedMemoryTitles', 'proposals'],
    properties: {
      reply: { type: 'string' },
      usedMemoryTitles: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string' }
      },
      proposals: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          additionalProperties: false,
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

    const LanguageModelApi = globalThis.LanguageModel;
    if (!LanguageModelApi) {
      setProviderStatus('Local AI unavailable', 'error');
      return jsonResponse(503, {
        error: 'Chrome on-device AI is not available on this browser or device. No workspace data was sent to a cloud model.'
      });
    }

    try {
      const availability = await LanguageModelApi.availability();
      if (availability === 'unavailable') {
        setProviderStatus('Local AI unavailable', 'error');
        return jsonResponse(503, {
          error: 'This device does not currently meet Chrome’s on-device AI requirements. No workspace data was sent to a cloud model.'
        });
      }

      if (availability === 'downloadable') setProviderStatus('Downloading local AI…', 'busy');
      if (availability === 'downloading') setProviderStatus('Downloading local AI…', 'busy');
      if (availability === 'available') setProviderStatus('On-device', 'local');

      const session = await LanguageModelApi.create({
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            const percent = Math.max(0, Math.min(100, Math.round(Number(event.loaded || 0) * 100)));
            setProviderStatus(`Downloading ${percent}%`, 'busy');
          });
        },
        initialPrompts: [
          {
            role: 'system',
            content: [
              'You are the AI collaborator inside a private, user-owned Memory Space.',
              'Confirmed memory is trusted context. Locked memory is an explicit user constraint.',
              'You cannot permanently save, edit, delete, or lock memory yourself.',
              'You may only PROPOSE durable memory; the user must approve it in the interface.',
              'Only propose something when the user has stated a durable fact, decision, goal, open question, or note likely to matter in a future session.',
              'Do not propose trivial chat, guesses about the user, temporary wording, or information already present in confirmed memory.',
              'Zero proposals is normal.',
              'usedMemoryTitles must contain only exact titles from confirmed memory that materially affected the answer.',
              'Answer naturally and directly.'
            ].join(' ')
          }
        ]
      });

      setProviderStatus('On-device', 'local');

      const prompt = buildPrompt(body);
      const raw = await session.prompt(prompt, {
        responseConstraint: responseSchema,
        omitResponseConstraintInput: true
      });

      session.destroy?.();

      const output = JSON.parse(raw);
      const cleaned = validateOutput(output);
      return jsonResponse(200, {
        ...cleaned,
        model: 'chrome/gemini-nano',
        local: true
      });
    } catch (error) {
      console.error('Local AI request failed:', error);
      setProviderStatus('Local AI error', 'error');
      return jsonResponse(503, {
        error: `Local AI could not answer: ${error?.message || 'unknown error'}. No workspace data was sent to a cloud model.`
      });
    }
  };

  async function probeLocalAI() {
    const LanguageModelApi = globalThis.LanguageModel;
    if (!LanguageModelApi) {
      setProviderStatus('Local AI unavailable', 'error');
      return;
    }

    try {
      const availability = await LanguageModelApi.availability();
      if (availability === 'available') setProviderStatus('On-device', 'local');
      else if (availability === 'downloadable') setProviderStatus('Local AI ready', 'local');
      else if (availability === 'downloading') setProviderStatus('Downloading local AI…', 'busy');
      else setProviderStatus('Local AI unavailable', 'error');
    } catch {
      setProviderStatus('Local AI unavailable', 'error');
    }
  }

  function buildPrompt(body) {
    const history = Array.isArray(body.history)
      ? body.history.slice(-8).map((item) => `${String(item.role || '').toUpperCase()}: ${String(item.content || '').slice(0, 2500)}`).join('\n\n')
      : '';

    return [
      `CURRENT SPACE: ${String(body.space?.name || 'Memory Space')}`,
      body.space?.description ? `SPACE PURPOSE: ${String(body.space.description)}` : '',
      '',
      String(body.context || '').slice(0, 24000),
      '',
      history ? `RECENT CHAT:\n${history}` : 'RECENT CHAT: none',
      '',
      `USER MESSAGE:\n${String(body.message || '').slice(0, 5000)}`,
      '',
      'Return a JSON object matching the required schema. The reply field is the answer to the user. Proposals are only suggestions for user approval.'
    ].filter(Boolean).join('\n');
  }

  function validateOutput(value) {
    const proposals = Array.isArray(value?.proposals) ? value.proposals.slice(0, 3) : [];
    return {
      reply: String(value?.reply || 'I could not produce a reply.'),
      usedMemoryTitles: Array.isArray(value?.usedMemoryTitles)
        ? value.usedMemoryTitles.slice(0, 8).map(String)
        : [],
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

  function setProviderStatus(label, mode) {
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
    setTimeout(apply, 50);
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
    document.addEventListener('DOMContentLoaded', () => setTimeout(probeLocalAI, 80), { once: true });
  } else {
    setTimeout(probeLocalAI, 80);
  }
})();
