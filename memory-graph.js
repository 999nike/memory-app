(() => {
  'use strict';

  const VERSION = 1;

  function mount() {
    const section = document.getElementById('memoryGraphSection');
    const surface = document.getElementById('memoryGraphSurface');
    if (!section || !surface) return false;

    surface.dataset.memoryGraphReady = 'true';
    section.dataset.memoryGraphVersion = String(VERSION);
    return true;
  }

  globalThis.MemoryGraph = Object.freeze({
    version: VERSION,
    mount
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
