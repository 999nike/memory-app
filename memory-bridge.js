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

  function scopedBaseUrl(config) {
    const baseUrl = assertSecureBridgeUrl(normalizeBaseUrl(config?.baseUrl));
    const connectionId = String(config?.connectionId || '').trim();
    if (!connectionId) return baseUrl;

    const parsed = new URL(baseUrl);
    parsed.pathname = `/c/${encodeURIComponent(connectionId)}`;
    parsed.search = '';
    parsed.hash = '';
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

  async function request(config, path, options = {}) {
    const transport = globalThis.MemoryAI?.transportFetch || window.fetch.bind(window);
    const baseUrl = scopedBaseUrl(config);
    const response = await transport(`${baseUrl}${path}`, {
      cache: 'no-store',
      ...options,
      headers: {
        ...bridgeHeaders(config?.token),
        ...(options.headers || {})
      }
    });
    return readJson(response);
  }

  async function testBridge(config) {
    const data = await request(config, '/v1/info', { method: 'GET' });
    if (data?.protocol !== PROTOCOL || Number(data?.version) !== VERSION) {
      throw new Error('The server answered, but it is not a compatible Memory Bridge.');
    }
    const connectionId = String(config?.connectionId || '').trim();
    if (connectionId && (data?.connection?.isolated !== true || String(data?.connection?.connectionId || '') !== connectionId)) {
      throw new Error('Private Memory Bridge scope mismatch. Refusing to use the wrong customer connection.');
    }
    return data;
  }

  async function publishWorkspace(config, workspace) {
    return request(config, '/v1/workspace/snapshot', {
      method: 'PUT',
      body: JSON.stringify({ workspace })
    });
  }

  async function pullExternalProposals(config) {
    return request(config, '/v1/workspace/proposals/pull', {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  async function getOfficeJobFeedAccess(config) {
    return request(config, '/v1/jobs/access', {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  async function authorizeOffice(config) {
    return request(config, '/v1/office/authorize', {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  async function listExternalClients(config) {
    const data = await request(config, '/v1/oauth/clients', { method: 'GET' });
    return Array.isArray(data?.clients) ? data.clients : [];
  }

  async function revokeExternalClient(config, clientId) {
    return request(config, '/v1/oauth/clients/revoke', {
      method: 'POST',
      body: JSON.stringify({ clientId: String(clientId || '') })
    });
  }

  function registerBridge(config) {
    const memoryAI = globalThis.MemoryAI;
    if (!memoryAI) throw new Error('MemoryAI provider registry is not ready');

    const id = String(config?.id || '').trim();
    const name = String(config?.name || 'Memory Bridge').trim();
    const connectionId = String(config?.connectionId || '').trim();
    const baseUrl = scopedBaseUrl(config);
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
        const data = await requestBridgeChat({ baseUrl, token, connectionId }, request);
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

  async function requestBridgeChat(config, chatRequest) {
    const data = await request(config, '/v1/chat', {
      method: 'POST',
      body: JSON.stringify({
        protocol: PROTOCOL,
        version: VERSION,
        requestId: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        message: String(chatRequest?.message || ''),
        context: String(chatRequest?.context || ''),
        history: Array.isArray(chatRequest?.history)
          ? chatRequest.history.slice(-10).map((item) => ({
              role: String(item?.role || ''),
              content: String(item?.content || '')
            }))
          : [],
        memoryPolicy: chatRequest?.memoryPolicy || {
          currentOnly: true,
          approvalRequired: true
        }
      })
    });
    if (!data?.reply) throw new Error('Memory Bridge returned no reply');
    return data;
  }

  globalThis.MemoryBridge = Object.freeze({
    protocol: PROTOCOL,
    version: VERSION,
    registerBridge,
    testBridge,
    publishWorkspace,
    pullExternalProposals,
    getOfficeJobFeedAccess,
    authorizeOffice,
    listExternalClients,
    revokeExternalClient
  });
})();
