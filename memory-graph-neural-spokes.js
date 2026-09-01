(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralSpokesInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralSpokesInstalled', { value: true });

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
  const INTERACTING_FRAME_MS = 132;
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
    if (!ctx?.__memoryNeuralSpokeStart || !ctx?.__memoryNeuralSpokeEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-spokes-canvas';
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
    const start = ctx.__memoryNeuralSpokeStart;
    const end = ctx.__memoryNeuralSpokeEnd;
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

  function curveFor(segment, root, index) {
    const from = root.centre;
    const to = segment.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const seed = segment.seed + index * 0.613;
    const side = hash(seed, 1, 2) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.055 + hash(seed, 3, 4) * 0.075), 4, 26);
    const spread = (hash(seed, 5, 6) - 0.5) * length * 0.08;
    return {
      p0: from,
      p1: {
        x: from.x + dx * 0.30 + nx * bend * 0.72,
        y: from.y + dy * 0.30 + ny * bend * 0.72
      },
      p2: {
        x: from.x + dx * 0.72 + nx * bend + (dx / length) * spread,
        y: from.y + dy * 0.72 + ny * bend + (dy / length) * spread
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

  function sampleTube(curve, width, seed, interacting) {
    const count = interacting ? 12 : 28;
    const left = [];
    const right = [];
    const centre = [];
    const phase = hash(seed, 7, 8) * Math.PI * 2;
    const phaseL = hash(seed, 9, 10) * Math.PI * 2;
    const phaseR = hash(seed, 11, 12) * Math.PI * 2;

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const window = Math.pow(Math.sin(Math.PI * t), 0.64);
      const shoulder = 0.72 * Math.exp(-Math.pow(t / 0.20, 2));
      const taper = 0.18 + Math.pow(1 - t, 0.72) * 0.82 + shoulder * 0.50;
      const drift = width * window * (
        Math.sin(t * Math.PI * 2.2 + phase) * 0.13
        + Math.sin(t * Math.PI * 6.6 + phase * 0.71) * 0.035
      );
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const leftRipple = window * (
        Math.sin(t * Math.PI * 3.5 + phaseL) * 0.22
        + Math.sin(t * Math.PI * 8.1 + phaseR) * 0.055
      );
      const rightRipple = window * (
        Math.sin(t * Math.PI * 3.9 + phaseR) * 0.24
        + Math.sin(t * Math.PI * 7.6 + phaseL) * 0.060
      );
      const half = width * taper;
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function coverOriginalSpoke(ctx, segment, width, interacting) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.4, width * 1.42);
    ctx.strokeStyle = interacting ? 'rgba(4,12,28,.46)' : 'rgba(4,12,28,.78)';
    previousStroke.call(ctx);
    ctx.restore();
  }

  function drawOrganicSpoke(ctx, curve, width, seed, interacting) {
    const tube = sampleTube(curve, width, seed, interacting);
    const body = [...tube.left, ...tube.right.slice().reverse()];
    const detail = interacting ? 0.46 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(8,27,78,${(0.62 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 9;
    ctx.shadowColor = `rgba(48,72,226,${(0.19 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(112,82,255,${(0.36 * detail).toFixed(3)})`);
    tissue.addColorStop(0.34, `rgba(72,96,246,${(0.29 * detail).toFixed(3)})`);
    tissue.addColorStop(0.70, `rgba(43,132,239,${(0.21 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(36,105,210,${(0.09 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, tube.centre);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.34, width * 0.065);
    ctx.strokeStyle = `rgba(83,169,255,${(0.30 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, tube.centre);
    ctx.lineWidth = Math.max(0.22, width * 0.026);
    ctx.strokeStyle = `rgba(224,248,255,${(0.64 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    if (interacting) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let fibre = 0; fibre < 3; fibre += 1) {
      const local = seed + fibre * 0.457;
      const t = 0.30 + fibre * 0.19 + (hash(local, 13, 14) - 0.5) * 0.08;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = hash(local, 15, 16) > 0.5 ? 1 : -1;
      const reach = width * (1.7 + hash(local, 17, 18) * 2.2);
      const end = {
        x: p.x + nx * side * reach + tangent.x * reach * (hash(local, 19, 20) - 0.35),
        y: p.y + ny * side * reach + tangent.y * reach * (hash(local, 19, 20) - 0.35)
      };
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo(
        (p.x + end.x) * 0.5 + nx * side * reach * 0.18,
        (p.y + end.y) * 0.5 + ny * side * reach * 0.18,
        end.x,
        end.y
      );
      ctx.lineWidth = 0.22;
      ctx.strokeStyle = 'rgba(117,196,255,.14)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootCollar(ctx, root, count, interacting) {
    const radius = clamp(7.5 + count * 0.9, 9, 17);
    const detail = interacting ? 0.46 : 1;
    const seed = root.centre.x * 0.0017 + root.centre.y * 0.0023 + count * 0.61;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    const points = 30;
    for (let index = 0; index <= points; index += 1) {
      const angle = (index / points) * Math.PI * 2;
      const wobble = 0.86 + Math.sin(angle * 3 + seed * 7.1) * 0.12 + Math.sin(angle * 7 + seed * 11.3) * 0.06;
      const r = radius * wobble;
      const x = root.centre.x + Math.cos(angle) * r;
      const y = root.centre.y + Math.sin(angle) * r;
      if (!index) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(9,27,78,${(0.46 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(root.centre.x, root.centre.y, 0, root.centre.x, root.centre.y, radius);
    glow.addColorStop(0, `rgba(100,92,255,${(0.28 * detail).toFixed(3)})`);
    glow.addColorStop(0.55, `rgba(53,126,245,${(0.18 * detail).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(40,90,220,0)');
    ctx.beginPath();
    ctx.arc(root.centre.x, root.centre.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function drawRootSpokes(ctx, root, rootIndex, interacting) {
    const candidates = root.segments
      .filter((segment) => segment.length > 16)
      .sort((a, b) => b.length - a.length)
      .slice(0, 9);
    if (!candidates.length) return;

    const baseWidth = clamp(2.5 + candidates.length * 0.23, 3.0, 4.8);
    candidates.forEach((segment, index) => {
      const local = segment.seed + rootIndex * 0.731 + index * 0.417;
      const width = baseWidth * (0.96 - Math.min(index, 6) * 0.045) * clamp(segment.length / 75, 0.78, 1.25);
      coverOriginalSpoke(ctx, segment, width, interacting);
      drawOrganicSpoke(ctx, curveFor(segment, root, index), width, local, interacting);
    });
    drawRootCollar(ctx, root, candidates.length, interacting);
  }

  function drawSharedSpokes(ctx, roots, interacting) {
    roots.forEach((root, index) => drawRootSpokes(ctx, root, index, interacting));
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
    drawSharedSpokes(layerContext, rootGroups(segments), interacting);
  }

  proto.beginPath = function neuralSpokesBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralSpokeStart = null;
      this.__memoryNeuralSpokeEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralSpokesMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralSpokeStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralSpokeEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralSpokesLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralSpokeStart) this.__memoryNeuralSpokeEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralSpokesClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralSpokesStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralSpokesStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralSpokesStyles';
    style.textContent = `
      .memory-graph-neural-spokes-canvas {
        position:absolute;
        inset:0;
        z-index:4;
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

  globalThis.MemoryGraphNeuralSpokes = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();
