(() => {
  'use strict';

  const VERSION = 2;
  const ENTER_RATIO = 1.58;
  const EXIT_RATIO = 0.70;
  const MIN_GESTURE_MS = 70;
  const pointers = new Map();
  let pair = null;
  let active = false;
  let surface = null;
  let controls = null;
  let hint = null;
  let hintTimer = 0;

  function touchCapable() {
    return Number(navigator.maxTouchPoints || 0) >= 2;
  }

  function mobileWidth() {
    return window.innerWidth <= 800;
  }

  function graphCanvas() {
    return document.querySelector('.memory-graph-canvas');
  }

  function isGraphPointer(event) {
    const canvas = graphCanvas();
    if (!canvas || event.pointerType !== 'touch') return false;
    if (event.target === canvas) return true;
    return Boolean(event.target?.closest?.('#memoryGraphSurface'));
  }

  function geometry(first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return {
      distance: Math.max(1, Math.hypot(dx, dy)),
      midX: (first.x + second.x) / 2,
      midY: (first.y + second.y) / 2
    };
  }

  function ensureUi() {
    surface = document.getElementById('memoryGraphSurface');
    if (!surface) return false;

    if (!document.getElementById('memoryGraphDiveStyles')) {
      const style = document.createElement('style');
      style.id = 'memoryGraphDiveStyles';
      style.textContent = `
        body.memory-graph-dive-active {
          overflow: hidden !important;
          overscroll-behavior: none;
        }

        body.memory-graph-dive-active #memoryGraphSurface {
          position: fixed !important;
          inset: 0 !important;
          z-index: 5000 !important;
          width: 100vw !important;
          height: 100dvh !important;
          min-height: 100dvh !important;
          max-height: none !important;
          margin: 0 !important;
          border: 0 !important;
          border-radius: 0 !important;
          box-shadow:
            inset 0 0 180px rgb(0 0 0 / .56),
            inset 0 0 80px rgb(59 150 255 / .10),
            0 0 0 100vmax rgb(3 7 13 / .98) !important;
          background:
            radial-gradient(circle at 50% 46%, rgb(59 145 255 / .18), transparent 34%),
            radial-gradient(circle at 18% 30%, rgb(199 255 86 / .055), transparent 28%),
            radial-gradient(circle at 82% 70%, rgb(39 116 255 / .09), transparent 32%),
            linear-gradient(180deg, rgb(5 12 22 / .995), rgb(3 8 15 / .999)) !important;
          transform: scale(.985);
          opacity: .96;
          transition: transform 220ms ease, opacity 220ms ease;
          touch-action: none;
        }

        body.memory-graph-dive-active.memory-graph-dive-ready #memoryGraphSurface {
          transform: scale(1);
          opacity: 1;
        }

        body.memory-graph-dive-active #memoryGraphSurface::before {
          opacity: .72 !important;
          filter: blur(.2px);
        }

        body.memory-graph-dive-active .memory-graph-neural-scaffold-canvas,
        body.memory-graph-dive-active .memory-graph-neural-flow-canvas {
          filter: saturate(1.12) brightness(1.08);
        }

        .memory-graph-dive-controls {
          position: fixed;
          z-index: 5020;
          top: max(14px, env(safe-area-inset-top));
          left: max(14px, env(safe-area-inset-left));
          display: none;
          gap: 8px;
          align-items: center;
          pointer-events: auto;
        }

        body.memory-graph-dive-active .memory-graph-dive-controls {
          display: flex;
        }

        .memory-graph-dive-exit {
          min-height: 42px;
          padding: 0 15px;
          border-radius: 999px;
          border: 1px solid rgb(133 213 255 / .38);
          color: rgb(235 249 255);
          background: rgb(6 17 30 / .78);
          box-shadow: 0 0 22px rgb(54 150 255 / .14);
          backdrop-filter: blur(12px);
          font: 700 13px/1 Inter, system-ui, sans-serif;
        }

        .memory-graph-dive-hint {
          position: fixed;
          z-index: 5015;
          left: 50%;
          bottom: max(22px, env(safe-area-inset-bottom));
          transform: translateX(-50%) translateY(8px);
          max-width: calc(100vw - 36px);
          padding: 9px 13px;
          border: 1px solid rgb(126 196 255 / .20);
          border-radius: 999px;
          color: rgb(202 225 242 / .92);
          background: rgb(5 13 24 / .72);
          backdrop-filter: blur(10px);
          font: 600 12px/1.25 Inter, system-ui, sans-serif;
          white-space: nowrap;
          pointer-events: none;
          opacity: 0;
          transition: opacity 180ms ease, transform 180ms ease;
        }

        body.memory-graph-dive-active .memory-graph-dive-hint.is-visible {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        @media (min-width: 801px) {
          .memory-graph-dive-controls,
          .memory-graph-dive-hint {
            display: none !important;
          }
        }
      `;
      document.head.appendChild(style);
    }

    if (!controls) {
      controls = document.createElement('div');
      controls.className = 'memory-graph-dive-controls';
      controls.setAttribute('aria-hidden', 'true');

      const exit = document.createElement('button');
      exit.type = 'button';
      exit.className = 'memory-graph-dive-exit';
      exit.textContent = '← Exit memory';
      exit.addEventListener('click', () => leaveDive('button'));
      controls.appendChild(exit);
      document.body.appendChild(controls);
    }

    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'memory-graph-dive-hint';
      hint.textContent = 'Two fingers to explore · pinch inward to exit';
      document.body.appendChild(hint);
    }

    return true;
  }

  function showHint() {
    if (!hint) return;
    if (hintTimer) clearTimeout(hintTimer);
    hint.classList.add('is-visible');
    hintTimer = window.setTimeout(() => {
      hintTimer = 0;
      hint?.classList.remove('is-visible');
    }, 2500);
  }

  function flushGraph() {
    globalThis.MemoryGraphNeuralScaffold?.redraw?.();
    globalThis.MemoryGraphNeuralFlow?.redraw?.();
    const query = document.getElementById('searchInput')?.value || '';
    globalThis.MemoryGraph?.focusSearchTerm?.(query, true);
  }

  function enterDive() {
    if (active || !touchCapable() || !mobileWidth() || !ensureUi()) return false;
    active = true;
    document.body.classList.add('memory-graph-dive-active');
    controls?.setAttribute('aria-hidden', 'false');
    surface.dataset.memoryDive = 'true';

    requestAnimationFrame(() => {
      document.body.classList.add('memory-graph-dive-ready');
      flushGraph();
      requestAnimationFrame(flushGraph);
    });

    showHint();
    return true;
  }

  function leaveDive() {
    if (!active) return false;
    active = false;
    document.body.classList.remove('memory-graph-dive-ready', 'memory-graph-dive-active');
    controls?.setAttribute('aria-hidden', 'true');
    hint?.classList.remove('is-visible');
    surface?.removeAttribute('data-memory-dive');

    requestAnimationFrame(() => {
      flushGraph();
      requestAnimationFrame(flushGraph);
    });
    return true;
  }

  function startPair() {
    const points = [...pointers.values()].slice(0, 2);
    if (points.length < 2) return;
    const current = geometry(points[0], points[1]);
    pair = {
      ids: [points[0].id, points[1].id],
      startDistance: current.distance,
      startedAt: performance.now(),
      triggered: false
    };
  }

  function updatePair() {
    if (!pair) return;
    const first = pointers.get(pair.ids[0]);
    const second = pointers.get(pair.ids[1]);
    if (!first || !second) return;
    const current = geometry(first, second);
    const ratio = current.distance / Math.max(1, pair.startDistance);
    const age = performance.now() - pair.startedAt;
    if (age < MIN_GESTURE_MS || pair.triggered) return;

    if (!active && ratio >= ENTER_RATIO) {
      pair.triggered = enterDive();
      return;
    }

    if (active && ratio <= EXIT_RATIO) {
      pair.triggered = leaveDive('pinch');
    }
  }

  function finishPointer(pointerId) {
    pointers.delete(pointerId);
    if (!pair?.ids?.includes(pointerId)) return;
    pair = null;
  }

  function bind() {
    if (!touchCapable()) return;
    ensureUi();

    window.addEventListener('pointerdown', (event) => {
      if (!isGraphPointer(event)) return;
      pointers.set(Number(event.pointerId), {
        id: Number(event.pointerId),
        x: Number(event.clientX),
        y: Number(event.clientY)
      });
      if (!pair && pointers.size >= 2) startPair();
    }, true);

    window.addEventListener('pointermove', (event) => {
      const id = Number(event.pointerId);
      if (!pointers.has(id)) return;
      pointers.set(id, { id, x: Number(event.clientX), y: Number(event.clientY) });
      updatePair();
    }, true);

    window.addEventListener('pointerup', (event) => finishPointer(Number(event.pointerId)), true);
    window.addEventListener('pointercancel', (event) => finishPointer(Number(event.pointerId)), true);

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && active) leaveDive('escape');
    });
  }

  function loadTouchOpen() {
    if (document.getElementById('memoryGraphTouchOpenLoader') || globalThis.MemoryGraphTouchOpen) return;
    const script = document.createElement('script');
    script.id = 'memoryGraphTouchOpenLoader';
    script.src = './memory-graph-touch-open.js?v=1';
    script.defer = true;
    document.head.appendChild(script);
  }

  function mount() {
    ensureUi();
    bind();
    loadTouchOpen();
  }

  globalThis.MemoryGraphDive = Object.freeze({
    version: VERSION,
    enter: enterDive,
    exit: leaveDive,
    isActive: () => active
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
