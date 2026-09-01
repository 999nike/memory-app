(() => {
  'use strict';

  const VERSION = 2;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralNexusInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralNexusInstalled', { value: true });

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

  const FRAME_MS = 42;
  const INTERACTING_FRAME_MS = 84;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7127.913 + a * 79.117 + b * 193.731) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNexusStart || !ctx?.__memoryNexusEnd) return false;
    const style = String(ctx.strokeStyle || '');
    return style.includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;

    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-nexus-canvas';
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
    const start = ctx.__memoryNexusStart;
    const end = ctx.__memoryNexusEnd;
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
    segments.push({
      ...points,
      length: distance(points.from, points.to),
      seed: Math.abs(Math.sin(points.from.x * 0.019 + points.from.y * 0.023 + points.to.x * 0.013 + points.to.y * 0.031))
    });
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
      p1: {
        x: from.x + dx * (0.28 + skew) + px * bend * 0.72,
        y: from.y + dy * (0.28 + skew) + py * bend * 0.72
      },
      p2: {
        x: from.x + dx * (0.70 - skew) + px * bend,
        y: from.y + dy * (0.70 - skew) + py * bend
      },
      p3: to,
      length,
      seed
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
    const x = 3 * mt * mt * (curve.p1.x - curve.p0.x)
      + 6 * mt * t * (curve.p2.x - curve.p1.x)
      + 3 * t * t * (curve.p3.x - curve.p2.x);
    const y = 3 * mt * mt * (curve.p1.y - curve.p0.y)
      + 6 * mt * t * (curve.p2.y - curve.p1.y)
      + 3 * t * t * (curve.p3.y - curve.p2.y);
    const length = Math.max(0.001, Math.hypot(x, y));
    return { x: x / length, y: y / length };
  }

  function strokeCurve(ctx, curve, width, colour) {
    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);
    ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    previousStroke.call(ctx);
  }

  function organicTubePoints(curve, width, seed, interacting) {
    const sampleCount = interacting ? 18 : 34;
    const left = [];
    const right = [];
    const phaseLeftA = hash(seed, 4, 1) * Math.PI * 2;
    const phaseLeftB = hash(seed, 5, 2) * Math.PI * 2;
    const phaseRightA = hash(seed, 6, 3) * Math.PI * 2;
    const phaseRightB = hash(seed, 7, 4) * Math.PI * 2;
    const leftFrequency = 4.4 + hash(seed, 8, 5) * 2.6;
    const rightFrequency = 4.8 + hash(seed, 9, 6) * 2.8;

    for (let index = 0; index <= sampleCount; index += 1) {
      const t = index / sampleCount;
      const point = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const edgeWindow = Math.pow(Math.sin(Math.PI * t), 0.72);
      const nexusSwell = 0.22 * Math.exp(-Math.pow((t - 0.13) / 0.18, 2));
      const taper = 0.66 + (1 - t) * 0.50 + Math.sin(Math.PI * t) * 0.08 + nexusSwell;
      const baseHalfWidth = width * 0.70 * taper;

      const leftRipple = edgeWindow * (
        Math.sin(t * Math.PI * leftFrequency + phaseLeftA) * 0.105
        + Math.sin(t * Math.PI * (leftFrequency * 2.15) + phaseLeftB) * 0.040
      );
      const rightRipple = edgeWindow * (
        Math.sin(t * Math.PI * rightFrequency + phaseRightA) * 0.115
        + Math.sin(t * Math.PI * (rightFrequency * 1.92) + phaseRightB) * 0.044
      );

      const leftWidth = baseHalfWidth * (1 + leftRipple);
      const rightWidth = baseHalfWidth * (1 + rightRipple);
      left.push({ x: point.x + nx * leftWidth, y: point.y + ny * leftWidth });
      right.push({ x: point.x - nx * rightWidth, y: point.y - ny * rightWidth });
    }

    return { left, right };
  }

  function traceClosedTube(ctx, tube) {
    const { left, right } = tube;
    if (!left.length || !right.length) return;
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let index = 1; index < left.length; index += 1) ctx.lineTo(left[index].x, left[index].y);
    for (let index = right.length - 1; index >= 0; index -= 1) ctx.lineTo(right[index].x, right[index].y);
    ctx.closePath();
  }

  function traceBoundary(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  }

  function drawOrganicTube(ctx, curve, width, seed, interacting) {
    const tube = organicTubePoints(curve, width, seed, interacting);
    const detail = interacting ? 0.66 : 1;

    // Layer 1: soft body halo. Kept broad and dim so the trunk reads as tissue, not a neon cable.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceClosedTube(ctx, tube);
    ctx.shadowBlur = interacting ? 3 : 12;
    ctx.shadowColor = `rgba(47,82,255,${(0.22 * detail).toFixed(3)})`;
    ctx.fillStyle = `rgba(25,64,170,${(0.13 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    // Layer 2: translucent blue/violet inner tissue.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceClosedTube(ctx, tube);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(92,78,255,${(0.27 * detail).toFixed(3)})`);
    tissue.addColorStop(0.42, `rgba(43,119,255,${(0.24 * detail).toFixed(3)})`);
    tissue.addColorStop(0.72, `rgba(52,160,255,${(0.20 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(35,105,224,${(0.14 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();
    ctx.restore();

    // Layer 3: two independent irregular membranes. These are the root walls, not parallel light rails.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = interacting ? 1 : 4;
    ctx.shadowColor = `rgba(92,151,255,${(0.28 * detail).toFixed(3)})`;

    traceBoundary(ctx, tube.left);
    ctx.lineWidth = Math.max(1.5, width * 0.16);
    ctx.strokeStyle = `rgba(96,132,255,${(0.30 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceBoundary(ctx, tube.left);
    ctx.lineWidth = Math.max(0.62, width * 0.055);
    ctx.strokeStyle = `rgba(170,221,255,${(0.58 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceBoundary(ctx, tube.right);
    ctx.lineWidth = Math.max(1.5, width * 0.16);
    ctx.strokeStyle = `rgba(88,107,245,${(0.28 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceBoundary(ctx, tube.right);
    ctx.lineWidth = Math.max(0.62, width * 0.055);
    ctx.strokeStyle = `rgba(132,205,255,${(0.54 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    // Layer 4: one narrow internal neural spine with only a restrained glow beneath it.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    strokeCurve(ctx, curve, Math.max(1.2, width * 0.11), `rgba(63,175,255,${(0.28 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, Math.max(0.48, width * 0.038), `rgba(225,249,255,${(0.88 * detail).toFixed(3)})`);
    ctx.restore();
  }

  function traceOrganicNexus(ctx, point, radius, seed) {
    const count = 30;
    ctx.beginPath();
    for (let index = 0; index <= count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const shape = 0.90
        + Math.sin(angle * 3 + seed * 7.1) * 0.070
        + Math.sin(angle * 7 + seed * 13.7) * 0.035
        + Math.sin(angle * 11 + seed * 19.3) * 0.018;
      const x = point.x + Math.cos(angle) * radius * shape;
      const y = point.y + Math.sin(angle) * radius * shape;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawNexus(ctx, point, rootCount, timestamp, interacting) {
    const pulse = 0.96 + Math.sin(timestamp * 0.00125) * 0.035;
    const radius = clamp(24 + rootCount * 3.2, 30, 46);
    const seed = rootCount * 0.173 + point.x * 0.0007 + point.y * 0.0009;
    const detail = interacting ? 0.65 : 1;

    // Base soma: a low-contrast irregular body that covers the hard convergence point.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceOrganicNexus(ctx, point, radius * pulse, seed);
    ctx.shadowBlur = interacting ? 4 : 16;
    ctx.shadowColor = `rgba(54,83,255,${(0.24 * detail).toFixed(3)})`;
    const body = ctx.createRadialGradient(point.x, point.y, radius * 0.08, point.x, point.y, radius);
    body.addColorStop(0, `rgba(96,130,255,${(0.31 * detail).toFixed(3)})`);
    body.addColorStop(0.45, `rgba(55,99,235,${(0.25 * detail).toFixed(3)})`);
    body.addColorStop(0.78, `rgba(56,70,205,${(0.17 * detail).toFixed(3)})`);
    body.addColorStop(1, `rgba(31,54,154,${(0.06 * detail).toFixed(3)})`);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    // Soma membrane and a quiet internal nucleus. No starburst rays in this anatomy pass.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceOrganicNexus(ctx, point, radius * pulse, seed);
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = `rgba(126,190,255,${(0.40 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 1 : 5;
    ctx.shadowColor = `rgba(80,154,255,${(0.25 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    const nucleusRadius = radius * 0.34;
    const nucleus = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, nucleusRadius);
    nucleus.addColorStop(0, `rgba(222,248,255,${(0.46 * detail).toFixed(3)})`);
    nucleus.addColorStop(0.42, `rgba(94,190,255,${(0.24 * detail).toFixed(3)})`);
    nucleus.addColorStop(1, 'rgba(64,88,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, nucleusRadius, 0, Math.PI * 2);
    ctx.fillStyle = nucleus;
    ctx.fill();
    ctx.restore();
  }

  function drawSharedNetwork(ctx, roots, timestamp, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);

    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      const curve = controlPoints(nexus, root.centre, seed, 0.78, index + 1);
      const width = clamp(curve.length * 0.055, 10, 20);
      drawOrganicTube(ctx, curve, width, seed, interacting);
    });

    // Paint the soma last so the trunks visually fuse into one body instead of meeting at a sharp star point.
    drawNexus(ctx, nexus, roots.length, timestamp, interacting);
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
    drawSharedNetwork(layerContext, rootGroups(segments), timestamp, interacting);
  }

  proto.beginPath = function neuralNexusBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNexusStart = null;
      this.__memoryNexusEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralNexusMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNexusStart = { x: Number(x), y: Number(y) };
      this.__memoryNexusEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralNexusLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNexusStart) {
      this.__memoryNexusEnd = { x: Number(x), y: Number(y) };
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralNexusClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralNexusStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) {
      capture(this);
    }
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralNexusStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralNexusStyles';
    style.textContent = `
      .memory-graph-neural-nexus-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.98;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralNexus = Object.freeze({
    version: VERSION,
    rootCount: () => rootGroups(segments).length,
    segmentCount: () => segments.length,
    redraw() { lastPaint = 0; }
  });

  globalThis.MemoryGraph?.redraw?.();
})();
