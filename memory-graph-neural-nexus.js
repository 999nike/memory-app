(() => {
  'use strict';

  const VERSION = 1;
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

  function drawTube(ctx, curve, width, interacting) {
    const detail = interacting ? 0.52 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    strokeCurve(ctx, curve, width * 5.6, `rgba(11,55,205,${(0.050 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, width * 3.4, `rgba(25,105,255,${(0.105 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, width * 1.8, `rgba(45,157,255,${(0.23 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, Math.max(1, width * 0.48), `rgba(107,220,255,${(0.62 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, Math.max(0.45, width * 0.11), `rgba(245,254,255,${(0.94 * detail).toFixed(3)})`);
    ctx.restore();
  }

  function drawBundle(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let lane = 1; lane <= 9; lane += 1) {
      const filament = controlPoints(curve.p0, curve.p3, seed + lane * 0.491, 0.26 + lane * 0.065, lane + 11);
      strokeCurve(ctx, filament, Math.max(0.55, width * (0.16 - lane * 0.009)), `rgba(111,220,255,${(0.43 - lane * 0.025).toFixed(3)})`);
      strokeCurve(ctx, filament, Math.max(0.22, width * 0.034), `rgba(241,253,255,${(0.70 - lane * 0.035).toFixed(3)})`);
    }
    ctx.restore();
  }

  function drawDendrites(ctx, curve, seed, interacting) {
    if (interacting) return;
    const mobile = sourceCanvas?.clientWidth < 700;
    const count = clamp(Math.round(curve.length / (mobile ? 23 : 14)), mobile ? 8 : 14, mobile ? 16 : 30);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let index = 0; index < count; index += 1) {
      const localSeed = seed + index * 0.337;
      const t = 0.08 + ((index + 0.45 + hash(localSeed, 1, 2) * 0.45) / (count + 1)) * 0.84;
      const origin = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const px = -tangent.y;
      const py = tangent.x;
      const side = hash(localSeed, 3, 4) > 0.5 ? 1 : -1;
      const reach = 18 + hash(localSeed, 5, 6) * (mobile ? 36 : 72);
      const forward = (hash(localSeed, 7, 8) - 0.38) * reach * 0.72;
      const mid = {
        x: origin.x + px * side * reach * 0.55 + tangent.x * forward * 0.36,
        y: origin.y + py * side * reach * 0.55 + tangent.y * forward * 0.36
      };
      const end = {
        x: origin.x + px * side * reach + tangent.x * forward,
        y: origin.y + py * side * reach + tangent.y * forward
      };

      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = 0.62;
      ctx.strokeStyle = 'rgba(139,220,255,.38)';
      previousStroke.call(ctx);

      if (hash(localSeed, 9, 10) > 0.28) {
        const forkSide = hash(localSeed, 11, 12) > 0.5 ? 1 : -1;
        const fork = {
          x: mid.x + px * forkSide * reach * 0.48 + tangent.x * reach * 0.18,
          y: mid.y + py * forkSide * reach * 0.48 + tangent.y * reach * 0.18
        };
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.quadraticCurveTo((mid.x + fork.x) * 0.5, (mid.y + fork.y) * 0.5, fork.x, fork.y);
        ctx.lineWidth = 0.32;
        ctx.strokeStyle = 'rgba(202,242,255,.28)';
        previousStroke.call(ctx);
      }
    }
    ctx.restore();
  }

  function drawFibreLights(ctx, curve, seed, timestamp, interacting) {
    if (interacting) return;
    const count = clamp(Math.round(curve.length / 6), 18, 58);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let index = 0; index < count; index += 1) {
      const localSeed = seed + index * 0.213;
      const drift = ((timestamp * (0.000035 + hash(localSeed, 7, 8) * 0.000030)) + hash(localSeed, 9, 10)) % 1;
      const t = 0.03 + ((index / count + drift + hash(localSeed, 1, 2) * 0.11) % 1) * 0.94;
      const point = pointOnCurve(curve, t);
      const pulse = 0.62 + Math.sin(timestamp * 0.004 + localSeed * 17.9) * 0.25;
      const radius = 0.45 + hash(localSeed, 3, 4) * 0.78;
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(205,248,255,${(0.48 * pulse).toFixed(3)})`;
      ctx.fill();
      if (index % 4 === 0) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(60,178,255,${(0.12 * pulse).toFixed(3)})`;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawPulse(ctx, curve, seed, timestamp) {
    const duration = 1900 + seed * 1500;
    const progress = ((timestamp + seed * 1100) % duration) / duration;
    const point = pointOnCurve(curve, progress);
    const alpha = Math.sin(Math.PI * progress);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 7);
    gradient.addColorStop(0, `rgba(255,255,255,${(0.92 * alpha).toFixed(3)})`);
    gradient.addColorStop(0.35, `rgba(96,219,255,${(0.62 * alpha).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(38,112,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  function drawNexus(ctx, point, rootCount, timestamp, interacting) {
    const pulse = 0.90 + Math.sin(timestamp * 0.0016) * 0.08;
    const radius = clamp(30 + rootCount * 4, 38, 58);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, `rgba(248,253,255,${((interacting ? 0.22 : 0.42) * pulse).toFixed(3)})`);
    gradient.addColorStop(0.16, `rgba(126,219,255,${((interacting ? 0.17 : 0.32) * pulse).toFixed(3)})`);
    gradient.addColorStop(0.45, `rgba(62,139,255,${((interacting ? 0.10 : 0.20) * pulse).toFixed(3)})`);
    gradient.addColorStop(0.75, `rgba(88,74,255,${((interacting ? 0.05 : 0.12) * pulse).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(24,56,210,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    if (!interacting) {
      for (let ray = 0; ray < 18; ray += 1) {
        const angle = (ray / 18) * Math.PI * 2 + hash(ray + 1.9, 1, 2) * 0.22;
        const reach = radius * (0.58 + hash(ray + 2.7, 3, 4) * 0.78);
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + Math.cos(angle) * reach, point.y + Math.sin(angle) * reach);
        ctx.lineWidth = ray % 3 === 0 ? 0.9 : 0.45;
        ctx.strokeStyle = ray % 3 === 0 ? 'rgba(218,249,255,.46)' : 'rgba(100,206,255,.28)';
        previousStroke.call(ctx);
      }
    }
    ctx.restore();
  }

  function drawSharedNetwork(ctx, roots, timestamp, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    drawNexus(ctx, nexus, roots.length, timestamp, interacting);

    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      const curve = controlPoints(nexus, root.centre, seed, 0.78, index + 1);
      const width = clamp(curve.length * 0.055, 10, 20);
      drawTube(ctx, curve, width, interacting);
      drawBundle(ctx, curve, width, seed, interacting);
      drawDendrites(ctx, curve, seed + 0.37, interacting);
      drawFibreLights(ctx, curve, seed + 0.83, timestamp, interacting);
      if (!interacting) drawPulse(ctx, curve, seed, timestamp);
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
