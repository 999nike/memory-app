(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  const MAX_SIMULATION_FRAMES = 900;
  const SETTLED_SPEED = 0.035;

  let surface = null;
  let canvas = null;
  let context = null;
  let resizeObserver = null;
  let workspaceObserver = null;
  let graph = null;
  let animationFrame = 0;
  let simulationFrames = 0;

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
    rebuildGraph(width, height);
  }

  function rebuildGraph(width, height) {
    stopSimulation();
    context.clearRect(0, 0, width, height);

    const data = activeGraphData();
    const count = document.getElementById('memoryGraphCount');
    if (!data) {
      graph = null;
      if (count) count.textContent = '0';
      drawMessage(width, height, 'Memory Space is unavailable');
      return;
    }

    graph = buildGraph(data, width, height);
    if (count) count.textContent = String(graph.nodes.length);
    simulationFrames = 0;
    drawGraph();

    if (graph.memoryNodes.length) startSimulation();
  }

  function buildGraph(data, width, height) {
    const centreX = width / 2;
    const centreY = height / 2;
    const spaceNode = {
      id: data.space.id,
      kind: 'space',
      label: data.space.name || 'Memory Space',
      x: centreX,
      y: centreY,
      vx: 0,
      vy: 0,
      radius: 40,
      fixed: true
    };

    const memories = data.memories;
    const startRing = Math.max(90, Math.min(width, height) * 0.32);
    const memoryNodes = memories.map((memory, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, memories.length)) * Math.PI * 2;
      return {
        id: memory.id,
        kind: 'memory',
        label: memory.title || 'Untitled memory',
        x: centreX + Math.cos(angle) * startRing,
        y: centreY + Math.sin(angle) * startRing,
        vx: 0,
        vy: 0,
        radius: 15,
        locked: Boolean(memory.locked),
        fixed: false
      };
    });

    return {
      width,
      height,
      centreX,
      centreY,
      orbitRadius: Math.max(88, Math.min(width, height) * 0.27),
      spaceNode,
      memoryNodes,
      nodes: [spaceNode, ...memoryNodes]
    };
  }

  function startSimulation() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(tick);
  }

  function stopSimulation() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function tick() {
    animationFrame = 0;
    if (!graph) return;

    const speed = simulateStep();
    drawGraph();
    simulationFrames += 1;

    if (simulationFrames < MAX_SIMULATION_FRAMES && speed > SETTLED_SPEED) {
      animationFrame = requestAnimationFrame(tick);
    }
  }

  function simulateStep() {
    const nodes = graph.memoryNodes;
    const centreX = graph.centreX;
    const centreY = graph.centreY;
    let totalSpeed = 0;

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      let fx = 0;
      let fy = 0;

      const dx = node.x - centreX;
      const dy = node.y - centreY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const radialOffset = distance - graph.orbitRadius;
      const radialForce = -radialOffset * 0.0019;
      fx += (dx / distance) * radialForce;
      fy += (dy / distance) * radialForce;

      for (let j = i + 1; j < nodes.length; j += 1) {
        const other = nodes[j];
        const pairX = node.x - other.x;
        const pairY = node.y - other.y;
        const pairDistanceSq = Math.max(100, pairX * pairX + pairY * pairY);
        const pairDistance = Math.sqrt(pairDistanceSq);
        const repulsion = Math.min(0.9, 900 / pairDistanceSq);
        const pushX = (pairX / pairDistance) * repulsion;
        const pushY = (pairY / pairDistance) * repulsion;
        fx += pushX;
        fy += pushY;
        other.vx -= pushX;
        other.vy -= pushY;
      }

      node.vx = (node.vx + fx) * 0.90;
      node.vy = (node.vy + fy) * 0.90;
      node.x += node.vx;
      node.y += node.vy;
      containNode(node);
      totalSpeed += Math.hypot(node.vx, node.vy);
    }

    return nodes.length ? totalSpeed / nodes.length : 0;
  }

  function containNode(node) {
    const margin = node.radius + 34;
    const minX = margin;
    const maxX = Math.max(margin, graph.width - margin);
    const minY = margin;
    const maxY = Math.max(margin, graph.height - margin);

    if (node.x < minX) {
      node.x = minX;
      node.vx *= -0.35;
    } else if (node.x > maxX) {
      node.x = maxX;
      node.vx *= -0.35;
    }

    if (node.y < minY) {
      node.y = minY;
      node.vy *= -0.35;
    } else if (node.y > maxY) {
      node.y = maxY;
      node.vy *= -0.35;
    }
  }

  function drawGraph() {
    if (!graph || !context) return;
    context.clearRect(0, 0, graph.width, graph.height);
    drawNode(graph.spaceNode);
    for (const node of graph.memoryNodes) drawNode(node);
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
