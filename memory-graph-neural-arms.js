(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralArmsInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralArmsInstalled', { value: true });

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

  const FRAME_MS = 88;
  const INTERACTING_FRAME_MS = 176;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7829.381 + a * 101.219 + b * 241.637) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralArmStart || !ctx?.__memoryNeuralArmEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-arms-canvas';
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
    const start = ctx.__memoryNeuralArmStart;
    const end = ctx.__memoryNeuralArmEnd;
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

  function nexusPoint(roots) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const root of roots) {
      minX = Math.min(minX, root.centre.x);
      maxX = Math.max(maxX, root.centre.x);
      minY = Math.min(minY, root.centre.y);
      maxY = Math.max(maxY, root.centre.y);
    }
    return { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5 };
  }

  function controlPoints(from, to, seed, bendScale = 1, lane = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const side = hash(seed, lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.09 + hash(seed, lane, 2) * 0.10), 10, 86) * bendScale;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.16;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.28 + skew) + px * bend * 0.72, y: from.y + dy * (0.28 + skew) + py * bend * 0.72 },
      p2: { x: from.x + dx * (0.70 - skew) + px * bend, y: from.y + dy * (0.70 - skew) + py * bend },
      p3: to,
      length
    };
  }

  function pointOnCurve(curve, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: curve.p0.x * mt2 * mt + 3 * curve.p1.x * mt2 * t + 3 * curve.p2.x * mt * t2 + curve.p3.x * t2 * t,
      y: curve.p0.y * mt2 * mt + 3 * curve.p1.y * mt2 * t + 3 * curve.p2.y * mt * t2 + curve.p3.y * t2 * t
    };
  }

  function tangentOnCurve(curve, t) {
    const mt = 1 - t;
    const x = 3 * mt * mt * (curve.p1.x - curve.p0.x) + 6 * mt * t * (curve.p2.x - curve.p1.x) + 3 * t * t * (curve.p3.x - curve.p2.x);
    const y = 3 * mt * mt * (curve.p1.y - curve.p0.y) + 6 * mt * t * (curve.p2.y - curve.p1.y) + 3 * t * t * (curve.p3.y - curve.p2.y);
    const length = Math.max(0.001, Math.hypot(x, y));
    return { x: x / length, y: y / length };
  }

  function drawArm(ctx, curve, width, seed, interacting) {
    const detail = interacting ? 0.28 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);
    ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
    ctx.lineWidth = width * 2.7;
    ctx.strokeStyle = `rgba(28,51,142,${(0.12 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 10;
    ctx.shadowColor = `rgba(52,72,232,${(0.18 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);
    ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
    ctx.lineWidth = width * 1.45;
    ctx.strokeStyle = `rgba(65,98,229,${(0.20 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);
    ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
    ctx.lineWidth = Math.max(0.56, width * 0.19);
    ctx.strokeStyle = `rgba(124,205,255,${(0.35 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    if (interacting) return;

    const tangent = tangentOnCurve(curve, 0.96);
    const nx = -tangent.y;
    const ny = tangent.x;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let fork = 0; fork < 2; fork += 1) {
      const side = fork ? 1 : -1;
      const reach = width * (2.1 + hash(seed, fork, 31) * 2.4);
      const end = {
        x: curve.p3.x + tangent.x * reach * 0.55 + nx * side * reach,
        y: curve.p3.y + tangent.y * reach * 0.55 + ny * side * reach
      };
      ctx.beginPath();
      ctx.moveTo(curve.p3.x, curve.p3.y);
      ctx.quadraticCurveTo(
        curve.p3.x + tangent.x * reach * 0.34 + nx * side * reach * 0.38,
        curve.p3.y + tangent.y * reach * 0.34 + ny * side * reach * 0.38,
        end.x,
        end.y
      );
      ctx.lineWidth = 0.32;
      ctx.strokeStyle = 'rgba(137,211,255,.16)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawMajorArms(ctx, major, width, seed, interacting) {
    const armCount = interacting ? 1 : 3;
    for (let arm = 0; arm < armCount; arm += 1) {
      const local = seed + arm * 0.613;
      const t = 0.20 + arm * 0.22 + (hash(local, 1, 2) - 0.5) * 0.09;
      const origin = pointOnCurve(major, t);
      const tangent = tangentOnCurve(major, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = arm % 2 ? -1 : 1;
      const reach = width * (4.0 + hash(local, 3, 4) * 3.4);
      const forward = (hash(local, 5, 6) - 0.30) * reach * 0.72;
      const end = {
        x: origin.x + nx * side * reach + tangent.x * forward,
        y: origin.y + ny * side * reach + tangent.y * forward
      };
      const curve = controlPoints(origin, end, local, 0.38, arm + 21);
      const armWidth = width * (0.24 + hash(local, 7, 8) * 0.11) * (1 - arm * 0.08);
      drawArm(ctx, curve, armWidth, local, interacting);
    }
  }

  function drawSharedArms(ctx, roots, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      const major = controlPoints(nexus, root.centre, seed, 0.78, index + 1);
      const width = clamp(major.length * 0.055, 10, 20);
      drawMajorArms(ctx, major, width, seed + 0.39, interacting);
    });
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
    drawSharedArms(layerContext, rootGroups(segments), interacting);
  }

  proto.beginPath = function neuralArmsBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralArmStart = null;
      this.__memoryNeuralArmEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralArmsMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralArmStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralArmEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralArmsLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralArmStart) this.__memoryNeuralArmEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralArmsClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralArmsStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralArmsStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralArmsStyles';
    style.textContent = `
      .memory-graph-neural-arms-canvas {
        position:absolute;
        inset:0;
        z-index:2;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.72;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralArms = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();
