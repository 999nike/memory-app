(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralLatticeInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralLatticeInstalled', { value: true });

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

  const FRAME_MS = 92;
  const INTERACTING_FRAME_MS = 190;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 8461.731 + a * 109.471 + b * 281.963) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralLatticeStart || !ctx?.__memoryNeuralLatticeEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-lattice-canvas';
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
    const start = ctx.__memoryNeuralLatticeStart;
    const end = ctx.__memoryNeuralLatticeEnd;
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

  function controlPoints(from, to, seed, lane = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const side = hash(seed, lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.07 + hash(seed, lane, 2) * 0.10), 8, 76);
    const skew = (hash(seed, lane, 3) - 0.5) * 0.12;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.30 + skew) + px * bend * 0.68, y: from.y + dy * (0.30 + skew) + py * bend * 0.68 },
      p2: { x: from.x + dx * (0.71 - skew) + px * bend, y: from.y + dy * (0.71 - skew) + py * bend },
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

  function drawTrunkLattice(ctx, curve, width, seed, interacting) {
    const count = interacting ? 7 : 20;
    let previousLeft = null;
    let previousRight = null;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 0; index < count; index += 1) {
      const local = seed + index * 0.313;
      const t = 0.04 + (index / Math.max(1, count - 1)) * 0.92;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const window = Math.sin(Math.PI * t);
      const leftReach = width * (1.15 + hash(local, 10, 11) * 2.35) * (0.74 + window * 0.26);
      const rightReach = width * (1.10 + hash(local, 12, 13) * 2.45) * (0.74 + window * 0.26);
      const along = width * (hash(local, 14, 15) - 0.5) * 1.7;
      const left = { x: p.x + nx * leftReach + tangent.x * along, y: p.y + ny * leftReach + tangent.y * along };
      const right = { x: p.x - nx * rightReach - tangent.x * along * 0.72, y: p.y - ny * rightReach - tangent.y * along * 0.72 };

      if (previousLeft && previousRight) {
        const bend = width * (hash(local, 16, 17) - 0.5) * 1.5;
        ctx.beginPath();
        ctx.moveTo(previousLeft.x, previousLeft.y);
        ctx.quadraticCurveTo((previousLeft.x + left.x) * 0.5 + nx * bend, (previousLeft.y + left.y) * 0.5 + ny * bend, left.x, left.y);
        ctx.lineWidth = 0.18 + hash(local, 18, 19) * 0.18;
        ctx.strokeStyle = interacting ? 'rgba(92,165,255,.035)' : 'rgba(98,182,255,.095)';
        previousStroke.call(ctx);

        ctx.beginPath();
        ctx.moveTo(previousRight.x, previousRight.y);
        ctx.quadraticCurveTo((previousRight.x + right.x) * 0.5 - nx * bend * 0.8, (previousRight.y + right.y) * 0.5 - ny * bend * 0.8, right.x, right.y);
        ctx.lineWidth = 0.18 + hash(local, 20, 21) * 0.16;
        ctx.strokeStyle = interacting ? 'rgba(83,148,238,.03)' : 'rgba(87,159,242,.082)';
        previousStroke.call(ctx);

        if (!interacting && index % 2 === 0) {
          const a = index % 4 === 0 ? previousLeft : previousRight;
          const b = index % 4 === 0 ? right : left;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.quadraticCurveTo(p.x + tangent.x * along * 0.4, p.y + tangent.y * along * 0.4, b.x, b.y);
          ctx.lineWidth = 0.15;
          ctx.strokeStyle = 'rgba(133,204,255,.068)';
          previousStroke.call(ctx);
        }
      }

      if (!interacting && index % 3 === 1) {
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.quadraticCurveTo(p.x + tangent.x * along * 0.35, p.y + tangent.y * along * 0.35, right.x, right.y);
        ctx.lineWidth = 0.16;
        ctx.strokeStyle = 'rgba(148,212,255,.072)';
        previousStroke.call(ctx);
      }

      if (!interacting && index % 4 === 2) {
        const knot = hash(local, 22, 23) > 0.5 ? left : right;
        ctx.beginPath();
        ctx.arc(knot.x, knot.y, 0.65 + hash(local, 24, 25) * 0.68, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(191,232,255,.19)';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(79,176,255,.28)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      previousLeft = left;
      previousRight = right;
    }
    ctx.restore();
  }

  function drawNexusMesh(ctx, nexus, roots, seed, interacting) {
    if (interacting) return;
    const averageDistance = roots.reduce((sum, root) => sum + distance(nexus, root.centre), 0) / Math.max(1, roots.length);
    const radius = clamp(averageDistance * 0.10, 50, 94);
    const count = 36;
    const points = [];

    for (let index = 0; index < count; index += 1) {
      const local = seed + index * 0.173;
      const angle = (index / count) * Math.PI * 2 + (hash(local, 30, 31) - 0.5) * 0.20;
      const r = radius * (0.48 + hash(local, 32, 33) * 0.72);
      points.push({ x: nexus.x + Math.cos(angle) * r, y: nexus.y + Math.sin(angle) * r });
    }

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';

    for (let index = 0; index < count; index += 1) {
      const local = seed + index * 0.283;
      const a = points[index];
      const b = points[(index + 1) % count];
      const c = points[(index + 5 + (index % 4)) % count];

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x + nexus.x) / 3, (a.y + b.y + nexus.y) / 3, b.x, b.y);
      ctx.lineWidth = 0.18 + hash(local, 34, 35) * 0.17;
      ctx.strokeStyle = 'rgba(103,190,255,.095)';
      previousStroke.call(ctx);

      if (index % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(nexus.x + (hash(local, 36, 37) - 0.5) * radius * 0.44, nexus.y + (hash(local, 38, 39) - 0.5) * radius * 0.44, c.x, c.y);
        ctx.lineWidth = 0.15;
        ctx.strokeStyle = 'rgba(128,202,255,.066)';
        previousStroke.call(ctx);
      }

      if (index % 6 === 1) {
        ctx.beginPath();
        ctx.arc(a.x, a.y, 0.75 + hash(local, 40, 41) * 0.68, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(196,235,255,.18)';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(72,170,255,.28)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
  }

  function drawSharedLattice(ctx, roots, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.019 + root.centre.y * 0.031 + index * 0.719));
      const curve = controlPoints(nexus, root.centre, seed, index + 1);
      const width = clamp(curve.length * 0.055, 10, 20);
      drawTrunkLattice(ctx, curve, width, seed + 0.27, interacting);
    });
    drawNexusMesh(ctx, nexus, roots, roots.length * 0.41 + nexus.x * 0.0013 + nexus.y * 0.0019, interacting);
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
    drawSharedLattice(layerContext, rootGroups(segments), interacting);
  }

  proto.beginPath = function neuralLatticeBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralLatticeStart = null;
      this.__memoryNeuralLatticeEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralLatticeMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralLatticeStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralLatticeEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralLatticeLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralLatticeStart) this.__memoryNeuralLatticeEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralLatticeClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralLatticeStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralLatticeStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralLatticeStyles';
    style.textContent = `
      .memory-graph-neural-lattice-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.76;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralLattice = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();
