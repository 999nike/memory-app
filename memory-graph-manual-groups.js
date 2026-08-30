(() => {
  'use strict';

  const VERSION = 5;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';
  const GROUP_CLICK_THRESHOLD = 6;

  let workspaceRaw = '';
  let workspaceCache = null;
  let groupRaw = '';
  let groupCache = null;
  let addButton = null;
  let inspector = null;
  let inspectorTitle = null;
  let inspectorList = null;
  let inspectorDelete = null;
  let activeInspectorGroupId = null;
  let pointerCandidate = null;
  const titleHits = new Map();

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
    return readWorkspace()?.memories?.find((memory) => String(memory.id) === String(memoryId)) || null;
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

  function deleteGroup(groupId) {
    const id = String(groupId || '');
    if (!id) return false;
    const groups = groupsForSpace();
    if (!groups.some((group) => String(group.id) === id)) return false;
    if (!writeGroups(groups.filter((group) => String(group.id) !== id))) return false;
    titleHits.delete(id);
    if (String(activeInspectorGroupId || '') === id) closeGroup();
    return true;
  }

  function replaceGroups(groups, spaceId = activeSpaceId()) {
    return writeGroups(groups, spaceId);
  }

  function shownGroupTitle(group) {
    const title = String(group?.title || 'Group');
    return title.length > 15 ? `${title.slice(0, 14).trim()}…` : title;
  }

  function installCanvasHitHook() {
    const proto = globalThis.CanvasRenderingContext2D?.prototype;
    if (!proto || proto.__manualGroupTitleHitHook) return;
    Object.defineProperty(proto, '__manualGroupTitleHitHook', { value: true });
    const previousFillText = proto.fillText;
    proto.fillText = function manualGroupTitleHitText(text, x, y, ...rest) {
      if (this?.canvas?.classList?.contains('memory-graph-manual-gravity-body-canvas')) {
        const group = groupsForSpace().find((item) => shownGroupTitle(item) === String(text || ''));
        if (group) {
          const width = Math.max(72, this.measureText(String(text || '')).width + 30);
          titleHits.set(String(group.id), {
            left: Number(x) - width / 2,
            right: Number(x) + width / 2,
            top: Number(y) - 18,
            bottom: Number(y) + 32
          });
        }
      }
      return previousFillText.call(this, text, x, y, ...rest);
    };
  }

  function hitGroupTitle(point) {
    const groups = groupsForSpace();
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      const hit = titleHits.get(String(group.id));
      if (hit && point.x >= hit.left && point.x <= hit.right && point.y >= hit.top && point.y <= hit.bottom) return group;
    }
    return null;
  }

  function surfacePoint(event, surface) {
    const rect = surface.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function installTitlePointerHooks() {
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface || surface.__manualGroupTitlePointerHooks) return false;
    surface.__manualGroupTitlePointerHooks = true;

    surface.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !event.target?.classList?.contains('memory-graph-canvas')) return;
      const point = surfacePoint(event, surface);
      const group = hitGroupTitle(point);
      pointerCandidate = group ? {
        pointerId: event.pointerId,
        groupId: String(group.id),
        startX: point.x,
        startY: point.y
      } : null;
    }, true);

    surface.addEventListener('pointermove', (event) => {
      const canvas = surface.querySelector('.memory-graph-canvas');
      if (!event.target?.classList?.contains('memory-graph-canvas')) {
        canvas?.removeAttribute('data-hover-group-title');
        return;
      }
      const point = surfacePoint(event, surface);
      if (hitGroupTitle(point)) canvas?.setAttribute('data-hover-group-title', 'true');
      else canvas?.removeAttribute('data-hover-group-title');
      if (pointerCandidate?.pointerId === event.pointerId &&
          Math.hypot(point.x - pointerCandidate.startX, point.y - pointerCandidate.startY) > GROUP_CLICK_THRESHOLD) {
        pointerCandidate = null;
      }
    }, true);

    surface.addEventListener('pointerup', (event) => {
      if (!pointerCandidate || pointerCandidate.pointerId !== event.pointerId) return;
      const active = pointerCandidate;
      pointerCandidate = null;
      const group = hitGroupTitle(surfacePoint(event, surface));
      if (group && String(group.id) === active.groupId) openGroup(group.id);
    }, true);

    surface.addEventListener('pointercancel', (event) => {
      if (pointerCandidate?.pointerId === event.pointerId) pointerCandidate = null;
    }, true);
    surface.addEventListener('pointerleave', () => {
      surface.querySelector('.memory-graph-canvas')?.removeAttribute('data-hover-group-title');
    }, true);
    return true;
  }

  function installStyles() {
    if (document.getElementById('manualGravityGroupStyles')) return;
    const style = document.createElement('style');
    style.id = 'manualGravityGroupStyles';
    style.textContent = `
      .memory-graph-group-add{position:absolute;top:12px;right:12px;z-index:6;width:34px;height:34px;display:grid;place-items:center;border:1px solid rgb(199 255 86/.42);border-radius:50%;background:radial-gradient(circle at 35% 30%,rgb(199 255 86/.22),rgb(10 17 27/.94) 62%);color:#c7ff56;font:800 20px/1 Inter,system-ui,sans-serif;box-shadow:0 0 18px rgb(199 255 86/.12),inset 0 0 10px rgb(120 184 255/.08);cursor:pointer}
      .memory-graph-group-add:hover{border-color:rgb(199 255 86/.72)}
      .memory-graph-canvas[data-hover-group-title="true"]{cursor:pointer!important}
      .memory-graph-group-inspector{position:absolute;top:56px;right:12px;z-index:7;width:min(300px,calc(100% - 24px));max-height:min(390px,calc(100% - 72px));overflow:hidden;border:1px solid rgb(120 184 255/.28);border-radius:14px;background:rgb(8 14 23/.96);box-shadow:0 18px 48px rgb(0 0 0/.42);backdrop-filter:blur(12px)}
      .memory-graph-group-inspector[hidden]{display:none}
      .memory-graph-group-inspector-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;border-bottom:1px solid rgb(120 184 255/.14)}
      .memory-graph-group-inspector-title{min-width:0;margin:0;color:#f2f4f7;font:800 13px/1.2 Inter,system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .memory-graph-group-inspector-close{width:28px;height:28px;border:0;border-radius:50%;background:rgb(255 255 255/.05);color:rgb(242 244 247/.72);font:700 17px/1 Inter,system-ui,sans-serif;cursor:pointer}
      .memory-graph-group-inspector-list{margin:0;padding:8px;list-style:none;max-height:270px;overflow:auto}
      .memory-graph-group-member{display:grid;grid-template-columns:minmax(0,1fr) auto 32px;align-items:center;gap:8px;min-height:40px;padding:4px 4px 4px 10px;border-radius:10px}
      .memory-graph-group-member:hover{background:rgb(120 184 255/.055)}
      .memory-graph-group-member-name{min-width:0;color:rgb(242 244 247/.88);font:600 12px/1.3 Inter,system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .memory-graph-group-member-open{min-height:28px;padding:0 9px;border:1px solid rgb(120 184 255/.22);border-radius:8px;background:rgb(120 184 255/.055);color:rgb(210 246 255/.9);font:700 10px/1 Inter,system-ui,sans-serif;cursor:pointer}
      .memory-graph-group-member-open:hover{border-color:rgb(120 184 255/.48);background:rgb(120 184 255/.1);color:#f2f4f7}
      .memory-graph-group-member-remove{width:30px;height:30px;display:grid;place-items:center;border:1px solid rgb(255 255 255/.08);border-radius:9px;background:rgb(255 255 255/.035);color:rgb(242 244 247/.7);cursor:pointer}
      .memory-graph-group-member-remove:hover{border-color:rgb(199 255 86/.34);color:#c7ff56;background:rgb(199 255 86/.06)}
      .memory-graph-group-empty{padding:16px 12px;color:rgb(145 154 170/.9);font:600 12px/1.4 Inter,system-ui,sans-serif;text-align:center}
      .memory-graph-group-inspector-actions{padding:8px;border-top:1px solid rgb(120 184 255/.14)}
      .memory-graph-group-delete{width:100%;min-height:34px;border:1px solid rgb(255 104 104/.22);border-radius:9px;background:rgb(255 104 104/.055);color:rgb(255 180 180/.9);font:700 11px/1 Inter,system-ui,sans-serif;cursor:pointer}
      .memory-graph-group-delete:hover{border-color:rgb(255 104 104/.45);background:rgb(255 104 104/.09);color:#ffd0d0}
      @media(max-width:800px){.memory-graph-group-add{top:9px;right:9px;width:32px;height:32px}.memory-graph-group-inspector{top:50px;right:9px;width:min(290px,calc(100% - 18px))}}
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

  function ensureInspector() {
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface) return false;
    if (inspector?.isConnected) return true;
    inspector = document.createElement('section');
    inspector.className = 'memory-graph-group-inspector';
    inspector.hidden = true;
    inspector.setAttribute('aria-label', 'Memory group contents');

    const head = document.createElement('div');
    head.className = 'memory-graph-group-inspector-head';
    inspectorTitle = document.createElement('h3');
    inspectorTitle.className = 'memory-graph-group-inspector-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'memory-graph-group-inspector-close';
    close.setAttribute('aria-label', 'Close group contents');
    close.textContent = '×';
    close.addEventListener('click', closeGroup);

    inspectorList = document.createElement('ul');
    inspectorList.className = 'memory-graph-group-inspector-list';

    const actions = document.createElement('div');
    actions.className = 'memory-graph-group-inspector-actions';
    inspectorDelete = document.createElement('button');
    inspectorDelete.type = 'button';
    inspectorDelete.className = 'memory-graph-group-delete';
    inspectorDelete.textContent = 'Delete group';
    inspectorDelete.addEventListener('click', () => {
      const group = groupsForSpace().find((item) => String(item.id) === String(activeInspectorGroupId || ''));
      if (!group) return;
      const count = Array.isArray(group.members) ? group.members.length : 0;
      const detail = count
        ? `Its ${count} ${count === 1 ? 'memory' : 'memories'} will return to the main graph.`
        : 'The empty group bubble will be removed.';
      if (!window.confirm(`Delete ${String(group.title || 'this group')}?\n\n${detail}\n\nNo memories will be deleted.`)) return;
      if (!deleteGroup(group.id)) return;
      requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
    });

    head.append(inspectorTitle, close);
    actions.appendChild(inspectorDelete);
    inspector.append(head, inspectorList, actions);
    surface.appendChild(inspector);
    return true;
  }

  function renderInspector() {
    if (!ensureInspector() || !activeInspectorGroupId) return false;
    const group = groupsForSpace().find((item) => String(item.id) === String(activeInspectorGroupId));
    if (!group) {
      closeGroup();
      return false;
    }
    inspectorTitle.textContent = `${String(group.title || 'Group')} · ${(group.members || []).length}`;
    inspectorList.replaceChildren();
    const members = group.members || [];
    if (!members.length) {
      const empty = document.createElement('li');
      empty.className = 'memory-graph-group-empty';
      empty.textContent = 'No memories in this group.';
      inspectorList.appendChild(empty);
    } else {
      for (const memoryId of members) {
        const memory = memoryById(memoryId);
        const row = document.createElement('li');
        row.className = 'memory-graph-group-member';
        const name = document.createElement('span');
        name.className = 'memory-graph-group-member-name';
        name.textContent = memory?.title || 'Untitled memory';
        name.title = memory?.title || 'Untitled memory';
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'memory-graph-group-member-open';
        open.textContent = 'Open';
        open.setAttribute('aria-label', `Open ${memory?.title || 'memory'}`);
        open.addEventListener('click', () => {
          globalThis.MemoryApp?.openMemoryInspector?.(memoryId);
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'memory-graph-group-member-remove';
        remove.textContent = '🗑';
        remove.title = 'Remove from group';
        remove.setAttribute('aria-label', `Remove ${memory?.title || 'memory'} from group`);
        remove.addEventListener('click', () => {
          if (!detachMemory(memoryId)) return;
          renderInspector();
          requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
        });
        row.append(name, open, remove);
        inspectorList.appendChild(row);
      }
    }
    inspector.hidden = false;
    return true;
  }

  function openGroup(groupId) {
    const id = String(groupId || '');
    if (!id || !groupsForSpace().some((group) => String(group.id) === id)) return false;
    activeInspectorGroupId = id;
    return renderInspector();
  }

  function closeGroup() {
    activeInspectorGroupId = null;
    if (inspector) inspector.hidden = true;
  }

  function mountUi() {
    installStyles();
    ensureAddButton();
    ensureInspector();
    installTitlePointerHooks();
    return true;
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
    deleteGroup,
    replaceGroups,
    openGroup,
    closeGroup,
    groups: () => groupsForSpace().map((group) => ({ ...group, members: [...(group.members || [])] }))
  });

  installCanvasHitHook();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mountUi), { once: true });
  } else {
    requestAnimationFrame(mountUi);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === WORKSPACE_KEY) {
      workspaceRaw = '';
      workspaceCache = null;
      if (activeInspectorGroupId) renderInspector();
    }
    if (event.key === GROUP_KEY) {
      groupRaw = '';
      groupCache = null;
      titleHits.clear();
      if (activeInspectorGroupId) renderInspector();
    }
  });
})();
