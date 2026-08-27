(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GRAPH_LAYOUT_KEY = 'memory-graph-layout-v1';
  const GROUP_STATE_KEY = 'memory-graph-groups-v1';
  const TYPE_LABELS = {
    decision: 'Decisions',
    fact: 'Facts',
    goal: 'Goals',
    question: 'Questions',
    note: 'Notes',
    job: 'Jobs'
  };

  const baseRotation = globalThis.MemoryGraphRotation || null;
  if (!baseRotation || baseRotation.__memoryGroupingWrapped) return;

  let controls = null;
  let chips = null;
  let compactToggle = null;
  let workspaceObserver = null;

  function clone(value) {
    try {
      return value == null ? value : JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function workspace() {
    const value = readJson(WORKSPACE_KEY, null);
    if (!value || !Array.isArray(value.spaces) || !Array.isArray(value.memories)) return null;
    return value;
  }

  function activeSpaceId() {
    const value = workspace();
    return String(value?.activeSpaceId || value?.spaces?.[0]?.id || '');
  }

  function stateStore() {
    const value = readJson(GROUP_STATE_KEY, { version: VERSION, spaces: {} });
    if (value.version !== VERSION || !value.spaces || typeof value.spaces !== 'object') {
      return { version: VERSION, spaces: {} };
    }
    return value;
  }

  function spaceState(spaceId = activeSpaceId()) {
    const store = stateStore();
    const current = store.spaces?.[spaceId];
    return current && typeof current === 'object'
      ? current
      : { mode: 'off', compact: { type: [], project: [] }, baseLayout: null };
  }

  function saveSpaceState(next, spaceId = activeSpaceId()) {
    if (!spaceId) return false;
    const store = stateStore();
    store.spaces[spaceId] = next;
    return writeJson(GROUP_STATE_KEY, store);
  }

  function currentMode() {
    const mode = String(spaceState().mode || 'off');
    return ['type', 'project'].includes(mode) ? mode : 'off';
  }

  function memoryMap() {
    const value = workspace();
    const map = new Map();
    for (const memory of value?.memories || []) map.set(String(memory.id), memory);
    return map;
  }

  function groupInfo(memory, mode = currentMode()) {
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

  function groupsForGraph(graph, mode = currentMode()) {
    const memories = memoryMap();
    const groups = new Map();

    for (const node of graph?.memoryNodes || []) {
      const memory = memories.get(String(node.id));
      const info = groupInfo(memory, mode);
      if (!groups.has(info.key)) groups.set(info.key, { ...info, members: [] });
      groups.get(info.key).members.push(node);
    }

    return [...groups.values()]
      .filter((group) => group.members.length)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function compactKeys(mode = currentMode()) {
    const current = spaceState();
    const values = current.compact?.[mode];
    return new Set(Array.isArray(values) ? values.map(String) : []);
  }

  function isCompact(groupKey, mode = currentMode()) {
    return compactKeys(mode).has(String(groupKey));
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

  function groupedProjection(node, graph) {
    const fallback = {
      x: Number(node?.x || 0),
      y: Number(node?.y || 0),
      radius: Number(node?.radius || 1),
      depth: 0,
      alpha: 1,
      scale: 1
    };

    const mode = currentMode();
    if (!node || node.kind === 'space' || !graph || mode === 'off') return fallback;

    const groups = groupsForGraph(graph, mode);
    if (!groups.length) return fallback;

    const memories = memoryMap();
    const memory = memories.get(String(node.id));
    const info = groupInfo(memory, mode);
    const groupIndex = groups.findIndex((group) => group.key === info.key);
    const group = groups[groupIndex];
    if (!group) return fallback;

    const memberIndex = group.members.findIndex((member) => String(member.id) === String(node.id));
    const count = Math.max(1, group.members.length);
    const minSide = Math.max(1, Math.min(Number(graph.width || 1), Number(graph.height || 1)));
    const orbit = Math.max(92, minSide * (groups.length <= 3 ? 0.25 : 0.31));
    const groupAngle = -Math.PI / 2 + (groupIndex / Math.max(1, groups.length)) * Math.PI * 2;
    const centreX = Number(graph.centreX || 0) + Math.cos(groupAngle) * orbit;
    const centreY = Number(graph.centreY || 0) + Math.sin(groupAngle) * orbit;
    const compact = isCompact(group.key, mode);

    const slotsPerRing = compact ? 7 : 8;
    const ring = Math.floor(Math.max(0, memberIndex) / slotsPerRing);
    const slot = Math.max(0, memberIndex) % slotsPerRing;
    const slotsOnRing = Math.min(slotsPerRing, Math.max(1, count - ring * slotsPerRing));
    const phase = hashUnit(group.key) * Math.PI * 2;
    const localAngle = phase + (slot / slotsOnRing) * Math.PI * 2;
    const baseRadius = compact ? 9 : 27;
    const ringStep = compact ? 8 : 24;
    const localRadius = count === 1 ? 0 : baseRadius + ring * ringStep;
    const jitter = compact ? 2 : 5;
    const localX = Math.cos(localAngle) * localRadius + (hashUnit(`${node.id}:x`) - 0.5) * jitter;
    const localY = Math.sin(localAngle) * localRadius + (hashUnit(`${node.id}:y`) - 0.5) * jitter;

    return {
      x: centreX + localX,
      y: centreY + localY,
      radius: Number(node.radius || 1) * (compact ? 0.82 : 0.96),
      depth: 0,
      alpha: compact ? 0.82 : 0.96,
      scale: compact ? 0.82 : 0.96
    };
  }

  function project(node, graph) {
    const grouped = groupedProjection(node, graph);
    if (!node || !graph || currentMode() === 'off') return baseRotation.project(node, graph);

    const groupedNode = {
      ...node,
      x: grouped.x,
      y: grouped.y,
      radius: grouped.radius
    };

    if (baseRotation.isActive?.() === true) {
      const projected = baseRotation.project(groupedNode, graph);
      if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) {
        return {
          ...projected,
          alpha: Math.min(Number(projected.alpha || 1), grouped.alpha)
        };
      }
    }

    return grouped;
  }

  function groupingActive() {
    return currentMode() !== 'off';
  }

  function captureBaseLayout(spaceId) {
    if (!spaceId) return;
    const current = spaceState(spaceId);
    if (current.baseLayout) return;

    const graphStore = readJson(GRAPH_LAYOUT_KEY, { version: 1, spaces: {} });
    current.baseLayout = clone(graphStore.spaces?.[spaceId] || null);
    saveSpaceState(current, spaceId);
  }

  function restoreBaseLayout(spaceId) {
    if (!spaceId) return;
    const current = spaceState(spaceId);
    if (!Object.prototype.hasOwnProperty.call(current, 'baseLayout')) return;

    const graphStore = readJson(GRAPH_LAYOUT_KEY, { version: 1, spaces: {} });
    if (!graphStore.spaces || typeof graphStore.spaces !== 'object') graphStore.spaces = {};

    if (current.baseLayout) graphStore.spaces[spaceId] = clone(current.baseLayout);
    else delete graphStore.spaces[spaceId];
    writeJson(GRAPH_LAYOUT_KEY, graphStore);

    current.baseLayout = null;
    saveSpaceState(current, spaceId);
  }

  function refreshGraph() {
    window.requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
  }

  function setMode(mode) {
    const nextMode = ['type', 'project'].includes(mode) ? mode : 'off';
    const spaceId = activeSpaceId();
    if (!spaceId) return;

    const current = spaceState(spaceId);
    const previous = currentMode();
    if (previous === nextMode) return;

    if (previous === 'off' && nextMode !== 'off') captureBaseLayout(spaceId);
    if (nextMode === 'off') restoreBaseLayout(spaceId);

    const updated = spaceState(spaceId);
    updated.mode = nextMode;
    saveSpaceState(updated, spaceId);
    renderControls();
    refreshGraph();
  }

  function toggleCompact(groupKey) {
    const mode = currentMode();
    if (mode === 'off') return;

    const current = spaceState();
    const values = new Set(Array.isArray(current.compact?.[mode]) ? current.compact[mode].map(String) : []);
    const key = String(groupKey);
    if (values.has(key)) values.delete(key);
    else values.add(key);

    current.compact = current.compact || { type: [], project: [] };
    current.compact[mode] = [...values];
    saveSpaceState(current);
    renderControls();
    refreshGraph();
  }

  function toggleAllCompact() {
    const mode = currentMode();
    if (mode === 'off') return;

    const value = workspace();
    const spaceId = activeSpaceId();
    const memories = (value?.memories || []).filter((memory) => String(memory.spaceId) === spaceId && String(memory.status || 'confirmed') === 'confirmed');
    const keys = [...new Set(memories.map((memory) => groupInfo(memory, mode).key))];
    const current = spaceState();
    const existing = new Set(Array.isArray(current.compact?.[mode]) ? current.compact[mode].map(String) : []);
    const allCompact = keys.length > 0 && keys.every((key) => existing.has(key));

    current.compact = current.compact || { type: [], project: [] };
    current.compact[mode] = allCompact ? [] : keys;
    saveSpaceState(current);
    renderControls();
    refreshGraph();
  }

  function injectStyles() {
    if (document.getElementById('memoryGraphGroupStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphGroupStyles';
    style.textContent = `
      .memory-graph-group-ui {
        position: absolute;
        top: 10px;
        left: 10px;
        right: 10px;
        z-index: 5;
        display: grid;
        gap: 7px;
        pointer-events: none;
      }
      .memory-graph-group-toolbar,
      .memory-graph-group-chips {
        display: flex;
        align-items: center;
        gap: 6px;
        width: max-content;
        max-width: 100%;
        padding: 5px;
        border: 1px solid rgb(120 184 255 / 0.16);
        border-radius: 999px;
        background: rgb(7 12 20 / 0.78);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
        overflow-x: auto;
        scrollbar-width: none;
        pointer-events: auto;
      }
      .memory-graph-group-chips::-webkit-scrollbar { display: none; }
      .memory-graph-group-label {
        padding: 0 6px;
        color: rgb(194 200 209 / 0.72);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.09em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .memory-graph-group-button,
      .memory-graph-group-chip {
        min-height: 27px;
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 0 9px;
        background: transparent;
        color: rgb(194 200 209 / 0.78);
        font: 750 11px Inter, system-ui, sans-serif;
        white-space: nowrap;
        cursor: pointer;
      }
      .memory-graph-group-button:hover,
      .memory-graph-group-chip:hover {
        color: #f2f4f7;
        border-color: rgb(120 184 255 / 0.20);
        background: rgb(120 184 255 / 0.06);
      }
      .memory-graph-group-button.is-active {
        color: #111609;
        background: #c7ff56;
      }
      .memory-graph-group-chip.is-compact {
        color: #dfffa2;
        border-color: rgb(199 255 86 / 0.28);
        background: rgb(199 255 86 / 0.09);
      }
      .memory-graph-group-chip strong {
        color: #78b8ff;
        font-size: 10px;
      }
      @media (max-width: 800px) {
        .memory-graph-group-ui { top: 8px; left: 8px; right: 8px; }
        .memory-graph-group-toolbar,
        .memory-graph-group-chips { max-width: calc(100vw - 54px); }
        .memory-graph-group-label { display: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function visibleGroupsFromWorkspace() {
    const value = workspace();
    const spaceId = activeSpaceId();
    const mode = currentMode();
    if (!value || !spaceId || mode === 'off') return [];

    const groups = new Map();
    for (const memory of value.memories || []) {
      if (String(memory.spaceId) !== spaceId || String(memory.status || 'confirmed') !== 'confirmed') continue;
      const info = groupInfo(memory, mode);
      const item = groups.get(info.key) || { ...info, count: 0 };
      item.count += 1;
      groups.set(info.key, item);
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  function renderControls() {
    if (!controls) return;
    const mode = currentMode();
    controls.querySelectorAll('[data-group-mode]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.groupMode === mode);
    });

    const groups = visibleGroupsFromWorkspace();
    if (chips) {
      chips.hidden = mode === 'off' || groups.length === 0;
      chips.innerHTML = groups.map((group) => `
        <button class="memory-graph-group-chip ${isCompact(group.key, mode) ? 'is-compact' : ''}" data-group-key="${escapeHtml(group.key)}" title="${isCompact(group.key, mode) ? 'Expand' : 'Compact'} ${escapeHtml(group.label)}">
          ${escapeHtml(group.label)} <strong>${group.count}</strong>
        </button>`).join('');
    }

    if (compactToggle) {
      compactToggle.hidden = mode === 'off' || groups.length === 0;
      const compact = compactKeys(mode);
      compactToggle.textContent = groups.length && groups.every((group) => compact.has(group.key)) ? 'Expand all' : 'Compact all';
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

  function mountControls() {
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface || document.getElementById('memoryGraphGroupUi')) return false;
    injectStyles();

    controls = document.createElement('div');
    controls.id = 'memoryGraphGroupUi';
    controls.className = 'memory-graph-group-ui';
    controls.innerHTML = `
      <div class="memory-graph-group-toolbar">
        <span class="memory-graph-group-label">Group</span>
        <button class="memory-graph-group-button" data-group-mode="off">Off</button>
        <button class="memory-graph-group-button" data-group-mode="type">Type</button>
        <button class="memory-graph-group-button" data-group-mode="project">Project</button>
        <button class="memory-graph-group-button" data-group-compact-all>Compact all</button>
      </div>
      <div class="memory-graph-group-chips" data-group-chips hidden></div>
    `;
    surface.appendChild(controls);
    chips = controls.querySelector('[data-group-chips]');
    compactToggle = controls.querySelector('[data-group-compact-all]');

    controls.addEventListener('click', (event) => {
      const modeButton = event.target.closest('[data-group-mode]');
      if (modeButton) {
        setMode(modeButton.dataset.groupMode);
        return;
      }

      const compactButton = event.target.closest('[data-group-compact-all]');
      if (compactButton) {
        toggleAllCompact();
        return;
      }

      const chip = event.target.closest('[data-group-key]');
      if (chip) toggleCompact(chip.dataset.groupKey);
    });

    renderControls();
    return true;
  }

  function observeWorkspace() {
    const spaceTitle = document.getElementById('spaceTitle');
    if (!spaceTitle) return;
    workspaceObserver?.disconnect();
    workspaceObserver = new MutationObserver(() => renderControls());
    workspaceObserver.observe(spaceTitle, { childList: true, characterData: true, subtree: true });
  }

  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  const previousFillText = proto?.fillText;
  if (proto && previousFillText && !proto.__memoryGraphGroupingLabelsInstalled) {
    Object.defineProperty(proto, '__memoryGraphGroupingLabelsInstalled', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    proto.fillText = function memoryGraphGroupingFillText(text, x, y, ...rest) {
      if (currentMode() === 'off' || !this?.canvas?.classList?.contains('memory-graph-canvas')) {
        return previousFillText.call(this, text, x, y, ...rest);
      }

      if (!/(?:^|\s)11px\b/.test(String(this.font || ''))) {
        return previousFillText.call(this, text, x, y, ...rest);
      }

      const query = document.getElementById('searchInput')?.value?.trim().toLowerCase() || '';
      const value = workspace();
      const spaceId = activeSpaceId();
      const mode = currentMode();
      const short = String(text || '');
      const memories = (value?.memories || []).filter((memory) => String(memory.spaceId) === spaceId && String(memory.status || 'confirmed') === 'confirmed');
      const memory = memories.find((item) => shortLabel(item.title, 22) === short);
      if (!memory) return previousFillText.call(this, text, x, y, ...rest);

      const info = groupInfo(memory, mode);
      if (!isCompact(info.key, mode)) return previousFillText.call(this, text, x, y, ...rest);
      if (query && [memory.title, memory.content, memory.source, memory.type, memory.importance, memory.project]
        .some((item) => String(item || '').toLowerCase().includes(query))) {
        return previousFillText.call(this, text, x, y, ...rest);
      }

      const members = memories
        .filter((item) => groupInfo(item, mode).key === info.key)
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (!members.length || String(members[0].id) !== String(memory.id)) return undefined;

      return previousFillText.call(this, `${info.label} · ${members.length}`, x, y, ...rest);
    };
  }

  function shortLabel(value, limit) {
    const text = String(value || '').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(1, limit - 1)).trim()}…`;
  }

  const wrappedRotation = Object.freeze({
    ...baseRotation,
    __memoryGroupingWrapped: true,
    version: `${baseRotation.version || 1}+groups${VERSION}`,
    isActive() {
      return baseRotation.isActive?.() === true || groupingActive();
    },
    project,
    reset() {
      if (baseRotation.isActive?.() === true) {
        baseRotation.reset?.();
        return;
      }
      if (groupingActive()) setMode('off');
    },
    snapshot() {
      return {
        ...(baseRotation.snapshot?.() || {}),
        groupingVersion: VERSION,
        groupingMode: currentMode(),
        groupingActive: groupingActive()
      };
    }
  });

  globalThis.MemoryGraphRotation = wrappedRotation;
  globalThis.MemoryGraphGrouping = Object.freeze({
    version: VERSION,
    mode: currentMode,
    setMode,
    groupingActive,
    toggleCompact,
    toggleAllCompact
  });

  function mount() {
    mountControls();
    observeWorkspace();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
