(() => {
  'use strict';

  const VERSION = 4;
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

  const FRAME_MS = 64;
  const INTERACTING_FRAME_MS = 148;
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

  function sampleTube(curve, width, seed, interacting, tipFloor = 0.012) {
    const count = interacting ? 12 : 30;
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
      const window = Math.pow(Math.sin(Math.PI * t), 0.60);
      const shoulder = 0.90 * Math.exp(-Math.pow(t / 0.19, 2));
      const terminal = Math.pow(1 - t, 0.74);
      const taper = tipFloor + terminal * (0.92 - tipFloor) + shoulder * 0.48;
      const drift = width * window * (Math.sin(t * Math.PI * 2.25 + phase) * 0.15 + Math.sin(t * Math.PI * 6.8 + phase * 0.71) * 0.045);
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const leftRipple = window * (Math.sin(t * Math.PI * 3.4 + phaseL) * 0.25 + Math.sin(t * Math.PI * 8.2 + phaseR) * 0.065);
      const rightRipple = window * (Math.sin(t * Math.PI * 3.9 + phaseR) * 0.27 + Math.sin(t * Math.PI * 7.7 + phaseL) * 0.070);
      const half = width * taper;
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawTissueRoot(ctx, curve, width, seed, interacting, brightness = 1) {
    const tube = sampleTube(curve, width, seed, interacting);
    const body = [...tube.left, ...tube.right.slice().reverse()];
    const detail = interacting ? 0.42 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(9,33,92,${(0.42 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 11;
    ctx.shadowColor = `rgba(52,96,244,${(0.24 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(126,98,255,${(0.46 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(0.42, `rgba(79,124,249,${(0.40 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(0.78, `rgba(48,157,245,${(0.30 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(41,125,220,${(0.11 * detail * brightness).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();
    traceSmooth(ctx, tube.centre);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.28, width * 0.048);
    ctx.strokeStyle = `rgba(116,211,255,${(0.40 * detail * brightness).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, tube.centre);
    ctx.lineWidth = Math.max(0.19, width * 0.021);
    ctx.strokeStyle = `rgba(239,252,255,${(0.80 * detail * brightness).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();
  }

  function curveForSpoke(segment, root, index) {
    const from = root.centre;
    const to = segment.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const seed = segment.seed + index * 0.613;
    const side = hash(seed, 1, 2) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.12 + hash(seed, 3, 4) * 0.12), 9, 38);
    const skew = (hash(seed, 5, 6) - 0.5) * 0.12;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.28 + skew) + nx * bend * 0.78, y: from.y + dy * (0.28 + skew) + ny * bend * 0.78 },
      p2: { x: from.x + dx * (0.70 - skew) + nx * bend, y: from.y + dy * (0.70 - skew) + ny * bend },
      p3: to,
      length,
      seed
    };
  }

  function coverOriginalSpoke(ctx, segment, width, interacting) {
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const start = { x: segment.from.x + dx * 0.09, y: segment.from.y + dy * 0.09 };
    const end = { x: segment.from.x + dx * 0.91, y: segment.from.y + dy * 0.91 };
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2.4, width * 0.95);
    ctx.strokeStyle = interacting ? 'rgba(8,25,56,.34)' : 'rgba(8,25,56,.56)';
    previousStroke.call(ctx);
    ctx.restore();
  }

  function drawSpokeFibres(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let fibre = 0; fibre < 5; fibre += 1) {
      const local = seed + fibre * 0.457;
      const t = 0.22 + fibre * 0.13 + (hash(local, 13, 14) - 0.5) * 0.06;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = fibre % 2 ? -1 : 1;
      const reach = width * (1.8 + hash(local, 17, 18) * 2.8);
      const end = { x: p.x + nx * side * reach + tangent.x * reach * (hash(local, 19, 20) - 0.38), y: p.y + ny * side * reach + tangent.y * reach * (hash(local, 19, 20) - 0.38) };
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo((p.x + end.x) * 0.5 + nx * side * reach * 0.14, (p.y + end.y) * 0.5 + ny * side * reach * 0.14, end.x, end.y);
      ctx.lineWidth = 0.18 + hash(local, 21, 22) * 0.13;
      ctx.strokeStyle = 'rgba(132,216,255,.18)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootCollar(ctx, root, count, interacting) {
    const radius = clamp(7 + count * 0.58, 8.5, 14);
    const detail = interacting ? 0.40 : 1;
    const seed = root.centre.x * 0.0017 + root.centre.y * 0.0023 + count * 0.61;
    const points = [];
    for (let index = 0; index < 36; index += 1) {
      const angle = (index / 36) * Math.PI * 2;
      const wobble = 0.82 + Math.sin(angle * 3 + seed * 7.1) * 0.13 + Math.sin(angle * 7 + seed * 11.3) * 0.07;
      const r = radius * wobble;
      points.push({ x: root.centre.x + Math.cos(angle) * r, y: root.centre.y + Math.sin(angle) * r });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, points, true);
    ctx.fillStyle = `rgba(12,42,104,${(0.20 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(root.centre.x, root.centre.y, 0, root.centre.x, root.centre.y, radius * 1.7);
    glow.addColorStop(0, `rgba(151,135,255,${(0.46 * detail).toFixed(3)})`);
    glow.addColorStop(0.45, `rgba(83,170,252,${(0.31 * detail).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(45,116,226,0)');
    ctx.beginPath();
    ctx.arc(root.centre.x, root.centre.y, radius * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function drawRootSpokes(ctx, root, rootIndex, interacting) {
    const candidates = root.segments.filter((segment) => segment.length > 16).sort((a, b) => b.length - a.length).slice(0, 9);
    if (!candidates.length) return;
    const baseWidth = clamp(3.1 + candidates.length * 0.21, 3.5, 5.0);
    candidates.forEach((segment, index) => {
      const local = segment.seed + rootIndex * 0.731 + index * 0.417;
      const width = baseWidth * (0.98 - Math.min(index, 6) * 0.038) * clamp(segment.length / 78, 0.78, 1.20);
      coverOriginalSpoke(ctx, segment, width, interacting);
      const curve = curveForSpoke(segment, root, index);
      drawTissueRoot(ctx, curve, width, local, interacting, 1.18);
      drawSpokeFibres(ctx, curve, width, local + 0.33, interacting);
    });
    drawRootCollar(ctx, root, candidates.length, interacting);
  }

  function majorCurve(from, to, seed, lane = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const side = hash(seed, lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.09 + hash(seed, lane, 2) * 0.10), 10, 86) * 0.78;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.16;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.28 + skew) + px * bend * 0.72, y: from.y + dy * (0.28 + skew) + py * bend * 0.72 },
      p2: { x: from.x + dx * (0.70 - skew) + px * bend, y: from.y + dy * (0.70 - skew) + py * bend },
      p3: to,
      length
    };
  }

  function branchCurveFromMajor(major, mainWidth, t, side, seed) {
    const origin = pointOnCurve(major, t);
    const tangent = tangentOnCurve(major, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const branchWidth = mainWidth * (0.24 + hash(seed, 1, 2) * 0.12) * (1 - t * 0.10);
    const reach = mainWidth * (5.6 + hash(seed, 3, 4) * 3.9) * (1 - t * 0.08);
    const start = { x: origin.x - tangent.x * branchWidth * 1.65 + nx * side * mainWidth * 0.02, y: origin.y - tangent.y * branchWidth * 1.65 + ny * side * mainWidth * 0.02 };
    const forward = reach * (0.82 + hash(seed, 5, 6) * 0.58);
    const lateral = reach * (0.44 + hash(seed, 7, 8) * 0.42) * side;
    const end = { x: origin.x + tangent.x * forward + nx * lateral, y: origin.y + tangent.y * forward + ny * lateral };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return {
      curve: {
        p0: start,
        p1: { x: start.x + tangent.x * reach * 0.42 + nx * side * reach * 0.12, y: start.y + tangent.y * reach * 0.42 + ny * side * reach * 0.12 },
        p2: { x: start.x + dx * 0.73 + nx * side * reach * 0.08, y: start.y + dy * 0.73 + ny * side * reach * 0.08 },
        p3: end,
        length: distance(start, end)
      },
      width: branchWidth
    };
  }

  function blendBranchCap(ctx, branch, interacting) {
    if (interacting) return;
    const end = branch.curve.p3;
    const radius = Math.max(2.2, branch.width * 1.18);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const cover = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, radius * 1.5);
    cover.addColorStop(0, 'rgba(7,25,74,.66)');
    cover.addColorStop(0.62, 'rgba(9,31,88,.42)');
    cover.addColorStop(1, 'rgba(9,31,88,0)');
    ctx.beginPath();
    ctx.arc(end.x, end.y, radius * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = cover;
    ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, radius * 1.8);
    glow.addColorStop(0, 'rgba(121,116,255,.28)');
    glow.addColorStop(0.48, 'rgba(59,143,244,.16)');
    glow.addColorStop(1, 'rgba(59,143,244,0)');
    ctx.beginPath();
    ctx.arc(end.x, end.y, radius * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function terminalCurve(parent, width, seed) {
    const start = pointOnCurve(parent, 0.52);
    const tangent = tangentOnCurve(parent, 0.98);
    const nx = -tangent.y;
    const ny = tangent.x;
    const oldEnd = parent.p3;
    const extra = width * (4.5 + hash(seed, 51, 52) * 4.1);
    const side = hash(seed, 53, 54) > 0.5 ? 1 : -1;
    const end = { x: oldEnd.x + tangent.x * extra + nx * side * extra * (0.18 + hash(seed, 55, 56) * 0.22), y: oldEnd.y + tangent.y * extra + ny * side * extra * (0.18 + hash(seed, 55, 56) * 0.22) };
    return {
      p0: start,
      p1: { x: start.x + tangent.x * extra * 0.34 + nx * side * extra * 0.10, y: start.y + tangent.y * extra * 0.34 + ny * side * extra * 0.10 },
      p2: { x: oldEnd.x + tangent.x * extra * 0.34 + nx * side * extra * 0.20, y: oldEnd.y + tangent.y * extra * 0.34 + ny * side * extra * 0.20 },
      p3: end,
      length: distance(start, end)
    };
  }

  function drawTerminalFork(ctx, curve, width, seed, interacting) {
    if (interacting) return;
    const base = pointOnCurve(curve, 0.73);
    const tangent = tangentOnCurve(curve, 0.88);
    const nx = -tangent.y;
    const ny = tangent.x;
    for (const side of [-1, 1]) {
      const local = seed + side * 0.719;
      const reach = width * (3.0 + hash(local, 60, 61) * 2.7);
      const end = { x: base.x + tangent.x * reach * 0.72 + nx * side * reach * 0.58, y: base.y + tangent.y * reach * 0.72 + ny * side * reach * 0.58 };
      const fork = {
        p0: base,
        p1: { x: base.x + tangent.x * reach * 0.28 + nx * side * reach * 0.16, y: base.y + tangent.y * reach * 0.28 + ny * side * reach * 0.16 },
        p2: { x: base.x + tangent.x * reach * 0.58 + nx * side * reach * 0.43, y: base.y + tangent.y * reach * 0.58 + ny * side * reach * 0.43 },
        p3: end,
        length: distance(base, end)
      };
      drawTissueRoot(ctx, fork, width * (0.22 + hash(local, 62, 63) * 0.08), local, false, 0.86);
    }
  }

  function drawBranchTipFinish(ctx, roots, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    const positions = [0.13, 0.27, 0.42, 0.58, 0.74];
    roots.forEach((root, rootIndex) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + rootIndex * 0.731));
      const major = majorCurve(nexus, root.centre, seed, rootIndex + 1);
      const mainWidth = clamp(major.length * 0.055, 10, 20);
      const count = interacting ? 1 : positions.length;
      for (let index = 0; index < count; index += 1) {
        const local = seed + 0.17 + index * 0.733;
        const t = clamp(positions[index] + (hash(local, 11, 12) - 0.5) * 0.052, 0.09, 0.82);
        const side = (index % 2 ? -1 : 1) * (hash(local, 13, 14) > 0.22 ? 1 : -1);
        const branch = branchCurveFromMajor(major, mainWidth, t, side, local);
        blendBranchCap(ctx, branch, interacting);
        const finish = terminalCurve(branch.curve, branch.width, local + 0.83);
        drawTissueRoot(ctx, finish, branch.width * 0.84, local + 0.91, interacting, 0.84);
        drawTerminalFork(ctx, finish, branch.width * 0.84, local + 1.07, interacting);
      }
    });
  }

  function drawShared(ctx, roots, interacting) {
    roots.forEach((root, index) => drawRootSpokes(ctx, root, index, interacting));
    drawBranchTipFinish(ctx, roots, interacting);
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
    drawShared(layerContext, rootGroups(segments), interacting);
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