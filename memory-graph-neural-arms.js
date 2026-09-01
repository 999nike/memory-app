(() => {
  'use strict';

  const VERSION = 2;
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
    const bend = side * clamp(length * (0.07 + hash(seed, lane, 2) * 0.09), 7, 58) * bendScale;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.12;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.30 + skew) + px * bend * 0.58, y: from.y + dy * (0.30 + skew) + py * bend * 0.58 },
      p2: { x: from.x + dx * (0.72 - skew) + px * bend, y: from.y + dy * (0.72 - skew) + py * bend },
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

  function traceSmooth(ctx, points, close = false) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) return;
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

  function sampleOrganicBranch(curve, baseWidth, seed, interacting) {
    const count = interacting ? 14 : 28;
    const left = [];
    const right = [];
    const centre = [];
    const phase = hash(seed, 30, 1) * Math.PI * 2;
    const phaseL = hash(seed, 31, 2) * Math.PI * 2;
    const phaseR = hash(seed, 32, 3) * Math.PI * 2;

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const window = Math.sin(Math.PI * t);
      const centreDrift = baseWidth * window * (
        Math.sin(t * Math.PI * 2.2 + phase) * 0.10
        + Math.sin(t * Math.PI * 5.1 + phase * 0.67) * 0.035
      );
      const cx = p.x + nx * centreDrift;
      const cy = p.y + ny * centreDrift;

      const rootShoulder = 1.18 * Math.exp(-Math.pow(t / 0.20, 2));
      const midBulge = 0.18 * Math.exp(-Math.pow((t - (0.42 + hash(seed, 34, 4) * 0.18)) / 0.22, 2));
      const taper = 0.18 + Math.pow(1 - t, 0.82) * 0.82 + rootShoulder * 0.42 + midBulge;
      const half = baseWidth * taper;
      const leftRipple = window * (
        Math.sin(t * Math.PI * 3.7 + phaseL) * 0.20
        + Math.sin(t * Math.PI * 8.2 + phaseR) * 0.055
      );
      const rightRipple = window * (
        Math.sin(t * Math.PI * 4.1 + phaseR) * 0.22
        + Math.sin(t * Math.PI * 7.4 + phaseL) * 0.060
      );

      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawOrganicArm(ctx, curve, width, seed, interacting) {
    const detail = interacting ? 0.28 : 1;
    const branch = sampleOrganicBranch(curve, width, seed, interacting);
    const body = [...branch.left, ...branch.right.slice().reverse()];

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(24,47,138,${(0.18 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 12;
    ctx.shadowColor = `rgba(52,75,235,${(0.21 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(86,80,245,${(0.27 * detail).toFixed(3)})`);
    tissue.addColorStop(0.46, `rgba(46,104,235,${(0.22 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(35,114,215,${(0.10 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    traceSmooth(ctx, branch.left);
    ctx.lineWidth = Math.max(0.34, width * 0.075);
    ctx.strokeStyle = `rgba(123,188,255,${(0.20 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, branch.right);
    ctx.lineWidth = Math.max(0.34, width * 0.075);
    ctx.strokeStyle = `rgba(107,169,255,${(0.18 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceSmooth(ctx, branch.centre);
    ctx.lineWidth = Math.max(0.38, width * 0.050);
    ctx.strokeStyle = `rgba(209,242,255,${(0.50 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    if (interacting) return;

    const tangent = tangentOnCurve(curve, 0.92);
    const nx = -tangent.y;
    const ny = tangent.x;
    const forkBase = pointOnCurve(curve, 0.86);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let fork = 0; fork < 3; fork += 1) {
      const side = fork - 1;
      const local = seed + fork * 0.733;
      const reach = width * (2.0 + hash(local, 41, 2) * 2.4);
      const forward = reach * (0.55 + hash(local, 42, 3) * 0.42);
      const spread = side * reach * (0.60 + hash(local, 43, 4) * 0.36);
      const end = {
        x: forkBase.x + tangent.x * forward + nx * spread,
        y: forkBase.y + tangent.y * forward + ny * spread
      };
      ctx.beginPath();
      ctx.moveTo(forkBase.x, forkBase.y);
      ctx.quadraticCurveTo(
        forkBase.x + tangent.x * forward * 0.48 + nx * spread * 0.28,
        forkBase.y + tangent.y * forward * 0.48 + ny * spread * 0.28,
        end.x,
        end.y
      );
      ctx.lineWidth = fork === 1 ? 0.42 : 0.28;
      ctx.strokeStyle = fork === 1 ? 'rgba(148,218,255,.20)' : 'rgba(122,197,255,.14)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootShoulder(ctx, major, t, side, mainWidth, branchWidth, seed, interacting) {
    const origin = pointOnCurve(major, t);
    const tangent = tangentOnCurve(major, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const centre = {
      x: origin.x + nx * side * mainWidth * 0.34,
      y: origin.y + ny * side * mainWidth * 0.34
    };
    const radius = branchWidth * (interacting ? 1.4 : 1.9);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius * 2.2);
    glow.addColorStop(0, interacting ? 'rgba(90,126,245,.08)' : 'rgba(85,98,235,.18)');
    glow.addColorStop(0.45, interacting ? 'rgba(66,101,220,.04)' : 'rgba(66,103,226,.11)');
    glow.addColorStop(1, 'rgba(48,72,205,0)');
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function drawMajorArms(ctx, major, width, seed, interacting) {
    const armCount = interacting ? 2 : 5;
    for (let arm = 0; arm < armCount; arm += 1) {
      const local = seed + arm * 0.613;
      const baseT = [0.14, 0.28, 0.43, 0.60, 0.76][arm] ?? (0.18 + arm * 0.14);
      const t = clamp(baseT + (hash(local, 1, 2) - 0.5) * 0.055, 0.10, 0.82);
      const origin = pointOnCurve(major, t);
      const tangent = tangentOnCurve(major, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = arm % 2 ? -1 : 1;
      const branchWidth = width * (0.22 + hash(local, 7, 8) * 0.10) * (1 - arm * 0.045);
      const reach = width * (3.7 + hash(local, 3, 4) * 3.0) * (1 - arm * 0.045);

      const start = {
        x: origin.x + nx * side * width * 0.24 - tangent.x * branchWidth * 0.45,
        y: origin.y + ny * side * width * 0.24 - tangent.y * branchWidth * 0.45
      };
      const forward = reach * (0.60 + hash(local, 5, 6) * 0.52);
      const lateral = reach * (0.66 + hash(local, 9, 10) * 0.46) * side;
      const end = {
        x: origin.x + tangent.x * forward + nx * lateral,
        y: origin.y + tangent.y * forward + ny * lateral
      };

      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const bx = -dy / length;
      const by = dx / length;
      const bend = (hash(local, 11, 12) - 0.5) * reach * 0.24;
      const curve = {
        p0: start,
        p1: {
          x: start.x + tangent.x * reach * 0.35 + nx * side * reach * 0.18 + bx * bend,
          y: start.y + tangent.y * reach * 0.35 + ny * side * reach * 0.18 + by * bend
        },
        p2: {
          x: start.x + dx * 0.73 + nx * side * reach * 0.12 + bx * bend * 0.55,
          y: start.y + dy * 0.73 + ny * side * reach * 0.12 + by * bend * 0.55
        },
        p3: end,
        length: distance(start, end)
      };

      drawRootShoulder(ctx, major, t, side, width, branchWidth, local, interacting);
      drawOrganicArm(ctx, curve, branchWidth, local, interacting);
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
        opacity:.82;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralArms = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();
