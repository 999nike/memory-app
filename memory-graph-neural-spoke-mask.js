(() => {
  'use strict';

  const VERSION = 2;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralSpokeMaskInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralSpokeMaskInstalled', { value: true });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousClearRect = proto.clearRect;
  const previousStroke = proto.stroke;

  const segments = [];
  let layer = null;
  let layerContext = null;
  let sourceCanvas = null;
  let frame = 0;
  let lastPaint = 0;

  const FRAME_MS = 64;
  const INTERACTING_FRAME_MS = 148;
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralMaskStart || !ctx?.__memoryNeuralMaskEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-spoke-mask-canvas';
      layer.setAttribute('aria-hidden', 'true');
      canvas.parentElement.appendChild(layer);
      layerContext = layer.getContext('2d');
      sourceCanvas = canvas;
    }
    if (!layerContext) return false;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, canvas.width / Math.max(1, width));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
      layer.width = pixelWidth;
      layer.height = pixelHeight;
      layerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    if (!frame) frame = requestAnimationFrame(drawFrame);
    return true;
  }

  function transformedEndpoints(ctx) {
    const start = ctx.__memoryNeuralMaskStart;
    const end = ctx.__memoryNeuralMaskEnd;
    if (!start || !end) return null;
    const canvas = ctx.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = ctx.getTransform();
    const project = (point) => ({
      x: (matrix.a * point.x + matrix.c * point.y + matrix.e) / dpr,
      y: (matrix.b * point.x + matrix.d * point.y + matrix.f) / dpr
    });
    return { from: project(start), to: project(end) };
  }

  function capture(ctx) {
    const target = sourceCanvas || document.querySelector('.memory-graph-canvas');
    if (!target || !ensureLayer(target)) return;
    const points = transformedEndpoints(ctx);
    if (!points || distance(points.from, points.to) < 4) return;
    segments.push({ ...points, length: distance(points.from, points.to) });
  }

  function groupBySource(items) {
    const groups = [];
    const tolerance = 14;
    for (const segment of items) {
      let group = groups.find((candidate) => distance(candidate.centre, segment.from) <= tolerance);
      if (!group) {
        group = { centre: { ...segment.from }, segments: [] };
        groups.push(group);
      }
      group.segments.push(segment);
      const count = group.segments.length;
      group.centre.x += (segment.from.x - group.centre.x) / count;
      group.centre.y += (segment.from.y - group.centre.y) / count;
    }
    return groups;
  }

  function rootGroups(items) {
    const groups = groupBySource(items);
    const endpointTolerance = 18;
    return groups
      .filter((group) => !items.some((segment) => distance(group.centre, segment.to) <= endpointTolerance))
      .sort((a, b) => b.segments.length - a.segments.length)
      .slice(0, 8);
  }

  function maskSegment(ctx, segment, width, interacting) {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const start = { x: segment.from.x + dx * 0.07, y: segment.from.y + dy * 0.07 };
    const end = { x: segment.from.x + dx * 0.95, y: segment.from.y + dy * 0.95 };

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.lineWidth = Math.max(5.6, width * (interacting ? 1.45 : 1.95));
    ctx.strokeStyle = interacting ? 'rgba(3,13,31,.62)' : 'rgba(3,13,31,.90)';
    previousStroke.call(ctx);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.lineWidth = Math.max(3.2, width * (interacting ? 0.90 : 1.18));
    ctx.strokeStyle = interacting ? 'rgba(9,31,70,.38)' : 'rgba(9,31,70,.72)';
    previousStroke.call(ctx);
    ctx.restore();
  }

  function maskRootCentre(ctx, root, count, interacting) {
    const radius = clamp(5.2 + count * 0.55, 7, 12.5);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const cover = ctx.createRadialGradient(root.centre.x, root.centre.y, 0, root.centre.x, root.centre.y, radius * 1.8);
    cover.addColorStop(0, interacting ? 'rgba(3,13,31,.38)' : 'rgba(3,13,31,.72)');
    cover.addColorStop(0.58, interacting ? 'rgba(3,13,31,.18)' : 'rgba(3,13,31,.44)');
    cover.addColorStop(1, 'rgba(3,13,31,0)');
    ctx.beginPath();
    ctx.arc(root.centre.x, root.centre.y, radius * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = cover;
    ctx.fill();
    ctx.restore();
  }

  function drawMasks(ctx, interacting) {
    for (const root of rootGroups(segments)) {
      const candidates = root.segments
        .filter((segment) => segment.length > 16)
        .sort((a, b) => b.length - a.length)
        .slice(0, 9);
      if (!candidates.length) continue;
      const baseWidth = clamp(4.8 + candidates.length * 0.28, 5.2, 7.2);
      candidates.forEach((segment, index) => {
        const width = baseWidth * (0.98 - Math.min(index, 6) * 0.028) * clamp(segment.length / 78, 0.88, 1.28);
        maskSegment(ctx, segment, width, interacting);
      });
      maskRootCentre(ctx, root, candidates.length, interacting);
    }
  }

  function drawFrame(timestamp) {
    frame = requestAnimationFrame(drawFrame);
    if (!layerContext || !layer || !sourceCanvas?.isConnected || document.hidden) return;
    const interacting = sourceCanvas.dataset.interacting === 'true';
    const frameMs = interacting ? INTERACTING_FRAME_MS : FRAME_MS;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;
    const rect = sourceCanvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
    layerContext.clearRect(0, 0, rect.width, rect.height);
    drawMasks(layerContext, interacting);
  }

  proto.beginPath = function neuralSpokeMaskBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralMaskStart = null;
      this.__memoryNeuralMaskEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralSpokeMaskMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralMaskStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralMaskEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralSpokeMaskLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralMaskStart) this.__memoryNeuralMaskEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralSpokeMaskClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralSpokeMaskStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  function loadSpokeBundle() {
    if (document.getElementById('memoryGraphNeuralSpokeBundleLoader') || globalThis.MemoryGraphNeuralSpokeBundle) return;
    const script = document.createElement('script');
    script.id = 'memoryGraphNeuralSpokeBundleLoader';
    script.src = './memory-graph-neural-spoke-bundle.js?v=1';
    script.async = false;
    script.addEventListener('load', () => globalThis.MemoryGraph?.redraw?.());
    document.head.appendChild(script);
  }

  if (!document.getElementById('memoryGraphNeuralSpokeMaskStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralSpokeMaskStyles';
    style.textContent = `
      .memory-graph-neural-spoke-mask-canvas {
        position:absolute;
        inset:0;
        z-index:3;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:normal;
        opacity:1;
      }
    `;
    document.head.appendChild(style);
  }

  loadSpokeBundle();
  globalThis.MemoryGraphNeuralSpokeMask = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
})();