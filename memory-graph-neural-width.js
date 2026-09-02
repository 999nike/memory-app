(() => {
  'use strict';

  const VERSION = 18;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GRAPH_STATE_KEY = 'memory-graph-layout-v1';
  const GROUP_KEY = 'memory-graph-folders-v1';
  const STARTUP_GUARD_MS = 1800;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralWidthInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralWidthInstalled', { value: true });

  const originalStroke = proto.stroke;
  const nativeRequestAnimationFrame = globalThis.requestAnimationFrame.bind(globalThis);
  let groupControlObserver = null;
  let startupPhysicsGuard = hasCompleteSavedLayout();
  let startupGuardUntil = performance.now() + STARTUP_GUARD_MS;
  let startupRebaseDone = false;
  let startupResizeObserver = null;
  let startupStableTimer = 0;

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  function activeSpace() {
    const workspace = readJson(WORKSPACE_KEY);
    if (!workspace || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.memories)) return null;
    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    return space ? { workspace, space } : null;
  }

  function hasCompleteSavedLayout() {
    const active = activeSpace();
    if (!active) return false;
    const confirmed = active.workspace.memories.filter((memory) =>
      String(memory.spaceId) === String(active.space.id) && String(memory.status || 'confirmed') === 'confirmed'
    );
    if (!confirmed.length) return false;

    const layout = readJson(GRAPH_STATE_KEY);
    const nodes = layout?.spaces?.[active.space.id]?.nodes;
    if (!nodes || typeof nodes !== 'object') return false;

    return confirmed.every((memory) => {
      const saved = nodes[memory.id];
      return Number.isFinite(Number(saved?.offsetX)) && Number.isFinite(Number(saved?.offsetY));
    });
  }

  function isMemoryGraphPhysicsTick(callback) {
    if (typeof callback !== 'function') return false;
    try {
      const source = Function.prototype.toString.call(callback);
      return source.includes('simulateStep()') &&
        source.includes('simulationFrames') &&
        source.includes('persistGraphState(false)');
    } catch {
      return false;
    }
  }

  function guardedRequestAnimationFrame(callback) {
    if (startupPhysicsGuard && performance.now() < startupGuardUntil && isMemoryGraphPhysicsTick(callback)) {
      return 0;
    }
    return nativeRequestAnimationFrame(callback);
  }

  globalThis.requestAnimationFrame = guardedRequestAnimationFrame;

  function unlockStartupPhysics() {
    startupPhysicsGuard = false;
  }

  function dispatchGroupGeometryReset() {
    const raw = localStorage.getItem(GROUP_KEY);
    try {
      window.dispatchEvent(new StorageEvent('storage', {
        key: GROUP_KEY,
        oldValue: raw,
        newValue: raw,
        url: location.href,
        storageArea: localStorage
      }));
      return;
    } catch {}

    try {
      const event = new Event('storage');
      Object.defineProperty(event, 'key', { value: GROUP_KEY });
      window.dispatchEvent(event);
    } catch {}
  }

  function finishStartupGeometry() {
    if (startupRebaseDone) return;
    startupRebaseDone = true;
    startupResizeObserver?.disconnect();
    startupResizeObserver = null;
    dispatchGroupGeometryReset();
    globalThis.MemoryGraph?.refresh?.();
  }

  function scheduleStartupGeometrySettle() {
    if (!startupPhysicsGuard || startupRebaseDone) return;
    if (startupStableTimer) window.clearTimeout(startupStableTimer);
    startupStableTimer = window.setTimeout(() => {
      startupStableTimer = 0;
      finishStartupGeometry();
    }, 220);
  }

  function watchStartupGeometry() {
    if (!startupPhysicsGuard || startupRebaseDone) return;
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface) {
      window.setTimeout(watchStartupGeometry, 80);
      return;
    }

    surface.addEventListener('pointerdown', unlockStartupPhysics, { once: true, capture: true });
    surface.addEventListener('wheel', unlockStartupPhysics, { once: true, capture: true, passive: true });

    startupResizeObserver?.disconnect();
    startupResizeObserver = new ResizeObserver(scheduleStartupGeometrySettle);
    startupResizeObserver.observe(surface);
    scheduleStartupGeometrySettle();
  }

  function isScaffold(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-neural-scaffold-canvas') === true;
  }

  function graphCanvas(ctx) {
    return ctx?.canvas?.parentElement?.querySelector?.('.memory-graph-canvas') || null;
  }

  function renderMode(ctx) {
    const graph = graphCanvas(ctx);
    return {
      interacting: graph?.dataset?.interacting === 'true',
      mobile: Number(graph?.clientWidth || window.innerWidth || 0) < 760
    };
  }

  function shouldSkip(style, mode) {
    const s = String(style || '');
    if (mode.interacting && s.includes('10,55,190')) return true;
    if (!mode.mobile) return false;
    if (s.includes('149,232,255')) return true;
    if (s.includes('210,246,255')) return true;
    if (s.includes('171,235,255')) return true;
    return false;
  }

  function gainFor(style, mode) {
    const s = String(style || '');
    const mobileGain = mode.mobile ? 0.82 : 1;
    if (s.includes('244,253,255')) return 1.95 * mobileGain;
    if (s.includes('104,215,255')) return 2.75 * mobileGain;
    if (s.includes('39,149,255')) return 1.72 * mobileGain;
    if (s.includes('149,232,255')) return 1.58;
    if (s.includes('157,229,255')) return 1.78 * mobileGain;
    if (s.includes('210,246,255')) return 1.68;
    if (s.includes('171,235,255')) return 1.78;
    return 1;
  }

  proto.stroke = function memoryGraphNeuralWidthStroke(...args) {
    if (!isScaffold(this)) return originalStroke.apply(this, args);
    const mode = renderMode(this);
    if (shouldSkip(this.strokeStyle, mode)) return undefined;

    const gain = gainFor(this.strokeStyle, mode);
    if (gain === 1) return originalStroke.apply(this, args);

    const previousWidth = this.lineWidth;
    this.lineWidth = Math.max(0.25, Number(previousWidth || 1) * gain);
    try {
      return originalStroke.apply(this, args);
    } finally {
      this.lineWidth = previousWidth;
    }
  };

  function ensureGroupControlStyles() {
    if (document.getElementById('memoryGraphRecoveredGroupControlStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphRecoveredGroupControlStyles';
    style.textContent = `
      .memory-graph-group-add {
        position:absolute;
        top:12px;
        right:12px;
        z-index:8;
        width:36px;
        height:36px;
        display:grid;
        place-items:center;
        border:1px solid rgb(199 255 86 / .48);
        border-radius:50%;
        background:radial-gradient(circle at 35% 30%,rgb(199 255 86 / .22),rgb(10 17 27 / .96) 64%);
        color:#c7ff56;
        font:800 22px/1 Inter,system-ui,sans-serif;
        box-shadow:0 0 18px rgb(199 255 86 / .14),inset 0 0 10px rgb(120 184 255 / .08);
        cursor:pointer;
      }
      .memory-graph-group-add:hover {
        border-color:rgb(199 255 86 / .82);
        box-shadow:0 0 22px rgb(199 255 86 / .20),inset 0 0 12px rgb(120 184 255 / .10);
      }
      @media(max-width:800px) {
        .memory-graph-group-add { top:9px; right:9px; width:34px; height:34px; }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureGroupAddControl() {
    const surface = document.getElementById('memoryGraphSurface');
    const api = globalThis.MemoryGraphManualGroups;
    if (!surface || typeof api?.createGroup !== 'function') return false;

    ensureGroupControlStyles();
    if (surface.querySelector('.memory-graph-group-add')) return true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'memory-graph-group-add';
    button.setAttribute('aria-label', 'Create memory folder');
    button.title = 'Create memory folder';
    button.textContent = '+';
    button.addEventListener('click', () => {
      const title = window.prompt('Folder name');
      if (!title) return;
      if (api.createGroup(title)) requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
    });
    surface.appendChild(button);
    return true;
  }

  function watchGroupAddControl() {
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface) return;

    ensureGroupAddControl();
    window.setTimeout(ensureGroupAddControl, 80);
    window.setTimeout(ensureGroupAddControl, 320);

    groupControlObserver?.disconnect();
    groupControlObserver = new MutationObserver(() => {
      if (!surface.querySelector('.memory-graph-group-add')) ensureGroupAddControl();
    });
    groupControlObserver.observe(surface, { childList: true });
  }

  function loadGroupUx() {
    if (document.getElementById('memoryGraphGroupUxLoader') || globalThis.MemoryGraphGroupUx) return;
    const script = document.createElement('script');
    script.id = 'memoryGraphGroupUxLoader';
    script.src = './memory-graph-group-ux.js?v=1';
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadMemoryDive() {
    if (document.getElementById('memoryGraphDiveLoader') || globalThis.MemoryGraphDive) return;
    const script = document.createElement('script');
    script.id = 'memoryGraphDiveLoader';
    script.src = './memory-graph-dive.js?v=1';
    script.defer = true;
    document.head.appendChild(script);
  }

  // One middle-trunk renderer. Scaffold owns node branches; Flow owns pulses.
  // Retired experiments stay unloaded so they cannot add canvases or stroke hooks.
  function loadNeuralNexus() {
    if (document.getElementById('memoryGraphNeuralNexusLoader') || globalThis.MemoryGraphNeuralNexus) return;
    const script = document.createElement('script');
    script.id = 'memoryGraphNeuralNexusLoader';
    script.src = './memory-graph-neural-nexus.js?v=8';
    script.async = false;
    script.addEventListener('load', () => globalThis.MemoryGraph?.redraw?.());
    document.head.appendChild(script);
  }

  function mount() {
    nativeRequestAnimationFrame(watchGroupAddControl);
    loadGroupUx();
    loadMemoryDive();
    loadNeuralNexus();
    watchStartupGeometry();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  globalThis.MemoryGraphNeuralWidth = Object.freeze({
    version: VERSION,
    restoreGroupControl: ensureGroupAddControl,
    startupGuardActive: () => startupPhysicsGuard && performance.now() < startupGuardUntil
  });
})();
