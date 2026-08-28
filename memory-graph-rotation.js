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

  function begin() {
    if (!desktopSupported()) return false;
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

  function reset() {
    state.yaw = 0;
    state.pitch = 0;
    state.active = false;
    state.rotating = false;
    state.touchRotating = false;
  }

  function isActive() {
    return Boolean(state.active && visualSupported());
  }

  function isRotating() {
    return Boolean(
      (state.rotating && desktopSupported()) ||
      (state.touchRotating && touchSupported())
    );
  }

  function pseudoDepth(node, graph) {
    if (!node || node.kind === 'space' || !graph) return 0;

    const dx = Number(node.x || 0) - Number(graph.centreX || 0);
    const dy = Number(node.y || 0) - Number(graph.centreY || 0);
    const shellRadius = Math.max(120, Math.min(Number(graph.width || 1), Number(graph.height || 1)) * 0.46);
    const radial = clamp(Math.hypot(dx, dy) / shellRadius, 0, 0.97);
    const hemisphere = hashUnit(node.id) >= 0.5 ? 1 : -1;
    const shellDepth = Math.sqrt(Math.max(0.04, 1 - radial * radial)) * shellRadius * 0.72;
    const jitter = (hashUnit(`${node.id}:depth`) - 0.5) * shellRadius * 0.18;
    return hemisphere * shellDepth + jitter;
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
      x: centreX + xYaw * perspective,
      y: centreY + yPitch * perspective,
      radius: Number(node.radius || 1) * perspective,
      depth: zPitch,
      alpha,
      scale: perspective
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
    snapshot
  });
})();
