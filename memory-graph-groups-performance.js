(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GROUP_STATE_KEY = 'memory-graph-groups-v1';
  const TYPE_LABELS = {
    decision: 'Decisions',
    fact: 'Facts',
    goal: 'Goals',
    question: 'Questions',
    note: 'Notes',
    job: 'Jobs'
  };

  const groupedRotation = globalThis.MemoryGraphRotation || null;
  if (!groupedRotation?.__memoryGroupingWrapped || groupedRotation.__memoryGroupingOptimized) return;

  const runtime = {
    workspaceDirty: true,
    groupDirty: true,
    workspace: null,
    memoryMap: new Map(),
    spaceId: '',
    mode: 'off',
    compactByMode: {
      type: new Set(),
      project: new Set()
    },
    projectionRevision: 0,
    projectionCache: null,
    rotation: {
      yaw: 0,
      pitch: 0,
      active: false,
      rotating: false
    },
    refreshTimer: 0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function hashUnit(value) {
    const text = String(value || 'memory');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
  }

  function groupInfo(memory, mode) {
    if (!memory) return { key: 'ungrouped', label: 'Ungrouped' };

    if (mode === 'project') {
      const project = String(memory.project || '').trim();
      if (project) return { key: `project:${project.toLowerCase()}`, label: project };
      return { key: 'project:general', label: 'General' };
    }

    const type = String(memory.type || 'note').toLowerCase();
    return {
      key: `type:${type}`,
      label: TYPE_LABELS[type] || `${type.charAt(0).toUpperCase()}${type.slice(1)}`
    };
  }

  function invalidateProjection() {
    runtime.projectionRevision += 1;
    runtime.projectionCache = null;
  }

  function invalidateWorkspace() {
    runtime.workspaceDirty = true;
    runtime.groupDirty = true;
    invalidateProjection();
  }

  function invalidateGroups() {
    runtime.groupDirty = true;
    invalidateProjection();
  }

  function ensureWorkspace() {
    if (!runtime.workspaceDirty) return runtime.workspace;

    const value = readJson(WORKSPACE_KEY, null);
    if (!value || !Array.isArray(value.spaces) || !Array.isArray(value.memories)) {
      runtime.workspace = null;
      runtime.memoryMap = new Map();
      runtime.spaceId = '';
      runtime.workspaceDirty = false;
      runtime.groupDirty = true;
      return null;
    }

    runtime.workspace = value;
    runtime.memoryMap = new Map(value.memories.map((memory) => [String(memory.id), memory]));
    runtime.spaceId = String(value.activeSpaceId || value.spaces[0]?.id || '');
    runtime.workspaceDirty = false;
    runtime.groupDirty = true;
    return value;
  }

  function ensureGroups() {
    ensureWorkspace();
    if (!runtime.groupDirty) return;

    const store = readJson(GROUP_STATE_KEY, { version: 1, spaces: {} });
    const current = store?.spaces?.[runtime.spaceId];
    const rawMode = String(current?.mode || 'off');
    runtime.mode = rawMode === 'type' || rawMode === 'project' ? rawMode : 'off';
    runtime.compactByMode = {
      type: new Set(Array.isArray(current?.compact?.type) ? current.compact.type.map(String) : []),
      project: new Set(Array.isArray(current?.compact?.project) ? current.compact.project.map(String) : [])
    };
    runtime.groupDirty = false;
    runtime.projectionCache = null;
  }

  function currentMode() {
    ensureGroups();
    return runtime.mode;
  }

  function compactKeys(mode = currentMode()) {
    ensureGroups();
    return runtime.compactByMode[mode] || new Set();
  }

  function fallbackProjection(node) {
    return {
      x: Number(node?.x || 0),
      y: Number(node?.y || 0),
      radius: Number(node?.radius || 1),
      depth: 0,
      alpha: 1,
      scale: 1
    };
  }

  function buildProjectionCache(graph, mode) {
    const groups = new Map();

    for (const node of graph?.memoryNodes || []) {
      const memory = runtime.memoryMap.get(String(node.id));
      const info = groupInfo(memory, mode);
      if (!groups.has(info.key)) groups.set(info.key, { ...info, members: [] });
      groups.get(info.key).members.push(node);
    }

    const orderedGroups = [...groups.values()]
      .filter((group) => group.members.length)
      .sort((a, b) => a.label.localeCompare(b.label));
    const compact = compactKeys(mode);
    const projections = new Map();
    const minSide = Math.max(1, Math.min(Number(graph?.width || 1), Number(graph?.height || 1)));
    const orbit = Math.max(92, minSide * (orderedGroups.length <= 3 ? 0.25 : 0.31));

    orderedGroups.forEach((group, groupIndex) => {
      const groupAngle = -Math.PI / 2 + (groupIndex / Math.max(1, orderedGroups.length)) * Math.PI * 2;
      const centreX = Number(graph.centreX || 0) + Math.cos(groupAngle) * orbit;
      const centreY = Number(graph.centreY || 0) + Math.sin(groupAngle) * orbit;
      const isCompact = compact.has(String(group.key));
      const slotsPerRing = isCompact ? 7 : 8;
      const phase = hashUnit(group.key) * Math.PI * 2;
      const count = Math.max(1, group.members.length);

      group.members.forEach((node, memberIndex) => {
        const ring = Math.floor(memberIndex / slotsPerRing);
        const slot = memberIndex % slotsPerRing;
        const slotsOnRing = Math.min(slotsPerRing, Math.max(1, count - ring * slotsPerRing));
        const localAngle = phase + (slot / slotsOnRing) * Math.PI * 2;
        const baseRadius = isCompact ? 9 : 27;
        const ringStep = isCompact ? 8 : 24;
        const localRadius = count === 1 ? 0 : baseRadius + ring * ringStep;
        const jitter = isCompact ? 2 : 5;
        const localX = Math.cos(localAngle) * localRadius + (hashUnit(`${node.id}:x`) - 0.5) * jitter;
        const localY = Math.sin(localAngle) * localRadius + (hashUnit(`${node.id}:y`) - 0.5) * jitter;

        projections.set(String(node.id), {
          x: centreX + localX,
          y: centreY + localY,
          radius: Number(node.radius || 1) * (isCompact ? 0.82 : 0.96),
          depth: 0,
          alpha: isCompact ? 0.82 : 0.96,
          scale: isCompact ? 0.82 : 0.96
        });
      });
    });

    runtime.projectionCache = {
      graph,
      mode,
      revision: runtime.projectionRevision,
      projections
    };
    return runtime.projectionCache;
  }

  function groupedProjection(node, graph) {
    const fallback = fallbackProjection(node);
    const mode = currentMode();
    if (!node || node.kind === 'space' || !graph || mode === 'off') return fallback;

    let cache = runtime.projectionCache;
    if (!cache || cache.graph !== graph || cache.mode !== mode || cache.revision !== runtime.projectionRevision) {
      cache = buildProjectionCache(graph, mode);
    }

    return cache.projections.get(String(node.id)) || fallback;
  }

  function syncRotationSnapshot() {
    const snapshot = groupedRotation.snapshot?.() || {};
    runtime.rotation.yaw = Number(snapshot.yaw || 0);
    runtime.rotation.pitch = Number(snapshot.pitch || 0);
    runtime.rotation.active = snapshot.active === true;
    runtime.rotation.rotating = snapshot.rotating === true;
  }

  function pseudoDepth(node, graph, base) {
    if (!node || node.kind === 'space' || !graph) return 0;

    const dx = Number(base.x || 0) - Number(graph.centreX || 0);
    const dy = Number(base.y || 0) - Number(graph.centreY || 0);
    const shellRadius = Math.max(120, Math.min(Number(graph.width || 1), Number(graph.height || 1)) * 0.46);
    const radial = clamp(Math.hypot(dx, dy) / shellRadius, 0, 0.97);
    const hemisphere = hashUnit(node.id) >= 0.5 ? 1 : -1;
    const shellDepth = Math.sqrt(Math.max(0.04, 1 - radial * radial)) * shellRadius * 0.72;
    const jitter = (hashUnit(`${node.id}:depth`) - 0.5) * shellRadius * 0.18;
    return hemisphere * shellDepth + jitter;
  }

  function rotateProjection(node, graph, base) {
    if (!runtime.rotation.active || node?.kind === 'space') return base;

    const centreX = Number(graph.centreX || 0);
    const centreY = Number(graph.centreY || 0);
    const x = Number(base.x || 0) - centreX;
    const y = Number(base.y || 0) - centreY;
    const z = pseudoDepth(node, graph, base);
    const cosYaw = Math.cos(runtime.rotation.yaw);
    const sinYaw = Math.sin(runtime.rotation.yaw);
    const cosPitch = Math.cos(runtime.rotation.pitch);
    const sinPitch = Math.sin(runtime.rotation.pitch);
    const xYaw = x * cosYaw + z * sinYaw;
    const zYaw = -x * sinYaw + z * cosYaw;
    const yPitch = y * cosPitch - zYaw * sinPitch;
    const zPitch = y * sinPitch + zYaw * cosPitch;
    const depthRadius = Math.max(160, Math.min(Number(graph.width || 1), Number(graph.height || 1)) * 0.62);
    const perspective = clamp(1 + zPitch / (depthRadius * 3.25), 0.82, 1.20);
    const alpha = clamp(0.68 + (perspective - 0.82) * 1.45, 0.62, 1);

    return {
      x: centreX + xYaw * perspective,
      y: centreY + yPitch * perspective,
      radius: Number(base.radius || node.radius || 1) * perspective,
      depth: zPitch,
      alpha: Math.min(alpha, Number(base.alpha || 1)),
      scale: perspective
    };
  }

  function project(node, graph) {
    const base = currentMode() === 'off' ? fallbackProjection(node) : groupedProjection(node, graph);
    return rotateProjection(node, graph, base);
  }

  function scheduleGroupRefresh() {
    if (runtime.refreshTimer) clearTimeout(runtime.refreshTimer);
    runtime.refreshTimer = window.setTimeout(() => {
      runtime.refreshTimer = 0;
      invalidateGroups();
      ensureGroups();
    }, 0);
  }

  function bindInvalidation() {
    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('#memoryGraphGroupUi')) scheduleGroupRefresh();
    }, true);

    window.addEventListener('storage', (event) => {
      if (event.key === WORKSPACE_KEY) invalidateWorkspace();
      if (event.key === GROUP_STATE_KEY) invalidateGroups();
    });

    const mountObservers = () => {
      const memoryGrid = document.getElementById('memoryGrid');
      const spaceTitle = document.getElementById('spaceTitle');
      if (!memoryGrid && !spaceTitle) return;

      const observer = new MutationObserver(() => invalidateWorkspace());
      if (memoryGrid) observer.observe(memoryGrid, { childList: true, subtree: false });
      if (spaceTitle) observer.observe(spaceTitle, { childList: true, characterData: true, subtree: true });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mountObservers, { once: true });
    } else {
      mountObservers();
    }
  }

  syncRotationSnapshot();
  bindInvalidation();

  const optimizedRotation = Object.freeze({
    ...groupedRotation,
    __memoryGroupingOptimized: true,
    version: `${groupedRotation.version || 1}+perf${VERSION}`,
    supported(...args) {
      return groupedRotation.supported?.(...args) ?? true;
    },
    shouldStart(...args) {
      return groupedRotation.shouldStart?.(...args) === true;
    },
    begin(...args) {
      const result = groupedRotation.begin?.(...args);
      syncRotationSnapshot();
      return result;
    },
    update(...args) {
      const result = groupedRotation.update?.(...args);
      syncRotationSnapshot();
      return result;
    },
    end(...args) {
      const result = groupedRotation.end?.(...args);
      syncRotationSnapshot();
      return result;
    },
    reset(...args) {
      const result = groupedRotation.reset?.(...args);
      syncRotationSnapshot();
      invalidateGroups();
      scheduleGroupRefresh();
      return result;
    },
    isActive() {
      return runtime.rotation.active || currentMode() !== 'off';
    },
    isRotating() {
      return runtime.rotation.rotating;
    },
    project,
    snapshot() {
      return {
        yaw: runtime.rotation.yaw,
        pitch: runtime.rotation.pitch,
        active: runtime.rotation.active,
        rotating: runtime.rotation.rotating,
        groupingMode: currentMode(),
        groupingActive: currentMode() !== 'off',
        groupingOptimized: true,
        groupingPerformanceVersion: VERSION
      };
    }
  });

  globalThis.MemoryGraphRotation = optimizedRotation;
  globalThis.MemoryGraphGroupingPerformance = Object.freeze({
    version: VERSION,
    invalidateWorkspace,
    invalidateGroups,
    snapshot() {
      return {
        mode: currentMode(),
        spaceId: runtime.spaceId,
        memoryCount: runtime.memoryMap.size,
        projectionCached: Boolean(runtime.projectionCache),
        rotation: { ...runtime.rotation }
      };
    }
  });
})();
