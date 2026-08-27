(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';
  const FRAME_MS = 40;
  const baseRotation = globalThis.MemoryGraphRotation || null;
  if (!baseRotation || baseRotation.__manualGravityGroupsWrapped) return;

  let workspaceRaw = '';
  let workspaceCache = null;
  let groupRaw = '';
  let groupCache = null;
  let lastGraph = null;
  let lastMatrix = null;
  let lastProjectedMemories = new Map();
  let pendingLabelMemoryId = null;
  let overlayCanvas = null;
  let overlayContext = null;
  let addButton = null;
  let frame = 0;
  let lastPaint = 0;
  let dragCandidate = null;
  let swallowedGroupPointer = null;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

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
    return { version: VERSION, spaces: {} };
  }

  function readStore() {
    const raw = localStorage.getItem(GROUP_KEY) || '';
    if (raw === groupRaw && groupCache) return groupCache;
    groupRaw = raw;
    try {
      const parsed = JSON.parse(raw || 'null');
      groupCache = parsed?.version === VERSION && parsed.spaces && typeof parsed.spaces === 'object'
        ? parsed
        : emptyStore();
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
    if (!spaceId) return false;
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
    return groupsForSpace().find((group) => Array.isArray(group.members) && group.members.some((memberId) => String(memberId) === id)) || null;
  }

  function ownsMemory(memoryId) {
    return Boolean(groupForMemory(memoryId));
  }

  function groupRadius(group) {
    const count = Array.isArray(group?.members) ? group.members.length : 0;
    return 35 + Math.min(21, Math.sqrt(count) * 7.2);
  }

  function groupWorldPosition(group, graph = lastGraph) {
    if (!group || !graph) return { x: 0, y: 0 };
    const members = Array.isArray(group.members) ? group.members.length : 0;
    const minSide = Math.max(1, Math.min(Number(graph.width || 1), Number(graph.height || 1)));
    const baseOrbit = Math.max(110, minSide * 0.34);
    const connectionPull = Math.min(baseOrbit * 0.42, members * 7.5);
    const orbit = Math.max(82, baseOrbit - connectionPull);
    const angle = Number.isFinite(Number(group.angle)) ? Number(group.angle) : 0;
    return {
      x: Number(graph.centreX || 0) + Math.cos(angle) * orbit,
      y: Number(graph.centreY || 0) + Math.sin(angle) * orbit
    };
  }

  function satellitePosition(node, group, graph) {
    const members = Array.isArray(group.members) ? group.members.map(String) : [];
    const index = Math.max(0, members.indexOf(String(node.id)));
    const count = Math.max(1, members.length);
    const centre = groupWorldPosition(group, graph);
    const parentRadius = groupRadius(group);
    const slotsPerRing = 8;
    const ring = Math.floor(index / slotsPerRing);
    const slot = index % slotsPerRing;
    const slotsOnRing = Math.min(slotsPerRing, Math.max(1, count - ring * slotsPerRing));
    const phase = Number(group.phase || 0);
    const angle = phase + (slot / slotsOnRing) * Math.PI * 2 + ring * 0.36;
    const orbit = parentRadius + 19 + ring * 21;
    return {
      x: centre.x + Math.cos(angle) * orbit,
      y: centre.y + Math.sin(angle) * orbit,
      radius: Math.max(7, Number(node.radius || 12) * 0.60)
    };
  }

  function project(node, graph) {
    if (!node || !graph) return baseRotation.project?.(node, graph) || node;
    lastGraph = graph;

    let sourceNode = node;
    let manualAlpha = 1;
    if (node.kind === 'memory') {
      pendingLabelMemoryId = String(node.id);
      const group = groupForMemory(node.id);
      if (group) {
        const satellite = satellitePosition(node, group, graph);
        sourceNode = { ...node, x: satellite.x, y: satellite.y, radius: satellite.radius };
        manualAlpha = 0.96;
      }
    } else {
      pendingLabelMemoryId = null;
    }

    const projected = baseRotation.project?.(sourceNode, graph) || {
      x: Number(sourceNode.x || 0),
      y: Number(sourceNode.y || 0),
      radius: Number(sourceNode.radius || 1),
      depth: 0,
      alpha: 1,
      scale: 1
    };

    if (node.kind === 'memory') {
      lastProjectedMemories.set(String(node.id), {
        x: projected.x,
        y: projected.y,
        radius: projected.radius,
        depth: Number(projected.depth || 0)
      });
    }

    return {
      ...projected,
      alpha: Math.min(Number(projected.alpha || 1), manualAlpha)
    };
  }

  function projectGroup(group, graph = lastGraph) {
    if (!group || !graph) return null;
    const world = groupWorldPosition(group, graph);
    const node = {
      id: `manual-group:${group.id}`,
      kind: 'group',
      x: world.x,
      y: world.y,
      radius: groupRadius(group)
    };
    return baseRotation.project?.(node, graph) || {
      x: world.x,
      y: world.y,
      radius: node.radius,
      depth: 0,
      alpha: 1,
      scale: 1
    };
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
    writeGroups(groups);
    requestGraphRefresh();
    return true;
  }

  function detachMemory(memoryId) {
    const id = String(memoryId || '');
    if (!id) return false;
    const groups = groupsForSpace().map((group) => ({
      ...group,
      members: (group.members || []).filter((memberId) => String(memberId) !== id)
    }));
    const changed = groups.some((group, index) => (group.members || []).length !== (groupsForSpace()[index]?.members || []).length);
    if (changed) writeGroups(groups);
    return changed;
  }

  function addMemoryToGroup(memoryId, groupId) {
    const id = String(memoryId || '');
    const targetId = String(groupId || '');
    if (!id || !targetId) return false;
    const memory = memoryById(id);
    if (!memory || String(memory.spaceId) !== activeSpaceId()) return false;

    const groups = groupsForSpace().map((group) => {
      const members = (group.members || []).filter((memberId) => String(memberId) !== id);
      if (String(group.id) === targetId) members.push(id);
      return { ...group, members };
    });
    if (!groups.some((group) => String(group.id) === targetId)) return false;
    writeGroups(groups);
    return true;
  }

  function requestGraphRefresh() {
    requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
  }

  function normalisedMatrix(context) {
    const canvas = context?.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    return {
      a: matrix.a / dpr,
      b: matrix.b / dpr,
      c: matrix.c / dpr,
      d: matrix.d / dpr,
      e: matrix.e / dpr,
      f: matrix.f / dpr
    };
  }

  function worldToScreen(point) {
    const m = lastMatrix;
    if (!m || !point) return null;
    return {
      x: m.a * point.x + m.c * point.y + m.e,
      y: m.b * point.x + m.d * point.y + m.f
    };
  }

  function screenToWorld(point) {
    const m = lastMatrix;
    if (!m || !point) return null;
    const det = m.a * m.d - m.b * m.c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-8) return null;
    const px = point.x - m.e;
    const py = point.y - m.f;
    return {
      x: (m.d * px - m.c * py) / det,
      y: (-m.b * px + m.a * py) / det
    };
  }

  function matrixScale() {
    if (!lastMatrix) return 1;
    return Math.max(0.1, Math.hypot(lastMatrix.a, lastMatrix.b));
  }

  function eventPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function memoryAtScreen(point) {
    const scale = matrixScale();
    const items = [...lastProjectedMemories.entries()].sort((a, b) => Number(b[1].depth || 0) - Number(a[1].depth || 0));
    for (const [id, projected] of items) {
      const screen = worldToScreen(projected);
      if (!screen) continue;
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= projected.radius * scale + 8) return id;
    }
    return null;
  }

  function groupAtScreen(point) {
    if (!lastGraph) return null;
    const scale = matrixScale();
    const groups = groupsForSpace();
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      const projected = projectGroup(group, lastGraph);
      const screen = worldToScreen(projected);
      if (!screen) continue;
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= projected.radius * scale + 12) return group;
    }
    return null;
  }

  function queryMatchesMemory(memoryId) {
    const query = document.getElementById('searchInput')?.value?.trim().toLowerCase() || '';
    if (!query) return false;
    const memory = memoryById(memoryId);
    if (!memory) return false;
    return [memory.title, memory.content, memory.source, memory.type, memory.importance, memory.project, memory.priority]
      .some((value) => String(value || '').toLowerCase().includes(query));
  }

  function installCanvasHooks() {
    const proto = globalThis.CanvasRenderingContext2D?.prototype;
    if (!proto || proto.__manualGravityGroupsInstalled) return;
    Object.defineProperty(proto, '__manualGravityGroupsInstalled', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    const previousFillText = proto.fillText;
    const previousStroke = proto.stroke;

    proto.fillText = function manualGroupFillText(text, x, y, ...rest) {
      if (this?.canvas?.classList?.contains('memory-graph-canvas')) {
        lastMatrix = normalisedMatrix(this) || lastMatrix;
        if (/(?:^|\s)11px\b/.test(String(this.font || '')) && pendingLabelMemoryId && ownsMemory(pendingLabelMemoryId) && !queryMatchesMemory(pendingLabelMemoryId)) {
          return undefined;
        }
      }
      return previousFillText.call(this, text, x, y, ...rest);
    };

    proto.stroke = function manualGroupStroke(...args) {
      if (this?.canvas?.classList?.contains('memory-graph-canvas')) {
        const width = Math.max(0.5, Number(this.lineWidth) || 1);
        const blue = String(this.strokeStyle || '').includes('120, 184, 255');
        const end = this.__memoryGraphLineEnd;
        if (blue && width <= 1.6 && end) {
          for (const group of groupsForSpace()) {
            for (const memberId of group.members || []) {
              const projected = lastProjectedMemories.get(String(memberId));
              if (!projected) continue;
              if (Math.hypot(Number(end.x) - projected.x, Number(end.y) - projected.y) <= 0.9) {
                return undefined;
              }
            }
          }
        }
      }
      return previousStroke.apply(this, args);
    };
  }

  function installPointerHooks() {
    const canvas = document.querySelector('.memory-graph-canvas');
    if (!canvas || canvas.__manualGravityPointerHooks) return false;
    canvas.__manualGravityPointerHooks = true;

    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || baseRotation.isActive?.() === true) return;
      const point = eventPoint(event, canvas);
      const group = groupAtScreen(point);
      if (group) {
        swallowedGroupPointer = event.pointerId;
        canvas.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const memoryId = memoryAtScreen(point);
      if (!memoryId) {
        dragCandidate = null;
        return;
      }
      dragCandidate = {
        pointerId: event.pointerId,
        memoryId,
        startX: point.x,
        startY: point.y,
        moved: false,
        detached: false,
        startedGrouped: ownsMemory(memoryId)
      };
    }, true);

    canvas.addEventListener('pointermove', (event) => {
      if (swallowedGroupPointer === event.pointerId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!dragCandidate || dragCandidate.pointerId !== event.pointerId) return;
      const point = eventPoint(event, canvas);
      if (!dragCandidate.moved && Math.hypot(point.x - dragCandidate.startX, point.y - dragCandidate.startY) > 6) {
        dragCandidate.moved = true;
        if (dragCandidate.startedGrouped) {
          dragCandidate.detached = detachMemory(dragCandidate.memoryId);
        }
      }
    }, true);

    canvas.addEventListener('pointerup', (event) => {
      if (swallowedGroupPointer === event.pointerId) {
        swallowedGroupPointer = null;
        try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!dragCandidate || dragCandidate.pointerId !== event.pointerId) return;
      const point = eventPoint(event, canvas);
      if (dragCandidate.moved) {
        const target = groupAtScreen(point);
        if (target) addMemoryToGroup(dragCandidate.memoryId, target.id);
      }
      dragCandidate = null;
    }, true);

    canvas.addEventListener('pointercancel', (event) => {
      if (swallowedGroupPointer === event.pointerId) swallowedGroupPointer = null;
      if (dragCandidate?.pointerId === event.pointerId) dragCandidate = null;
    }, true);

    return true;
  }

  function ensureOverlay() {
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface) return false;
    if (!overlayCanvas || !overlayCanvas.isConnected) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.className = 'memory-graph-manual-group-canvas';
      overlayCanvas.setAttribute('aria-hidden', 'true');
      surface.appendChild(overlayCanvas);
      overlayContext = overlayCanvas.getContext('2d');
    }
    if (!overlayContext) return false;

    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (overlayCanvas.width !== Math.round(width * dpr) || overlayCanvas.height !== Math.round(height * dpr)) {
      overlayCanvas.width = Math.round(width * dpr);
      overlayCanvas.height = Math.round(height * dpr);
      overlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    overlayCanvas.style.width = `${width}px`;
    overlayCanvas.style.height = `${height}px`;
    return true;
  }

  function installStyles() {
    if (document.getElementById('manualGravityGroupStyles')) return;
    const style = document.createElement('style');
    style.id = 'manualGravityGroupStyles';
    style.textContent = `
      .memory-graph-manual-group-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        width:100%;
        height:100%;
        pointer-events:none;
      }
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

  function traceLightning(ctx, from, to, seed, timestamp, widthScale = 1) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const points = [{ x: from.x, y: from.y }];
    const count = clamp(Math.round(length / 25), 4, 12);
    const bucket = Math.floor((timestamp + seed * 700) / 105);
    for (let index = 1; index < count; index += 1) {
      const t = index / count;
      const wave = Math.sin((seed * 91.7 + bucket * 17.3 + index * 13.1)) * Math.sin(Math.PI * t);
      const amp = clamp(length * 0.034, 2.3, 8.5) * wave;
      points.push({ x: from.x + dx * t + px * amp, y: from.y + dy * t + py * amp });
    }
    points.push({ x: to.x, y: to.y });

    const stroke = (lineWidth, colour) => {
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
      ctx.lineWidth = lineWidth * widthScale;
      ctx.strokeStyle = colour;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    stroke(4.0, 'rgba(55, 139, 255, 0.10)');
    stroke(1.9, 'rgba(120, 184, 255, 0.40)');
    stroke(0.75, 'rgba(241, 251, 255, 0.88)');
  }

  function drawGroupBubble(ctx, group, screen, radius, timestamp) {
    const pulse = 0.5 + Math.sin(timestamp * 0.002 + Number(group.phase || 0)) * 0.5;
    ctx.save();
    const glow = ctx.createRadialGradient(screen.x, screen.y, radius * 0.3, screen.x, screen.y, radius * 1.65);
    glow.addColorStop(0, `rgba(120, 184, 255, ${(0.12 + pulse * 0.035).toFixed(3)})`);
    glow.addColorStop(0.42, 'rgba(199, 255, 86, 0.10)');
    glow.addColorStop(1, 'rgba(199, 255, 86, 0)');
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * 1.65, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    const sphere = ctx.createRadialGradient(
      screen.x - radius * 0.28,
      screen.y - radius * 0.34,
      Math.max(1, radius * 0.05),
      screen.x,
      screen.y,
      radius * 1.08
    );
    sphere.addColorStop(0, 'rgba(111, 174, 128, 0.58)');
    sphere.addColorStop(0.24, 'rgba(43, 91, 53, 0.92)');
    sphere.addColorStop(0.60, 'rgba(12, 34, 23, 0.98)');
    sphere.addColorStop(1, 'rgba(3, 13, 10, 1)');
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = sphere;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * 0.98, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, radius * 0.08);
    ctx.strokeStyle = 'rgba(199, 255, 86, 0.82)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * 0.72, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, radius * 0.026);
    ctx.strokeStyle = 'rgba(120, 184, 255, 0.30)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(242, 244, 247, 0.96)';
    ctx.font = `800 ${clamp(radius * 0.28, 11, 15)}px Inter, system-ui, sans-serif`;
    const title = String(group.title || 'Group');
    const shown = title.length > 15 ? `${title.slice(0, 14).trim()}…` : title;
    ctx.fillText(shown, screen.x, screen.y - 3);

    ctx.fillStyle = 'rgba(199, 255, 86, 0.84)';
    ctx.font = '750 10px Inter, system-ui, sans-serif';
    const count = Array.isArray(group.members) ? group.members.length : 0;
    ctx.fillText(`${count} ${count === 1 ? 'memory' : 'memories'}`, screen.x, screen.y + Math.min(17, radius * 0.36));
    ctx.restore();
  }

  function drawFrame(timestamp) {
    frame = requestAnimationFrame(drawFrame);
    if (timestamp - lastPaint < FRAME_MS) return;
    lastPaint = timestamp;
    if (!ensureOverlay() || !lastGraph || !lastMatrix || document.hidden) return;

    const rect = overlayCanvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    overlayContext.clearRect(0, 0, rect.width, rect.height);

    const scale = matrixScale();
    const centreWorld = { x: Number(lastGraph.centreX || 0), y: Number(lastGraph.centreY || 0) };
    const centreScreen = worldToScreen(centreWorld);
    if (!centreScreen) return;

    for (const group of groupsForSpace()) {
      const projectedGroup = projectGroup(group, lastGraph);
      const groupScreen = worldToScreen(projectedGroup);
      if (!groupScreen) continue;
      const groupScreenRadius = projectedGroup.radius * scale;
      const seed = Math.abs(Math.sin(String(group.id).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) * 0.17));

      traceLightning(overlayContext, centreScreen, groupScreen, seed, timestamp, 1.05);

      for (let index = 0; index < (group.members || []).length; index += 1) {
        const memberId = String(group.members[index]);
        const projectedMemory = lastProjectedMemories.get(memberId);
        const memoryScreen = worldToScreen(projectedMemory);
        if (!memoryScreen) continue;
        traceLightning(overlayContext, groupScreen, memoryScreen, seed + index * 0.193, timestamp, 0.72);
      }

      drawGroupBubble(overlayContext, group, groupScreen, groupScreenRadius, timestamp);
    }
  }

  const wrappedRotation = Object.freeze({
    ...baseRotation,
    __manualGravityGroupsWrapped: true,
    version: `${baseRotation.version || 1}+manualgroups${VERSION}`,
    isActive() {
      return baseRotation.isActive?.() === true;
    },
    project,
    snapshot() {
      return {
        ...(baseRotation.snapshot?.() || {}),
        manualGroupsVersion: VERSION,
        manualGroupCount: groupsForSpace().length
      };
    }
  });

  globalThis.MemoryGraphRotation = wrappedRotation;
  globalThis.MemoryGraphManualGroups = Object.freeze({
    version: VERSION,
    storageKey: GROUP_KEY,
    ownsMemory,
    createGroup,
    detachMemory,
    addMemoryToGroup,
    groups: () => groupsForSpace().map((group) => ({ ...group, members: [...(group.members || [])] }))
  });

  function mountUi() {
    installStyles();
    ensureOverlay();
    ensureAddButton();
    installPointerHooks();
    if (!frame) frame = requestAnimationFrame(drawFrame);
  }

  installCanvasHooks();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mountUi), { once: true });
  } else {
    requestAnimationFrame(mountUi);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === WORKSPACE_KEY) {
      workspaceRaw = '';
      workspaceCache = null;
      lastProjectedMemories = new Map();
    }
    if (event.key === GROUP_KEY) {
      groupRaw = '';
      groupCache = null;
    }
  });
})();