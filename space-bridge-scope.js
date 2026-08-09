(() => {
  'use strict';

  const BRIDGES_KEY = 'memory-ai-bridges-v1';
  const WORKSPACE_KEY = 'memory-space-v1';
  const BINDINGS_KEY = 'memory-space-bridge-bindings-v1';
  const PROVIDER_PREFIX = 'memory-bridge:';
  let selecting = false;

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadBridges() {
    const bridges = loadJson(BRIDGES_KEY, []);
    return Array.isArray(bridges) ? bridges : [];
  }

  function activeSpaceId() {
    const workspace = loadJson(WORKSPACE_KEY, null);
    if (!workspace || !Array.isArray(workspace.spaces)) return null;
    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    return space?.id || null;
  }

  function loadBindings() {
    const bindings = loadJson(BINDINGS_KEY, {});
    return bindings && typeof bindings === 'object' && !Array.isArray(bindings) ? bindings : {};
  }

  function saveBindings(bindings) {
    localStorage.setItem(BINDINGS_KEY, JSON.stringify(bindings));
  }

  function providerId(bridgeId) {
    return `${PROVIDER_PREFIX}${bridgeId}`;
  }

  function bridgeById(bridgeId) {
    return loadBridges().find((bridge) => bridge.id === bridgeId) || null;
  }

  function boundBridge(spaceId = activeSpaceId()) {
    if (!spaceId) return null;
    const bindings = loadBindings();
    const bridgeId = String(bindings[spaceId] || '');
    if (!bridgeId) return null;
    const bridge = bridgeById(bridgeId);
    if (bridge) return bridge;

    delete bindings[spaceId];
    saveBindings(bindings);
    return null;
  }

  function bindSpace(spaceId, bridgeId) {
    const id = String(spaceId || '').trim();
    const bridge = bridgeById(bridgeId);
    if (!id || !bridge) return false;
    const bindings = loadBindings();
    if (bindings[id] === bridge.id) return true;
    bindings[id] = bridge.id;
    saveBindings(bindings);
    dispatchEvent(new CustomEvent('memory-space-bridge-bound', {
      detail: { spaceId: id, bridgeId: bridge.id, connectionId: bridge.connectionId || null }
    }));
    return true;
  }

  function bindActiveSpace(bridgeId) {
    return bindSpace(activeSpaceId(), bridgeId);
  }

  function activeBridge() {
    const bridges = loadBridges();
    if (!bridges.length) return null;
    const bound = boundBridge();
    if (bound) return bound;
    return bridges.length === 1 ? bridges[0] : null;
  }

  function providerReady(id) {
    return Boolean(globalThis.MemoryAI?.listProviders?.().some((provider) => provider.id === id));
  }

  function refreshBridgeProviders() {
    if (!globalThis.MemoryBridge?.registerBridge) return;
    const bridges = loadBridges();
    const multiple = bridges.length > 1;
    for (const bridge of bridges) {
      try {
        globalThis.MemoryBridge.registerBridge({
          id: providerId(bridge.id),
          name: multiple ? `${bridge.name} · ${bridge.connectionId ? 'Private' : 'Owner'}` : bridge.name,
          baseUrl: bridge.baseUrl,
          token: bridge.token,
          connectionId: bridge.connectionId || null
        });
      } catch (error) {
        console.debug('Memory Bridge scope restore is waiting:', error?.message || error);
      }
    }
  }

  function selectForActiveSpace() {
    if (!globalThis.MemoryAI?.setActiveProvider) return false;
    const bridges = loadBridges();
    if (!bridges.length) return false;

    const spaceId = activeSpaceId();
    if (!spaceId) return false;

    let bridge = boundBridge(spaceId);
    if (!bridge && bridges.length === 1) {
      bridge = bridges[0];
      bindSpace(spaceId, bridge.id);
    }

    if (!bridge) {
      // Old browser profiles may contain several customer connections but no
      // Space binding. Never reuse the previously global bridge by accident.
      const current = String(globalThis.MemoryAI.getActiveProviderId?.() || '');
      if (current.startsWith(PROVIDER_PREFIX) && providerReady('browser-local')) {
        selecting = true;
        try { globalThis.MemoryAI.setActiveProvider('browser-local'); }
        finally { selecting = false; }
      }
      return false;
    }

    const target = providerId(bridge.id);
    if (!providerReady(target)) return false;
    if (globalThis.MemoryAI.getActiveProviderId?.() === target) return true;

    selecting = true;
    try { globalThis.MemoryAI.setActiveProvider(target); }
    finally { selecting = false; }
    return true;
  }

  addEventListener('memory-ai-provider-changed', (event) => {
    if (selecting) return;
    const id = String(event?.detail?.id || globalThis.MemoryAI?.getActiveProviderId?.() || '');
    if (!id.startsWith(PROVIDER_PREFIX)) return;
    bindActiveSpace(id.slice(PROVIDER_PREFIX.length));
  });

  // app.js saves the new activeSpaceId before these bubbling handlers run.
  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-space-id]')) return;
    selectForActiveSpace();
  });
  document.addEventListener('submit', (event) => {
    if (event.target?.id !== 'spaceForm') return;
    selectForActiveSpace();
  });

  addEventListener('storage', (event) => {
    if (![BRIDGES_KEY, WORKSPACE_KEY, BINDINGS_KEY].includes(event.key)) return;
    setTimeout(selectForActiveSpace, 0);
  });

  addEventListener('memory-bridge-connected', () => {
    refreshBridgeProviders();
    selectForActiveSpace();
  });

  function boot(attempts = 80) {
    if (!globalThis.MemoryAI?.listProviders) {
      if (attempts > 0) setTimeout(() => boot(attempts - 1), 25);
      return;
    }
    const bridges = loadBridges();
    refreshBridgeProviders();
    if (bridges.length && !bridges.every((bridge) => providerReady(providerId(bridge.id)))) {
      if (attempts > 0) setTimeout(() => boot(attempts - 1), 25);
      return;
    }
    selectForActiveSpace();
  }

  globalThis.MemoryBridgeScope = Object.freeze({
    activeBridge,
    activeSpaceId,
    bindActiveSpace,
    bindSpace,
    selectForActiveSpace
  });

  boot();
})();
