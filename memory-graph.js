(() => {
  'use strict';

  const VERSION = 2;
  const WORKSPACE_KEY = 'memory-space-v1';
  const MAX_SIMULATION_FRAMES = 900;
  const SETTLED_SPEED = 0.035;
  const MIN_SCALE = 0.45;
  const MAX_SCALE = 2.8;
  const IMPORTANCE_WEIGHT = {
    critical: 1.42,
    high: 1.20,
    normal: 1,
    low: 0.86
  };
  const IMPORTANCE_RADIUS = {
    critical: 23,
    high: 19,
    normal: 15,
    low: 12
  };

  let surface = null;
  let canvas = null;
  let context = null;
  let resizeObserver = null;
  let workspaceObserver = null;
  let graph = null;
  let animationFrame = 0;
  let simulationFrames = 0;
  let pointerState = null;
  let interactionsBound = false;
  const view = {
    x: 0,
    y: 0,
    scale: 1
  };

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

    const allMemories = workspace.memories.filter((memory) => memory.spaceId === space.id);
    const memories = allMemories.filter((memory) =>
      String(memory.status || 'confirmed') === 'confirmed'
    );

    return { space, memories, allMemories };
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
    bindInteractions();
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

    const previousSpaceId = graph?.spaceNode?.id || null;
    if (previousSpaceId && previousSpaceId !== data.space.id) resetView();

    graph = buildGraph(data, width, height);
    if (count) count.textContent = String(graph.nodes.length);
    simulationFrames = 0;
    drawGraph();

    if (graph.memoryNodes.length) startSimulation();
  }

  function buildGraph(data, width, height) {
    const centreX = width / 2;
    const centreY = height / 2;
    const baseOrbit = Math.max(88, Math.min(width, height) * 0.27);
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
      const profile = memoryProfile(memory, data.allMemories);
      return {
        id: memory.id,
        kind: 'memory',
        label: memory.title || 'Untitled memory',
        x: centreX + Math.cos(angle) * startRing,
        y: centreY + Math.sin(angle) * startRing,
        vx: 0,
        vy: 0,
        radius: profile.radius,
        targetOrbit: Math.max(62, baseOrbit / profile.gravityWeight),
        gravityWeight: profile.gravityWeight,
        relationshipCount: profile.relationshipCount,
        recencyLevel: profile.recencyLevel,
        importance: profile.importance,
        supersedesId: memory.supersedesId || null,
        supersededById: memory.supersededById || null,
        locked: Boolean(memory.locked),
        fixed: false,
        dragging: false
      };
    });

    const edges = buildRealEdges(spaceNode, memoryNodes);

    return {
      width,
      height,
      centreX,
      centreY,
      orbitRadius: baseOrbit,
      spaceNode,
      memoryNodes,
      nodes: [spaceNode, ...memoryNodes],
      edges
    };
  }

  function memoryProfile(memory, allMemories) {
    const importance = String(memory.importance || 'normal').toLowerCase();
    const importanceWeight = IMPORTANCE_WEIGHT[importance] || IMPORTANCE_WEIGHT.normal;
    const baseRadius = IMPORTANCE_RADIUS[importance] || IMPORTANCE_RADIUS.normal;
    const relationshipCount = countRealRelationships(memory, allMemories);
    const relationshipWeight = 1 + Math.min(4, Math.max(0, relationshipCount - 1)) * 0.07;
    const recencyLevel = recencyScore(memory.updatedAt || memory.createdAt);
    const recencyWeight = 0.93 + recencyLevel * 0.17;
    const radius = baseRadius + Math.min(3, Math.max(0, relationshipCount - 1));

    return {
      importance,
      radius,
      relationshipCount,
      recencyLevel,
      gravityWeight: importanceWeight * relationshipWeight * recencyWeight
    };
  }

  function countRealRelationships(memory, allMemories) {
    const relatedIds = new Set();
    if (memory.supersedesId) relatedIds.add(String(memory.supersedesId));
    if (memory.supersededById) relatedIds.add(String(memory.supersededById));

    for (const other of allMemories) {
      if (!other || other.id === memory.id) continue;
      if (other.supersedesId === memory.id || other.supersededById === memory.id) {
        relatedIds.add(String(other.id));
      }
    }

    // Every rendered memory has one real Space -> Memory relationship.
    return 1 + relatedIds.size;
  }

  function recencyScore(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 0.25;

    const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
    if (ageDays <= 7) return 1;
    if (ageDays <= 30) return 0.76;
    if (ageDays <= 90) return 0.48;
    if (ageDays <= 365) return 0.24;
    return 0.08;
  }

  function buildRealEdges(spaceNode, memoryNodes) {
    const edges = memoryNodes.map((node) => ({
      source: spaceNode,
      target: node,
      kind: 'space'
    }));

    const byId = new Map(memoryNodes.map((node) => [node.id, node]));
    const seenRevisionPairs = new Set();

    for (const node of memoryNodes) {
      for (const relatedId of [node.supersedesId, node.supersededById]) {
        if (!relatedId) continue;
        const related = byId.get(String(relatedId));
        if (!related || related.id === node.id) continue;

        const key = [String(node.id), String(related.id)].sort().join('::');
        if (seenRevisionPairs.has(key)) continue;
        seenRevisionPairs.add(key);
        edges.push({
          source: node,
          target: related,
          kind: 'revision'
        });
      }
    }

    return edges;
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
    let simulatedCount = 0;

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.dragging) continue;

      let fx = 0;
      let fy = 0;

      const dx = node.x - centreX;
      const dy = node.y - centreY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const radialOffset = distance - (node.targetOrbit || graph.orbitRadius);
      const radialForce = -radialOffset * 0.0019 * Math.max(0.8, node.gravityWeight || 1);
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
        fx += pushX / Math.max(0.85, node.gravityWeight || 1);
        fy += pushY / Math.max(0.85, node.gravityWeight || 1);
        if (!other.dragging) {
          other.vx -= pushX / Math.max(0.85, other.gravityWeight || 1);
          other.vy -= pushY / Math.max(0.85, other.gravityWeight || 1);
        }
      }

      node.vx = (node.vx + fx) * 0.90;
      node.vy = (node.vy + fy) * 0.90;
      node.x += node.vx;
      node.y += node.vy;
      containNode(node);
      totalSpeed += Math.hypot(node.vx, node.vy);
      simulatedCount += 1;
    }

    return simulatedCount ? totalSpeed / simulatedCount : 0;
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

    context.save();
    context.translate(view.x, view.y);
    context.scale(view.scale, view.scale);
    for (const edge of graph.edges || []) drawEdge(edge);
    drawNode(graph.spaceNode);
    for (const node of graph.memoryNodes) drawNode(node);
    context.restore();
  }

  function drawEdge(edge) {
    const revision = edge.kind === 'revision';

    context.save();
    context.beginPath();
    context.moveTo(edge.source.x, edge.source.y);
    context.lineTo(edge.target.x, edge.target.y);
    context.lineWidth = revision ? 1.35 : 0.85;
    context.strokeStyle = revision
      ? 'rgba(199, 255, 86, 0.34)'
      : 'rgba(120, 184, 255, 0.16)';
    if (revision) context.setLineDash([5, 4]);
    context.stroke();
    context.restore();
  }

  function drawNode(node) {
    const isSpace = node.kind === 'space';
    const recency = isSpace ? 1 : Number(node.recencyLevel || 0);
    const fillAlpha = isSpace ? 0.24 : 0.10 + recency * 0.16;
    const strokeAlpha = isSpace ? 0.95 : 0.56 + recency * 0.30;
    const glowAlpha = isSpace ? 0.55 : 0.18 + recency * 0.30;
    const glowBlur = isSpace ? 24 : 7 + recency * 13;

    context.save();
    context.beginPath();
    context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    context.fillStyle = isSpace ? 'rgba(120, 184, 255, 0.24)' : `rgba(199, 255, 86, ${fillAlpha.toFixed(3)})`;
    context.fill();

    context.lineWidth = node.locked ? 3 : isSpace ? 2.5 : 1.5;
    context.strokeStyle = isSpace
      ? 'rgba(120, 184, 255, 0.95)'
      : `rgba(199, 255, 86, ${strokeAlpha.toFixed(3)})`;
    context.stroke();

    context.shadowBlur = glowBlur;
    context.shadowColor = isSpace
      ? 'rgba(120, 184, 255, 0.55)'
      : `rgba(199, 255, 86, ${glowAlpha.toFixed(3)})`;
    context.stroke();
    context.restore();

    context.save();
    context.fillStyle = isSpace ? 'rgba(242, 244, 247, 0.94)' : `rgba(242, 244, 247, ${(0.70 + recency * 0.24).toFixed(3)})`;
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

  function bindInteractions() {
    if (!canvas || interactionsBound) return;
    interactionsBound = true;

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
  }

  function handlePointerDown(event) {
    if (!graph || event.button !== 0) return;

    const point = pointerPoint(event);
    const world = screenToWorld(point);
    const node = findNodeAt(world.x, world.y);

    pointerState = {
      pointerId: event.pointerId,
      mode: node?.kind === 'memory' ? 'node' : 'pan',
      node: node?.kind === 'memory' ? node : null,
      lastX: point.x,
      lastY: point.y
    };

    if (pointerState.node) {
      pointerState.node.dragging = true;
      pointerState.node.vx = 0;
      pointerState.node.vy = 0;
      stopSimulation();
    }

    canvas.setPointerCapture?.(event.pointerId);
    canvas.dataset.interacting = 'true';
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!graph || !canvas) return;

    const point = pointerPoint(event);
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      const world = screenToWorld(point);
      canvas.dataset.hoverNode = findNodeAt(world.x, world.y)?.kind === 'memory' ? 'true' : 'false';
      return;
    }

    if (pointerState.mode === 'node' && pointerState.node) {
      const world = screenToWorld(point);
      pointerState.node.x = world.x;
      pointerState.node.y = world.y;
      pointerState.node.vx = 0;
      pointerState.node.vy = 0;
      containNode(pointerState.node);
    } else {
      view.x += point.x - pointerState.lastX;
      view.y += point.y - pointerState.lastY;
    }

    pointerState.lastX = point.x;
    pointerState.lastY = point.y;
    drawGraph();
    event.preventDefault();
  }

  function handlePointerUp(event) {
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;

    const draggedNode = pointerState.node;
    if (draggedNode) {
      draggedNode.dragging = false;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      simulationFrames = 0;
      startSimulation();
    }

    pointerState = null;
    canvas?.removeAttribute('data-interacting');
    try {
      canvas?.releasePointerCapture?.(event.pointerId);
    } catch {}
    drawGraph();
  }

  function handleWheel(event) {
    if (!graph || !canvas) return;

    const point = pointerPoint(event);
    const worldBefore = screenToWorld(point);
    const zoomFactor = Math.exp(-event.deltaY * 0.0012);
    const nextScale = clamp(view.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
    if (nextScale === view.scale) {
      event.preventDefault();
      return;
    }

    view.scale = nextScale;
    view.x = point.x - worldBefore.x * view.scale;
    view.y = point.y - worldBefore.y * view.scale;
    drawGraph();
    event.preventDefault();
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function screenToWorld(point) {
    return {
      x: (point.x - view.x) / view.scale,
      y: (point.y - view.y) / view.scale
    };
  }

  function findNodeAt(x, y) {
    if (!graph) return null;

    for (let i = graph.memoryNodes.length - 1; i >= 0; i -= 1) {
      const node = graph.memoryNodes[i];
      if (Math.hypot(x - node.x, y - node.y) <= node.radius + 5) return node;
    }

    const space = graph.spaceNode;
    if (space && Math.hypot(x - space.x, y - space.y) <= space.radius + 5) return space;
    return null;
  }

  function resetView() {
    view.x = 0;
    view.y = 0;
    view.scale = 1;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
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
