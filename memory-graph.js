(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  let surface = null;
  let canvas = null;
  let context = null;
  let resizeObserver = null;
  let workspaceObserver = null;

  function loadWorkspace() {
    try {
      const value = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      if (!value || !Array.isArray(value.spaces) || !Array.isArray(value.memories)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function activeGraphData() {
    const workspace = loadWorkspace();
    if (!workspace) return null;

    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    if (!space) return null;

    const memories = workspace.memories.filter((memory) =>
      memory.spaceId === space.id && String(memory.status || 'confirmed') === 'confirmed'
    );

    return { space, memories };
  }

  function ensureCanvas() {
    if (!surface) return false;
    if (canvas && context) return true;

    surface.classList.remove('empty-state');
    surface.innerHTML = '';

    canvas = document.createElement('canvas');
    canvas.className = 'memory-graph-canvas';
    canvas.setAttribute('aria-label', 'Memory graph showing the active Space and confirmed memories');
    surface.appendChild(canvas);
    context = canvas.getContext('2d');
    return Boolean(context);
  }

  function resizeCanvas() {
    if (!surface || !canvas || !context) return;
    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderGraph(width, height);
  }

  function renderGraph(width, height) {
    if (!context) return;
    context.clearRect(0, 0, width, height);

    const data = activeGraphData();
    const count = document.getElementById('memoryGraphCount');
    if (!data) {
      if (count) count.textContent = '0';
      drawMessage(width, height, 'Memory Space is unavailable');
      return;
    }

    const nodes = buildStaticNodes(data, width, height);
    if (count) count.textContent = String(nodes.length);

    for (const node of nodes) drawNode(node);
  }

  function buildStaticNodes(data, width, height) {
    const centreX = width / 2;
    const centreY = height / 2;
    const nodes = [{
      id: data.space.id,
      kind: 'space',
      label: data.space.name || 'Memory Space',
      x: centreX,
      y: centreY,
      radius: 40
    }];

    const memories = data.memories;
    if (!memories.length) return nodes;

    const ring = Math.max(90, Math.min(width, height) * 0.34);
    memories.forEach((memory, index) => {
      const angle = -Math.PI / 2 + (index / memories.length) * Math.PI * 2;
      nodes.push({
        id: memory.id,
        kind: 'memory',
        label: memory.title || 'Untitled memory',
        x: centreX + Math.cos(angle) * ring,
        y: centreY + Math.sin(angle) * ring,
        radius: 15,
        locked: Boolean(memory.locked)
      });
    });

    return nodes;
  }

  function drawNode(node) {
    const isSpace = node.kind === 'space';

    context.save();
    context.beginPath();
    context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    context.fillStyle = isSpace ? 'rgba(120, 184, 255, 0.24)' : 'rgba(199, 255, 86, 0.18)';
    context.fill();

    context.lineWidth = node.locked ? 3 : isSpace ? 2.5 : 1.5;
    context.strokeStyle = isSpace ? 'rgba(120, 184, 255, 0.95)' : 'rgba(199, 255, 86, 0.80)';
    context.stroke();

    context.shadowBlur = isSpace ? 24 : 12;
    context.shadowColor = isSpace ? 'rgba(120, 184, 255, 0.55)' : 'rgba(199, 255, 86, 0.35)';
    context.stroke();
    context.restore();

    context.save();
    context.fillStyle = 'rgba(242, 244, 247, 0.94)';
    context.font = isSpace ? '700 14px Inter, system-ui, sans-serif' : '600 11px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(shortLabel(node.label, isSpace ? 26 : 22), node.x, node.y + node.radius + 8);
    context.restore();
  }

  function drawMessage(width, height, message) {
    context.save();
    context.fillStyle = 'rgba(145, 154, 170, 0.9)';
    context.font = '600 13px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, width / 2, height / 2);
    context.restore();
  }

  function shortLabel(value, limit) {
    const text = String(value || '').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(1, limit - 1)).trim()}…`;
  }

  function refresh() {
    if (!surface || !canvas) return;
    resizeCanvas();
  }

  function observeWorkspaceUi() {
    const memoryGrid = document.getElementById('memoryGrid');
    const spaceTitle = document.getElementById('spaceTitle');
    if (!memoryGrid && !spaceTitle) return;

    workspaceObserver = new MutationObserver(refresh);
    if (memoryGrid) workspaceObserver.observe(memoryGrid, { childList: true });
    if (spaceTitle) workspaceObserver.observe(spaceTitle, { childList: true, characterData: true, subtree: true });
  }

  function mount() {
    const section = document.getElementById('memoryGraphSection');
    surface = document.getElementById('memoryGraphSurface');
    if (!section || !surface || !ensureCanvas()) return false;

    surface.dataset.memoryGraphReady = 'true';
    section.dataset.memoryGraphVersion = String(VERSION);

    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(surface);

    workspaceObserver?.disconnect();
    observeWorkspaceUi();
    resizeCanvas();
    return true;
  }

  globalThis.MemoryGraph = Object.freeze({
    version: VERSION,
    mount,
    refresh
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
