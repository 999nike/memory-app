(() => {
  'use strict';

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
})();
