(() => {
  'use strict';

  const WORKSPACE_KEY = 'memory-space-v1';
  const CHAT_PATH = '/api/chat';
  const baseFetch = window.fetch.bind(window);
  let lastTrace = null;
  let mounted = false;

  function loadWorkspace() {
    try {
      const value = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      return value && Array.isArray(value.spaces) && Array.isArray(value.memories) ? value : null;
    } catch {
      return null;
    }
  }

  function selectionFor(request) {
    const workspace = loadWorkspace();
    if (!workspace) return null;
    const spaceId = String(request?.space?.id || workspace.activeSpaceId || '');
    const space = workspace.spaces.find((item) => String(item.id) === spaceId)
      || workspace.spaces.find((item) => item.id === workspace.activeSpaceId)
      || workspace.spaces[0];
    if (!space) return null;

    const confirmed = workspace.memories.filter((memory) =>
      memory.spaceId === space.id && String(memory.status || 'confirmed') === 'confirmed'
    );

    const focused = globalThis.MemoryAI?.focusRequestContext?.(request);
    const metadata = focused?.contextSelection;
    const selectedIds = Array.isArray(metadata?.selectedMemoryIds)
      ? metadata.selectedMemoryIds
      : confirmed.map((memory) => memory.id);
    const selectedSet = new Set(selectedIds);
    const selected = confirmed.filter((memory) => selectedSet.has(memory.id));

    return {
      spaceId: space.id,
      spaceName: space.name,
      total: Number(metadata?.totalConfirmed ?? confirmed.length),
      selected: Number(metadata?.selected ?? selected.length),
      strategy: metadata?.strategy || 'all-current-v1',
      titles: selected.map((memory) => String(memory.title || 'Untitled')).slice(0, 12)
    };
  }

  function isChatRequest(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init?.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();
    if (method !== 'POST' || !url) return false;
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname === CHAT_PATH;
    } catch {
      return url === CHAT_PATH;
    }
  }

  function render() {
    const header = document.querySelector('#phase2ChatPanel .ai-panel-header');
    if (!header) return false;

    let panel = document.getElementById('contextTracePanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'contextTracePanel';
      panel.className = 'context-trace';
      header.insertAdjacentElement('afterend', panel);
    }

    let html;
    if (!lastTrace) {
      html = '<strong>Context budget</strong><span>Ready · focused memory will be selected locally for each message.</span>';
    } else {
      const titles = lastTrace.titles.length ? lastTrace.titles.join(' · ') : 'No confirmed memory selected';
      html = `
        <div><strong>Context budget</strong><span>${escapeHtml(lastTrace.selected)}/${escapeHtml(lastTrace.total)} memories sent · ${escapeHtml(lastTrace.strategy)}</span></div>
        <small title="${escapeAttr(titles)}">${escapeHtml(titles)}</small>`;
    }

    if (panel.innerHTML !== html) panel.innerHTML = html;
    mounted = true;
    return true;
  }

  window.fetch = async function contextTraceFetch(input, init = {}) {
    if (isChatRequest(input, init)) {
      try {
        const request = JSON.parse(init.body || '{}');
        lastTrace = selectionFor(request);
        render();
      } catch {}
    }
    return baseFetch(input, init);
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttr(value) { return escapeHtml(value); }

  const observer = new MutationObserver(() => {
    if (mounted) return;
    if (render()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (render()) observer.disconnect();
    }, { once: true });
  } else if (render()) {
    observer.disconnect();
  }
})();