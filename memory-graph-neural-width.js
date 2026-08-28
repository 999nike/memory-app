(() => {
  'use strict';

  const VERSION = 2;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralWidthInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralWidthInstalled', { value: true });

  const originalStroke = proto.stroke;
  let groupControlObserver = null;

  function isScaffold(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-neural-scaffold-canvas') === true;
  }

  function gainFor(style) {
    const s = String(style || '');
    if (s.includes('244,253,255')) return 1.9;
    if (s.includes('104,215,255')) return 2.75;
    if (s.includes('39,149,255')) return 1.65;
    if (s.includes('149,232,255')) return 1.45;
    if (s.includes('157,229,255')) return 1.55;
    if (s.includes('210,246,255')) return 1.45;
    if (s.includes('171,235,255')) return 1.55;
    return 1;
  }

  proto.stroke = function memoryGraphNeuralWidthStroke(...args) {
    if (!isScaffold(this)) return originalStroke.apply(this, args);
    const gain = gainFor(this.strokeStyle);
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(watchGroupAddControl), { once: true });
  } else {
    requestAnimationFrame(watchGroupAddControl);
  }

  globalThis.MemoryGraphNeuralWidth = Object.freeze({
    version: VERSION,
    restoreGroupControl: ensureGroupAddControl
  });
})();
