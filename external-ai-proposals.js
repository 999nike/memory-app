(() => {
  'use strict';

  const BRIDGE_STORAGE_KEY = 'memory-ai-bridges-v1';
  const CHAT_KEY = 'memory-space-chat-v1';
  let mounted = false;
  let checking = false;

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadBridges() {
    const items = loadJson(BRIDGE_STORAGE_KEY, []);
    return Array.isArray(items) ? items : [];
  }

  function activeBridge() {
    const bridges = loadBridges();
    const activeId = globalThis.MemoryAI?.getActiveProviderId?.() || '';
    if (String(activeId).startsWith('memory-bridge:')) {
      const id = String(activeId).slice('memory-bridge:'.length);
      const match = bridges.find((bridge) => bridge.id === id);
      if (match) return match;
    }
    return bridges[0] || null;
  }

  function mergeExternalProposals(proposals) {
    if (!Array.isArray(proposals) || !proposals.length) return 0;
    let chatState = loadJson(CHAT_KEY, null);
    if (!chatState || !Array.isArray(chatState.messages) || !Array.isArray(chatState.proposals)) {
      chatState = { version: 1, messages: [], proposals: [] };
    }

    const existing = new Set(chatState.proposals.map((item) => item.id));
    let added = 0;
    for (const proposal of proposals) {
      if (!proposal?.id || existing.has(proposal.id)) continue;
      chatState.proposals.push({
        id: proposal.id,
        spaceId: proposal.spaceId,
        title: String(proposal.title || 'External AI proposal'),
        content: String(proposal.content || ''),
        type: proposal.type || 'note',
        importance: proposal.importance || 'normal',
        reason: proposal.reason || 'External AI suggested this as durable context.',
        sourceMessage: 'External MCP client proposal',
        sourceKind: 'external-mcp',
        sourceLabel: 'External AI via MCP',
        status: 'pending',
        createdAt: proposal.createdAt || new Date().toISOString()
      });
      existing.add(proposal.id);
      added += 1;
    }

    localStorage.setItem(CHAT_KEY, JSON.stringify(chatState));
    return added;
  }

  function setStatus(message, kind = '') {
    const status = document.getElementById('externalProposalStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
  }

  async function checkProposals() {
    if (checking || document.hidden) return;

    const bridge = activeBridge();
    if (!bridge) {
      setStatus('Connect an AI app to receive suggestions here.');
      return;
    }
    if (!globalThis.MemoryBridge?.pullExternalProposals) {
      setStatus('External AI inbox is starting…');
      return;
    }

    checking = true;
    try {
      const result = await globalThis.MemoryBridge.pullExternalProposals(bridge);
      const added = mergeExternalProposals(result?.proposals || []);
      if (!added) {
        setStatus('Watching automatically for suggestions from connected AI apps.', 'ok');
        return;
      }

      setStatus(`${added} new AI suggestion${added === 1 ? '' : 's'} ready for your approval.`, 'ok');
      toast(`${added} new AI suggestion${added === 1 ? '' : 's'} ready to review`);
      setTimeout(() => location.reload(), 550);
    } catch (error) {
      console.debug('Automatic external proposal check is waiting for the bridge:', error?.message || error);
      setStatus('External AI inbox will reconnect automatically when the bridge is available.');
    } finally {
      checking = false;
    }
  }

  function decorateProposalCards() {
    const chatState = loadJson(CHAT_KEY, { proposals: [] });
    const externalIds = new Set(
      (Array.isArray(chatState?.proposals) ? chatState.proposals : [])
        .filter((proposal) => proposal?.sourceKind === 'external-mcp')
        .map((proposal) => proposal.id)
    );

    document.querySelectorAll('[data-proposal-id]').forEach((button) => {
      const id = button.dataset.proposalId;
      if (!externalIds.has(id)) return;
      const card = button.closest('.proposal-card');
      if (!card || card.querySelector('.external-proposal-source')) return;
      const marker = document.createElement('div');
      marker.className = 'external-proposal-source';
      marker.textContent = 'External AI suggestion · requires your approval';
      const actions = card.querySelector('.proposal-actions');
      if (actions) card.insertBefore(marker, actions);
      else card.appendChild(marker);
    });
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2200);
  }

  function wake() {
    checkProposals();
  }

  function mount() {
    if (mounted) return;
    const header = document.querySelector('#phase2ChatPanel .ai-panel-header');
    if (!header) {
      setTimeout(mount, 50);
      return;
    }

    mounted = true;
    const panel = document.createElement('div');
    panel.className = 'external-proposal-check';
    panel.innerHTML = `
      <div>
        <strong>External AI inbox</strong>
        <small id="externalProposalStatus">Watching automatically for suggestions from connected AI apps.</small>
      </div>`;
    header.insertAdjacentElement('afterend', panel);

    decorateProposalCards();
    const observer = new MutationObserver(decorateProposalCards);
    const proposalList = document.getElementById('proposalList');
    if (proposalList) observer.observe(proposalList, { childList: true, subtree: true });

    setTimeout(checkProposals, 900);
  }

  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });

  setInterval(checkProposals, 8000);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
