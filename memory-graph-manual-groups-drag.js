(() => {
  'use strict';

  const VERSION = 1;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';
  const REDRAW_MS = 40;

  let surface = null;
  let canvas = null;
  let lastMatrix = null;
  let drag = null;
  let redrawTimer = 0;
  let lastRedraw = 0;

  function readJson(key, fallback = null) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function activeSpaceId() {
    const workspace = readJson(WORKSPACE_KEY);
    return String(workspace?.activeSpaceId || workspace?.spaces?.[0]?.id || '');
  }

  function groupsForSpace() {
    const store = readJson(GROUP_KEY, { version: 1, spaces: {} });
    const groups = store?.spaces?.[activeSpaceId()];
    return Array.isArray(groups) ? groups : [];
  }

  function updateGroupAngle(groupId, angle) {
    const spaceId = activeSpaceId();
    if (!spaceId || !Number.isFinite(angle)) return false;

    const store = readJson(GROUP_KEY, { version: 1, spaces: {} }) || { version: 1, spaces: {} };
    if (!store.spaces || typeof store.spaces !== 'object') store.spaces = {};
    const groups = Array.isArray(store.spaces[spaceId]) ? store.spaces[spaceId] : [];
    let changed = false;

    store.spaces[spaceId] = groups.map((group) => {
      if (String(group?.id) !== String(groupId)) return group;
      changed = true;
      return { ...group, angle };
    });

    if (!changed) return false;
    try {
      localStorage.setItem(GROUP_KEY, JSON.stringify(store));
      return true;
    } catch {
      return false;
    }
  }

  function groupRadius(group) {
    const count = Array.isArray(group?.members) ? group.members.length : 0;
    return 35 + Math.min(21, Math.sqrt(count) * 7.2);
  }

  function graphGeometry() {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    return {
      width,
      height,
      centreX: width / 2,
      centreY: height / 2
    };
  }

  function groupWorldPosition(group) {
    const graph = graphGeometry();
    if (!group || !graph) return null;
    const members = Array.isArray(group.members) ? group.members.length : 0;
    const minSide = Math.max(1, Math.min(graph.width, graph.height));
    const baseOrbit = Math.max(110, minSide * 0.34);
    const connectionPull = Math.min(baseOrbit * 0.42, members * 7.5);
    const orbit = Math.max(82, baseOrbit - connectionPull);
    const angle = Number.isFinite(Number(group.angle)) ? Number(group.angle) : 0;
    return {
      x: graph.centreX + Math.cos(angle) * orbit,
      y: graph.centreY + Math.sin(angle) * orbit
    };
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

  function eventPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function groupAtScreen(point) {
    if (!point || !lastMatrix) return null;
    const scale = matrixScale();
    const groups = groupsForSpace();

    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      const world = groupWorldPosition(group);
      const screen = worldToScreen(world);
      if (!screen) continue;
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= groupRadius(group) * scale + 12) {
        return group;
      }
    }
    return null;
  }

  function installMatrixHook() {
    const proto = globalThis.CanvasRenderingContext2D?.prototype;
    if (!proto || proto.__manualGravityGroupDragMatrixInstalled) return;

    Object.defineProperty(proto, '__manualGravityGroupDragMatrixInstalled', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });

    const previousFillText = proto.fillText;
    proto.fillText = function manualGravityGroupDragFillText(...args) {
      if (this?.canvas?.classList?.contains('memory-graph-canvas')) {
        lastMatrix = normalisedMatrix(this) || lastMatrix;
      }
      return previousFillText.apply(this, args);
    };
  }

  function redrawNow() {
    lastRedraw = performance.now();
    globalThis.MemoryGraph?.refresh?.();
  }

  function scheduleRedraw(force = false) {
    const now = performance.now();
    const wait = REDRAW_MS - (now - lastRedraw);
    if (force || wait <= 0) {
      if (redrawTimer) {
        clearTimeout(redrawTimer);
        redrawTimer = 0;
      }
      redrawNow();
      return;
    }
    if (redrawTimer) return;
    redrawTimer = window.setTimeout(() => {
      redrawTimer = 0;
      redrawNow();
    }, Math.max(0, wait));
  }

  function rotationActive() {
    return globalThis.MemoryGraphRotation?.isActive?.() === true;
  }

  function stopForGroupDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function installStyles() {
    if (document.getElementById('manualGravityGroupDragStyles')) return;
    const style = document.createElement('style');
    style.id = 'manualGravityGroupDragStyles';
    style.textContent = `
      .memory-graph-canvas[data-hover-group="true"] {
        cursor: move !important;
      }
      .memory-graph-canvas[data-dragging-group="true"] {
        cursor: grabbing !important;
      }
    `;
    document.head.appendChild(style);
  }

  function handlePointerDown(event) {
    if (!canvas || event.target !== canvas || event.button !== 0 || rotationActive()) return;
    const point = eventPoint(event);
    const group = groupAtScreen(point);
    if (!group) return;

    const world = screenToWorld(point);
    const graph = graphGeometry();
    if (!world || !graph) return;

    drag = {
      pointerId: event.pointerId,
      groupId: String(group.id),
      startX: point.x,
      startY: point.y,
      moved: false,
      angle: Number(group.angle) || 0
    };

    canvas.dataset.draggingGroup = 'true';
    canvas.setPointerCapture?.(event.pointerId);
    stopForGroupDrag(event);
  }

  function handlePointerMove(event) {
    if (!canvas || event.target !== canvas) return;
    const point = eventPoint(event);

    if (!drag || drag.pointerId !== event.pointerId) {
      if (!rotationActive()) {
        canvas.dataset.hoverGroup = groupAtScreen(point) ? 'true' : 'false';
      } else {
        canvas.removeAttribute('data-hover-group');
      }
      return;
    }

    if (!drag.moved && Math.hypot(point.x - drag.startX, point.y - drag.startY) > 4) {
      drag.moved = true;
    }

    if (drag.moved) {
      const world = screenToWorld(point);
      const graph = graphGeometry();
      if (world && graph) {
        const angle = Math.atan2(world.y - graph.centreY, world.x - graph.centreX);
        drag.angle = angle;
        if (updateGroupAngle(drag.groupId, angle)) scheduleRedraw(false);
      }
    }

    stopForGroupDrag(event);
  }

  function finishDrag(event, cancelled = false) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const active = drag;
    drag = null;

    if (!cancelled && active.moved) {
      updateGroupAngle(active.groupId, active.angle);
      scheduleRedraw(true);
    }

    canvas?.removeAttribute('data-dragging-group');
    canvas?.removeAttribute('data-hover-group');
    try {
      canvas?.releasePointerCapture?.(event.pointerId);
    } catch {}
    stopForGroupDrag(event);
  }

  function mount() {
    surface = document.getElementById('memoryGraphSurface');
    canvas = document.querySelector('.memory-graph-canvas');
    if (!surface || !canvas || surface.__manualGravityGroupDragInstalled) return false;

    surface.__manualGravityGroupDragInstalled = true;
    installStyles();

    surface.addEventListener('pointerdown', handlePointerDown, true);
    surface.addEventListener('pointermove', handlePointerMove, true);
    surface.addEventListener('pointerup', (event) => finishDrag(event, false), true);
    surface.addEventListener('pointercancel', (event) => finishDrag(event, true), true);
    return true;
  }

  installMatrixHook();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }

  globalThis.MemoryGraphManualGroupDrag = Object.freeze({
    version: VERSION
  });
})();