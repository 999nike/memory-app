(() => {
  'use strict';

  const BRIDGE_STORAGE_KEY = 'memory-ai-bridges-v1';
  const CHAT_KEY = 'memory-space-chat-v1';
  let mounted = false;

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

  async function pullProposals(button) {
    const bridge = activeBridge();
    if (!bridge) {
      setStatus('Pair a Memory Bridge first.', 'error');
      return;
    }
    if (!globalThis.MemoryBridge?.pullExternalProposals) {
      setStatus('Memory Bridge client is not ready.', 'error');
      return;
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Checking…';
    setStatus('Checking the bridge for external AI proposals…');

    try {
      const result = await globalThis.MemoryBridge.pullExternalProposals(bridge);
      const added = mergeExternalProposals(result?.proposals || []);
      if (!added) {
        setStatus('No new external AI proposals.', 'ok');
        button.disabled = false;
        button.textContent = original;
        return;
      }
      setStatus(`${added} external AI proposal${added === 1 ? '' : 's'} ready for your review.`, 'ok');
      button.textContent = 'Added';
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      console.error('Could not pull external AI proposals:', error);
      setStatus(error?.message || 'Could not pull external AI proposals.', 'error');
      button.disabled = false;
      button.textContent = original;
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
      marker.textContent = 'External AI via MCP · requires your approval';
      const actions = card.querySelector('.proposal-actions');
      if (actions) card.insertBefore(marker, actions);
      else card.appendChild(marker);
    });
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
        <small id="externalProposalStatus">Pull proposals left by ChatGPT, Gemini, Claude, or another MCP client.</small>
      </div>
      <button type="button" id="externalProposalPullButton">Check proposals</button>`;
    header.insertAdjacentElement('afterend', panel);
    panel.querySelector('#externalProposalPullButton')?.addEventListener('click', (event) => pullProposals(event.currentTarget));

    decorateProposalCards();
    const observer = new MutationObserver(decorateProposalCards);
    const proposalList = document.getElementById('proposalList');
    if (proposalList) observer.observe(proposalList, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
