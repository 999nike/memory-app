(() => {
  'use strict';

  const VERSION = 11;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GRAPH_STATE_KEY = 'memory-graph-layout-v1';
  const GRAPH_STATE_VERSION = 1;
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
  let searchBound = false;
  let focusedNodeId = null;
  let persistTimer = 0;
  let viewTransitionFrame = 0;
  const presentationControlSpecs = new Map();
  const presentationControlNodes = new Map();
  let activeControlParentId = null;
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

  function loadGraphState() {
    try {
      const value = JSON.parse(localStorage.getItem(GRAPH_STATE_KEY) || 'null');
      if (!value || value.version !== GRAPH_STATE_VERSION || !value.spaces || typeof value.spaces !== 'object') {
        return { version: GRAPH_STATE_VERSION, spaces: {} };
      }
      return value;
    } catch {
      return { version: GRAPH_STATE_VERSION, spaces: {} };
    }
  }

  function savedStateForSpace(spaceId) {
    if (!spaceId) return null;
    const store = loadGraphState();
    const saved = store.spaces?.[spaceId];
    return saved && typeof saved === 'object' ? saved : null;
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
    stopViewTransition();
    stopSimulation();
    context.clearRect(0, 0, width, height);

    const data = activeGraphData();
    const count = document.getElementById('memoryGraphCount');
    if (!data) {
      graph = null;
      focusedNodeId = null;
      if (count) count.textContent = '0';
      drawMessage(width, height, 'Memory Space is unavailable');
      return;
    }

    const previousSpaceId = graph?.spaceNode?.id || null;
    const savedState = savedStateForSpace(data.space.id);
    if (previousSpaceId && previousSpaceId !== data.space.id) resetView();

    graph = buildGraph(data, width, height, savedState);
    syncCanonicalGraphCollections();
    for (const node of graph.nodes) {
      if (!node.fixed) containNode(node);
    }
    restoreSavedView(savedState?.view, width, height);
    if (count) count.textContent = String(graph.memoryNodes.length + 1);
    simulationFrames = 0;

    const searchInput = document.getElementById('searchInput');
    const activeQuery = searchInput?.value?.trim() || '';
    if (activeQuery) {
      focusSearchTerm(activeQuery, false);
    } else {
      focusedNodeId = null;
    }
    drawGraph();

    if (graph.nodes.length > 1) startSimulation();
  }

  function buildGraph(data, width, height, savedState = null) {
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
      const savedNode = savedState?.nodes?.[memory.id];
      const savedOffsetX = Number(savedNode?.offsetX);
      const savedOffsetY = Number(savedNode?.offsetY);
      const hasSavedPosition = Number.isFinite(savedOffsetX) && Number.isFinite(savedOffsetY);
      return {
        id: memory.id,
        kind: 'memory',
        label: memory.title || 'Untitled memory',
        x: hasSavedPosition ? centreX + savedOffsetX * width : centreX + Math.cos(angle) * startRing,
        y: hasSavedPosition ? centreY + savedOffsetY * height : centreY + Math.sin(angle) * startRing,
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
    buildPresentationControlNodes(width, height, centreX, centreY, baseOrbit);

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

  function buildPresentationControlNodes(width, height, centreX, centreY, baseOrbit) {
    const liveIds = new Set(presentationControlSpecs.keys());
    for (const id of [...presentationControlNodes.keys()]) {
      if (!liveIds.has(id)) presentationControlNodes.delete(id);
    }

    const targetOrbit = Math.max(62, baseOrbit);
    const nodes = [];
    for (const [id, spec] of presentationControlSpecs) {
      if (spec.parentId) continue;
      let node = presentationControlNodes.get(id);
      if (!node) {
        const angle = Number(spec.sectorAngle || 0);
        node = {
          id,
          kind: 'control',
          label: String(spec.label || 'Control'),
          x: centreX + Math.cos(angle) * targetOrbit,
          y: centreY + Math.sin(angle) * targetOrbit * 0.76,
          vx: 0,
          vy: 0,
          radius: 18,
          targetOrbit,
          parentId: null,
          action: String(spec.action || ''),
          expandable: Boolean(spec.expandable),
          controlDepth: 0,
          recencyLevel: 0.82,
          gravityWeight: 1,
          fixed: false,
          dragging: false
        };
        presentationControlNodes.set(id, node);
      }
      node.label = String(spec.label || node.label || 'Control');
      node.radius = Math.max(12, Number(spec.radius) || 18);
      node.targetOrbit = targetOrbit;
      node.parentId = null;
      node.action = String(spec.action || '');
      node.expandable = Boolean(spec.expandable);
      node.controlDepth = 0;
      node.hidden = false;
      nodes.push(node);
    }

    for (const [id, spec] of presentationControlSpecs) {
      if (!spec.parentId) continue;
      const parent = presentationControlNodes.get(spec.parentId);
      if (!parent) continue;
      const siblings = [...presentationControlSpecs.values()].filter((item) => item.parentId === spec.parentId);
      const siblingIndex = Math.max(0, siblings.findIndex((item) => item.id === id));
      const depth = presentationControlDepth(spec);
      const spawnOrbit = Math.max(48, Number(parent.radius || 15) + Math.max(11, Number(spec.radius) || 15) + 22);
      let node = presentationControlNodes.get(id);
      if (!node) {
        const angle = childControlAngle(parent, siblingIndex, siblings.length, centreX, centreY);
        node = {
          id,
          kind: 'control',
          label: String(spec.label || 'Control'),
          x: parent.x + Math.cos(angle) * spawnOrbit,
          y: parent.y + Math.sin(angle) * spawnOrbit,
          vx: 0,
          vy: 0,
          radius: 15,
          targetOrbit,
          parentId: spec.parentId,
          action: String(spec.action || ''),
          expandable: Boolean(spec.expandable),
          controlDepth: depth,
          recencyLevel: 0.72,
          gravityWeight: 1,
          fixed: false,
          dragging: false
        };
        presentationControlNodes.set(id, node);
      }
      node.label = String(spec.label || node.label || 'Control');
      node.radius = Math.max(11, Number(spec.radius) || 15);
      node.targetOrbit = targetOrbit;
      node.parentId = spec.parentId;
      node.action = String(spec.action || '');
      node.expandable = Boolean(spec.expandable);
      node.controlDepth = depth;
      node.hidden = !presentationControlVisible(node);
      nodes.push(node);
    }
    return nodes;
  }

  function childControlAngle(parent, index, count, centreX = graph?.centreX || 0, centreY = graph?.centreY || 0) {
    const outward = Math.atan2(parent.y - centreY, parent.x - centreX);
    const arc = Math.min(Math.PI * 0.92, Math.max(Math.PI * 0.54, count * 0.34));
    return outward - arc / 2 + ((index + 0.5) / Math.max(1, count)) * arc;
  }

  function presentationControlDepth(spec) {
    let depth = 0;
    let current = spec;
    const visited = new Set();
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      depth += 1;
      current = presentationControlSpecs.get(String(current.parentId));
    }
    return depth;
  }

  function presentationControlVisible(node) {
    if (!node?.parentId) return true;
    if (String(node.parentId) === 'settings') return Boolean(activeControlParentId);
    return String(node.parentId) === String(activeControlParentId || '');
  }

  function visibleControlNodes() {
    return (graph?.nodes || []).filter((node) => node.kind === 'control' && !node.hidden);
  }

  function presentationControlEdges() {
    if (!graph) return [];
    const settings = presentationControlNodes.get('settings');
    if (!settings) return [];
    const rootEdges = [{
      source: graph.spaceNode,
      target: settings,
      kind: 'space',
      hidden: Boolean(activeControlParentId)
    }];
    const childEdges = [...presentationControlNodes.values()]
      .filter((node) => node.parentId)
      .flatMap((node) => {
        const parent = presentationControlNodes.get(String(node.parentId));
        return parent?.kind === 'control'
          ? [{ source: parent, target: node, kind: 'space' }]
          : [];
      });
    return [...rootEdges, ...childEdges];
  }

  function syncCanonicalGraphCollections() {
    if (!graph) return false;
    const controls = [...presentationControlNodes.values()];
    graph.nodes = [graph.spaceNode, ...graph.memoryNodes, ...controls];
    graph.edges = [...buildRealEdges(graph.spaceNode, graph.memoryNodes), ...presentationControlEdges()];
    return true;
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
    } else {
      persistGraphState(false);
    }
  }

  function simulateStep() {
    const nodes = graph.nodes.filter((node) => !node.fixed && !node.hidden);
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

      // Active Settings children remain ordinary graph bodies while receiving
      // one small parent-local attraction in this same simulation tick.
      const localParent = node.parentId
        ? graph.nodes.find((candidate) => candidate.kind === 'control'
          && !candidate.hidden
          && String(candidate.id) === String(node.parentId))
        : null;
      if (localParent && !localParent.hidden) {
        fx += (localParent.x - node.x) * 0.0011;
        fy += (localParent.y - node.y) * 0.0011;
      }

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
    const zoomExtent = Math.max(1, 1 / MIN_SCALE);
    const extraX = Math.max(0, graph.width * (zoomExtent - 1) / 2);
    const extraY = Math.max(0, graph.height * (zoomExtent - 1) / 2);
    const minX = margin - extraX;
    const maxX = graph.width - margin + extraX;
    const minY = margin - extraY;
    const maxY = graph.height - margin + extraY;

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

  function rotationApi() {
    return globalThis.MemoryGraphRotation || null;
  }

  function rotationActive() {
    return rotationApi()?.isActive?.() === true;
  }

  function projectedNode(node) {
    const projected = rotationApi()?.project?.(node, graph);
    if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) return projected;
    return {
      x: node.x,
      y: node.y,
      radius: node.radius,
      depth: 0,
      alpha: 1,
      scale: 1
    };
  }

  function orderedDrawableNodes() {
    const nodes = graph.nodes.filter((node) => !node.fixed && !node.hidden);
    if (!rotationActive()) return nodes;
    return nodes.sort((a, b) => projectedNode(a).depth - projectedNode(b).depth);
  }

  function syncRotationState() {
    if (!surface) return;
    surface.dataset.rotationActive = rotationActive() ? 'true' : 'false';
  }

  function drawGraph() {
    if (!graph || !context) return;
    context.clearRect(0, 0, graph.width, graph.height);
    syncRotationState();

    context.save();
    context.translate(view.x, view.y);
    context.scale(view.scale, view.scale);
    for (const edge of graph.edges || []) {
      if (!edge.source.hidden && !edge.target.hidden) drawEdge(edge);
    }

    if (rotationActive()) {
      for (const node of orderedDrawableNodes()) drawNodeAboveConnectors(node);
      drawNodeAboveConnectors(graph.spaceNode);
    } else {
      drawNodeAboveConnectors(graph.spaceNode);
      for (const node of graph.nodes) {
        if (!node.fixed && !node.hidden) drawNodeAboveConnectors(node);
      }
    }

    context.restore();
    surface?.dispatchEvent(new CustomEvent('memory-graph-drawn'));
  }

  function drawEdge(edge) {
    const revision = edge.kind === 'revision';
    const source = projectedNode(edge.source);
    const target = projectedNode(edge.target);

    context.save();
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.lineWidth = revision ? 1.35 : 0.85;
    context.strokeStyle = revision
      ? 'rgba(199, 255, 86, 0.34)'
      : 'rgba(120, 184, 255, 0.16)';
    if (revision) context.setLineDash([5, 4]);
    context.stroke();
    context.restore();
  }

  function drawNodeAboveConnectors(node) {
    const projected = projectedNode(node);
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(projected.x, projected.y, projected.radius + 1.5, 0, Math.PI * 2);
    context.fillStyle = '#050d12';
    context.fill();
    context.restore();
    drawNode(node);
  }

  function drawNode(node) {
    const isSpace = node.kind === 'space';
    const recency = isSpace ? 1 : Number(node.recencyLevel || 0);
    const fillAlpha = isSpace ? 0.24 : 0.10 + recency * 0.16;
    const strokeAlpha = isSpace ? 0.95 : 0.56 + recency * 0.30;
    const glowAlpha = isSpace ? 0.55 : 0.18 + recency * 0.30;
    const glowBlur = isSpace ? 24 : 7 + recency * 13;
    const focused = node.id === focusedNodeId;
    const projected = projectedNode(node);
    const nodeX = projected.x;
    const nodeY = projected.y;
    const nodeRadius = projected.radius;
    const depthAlpha = isSpace ? 1 : Number(projected.alpha || 1);

    context.save();
    context.globalAlpha = depthAlpha;
    context.beginPath();
    context.arc(nodeX, nodeY, nodeRadius, 0, Math.PI * 2);
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

    if (focused) {
      context.save();
      context.beginPath();
      context.arc(nodeX, nodeY, nodeRadius + 8, 0, Math.PI * 2);
      context.lineWidth = 2.5;
      context.strokeStyle = 'rgba(120, 184, 255, 0.98)';
      context.shadowBlur = 18;
      context.shadowColor = 'rgba(120, 184, 255, 0.72)';
      context.stroke();
      context.restore();
    }

    context.save();
    context.globalAlpha = depthAlpha;
    context.fillStyle = isSpace ? 'rgba(242, 244, 247, 0.94)' : `rgba(242, 244, 247, ${(0.70 + recency * 0.24).toFixed(3)})`;
    context.font = isSpace ? '700 14px Inter, system-ui, sans-serif' : '600 11px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.fillText(shortLabel(node.label, isSpace ? 26 : 22), nodeX, nodeY + nodeRadius + 8);
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
    canvas.addEventListener('dblclick', handleGraphDoubleClick);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleGraphKeyDown);
  }

  function bindSearch() {
    if (searchBound) return;
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    searchBound = true;
    searchInput.addEventListener('input', () => {
      focusSearchTerm(searchInput.value);
    });
  }

  function handleGraphKeyDown(event) {
    if (event.key !== 'Escape' || !rotationActive()) return;
    rotationApi()?.reset?.();
    syncRotationState();
    drawGraph();
  }

  function handlePointerDown(event) {
    if (!graph || event.button !== 0) return;
    stopViewTransition();

    const point = pointerPoint(event);
    const rotation = rotationApi();
    const rotateMode = rotation?.shouldStart?.(event) === true;

    if (rotateMode) {
      rotation.begin?.();
      stopSimulation();
      pointerState = {
        pointerId: event.pointerId,
        mode: 'rotate',
        node: null,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false
      };
    } else {
      const world = screenToWorld(point);
      const node = findNodeAt(world.x, world.y);
      const rotated = rotationActive();

      pointerState = {
        pointerId: event.pointerId,
        mode: node?.kind === 'space'
          ? 'home'
          : node?.kind === 'memory'
            ? (rotated ? 'inspect' : 'node')
            : node?.kind === 'control'
              ? (rotated ? 'control-inspect' : 'control')
              : 'pan',
        node: node?.kind === 'memory' || node?.kind === 'control' ? node : null,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
        resumeSimulation: node?.kind === 'space' && Boolean(animationFrame)
      };

      if ((pointerState.mode === 'node' || pointerState.mode === 'control') && pointerState.node) {
        pointerState.node.dragging = true;
        pointerState.node.vx = 0;
        pointerState.node.vy = 0;
        stopSimulation();
      } else if (pointerState.mode === 'home') {
        stopSimulation();
      }
    }

    canvas.setPointerCapture?.(event.pointerId);
    canvas.dataset.interacting = 'true';
    syncRotationState();
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!graph || !canvas) return;

    const point = pointerPoint(event);
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      const world = screenToWorld(point);
      const hoveredKind = findNodeAt(world.x, world.y)?.kind;
      canvas.dataset.hoverNode = hoveredKind === 'memory' || hoveredKind === 'control' ? 'true' : 'false';
      return;
    }

    if (Math.hypot(point.x - pointerState.startX, point.y - pointerState.startY) > 6) {
      pointerState.moved = true;
    }

    const deltaX = point.x - pointerState.lastX;
    const deltaY = point.y - pointerState.lastY;

    if (pointerState.mode === 'rotate') {
      rotationApi()?.update?.(deltaX, deltaY);
      syncRotationState();
    } else if ((pointerState.mode === 'node' || pointerState.mode === 'control') && pointerState.node) {
      const world = screenToWorld(point);
      pointerState.node.x = world.x;
      pointerState.node.y = world.y;
      pointerState.node.vx = 0;
      pointerState.node.vy = 0;
      containNode(pointerState.node);
    } else if (pointerState.mode === 'pan' || pointerState.mode === 'home') {
      view.x += deltaX;
      view.y += deltaY;
    }

    pointerState.lastX = point.x;
    pointerState.lastY = point.y;
    drawGraph();
    event.preventDefault();
  }

  function handlePointerUp(event) {
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;

    const mode = pointerState.mode;
    const selectedNode = pointerState.node;
    const shouldOpen = Boolean(selectedNode && !pointerState.moved && (
      mode === 'node' || mode === 'inspect' || mode === 'control' || mode === 'control-inspect'
    ));

    if (mode === 'rotate') {
      rotationApi()?.end?.();
      simulationFrames = 0;
      startSimulation();
    } else if ((mode === 'node' || mode === 'control') && selectedNode) {
      selectedNode.dragging = false;
      selectedNode.vx = 0;
      selectedNode.vy = 0;
      simulationFrames = 0;
      startSimulation();
    } else if (mode === 'home' && pointerState.resumeSimulation) {
      startSimulation();
    }

    if (mode === 'home' && !pointerState.moved) {
      collapsePresentationControls();
      focusSpace({ animate: true });
      surface?.dispatchEvent(new CustomEvent('memory-graph-home'));
    }

    if (shouldOpen && selectedNode.kind === 'control') activatePresentationControl(selectedNode);
    else if (shouldOpen) {
      collapsePresentationControls();
      openExistingInspector(selectedNode.id);
    }

    if (pointerState.moved && (mode === 'pan' || mode === 'inspect' || mode === 'home')) {
      persistGraphState(true);
    } else if (pointerState.moved && mode === 'node') {
      persistGraphState(false);
    }

    pointerState = null;
    canvas?.removeAttribute('data-interacting');
    try {
      canvas?.releasePointerCapture?.(event.pointerId);
    } catch {}
    syncRotationState();
    drawGraph();
  }

  function handleGraphDoubleClick(event) {
    if (!graph || event.button !== 0) return;
    const world = screenToWorld(pointerPoint(event));
    if (findNodeAt(world.x, world.y)?.kind !== 'space') return;
    handleGraphKeyDown({ key: 'Escape' });
    event.preventDefault();
  }

  function openExistingInspector(memoryId) {
    const memoryGrid = document.getElementById('memoryGrid');
    if (!memoryGrid || !memoryId) return false;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.hidden = true;
    trigger.dataset.memoryId = String(memoryId);
    memoryGrid.appendChild(trigger);
    trigger.click();
    trigger.remove();
    return true;
  }

  function handleWheel(event) {
    if (!graph || !canvas) return;
    stopViewTransition();

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
    schedulePersistGraphState(true, 180);
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

    const drawableNodes = graph.nodes.filter((node) => !node.fixed && !node.hidden);
    const candidates = rotationActive()
      ? drawableNodes.sort((a, b) => projectedNode(b).depth - projectedNode(a).depth)
      : drawableNodes.reverse();

    for (const node of candidates) {
      const projected = projectedNode(node);
      if (Math.hypot(x - projected.x, y - projected.y) <= projected.radius + 5) return node;
    }

    const space = graph.spaceNode;
    if (space) {
      const projected = projectedNode(space);
      if (Math.hypot(x - projected.x, y - projected.y) <= projected.radius + 5) return space;
    }
    return null;
  }

  function restoreSavedView(savedView, width, height) {
    if (!savedView) return false;

    const scale = Number(savedView.scale);
    const centreX = Number(savedView.centreX);
    const centreY = Number(savedView.centreY);
    if (!Number.isFinite(scale) || !Number.isFinite(centreX) || !Number.isFinite(centreY)) return false;

    view.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    view.x = width / 2 - centreX * view.scale;
    view.y = height / 2 - centreY * view.scale;
    return true;
  }

  function serialiseView() {
    if (!graph) return null;
    const centre = screenToWorld({ x: graph.width / 2, y: graph.height / 2 });
    return {
      scale: view.scale,
      centreX: centre.x,
      centreY: centre.y
    };
  }

  function serialiseNodes() {
    if (!graph) return {};
    const width = Math.max(1, graph.width);
    const height = Math.max(1, graph.height);
    const nodes = {};

    for (const node of graph.memoryNodes) {
      nodes[node.id] = {
        offsetX: (node.x - graph.centreX) / width,
        offsetY: (node.y - graph.centreY) / height
      };
    }

    return nodes;
  }

  function persistGraphState(includeView = true) {
    if (!graph?.spaceNode?.id) return false;

    const store = loadGraphState();
    const spaceId = String(graph.spaceNode.id);
    const current = store.spaces?.[spaceId] && typeof store.spaces[spaceId] === 'object'
      ? store.spaces[spaceId]
      : {};

    const next = {
      ...current,
      nodes: serialiseNodes(),
      updatedAt: new Date().toISOString()
    };

    if (includeView) {
      next.view = serialiseView();
    }

    store.spaces[spaceId] = next;

    try {
      localStorage.setItem(GRAPH_STATE_KEY, JSON.stringify(store));
      return true;
    } catch {
      return false;
    }
  }

  function schedulePersistGraphState(includeView = true, delay = 150) {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persistGraphState(includeView);
    }, delay);
  }

  function stopViewTransition() {
    if (viewTransitionFrame) cancelAnimationFrame(viewTransitionFrame);
    viewTransitionFrame = 0;
  }

  function transitionView(target, redraw = true) {
    stopViewTransition();
    const start = { x: view.x, y: view.y, scale: view.scale };
    const startedAt = performance.now();
    const duration = 320;
    const animate = (timestamp) => {
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      view.x = start.x + (target.x - start.x) * eased;
      view.y = start.y + (target.y - start.y) * eased;
      view.scale = start.scale + (target.scale - start.scale) * eased;
      if (redraw) drawGraph();
      if (progress < 1) viewTransitionFrame = requestAnimationFrame(animate);
      else viewTransitionFrame = 0;
    };
    viewTransitionFrame = requestAnimationFrame(animate);
  }

  function focusMemory(memoryId, redraw = true, options = {}) {
    if (!graph || !memoryId) return false;
    const node = graph.memoryNodes.find((item) => String(item.id) === String(memoryId));
    if (!node) return false;

    const projected = projectedNode(node);
    focusedNodeId = node.id;
    const scale = clamp(Math.max(view.scale, 1.15), MIN_SCALE, MAX_SCALE);
    const target = {
      scale,
      x: graph.width / 2 - projected.x * scale,
      y: graph.height / 2 - projected.y * scale
    };
    if (options.animate) transitionView(target, redraw);
    else {
      stopViewTransition();
      Object.assign(view, target);
      if (redraw) drawGraph();
    }

    return true;
  }

  function focusSpace(options = {}) {
    if (!graph) return false;
    focusedNodeId = null;
    const scale = clamp(Number(options.scale) || 1, MIN_SCALE, MAX_SCALE);
    const target = {
      scale,
      x: graph.width / 2 - graph.centreX * scale,
      y: graph.height / 2 - graph.centreY * scale
    };
    if (options.animate) transitionView(target, true);
    else {
      stopViewTransition();
      Object.assign(view, target);
      drawGraph();
    }
    return true;
  }

  function projectPresentationNode(node) {
    if (!graph || !node) return null;
    const projected = projectedNode({
      id: String(node.id || 'presentation-node'),
      kind: node.kind || 'memory',
      x: Number(node.x || graph.centreX),
      y: Number(node.y || graph.centreY),
      radius: Number(node.radius || 16)
    });
    return {
      ...projected,
      screenX: view.x + projected.x * view.scale,
      screenY: view.y + projected.y * view.scale,
      screenRadius: projected.radius * view.scale
    };
  }

  function registerPresentationControls(definitions = []) {
    presentationControlSpecs.clear();
    activeControlParentId = null;
    for (const definition of definitions) {
      if (!definition?.id) continue;
      presentationControlSpecs.set(String(definition.id), {
        id: String(definition.id),
        label: String(definition.label || 'Control'),
        sectorAngle: Number(definition.sectorAngle) || 0,
        radius: Number(definition.radius) || 18,
        parentId: definition.parentId ? String(definition.parentId) : null,
        action: String(definition.action || ''),
        expandable: Boolean(definition.expandable)
      });
    }
    if (!graph) return true;
    buildPresentationControlNodes(graph.width, graph.height, graph.centreX, graph.centreY, graph.orbitRadius);
    syncCanonicalGraphCollections();
    for (const node of visibleControlNodes()) containNode(node);
    simulationFrames = 0;
    drawGraph();
    if (visibleControlNodes().length) startSimulation();
    return true;
  }

  function presentationControlNode(id) {
    return graph ? presentationControlNodes.get(String(id)) || null : null;
  }

  function projectPresentationControl(id) {
    const node = presentationControlNode(id);
    return node ? projectPresentationNode(node) : null;
  }

  function presentationControlState(id) {
    const node = presentationControlNode(id);
    return node ? {
      id: node.id,
      kind: node.kind,
      x: node.x,
      y: node.y,
      radius: node.radius,
      dragging: node.dragging,
      hidden: Boolean(node.hidden),
      parentId: node.parentId || null
    } : null;
  }

  function setActiveControlParent(parentId = null) {
    activeControlParentId = parentId && presentationControlNode(parentId) ? String(parentId) : null;
    for (const node of presentationControlNodes.values()) {
      if (!node.parentId) continue;
      node.hidden = !presentationControlVisible(node);
      node.dragging = false;
      if (node.hidden) {
        node.vx = 0;
        node.vy = 0;
      }
    }
    syncCanonicalGraphCollections();
    simulationFrames = 0;
    drawGraph();
    if (activeControlParentId) startSimulation();
    return true;
  }

  function collapsePresentationControls() {
    if (!graph || !activeControlParentId) return false;
    return setActiveControlParent(null);
  }

  function activatePresentationControl(node) {
    if (!node || node.hidden) return false;
    if (node.expandable) {
      const nextParentId = String(node.id) === 'settings'
        ? (activeControlParentId ? null : 'settings')
        : (activeControlParentId === node.id ? node.parentId : node.id);
      focusedNodeId = nextParentId || null;
      setActiveControlParent(nextParentId);
      return true;
    }
    if (!node.action) return false;
    surface?.dispatchEvent(new CustomEvent('memory-graph-control-action', {
      detail: { id: node.id, action: node.action, parentId: node.parentId || null }
    }));
    return true;
  }

  function focusPresentationControl(id, options = {}) {
    const node = presentationControlNode(id);
    return node ? focusPresentationNode(node, options) : false;
  }

  function beginPresentationControlDrag(id) {
    const node = presentationControlNode(id);
    if (!node || rotationActive()) return false;
    stopViewTransition();
    stopSimulation();
    node.dragging = true;
    node.vx = 0;
    node.vy = 0;
    return true;
  }

  function movePresentationControlDrag(id, clientX, clientY) {
    const node = presentationControlNode(id);
    if (!node?.dragging || !canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld({ x: clientX - rect.left, y: clientY - rect.top });
    node.x = world.x;
    node.y = world.y;
    node.vx = 0;
    node.vy = 0;
    containNode(node);
    drawGraph();
    return true;
  }

  function endPresentationControlDrag(id) {
    const node = presentationControlNode(id);
    if (!node?.dragging) return false;
    node.dragging = false;
    node.vx = 0;
    node.vy = 0;
    simulationFrames = 0;
    startSimulation();
    return true;
  }

  function presentationState() {
    if (!graph) return null;
    return {
      width: graph.width,
      height: graph.height,
      centreX: graph.centreX,
      centreY: graph.centreY,
      view: { ...view }
    };
  }

  function focusPresentationNode(node, options = {}) {
    if (!graph || !node) return false;
    const projected = projectPresentationNode(node);
    if (!projected) return false;
    const scale = clamp(Math.max(view.scale, Number(options.scale) || 1.08), MIN_SCALE, MAX_SCALE);
    const target = {
      scale,
      x: graph.width / 2 - projected.x * scale,
      y: graph.height / 2 - projected.y * scale
    };
    if (options.animate) transitionView(target, true);
    else {
      stopViewTransition();
      Object.assign(view, target);
      drawGraph();
    }
    return true;
  }

  function focusSearchTerm(value, redraw = true) {
    const query = String(value || '').trim().toLowerCase();
    if (!query) {
      focusedNodeId = null;
      if (redraw) drawGraph();
      return false;
    }

    const data = activeGraphData();
    if (!data || !graph) return false;

    const match = data.memories
      .map((memory) => ({ memory, rank: searchRank(memory, query) }))
      .filter((item) => Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank)[0]?.memory;

    if (!match) {
      focusedNodeId = null;
      if (redraw) drawGraph();
      return false;
    }

    return focusMemory(match.id, redraw);
  }

  function searchRank(memory, query) {
    const title = String(memory.title || '').toLowerCase();
    if (title === query) return 0;
    if (title.startsWith(query)) return 1;
    if (title.includes(query)) return 2;

    const searchable = [
      memory.content,
      memory.source,
      memory.type,
      memory.importance,
      memory.project,
      memory.priority
    ].some((value) => String(value || '').toLowerCase().includes(query));

    return searchable ? 3 : Number.POSITIVE_INFINITY;
  }

  function resetView() {
    stopViewTransition();
    view.x = 0;
    view.y = 0;
    view.scale = 1;
    focusedNodeId = null;
    rotationApi()?.reset?.();
    syncRotationState();
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
    syncRotationState();

    bindSearch();

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
    refresh,
    focusMemory,
    focusSpace,
    projectPresentationNode,
    focusPresentationNode,
    presentationState,
    registerPresentationControls,
    collapsePresentationControls,
    projectPresentationControl,
    presentationControlState,
    focusPresentationControl,
    beginPresentationControlDrag,
    movePresentationControlDrag,
    endPresentationControlDrag,
    focusSearchTerm,
    resetRotation() {
      rotationApi()?.reset?.();
      syncRotationState();
      drawGraph();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
