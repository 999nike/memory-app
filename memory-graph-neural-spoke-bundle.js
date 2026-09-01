(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralSpokeBundleInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralSpokeBundleInstalled', { value: true });

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

  const FRAME_MS = 68;
  const INTERACTING_FRAME_MS = 150;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 8191.413 + a * 109.173 + b * 269.711) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralBundleStart || !ctx?.__memoryNeuralBundleEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-spoke-bundle-canvas';
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
    const start = ctx.__memoryNeuralBundleStart;
    const end = ctx.__memoryNeuralBundleEnd;
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

  function traceSmooth(ctx, points, close = false) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    const limit = close ? points.length + 1 : points.length;
    for (let index = 1; index < limit; index += 1) {
      const current = points[index % points.length];
      const next = points[(index + 1) % points.length];
      if (!close && index === points.length - 1) {
        ctx.lineTo(current.x, current.y);
        break;
      }
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    if (close) ctx.closePath();
  }

  function originalSpokeCurve(segment, root, index) {
    const from = root.centre;
    const to = segment.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const seed = segment.seed + index * 0.613;
    const side = hash(seed, 1, 2) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.13 + hash(seed, 3, 4) * 0.13), 10, 42);
    const skew = (hash(seed, 5, 6) - 0.5) * 0.12;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.28 + skew) + nx * bend * 0.80, y: from.y + dy * (0.28 + skew) + ny * bend * 0.80 },
      p2: { x: from.x + dx * (0.70 - skew) + nx * bend, y: from.y + dy * (0.70 - skew) + ny * bend },
      p3: to,
      length,
      seed
    };
  }

  function bundledCurve(from, to, seed, index) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const side = hash(seed, index, 41) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.075 + hash(seed, index, 42) * 0.085), 5, 26);
    const skew = (hash(seed, index, 43) - 0.5) * 0.10;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.31 + skew) + nx * bend * 0.48, y: from.y + dy * (0.31 + skew) + ny * bend * 0.48 },
      p2: { x: from.x + dx * (0.72 - skew) + nx * bend, y: from.y + dy * (0.72 - skew) + ny * bend },
      p3: to,
      length
    };
  }

  function sampleTube(curve, baseWidth, seed, interacting, endScale = 0.10) {
    const count = interacting ? 12 : 28;
    const left = [];
    const right = [];
    const centre = [];
    const phase = hash(seed, 61, 62) * Math.PI * 2;
    const phaseL = hash(seed, 63, 64) * Math.PI * 2;
    const phaseR = hash(seed, 65, 66) * Math.PI * 2;
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const window = Math.pow(Math.sin(Math.PI * t), 0.66);
      const shoulder = 0.62 * Math.exp(-Math.pow(t / 0.22, 2));
      const taper = endScale + Math.pow(1 - t, 0.76) * (0.90 - endScale) + shoulder * 0.40;
      const drift = baseWidth * window * (Math.sin(t * Math.PI * 2.1 + phase) * 0.10 + Math.sin(t * Math.PI * 6.2 + phase * 0.71) * 0.032);
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const leftRipple = window * (Math.sin(t * Math.PI * 3.5 + phaseL) * 0.18 + Math.sin(t * Math.PI * 8.0 + phaseR) * 0.045);
      const rightRipple = window * (Math.sin(t * Math.PI * 3.9 + phaseR) * 0.20 + Math.sin(t * Math.PI * 7.4 + phaseL) * 0.050);
      const half = baseWidth * taper;
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawTube(ctx, curve, width, seed, interacting, brightness = 1, endScale = 0.10) {
    const tube = sampleTube(curve, width, seed, interacting, endScale);
    const body = [...tube.left, ...tube.right.slice().reverse()];
    const detail = interacting ? 0.42 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(8,30,86,${(0.44 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 10;
    ctx.shadowColor = `rgba(56,92,235,${(0.18 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(114,92,248,${(0.36 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(0.44, `rgba(72,127,242,${(0.32 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(0.80, `rgba(49,155,238,${(0.22 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(42,120,210,${(0.08 * detail * brightness).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, tube.centre);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.22, width * 0.038);
    ctx.strokeStyle = `rgba(126,210,255,${(0.28 * detail * brightness).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, tube.centre);
    ctx.lineWidth = Math.max(0.16, width * 0.018);
    ctx.strokeStyle = `rgba(233,250,255,${(0.50 * detail * brightness).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();
  }

  function maskOldOrganicSpoke(ctx, curve, width, interacting) {
    const points = [];
    const count = interacting ? 10 : 24;
    for (let index = 0; index <= count; index += 1) points.push(pointOnCurve(curve, index / count));
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, points);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(5.8, width * (interacting ? 1.42 : 1.72));
    ctx.strokeStyle = interacting ? 'rgba(3,13,31,.58)' : 'rgba(3,13,31,.92)';
    previousStroke.call(ctx);
    ctx.restore();
  }

  function rootDirection(root, candidates) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const segment of candidates) {
      const dx = segment.to.x - root.centre.x;
      const dy = segment.to.y - root.centre.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.001) continue;
      sx += dx / length;
      sy += dy / length;
      count += 1;
    }
    let length = Math.hypot(sx, sy);
    if (length < 0.18) {
      const longest = candidates[0];
      sx = longest.to.x - root.centre.x;
      sy = longest.to.y - root.centre.y;
      length = Math.max(0.001, Math.hypot(sx, sy));
    }
    return { x: sx / Math.max(0.001, length), y: sy / Math.max(0.001, length) };
  }

  function drawBundleCollar(ctx, root, hub, width, count, interacting) {
    const radius = clamp(width * 1.25 + count * 0.20, 7.5, 12.5);
    const seed = root.centre.x * 0.0017 + root.centre.y * 0.0023 + count * 0.61;
    const points = [];
    for (let index = 0; index < 42; index += 1) {
      const angle = (index / 42) * Math.PI * 2;
      const directional = Math.max(0, Math.cos(angle - Math.atan2(hub.y - root.centre.y, hub.x - root.centre.x)));
      const wobble = 0.78 + Math.pow(directional, 4) * 0.42 + Math.sin(angle * 3 + seed * 7.1) * 0.10 + Math.sin(angle * 7 + seed * 11.3) * 0.05;
      const r = radius * wobble;
      points.push({ x: root.centre.x + Math.cos(angle) * r, y: root.centre.y + Math.sin(angle) * r });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, points, true);
    ctx.fillStyle = interacting ? 'rgba(7,28,77,.30)' : 'rgba(7,28,77,.58)';
    ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(root.centre.x, root.centre.y, 0, root.centre.x, root.centre.y, radius * 1.55);
    glow.addColorStop(0, interacting ? 'rgba(126,126,255,.12)' : 'rgba(126,126,255,.28)');
    glow.addColorStop(0.50, interacting ? 'rgba(72,166,255,.07)' : 'rgba(72,166,255,.18)');
    glow.addColorStop(1, 'rgba(54,104,222,0)');
    ctx.beginPath();
    ctx.arc(root.centre.x, root.centre.y, radius * 1.55, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function drawFineFibres(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let fibre = 0; fibre < 3; fibre += 1) {
      const local = seed + fibre * 0.479;
      const t = 0.32 + fibre * 0.18 + (hash(local, 71, 72) - 0.5) * 0.06;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = fibre % 2 ? -1 : 1;
      const reach = width * (1.35 + hash(local, 73, 74) * 2.0);
      const end = { x: p.x + nx * side * reach + tangent.x * reach * (hash(local, 75, 76) - 0.38), y: p.y + ny * side * reach + tangent.y * reach * (hash(local, 75, 76) - 0.38) };
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo((p.x + end.x) * 0.5 + nx * side * reach * 0.12, (p.y + end.y) * 0.5 + ny * side * reach * 0.12, end.x, end.y);
      ctx.lineWidth = 0.18;
      ctx.strokeStyle = 'rgba(128,205,255,.13)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootBundle(ctx, root, rootIndex, interacting) {
    const candidates = root.segments
      .filter((segment) => segment.length > 16)
      .sort((a, b) => b.length - a.length)
      .slice(0, 9);
    if (candidates.length < 2) return;

    const baseWidth = clamp(3.8 + candidates.length * 0.23, 4.2, 5.9);
    const averageLength = candidates.reduce((sum, segment) => sum + segment.length, 0) / candidates.length;
    const direction = rootDirection(root, candidates);
    const hubDistance = clamp(averageLength * 0.15, 13, 23);
    const hub = {
      x: root.centre.x + direction.x * hubDistance,
      y: root.centre.y + direction.y * hubDistance
    };

    candidates.forEach((segment, index) => {
      const oldCurve = originalSpokeCurve(segment, root, index);
      const oldWidth = baseWidth * (0.98 - Math.min(index, 6) * 0.035) * clamp(segment.length / 78, 0.82, 1.20);
      maskOldOrganicSpoke(ctx, oldCurve, oldWidth, interacting);
    });

    drawBundleCollar(ctx, root, hub, baseWidth, candidates.length, interacting);

    const stemSeed = root.centre.x * 0.013 + root.centre.y * 0.017 + rootIndex * 0.731;
    const stemDx = hub.x - root.centre.x;
    const stemDy = hub.y - root.centre.y;
    const stemLength = Math.max(1, Math.hypot(stemDx, stemDy));
    const stemNx = -stemDy / stemLength;
    const stemNy = stemDx / stemLength;
    const stemBend = (hash(stemSeed, 80, 81) - 0.5) * clamp(stemLength * 0.28, 2, 7);
    const stem = {
      p0: root.centre,
      p1: { x: root.centre.x + stemDx * 0.34 + stemNx * stemBend, y: root.centre.y + stemDy * 0.34 + stemNy * stemBend },
      p2: { x: root.centre.x + stemDx * 0.72 + stemNx * stemBend * 0.55, y: root.centre.y + stemDy * 0.72 + stemNy * stemBend * 0.55 },
      p3: hub,
      length: stemLength
    };
    drawTube(ctx, stem, baseWidth * 1.52, stemSeed, interacting, 0.90, 0.60);

    candidates.forEach((segment, index) => {
      const local = segment.seed + rootIndex * 0.731 + index * 0.417;
      const width = baseWidth * (0.96 - Math.min(index, 6) * 0.040) * clamp(segment.length / 78, 0.82, 1.18);
      const curve = bundledCurve(hub, segment.to, local, index);
      drawTube(ctx, curve, width, local, interacting, 0.82, 0.045);
      drawFineFibres(ctx, curve, width, local + 0.31, interacting);
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
    rootGroups(segments).forEach((root, index) => drawRootBundle(layerContext, root, index, interacting));
  }

  proto.beginPath = function neuralSpokeBundleBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralBundleStart = null;
      this.__memoryNeuralBundleEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralSpokeBundleMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralBundleStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralBundleEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralSpokeBundleLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralBundleStart) this.__memoryNeuralBundleEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralSpokeBundleClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralSpokeBundleStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralSpokeBundleStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralSpokeBundleStyles';
    style.textContent = `
      .memory-graph-neural-spoke-bundle-canvas {
        position:absolute;
        inset:0;
        z-index:5;
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

  globalThis.MemoryGraphNeuralSpokeBundle = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();