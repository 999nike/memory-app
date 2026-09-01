(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralCrownsInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralCrownsInstalled', { value: true });

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

  const FRAME_MS = 72;
  const INTERACTING_FRAME_MS = 144;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7613.219 + a * 83.171 + b * 229.417) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralCrownStart || !ctx?.__memoryNeuralCrownEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-crowns-canvas';
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
    const start = ctx.__memoryNeuralCrownStart;
    const end = ctx.__memoryNeuralCrownEnd;
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
    const bend = side * clamp(length * (0.07 + hash(seed, lane, 2) * 0.11), 5, 72) * bendScale;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.14;
    return {
      p0: from,
      p1: {
        x: from.x + dx * (0.27 + skew) + px * bend * 0.70,
        y: from.y + dy * (0.27 + skew) + py * bend * 0.70
      },
      p2: {
        x: from.x + dx * (0.72 - skew) + px * bend,
        y: from.y + dy * (0.72 - skew) + py * bend
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

  function traceCurve(ctx, curve) {
    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);
    ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
  }

  function drawSecondaryRoot(ctx, curve, width, seed, interacting) {
    const detail = interacting ? 0.42 : 1;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.globalCompositeOperation = 'source-over';
    traceCurve(ctx, curve);
    ctx.lineWidth = width * 2.5;
    ctx.strokeStyle = `rgba(30,55,150,${(0.11 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 9;
    ctx.shadowColor = `rgba(44,78,239,${(0.18 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    ctx.globalCompositeOperation = 'screen';
    traceCurve(ctx, curve);
    ctx.lineWidth = width * 1.55;
    ctx.strokeStyle = `rgba(56,103,235,${(0.18 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceCurve(ctx, curve);
    ctx.lineWidth = Math.max(0.85, width * 0.28);
    ctx.strokeStyle = `rgba(105,200,255,${(0.42 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceCurve(ctx, curve);
    ctx.lineWidth = Math.max(0.34, width * 0.075);
    ctx.strokeStyle = `rgba(228,249,255,${(0.75 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    if (interacting) return;

    const knotCount = curve.length > 80 ? 2 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < knotCount; index += 1) {
      const t = 0.44 + index * 0.27 + (hash(seed, index, 11) - 0.5) * 0.10;
      const p = pointOnCurve(curve, clamp(t, 0.25, 0.86));
      const r = 0.52 + hash(seed, index, 12) * 0.62;
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4.5);
      glow.addColorStop(0, 'rgba(238,253,255,.72)');
      glow.addColorStop(0.28, 'rgba(104,210,255,.30)');
      glow.addColorStop(1, 'rgba(70,89,255,0)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 4.5, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCrownWeb(ctx, curves, root, width, seed, interacting) {
    if (interacting || curves.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';

    for (let index = 0; index < curves.length; index += 1) {
      const a = curves[index];
      const b = curves[(index + 1) % curves.length];
      const tA = 0.38 + hash(seed, index, 21) * 0.28;
      const tB = 0.34 + hash(seed, index, 22) * 0.30;
      const pA = pointOnCurve(a, tA);
      const pB = pointOnCurve(b, tB);
      if (distance(pA, pB) > width * 10.5) continue;
      const tangentA = tangentOnCurve(a, tA);
      const tangentB = tangentOnCurve(b, tB);
      const bend = {
        x: (pA.x + pB.x) * 0.5 + (tangentA.x - tangentB.x) * width * 1.4,
        y: (pA.y + pB.y) * 0.5 + (tangentA.y - tangentB.y) * width * 1.4
      };
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.quadraticCurveTo(bend.x, bend.y, pB.x, pB.y);
      ctx.lineWidth = 0.28;
      ctx.strokeStyle = 'rgba(122,205,255,.13)';
      previousStroke.call(ctx);
    }

    const ringRadius = clamp(width * (2.2 + curves.length * 0.18), 16, 34);
    for (let ring = 0; ring < 2; ring += 1) {
      const points = 13 + ring * 5;
      ctx.beginPath();
      for (let index = 0; index <= points; index += 1) {
        const angle = (index / points) * Math.PI * 2 + hash(seed, ring, 30) * 0.7;
        const wobble = 0.82 + Math.sin(angle * (3 + ring) + seed * 7.7) * 0.12;
        const r = ringRadius * (0.58 + ring * 0.34) * wobble;
        const x = root.centre.x + Math.cos(angle) * r;
        const y = root.centre.y + Math.sin(angle) * r;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = ring ? 0.30 : 0.42;
      ctx.strokeStyle = ring ? 'rgba(116,194,255,.10)' : 'rgba(158,222,255,.15)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootCrown(ctx, root, rootIndex, interacting) {
    const candidates = root.segments
      .filter((segment) => segment.length > 18)
      .sort((a, b) => b.length - a.length)
      .slice(0, 8);
    if (!candidates.length) return;

    const seed = Math.abs(Math.sin(root.centre.x * 0.021 + root.centre.y * 0.017 + rootIndex * 0.713));
    const crownWidth = clamp(3.8 + candidates.length * 0.28, 4.0, 6.2);
    const curves = candidates.map((segment, index) => {
      const curveSeed = seed + segment.seed * 0.83 + index * 0.391;
      return controlPoints(root.centre, segment.to, curveSeed, 0.52, index + 5);
    });

    curves.forEach((curve, index) => {
      const taperWidth = crownWidth * (0.92 - Math.min(index, 5) * 0.045);
      drawSecondaryRoot(ctx, curve, taperWidth, seed + index * 0.577, interacting);
    });
    drawCrownWeb(ctx, curves, root, crownWidth, seed, interacting);
  }

  function traceSampled(ctx, points) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function drawTrunkVeins(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    const sampleCount = 24;
    const lanes = [-0.34, -0.11, 0.16, 0.37];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const sampledLanes = lanes.map((lane, laneIndex) => {
      const points = [];
      for (let index = 0; index <= sampleCount; index += 1) {
        const t = index / sampleCount;
        const p = pointOnCurve(curve, t);
        const tangent = tangentOnCurve(curve, t);
        const nx = -tangent.y;
        const ny = tangent.x;
        const window = Math.sin(Math.PI * t);
        const wander = Math.sin(t * Math.PI * (2.1 + laneIndex * 0.47) + seed * 17.3 + laneIndex) * 0.11;
        const offset = width * window * (lane + wander);
        points.push({ x: p.x + nx * offset, y: p.y + ny * offset });
      }
      traceSampled(ctx, points);
      ctx.lineWidth = laneIndex % 2 ? 0.30 : 0.42;
      ctx.strokeStyle = laneIndex % 2 ? 'rgba(118,196,255,.105)' : 'rgba(167,221,255,.14)';
      previousStroke.call(ctx);
      return points;
    });

    for (let rib = 2; rib < sampleCount - 2; rib += 3) {
      const laneA = rib % 2 === 0 ? 0 : 1;
      const laneB = rib % 2 === 0 ? 3 : 2;
      const a = sampledLanes[laneA][rib];
      const b = sampledLanes[laneB][rib + (rib % 3 === 0 ? 1 : 0)];
      const mid = {
        x: (a.x + b.x) * 0.5 + (hash(seed, rib, 44) - 0.5) * width * 0.55,
        y: (a.y + b.y) * 0.5 + (hash(seed, rib, 45) - 0.5) * width * 0.55
      };
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
      ctx.lineWidth = 0.23;
      ctx.strokeStyle = 'rgba(137,207,255,.095)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawSharedCrowns(ctx, roots, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);

    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      const major = controlPoints(nexus, root.centre, seed, 0.78, index + 1);
      const majorWidth = clamp(major.length * 0.055, 10, 20);
      drawTrunkVeins(ctx, major, majorWidth, seed + 0.47, interacting);
      drawRootCrown(ctx, root, index, interacting);
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
    drawSharedCrowns(layerContext, rootGroups(segments), interacting);
  }

  proto.beginPath = function neuralCrownsBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralCrownStart = null;
      this.__memoryNeuralCrownEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralCrownsMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralCrownStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralCrownEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralCrownsLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralCrownStart) {
      this.__memoryNeuralCrownEnd = { x: Number(x), y: Number(y) };
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralCrownsClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralCrownsStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralCrownsStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralCrownsStyles';
    style.textContent = `
      .memory-graph-neural-crowns-canvas {
        position:absolute;
        inset:0;
        z-index:3;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.82;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralCrowns = Object.freeze({
    version: VERSION,
    redraw() { lastPaint = 0; }
  });

  globalThis.MemoryGraph?.redraw?.();
})();
