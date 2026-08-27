(() => {
  'use strict';

  const rawRotation = globalThis.MemoryGraphRotation || null;
  if (!rawRotation || globalThis.__memoryGraphGravityOwnershipInstalled) return;

  globalThis.__memoryGraphGravityOwnershipInstalled = true;

  let activeRotation = rawRotation;
  const originalAddEventListener = EventTarget.prototype.addEventListener;

  Object.defineProperty(globalThis, 'MemoryGraphRotation', {
    configurable: true,
    enumerable: true,
    get() {
      return activeRotation;
    },
    set(value) {
      if (value?.__manualGravityGroupsWrapped) {
        // Keep the legacy manual-group module alive for its create-group UI and
        // storage helpers, but do not let it become the graph projection owner.
        globalThis.__memoryGraphLegacyGroupsRotation = value;
        activeRotation = rawRotation;
        return;
      }
      activeRotation = value;
    }
  });

  EventTarget.prototype.addEventListener = function memoryGraphGravityOwnedListener(type, listener, options) {
    const pointerEvent = type === 'pointerdown' || type === 'pointermove' || type === 'pointerup' || type === 'pointercancel';
    if (pointerEvent && this instanceof HTMLCanvasElement && this.classList.contains('memory-graph-canvas')) {
      const stack = String(new Error().stack || '');
      if (stack.includes('memory-graph-manual-groups.js')) {
        return undefined;
      }
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
})();
