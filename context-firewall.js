(() => {
  'use strict';

  const WORKSPACE_KEY = 'memory-space-v1';
  const CHAT_PATH = '/api/chat';
  const previousFetch = window.fetch.bind(window);

  window.fetch = async function memoryContextFirewallFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
    if (!isChatRequest(url, method)) return previousFetch(input, init);

    let body;
    try {
      body = JSON.parse(init.body || '{}');
    } catch {
      return previousFetch(input, init);
    }

    const workspace = loadWorkspace();
    const space = workspace?.spaces?.find((item) => item.id === (body.space?.id || workspace.activeSpaceId)) || workspace?.spaces?.[0];
    if (workspace && space) {
      body.context = buildCurrentContext(workspace, space);
      body.memoryPolicy = {
        currentOnly: true,
        excludeStatuses: ['superseded', 'archived', 'deleted'],
        approvalRequired: true
      };
    }

    return previousFetch(input, {
      ...init,
      headers: { ...(headersToObject(init.headers)), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  };

  globalThis.MemoryContext = Object.freeze({
    buildCurrentContext() {
      const workspace = loadWorkspace();
      const space = workspace?.spaces?.find((item) => item.id === workspace.activeSpaceId) || workspace?.spaces?.[0];
      return workspace && space ? buildCurrentContext(workspace, space) : '';
    }
  });

  function loadWorkspace() {
    try {
      const value = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      return value && Array.isArray(value.spaces) && Array.isArray(value.memories) ? value : null;
    } catch {
      return null;
    }
  }

  function buildCurrentContext(workspace, space) {
    const order = { critical: 0, high: 1, normal: 2, low: 3 };
    const memories = workspace.memories
      .filter((memory) => memory.spaceId === space.id && (memory.status || 'confirmed') === 'confirmed')
      .sort((a, b) => (order[a.importance] ?? 9) - (order[b.importance] ?? 9));

    const lines = [
      `SPACE: ${space.name}`,
      `PURPOSE: ${space.description}`,
      '',
      'CONFIRMED CURRENT MEMORY:'
    ];

    if (!memories.length) lines.push('- None yet.');
    for (const memory of memories) {
      lines.push(`- [${String(memory.importance || 'normal').toUpperCase()}] [${String(memory.type || 'note').toUpperCase()}] ${memory.title}`);
      lines.push(`  ${memory.content}`);
      lines.push(`  Version: ${Number(memory.revisionNumber || 1)}`);
      if (memory.source) lines.push(`  Source: ${memory.source}`);
      if (memory.locked) lines.push('  Locked by user: yes');
    }

    lines.push('', 'MEMORY POLICY: Only confirmed current memory is truth. Superseded and archived versions are historical evidence, not active context. Permanent memory changes require user approval.');
    return lines.join('\n');
  }

  function headersToObject(headers) {
    const result = {};
    try {
      new Headers(headers || {}).forEach((value, key) => { result[key] = value; });
    } catch {}
    return result;
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
})();
