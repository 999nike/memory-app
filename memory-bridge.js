(() => {
  'use strict';

  const PROTOCOL = 'memory-space-bridge';
  const VERSION = 1;

  function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function assertSecureBridgeUrl(baseUrl) {
    const parsed = new URL(baseUrl, location.href);
    if (location.protocol === 'https:' && parsed.protocol !== 'https:') {
      throw new Error('This HTTPS app requires an HTTPS Memory Bridge URL.');
    }
    return parsed.href.replace(/\/+$/, '');
  }

  function bridgeHeaders(token) {
    return {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Memory-Bridge-Protocol': `${PROTOCOL}/${VERSION}`,
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
  }

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || `Memory Bridge returned HTTP ${response.status}`);
    }
    return data;
  }

  async function testBridge(config) {
    const transport = globalThis.MemoryAI?.transportFetch || window.fetch.bind(window);
    const baseUrl = assertSecureBridgeUrl(normalizeBaseUrl(config?.baseUrl));
    const response = await transport(`${baseUrl}/v1/info`, {
      method: 'GET',
      headers: bridgeHeaders(config?.token),
      cache: 'no-store'
    });
    const data = await readJson(response);
    if (data?.protocol !== PROTOCOL || Number(data?.version) !== VERSION) {
      throw new Error('The server answered, but it is not a compatible Memory Bridge.');
    }
    return data;
  }

  function registerBridge(config) {
    const memoryAI = globalThis.MemoryAI;
    if (!memoryAI) throw new Error('MemoryAI provider registry is not ready');

    const id = String(config?.id || '').trim();
    const name = String(config?.name || 'Memory Bridge').trim();
    const baseUrl = assertSecureBridgeUrl(normalizeBaseUrl(config?.baseUrl));
    const token = String(config?.token || '');
    if (!id || !baseUrl) throw new Error('Bridge id and URL are required');

    return memoryAI.registerProvider({
      id,
      name,
      kind: 'memory-bridge',
      local: true,
      capabilities: {
        chat: true,
        memoryContext: true,
        remoteLocalInference: true,
        protocolVersion: VERSION
      },
      async generate(request) {
        const transport = memoryAI.transportFetch || window.fetch.bind(window);
        const response = await transport(`${baseUrl}/v1/chat`, {
          method: 'POST',
          headers: bridgeHeaders(token),
          cache: 'no-store',
          body: JSON.stringify({
            protocol: PROTOCOL,
            version: VERSION,
            requestId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            message: String(request?.message || ''),
            context: String(request?.context || ''),
            history: Array.isArray(request?.history)
              ? request.history.slice(-10).map((item) => ({
                  role: String(item?.role || ''),
                  content: String(item?.content || '')
                }))
              : [],
            memoryPolicy: request?.memoryPolicy || {
              currentOnly: true,
              approvalRequired: true
            }
          })
        });

        const data = await readJson(response);
        if (!data?.reply) throw new Error('Memory Bridge returned no reply');
        return {
          reply: String(data.reply),
          usedMemoryTitles: Array.isArray(data.usedMemoryTitles) ? data.usedMemoryTitles : [],
          proposals: [],
          model: data.model || data?.bridge?.model || 'bridge-model',
          local: true
        };
      }
    });
  }

  globalThis.MemoryBridge = Object.freeze({
    protocol: PROTOCOL,
    version: VERSION,
    registerBridge,
    testBridge
  });
})();
