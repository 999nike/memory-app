(() => {
  'use strict';

  const VERSION = 2;
  const MIN_DESKTOP_WIDTH = 1051;
  const state = {
    yaw: 0,
    pitch: 0,
    active: false,
    rotating: false,
    touchRotating: false
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normaliseAngle(value) {
    const full = Math.PI * 2;
    let next = Number(value) || 0;
    while (next > Math.PI) next -= full;
    while (next < -Math.PI) next += full;
    return next;
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

  function desktopSupported() {
    if (window.innerWidth < MIN_DESKTOP_WIDTH) return false;
    try {
      return window.matchMedia('(pointer: fine)').matches;
    } catch {
      return true;
    }
  }

  function touchSupported() {
    const points = Math.max(0, Number(navigator.maxTouchPoints || 0));
    if (points >= 2) return true;
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch {
      return false;
    }
  }

  // Desktop compatibility: the existing graph pointer handler still uses this
  // for Ctrl + drag rotation. Mobile gestures use beginTouch/updateTouch.
  function supported() {
    return desktopSupported();
  }

  function visualSupported() {
    return desktopSupported() || touchSupported();
  }

  function shouldStart(event) {
    return Boolean(
      desktopSupported() &&
      event &&
      event.button === 0 &&
      event.ctrlKey
    );
  }

  let cinematic = null;
  let spatialBlend = 1;

  function cancelCinematic(manual = false) {
    cinematic = null;
    if (manual) globalThis.dispatchEvent(new Event('orb-spatial-takeover'));
  }

  function begin() {
    if (!desktopSupported()) return false;
    cancelCinematic(true);
    state.rotating = true;
    return true;
  }

  function update(deltaX, deltaY) {
    if (!state.rotating || !desktopSupported()) return false;

    state.active = true;
    state.yaw = normaliseAngle(state.yaw + Number(deltaX || 0) * 0.0085);
    state.pitch = clamp(state.pitch + Number(deltaY || 0) * 0.0065, -1.22, 1.22);
    return true;
  }

  function end() {
    state.rotating = false;
  }

  function beginTouch() {
    if (!touchSupported()) return false;
    cancelCinematic(true);
    state.touchRotating = true;
    return true;
  }

  function updateTouch(yawDelta, pitchDelta) {
    if (!state.touchRotating || !touchSupported()) return false;
    const yaw = Number(yawDelta || 0);
    const pitch = Number(pitchDelta || 0);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return false;

    state.active = true;
    state.yaw = normaliseAngle(state.yaw + yaw);
    state.pitch = clamp(state.pitch + pitch, -1.22, 1.22);
    return true;
  }

  function endTouch() {
    state.touchRotating = false;
  }

  function reset(options = {}) {
    cancelCinematic(options.manual !== false);
    spatialBlend = 1;
    state.yaw = 0;
    state.pitch = 0;
    state.active = false;
    state.rotating = false;
    state.touchRotating = false;
  }

  function isActive() {
    return Boolean(state.active);
  }

  function isRotating() {
    return Boolean(
      (state.rotating && desktopSupported()) ||
      (state.touchRotating && touchSupported())
    );
  }

  function familyPath(node, graph) {
    const path = [], seen = new Set();
    let current = graph?.nodes?.find(item => String(item.id) === String(node?.id)) || node;
    while (current && current.kind !== 'space' && !seen.has(String(current.id))) {
      path.push(current); seen.add(String(current.id));
      current = graph?.nodes?.find(item => String(item.id) === String(current.parentId));
    }
    return path;
  }

  function pseudoDepth(node, graph) {
    if (!node || node.kind === 'space' || !graph) return 0;
    const path = familyPath(node, graph);
    const root = path[path.length - 1] || node;
    const shell = Math.max(120, Math.min(graph.width, graph.height) * .46);
    const radial = clamp(Math.hypot(root.x - graph.centreX, root.y - graph.centreY) / shell, 0, .97);
    const broad = (hashUnit(root.id) >= .5 ? 1 : -1) *
      Math.sqrt(Math.max(.04, 1 - radial * radial)) * shell * .72;
    let offset = 0;
    // Bounded ancestry offsets retain family depth even in deep trees.
    path.slice(0, -1).reverse().forEach((child, depth) => {
      offset += (hashUnit(child.id + ':depth') - .5) * shell * .07 * Math.pow(.55, depth);
    });
    return broad + offset;
  }

  function beginCinematic(node, graph) {
    cancelCinematic();
    if (!node || !graph || isRotating()) return false;
    const root = familyPath(node, graph).at(-1) || node;
    const x = root.x - graph.centreX, y = root.y - graph.centreY;
    const z = pseudoDepth(root, graph);
    const desired = Math.atan2(-x, z);
    const delta = normaliseAngle(desired - state.yaw);
    const direction = Math.abs(delta) > .05 ? Math.sign(delta) : (hashUnit(root.id) < .5 ? -1 : 1);
    cinematic = {
      yaw: state.yaw, pitch: state.pitch, blend: state.active ? spatialBlend : 0,
      delta: direction * clamp(Math.abs(delta), .95, 1.7),
      targetPitch: clamp(Math.atan2(y, Math.hypot(x, z)), -.38, .38)
    };
    spatialBlend = cinematic.blend;
    state.active = true;
    return true;
  }

  // The resident guide's draw loop supplies eased progress.
  function advanceCinematic(progress) {
    if (!cinematic) return false;
    const t = clamp(progress, 0, 1);
    state.yaw = normaliseAngle(cinematic.yaw + cinematic.delta * t);
    state.pitch = cinematic.pitch + (cinematic.targetPitch - cinematic.pitch) * t;
    spatialBlend = cinematic.blend + (1 - cinematic.blend) * t;
    if (t === 1) cinematic = null;
    return true;
  }

  function project(node, graph) {
    const fallback = {
      x: Number(node?.x || 0),
      y: Number(node?.y || 0),
      radius: Number(node?.radius || 1),
      depth: 0,
      alpha: 1,
      scale: 1
    };

    if (!node || !graph || !isActive() || node.kind === 'space') return fallback;

    const centreX = Number(graph.centreX || 0);
    const centreY = Number(graph.centreY || 0);
    const x = Number(node.x || 0) - centreX;
    const y = Number(node.y || 0) - centreY;
    const z = pseudoDepth(node, graph);

    const cosYaw = Math.cos(state.yaw);
    const sinYaw = Math.sin(state.yaw);
    const cosPitch = Math.cos(state.pitch);
    const sinPitch = Math.sin(state.pitch);

    const xYaw = x * cosYaw + z * sinYaw;
    const zYaw = -x * sinYaw + z * cosYaw;
    const yPitch = y * cosPitch - zYaw * sinPitch;
    const zPitch = y * sinPitch + zYaw * cosPitch;

    const depthRadius = Math.max(160, Math.min(Number(graph.width || 1), Number(graph.height || 1)) * 0.62);
    const perspective = clamp(1 + zPitch / (depthRadius * 3.25), 0.82, 1.20);
    const alpha = clamp(0.68 + (perspective - 0.82) * 1.45, 0.62, 1);

    return {
      x: fallback.x + (centreX + xYaw * perspective - fallback.x) * spatialBlend,
      y: fallback.y + (centreY + yPitch * perspective - fallback.y) * spatialBlend,
      radius: fallback.radius * (1 + (perspective - 1) * spatialBlend),
      depth: zPitch * spatialBlend,
      alpha: 1 + (alpha - 1) * spatialBlend,
      scale: 1 + (perspective - 1) * spatialBlend
    };
  }

  function snapshot() {
    return {
      version: VERSION,
      yaw: state.yaw,
      pitch: state.pitch,
      active: isActive(),
      rotating: isRotating(),
      touchRotating: Boolean(state.touchRotating)
    };
  }

  globalThis.MemoryGraphRotation = Object.freeze({
    version: VERSION,
    supported,
    touchSupported,
    shouldStart,
    begin,
    update,
    end,
    beginTouch,
    updateTouch,
    endTouch,
    reset,
    isActive,
    isRotating,
    project,
    snapshot,
    familyRoot: (node, graph) => familyPath(node, graph).at(-1) || node,
    beginCinematic,
    advanceCinematic,
    cancelCinematic
  });
})();
