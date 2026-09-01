(() => {
  'use strict';

  const VERSION = 3;
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

  const FRAME_MS = 72;
  const INTERACTING_FRAME_MS = 150;
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
    // Reconstruct Nexus's trunk exactly; keep the branch-detail hash separate.
    const trunkHash = (a, b) => {
      const value = Math.sin(seed * 7127.913 + a * 79.117 + b * 193.731) * 43758.5453;
      return value - Math.floor(value);
    };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const side = trunkHash(lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.10 + trunkHash(lane, 2) * 0.11), 12, 94) * bendScale;
    const skew = (trunkHash(lane, 3) - 0.5) * 0.18;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.27 + skew) + px * bend * 0.76, y: from.y + dy * (0.27 + skew) + py * bend * 0.76 },
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
    const count = interacting ? 14 : 34;
    const left = [];
    const right = [];
    const centre = [];
    const phase = hash(seed, 20, 1) * Math.PI * 2;
    const phaseL = hash(seed, 21, 2) * Math.PI * 2;
    const phaseR = hash(seed, 22, 3) * Math.PI * 2;
    const bulgeAt = 0.34 + hash(seed, 23, 4) * 0.30;

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const window = Math.pow(Math.sin(Math.PI * t), 0.58);
      const shoulder = 1.18 * Math.exp(-Math.pow(t / 0.17, 2));
      const midBulge = 0.22 * Math.exp(-Math.pow((t - bulgeAt) / 0.18, 2));
      const taper = 0.045 + Math.pow(1 - t, 0.70) * 0.955 + shoulder * 0.56 + midBulge;
      const drift = baseWidth * window * (
        Math.sin(t * Math.PI * 2.25 + phase) * 0.16
        + Math.sin(t * Math.PI * 6.9 + phase * 0.73) * 0.052
      );
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const leftRipple = window * (
        Math.sin(t * Math.PI * 3.25 + phaseL) * 0.27
        + Math.sin(t * Math.PI * 8.7 + phaseR) * 0.078
      );
      const rightRipple = window * (
        Math.sin(t * Math.PI * 3.85 + phaseR) * 0.29
        + Math.sin(t * Math.PI * 7.9 + phaseL) * 0.082
      );
      const half = baseWidth * taper;
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawHairFibres(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let index = 0; index < 8; index += 1) {
      const local = seed + index * 0.417;
      const t = 0.14 + ((index + 0.35) / 8.6) * 0.70;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = hash(local, 1, 2) > 0.5 ? 1 : -1;
      const reach = width * (2.2 + hash(local, 3, 4) * 4.2);
      const start = { x: p.x + nx * side * width * 0.38, y: p.y + ny * side * width * 0.38 };
      const end = {
        x: start.x + nx * side * reach + tangent.x * reach * (hash(local, 5, 6) - 0.28),
        y: start.y + ny * side * reach + tangent.y * reach * (hash(local, 5, 6) - 0.28)
      };
      const mid = {
        x: (start.x + end.x) * 0.5 + tangent.x * reach * (hash(local, 7, 8) - 0.5) * 0.34,
        y: (start.y + end.y) * 0.5 + tangent.y * reach * (hash(local, 7, 8) - 0.5) * 0.34
      };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = 0.20 + hash(local, 9, 10) * 0.16;
      ctx.strokeStyle = 'rgba(117,196,255,.13)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootBody(ctx, curve, width, seed, interacting, withForks = true) {
    const root = sampleRoot(curve, width, seed, interacting);
    const body = [...root.left, ...root.right.slice().reverse()];
    const detail = interacting ? 0.34 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(8,24,73,${(0.38 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 13;
    ctx.shadowColor = `rgba(53,70,222,${(0.20 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(113,80,255,${(0.34 * detail).toFixed(3)})`);
    tissue.addColorStop(0.30, `rgba(76,86,247,${(0.29 * detail).toFixed(3)})`);
    tissue.addColorStop(0.66, `rgba(44,128,239,${(0.21 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(38,105,210,${(0.07 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, root.left);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.30, width * 0.040);
    ctx.strokeStyle = `rgba(125,181,255,${(0.15 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, root.right);
    ctx.lineWidth = Math.max(0.30, width * 0.040);
    ctx.strokeStyle = `rgba(103,159,255,${(0.13 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceSmooth(ctx, root.centre);
    ctx.lineWidth = Math.max(0.26, width * 0.038);
    ctx.strokeStyle = `rgba(218,246,255,${(0.55 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    drawHairFibres(ctx, curve, width, seed + 0.31, interacting);
    if (withForks) drawForkBodies(ctx, curve, width, seed + 0.67, interacting);
  }

  function fineForkCurve(curve, width, seed, side) {
    const base = pointOnCurve(curve, 0.76 + hash(seed, 1, 2) * 0.08);
    const tangent = tangentOnCurve(curve, 0.82);
    const nx = -tangent.y;
    const ny = tangent.x;
    const reach = width * (5.2 + hash(seed, 3, 4) * 4.0);
    const forward = reach * (0.72 + hash(seed, 5, 6) * 0.44);
    const spread = side * reach * (0.38 + hash(seed, 7, 8) * 0.36);
    const end = { x: base.x + tangent.x * forward + nx * spread, y: base.y + tangent.y * forward + ny * spread };
    return {
      p0: base,
      p1: {
        x: base.x + tangent.x * forward * 0.36 + nx * spread * 0.22,
        y: base.y + tangent.y * forward * 0.36 + ny * spread * 0.22
      },
      p2: {
        x: base.x + tangent.x * forward * 0.75 + nx * spread * 0.70,
        y: base.y + tangent.y * forward * 0.75 + ny * spread * 0.70
      },
      p3: end,
      length: distance(base, end)
    };
  }

  function drawForkBodies(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    for (const side of [-1, 1]) {
      const local = seed + side * 0.731;
      drawRootBody(ctx, fineForkCurve(curve, width, local, side), width * (0.31 + hash(local, 9, 10) * 0.09), local, false, false);
    }
  }

  function branchCurveFromMajor(major, mainWidth, t, side, seed) {
    const origin = pointOnCurve(major, t);
    const tangent = tangentOnCurve(major, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const branchWidth = mainWidth * (0.24 + hash(seed, 1, 2) * 0.12) * (1 - t * 0.10);
    const reach = mainWidth * (5.6 + hash(seed, 3, 4) * 3.9) * (1 - t * 0.08);
    const start = {
      x: origin.x - tangent.x * branchWidth * 1.65 + nx * side * mainWidth * 0.02,
      y: origin.y - tangent.y * branchWidth * 1.65 + ny * side * mainWidth * 0.02
    };
    const forward = reach * (0.82 + hash(seed, 5, 6) * 0.58);
    const lateral = reach * (0.44 + hash(seed, 7, 8) * 0.42) * side;
    const end = { x: origin.x + tangent.x * forward + nx * lateral, y: origin.y + tangent.y * forward + ny * lateral };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return {
      curve: {
        p0: start,
        p1: {
          x: start.x + tangent.x * reach * 0.42 + nx * side * reach * 0.12,
          y: start.y + tangent.y * reach * 0.42 + ny * side * reach * 0.12
        },
        p2: {
          x: start.x + dx * 0.73 + nx * side * reach * 0.08,
          y: start.y + dy * 0.73 + ny * side * reach * 0.08
        },
        p3: end,
        length: distance(start, end)
      },
      width: branchWidth
    };
  }

  function drawChildRoot(ctx, parentCurve, parentWidth, seed, interacting) {
    if (interacting) return;
    const t = 0.42 + hash(seed, 41, 42) * 0.24;
    const origin = pointOnCurve(parentCurve, t);
    const tangent = tangentOnCurve(parentCurve, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const side = hash(seed, 43, 44) > 0.5 ? 1 : -1;
    const width = parentWidth * (0.38 + hash(seed, 45, 46) * 0.12);
    const reach = parentWidth * (7.0 + hash(seed, 47, 48) * 4.8);
    const end = {
      x: origin.x + tangent.x * reach * (0.50 + hash(seed, 49, 50) * 0.42) + nx * side * reach,
      y: origin.y + tangent.y * reach * (0.50 + hash(seed, 49, 50) * 0.42) + ny * side * reach
    };
    const curve = {
      p0: { x: origin.x - tangent.x * width * 1.2, y: origin.y - tangent.y * width * 1.2 },
      p1: { x: origin.x + tangent.x * reach * 0.24 + nx * side * reach * 0.26, y: origin.y + tangent.y * reach * 0.24 + ny * side * reach * 0.26 },
      p2: { x: origin.x + tangent.x * reach * 0.46 + nx * side * reach * 0.72, y: origin.y + tangent.y * reach * 0.46 + ny * side * reach * 0.72 },
      p3: end,
      length: distance(origin, end)
    };
    drawRootBody(ctx, curve, width, seed + 0.19, false, true);
  }

  function drawTrunkBranches(ctx, major, mainWidth, seed, interacting) {
    const positions = [0.13, 0.27, 0.42, 0.58, 0.74];
    const count = interacting ? 1 : positions.length;
    for (let index = 0; index < count; index += 1) {
      const local = seed + index * 0.733;
      const t = clamp(positions[index] + (hash(local, 11, 12) - 0.5) * 0.052, 0.09, 0.82);
      const side = (index % 2 ? -1 : 1) * (hash(local, 13, 14) > 0.22 ? 1 : -1);
      const branch = branchCurveFromMajor(major, mainWidth, t, side, local);
      drawRootBody(ctx, branch.curve, branch.width, local, interacting, true);
      if (!interacting && index !== 4) drawChildRoot(ctx, branch.curve, branch.width, local + 0.47, false);
    }
  }

  function angleDelta(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  function drawNexusFreeRoots(ctx, nexus, roots, seed, interacting) {
    if (interacting) return;
    const rootAngles = roots.map((root) => Math.atan2(root.centre.y - nexus.y, root.centre.x - nexus.x));
    const averageDistance = roots.reduce((sum, root) => sum + distance(nexus, root.centre), 0) / Math.max(1, roots.length);
    const baseWidth = clamp(averageDistance * 0.016, 5.0, 9.2);
    const rotation = hash(seed, 30, 31) * Math.PI * 2;
    let drawn = 0;

    for (let slot = 0; slot < 18 && drawn < 10; slot += 1) {
      const angle = rotation + (slot / 18) * Math.PI * 2;
      if (rootAngles.some((rootAngle) => Math.abs(angleDelta(angle, rootAngle)) < 0.25)) continue;
      const local = seed + slot * 0.527;
      const reach = baseWidth * (7.8 + hash(local, 32, 33) * 5.6);
      const endAngle = angle + (hash(local, 34, 35) - 0.5) * 0.74;
      const start = {
        x: nexus.x - Math.cos(angle) * baseWidth * 0.86,
        y: nexus.y - Math.sin(angle) * baseWidth * 0.86
      };
      const end = { x: nexus.x + Math.cos(endAngle) * reach, y: nexus.y + Math.sin(endAngle) * reach };
      const px = -Math.sin(angle);
      const py = Math.cos(angle);
      const bend = (hash(local, 36, 37) - 0.5) * reach * 0.42;
      const curve = {
        p0: start,
        p1: { x: nexus.x + Math.cos(angle) * reach * 0.30 + px * bend, y: nexus.y + Math.sin(angle) * reach * 0.30 + py * bend },
        p2: { x: nexus.x + Math.cos(endAngle) * reach * 0.69 + px * bend * 0.55, y: nexus.y + Math.sin(endAngle) * reach * 0.69 + py * bend * 0.55 },
        p3: end,
        length: distance(start, end)
      };
      drawRootBody(ctx, curve, baseWidth * (0.58 + hash(local, 38, 39) * 0.25), local, false, hash(local, 40, 41) > 0.38);
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
