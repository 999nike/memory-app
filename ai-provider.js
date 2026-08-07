(() => {
  'use strict';

  const ACTIVE_PROVIDER_KEY = 'memory-ai-provider-v1';
  const CHAT_PATH = '/api/chat';
  const transportFetch = window.fetch.bind(window);
  const providers = new Map();

  function registerProvider(provider) {
    if (!provider || typeof provider.id !== 'string' || typeof provider.name !== 'string' || typeof provider.generate !== 'function') {
      throw new Error('Invalid Memory AI provider');
    }
    providers.set(provider.id, {
      kind: 'custom',
      local: false,
      capabilities: {},
      ...provider
    });
    dispatchEvent(new CustomEvent('memory-ai-providers-changed'));
    mountProviderSelector();
    return provider.id;
  }

  function getActiveProviderId() {
    const saved = localStorage.getItem(ACTIVE_PROVIDER_KEY);
    if (saved && providers.has(saved)) return saved;
    return providers.keys().next().value || null;
  }

  function getActiveProvider() {
    const id = getActiveProviderId();
    return id ? providers.get(id) || null : null;
  }

  function setActiveProvider(id) {
    if (!providers.has(id)) throw new Error(`Unknown AI provider: ${id}`);
    localStorage.setItem(ACTIVE_PROVIDER_KEY, id);
    dispatchEvent(new CustomEvent('memory-ai-provider-changed', { detail: { id } }));
    mountProviderSelector();
  }

  async function generate(request) {
    const provider = getActiveProvider();
    if (!provider) throw new Error('No AI provider is registered');
    const result = await provider.generate(request);
    return normalizeResult(result, provider);
  }

  function normalizeResult(result, provider) {
    const value = result && typeof result === 'object' ? result : {};
    return {
      reply: String(value.reply || 'I could not produce a reply.'),
      usedMemoryTitles: Array.isArray(value.usedMemoryTitles) ? value.usedMemoryTitles.map(String).slice(0, 12) : [],
      proposals: Array.isArray(value.proposals) ? value.proposals.slice(0, 5) : [],
      model: value.model || provider.id,
      provider: provider.id,
      local: value.local ?? Boolean(provider.local)
    };
  }

  function listProviders() {
    return [...providers.values()].map((provider) => ({
      id: provider.id,
      name: provider.name,
      kind: provider.kind,
      local: Boolean(provider.local),
      capabilities: { ...provider.capabilities }
    }));
  }

  function registerOpenAICompatible(config) {
    const id = String(config?.id || '').trim();
    const name = String(config?.name || id || 'OpenAI-compatible model').trim();
    const endpoint = String(config?.endpoint || '').trim();
    const model = String(config?.model || '').trim();
    if (!id || !endpoint || !model) throw new Error('id, endpoint, and model are required');

    return registerProvider({
      id,
      name,
      kind: 'openai-compatible',
      local: Boolean(config.local),
      capabilities: { chat: true, memoryContext: true },
      async generate(request) {
        const messages = [
          {
            role: 'system',
            content: 'You are an AI collaborator inside a user-owned Memory Space. Treat confirmed current memory as trusted context. Do not claim memory was saved unless the user approved it.'
          },
          {
            role: 'user',
            content: [
              request.context ? `MEMORY SPACE CONTEXT:\n${request.context}` : '',
              Array.isArray(request.history) && request.history.length
                ? `RECENT CHAT:\n${request.history.slice(-8).map((item) => `${String(item.role || '').toUpperCase()}: ${String(item.content || '')}`).join('\n')}`
                : '',
              `USER MESSAGE:\n${String(request.message || '')}`
            ].filter(Boolean).join('\n\n')
          }
        ];

        const response = await transportFetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.headers || {})
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: config.temperature ?? 0.6,
            stream: false
          })
        });

        if (!response.ok) throw new Error(`${name} returned ${response.status}`);
        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content;
        if (!reply) throw new Error(`${name} returned no message`);
        return { reply, usedMemoryTitles: [], proposals: [], model, local: Boolean(config.local) };
      }
    });
  }

  registerProvider({
    id: 'browser-local',
    name: 'On-device browser',
    kind: 'browser-local',
    local: true,
    capabilities: {
      chat: true,
      memoryContext: true,
      memoryProposals: true,
      offlineAfterDownload: true
    },
    async generate(request) {
      const response = await transportFetch(CHAT_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Memory-Provider-Internal': 'browser-local'
        },
        body: JSON.stringify(request)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Local provider failed (${response.status})`);
      return data;
    }
  });

  window.fetch = async function memoryProviderRouterFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
    const internal = new Headers(init.headers || (typeof input !== 'string' ? input?.headers : undefined)).has('X-Memory-Provider-Internal');

    if (!isChatRequest(url, method) || internal) return transportFetch(input, init);

    let body;
    try {
      body = JSON.parse(init.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'The AI provider request could not be read.' });
    }

    try {
      const result = await generate(body);
      return jsonResponse(200, result);
    } catch (error) {
      console.error('AI provider failed:', error);
      return jsonResponse(503, {
        error: error?.message || 'The selected AI provider could not answer.'
      });
    }
  };

  globalThis.MemoryAI = Object.freeze({
    contractVersion: 1,
    registerProvider,
    registerOpenAICompatible,
    setActiveProvider,
    getActiveProvider,
    getActiveProviderId,
    listProviders,
    generate,
    transportFetch
  });

  function mountProviderSelector() {
    const header = document.querySelector('#phase2ChatPanel .ai-panel-header');
    if (!header) return;

    let control = header.querySelector('.ai-provider-control');
    if (!control) {
      control = document.createElement('div');
      control.className = 'ai-provider-control';
      control.innerHTML = '<label for="aiProviderSelect">Provider</label><select class="ai-provider-select" id="aiProviderSelect" aria-label="AI provider"></select>';
      header.appendChild(control);
      control.querySelector('select')?.addEventListener('change', (event) => {
        try {
          setActiveProvider(event.target.value);
        } catch (error) {
          console.error(error);
        }
      });
    }

    const select = control.querySelector('select');
    if (!select) return;
    const active = getActiveProviderId();
    select.innerHTML = listProviders().map((provider) =>
      `<option value="${escapeHtml(provider.id)}" ${provider.id === active ? 'selected' : ''}>${escapeHtml(provider.name)}</option>`
    ).join('');
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

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  const mountObserver = new MutationObserver(mountProviderSelector);
  mountObserver.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountProviderSelector, { once: true });
  } else {
    mountProviderSelector();
  }
})();
