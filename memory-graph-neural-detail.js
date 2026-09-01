(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralDetailInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralDetailInstalled', { value: true });

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

  const FRAME_MS = 58;
  const INTERACTING_FRAME_MS = 120;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7243.173 + a * 91.317 + b * 211.927) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralDetailStart || !ctx?.__memoryNeuralDetailEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-detail-canvas';
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
    const start = ctx.__memoryNeuralDetailStart;
    const end = ctx.__memoryNeuralDetailEnd;
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

  function drawFibreLights(ctx, curve, seed, timestamp, interacting) {
    if (interacting) return;
    const count = clamp(Math.round(curve.length / 58), 5, 11);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let index = 0; index < count; index += 1) {
      const localSeed = seed + index * 0.611;
      const speed = 0.000018 + hash(localSeed, 2, 3) * 0.000020;
      const phase = hash(localSeed, 4, 5);
      const t = 0.035 + ((timestamp * speed + phase) % 1) * 0.93;
      const point = pointOnCurve(curve, t);
      const pulse = 0.72 + Math.sin(timestamp * 0.0031 + localSeed * 19.7) * 0.22;
      const radius = 0.55 + hash(localSeed, 6, 7) * 0.70;

      const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 5.2);
      glow.addColorStop(0, `rgba(240,253,255,${(0.78 * pulse).toFixed(3)})`);
      glow.addColorStop(0.22, `rgba(112,218,255,${(0.38 * pulse).toFixed(3)})`);
      glow.addColorStop(0.56, `rgba(82,103,255,${(0.16 * pulse).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(54,77,255,0)');
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius * 5.2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(229,252,255,${(0.88 * pulse).toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTendril(ctx, curve, seed, t, side, width, interacting) {
    const origin = pointOnCurve(curve, t);
    const tangent = tangentOnCurve(curve, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const local = seed + t * 31.7 + side * 0.73;
    const reach = width * (2.0 + hash(local, 1, 2) * 3.6) + 8;
    const sweep = (hash(local, 3, 4) - 0.38) * reach * 0.78;
    const shoulder = width * (0.52 + hash(local, 5, 6) * 0.38);
    const start = {
      x: origin.x + nx * side * shoulder,
      y: origin.y + ny * side * shoulder
    };
    const bend1 = {
      x: start.x + nx * side * reach * 0.42 + tangent.x * sweep * 0.28,
      y: start.y + ny * side * reach * 0.42 + tangent.y * sweep * 0.28
    };
    const bend2 = {
      x: start.x + nx * side * reach * 0.78 + tangent.x * sweep * 0.68,
      y: start.y + ny * side * reach * 0.78 + tangent.y * sweep * 0.68
    };
    const end = {
      x: start.x + nx * side * reach + tangent.x * sweep,
      y: start.y + ny * side * reach + tangent.y * sweep
    };

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.bezierCurveTo(bend1.x, bend1.y, bend2.x, bend2.y, end.x, end.y);
    ctx.lineWidth = interacting ? 0.34 : 0.54 + hash(local, 7, 8) * 0.26;
    ctx.strokeStyle = interacting ? 'rgba(97,169,255,.08)' : 'rgba(105,192,255,.23)';
    previousStroke.call(ctx);

    if (interacting) return null;

    const forkT = 0.56 + hash(local, 9, 10) * 0.18;
    const forkBase = {
      x: start.x * (1 - forkT) + end.x * forkT,
      y: start.y * (1 - forkT) + end.y * forkT
    };
    const forkSide = hash(local, 11, 12) > 0.5 ? 1 : -1;
    const forkReach = reach * (0.34 + hash(local, 13, 14) * 0.24);
    const fork = {
      x: forkBase.x + nx * side * forkReach * 0.55 + tangent.x * forkSide * forkReach * 0.72,
      y: forkBase.y + ny * side * forkReach * 0.55 + tangent.y * forkSide * forkReach * 0.72
    };
    ctx.beginPath();
    ctx.moveTo(forkBase.x, forkBase.y);
    ctx.quadraticCurveTo(
      (forkBase.x + fork.x) * 0.5 + nx * side * forkReach * 0.16,
      (forkBase.y + fork.y) * 0.5 + ny * side * forkReach * 0.16,
      fork.x,
      fork.y
    );
    ctx.lineWidth = 0.32;
    ctx.strokeStyle = 'rgba(164,218,255,.17)';
    previousStroke.call(ctx);

    return { end, fork };
  }

  function drawSideWebbing(ctx, curve, width, seed, interacting) {
    const mobile = sourceCanvas?.clientWidth < 760;
    const count = interacting ? 6 : clamp(Math.round(curve.length / (mobile ? 55 : 38)), mobile ? 8 : 12, mobile ? 14 : 22);
    const endpoints = [];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 0; index < count; index += 1) {
      const localSeed = seed + index * 0.417;
      const t = 0.075 + ((index + 0.35 + hash(localSeed, 1, 2) * 0.35) / (count + 0.9)) * 0.86;
      const side = hash(localSeed, 3, 4) > 0.5 ? 1 : -1;
      const result = drawTendril(ctx, curve, localSeed, t, side, width, interacting);
      if (result) endpoints.push(result.end, result.fork);
    }

    if (!interacting) {
      for (let index = 1; index < endpoints.length; index += 2) {
        if (hash(seed, index, 17) < 0.44) continue;
        const a = endpoints[index - 1];
        const b = endpoints[index];
        if (distance(a, b) > width * 7.5) continue;
        const mid = {
          x: (a.x + b.x) * 0.5 + (hash(seed, index, 18) - 0.5) * width * 1.8,
          y: (a.y + b.y) * 0.5 + (hash(seed, index, 19) - 0.5) * width * 1.8
        };
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
        ctx.lineWidth = 0.24;
        ctx.strokeStyle = 'rgba(112,190,255,.10)';
        previousStroke.call(ctx);
      }
    }
    ctx.restore();
  }

  function drawDistalFlares(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    const root = curve.p3;
    const tangent = tangentOnCurve(curve, 0.98);
    const nx = -tangent.y;
    const ny = tangent.x;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let branch = 0; branch < 7; branch += 1) {
      const local = seed + branch * 0.871;
      const side = branch % 2 ? 1 : -1;
      const fan = (branch - 3) * 0.22 + (hash(local, 1, 2) - 0.5) * 0.20;
      const reach = width * (1.7 + hash(local, 3, 4) * 2.7);
      const end = {
        x: root.x + tangent.x * reach * (0.48 + hash(local, 5, 6) * 0.36) + nx * side * reach * fan,
        y: root.y + tangent.y * reach * (0.48 + hash(local, 5, 6) * 0.36) + ny * side * reach * fan
      };
      const mid = {
        x: root.x + (end.x - root.x) * 0.52 + nx * side * reach * 0.18,
        y: root.y + (end.y - root.y) * 0.52 + ny * side * reach * 0.18
      };
      ctx.beginPath();
      ctx.moveTo(root.x, root.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = branch === 3 ? 0.62 : 0.34;
      ctx.strokeStyle = branch === 3 ? 'rgba(137,221,255,.28)' : 'rgba(104,192,255,.16)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawNexusWeb(ctx, nexus, roots, timestamp, interacting) {
    if (interacting) return;
    const rootCount = roots.length;
    const radius = clamp(34 + rootCount * 5, 48, 68);
    const seed = rootCount * 0.197 + nexus.x * 0.0008 + nexus.y * 0.0011;
    const ringCount = 5;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let ring = 1; ring <= ringCount; ring += 1) {
      const points = 11 + ring * 3;
      const ringRadius = radius * (0.20 + ring * 0.13);
      ctx.beginPath();
      for (let index = 0; index <= points; index += 1) {
        const angle = (index / points) * Math.PI * 2 + hash(seed, ring, 1) * 0.5;
        const wobble = 0.84
          + Math.sin(angle * (2 + ring) + seed * 9.3) * 0.10
          + (hash(seed + ring, index, 2) - 0.5) * 0.08;
        const x = nexus.x + Math.cos(angle) * ringRadius * wobble;
        const y = nexus.y + Math.sin(angle) * ringRadius * wobble;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = ring === ringCount ? 0.48 : 0.30;
      ctx.strokeStyle = ring === ringCount ? 'rgba(137,209,255,.19)' : 'rgba(151,219,255,.13)';
      previousStroke.call(ctx);
    }

    for (let ray = 0; ray < 16 + rootCount * 2; ray += 1) {
      const local = seed + ray * 0.337;
      const a0 = hash(local, 3, 4) * Math.PI * 2;
      const a1 = a0 + (0.35 + hash(local, 5, 6) * 1.15) * (hash(local, 7, 8) > 0.5 ? 1 : -1);
      const r0 = radius * (0.12 + hash(local, 9, 10) * 0.30);
      const r1 = radius * (0.45 + hash(local, 11, 12) * 0.48);
      const p0 = { x: nexus.x + Math.cos(a0) * r0, y: nexus.y + Math.sin(a0) * r0 };
      const p1 = { x: nexus.x + Math.cos(a1) * r1, y: nexus.y + Math.sin(a1) * r1 };
      const bend = {
        x: (p0.x + p1.x) * 0.5 + Math.cos((a0 + a1) * 0.5 + Math.PI * 0.5) * radius * 0.10,
        y: (p0.y + p1.y) * 0.5 + Math.sin((a0 + a1) * 0.5 + Math.PI * 0.5) * radius * 0.10
      };
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(bend.x, bend.y, p1.x, p1.y);
      ctx.lineWidth = ray % 5 === 0 ? 0.52 : 0.26;
      ctx.strokeStyle = ray % 5 === 0 ? 'rgba(193,235,255,.22)' : 'rgba(113,190,255,.12)';
      previousStroke.call(ctx);
    }

    const pulseCount = 8;
    for (let index = 0; index < pulseCount; index += 1) {
      const local = seed + index * 0.913;
      const angle = hash(local, 13, 14) * Math.PI * 2 + timestamp * (0.000025 + hash(local, 15, 16) * 0.000018);
      const r = radius * (0.20 + hash(local, 17, 18) * 0.60);
      const x = nexus.x + Math.cos(angle) * r;
      const y = nexus.y + Math.sin(angle) * r;
      ctx.beginPath();
      ctx.arc(x, y, 0.55 + hash(local, 19, 20) * 0.65, 0, Math.PI * 2);
      ctx.fillStyle = index % 3 === 0 ? 'rgba(230,247,255,.66)' : 'rgba(117,205,255,.47)';
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSharedDetail(ctx, roots, timestamp, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);

    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      const curve = controlPoints(nexus, root.centre, seed, 0.78, index + 1);
      const width = clamp(curve.length * 0.055, 10, 20);
      drawSideWebbing(ctx, curve, width, seed + 0.31, interacting);
      drawDistalFlares(ctx, curve, width, seed + 0.61, interacting);
      drawFibreLights(ctx, curve, seed + 0.89, timestamp, interacting);
    });

    drawNexusWeb(ctx, nexus, roots, timestamp, interacting);
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
    drawSharedDetail(layerContext, rootGroups(segments), timestamp, interacting);
  }

  proto.beginPath = function neuralDetailBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralDetailStart = null;
      this.__memoryNeuralDetailEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralDetailMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralDetailStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralDetailEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralDetailLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralDetailStart) {
      this.__memoryNeuralDetailEnd = { x: Number(x), y: Number(y) };
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralDetailClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralDetailStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralDetailStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralDetailStyles';
    style.textContent = `
      .memory-graph-neural-detail-canvas {
        position:absolute;
        inset:0;
        z-index:2;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.88;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralDetail = Object.freeze({
    version: VERSION,
    redraw() { lastPaint = 0; }
  });

  globalThis.MemoryGraph?.redraw?.();
})();
