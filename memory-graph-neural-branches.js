(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralBranchesInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralBranchesInstalled', { value: true });

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

  const FRAME_MS = 74;
  const INTERACTING_FRAME_MS = 156;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 8069.317 + a * 103.173 + b * 257.611) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralBranchStart || !ctx?.__memoryNeuralBranchEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-branches-canvas';
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
    const start = ctx.__memoryNeuralBranchStart;
    const end = ctx.__memoryNeuralBranchEnd;
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

  function sampleRoot(curve, baseWidth, seed, interacting) {
    const count = interacting ? 14 : 30;
    const left = [];
    const right = [];
    const centre = [];
    const phase = hash(seed, 20, 1) * Math.PI * 2;
    const phaseL = hash(seed, 21, 2) * Math.PI * 2;
    const phaseR = hash(seed, 22, 3) * Math.PI * 2;
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const window = Math.pow(Math.sin(Math.PI * t), 0.62);
      const shoulder = 0.95 * Math.exp(-Math.pow(t / 0.18, 2));
      const midBulge = 0.15 * Math.exp(-Math.pow((t - 0.42) / 0.22, 2));
      const taper = 0.08 + Math.pow(1 - t, 0.76) * 0.92 + shoulder * 0.44 + midBulge;
      const drift = baseWidth * window * (Math.sin(t * Math.PI * 2.4 + phase) * 0.11 + Math.sin(t * Math.PI * 6.7 + phase * 0.73) * 0.035);
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const leftRipple = window * (Math.sin(t * Math.PI * 3.6 + phaseL) * 0.22 + Math.sin(t * Math.PI * 8.4 + phaseR) * 0.065);
      const rightRipple = window * (Math.sin(t * Math.PI * 4.0 + phaseR) * 0.24 + Math.sin(t * Math.PI * 7.7 + phaseL) * 0.070);
      const half = baseWidth * taper;
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawForkTips(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    const base = pointOnCurve(curve, 0.80);
    const tangent = tangentOnCurve(curve, 0.82);
    const nx = -tangent.y;
    const ny = tangent.x;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let fork = 0; fork < 3; fork += 1) {
      const local = seed + fork * 0.719;
      const side = fork - 1;
      const reach = width * (4.0 + hash(local, 1, 2) * 3.4);
      const forward = reach * (0.58 + hash(local, 3, 4) * 0.42);
      const spread = side * reach * (0.38 + hash(local, 5, 6) * 0.30);
      const end = { x: base.x + tangent.x * forward + nx * spread, y: base.y + tangent.y * forward + ny * spread };
      const mid = { x: base.x + tangent.x * forward * 0.52 + nx * spread * 0.35, y: base.y + tangent.y * forward * 0.52 + ny * spread * 0.35 };
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = fork === 1 ? Math.max(0.55, width * 0.16) : Math.max(0.35, width * 0.10);
      ctx.strokeStyle = fork === 1 ? 'rgba(86,151,244,.27)' : 'rgba(78,137,231,.18)';
      previousStroke.call(ctx);
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = fork === 1 ? 0.34 : 0.23;
      ctx.strokeStyle = fork === 1 ? 'rgba(205,240,255,.40)' : 'rgba(145,211,255,.26)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootBody(ctx, curve, width, seed, interacting) {
    const root = sampleRoot(curve, width, seed, interacting);
    const body = [...root.left, ...root.right.slice().reverse()];
    const detail = interacting ? 0.34 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(11,28,85,${(0.34 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 12;
    ctx.shadowColor = `rgba(55,73,230,${(0.22 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(112,83,255,${(0.31 * detail).toFixed(3)})`);
    tissue.addColorStop(0.36, `rgba(65,99,245,${(0.25 * detail).toFixed(3)})`);
    tissue.addColorStop(0.72, `rgba(40,137,239,${(0.19 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(39,110,214,${(0.08 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, root.centre);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.38, width * 0.075);
    ctx.strokeStyle = `rgba(93,180,255,${(0.25 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, root.centre);
    ctx.lineWidth = Math.max(0.25, width * 0.030);
    ctx.strokeStyle = `rgba(225,248,255,${(0.62 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    drawForkTips(ctx, curve, width, seed, interacting);
  }

  function branchCurveFromMajor(major, mainWidth, t, side, seed) {
    const origin = pointOnCurve(major, t);
    const tangent = tangentOnCurve(major, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const branchWidth = mainWidth * (0.27 + hash(seed, 1, 2) * 0.13) * (1 - t * 0.12);
    const reach = mainWidth * (5.4 + hash(seed, 3, 4) * 4.2) * (1 - t * 0.10);
    const start = {
      x: origin.x - tangent.x * branchWidth * 1.35 + nx * side * mainWidth * 0.04,
      y: origin.y - tangent.y * branchWidth * 1.35 + ny * side * mainWidth * 0.04
    };
    const forward = reach * (0.82 + hash(seed, 5, 6) * 0.56);
    const lateral = reach * (0.52 + hash(seed, 7, 8) * 0.48) * side;
    const end = { x: origin.x + tangent.x * forward + nx * lateral, y: origin.y + tangent.y * forward + ny * lateral };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return {
      curve: {
        p0: start,
        p1: { x: start.x + tangent.x * reach * 0.40 + nx * side * reach * 0.16, y: start.y + tangent.y * reach * 0.40 + ny * side * reach * 0.16 },
        p2: { x: start.x + dx * 0.72 + nx * side * reach * 0.11, y: start.y + dy * 0.72 + ny * side * reach * 0.11 },
        p3: end,
        length: distance(start, end)
      },
      width: branchWidth
    };
  }

  function drawTrunkBranches(ctx, major, mainWidth, seed, interacting) {
    const positions = [0.18, 0.36, 0.55, 0.72];
    const count = interacting ? 1 : positions.length;
    for (let index = 0; index < count; index += 1) {
      const local = seed + index * 0.733;
      const t = clamp(positions[index] + (hash(local, 11, 12) - 0.5) * 0.055, 0.12, 0.80);
      const side = hash(local, 13, 14) > 0.5 ? 1 : -1;
      const branch = branchCurveFromMajor(major, mainWidth, t, side, local);
      drawRootBody(ctx, branch.curve, branch.width, local, interacting);
    }
  }

  function angleDelta(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  function drawNexusFreeRoots(ctx, nexus, roots, seed, interacting) {
    if (interacting) return;
    const rootAngles = roots.map((root) => Math.atan2(root.centre.y - nexus.y, root.centre.x - nexus.x));
    const averageDistance = roots.reduce((sum, root) => sum + distance(nexus, root.centre), 0) / Math.max(1, roots.length);
    const baseWidth = clamp(averageDistance * 0.019, 6.5, 11.5);
    const rotation = hash(seed, 30, 31) * Math.PI * 2;
    let drawn = 0;
    for (let slot = 0; slot < 12 && drawn < 7; slot += 1) {
      const angle = rotation + (slot / 12) * Math.PI * 2;
      if (rootAngles.some((rootAngle) => Math.abs(angleDelta(angle, rootAngle)) < 0.34)) continue;
      const local = seed + slot * 0.527;
      const reach = baseWidth * (7.0 + hash(local, 32, 33) * 4.0);
      const endAngle = angle + (hash(local, 34, 35) - 0.5) * 0.58;
      const start = {
        x: nexus.x - Math.cos(angle) * baseWidth * 0.55,
        y: nexus.y - Math.sin(angle) * baseWidth * 0.55
      };
      const end = { x: nexus.x + Math.cos(endAngle) * reach, y: nexus.y + Math.sin(endAngle) * reach };
      const px = -Math.sin(angle);
      const py = Math.cos(angle);
      const bend = (hash(local, 36, 37) - 0.5) * reach * 0.32;
      const curve = {
        p0: start,
        p1: { x: nexus.x + Math.cos(angle) * reach * 0.34 + px * bend, y: nexus.y + Math.sin(angle) * reach * 0.34 + py * bend },
        p2: { x: nexus.x + Math.cos(endAngle) * reach * 0.70 + px * bend * 0.52, y: nexus.y + Math.sin(endAngle) * reach * 0.70 + py * bend * 0.52 },
        p3: end,
        length: distance(start, end)
      };
      drawRootBody(ctx, curve, baseWidth * (0.70 + hash(local, 38, 39) * 0.26), local, false);
      drawn += 1;
    }
  }

  function drawSharedBranches(ctx, roots, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      const major = controlPoints(nexus, root.centre, seed, 0.78, index + 1);
      const mainWidth = clamp(major.length * 0.055, 10, 20);
      drawTrunkBranches(ctx, major, mainWidth, seed + 0.17, interacting);
    });
    drawNexusFreeRoots(ctx, nexus, roots, roots.length * 0.31 + nexus.x * 0.001 + nexus.y * 0.0017, interacting);
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
    drawSharedBranches(layerContext, rootGroups(segments), interacting);
  }

  proto.beginPath = function neuralBranchesBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralBranchStart = null;
      this.__memoryNeuralBranchEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralBranchesMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralBranchStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralBranchEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralBranchesLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralBranchStart) this.__memoryNeuralBranchEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralBranchesClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralBranchesStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralBranchesStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralBranchesStyles';
    style.textContent = `
      .memory-graph-neural-branches-canvas {
        position:absolute;
        inset:0;
        z-index:2;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.94;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralBranches = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();