(() => {
  'use strict';

  const STORAGE_KEY = 'memory-space-v1';
  const TYPE_LABELS = {
    decision: 'Decision',
    fact: 'Fact',
    goal: 'Goal',
    question: 'Question',
    note: 'Note',
    job: 'Job'
  };

  const now = () => new Date().toISOString();
  const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;

  const initialState = {
    version: 1,
    activeSpaceId: 'space_memory_app',
    spaces: [
      {
        id: 'space_memory_app',
        name: 'Memory App',
        description: 'A private, visible long-term context space controlled by the user and built together with an AI.',
        createdAt: now(),
        updatedAt: now()
      }
    ],
    memories: [
      {
        id: 'memory_visible',
        spaceId: 'space_memory_app',
        title: 'Memory must be visible',
        content: 'The user should be able to see, understand, edit, lock, export, and delete the information an AI uses as long-term context.',
        type: 'decision',
        importance: 'critical',
        source: 'User confirmed in project conversation',
        locked: true,
        status: 'confirmed',
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: 'memory_local',
        spaceId: 'space_memory_app',
        title: 'Local-first and private',
        content: 'Version one stores its workspace on the user’s device. Pinecone, Upstash, accounts, and cloud sync are deliberately excluded from the first build.',
        type: 'decision',
        importance: 'critical',
        source: 'User confirmed in project conversation',
        locked: true,
        status: 'confirmed',
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: 'memory_product',
        spaceId: 'space_memory_app',
        title: 'The shared space is the product',
        content: 'This is not a hidden chatbot memory list. It is a dedicated virtual workspace that a human and AI can both interact with over time.',
        type: 'goal',
        importance: 'critical',
        source: 'User confirmed in project conversation',
        locked: true,
        status: 'confirmed',
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: 'memory_ai_connection',
        spaceId: 'space_memory_app',
        title: 'How should AI access be granted?',
        content: 'Define a permission model where each AI can only read or propose changes within spaces the user explicitly authorises.',
        type: 'question',
        importance: 'high',
        source: 'Phase 2 planning',
        locked: false,
        status: 'confirmed',
        createdAt: now(),
        updatedAt: now()
      }
    ]
  };

  let state = loadState();
  let activeFilter = 'all';
  let searchTerm = '';
  let selectedMemoryId = null;
  let directInspectorActive = false;
  let toastTimer;

  const els = {
    appShell: document.querySelector('.app-shell'),
    sidebar: document.getElementById('sidebar'),
    sidebarBackdrop: document.getElementById('sidebarBackdrop'),
    spaceList: document.getElementById('spaceList'),
    spaceCount: document.getElementById('spaceCount'),
    spaceTitle: document.getElementById('spaceTitle'),
    spaceMeta: document.getElementById('spaceMeta'),
    spaceDescription: document.getElementById('spaceDescription'),
    summaryStats: document.getElementById('summaryStats'),
    memoryGrid: document.getElementById('memoryGrid'),
    visibleCount: document.getElementById('visibleCount'),
    emptyState: document.getElementById('emptyState'),
    searchInput: document.getElementById('searchInput'),
    filterRow: document.getElementById('filterRow'),
    detailPanel: document.getElementById('detailPanel'),
    detailTitle: document.getElementById('detailTitle'),
    detailContent: document.getElementById('detailContent'),
    memoryDialog: document.getElementById('memoryDialog'),
    memoryForm: document.getElementById('memoryForm'),
    memoryDialogTitle: document.getElementById('memoryDialogTitle'),
    memoryId: document.getElementById('memoryId'),
    memoryTitleInput: document.getElementById('memoryTitleInput'),
    memoryContentInput: document.getElementById('memoryContentInput'),
    memoryTypeInput: document.getElementById('memoryTypeInput'),
    memoryImportanceInput: document.getElementById('memoryImportanceInput'),
    memoryJobFields: document.getElementById('memoryJobFields'),
    memoryProjectInput: document.getElementById('memoryProjectInput'),
    memoryPriorityInput: document.getElementById('memoryPriorityInput'),
    memoryCreatedByInput: document.getElementById('memoryCreatedByInput'),
    memorySourceInput: document.getElementById('memorySourceInput'),
    memoryLockedInput: document.getElementById('memoryLockedInput'),
    spaceDialog: document.getElementById('spaceDialog'),
    spaceForm: document.getElementById('spaceForm'),
    spaceNameInput: document.getElementById('spaceNameInput'),
    spaceDescriptionInput: document.getElementById('spaceDescriptionInput'),
    contextDialog: document.getElementById('contextDialog'),
    contextPreview: document.getElementById('contextPreview'),
    toast: document.getElementById('toast'),
    importInput: document.getElementById('importInput')
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(initialState);
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.spaces) || !Array.isArray(parsed.memories)) {
        return structuredClone(initialState);
      }
      if (!parsed.spaces.some((space) => space.id === parsed.activeSpaceId)) {
        parsed.activeSpaceId = parsed.spaces[0]?.id || null;
      }
      return parsed;
    } catch (error) {
      console.error('Could not load workspace:', error);
      return structuredClone(initialState);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function activeSpace() {
    return state.spaces.find((space) => space.id === state.activeSpaceId) || state.spaces[0];
  }

  function memoriesForSpace(spaceId = state.activeSpaceId) {
    return state.memories.filter((memory) => memory.spaceId === spaceId);
  }

  function render() {
    if (!state.spaces.length) {
      state = structuredClone(initialState);
      saveState();
    }
    renderSpaces();
    renderHeader();
    renderMemories();
    if (selectedMemoryId) renderInspector(selectedMemoryId);
  }

  function renderSpaces() {
    els.spaceCount.textContent = String(state.spaces.length);
    els.spaceList.innerHTML = state.spaces.map((space) => {
      const count = memoriesForSpace(space.id).length;
      return `
        <button class="space-item ${space.id === state.activeSpaceId ? 'active' : ''}" data-space-id="${escapeAttr(space.id)}">
          <span class="space-icon">${escapeHtml(space.name.trim().charAt(0).toUpperCase() || 'S')}</span>
          <span class="space-name">${escapeHtml(space.name)}</span>
          <span class="space-memory-count">${count}</span>
        </button>`;
    }).join('');
  }

  function renderHeader() {
    const space = activeSpace();
    if (!space) return;
    const memories = memoriesForSpace();
    const locked = memories.filter((memory) => memory.locked).length;
    const critical = memories.filter((memory) => memory.importance === 'critical').length;

    els.spaceTitle.textContent = space.name;
    els.spaceMeta.textContent = `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}`;
    els.spaceDescription.textContent = space.description;
    els.summaryStats.innerHTML = `
      <div class="stat"><strong>${memories.length}</strong><span>Total</span></div>
      <div class="stat"><strong>${locked}</strong><span>Locked</span></div>
      <div class="stat"><strong>${critical}</strong><span>Critical</span></div>`;
  }

  function filteredMemories() {
    const query = searchTerm.trim().toLowerCase();
    return memoriesForSpace()
      .filter((memory) => activeFilter === 'all' || memory.type === activeFilter)
      .filter((memory) => !query || [memory.title, memory.content, memory.source, memory.type, memory.importance, memory.project, memory.priority]
        .some((value) => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => {
        const order = { critical: 0, high: 1, normal: 2, low: 3 };
        return (order[a.importance] - order[b.importance]) || b.updatedAt.localeCompare(a.updatedAt);
      });
  }

  function renderMemories() {
    const memories = filteredMemories();
    els.visibleCount.textContent = String(memories.length);
    els.memoryGrid.hidden = memories.length === 0;
    els.emptyState.hidden = memories.length !== 0;
    els.memoryGrid.innerHTML = memories.map((memory) => `
      <button class="memory-card ${memory.id === selectedMemoryId ? 'selected' : ''}" data-memory-id="${escapeAttr(memory.id)}">
        <span class="card-top">
          <span class="type-badge ${escapeAttr(memory.type)}">${escapeHtml(TYPE_LABELS[memory.type] || memory.type)}</span>
          <span class="importance-badge ${escapeAttr(memory.importance)}">${escapeHtml(memory.importance)}</span>
        </span>
        <h3>${escapeHtml(memory.title)}</h3>
        <p>${escapeHtml(memory.content)}</p>
        <span class="card-footer">
          <span>${formatDate(memory.updatedAt)}</span>
          ${memory.type === 'job'
            ? `<span>${memory.officeCollectedAt ? 'Collected' : 'Ready for Office'}</span>`
            : memory.locked ? '<span class="lock-badge">Locked</span>' : '<span>Editable</span>'}
        </span>
      </button>`).join('');
  }

  function renderInspector(memoryId, options = {}) {
    const memory = state.memories.find((item) => item.id === memoryId && item.spaceId === state.activeSpaceId);
    if (!memory) {
      closeInspector();
      return;
    }

    selectedMemoryId = memory.id;
    directInspectorActive = options.preserveWorkspace === true;
    els.appShell.classList.toggle('detail-overlay', directInspectorActive);
    els.appShell.classList.add('detail-open');
    els.detailTitle.textContent = memory.title;
    els.detailContent.innerHTML = `
      <div class="detail-block">
        <label>Memory</label>
        <p>${escapeHtml(memory.content)}</p>
      </div>
      <div class="detail-block">
        <label>Classification</label>
        <p>${escapeHtml(TYPE_LABELS[memory.type] || memory.type)} · ${escapeHtml(capitalise(memory.importance))} importance · ${memory.locked ? 'Locked' : 'Editable'}</p>
      </div>
      <div class="detail-block">
        <label>Source</label>
        <p>${escapeHtml(memory.source || 'No source recorded')}</p>
      </div>
      <div class="detail-block">
        <label>Status</label>
        <p>${escapeHtml(capitalise(memory.status || 'confirmed'))}</p>
      </div>
      ${memory.type === 'job' ? `<div class="detail-block"><label>Office feed</label><p>${escapeHtml(memory.project)} · ${escapeHtml(capitalise(memory.priority || 'normal'))}${memory.officeJobId ? ` · Office job ${escapeHtml(memory.officeJobId)}` : ' · Waiting for collection'}</p></div>` : ''}
      <div class="detail-block">
        <label>Created</label>
        <p>${formatDateTime(memory.createdAt)}</p>
      </div>
      <div class="detail-block">
        <label>Last updated</label>
        <p>${formatDateTime(memory.updatedAt)}</p>
      </div>
      <div class="detail-actions">
        <button class="ghost-button" data-action="toggle-lock" data-memory-id="${escapeAttr(memory.id)}">${memory.locked ? 'Unlock' : 'Lock'}</button>
        <button class="ghost-button" data-action="edit" data-memory-id="${escapeAttr(memory.id)}">Edit</button>
        <button class="ghost-button danger-button" data-action="delete" data-memory-id="${escapeAttr(memory.id)}">Delete</button>
        <button class="ghost-button" data-action="copy" data-memory-id="${escapeAttr(memory.id)}">Copy</button>
      </div>`;
    if (!directInspectorActive) renderMemories();
  }

  function closeInspector() {
    const preserveWorkspace = directInspectorActive;
    directInspectorActive = false;
    selectedMemoryId = null;
    els.appShell.classList.remove('detail-open');
    els.appShell.classList.remove('detail-overlay');
    els.detailTitle.textContent = 'Select a memory';
    els.detailContent.innerHTML = `
      <div class="inspector-placeholder">
        <div class="empty-icon" aria-hidden="true">◇</div>
        <p>Select a memory to see its status, source, history, and controls.</p>
      </div>`;
    if (!preserveWorkspace) renderMemories();
  }

  function openMemoryInspector(memoryId) {
    const id = String(memoryId || '');
    if (!id || !state.memories.some((memory) => memory.id === id && memory.spaceId === state.activeSpaceId)) return false;
    renderInspector(id, { preserveWorkspace: true });
    return true;
  }

  function openMemoryDialog(memory = null) {
    const editing = Boolean(memory);
    els.memoryDialogTitle.textContent = editing ? 'Edit memory' : 'Add memory';
    els.memoryId.value = memory?.id || '';
    els.memoryTitleInput.value = memory?.title || '';
    els.memoryContentInput.value = memory?.content || '';
    els.memoryTypeInput.value = memory?.type || 'decision';
    els.memoryImportanceInput.value = memory?.importance || 'normal';
    els.memoryProjectInput.value = memory?.project || '';
    els.memoryPriorityInput.value = memory?.priority || 'normal';
    els.memoryCreatedByInput.value = memory?.createdBy || 'user';
    els.memorySourceInput.value = memory?.source || 'User confirmed';
    els.memoryLockedInput.checked = Boolean(memory?.locked);
    updateJobFields();
    els.memoryDialog.showModal();
    requestAnimationFrame(() => els.memoryTitleInput.focus());
  }

  function submitMemory(event) {
    event.preventDefault();
    const id = els.memoryId.value;
    const existing = state.memories.find((memory) => memory.id === id);

    if (existing?.locked) {
      showToast('Unlock this memory before editing it');
      return;
    }

    const isJob = els.memoryTypeInput.value === 'job';
    const project = els.memoryProjectInput.value.trim();
    if (isJob && !project) {
      showToast('Choose the Code Space project for this job');
      els.memoryProjectInput.focus();
      return;
    }

    const payload = {
      title: els.memoryTitleInput.value.trim(),
      content: els.memoryContentInput.value.trim(),
      type: els.memoryTypeInput.value,
      importance: els.memoryImportanceInput.value,
      source: els.memorySourceInput.value.trim() || 'User confirmed',
      locked: els.memoryLockedInput.checked,
      status: isJob ? 'ready' : 'confirmed',
      ...(isJob ? {
        details: els.memoryContentInput.value.trim(),
        project,
        priority: els.memoryPriorityInput.value,
        createdBy: els.memoryCreatedByInput.value || existing?.createdBy || 'user',
        officeCollectedAt: existing?.officeCollectedAt || null,
        officeJobId: existing?.officeJobId || null
      } : {}),
      updatedAt: now()
    };

    if (existing) {
      Object.assign(existing, payload);
      if (!isJob) {
        delete existing.details;
        delete existing.project;
        delete existing.priority;
        delete existing.createdBy;
        delete existing.officeCollectedAt;
        delete existing.officeJobId;
      }
      selectedMemoryId = existing.id;
    } else {
      const memory = {
        id: uid('memory'),
        spaceId: state.activeSpaceId,
        createdAt: now(),
        ...payload
      };
      state.memories.push(memory);
      selectedMemoryId = memory.id;
    }

    touchActiveSpace();
    saveState();
    els.memoryDialog.close();
    render();
    renderInspector(selectedMemoryId);
    showToast(existing ? 'Memory updated' : 'Memory saved');
  }

  function submitSpace(event) {
    event.preventDefault();
    const space = {
      id: uid('space'),
      name: els.spaceNameInput.value.trim(),
      description: els.spaceDescriptionInput.value.trim(),
      createdAt: now(),
      updatedAt: now()
    };
    state.spaces.push(space);
    state.activeSpaceId = space.id;
    selectedMemoryId = null;
    saveState();
    els.spaceDialog.close();
    els.spaceForm.reset();
    render();
    closeMobileSidebar();
    showToast('Space created');
  }

  function switchSpace(spaceId) {
    if (!state.spaces.some((space) => space.id === spaceId)) return;
    state.activeSpaceId = spaceId;
    activeFilter = 'all';
    searchTerm = '';
    els.searchInput.value = '';
    document.querySelectorAll('.filter-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === 'all'));
    closeInspector();
    saveState();
    render();
    closeMobileSidebar();
  }

  function handleInspectorAction(action, memoryId) {
    const memory = state.memories.find((item) => item.id === memoryId);
    if (!memory) return;

    if (action === 'edit') {
      if (memory.locked) {
        showToast('Unlock this memory before editing it');
        return;
      }
      openMemoryDialog(memory);
    }

    if (action === 'toggle-lock') {
      memory.locked = !memory.locked;
      memory.updatedAt = now();
      saveState();
      render();
      renderInspector(memory.id);
      showToast(memory.locked ? 'Memory locked' : 'Memory unlocked');
    }

    if (action === 'delete') {
      if (memory.locked) {
        showToast('Unlock this memory before deleting it');
        return;
      }
      const confirmed = window.confirm(`Delete “${memory.title}”? This cannot be undone.`);
      if (!confirmed) return;
      state.memories = state.memories.filter((item) => item.id !== memory.id);
      saveState();
      closeInspector();
      render();
      showToast('Memory deleted');
    }

    if (action === 'copy') {
      copyText(`${memory.title}\n\n${memory.content}\n\nSource: ${memory.source || 'Not recorded'}`)
        .then(() => showToast('Memory copied'));
    }
  }

  function buildContext() {
    const space = activeSpace();
    const memories = memoriesForSpace()
      .filter((memory) => (memory.status || 'confirmed') === 'confirmed' && memory.type !== 'job')
      .sort((a, b) => {
      const order = { critical: 0, high: 1, normal: 2, low: 3 };
      return (order[a.importance] - order[b.importance]) || a.type.localeCompare(b.type);
    });

    const lines = [
      `SPACE: ${space.name}`,
      `PURPOSE: ${space.description}`,
      '',
      'TRUSTED MEMORY:'
    ];

    if (!memories.length) lines.push('- No confirmed memories yet.');
    memories.forEach((memory) => {
      lines.push(`- [${memory.importance.toUpperCase()}] [${TYPE_LABELS[memory.type]?.toUpperCase() || memory.type.toUpperCase()}] ${memory.title}`);
      lines.push(`  ${memory.content}`);
      lines.push(`  Source: ${memory.source || 'Not recorded'}${memory.locked ? ' · Locked by user' : ''}`);
    });

    lines.push('', 'RULE: Treat locked memories as user-confirmed constraints. Ask before changing or superseding them.');
    return lines.join('\n');
  }

  function showContext() {
    els.contextPreview.textContent = buildContext();
    els.contextDialog.showModal();
  }

  function updateJobFields() {
    const isJob = els.memoryTypeInput.value === 'job';
    els.memoryJobFields.hidden = !isJob;
    els.memoryProjectInput.required = isJob;
  }

  function exportWorkspace() {
    const exportData = {
      exportedAt: now(),
      app: 'Memory Space',
      ...state
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `memory-space-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('Workspace exported');
  }

  async function importWorkspace(file) {
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (imported.version !== 1 || !Array.isArray(imported.spaces) || !Array.isArray(imported.memories)) {
        throw new Error('Unsupported workspace file');
      }
      if (!imported.spaces.length) throw new Error('Workspace contains no spaces');
      const confirmed = window.confirm('Replace the current local workspace with this imported file?');
      if (!confirmed) return;
      state = {
        version: 1,
        activeSpaceId: imported.spaces.some((space) => space.id === imported.activeSpaceId)
          ? imported.activeSpaceId
          : imported.spaces[0].id,
        spaces: imported.spaces,
        memories: imported.memories
      };
      selectedMemoryId = null;
      saveState();
      closeInspector();
      render();
      showToast('Workspace imported');
    } catch (error) {
      console.error(error);
      showToast('Could not import that file');
    } finally {
      els.importInput.value = '';
    }
  }

  function touchActiveSpace() {
    const space = activeSpace();
    if (space) space.updatedAt = now();
  }

  function openMobileSidebar() {
    els.sidebar.classList.add('open');
    els.sidebarBackdrop.hidden = false;
  }

  function closeMobileSidebar() {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.hidden = true;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(value));
  }

  function formatDateTime(value) {
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }).format(new Date(value));
  }

  function capitalise(value) {
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  globalThis.MemoryApp = Object.freeze({
    openMemoryInspector,
    graphNodeIds() {
      const space = activeSpace();
      if (!space?.id) return [];
      return [
        String(space.id),
        ...memoriesForSpace(space.id)
          .filter((memory) => String(memory.status || 'confirmed') === 'confirmed')
          .map((memory) => String(memory.id || ''))
          .filter(Boolean)
      ];
    }
  });

  document.getElementById('newMemoryButton').addEventListener('click', () => openMemoryDialog());
  document.getElementById('emptyAddButton').addEventListener('click', () => openMemoryDialog());
  document.getElementById('newSpaceButton').addEventListener('click', () => {
    els.spaceForm.reset();
    els.spaceDialog.showModal();
    requestAnimationFrame(() => els.spaceNameInput.focus());
  });
  document.getElementById('contextButton').addEventListener('click', showContext);
  document.getElementById('exportButton').addEventListener('click', exportWorkspace);
  document.getElementById('copyContextButton').addEventListener('click', () => {
    copyText(buildContext()).then(() => showToast('Context copied'));
  });
  document.getElementById('closeDetailButton').addEventListener('click', closeInspector);
  document.getElementById('openSidebarButton').addEventListener('click', openMobileSidebar);
  document.getElementById('closeSidebarButton').addEventListener('click', closeMobileSidebar);
  els.sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog)?.close());
  });

  els.memoryForm.addEventListener('submit', submitMemory);
  els.memoryTypeInput.addEventListener('change', updateJobFields);
  window.addEventListener('memory-job-acknowledged', () => {
    state = loadState();
    render();
  });
  els.spaceForm.addEventListener('submit', submitSpace);
  els.importInput.addEventListener('change', () => {
    const file = els.importInput.files?.[0];
    if (file) importWorkspace(file);
  });

  els.spaceList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-space-id]');
    if (button) switchSpace(button.dataset.spaceId);
  });

  els.memoryGrid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-memory-id]');
    if (card) renderInspector(card.dataset.memoryId);
  });

  els.detailContent.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) handleInspectorAction(button.dataset.action, button.dataset.memoryId);
  });

  els.searchInput.addEventListener('input', () => {
    searchTerm = els.searchInput.value;
    renderMemories();
  });

  els.filterRow.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    activeFilter = chip.dataset.filter;
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.toggle('active', item === chip));
    renderMemories();
  });

  [els.memoryDialog, els.spaceDialog, els.contextDialog].forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) dialog.close();
    });
  });

  render();
})();
