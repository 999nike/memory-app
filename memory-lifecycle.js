(() => {
  'use strict';

  const STORAGE_KEY = 'memory-space-v1';
  const ACTIVE_STATUS = 'confirmed';
  let refreshQueued = false;

  const now = () => new Date().toISOString();
  const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;

  migrateWorkspace();

  document.addEventListener('submit', interceptMemoryEdit, true);
  document.addEventListener('click', interceptLifecycleActions, true);
  document.addEventListener('click', interceptContextView, true);

  const observer = new MutationObserver(queueRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', queueRefresh, { once: true });
  } else {
    queueRefresh();
  }

  function loadWorkspace() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || !Array.isArray(parsed.spaces) || !Array.isArray(parsed.memories)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveWorkspace(workspace) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  }

  function migrateWorkspace() {
    const workspace = loadWorkspace();
    if (!workspace) return;
    let changed = false;

    for (const memory of workspace.memories) {
      if (!memory.status) {
        memory.status = ACTIVE_STATUS;
        changed = true;
      }
      if (!memory.revisionGroupId) {
        memory.revisionGroupId = memory.id;
        changed = true;
      }
      if (!Number.isFinite(memory.revisionNumber)) {
        memory.revisionNumber = 1;
        changed = true;
      }
    }

    if (changed) saveWorkspace(workspace);
  }

  function confirmedMemories(workspace, spaceId) {
    return workspace.memories.filter((memory) => memory.spaceId === spaceId && (memory.status || ACTIVE_STATUS) === ACTIVE_STATUS);
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshUi();
    });
  }

  function refreshUi() {
    const workspace = loadWorkspace();
    if (!workspace) return;
    const activeSpace = workspace.spaces.find((space) => space.id === workspace.activeSpaceId) || workspace.spaces[0];
    if (!activeSpace) return;

    const active = confirmedMemories(workspace, activeSpace.id);
    const byId = new Map(workspace.memories.map((memory) => [memory.id, memory]));

    document.querySelectorAll('.memory-card[data-memory-id]').forEach((card) => {
      const memory = byId.get(card.dataset.memoryId);
      const shouldHide = Boolean(memory && (memory.status || ACTIVE_STATUS) !== ACTIVE_STATUS);
      if (card.hidden !== shouldHide) card.hidden = shouldHide;
    });

    setText(document.getElementById('visibleCount'), String(active.length));
    setText(document.getElementById('spaceMeta'), `${active.length} ${active.length === 1 ? 'memory' : 'memories'}`);

    const summary = document.getElementById('summaryStats');
    if (summary) {
      const locked = active.filter((memory) => memory.locked).length;
      const critical = active.filter((memory) => memory.importance === 'critical').length;
      const summaryKey = `${active.length}:${locked}:${critical}`;
      if (summary.dataset.lifecycleSnapshot !== summaryKey) {
        summary.dataset.lifecycleSnapshot = summaryKey;
        summary.innerHTML = `
          <div class="stat"><strong>${active.length}</strong><span>Active</span></div>
          <div class="stat"><strong>${locked}</strong><span>Locked</span></div>
          <div class="stat"><strong>${critical}</strong><span>Critical</span></div>`;
      }
    }

    document.querySelectorAll('.space-item[data-space-id]').forEach((button) => {
      const count = confirmedMemories(workspace, button.dataset.spaceId).length;
      const badge = button.querySelector('.space-memory-count');
      setText(badge, String(count));
    });

    decorateInspector(workspace);
  }

  function interceptMemoryEdit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== 'memoryForm') return;

    const id = document.getElementById('memoryId')?.value || '';
    if (!id) return;

    const workspace = loadWorkspace();
    const existing = workspace?.memories.find((memory) => memory.id === id);
    if (!workspace || !existing) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (existing.locked) {
      toast('Unlock this memory before changing it');
      return;
    }

    const next = {
      title: document.getElementById('memoryTitleInput')?.value.trim() || existing.title,
      content: document.getElementById('memoryContentInput')?.value.trim() || existing.content,
      type: document.getElementById('memoryTypeInput')?.value || existing.type,
      importance: document.getElementById('memoryImportanceInput')?.value || existing.importance,
      source: document.getElementById('memorySourceInput')?.value.trim() || existing.source || 'User confirmed',
      locked: Boolean(document.getElementById('memoryLockedInput')?.checked)
    };

    const substantiveChange = ['title', 'content', 'type', 'importance', 'source']
      .some((key) => String(existing[key] ?? '') !== String(next[key] ?? ''));

    if (!substantiveChange) {
      existing.locked = next.locked;
      existing.updatedAt = now();
      saveWorkspace(workspace);
      document.getElementById('memoryDialog')?.close();
      toast('Memory updated');
      setTimeout(() => location.reload(), 180);
      return;
    }

    const changedAt = now();
    const revisionGroupId = existing.revisionGroupId || existing.id;
    const newMemory = {
      ...existing,
      id: uid('memory'),
      ...next,
      status: ACTIVE_STATUS,
      revisionGroupId,
      revisionNumber: Number(existing.revisionNumber || 1) + 1,
      supersedesId: existing.id,
      supersededById: null,
      createdAt: changedAt,
      updatedAt: changedAt,
      revisedAt: changedAt,
      revisionReason: 'User edited confirmed memory'
    };

    delete newMemory.supersededAt;
    delete newMemory.archivedAt;

    existing.status = 'superseded';
    existing.supersededAt = changedAt;
    existing.supersededById = newMemory.id;
    existing.locked = true;
    existing.updatedAt = changedAt;

    workspace.memories.push(newMemory);
    const space = workspace.spaces.find((item) => item.id === existing.spaceId);
    if (space) space.updatedAt = changedAt;
    saveWorkspace(workspace);

    document.getElementById('memoryDialog')?.close();
    toast(`Saved as version ${newMemory.revisionNumber}`);
    setTimeout(() => location.reload(), 220);
  }

  function interceptLifecycleActions(event) {
    const button = event.target.closest?.('[data-action="delete"]');
    if (!button) return;

    const workspace = loadWorkspace();
    const memory = workspace?.memories.find((item) => item.id === button.dataset.memoryId);
    if (!workspace || !memory) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (memory.locked) {
      toast('Unlock this memory before archiving it');
      return;
    }

    if (!confirm(`Archive “${memory.title}”? It will leave active AI context but remain in history.`)) return;

    const archivedAt = now();
    memory.status = 'archived';
    memory.archivedAt = archivedAt;
    memory.updatedAt = archivedAt;
    memory.locked = true;
    saveWorkspace(workspace);
    toast('Memory archived');
    setTimeout(() => location.reload(), 220);
  }

  function decorateInspector(workspace) {
    const detail = document.getElementById('detailContent');
    if (!detail) return;
    const id = detail.querySelector('[data-memory-id]')?.dataset.memoryId;
    if (!id) return;

    const memory = workspace.memories.find((item) => item.id === id);
    if (!memory) return;

    const deleteButton = detail.querySelector('[data-action="delete"]');
    if (deleteButton && deleteButton.textContent !== 'Archive') deleteButton.textContent = 'Archive';

    const groupId = memory.revisionGroupId || memory.id;
    const revisions = workspace.memories
      .filter((item) => (item.revisionGroupId || item.id) === groupId)
      .sort((a, b) => Number(b.revisionNumber || 1) - Number(a.revisionNumber || 1));

    const historyKey = revisions.map((item) => `${item.id}:${item.status}:${item.updatedAt}`).join('|');
    const existingHistory = detail.querySelector('[data-memory-history]');
    if (existingHistory && detail.dataset.memoryHistoryKey === historyKey) return;

    existingHistory?.remove();
    detail.dataset.memoryHistoryKey = historyKey;

    const block = document.createElement('div');
    block.className = 'detail-block memory-history-block';
    block.dataset.memoryHistory = 'true';
    block.innerHTML = `
      <label>History</label>
      <div class="memory-history-list">
        ${revisions.map((item) => `
          <div class="memory-history-item ${item.id === memory.id ? 'current' : ''}">
            <div><strong>v${Number(item.revisionNumber || 1)}</strong><span>${escapeHtml(statusLabel(item.status || ACTIVE_STATUS))}</span></div>
            <p>${escapeHtml(item.content)}</p>
            <small>${escapeHtml(formatDateTime(item.updatedAt || item.createdAt))}</small>
          </div>`).join('')}
      </div>`;

    const actions = detail.querySelector('.detail-actions');
    detail.insertBefore(block, actions || null);
  }

  function interceptContextView(event) {
    const button = event.target.closest?.('#contextButton');
    if (!button) return;

    const workspace = loadWorkspace();
    const space = workspace?.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace?.spaces[0];
    if (!workspace || !space) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const memories = confirmedMemories(workspace, space.id).sort((a, b) => {
      const order = { critical: 0, high: 1, normal: 2, low: 3 };
      return (order[a.importance] ?? 9) - (order[b.importance] ?? 9);
    });

    const lines = [`SPACE: ${space.name}`, `PURPOSE: ${space.description}`, '', 'TRUSTED ACTIVE MEMORY:'];
    if (!memories.length) lines.push('- No confirmed active memories yet.');
    for (const memory of memories) {
      lines.push(`- [${String(memory.importance || 'normal').toUpperCase()}] [${String(memory.type || 'note').toUpperCase()}] ${memory.title}`);
      lines.push(`  ${memory.content}`);
      lines.push(`  Version: ${Number(memory.revisionNumber || 1)}${memory.locked ? ' · Locked by user' : ''}`);
      if (memory.source) lines.push(`  Source: ${memory.source}`);
    }
    lines.push('', 'RULE: Superseded and archived memories are history only and must not be treated as current truth.');

    const preview = document.getElementById('contextPreview');
    setText(preview, lines.join('\n'));
    document.getElementById('contextDialog')?.showModal();
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1900);
  }

  function statusLabel(value) {
    if (value === 'confirmed') return 'Current';
    if (value === 'superseded') return 'Superseded';
    if (value === 'archived') return 'Archived';
    return value || 'Unknown';
  }

  function formatDateTime(value) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return '';
    }
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
