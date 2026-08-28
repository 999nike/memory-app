(() => {
  'use strict';

  const VERSION = 1;
  const LOCK_KEY = 'memory-graph-layout-lock-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';
  const SETTLE_MS = 48;

  let surface = null;
  let rack = null;
  let undoButton = null;
  let lockButton = null;
  let observer = null;
  let lastUndo = null;
  let interaction = null;
  let compareTimer = 0;
  const activeTouches = new Set();

  function api() {
    return globalThis.MemoryGraphManualGroups || null;
  }

  function isLocked() {
    try {
      return localStorage.getItem(LOCK_KEY) === '1';
    } catch {
      return false;
    }
  }

  function setLocked(next) {
    const value = Boolean(next);
    try {
      localStorage.setItem(LOCK_KEY, value ? '1' : '0');
    } catch {}
    syncLockedUi();
    window.dispatchEvent(new CustomEvent('memory-graph-layout-lock-change', { detail: { locked: value } }));
    return value;
  }

  function activeSpaceId() {
    return String(api()?.activeSpaceId?.() || '');
  }

  function structuralSnapshot() {
    const groupsApi = api();
    const spaceId = activeSpaceId();
    if (!groupsApi || !spaceId) return null;
    const groups = groupsApi.groups?.() || [];
    return {
      spaceId,
      groups: groups.map((group) => ({
        ...group,
        members: [...(group.members || [])]
      }))
    };
  }

  function groupMap(snapshot) {
    return new Map((snapshot?.groups || []).map((group) => [String(group.id), group]));
  }

  function membershipMap(snapshot) {
    const map = new Map();
    for (const group of snapshot?.groups || []) {
      for (const memoryId of group.members || []) map.set(String(memoryId), String(group.id));
    }
    return map;
  }

  function structureSignature(snapshot) {
    if (!snapshot) return '';
    return JSON.stringify((snapshot.groups || []).map((group) => ({
      id: String(group.id),
      title: String(group.title || ''),
      members: [...(group.members || [])].map(String).sort()
    })).sort((a, b) => a.id.localeCompare(b.id)));
  }

  function setUndo(action) {
    lastUndo = action || null;
    syncUndoUi();
  }

  function deriveUndo(before, after) {
    if (!before || !after || before.spaceId !== after.spaceId) return null;
    if (structureSignature(before) === structureSignature(after)) return undefined;

    const beforeGroups = groupMap(before);
    const afterGroups = groupMap(after);
    const added = [...afterGroups.keys()].filter((id) => !beforeGroups.has(id));
    const removed = [...beforeGroups.keys()].filter((id) => !afterGroups.has(id));

    if (added.length === 1 && removed.length === 0) {
      const group = afterGroups.get(added[0]);
      if (group && (group.members || []).length === 0) {
        return { type: 'create-group', spaceId: before.spaceId, groupId: added[0] };
      }
    }

    if (added.length === 0 && removed.length === 0) {
      const beforeMembership = membershipMap(before);
      const afterMembership = membershipMap(after);
      const memoryIds = new Set([...beforeMembership.keys(), ...afterMembership.keys()]);
      const changed = [...memoryIds].filter((id) =>
        String(beforeMembership.get(id) || '') !== String(afterMembership.get(id) || '')
      );

      const titlesChanged = [...beforeGroups.keys()].some((id) =>
        String(beforeGroups.get(id)?.title || '') !== String(afterGroups.get(id)?.title || '')
      );

      if (!titlesChanged && changed.length === 1) {
        const memoryId = changed[0];
        return {
          type: 'membership',
          spaceId: before.spaceId,
          memoryId,
          fromGroupId: beforeMembership.get(memoryId) || null,
          toGroupId: afterMembership.get(memoryId) || null
        };
      }
    }

    // A structural edit happened, but it is not one of the deliberately supported
    // one-step actions. Do not leave an older Undo armed for an unrelated change.
    return null;
  }

  function scheduleCompare(before) {
    if (!before) return;
    if (compareTimer) clearTimeout(compareTimer);
    compareTimer = window.setTimeout(() => {
      compareTimer = 0;
      const after = structuralSnapshot();
      const action = deriveUndo(before, after);
      if (action !== undefined) setUndo(action);
    }, SETTLE_MS);
  }

  function beginInteraction(event) {
    if (!surface || !surface.contains(event.target)) return;
    if (event.target?.closest?.('.memory-graph-control-rack')) {
      if (!event.target.closest('.memory-graph-group-add')) return;
    }
    interaction = {
      pointerId: Number(event.pointerId),
      before: structuralSnapshot()
    };
  }

  function finishInteraction(event) {
    if (!interaction || interaction.pointerId !== Number(event.pointerId)) return;
    const before = interaction.before;
    interaction = null;
    scheduleCompare(before);
  }

  function canUndo() {
    if (!lastUndo) return false;
    if (lastUndo.spaceId !== activeSpaceId()) return false;
    if (lastUndo.type === 'create-group') {
      const group = api()?.groups?.().find((item) => String(item.id) === String(lastUndo.groupId));
      return Boolean(group && (group.members || []).length === 0);
    }
    return lastUndo.type === 'membership';
  }

  function flushGraph() {
    requestAnimationFrame(() => {
      globalThis.MemoryGraph?.refresh?.();
      globalThis.MemoryGraphManualGravity?.redraw?.();
      globalThis.MemoryGraphNeuralScaffold?.redraw?.();
      globalThis.MemoryGraphNeuralFlow?.redraw?.();
    });
  }

  function undo() {
    if (!canUndo()) {
      setUndo(null);
      return false;
    }

    const groupsApi = api();
    const action = lastUndo;
    let groups = groupsApi.groups?.() || [];

    if (action.type === 'membership') {
      groups = groups.map((group) => ({
        ...group,
        members: (group.members || []).filter((id) => String(id) !== String(action.memoryId))
      }));
      if (action.fromGroupId) {
        let found = false;
        groups = groups.map((group) => {
          if (String(group.id) !== String(action.fromGroupId)) return group;
          found = true;
          return { ...group, members: [...(group.members || []), String(action.memoryId)] };
        });
        if (!found) {
          setUndo(null);
          return false;
        }
      }
    } else if (action.type === 'create-group') {
      const target = groups.find((group) => String(group.id) === String(action.groupId));
      if (!target || (target.members || []).length) {
        setUndo(null);
        return false;
      }
      groups = groups.filter((group) => String(group.id) !== String(action.groupId));
    }

    if (groupsApi.replaceGroups?.(groups, action.spaceId) !== true) return false;
    setUndo(null);
    flushGraph();
    return true;
  }

  function installStyles() {
    if (document.getElementById('memoryGraphControlRackStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphControlRackStyles';
    style.textContent = `
      .memory-graph-control-rack{
        position:absolute;top:12px;right:12px;z-index:24;display:flex;align-items:center;gap:7px;
      }
      .memory-graph-control-rack .memory-graph-group-add,
      .memory-graph-control-button{
        position:static!important;inset:auto!important;width:36px;height:36px;min-width:36px;display:grid;place-items:center;
        margin:0;padding:0;border:1px solid rgb(120 184 255/.30);border-radius:50%;
        background:radial-gradient(circle at 35% 30%,rgb(120 184 255/.13),rgb(10 17 27/.96) 66%);
        color:rgb(210 235 255/.90);font:800 17px/1 Inter,system-ui,sans-serif;
        box-shadow:0 0 16px rgb(62 147 255/.10),inset 0 0 10px rgb(120 184 255/.06);cursor:pointer;
      }
      .memory-graph-control-rack .memory-graph-group-add{
        border-color:rgb(199 255 86/.48)!important;color:#c7ff56!important;font-size:22px!important;
        background:radial-gradient(circle at 35% 30%,rgb(199 255 86/.22),rgb(10 17 27/.96) 64%)!important;
      }
      .memory-graph-control-button:hover:not(:disabled){border-color:rgb(120 184 255/.62);color:#f2fbff}
      .memory-graph-control-button:disabled{opacity:.28;cursor:default;box-shadow:none}
      .memory-graph-control-lock[data-locked="true"]{
        border-color:rgb(199 255 86/.62);color:#c7ff56;background:radial-gradient(circle at 35% 30%,rgb(199 255 86/.18),rgb(10 17 27/.96) 66%);
        box-shadow:0 0 18px rgb(199 255 86/.13),inset 0 0 10px rgb(199 255 86/.05);
      }
      #memoryGraphSurface[data-layout-locked="true"] .memory-graph-group-add,
      #memoryGraphSurface[data-layout-locked="true"] .memory-graph-group-member-remove,
      #memoryGraphSurface[data-layout-locked="true"] .memory-graph-group-delete,
      #memoryGraphSurface[data-layout-locked="true"] .memory-graph-group-rename{
        opacity:.30!important;pointer-events:none!important;cursor:default!important;
      }
      @media(max-width:800px){
        .memory-graph-control-rack{top:9px;right:9px;gap:6px}
        .memory-graph-control-rack .memory-graph-group-add,.memory-graph-control-button{width:32px;height:32px;min-width:32px;font-size:15px}
        .memory-graph-control-rack .memory-graph-group-add{font-size:20px!important}
      }
    `;
    document.head.appendChild(style);
  }

  function syncUndoUi() {
    if (!undoButton) return;
    undoButton.disabled = !canUndo();
    undoButton.title = undoButton.disabled ? 'Nothing to undo' : 'Undo last graph organisation change';
  }

  function syncLockedUi() {
    const locked = isLocked();
    if (surface) surface.dataset.layoutLocked = locked ? 'true' : 'false';
    if (lockButton) {
      lockButton.dataset.locked = locked ? 'true' : 'false';
      lockButton.textContent = locked ? '🔒' : '🔓';
      lockButton.title = locked ? 'Unlock graph layout' : 'Lock graph layout';
      lockButton.setAttribute('aria-label', lockButton.title);
    }
    const add = surface?.querySelector('.memory-graph-group-add');
    if (add) add.disabled = locked;
  }

  function ensureRack() {
    surface = document.getElementById('memoryGraphSurface');
    if (!surface) return false;
    installStyles();

    if (!rack || !rack.isConnected) {
      rack = document.createElement('div');
      rack.className = 'memory-graph-control-rack';
      rack.setAttribute('aria-label', 'Memory graph controls');

      undoButton = document.createElement('button');
      undoButton.type = 'button';
      undoButton.className = 'memory-graph-control-button memory-graph-control-undo';
      undoButton.textContent = '↶';
      undoButton.setAttribute('aria-label', 'Undo last graph organisation change');
      undoButton.addEventListener('click', undo);

      lockButton = document.createElement('button');
      lockButton.type = 'button';
      lockButton.className = 'memory-graph-control-button memory-graph-control-lock';
      lockButton.addEventListener('click', () => setLocked(!isLocked()));

      rack.append(undoButton, lockButton);
      surface.appendChild(rack);
    }

    const add = surface.querySelector('.memory-graph-group-add');
    if (add && add.parentElement !== rack) rack.appendChild(add);
    syncUndoUi();
    syncLockedUi();
    return true;
  }

  function targetIsGraphSurface(event) {
    if (!surface || !surface.contains(event.target)) return false;
    if (event.target?.closest?.('.memory-graph-control-rack')) return false;
    if (event.target?.closest?.('.memory-graph-group-inspector')) return false;
    return event.target?.classList?.contains('memory-graph-canvas') === true;
  }

  function installLockGuards() {
    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') activeTouches.add(Number(event.pointerId));
    }, true);

    window.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'touch') activeTouches.delete(Number(event.pointerId));
    }, true);

    window.addEventListener('pointercancel', (event) => {
      if (event.pointerType === 'touch') activeTouches.delete(Number(event.pointerId));
    }, true);

    window.addEventListener('pointermove', (event) => {
      if (!isLocked() || !targetIsGraphSurface(event)) return;
      if (event.pointerType === 'touch' && activeTouches.size >= 2) return;
      if (event.pointerType !== 'touch' && Number(event.buttons || 0) === 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }, { capture: true, passive: false });

    window.addEventListener('click', (event) => {
      if (!isLocked() || !surface?.contains(event.target)) return;
      if (!event.target?.closest?.('.memory-graph-group-add,.memory-graph-group-member-remove,.memory-graph-group-delete,.memory-graph-group-rename')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }, true);
  }

  function mount() {
    if (!ensureRack()) {
      window.setTimeout(mount, 100);
      return;
    }

    surface.addEventListener('pointerdown', beginInteraction, true);
    surface.addEventListener('pointerup', finishInteraction, true);
    surface.addEventListener('pointercancel', finishInteraction, true);
    installLockGuards();

    observer?.disconnect();
    observer = new MutationObserver(() => requestAnimationFrame(ensureRack));
    observer.observe(surface, { childList: true, subtree: true });
  }

  globalThis.MemoryGraphControls = Object.freeze({
    version: VERSION,
    undo,
    canUndo,
    isLayoutLocked: isLocked,
    setLayoutLocked: setLocked,
    refresh: ensureRack
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
