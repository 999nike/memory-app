(() => {
  'use strict';

  const VERSION = 2;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';

  let workspaceRaw = '';
  let workspaceCache = null;
  let groupRaw = '';
  let groupCache = null;
  let addButton = null;

  function readWorkspace() {
    const raw = localStorage.getItem(WORKSPACE_KEY) || '';
    if (raw === workspaceRaw && workspaceCache) return workspaceCache;
    workspaceRaw = raw;
    try {
      const parsed = JSON.parse(raw || 'null');
      workspaceCache = parsed && Array.isArray(parsed.spaces) && Array.isArray(parsed.memories) ? parsed : null;
    } catch {
      workspaceCache = null;
    }
    return workspaceCache;
  }

  function emptyStore() {
    return { version: 1, spaces: {} };
  }

  function readStore() {
    const raw = localStorage.getItem(GROUP_KEY) || '';
    if (raw === groupRaw && groupCache) return groupCache;
    groupRaw = raw;
    try {
      const parsed = JSON.parse(raw || 'null');
      groupCache = parsed?.spaces && typeof parsed.spaces === 'object' ? parsed : emptyStore();
      if (!Number.isFinite(Number(groupCache.version))) groupCache.version = 1;
    } catch {
      groupCache = emptyStore();
    }
    return groupCache;
  }

  function saveStore(store) {
    try {
      const raw = JSON.stringify(store);
      localStorage.setItem(GROUP_KEY, raw);
      groupRaw = raw;
      groupCache = store;
      return true;
    } catch {
      return false;
    }
  }

  function activeSpaceId() {
    const workspace = readWorkspace();
    return String(workspace?.activeSpaceId || workspace?.spaces?.[0]?.id || '');
  }

  function groupsForSpace(spaceId = activeSpaceId()) {
    if (!spaceId) return [];
    const store = readStore();
    if (!Array.isArray(store.spaces[spaceId])) store.spaces[spaceId] = [];
    return store.spaces[spaceId];
  }

  function writeGroups(groups, spaceId = activeSpaceId()) {
    if (!spaceId || !Array.isArray(groups)) return false;
    const store = readStore();
    store.spaces[spaceId] = groups;
    return saveStore(store);
  }

  function memoryById(memoryId) {
    const workspace = readWorkspace();
    return workspace?.memories?.find((memory) => String(memory.id) === String(memoryId)) || null;
  }

  function groupForMemory(memoryId) {
    const id = String(memoryId || '');
    if (!id) return null;
    return groupsForSpace().find((group) =>
      Array.isArray(group.members) && group.members.some((memberId) => String(memberId) === id)
    ) || null;
  }

  function ownsMemory(memoryId) {
    return Boolean(groupForMemory(memoryId));
  }

  function createGroup(title) {
    const name = String(title || '').trim().slice(0, 48);
    if (!name) return false;

    const groups = [...groupsForSpace()];
    const index = groups.length;
    groups.push({
      id: `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      title: name,
      angle: -Math.PI / 2 + index * 2.399963229728653,
      phase: (index * 1.173 + 0.52) % (Math.PI * 2),
      members: [],
      createdAt: new Date().toISOString()
    });

    if (!writeGroups(groups)) return false;
    requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
    return true;
  }

  function detachMemory(memoryId) {
    const id = String(memoryId || '');
    if (!id) return false;

    let changed = false;
    const groups = groupsForSpace().map((group) => {
      const members = (group.members || []).filter((memberId) => String(memberId) !== id);
      if (members.length !== (group.members || []).length) changed = true;
      return { ...group, members };
    });

    return changed ? writeGroups(groups) : false;
  }

  function addMemoryToGroup(memoryId, groupId) {
    const id = String(memoryId || '');
    const targetId = String(groupId || '');
    if (!id || !targetId) return false;

    const memory = memoryById(id);
    if (!memory || String(memory.spaceId) !== activeSpaceId()) return false;

    let found = false;
    const groups = groupsForSpace().map((group) => {
      const members = (group.members || []).filter((memberId) => String(memberId) !== id);
      if (String(group.id) === targetId) {
        members.push(id);
        found = true;
      }
      return { ...group, members };
    });

    return found ? writeGroups(groups) : false;
  }

  function replaceGroups(groups, spaceId = activeSpaceId()) {
    return writeGroups(groups, spaceId);
  }

  function installStyles() {
    if (document.getElementById('manualGravityGroupStyles')) return;
    const style = document.createElement('style');
    style.id = 'manualGravityGroupStyles';
    style.textContent = `
      .memory-graph-group-add {
        position:absolute;
        top:12px;
        right:12px;
        z-index:6;
        width:34px;
        height:34px;
        display:grid;
        place-items:center;
        border:1px solid rgb(199 255 86 / 0.42);
        border-radius:50%;
        background:radial-gradient(circle at 35% 30%, rgb(199 255 86 / 0.22), rgb(10 17 27 / 0.94) 62%);
        color:#c7ff56;
        font:800 20px/1 Inter,system-ui,sans-serif;
        box-shadow:0 0 18px rgb(199 255 86 / 0.12), inset 0 0 10px rgb(120 184 255 / 0.08);
        cursor:pointer;
      }
      .memory-graph-group-add:hover {
        border-color:rgb(199 255 86 / 0.72);
        box-shadow:0 0 22px rgb(199 255 86 / 0.20), inset 0 0 12px rgb(120 184 255 / 0.10);
      }
      @media (max-width:800px) {
        .memory-graph-group-add { top:9px; right:9px; width:32px; height:32px; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureAddButton() {
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface) return false;

    if (!addButton || !addButton.isConnected) {
      addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'memory-graph-group-add';
      addButton.setAttribute('aria-label', 'Add memory group bubble');
      addButton.title = 'Add memory group bubble';
      addButton.textContent = '+';
      addButton.addEventListener('click', () => {
        const title = window.prompt('Group bubble title');
        if (title) createGroup(title);
      });
      surface.appendChild(addButton);
    }

    return true;
  }

  function mountUi() {
    installStyles();
    return ensureAddButton();
  }

  globalThis.MemoryGraphManualGroups = Object.freeze({
    version: VERSION,
    storageKey: GROUP_KEY,
    activeSpaceId,
    ownsMemory,
    groupForMemory,
    createGroup,
    detachMemory,
    addMemoryToGroup,
    replaceGroups,
    groups: () => groupsForSpace().map((group) => ({ ...group, members: [...(group.members || [])] }))
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mountUi), { once: true });
  } else {
    requestAnimationFrame(mountUi);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === WORKSPACE_KEY) {
      workspaceRaw = '';
      workspaceCache = null;
    }
    if (event.key === GROUP_KEY) {
      groupRaw = '';
      groupCache = null;
    }
  });
})();
