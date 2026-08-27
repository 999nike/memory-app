(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';
  const PHYSICS_INTERVAL_MS = 14;
  const PERSIST_DELAY_MS = 420;

  const baseRotation = globalThis.MemoryGraphRotation || null;
  if (!baseRotation || baseRotation.__manualGravityPhysicsWrapped) return;

  let lastGraph = null;
  let lastMatrix = null;
  let pendingLabelMemoryId = null;
  let lastPhysicsAt = 0;
  let persistTimer = 0;
  let overlayCanvas = null;
  let overlayContext = null;
  let overlayFrame = 0;
  let drag = null;
  let memoryDrag = null;
  let canvas = null;
  let surface = null;

  const bodies = new Map();
  const projectedMemories = new Map();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function readJson(key, fallback = null) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && typeof value === 'object' ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function workspace() {
    const value = readJson(WORKSPACE_KEY, null);
    return value && Array.isArray(value.spaces) && Array.isArray(value.memories) ? value : null;
  }

  function activeSpaceId() {
    const value = workspace();
    return String(value?.activeSpaceId || value?.spaces?.[0]?.id || '');
  }

  function groupStore() {
    const value = readJson(GROUP_KEY, { version: 1, spaces: {} });
    if (!value.spaces || typeof value.spaces !== 'object') value.spaces = {};
    return value;
  }

  function groupsForSpace(spaceId = activeSpaceId()) {
    if (!spaceId) return [];
    const groups = groupStore().spaces?.[spaceId];
    return Array.isArray(groups) ? groups : [];
  }

  function writeGroups(groups, spaceId = activeSpaceId()) {
    if (!spaceId) return false;
    const store = groupStore();
    store.spaces[spaceId] = groups;
    try {
      localStorage.setItem(GROUP_KEY, JSON.stringify(store));
      return true;
    } catch {
      return false;
    }
  }

  function groupForMemory(memoryId) {
    const id = String(memoryId || '');
    return groupsForSpace().find((group) => (group.members || []).some((memberId) => String(memberId) === id)) || null;
  }

  function groupRadius(group) {
    const count = Array.isArray(group?.members) ? group.members.length : 0;
    return 35 + Math.min(21, Math.sqrt(count) * 7.2);
  }

  function naturalOrbit(group, graph) {
    const count = Array.isArray(group?.members) ? group.members.length : 0;
    const minSide = Math.max(1, Math.min(Number(graph?.width || 1), Number(graph?.height || 1)));
    const baseOrbit = Math.max(110, minSide * 0.34);
    const connectionPull = Math.min(baseOrbit * 0.42, count * 7.5);
    return Math.max(82, baseOrbit - connectionPull);
  }

  function bodyFromGroup(group, graph) {
    const id = String(group.id);
    let body = bodies.get(id);
    const width = Math.max(1, Number(graph.width || 1));
    const height = Math.max(1, Number(graph.height || 1));

    if (!body) {
      const savedX = Number(group.physicsOffsetX);
      const savedY = Number(group.physicsOffsetY);
      const hasSaved = Number.isFinite(savedX) && Number.isFinite(savedY);
      const angle = Number.isFinite(Number(group.angle)) ? Number(group.angle) : 0;
      const orbit = naturalOrbit(group, graph);
      body = {
        id,
        x: hasSaved ? Number(graph.centreX) + savedX * width : Number(graph.centreX) + Math.cos(angle) * orbit,
        y: hasSaved ? Number(graph.centreY) + savedY * height : Number(graph.centreY) + Math.sin(angle) * orbit,
        vx: 0,
        vy: 0,
        dragging: false
      };
      bodies.set(id, body);
    }

    body.radius = groupRadius(group);
    body.memberCount = Array.isArray(group.members) ? group.members.length : 0;
    body.gravityWeight = 1.08 + Math.min(1.30, body.memberCount * 0.095);
    body.targetOrbit = naturalOrbit(group, graph);
    return body;
  }

  function syncBodies(graph) {
    const groups = groupsForSpace();
    const liveIds = new Set(groups.map((group) => String(group.id)));
    for (const id of [...bodies.keys()]) {
      if (!liveIds.has(id)) bodies.delete(id);
    }
    return groups.map((group) => ({ group, body: bodyFromGroup(group, graph) }));
  }

  function containBody(body, graph) {
    const margin = Number(body.radius || 35) + 34;
    const minX = margin;
    const maxX = Math.max(margin, Number(graph.width || 1) - margin);
    const minY = margin;
    const maxY = Math.max(margin, Number(graph.height || 1) - margin);

    if (body.x < minX) {
      body.x = minX;
      body.vx *= -0.35;
    } else if (body.x > maxX) {
      body.x = maxX;
      body.vx *= -0.35;
    }
    if (body.y < minY) {
      body.y = minY;
      body.vy *= -0.35;
    } else if (body.y > maxY) {
      body.y = maxY;
      body.vy *= -0.35;
    }
  }

  function groupedMemoryIds() {
    const ids = new Set();
    for (const group of groupsForSpace()) {
      for (const id of group.members || []) ids.add(String(id));
    }
    return ids;
  }

  function stepPhysics(graph) {
    const now = performance.now();
    if (now - lastPhysicsAt < PHYSICS_INTERVAL_MS) return;
    lastPhysicsAt = now;

    const entries = syncBodies(graph);
    if (!entries.length) return;
    const grouped = groupedMemoryIds();
    const memories = (graph.memoryNodes || []).filter((node) => !grouped.has(String(node.id)));

    for (let i = 0; i < entries.length; i += 1) {
      const { body } = entries[i];
      if (body.dragging) continue;

      let fx = 0;
      let fy = 0;
      const dx = body.x - Number(graph.centreX || 0);
      const dy = body.y - Number(graph.centreY || 0);
      const distance = Math.max(1, Math.hypot(dx, dy));
      const radialOffset = distance - body.targetOrbit;
      const radialForce = -radialOffset * 0.0019 * Math.max(0.8, body.gravityWeight || 1);
      fx += (dx / distance) * radialForce;
      fy += (dy / distance) * radialForce;

      for (const node of memories) {
        const pairX = body.x - Number(node.x || 0);
        const pairY = body.y - Number(node.y || 0);
        const pairDistanceSq = Math.max(100, pairX * pairX + pairY * pairY);
        const pairDistance = Math.sqrt(pairDistanceSq);
        const minGap = Number(body.radius || 35) + Number(node.radius || 15) + 24;
        let repulsion = Math.min(1.25, 1200 / pairDistanceSq);
        if (pairDistance < minGap) repulsion += (minGap - pairDistance) * 0.018;
        const pushX = (pairX / pairDistance) * repulsion;
        const pushY = (pairY / pairDistance) * repulsion;
        fx += pushX / Math.max(0.90, body.gravityWeight || 1);
        fy += pushY / Math.max(0.90, body.gravityWeight || 1);
        if (!node.dragging) {
          node.vx = Number(node.vx || 0) - pushX / Math.max(0.85, Number(node.gravityWeight || 1));
          node.vy = Number(node.vy || 0) - pushY / Math.max(0.85, Number(node.gravityWeight || 1));
        }
      }

      for (let j = i + 1; j < entries.length; j += 1) {
        const other = entries[j].body;
        const pairX = body.x - other.x;
        const pairY = body.y - other.y;
        const pairDistanceSq = Math.max(100, pairX * pairX + pairY * pairY);
        const pairDistance = Math.sqrt(pairDistanceSq);
        const minGap = Number(body.radius || 35) + Number(other.radius || 35) + 30;
        let repulsion = Math.min(1.45, 1450 / pairDistanceSq);
        if (pairDistance < minGap) repulsion += (minGap - pairDistance) * 0.020;
        const pushX = (pairX / pairDistance) * repulsion;
        const pushY = (pairY / pairDistance) * repulsion;
        fx += pushX / Math.max(0.90, body.gravityWeight || 1);
        fy += pushY / Math.max(0.90, body.gravityWeight || 1);
        if (!other.dragging) {
          other.vx -= pushX / Math.max(0.90, other.gravityWeight || 1);
          other.vy -= pushY / Math.max(0.90, other.gravityWeight || 1);
        }
      }

      body.vx = (Number(body.vx || 0) + fx) * 0.90;
      body.vy = (Number(body.vy || 0) + fy) * 0.90;
      body.x += body.vx;
      body.y += body.vy;
      containBody(body, graph);
    }

    schedulePersist();
  }

  function persistBodies() {
    if (!lastGraph) return;
    const width = Math.max(1, Number(lastGraph.width || 1));
    const height = Math.max(1, Number(lastGraph.height || 1));
    const centreX = Number(lastGraph.centreX || 0);
    const centreY = Number(lastGraph.centreY || 0);
    const groups = groupsForSpace().map((group) => {
      const body = bodies.get(String(group.id));
      if (!body) return group;
      return {
        ...group,
        angle: Math.atan2(body.y - centreY, body.x - centreX),
        physicsOffsetX: (body.x - centreX) / width,
        physicsOffsetY: (body.y - centreY) / height
      };
    });
    writeGroups(groups);
  }

  function schedulePersist() {
    if (persistTimer) return;
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persistBodies();
    }, PERSIST_DELAY_MS);
  }

  function satelliteWorld(node, group, body) {
    const members = (group.members || []).map(String);
    const index = Math.max(0, members.indexOf(String(node.id)));
    const count = Math.max(1, members.length);
    const slotsPerRing = 8;
    const ring = Math.floor(index / slotsPerRing);
    const slot = index % slotsPerRing;
    const slotsOnRing = Math.min(slotsPerRing, Math.max(1, count - ring * slotsPerRing));
    const phase = Number(group.phase || 0);
    const angle = phase + (slot / slotsOnRing) * Math.PI * 2 + ring * 0.36;
    const orbit = Number(body.radius || 35) + 19 + ring * 21;
    return {
      x: body.x + Math.cos(angle) * orbit,
      y: body.y + Math.sin(angle) * orbit,
      radius: Math.max(7, Number(node.radius || 12) * 0.60)
    };
  }

  function project(node, graph) {
    if (!node || !graph) return baseRotation.project?.(node, graph) || node;
    lastGraph = graph;
    stepPhysics(graph);

    if (node.kind !== 'memory') {
      pendingLabelMemoryId = null;
      return baseRotation.project?.(node, graph) || node;
    }

    pendingLabelMemoryId = String(node.id);
    const group = groupForMemory(node.id);
    if (!group) {
      const projected = baseRotation.project?.(node, graph) || node;
      projectedMemories.set(String(node.id), projected);
      return projected;
    }

    const body = bodyFromGroup(group, graph);
    const satellite = satelliteWorld(node, group, body);
    const proxy = {
      ...node,
      kind: 'manual-satellite',
      x: satellite.x,
      y: satellite.y,
      radius: satellite.radius
    };
    const projected = baseRotation.project?.(proxy, graph) || proxy;
    projectedMemories.set(String(node.id), projected);
    return { ...projected, alpha: Math.min(Number(projected.alpha || 1), 0.96) };
  }

  function projectBody(group, graph = lastGraph) {
    if (!group || !graph) return null;
    const body = bodyFromGroup(group, graph);
    const proxy = {
      id: `manual-gravity:${group.id}`,
      kind: 'group',
      x: body.x,
      y: body.y,
      radius: body.radius
    };
    return baseRotation.project?.(proxy, graph) || proxy;
  }

  function normalisedMatrix(context) {
    const target = context?.canvas;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const dpr = Math.max(1, target.width / Math.max(1, rect.width));
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
    if (!lastMatrix || !point) return null;
    return {
      x: lastMatrix.a * point.x + lastMatrix.c * point.y + lastMatrix.e,
      y: lastMatrix.b * point.x + lastMatrix.d * point.y + lastMatrix.f
    };
  }

  function screenToWorld(point) {
    if (!lastMatrix || !point) return null;
    const det = lastMatrix.a * lastMatrix.d - lastMatrix.b * lastMatrix.c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-8) return null;
    const px = point.x - lastMatrix.e;
    const py = point.y - lastMatrix.f;
    return {
      x: (lastMatrix.d * px - lastMatrix.c * py) / det,
      y: (-lastMatrix.b * px + lastMatrix.a * py) / det
    };
  }

  function matrixScale() {
    return lastMatrix ? Math.max(0.1, Math.hypot(lastMatrix.a, lastMatrix.b)) : 1;
  }

  function queryMatchesMemory(memoryId) {
    const query = document.getElementById('searchInput')?.value?.trim().toLowerCase() || '';
    if (!query) return false;
    const value = workspace();
    const memory = value?.memories?.find((item) => String(item.id) === String(memoryId));
    if (!memory) return false;
    return [memory.title, memory.content, memory.source, memory.type, memory.importance, memory.project, memory.priority]
      .some((item) => String(item || '').toLowerCase().includes(query));
  }

  function installCanvasHooks() {
    const proto = globalThis.CanvasRenderingContext2D?.prototype;
    if (!proto || proto.__manualGravityPhysicsCanvasHooks) return;
    Object.defineProperty(proto, '__manualGravityPhysicsCanvasHooks', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    const previousFillText = proto.fillText;
    const previousStroke = proto.stroke;

    proto.fillText = function manualGravityPhysicsFillText(text, x, y, ...rest) {
      if (this?.canvas?.classList?.contains('memory-graph-canvas')) {
        lastMatrix = normalisedMatrix(this) || lastMatrix;
        if (/(?:^|\s)11px\b/.test(String(this.font || '')) && pendingLabelMemoryId && groupForMemory(pendingLabelMemoryId) && !queryMatchesMemory(pendingLabelMemoryId)) {
          return undefined;
        }
      }
      return previousFillText.call(this, text, x, y, ...rest);
    };

    proto.stroke = function manualGravityPhysicsStroke(...args) {
      if (this?.canvas?.classList?.contains('memory-graph-canvas')) {
        const width = Math.max(0.5, Number(this.lineWidth) || 1);
        const blue = String(this.strokeStyle || '').includes('120, 184, 255');
        const end = this.__memoryGraphLineEnd;
        if (blue && width <= 1.6 && end) {
          for (const group of groupsForSpace()) {
            for (const memberId of group.members || []) {
              const projected = projectedMemories.get(String(memberId));
              if (!projected) continue;
              if (Math.hypot(Number(end.x) - Number(projected.x), Number(end.y) - Number(projected.y)) <= 1.2) return undefined;
            }
          }
        }
      }
      return previousStroke.apply(this, args);
    };
  }

  function eventPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function groupAtScreen(point) {
    if (!lastGraph || !lastMatrix) return null;
    const scale = matrixScale();
    const groups = groupsForSpace();
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      const projected = projectBody(group, lastGraph);
      const screen = worldToScreen(projected);
      if (!screen) continue;
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= Number(projected.radius || 35) * scale + 12) return group;
    }
    return null;
  }

  function memoryAtScreen(point) {
    const scale = matrixScale();
    const items = [...projectedMemories.entries()].reverse();
    for (const [id, projected] of items) {
      const screen = worldToScreen(projected);
      if (!screen) continue;
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= Number(projected.radius || 12) * scale + 8) return id;
    }
    return null;
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
    if (changed) writeGroups(groups);
    return changed;
  }

  function addMemoryToGroup(memoryId, groupId) {
    const id = String(memoryId || '');
    const targetId = String(groupId || '');
    if (!id || !targetId) return false;
    let found = false;
    const groups = groupsForSpace().map((group) => {
      const members = (group.members || []).filter((memberId) => String(memberId) !== id);
      if (String(group.id) === targetId) {
        members.push(id);
        found = true;
      }
      return { ...group, members };
    });
    if (!found) return false;
    return writeGroups(groups);
  }

  function rotationActive() {
    return baseRotation.isActive?.() === true;
  }

  function stopGroupEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function scheduleGraphRefresh(force = false) {
    if (force) {
      globalThis.MemoryGraph?.refresh?.();
      return;
    }
    requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
  }

  function installPointerHooks() {
    if (!surface || !canvas || surface.__manualGravityPhysicsPointerHooks) return;
    surface.__manualGravityPhysicsPointerHooks = true;

    surface.addEventListener('pointerdown', (event) => {
      if (event.target !== canvas || event.button !== 0 || rotationActive()) return;
      const point = eventPoint(event);
      const group = groupAtScreen(point);
      if (group) {
        const body = bodyFromGroup(group, lastGraph);
        drag = {
          pointerId: event.pointerId,
          groupId: String(group.id),
          moved: false,
          startX: point.x,
          startY: point.y
        };
        body.dragging = true;
        body.vx = 0;
        body.vy = 0;
        canvas.dataset.draggingGroup = 'true';
        canvas.setPointerCapture?.(event.pointerId);
        stopGroupEvent(event);
        return;
      }

      const memoryId = memoryAtScreen(point);
      if (memoryId) {
        memoryDrag = {
          pointerId: event.pointerId,
          memoryId,
          startX: point.x,
          startY: point.y,
          moved: false,
          startedGrouped: Boolean(groupForMemory(memoryId))
        };
      }
    }, true);

    surface.addEventListener('pointermove', (event) => {
      if (event.target !== canvas) return;
      const point = eventPoint(event);

      if (drag?.pointerId === event.pointerId) {
        if (!drag.moved && Math.hypot(point.x - drag.startX, point.y - drag.startY) > 3) drag.moved = true;
        const group = groupsForSpace().find((item) => String(item.id) === drag.groupId);
        const body = group ? bodyFromGroup(group, lastGraph) : null;
        const world = screenToWorld(point);
        if (body && world) {
          body.x = world.x;
          body.y = world.y;
          body.vx = 0;
          body.vy = 0;
          containBody(body, lastGraph);
          schedulePersist();
          scheduleGraphRefresh(false);
        }
        stopGroupEvent(event);
        return;
      }

      if (memoryDrag?.pointerId === event.pointerId) {
        if (!memoryDrag.moved && Math.hypot(point.x - memoryDrag.startX, point.y - memoryDrag.startY) > 6) {
          memoryDrag.moved = true;
          if (memoryDrag.startedGrouped) detachMemory(memoryDrag.memoryId);
        }
      }

      if (!rotationActive()) canvas.dataset.hoverGroup = groupAtScreen(point) ? 'true' : 'false';
      else canvas.removeAttribute('data-hover-group');
    }, true);

    surface.addEventListener('pointerup', (event) => {
      const point = eventPoint(event);
      if (drag?.pointerId === event.pointerId) {
        const group = groupsForSpace().find((item) => String(item.id) === drag.groupId);
        const body = group ? bodyFromGroup(group, lastGraph) : null;
        if (body) body.dragging = false;
        drag = null;
        canvas.removeAttribute('data-dragging-group');
        canvas.removeAttribute('data-hover-group');
        persistBodies();
        scheduleGraphRefresh(true);
        try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
        stopGroupEvent(event);
        return;
      }

      if (memoryDrag?.pointerId === event.pointerId) {
        const active = memoryDrag;
        memoryDrag = null;
        if (active.moved) {
          const target = groupAtScreen(point);
          if (target) {
            window.setTimeout(() => {
              addMemoryToGroup(active.memoryId, target.id);
              scheduleGraphRefresh(true);
            }, 0);
          }
        }
      }
    }, true);

    surface.addEventListener('pointercancel', (event) => {
      if (drag?.pointerId === event.pointerId) {
        const group = groupsForSpace().find((item) => String(item.id) === drag.groupId);
        const body = group ? bodyFromGroup(group, lastGraph) : null;
        if (body) body.dragging = false;
        drag = null;
        canvas.removeAttribute('data-dragging-group');
      }
      if (memoryDrag?.pointerId === event.pointerId) memoryDrag = null;
    }, true);
  }

  function ensureOverlay() {
    if (!surface) return false;
    const old = surface.querySelector('.memory-graph-manual-group-canvas');
    if (old) old.style.opacity = '0';

    if (!overlayCanvas || !overlayCanvas.isConnected) {
      overlayCanvas = document.createElement('canvas');
      overlayCanvas.className = 'memory-graph-manual-gravity-canvas';
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
      const wave = Math.sin(seed * 91.7 + bucket * 17.3 + index * 13.1) * Math.sin(Math.PI * t);
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
    const glow = ctx.createRadialGradient(screen.x, screen.y, radius * 0.25, screen.x, screen.y, radius * 1.65);
    glow.addColorStop(0, `rgba(120, 184, 255, ${(0.12 + pulse * 0.035).toFixed(3)})`);
    glow.addColorStop(0.42, 'rgba(199, 255, 86, 0.10)');
    glow.addColorStop(1, 'rgba(199, 255, 86, 0)');
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * 1.65, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    const sphere = ctx.createRadialGradient(screen.x - radius * 0.28, screen.y - radius * 0.34, 1, screen.x, screen.y, radius * 1.08);
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
    ctx.strokeStyle = 'rgba(199, 255, 86, 0.86)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius * 0.72, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, radius * 0.026);
    ctx.strokeStyle = 'rgba(120, 184, 255, 0.32)';
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(242, 244, 247, 0.96)';
    ctx.font = `800 ${clamp(radius * 0.28, 11, 15)}px Inter, system-ui, sans-serif`;
    const title = String(group.title || 'Group');
    ctx.fillText(title.length > 15 ? `${title.slice(0, 14).trim()}…` : title, screen.x, screen.y - 3);
    ctx.fillStyle = 'rgba(199, 255, 86, 0.84)';
    ctx.font = '750 10px Inter, system-ui, sans-serif';
    const count = Array.isArray(group.members) ? group.members.length : 0;
    ctx.fillText(`${count} ${count === 1 ? 'memory' : 'memories'}`, screen.x, screen.y + Math.min(17, radius * 0.36));
    ctx.restore();
  }

  function drawOverlay(timestamp) {
    overlayFrame = requestAnimationFrame(drawOverlay);
    if (!ensureOverlay() || !lastGraph || !lastMatrix || document.hidden) return;
    const rect = overlayCanvas.getBoundingClientRect();
    overlayContext.clearRect(0, 0, rect.width, rect.height);
    const centreScreen = worldToScreen({ x: Number(lastGraph.centreX || 0), y: Number(lastGraph.centreY || 0) });
    if (!centreScreen) return;
    const scale = matrixScale();

    for (const group of groupsForSpace()) {
      const projectedGroup = projectBody(group, lastGraph);
      const groupScreen = worldToScreen(projectedGroup);
      if (!groupScreen) continue;
      const radius = Number(projectedGroup.radius || groupRadius(group)) * scale;
      const seed = Math.abs(Math.sin(String(group.id).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) * 0.17));
      traceLightning(overlayContext, centreScreen, groupScreen, seed, timestamp, 1.05);
      for (let index = 0; index < (group.members || []).length; index += 1) {
        const projectedMemory = projectedMemories.get(String(group.members[index]));
        const memoryScreen = worldToScreen(projectedMemory);
        if (memoryScreen) traceLightning(overlayContext, groupScreen, memoryScreen, seed + index * 0.193, timestamp, 0.72);
      }
      drawGroupBubble(overlayContext, group, groupScreen, radius, timestamp);
    }
  }

  function installStyles() {
    if (document.getElementById('manualGravityPhysicsStyles')) return;
    const style = document.createElement('style');
    style.id = 'manualGravityPhysicsStyles';
    style.textContent = `
      .memory-graph-manual-gravity-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        width:100%;
        height:100%;
        pointer-events:none;
      }
      .memory-graph-canvas[data-hover-group="true"] { cursor:move !important; }
      .memory-graph-canvas[data-dragging-group="true"] { cursor:grabbing !important; }
    `;
    document.head.appendChild(style);
  }

  const wrappedRotation = Object.freeze({
    ...baseRotation,
    __manualGravityPhysicsWrapped: true,
    version: `${baseRotation.version || 1}+gravity${VERSION}`,
    project,
    snapshot() {
      return {
        ...(baseRotation.snapshot?.() || {}),
        manualGravityPhysicsVersion: VERSION,
        manualGravityBodies: bodies.size
      };
    }
  });
  globalThis.MemoryGraphRotation = wrappedRotation;

  function mount() {
    surface = document.getElementById('memoryGraphSurface');
    canvas = document.querySelector('.memory-graph-canvas');
    if (!surface || !canvas) return false;
    installStyles();
    installPointerHooks();
    ensureOverlay();
    if (!overlayFrame) overlayFrame = requestAnimationFrame(drawOverlay);
    return true;
  }

  installCanvasHooks();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }

  window.addEventListener('storage', (event) => {
    if (event.key === GROUP_KEY || event.key === WORKSPACE_KEY) {
      projectedMemories.clear();
      if (event.key === GROUP_KEY) bodies.clear();
    }
  });

  globalThis.MemoryGraphManualGravity = Object.freeze({
    version: VERSION,
    bodyCount: () => bodies.size,
    persist: persistBodies
  });
})();