(() => {
  'use strict';

  const WORKSPACE_KEY = 'memory-space-v1';
  const CHAT_KEY = 'memory-space-chat-v1';
  const TYPE_LABELS = {
    decision: 'Decision',
    fact: 'Fact',
    goal: 'Goal',
    question: 'Question',
    note: 'Note',
    job: 'Job'
  };

  let chatState = loadChatState();
  let reviewingProposalId = null;
  let isSending = false;

  const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  const now = () => new Date().toISOString();

  function loadWorkspace() {
    try {
      const parsed = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.spaces) || !Array.isArray(parsed.memories)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveWorkspace(workspace) {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }

  function loadChatState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CHAT_KEY) || 'null');
      if (parsed && Array.isArray(parsed.messages) && Array.isArray(parsed.proposals)) return parsed;
    } catch {}
    return { version: 1, messages: [], proposals: [] };
  }

  function saveChatState() {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatState));
  }

  function getActiveSpace(workspace = loadWorkspace()) {
    if (!workspace) return null;
    return workspace.spaces.find((space) => space.id === workspace.activeSpaceId) || workspace.spaces[0] || null;
  }

  function memoriesForSpace(workspace, spaceId) {
    return workspace.memories.filter((memory) => memory.spaceId === spaceId
      && (memory.status || 'confirmed') === 'confirmed'
      && memory.type !== 'job');
  }

  function messagesForSpace(spaceId) {
    return chatState.messages.filter((message) => message.spaceId === spaceId);
  }

  function proposalsForSpace(spaceId) {
    return chatState.proposals.filter((proposal) => proposal.spaceId === spaceId && proposal.status === 'pending');
  }

  function buildContext(workspace, space) {
    const order = { critical: 0, high: 1, normal: 2, low: 3 };
    const memories = memoriesForSpace(workspace, space.id)
      .sort((a, b) => (order[a.importance] ?? 9) - (order[b.importance] ?? 9));

    const lines = [
      `SPACE: ${space.name}`,
      `PURPOSE: ${space.description}`,
      '',
      'CONFIRMED MEMORY:'
    ];

    if (!memories.length) lines.push('- None yet.');
    for (const memory of memories) {
      lines.push(`- [${String(memory.importance || 'normal').toUpperCase()}] [${String(memory.type || 'note').toUpperCase()}] ${memory.title}`);
      lines.push(`  ${memory.content}`);
      if (memory.source) lines.push(`  Source: ${memory.source}`);
      if (memory.locked) lines.push('  Locked by user: yes');
    }

    lines.push('', 'MEMORY RULE: Locked and confirmed memories are trusted context. Never claim a proposed memory is saved until the user approves it.');
    return lines.join('\n');
  }

  function injectLayout() {
    const memorySection = document.querySelector('.memory-section');
    if (!memorySection || document.getElementById('phase2ChatPanel')) return;

    const layout = document.createElement('div');
    layout.className = 'phase2-layout';

    const memoryPane = document.createElement('div');
    memoryPane.className = 'phase2-memory-pane';
    while (memorySection.firstChild) memoryPane.appendChild(memorySection.firstChild);

    const chatPane = document.createElement('aside');
    chatPane.className = 'phase2-chat-pane';
    chatPane.id = 'phase2ChatPanel';
    chatPane.innerHTML = `
      <div class="ai-panel-header">
        <div>
          <p class="eyebrow">AI workspace</p>
          <h3>Shared chat</h3>
        </div>
        <div class="ai-status" id="aiStatus"><span></span> Checking local AI…</div>
      </div>

      <div class="proposal-section" id="proposalSection" hidden>
        <div class="proposal-heading">
          <div>
            <strong>Memory proposals</strong>
            <small>Nothing is saved until you approve it.</small>
          </div>
          <span class="proposal-count" id="proposalCount">0</span>
        </div>
        <div id="proposalList" class="proposal-list"></div>
      </div>

      <div class="chat-messages" id="chatMessages"></div>

      <div class="chat-notice" id="chatNotice" hidden></div>

      <form class="chat-form" id="chatForm">
        <textarea id="chatInput" rows="3" maxlength="5000" placeholder="Talk to the AI inside this space…" required></textarea>
        <div class="chat-form-footer">
          <button type="button" class="chat-clear" id="clearChatButton">Clear chat</button>
          <button type="submit" class="primary-button" id="chatSendButton">Send</button>
        </div>
      </form>`;

    layout.append(memoryPane, chatPane);
    memorySection.appendChild(layout);
    bindEvents();
    syncProviderStatus();
    renderPhase2();
  }

  function bindEvents() {
    document.getElementById('chatForm')?.addEventListener('submit', sendMessage);
    document.getElementById('clearChatButton')?.addEventListener('click', clearChat);
    document.getElementById('proposalList')?.addEventListener('click', handleProposalAction);

    document.getElementById('spaceList')?.addEventListener('click', () => setTimeout(renderPhase2, 0));
    document.getElementById('newSpaceButton')?.addEventListener('click', () => setTimeout(renderPhase2, 0));

    document.getElementById('memoryForm')?.addEventListener('submit', () => {
      if (!reviewingProposalId) return;
      const proposalId = reviewingProposalId;
      reviewingProposalId = null;
      setTimeout(() => {
        const proposal = chatState.proposals.find((item) => item.id === proposalId);
        if (proposal) proposal.status = 'approved-edited';
        saveChatState();
        renderPhase2();
      }, 0);
    });
  }

  function syncProviderStatus() {
    const current = globalThis.__memoryAIStatus;
    if (!current) return;
    const status = document.getElementById('aiStatus');
    if (!status) return;
    status.classList.toggle('busy', current.mode === 'busy');
    status.classList.toggle('local-provider', current.mode === 'local');
    status.classList.toggle('provider-error', current.mode === 'error');
    status.innerHTML = `<span></span> ${escapeHtml(current.label)}`;
  }

  function renderPhase2() {
    const workspace = loadWorkspace();
    const space = getActiveSpace(workspace);
    if (!workspace || !space) return;
    renderMessages(space.id);
    renderProposals(space.id);
  }

  function renderMessages(spaceId) {
    const container = document.getElementById('chatMessages');
    if (!container) return;
    const messages = messagesForSpace(spaceId);

    if (!messages.length) {
      container.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-mark">AI</div>
          <strong>Continue inside this space</strong>
          <p>The AI receives the confirmed memory shown beside this chat. It can suggest new memory, but it cannot save it by itself.</p>
        </div>`;
      return;
    }

    container.innerHTML = messages.map((message) => {
      const used = Array.isArray(message.usedMemoryTitles) && message.usedMemoryTitles.length
        ? `<button class="used-memory" type="button" title="Memories the model reported using">Used: ${escapeHtml(message.usedMemoryTitles.join(', '))}</button>`
        : '';
      return `
        <article class="chat-message ${escapeAttr(message.role)}">
          <div class="chat-role">${message.role === 'user' ? 'You' : 'AI'}</div>
          <div class="chat-copy">${formatMessage(message.content)}</div>
          <div class="chat-meta"><span>${formatTime(message.createdAt)}</span>${used}</div>
        </article>`;
    }).join('');

    requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
  }

  function renderProposals(spaceId) {
    const section = document.getElementById('proposalSection');
    const list = document.getElementById('proposalList');
    const count = document.getElementById('proposalCount');
    if (!section || !list || !count) return;

    const proposals = proposalsForSpace(spaceId);
    section.hidden = proposals.length === 0;
    count.textContent = String(proposals.length);

    list.innerHTML = proposals.map((proposal) => `
      <article class="proposal-card">
        <div class="proposal-card-top">
          <span class="proposal-type">${escapeHtml(TYPE_LABELS[proposal.type] || proposal.type)}</span>
          <span class="proposal-importance">${escapeHtml(proposal.importance)}</span>
        </div>
        <strong>${escapeHtml(proposal.title)}</strong>
        <p>${escapeHtml(proposal.content)}</p>
        <small>${escapeHtml(proposal.reason || 'AI suggested this as durable context.')}</small>
        <div class="proposal-actions">
          <button type="button" data-proposal-action="reject" data-proposal-id="${escapeAttr(proposal.id)}">Reject</button>
          <button type="button" data-proposal-action="review" data-proposal-id="${escapeAttr(proposal.id)}">Edit</button>
          <button type="button" class="proposal-approve" data-proposal-action="approve" data-proposal-id="${escapeAttr(proposal.id)}">Approve</button>
        </div>
      </article>`).join('');
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (isSending) return;

    const input = document.getElementById('chatInput');
    const sendButton = document.getElementById('chatSendButton');
    const status = document.getElementById('aiStatus');
    const text = input?.value.trim();
    if (!text) return;

    const workspace = loadWorkspace();
    const space = getActiveSpace(workspace);
    if (!workspace || !space) return;

    const context = buildContext(workspace, space);
    const priorHistory = messagesForSpace(space.id).slice(-10).map((message) => ({ role: message.role, content: message.content }));

    chatState.messages.push({
      id: uid('msg'), spaceId: space.id, role: 'user', content: text, createdAt: now()
    });
    saveChatState();
    input.value = '';
    renderMessages(space.id);
    showNotice('Message sent. Local AI is preparing a reply. The first mobile run may need to download the model.');

    isSending = true;
    sendButton.disabled = true;
    sendButton.textContent = 'Working…';
    status.classList.add('busy');
    status.innerHTML = '<span></span> Preparing local AI';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Memory-Client': 'workspace-v1' },
        body: JSON.stringify({
          message: text,
          space: { id: space.id, name: space.name, description: space.description },
          context,
          history: priorHistory
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `AI request failed (${response.status})`);

      chatState.messages.push({
        id: uid('msg'),
        spaceId: space.id,
        role: 'assistant',
        content: data.reply || 'I could not produce a reply.',
        usedMemoryTitles: Array.isArray(data.usedMemoryTitles) ? data.usedMemoryTitles : [],
        contextSnapshot: context,
        model: data.model || null,
        createdAt: now()
      });

      for (const proposal of Array.isArray(data.proposals) ? data.proposals : []) {
        chatState.proposals.push({
          id: uid('proposal'),
          spaceId: space.id,
          title: proposal.title,
          content: proposal.content,
          type: proposal.type,
          importance: proposal.importance,
          project: proposal.project || '',
          priority: proposal.priority || 'normal',
          reason: proposal.reason,
          sourceMessage: text,
          status: 'pending',
          createdAt: now()
        });
      }

      saveChatState();
      hideNotice();
      renderPhase2();
    } catch (error) {
      const message = error?.message || 'Unknown local AI error';
      chatState.messages.push({
        id: uid('msg'),
        spaceId: space.id,
        role: 'assistant',
        content: `Local AI error: ${message}`,
        createdAt: now()
      });
      saveChatState();
      renderMessages(space.id);
      showNotice(message, true);
      toast('Local AI could not answer — see the chat message');
    } finally {
      isSending = false;
      sendButton.disabled = false;
      sendButton.textContent = 'Send';
      syncProviderStatus();
      input?.focus();
    }
  }

  function showNotice(message, isError = false) {
    const el = document.getElementById('chatNotice');
    if (!el) return;
    el.hidden = false;
    el.classList.toggle('error', isError);
    el.textContent = message;
  }

  function hideNotice() {
    const el = document.getElementById('chatNotice');
    if (el) el.hidden = true;
  }

  function handleProposalAction(event) {
    const button = event.target.closest('[data-proposal-action]');
    if (!button) return;
    const proposal = chatState.proposals.find((item) => item.id === button.dataset.proposalId);
    if (!proposal) return;

    const action = button.dataset.proposalAction;
    if (action === 'reject') {
      proposal.status = 'rejected';
      saveChatState();
      renderPhase2();
      toast('Proposal rejected');
      return;
    }
    if (action === 'approve') return approveProposal(proposal);
    if (action === 'review') reviewProposal(proposal);
  }

  function approveProposal(proposal) {
    const workspace = loadWorkspace();
    if (!workspace) return;
    const approvedAt = now();
    const sourceMessage = String(proposal.sourceMessage || '').trim();
    workspace.memories.push({
      id: uid('memory'),
      spaceId: proposal.spaceId,
      title: proposal.title,
      content: proposal.content,
      type: proposal.type,
      importance: proposal.importance,
      ...(proposal.type === 'job' ? {
        details: proposal.content,
        project: proposal.project,
        priority: proposal.priority || 'normal',
        createdBy: 'external-ai',
        officeCollectedAt: null,
        officeJobId: null
      } : {}),
      source: sourceMessage
        ? `AI proposal approved by user · Chat: ${sourceMessage.slice(0, 120)}`
        : 'AI proposal approved by user',
      sourceKind: 'ai-proposal',
      sourceMessage,
      proposalReason: proposal.reason || '',
      approvedAt,
      locked: false,
      status: proposal.type === 'job' ? 'ready' : 'confirmed',
      createdAt: approvedAt,
      updatedAt: approvedAt
    });
    const space = workspace.spaces.find((item) => item.id === proposal.spaceId);
    if (space) space.updatedAt = approvedAt;
    saveWorkspace(workspace);
    proposal.status = 'approved';
    proposal.approvedAt = approvedAt;
    saveChatState();
    toast('Memory approved');
    setTimeout(() => location.reload(), 350);
  }

  function reviewProposal(proposal) {
    const dialog = document.getElementById('memoryDialog');
    if (!dialog) return;
    reviewingProposalId = proposal.id;
    document.getElementById('memoryDialogTitle').textContent = 'Review AI proposal';
    document.getElementById('memoryId').value = '';
    document.getElementById('memoryTitleInput').value = proposal.title;
    document.getElementById('memoryContentInput').value = proposal.content;
    document.getElementById('memoryTypeInput').value = proposal.type;
    document.getElementById('memoryImportanceInput').value = proposal.importance;
    document.getElementById('memoryProjectInput').value = proposal.project || '';
    document.getElementById('memoryPriorityInput').value = proposal.priority || 'normal';
    document.getElementById('memoryCreatedByInput').value = 'external-ai';
    document.getElementById('memoryTypeInput').dispatchEvent(new Event('change'));
    const sourceMessage = String(proposal.sourceMessage || '').trim();
    document.getElementById('memorySourceInput').value = sourceMessage
      ? `AI proposal · Chat: ${sourceMessage.slice(0, 120)}`
      : 'AI proposal · user reviewed';
    document.getElementById('memoryLockedInput').checked = false;
    dialog.showModal();
  }

  function clearChat() {
    const workspace = loadWorkspace();
    const space = getActiveSpace(workspace);
    if (!space) return;
    if (!confirm(`Clear chat history for “${space.name}”? Confirmed memories will stay.`)) return;
    chatState.messages = chatState.messages.filter((message) => message.spaceId !== space.id);
    chatState.proposals = chatState.proposals.filter((proposal) => proposal.spaceId !== space.id);
    saveChatState();
    renderPhase2();
    hideNotice();
    toast('Chat cleared');
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
  }

  function formatTime(value) {
    try { return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
    catch { return ''; }
  }

  function formatMessage(value) {
    return escapeHtml(value).replace(/\n/g, '<br>');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttr(value) { return escapeHtml(value); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLayout, { once: true });
  } else {
    injectLayout();
  }
})();
