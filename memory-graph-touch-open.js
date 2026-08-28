(() => {
  'use strict';

  const VERSION = 1;
  const DOUBLE_TAP_MS = 430;
  const TOUCH_TRIGGER_WINDOW_MS = 180;

  let pendingTouchRelease = null;
  let lastTap = { memoryId: null, at: 0 };
  let mountedCanvas = null;
  let mountedGrid = null;

  function now() {
    return performance.now();
  }

  function block(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function onGraphPointerFinish(event) {
    if (event.pointerType !== 'touch') return;
    pendingTouchRelease = {
      at: now(),
      cancelled: event.type === 'pointercancel'
    };
  }

  function graphGeneratedInspectorTrigger(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;
    const trigger = target.closest?.('button[data-memory-id]');
    if (!trigger || trigger.hidden !== true) return null;
    return trigger;
  }

  function onMemoryGridClick(event) {
    const trigger = graphGeneratedInspectorTrigger(event);
    if (!trigger) return;

    const pending = pendingTouchRelease;
    pendingTouchRelease = null;
    if (!pending || now() - pending.at > TOUCH_TRIGGER_WINDOW_MS) return;

    // Starting a second finger makes the graph cancel the first pointer. The old
    // graph pointer-up path can still attempt to open the inspector from that
    // cancel. Never allow a cancelled touch to count as an intentional tap.
    if (pending.cancelled) {
      block(event);
      return;
    }

    const memoryId = String(trigger.dataset.memoryId || '');
    if (!memoryId) {
      block(event);
      return;
    }

    const time = now();
    const isSecondTap = lastTap.memoryId === memoryId && time - lastTap.at <= DOUBLE_TAP_MS;

    if (isSecondTap) {
      // Let the graph's existing hidden-trigger click continue normally. This
      // preserves the existing inspector implementation instead of duplicating it.
      lastTap = { memoryId: null, at: 0 };
      return;
    }

    lastTap = { memoryId, at: time };
    block(event);
  }

  function mount() {
    const canvas = document.querySelector('.memory-graph-canvas');
    const grid = document.getElementById('memoryGrid');
    if (!canvas || !grid) return false;

    if (mountedCanvas !== canvas) {
      mountedCanvas?.removeEventListener('pointerup', onGraphPointerFinish, true);
      mountedCanvas?.removeEventListener('pointercancel', onGraphPointerFinish, true);
      mountedCanvas = canvas;
      canvas.addEventListener('pointerup', onGraphPointerFinish, true);
      canvas.addEventListener('pointercancel', onGraphPointerFinish, true);
    }

    if (mountedGrid !== grid) {
      mountedGrid?.removeEventListener('click', onMemoryGridClick, true);
      mountedGrid = grid;
      grid.addEventListener('click', onMemoryGridClick, true);
    }

    return true;
  }

  function scheduleMount() {
    requestAnimationFrame(() => {
      if (mount()) return;
      window.setTimeout(mount, 120);
      window.setTimeout(mount, 420);
      window.setTimeout(mount, 900);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleMount, { once: true });
  } else {
    scheduleMount();
  }

  globalThis.MemoryGraphTouchOpen = Object.freeze({
    version: VERSION,
    doubleTapMs: DOUBLE_TAP_MS,
    refresh: mount
  });
})();
