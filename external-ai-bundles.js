(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  const CHAT_KEY = 'memory-space-chat-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';
  const BUNDLE_KIND = 'memory-bundle';

  let mounted = false;
  let observer = null;

  const now = () => new Date().toISOString();
  const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function restoreRaw(key, raw) {
    if (raw == null) localStorage.removeItem(key);
    else localStorage.setItem(key, raw);
  }

  function chatState() {
    const value = readJson(CHAT_KEY, { version: 1, messages: [], proposals: [] });
    if (!Array.isArray(value.messages)) value.messages = [];
    if (!Array.isArray(value.proposals)) value.proposals = [];
    return value;
  }

  function bundleProposal(proposalId, state = chatState()) {
    return state.proposals.find((proposal) => String(proposal?.id) === String(proposalId)
      && proposal?.proposalKind === BUNDLE_KIND
      && proposal?.status === 'pending') || null;
  }

  function normaliseMemory(item, index) {
    const title = String(item?.title || '').trim().slice(0, 100);
    const content = String(item?.content || '').trim().slice(0, 2000);
    if (!title || !content) throw new Error(`Memory ${index + 1} needs a title and details.`);

    const type = ['decision', 'fact', 'goal', 'question', 'note', 'job'].includes(item?.type) ? item.type : 'note';
    const importance = ['critical', 'high', 'normal', 'low'].includes(item?.importance) ? item.importance : 'normal';
    const project = String(item?.project || '').trim().slice(0, 100);
    const priority = ['low', 'normal', 'high', 'urgent'].includes(item?.priority) ? item.priority : 'normal';
    if (type === 'job' && !project) throw new Error(`Job “${title}” needs a Code Space project.`);

    return {
      title,
      content,
      type,
      importance,
      project,
      priority,
      reason: String(item?.reason || '').trim().slice(0, 500)
    };
  }

  function createApprovedMemory(item, proposal, approvedAt) {
    const memoryId = uid('memory');
    const groupTitle = String(proposal.groupTitle || proposal.title || 'Memory group').trim().slice(0, 48);
    const sourceMessage = 'External MCP memory bundle proposal';
    return {
      id: memoryId,
      spaceId: proposal.spaceId,
      title: item.title,
      content: item.content,
      type: item.type,
      importance: item.importance,
      ...(item.type === 'job' ? {
        details: item.content,
        project: item.project,
        priority: item.priority,
        createdBy: 'external-ai',
        officeCollectedAt: null,
        officeJobId: null
      } : {}),
      source: `AI bundle approved by user · Group: ${groupTitle}`,
      sourceKind: 'ai-proposal',
      sourceMessage,
      proposalReason: item.reason || proposal.reason || '',
      approvedAt,
      locked: false,
      status: item.type === 'job' ? 'ready' : 'confirmed',
      createdAt: approvedAt,
      updatedAt: approvedAt
    };
  }

  function createVisualGroup(proposal, memberIds, existingGroups, approvedAt) {
    const index = existingGroups.length;
    return {
      id: uid('group'),
      title: String(proposal.groupTitle || proposal.title || 'Memory group').trim().slice(0, 48),
      angle: -Math.PI / 2 + index * 2.399963229728653,
      phase: (index * 1.173 + 0.52) % (Math.PI * 2),
      members: [...memberIds],
      createdAt: approvedAt,
      createdBy: 'external-ai-approved-bundle',
      sourceProposalId: String(proposal.id || '')
    };
  }

  function approveBundle(proposalId) {
    const originalWorkspaceRaw = localStorage.getItem(WORKSPACE_KEY);
    const originalGroupRaw = localStorage.getItem(GROUP_KEY);
    const originalChatRaw = localStorage.getItem(CHAT_KEY);

    try {
      const workspace = readJson(WORKSPACE_KEY, null);
      const state = chatState();
      const proposal = bundleProposal(proposalId, state);
      if (!proposal) throw new Error('This bundle is no longer waiting for approval.');
      if (!workspace || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.memories)) {
        throw new Error('Memory Space workspace is unavailable.');
      }

      const space = workspace.spaces.find((item) => String(item.id) === String(proposal.spaceId));
      if (!space) throw new Error('The bundle does not belong to an available Memory Space.');

      const items = Array.isArray(proposal.memories) ? proposal.memories : [];
      if (!items.length || items.length > 24) throw new Error('The bundle must contain between 1 and 24 memories.');
      const memories = items.map(normaliseMemory);
      const approvedAt = now();
      const created = memories.map((item) => createApprovedMemory(item, proposal, approvedAt));
      const memberIds = created.map((memory) => memory.id);

      const groupStore = readJson(GROUP_KEY, { version: 1, spaces: {} }) || { version: 1, spaces: {} };
      if (!groupStore.spaces || typeof groupStore.spaces !== 'object') groupStore.spaces = {};
      const existingGroups = Array.isArray(groupStore.spaces[proposal.spaceId])
        ? [...groupStore.spaces[proposal.spaceId]]
        : [];
      const visualGroup = createVisualGroup(proposal, memberIds, existingGroups, approvedAt);

      workspace.memories.push(...created);
      space.updatedAt = approvedAt;
      groupStore.version = 1;
      groupStore.spaces[proposal.spaceId] = [...existingGroups, visualGroup];

      proposal.status = 'approved';
      proposal.approvedAt = approvedAt;
      proposal.createdMemoryIds = memberIds;
      proposal.createdGroupId = visualGroup.id;

      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
      localStorage.setItem(GROUP_KEY, JSON.stringify(groupStore));
      localStorage.setItem(CHAT_KEY, JSON.stringify(state));
      window.dispatchEvent(new CustomEvent('memory-workspace-changed'));

      toast(`${created.length} memories approved into ${visualGroup.title}`);
      setTimeout(() => location.reload(), 350);
      return true;
    } catch (error) {
      try {
        restoreRaw(WORKSPACE_KEY, originalWorkspaceRaw);
        restoreRaw(GROUP_KEY, originalGroupRaw);
        restoreRaw(CHAT_KEY, originalChatRaw);
      } catch {}
      toast(error?.message || 'Memory bundle approval failed', true);
      return false;
    }
  }

  function rejectBundle(proposalId) {
    const state = chatState();
    const proposal = bundleProposal(proposalId, state);
    if (!proposal) return false;
    proposal.status = 'rejected';
    proposal.rejectedAt = now();
    localStorage.setItem(CHAT_KEY, JSON.stringify(state));
    toast('Memory bundle rejected');
    setTimeout(() => location.reload(), 180);
    return true;
  }

  function bundleForCard(card) {
    const proposalId = card?.querySelector('[data-proposal-id]')?.dataset?.proposalId;
    if (!proposalId) return null;
    return bundleProposal(proposalId);
  }

  function decorateCard(card, proposal) {
    if (!card || !proposal || card.dataset.memoryBundleDecorated === 'true') return;
    card.dataset.memoryBundleDecorated = 'true';
    card.classList.add('memory-bundle-proposal');

    const topType = card.querySelector('.proposal-type');
    if (topType) topType.textContent = 'Memory bundle';
    const importance = card.querySelector('.proposal-importance');
    if (importance) importance.textContent = `${proposal.memories?.length || 0} memories`;

    const source = card.querySelector('.external-proposal-source');
    if (source) source.textContent = 'External AI bundle · one approval required';

    const summary = document.createElement('div');
    summary.className = 'memory-bundle-summary';
    const heading = document.createElement('strong');
    heading.textContent = `Creates gravity bubble: ${proposal.groupTitle || proposal.title}`;
    summary.appendChild(heading);

    const list = document.createElement('ul');
    for (const memory of (proposal.memories || []).slice(0, 24)) {
      const item = document.createElement('li');
      item.textContent = memory.title;
      list.appendChild(item);
    }
    summary.appendChild(list);

    const actions = card.querySelector('.proposal-actions');
    if (actions) card.insertBefore(summary, actions);
    else card.appendChild(summary);

    const edit = card.querySelector('[data-proposal-action="review"]');
    if (edit) edit.hidden = true;
    const approve = card.querySelector('[data-proposal-action="approve"]');
    if (approve) approve.textContent = `Approve bundle (${proposal.memories?.length || 0})`;
  }

  function decorateBundles() {
    const state = chatState();
    const bundles = new Map(
      state.proposals
        .filter((proposal) => proposal?.proposalKind === BUNDLE_KIND && proposal?.status === 'pending')
        .map((proposal) => [String(proposal.id), proposal])
    );
    if (!bundles.size) return;

    document.querySelectorAll('.proposal-card').forEach((card) => {
      const id = card.querySelector('[data-proposal-id]')?.dataset?.proposalId;
      const proposal = bundles.get(String(id || ''));
      if (proposal) decorateCard(card, proposal);
    });
  }

  function handleBundleAction(event) {
    const button = event.target.closest('[data-proposal-action][data-proposal-id]');
    if (!button) return;
    const proposal = bundleProposal(button.dataset.proposalId);
    if (!proposal) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (button.dataset.proposalAction === 'reject') {
      rejectBundle(proposal.id);
      return;
    }
    if (button.dataset.proposalAction === 'approve') {
      button.disabled = true;
      button.textContent = 'Approving bundle…';
      approveBundle(proposal.id);
    }
  }

  function injectStyles() {
    if (document.getElementById('externalMemoryBundleStyles')) return;
    const style = document.createElement('style');
    style.id = 'externalMemoryBundleStyles';
    style.textContent = `
      .proposal-card.memory-bundle-proposal {
        border-color: rgb(199 255 86 / 0.30);
        box-shadow: inset 0 0 0 1px rgb(120 184 255 / 0.05), 0 10px 30px rgb(0 0 0 / 0.14);
      }
      .memory-bundle-summary {
        margin: 9px 0 4px;
        padding: 9px 10px;
        border: 1px solid rgb(120 184 255 / 0.14);
        border-radius: 10px;
        background: rgb(120 184 255 / 0.035);
      }
      .memory-bundle-summary > strong {
        display: block;
        color: #dfffa2;
        font-size: 11px;
        margin-bottom: 6px;
      }
      .memory-bundle-summary ul {
        margin: 0;
        padding-left: 17px;
        color: rgb(226 231 238 / 0.82);
        font-size: 11px;
        line-height: 1.45;
      }
    `;
    document.head.appendChild(style);
  }

  function toast(message, error = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', Boolean(error));
    el.classList.add('show');
    setTimeout(() => {
      el.classList.remove('show');
      el.classList.remove('error');
    }, 2600);
  }

  function mount() {
    if (mounted) return;
    const list = document.getElementById('proposalList');
    if (!list) {
      setTimeout(mount, 60);
      return;
    }
    mounted = true;
    injectStyles();
    list.addEventListener('click', handleBundleAction, true);
    decorateBundles();
    observer = new MutationObserver(decorateBundles);
    observer.observe(list, { childList: true, subtree: true });
  }

  globalThis.MemoryExternalBundles = Object.freeze({
    version: VERSION,
    approveBundle,
    rejectBundle
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
