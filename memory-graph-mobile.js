(() => {
  'use strict';

  const VERSION = 2;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphMobileInstalled) return;

  Object.defineProperty(proto, '__memoryGraphMobileInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const originalClearRect = proto.clearRect;
  const originalFillText = proto.fillText;
  const labelState = new WeakMap();
  const touches = new Map();
  let gesture = null;
  let cancellingPointer = false;

  function isGraphCanvas(context) {
    return context?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isMobileGraph(context) {
    if (!isGraphCanvas(context)) return false;
    const width = context.canvas.getBoundingClientRect().width;
    return width > 0 && width <= 800;
  }

  function stateFor(canvas) {
    let state = labelState.get(canvas);
    if (!state) {
      state = { boxes: [], memoryLabels: 0 };
      labelState.set(canvas, state);
    }
    return state;
  }

  function resetState(canvas) {
    if (!canvas) return;
    labelState.set(canvas, { boxes: [], memoryLabels: 0 });
  }

  function boxesOverlap(a, b) {
    return !(
      a.right + 5 < b.left ||
      a.left - 5 > b.right ||
      a.bottom + 3 < b.top ||
      a.top - 3 > b.bottom
    );
  }

  function activeSearchMatches(text) {
    const query = document.getElementById('searchInput')?.value?.trim().toLowerCase() || '';
    if (!query) return false;
    return String(text || '').toLowerCase().includes(query);
  }

  function transformedLabelBox(context, text, x, y) {
    const rect = context.canvas.getBoundingClientRect();
    const dpr = Math.max(1, context.canvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    const scale = Math.max(0.45, Math.abs(matrix.a) / dpr);
    const screenX = (matrix.a * Number(x) + matrix.c * Number(y) + matrix.e) / dpr;
    const screenY = (matrix.b * Number(x) + matrix.d * Number(y) + matrix.f) / dpr;
    const measured = context.measureText(String(text || '')).width * scale;
    const fontMatch = String(context.font || '').match(/([0-9.]+)px/i);
    const fontSize = Math.max(9, Number(fontMatch?.[1]) || 11) * scale;
    const width = measured + 10;
    const height = fontSize + 7;

    return {
      left: screenX - width / 2,
      right: screenX + width / 2,
      top: screenY - 2,
      bottom: screenY - 2 + height,
      canvasWidth: rect.width,
      canvasHeight: rect.height
    };
  }

  proto.clearRect = function memoryGraphMobileClearRect(...args) {
    if (isGraphCanvas(this)) resetState(this.canvas);
    return originalClearRect.apply(this, args);
  };

  proto.fillText = function memoryGraphMobileFillText(text, x, y, ...rest) {
    if (!isMobileGraph(this)) {
      return originalFillText.call(this, text, x, y, ...rest);
    }

    const font = String(this.font || '');
    const isSpaceLabel = /(?:^|\s)14px\b/.test(font);
    const isMemoryLabel = /(?:^|\s)11px\b/.test(font);

    // Only control the labels emitted by memory-graph.js. Any other canvas text
    // keeps its normal renderer behaviour.
    if (!isSpaceLabel && !isMemoryLabel) {
      return originalFillText.call(this, text, x, y, ...rest);
    }

    const state = stateFor(this.canvas);
    const box = transformedLabelBox(this, text, x, y);

    if (isSpaceLabel) {
      state.boxes.push(box);
      return originalFillText.call(this, text, x, y, ...rest);
    }

    const maxLabels = box.canvasWidth <= 430 ? 11 : 15;
    const forced = activeSearchMatches(text);
    const inside = box.left >= 4 && box.right <= box.canvasWidth - 4 && box.top >= 4 && box.bottom <= box.canvasHeight - 4;
    const collides = state.boxes.some((existing) => boxesOverlap(existing, box));

    if (!forced && (!inside || collides || state.memoryLabels >= maxLabels)) {
      return undefined;
    }

    state.boxes.push(box);
    state.memoryLabels += 1;
    return originalFillText.call(this, text, x, y, ...rest);
  };

  function touchCapable() {
    return Number(navigator.maxTouchPoints || 0) >= 2;
  }

  function graphCanvas() {
    return document.querySelector('.memory-graph-canvas');
  }

  function graphIsMobile(canvas) {
    if (!canvas) return false;
    const width = canvas.getBoundingClientRect().width;
    return width > 0 && width <= 800 && touchCapable();
  }

  function pointFromEvent(event) {
    return {
      id: Number(event.pointerId),
      x: Number(event.clientX),
      y: Number(event.clientY)
    };
  }

  function pairGeometry(first, second) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    return {
      distance: Math.max(1, Math.hypot(dx, dy)),
      angle: Math.atan2(dy, dx),
      midX: (first.x + second.x) / 2,
      midY: (first.y + second.y) / 2
    };
  }

  function angleDelta(next, previous) {
    let delta = next - previous;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  function stopTouchEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }

  function cancelExistingGraphPointer(canvas, point) {
    if (!canvas || !point || typeof PointerEvent !== 'function') return;
    cancellingPointer = true;
    try {
      canvas.dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: false,
        cancelable: true,
        pointerId: point.id,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: point.x,
        clientY: point.y
      }));
    } catch {}
    cancellingPointer = false;
  }

  function forceGraphRedraw() {
    const api = globalThis.MemoryGraph;
    if (!api) return;
    const query = document.getElementById('searchInput')?.value || '';
    api.focusSearchTerm?.(query, true);
  }

  function dispatchPinchZoom(canvas, centreX, centreY, ratio) {
    if (!canvas || !Number.isFinite(ratio) || ratio <= 0) return false;
    const log = Math.log(ratio);
    if (Math.abs(log) < 0.0025 || typeof WheelEvent !== 'function') return false;

    // memory-graph.js uses exp(-deltaY * .0012); invert that formula so
    // native finger distance maps directly onto the existing zoom behaviour.
    const deltaY = -log / 0.0012;
    try {
      canvas.dispatchEvent(new WheelEvent('wheel', {
        bubbles: false,
        cancelable: true,
        clientX: centreX,
        clientY: centreY,
        deltaY,
        deltaMode: 0
      }));
      return true;
    } catch {
      return false;
    }
  }

  function beginGesture(canvas) {
    const points = [...touches.values()].slice(0, 2);
    if (points.length < 2) return false;

    cancelExistingGraphPointer(canvas, points[0]);
    const geometry = pairGeometry(points[0], points[1]);
    gesture = {
      ids: [points[0].id, points[1].id],
      ...geometry,
      startedAt: performance.now(),
      moved: false
    };

    globalThis.MemoryGraphRotation?.beginTouch?.();
    canvas.dataset.interacting = 'true';
    canvas.dataset.mobileGesture = 'true';
    try { canvas.setPointerCapture?.(points[0].id); } catch {}
    try { canvas.setPointerCapture?.(points[1].id); } catch {}
    return true;
  }

  function updateGesture(canvas) {
    if (!gesture) return false;
    const first = touches.get(gesture.ids[0]);
    const second = touches.get(gesture.ids[1]);
    if (!first || !second) return false;

    const next = pairGeometry(first, second);
    const ratio = next.distance / Math.max(1, gesture.distance);
    const twist = angleDelta(next.angle, gesture.angle);
    const midDx = next.midX - gesture.midX;
    const midDy = next.midY - gesture.midY;

    const zoomed = dispatchPinchZoom(canvas, next.midX, next.midY, ratio);
    const yawDelta = twist * 0.92 + midDx * 0.0068;
    const pitchDelta = midDy * 0.0052;
    const rotated = Math.abs(yawDelta) > 0.001 || Math.abs(pitchDelta) > 0.001
      ? globalThis.MemoryGraphRotation?.updateTouch?.(yawDelta, pitchDelta) === true
      : false;

    if (
      Math.abs(next.distance - gesture.distance) > 1.5 ||
      Math.abs(twist) > 0.008 ||
      Math.hypot(midDx, midDy) > 1.5
    ) {
      gesture.moved = true;
    }

    gesture.distance = next.distance;
    gesture.angle = next.angle;
    gesture.midX = next.midX;
    gesture.midY = next.midY;

    if (rotated && !zoomed) forceGraphRedraw();
    else if (rotated) requestAnimationFrame(forceGraphRedraw);
    return zoomed || rotated;
  }

  function finishGesture(canvas) {
    if (!gesture) return;
    const active = gesture;
    gesture = null;
    globalThis.MemoryGraphRotation?.endTouch?.();
    canvas.removeAttribute('data-mobile-gesture');
    canvas.removeAttribute('data-interacting');

    // A quick stationary two-finger tap is the mobile equivalent of Escape:
    // reset pseudo-3D rotation without disturbing zoom or node positions.
    if (!active.moved && performance.now() - active.startedAt < 320) {
      globalThis.MemoryGraphRotation?.reset?.();
      forceGraphRedraw();
    }
  }

  function mountGestures() {
    const canvas = graphCanvas();
    if (!graphIsMobile(canvas) || canvas.__memoryGraphMobileGestures) return false;
    canvas.__memoryGraphMobileGestures = true;

    canvas.addEventListener('pointerdown', (event) => {
      if (cancellingPointer || event.pointerType !== 'touch') return;
      touches.set(Number(event.pointerId), pointFromEvent(event));

      if (gesture) {
        stopTouchEvent(event);
        return;
      }

      if (touches.size >= 2 && beginGesture(canvas)) {
        stopTouchEvent(event);
      }
    }, true);

    canvas.addEventListener('pointermove', (event) => {
      if (cancellingPointer || event.pointerType !== 'touch') return;
      if (touches.has(Number(event.pointerId))) touches.set(Number(event.pointerId), pointFromEvent(event));
      if (!gesture || !gesture.ids.includes(Number(event.pointerId))) return;
      updateGesture(canvas);
      stopTouchEvent(event);
    }, true);

    const endPointer = (event) => {
      if (cancellingPointer || event.pointerType !== 'touch') return;
      const pointerId = Number(event.pointerId);
      const wasGesturePointer = Boolean(gesture?.ids?.includes(pointerId));
      touches.delete(pointerId);
      if (wasGesturePointer) {
        finishGesture(canvas);
        stopTouchEvent(event);
      }
    };

    canvas.addEventListener('pointerup', endPointer, true);
    canvas.addEventListener('pointercancel', endPointer, true);
    canvas.addEventListener('lostpointercapture', (event) => {
      if (event.pointerType !== 'touch') return;
      touches.delete(Number(event.pointerId));
      if (gesture?.ids?.includes(Number(event.pointerId))) finishGesture(canvas);
    }, true);

    return true;
  }

  function scheduleGestureMount() {
    requestAnimationFrame(() => {
      if (mountGestures()) return;
      window.setTimeout(mountGestures, 160);
      window.setTimeout(mountGestures, 520);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleGestureMount, { once: true });
  } else {
    scheduleGestureMount();
  }

  globalThis.MemoryGraphMobile = Object.freeze({
    version: VERSION,
    gestures: true
  });
})();
