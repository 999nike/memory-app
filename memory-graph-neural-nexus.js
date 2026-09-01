(() => {
  'use strict';

  const VERSION = 3;
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
    const sampleCount = interacting ? 22 : 44;
    const left = [];
    const right = [];
    const centre = [];
    const phaseCentre = hash(seed, 2, 7) * Math.PI * 2;
    const phaseLeftA = hash(seed, 4, 1) * Math.PI * 2;
    const phaseLeftB = hash(seed, 5, 2) * Math.PI * 2;
    const phaseRightA = hash(seed, 6, 3) * Math.PI * 2;
    const phaseRightB = hash(seed, 7, 4) * Math.PI * 2;
    const leftFrequency = 3.1 + hash(seed, 8, 5) * 2.2;
    const rightFrequency = 3.4 + hash(seed, 9, 6) * 2.4;

    for (let index = 0; index <= sampleCount; index += 1) {
      const t = index / sampleCount;
      const point = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const edgeWindow = Math.pow(Math.sin(Math.PI * t), 0.58);

      // Broad shoulder at the soma, a quieter middle, then a small distal collar into the app root.
      const nexusSwell = 0.56 * Math.exp(-Math.pow((t - 0.09) / 0.20, 2));
      const distalSwell = 0.17 * Math.exp(-Math.pow((t - 0.89) / 0.15, 2));
      const rhythm = edgeWindow * Math.sin(t * Math.PI * 1.55 + phaseCentre) * 0.055;
      const taper = 0.60 + (1 - t) * 0.40 + nexusSwell + distalSwell + rhythm;
      const baseHalfWidth = width * 0.72 * taper;

      // The tissue body itself wanders slightly so the two walls do not describe a perfect pipe.
      const centreDrift = width * edgeWindow * (
        Math.sin(t * Math.PI * 2.15 + phaseCentre) * 0.085
        + Math.sin(t * Math.PI * 5.35 + phaseCentre * 0.73) * 0.030
      );
      const cx = point.x + nx * centreDrift;
      const cy = point.y + ny * centreDrift;

      const leftRipple = edgeWindow * (
        Math.sin(t * Math.PI * leftFrequency + phaseLeftA) * 0.170
        + Math.sin(t * Math.PI * (leftFrequency * 2.35) + phaseLeftB) * 0.060
        + Math.sin(t * Math.PI * 0.92 + phaseLeftB * 0.55) * 0.055
      );
      const rightRipple = edgeWindow * (
        Math.sin(t * Math.PI * rightFrequency + phaseRightA) * 0.180
        + Math.sin(t * Math.PI * (rightFrequency * 2.08) + phaseRightB) * 0.064
        + Math.sin(t * Math.PI * 1.07 + phaseRightA * 0.61) * 0.050
      );

      const leftWidth = baseHalfWidth * (1 + leftRipple);
      const rightWidth = baseHalfWidth * (1 + rightRipple);
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * leftWidth, y: cy + ny * leftWidth });
      right.push({ x: cx - nx * rightWidth, y: cy - ny * rightWidth });
    }

    return { left, right, centre };
  }

  function traceSmoothOpen(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) return;
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midX = (current.x + next.x) * 0.5;
      const midY = (current.y + next.y) * 0.5;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function traceClosedTube(ctx, tube) {
    const points = [...tube.left, ...tube.right.slice().reverse()];
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index <= points.length; index += 1) {
      const current = points[index % points.length];
      const next = points[(index + 1) % points.length];
      const midX = (current.x + next.x) * 0.5;
      const midY = (current.y + next.y) * 0.5;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }
    ctx.closePath();
  }

  function drawOrganicTube(ctx, curve, width, seed, interacting) {
    const tube = organicTubePoints(curve, width, seed, interacting);
    const detail = interacting ? 0.66 : 1;

    // Layer 1: broad tissue body. Stronger near-body depth, but no neon outer cable.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceClosedTube(ctx, tube);
    ctx.shadowBlur = interacting ? 4 : 15;
    ctx.shadowColor = `rgba(48,74,246,${(0.26 * detail).toFixed(3)})`;
    ctx.fillStyle = `rgba(24,55,154,${(0.17 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    // Layer 2: translucent blue/violet tissue inside the root body.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceClosedTube(ctx, tube);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(108,73,255,${(0.34 * detail).toFixed(3)})`);
    tissue.addColorStop(0.24, `rgba(67,91,255,${(0.29 * detail).toFixed(3)})`);
    tissue.addColorStop(0.55, `rgba(39,121,247,${(0.25 * detail).toFixed(3)})`);
    tissue.addColorStop(0.82, `rgba(45,151,255,${(0.22 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(44,112,226,${(0.18 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();
    ctx.restore();

    // Layer 3: subdued independent membranes. Their job is to imply living walls, not draw rails.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowBlur = interacting ? 1 : 3;
    ctx.shadowColor = `rgba(86,145,255,${(0.18 * detail).toFixed(3)})`;

    traceSmoothOpen(ctx, tube.left);
    ctx.lineWidth = Math.max(1.0, width * 0.10);
    ctx.strokeStyle = `rgba(100,135,255,${(0.20 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmoothOpen(ctx, tube.left);
    ctx.lineWidth = Math.max(0.42, width * 0.032);
    ctx.strokeStyle = `rgba(164,216,255,${(0.38 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceSmoothOpen(ctx, tube.right);
    ctx.lineWidth = Math.max(1.0, width * 0.10);
    ctx.strokeStyle = `rgba(89,109,241,${(0.19 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmoothOpen(ctx, tube.right);
    ctx.lineWidth = Math.max(0.42, width * 0.032);
    ctx.strokeStyle = `rgba(134,201,255,${(0.35 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    // Layer 4: one narrow internal spine following the living centre of the tissue body.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    traceSmoothOpen(ctx, tube.centre);
    ctx.lineWidth = Math.max(1.0, width * 0.085);
    ctx.strokeStyle = `rgba(58,164,255,${(0.24 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmoothOpen(ctx, tube.centre);
    ctx.lineWidth = Math.max(0.42, width * 0.032);
    ctx.strokeStyle = `rgba(226,248,255,${(0.80 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();
  }

  function angleDelta(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  function nexusRootLobe(angle, point, roots) {
    let influence = 0;
    for (const root of roots) {
      const rootAngle = Math.atan2(root.centre.y - point.y, root.centre.x - point.x);
      const alignment = Math.max(0, Math.cos(angleDelta(angle, rootAngle)));
      influence = Math.max(influence, Math.pow(alignment, 6) * 0.42);
    }
    return influence;
  }

  function traceOrganicNexus(ctx, point, radius, seed, roots, scale = 1) {
    const count = 64;
    ctx.beginPath();
    for (let index = 0; index <= count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const lobe = nexusRootLobe(angle, point, roots);
      const shape = 0.89
        + lobe
        + Math.sin(angle * 2 + seed * 5.3) * 0.045
        + Math.sin(angle * 5 + seed * 11.1) * 0.055
        + Math.sin(angle * 9 + seed * 17.7) * 0.026
        + Math.sin(angle * 13 + seed * 23.9) * 0.013;
      const x = point.x + Math.cos(angle) * radius * shape * scale;
      const y = point.y + Math.sin(angle) * radius * shape * scale;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawNexus(ctx, point, roots, timestamp, interacting) {
    const rootCount = roots.length;
    const pulse = 0.985 + Math.sin(timestamp * 0.00115) * 0.020;
    const radius = clamp(34 + rootCount * 5.0, 48, 68);
    const seed = rootCount * 0.173 + point.x * 0.0007 + point.y * 0.0009;
    const detail = interacting ? 0.65 : 1;

    // Outer soma: broad irregular living mass with lobes that reach into each major trunk direction.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceOrganicNexus(ctx, point, radius * pulse, seed, roots);
    ctx.shadowBlur = interacting ? 6 : 22;
    ctx.shadowColor = `rgba(52,72,235,${(0.31 * detail).toFixed(3)})`;
    const body = ctx.createRadialGradient(point.x, point.y, radius * 0.05, point.x, point.y, radius * 1.15);
    body.addColorStop(0, `rgba(91,108,239,${(0.34 * detail).toFixed(3)})`);
    body.addColorStop(0.34, `rgba(70,82,226,${(0.31 * detail).toFixed(3)})`);
    body.addColorStop(0.68, `rgba(57,67,199,${(0.24 * detail).toFixed(3)})`);
    body.addColorStop(1, `rgba(29,46,133,${(0.08 * detail).toFixed(3)})`);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    // Inner tissue mass adds depth without turning the soma into a bright outlined badge.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceOrganicNexus(ctx, point, radius * pulse, seed + 0.371, roots, 0.77);
    const tissue = ctx.createRadialGradient(point.x - radius * 0.10, point.y - radius * 0.08, 0, point.x, point.y, radius * 0.82);
    tissue.addColorStop(0, `rgba(117,102,255,${(0.30 * detail).toFixed(3)})`);
    tissue.addColorStop(0.42, `rgba(56,132,255,${(0.25 * detail).toFixed(3)})`);
    tissue.addColorStop(0.78, `rgba(45,96,227,${(0.18 * detail).toFixed(3)})`);
    tissue.addColorStop(1, 'rgba(55,70,214,0)');
    ctx.fillStyle = tissue;
    ctx.fill();
    ctx.restore();

    // A subdued membrane and quiet nucleus. The root lobes hide the old crisp Y intersection.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceOrganicNexus(ctx, point, radius * pulse, seed, roots);
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = `rgba(130,184,255,${(0.24 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 1 : 4;
    ctx.shadowColor = `rgba(79,139,255,${(0.17 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    const nucleusRadius = radius * 0.27;
    const nucleus = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, nucleusRadius);
    nucleus.addColorStop(0, `rgba(222,246,255,${(0.38 * detail).toFixed(3)})`);
    nucleus.addColorStop(0.40, `rgba(102,184,255,${(0.21 * detail).toFixed(3)})`);
    nucleus.addColorStop(1, 'rgba(65,83,244,0)');
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

    // Paint the soma last so its broad root-facing lobes fuse over the individual trunk starts.
    drawNexus(ctx, nexus, roots, timestamp, interacting);
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
