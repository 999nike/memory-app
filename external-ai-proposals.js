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
    // Never guess between multiple saved customer connections. Pulling from
    // the wrong bridge could surface another customer's proposal queue.
    return bridges.length === 1 ? bridges[0] : null;
  }

  function sanitiseBundleMemories(proposal) {
    if (proposal?.proposalKind !== 'memory-bundle' || !Array.isArray(proposal.memories)) return [];
    return proposal.memories.slice(0, 24).map((memory) => ({
      title: String(memory?.title || '').trim().slice(0, 100),
      content: String(memory?.content || '').trim().slice(0, 2000),
      type: ['decision', 'fact', 'goal', 'question', 'note', 'job'].includes(memory?.type) ? memory.type : 'note',
      importance: ['critical', 'high', 'normal', 'low'].includes(memory?.importance) ? memory.importance : 'normal',
      project: String(memory?.project || '').trim().slice(0, 100),
      priority: ['low', 'normal', 'high', 'urgent'].includes(memory?.priority) ? memory.priority : 'normal',
      reason: String(memory?.reason || '').trim().slice(0, 500)
    })).filter((memory) => memory.title && memory.content);
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
      const proposalKind = proposal.proposalKind === 'memory-bundle' ? 'memory-bundle' : 'memory';
      const bundleMemories = sanitiseBundleMemories(proposal);
      chatState.proposals.push({
        id: proposal.id,
        spaceId: proposal.spaceId,
        title: String(proposal.title || 'External AI proposal'),
        content: String(proposal.content || ''),
        type: proposal.type || 'note',
        importance: proposal.importance || 'normal',
        project: String(proposal.project || ''),
        priority: proposal.priority || 'normal',
        reason: proposal.reason || 'External AI suggested this as durable context.',
        sourceMessage: proposalKind === 'memory-bundle' ? 'External MCP memory bundle proposal' : 'External MCP client proposal',
        sourceKind: 'external-mcp',
        sourceLabel: 'External AI via MCP',
        proposalKind,
        groupTitle: proposalKind === 'memory-bundle' ? String(proposal.groupTitle || proposal.title || '').trim().slice(0, 48) : '',
        memories: bundleMemories,
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
      setStatus(loadBridges().length > 1
        ? 'Choose the Memory Bridge for this Space before checking external AI suggestions.'
        : 'Connect an AI app to receive suggestions here.');
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
