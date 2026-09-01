(() => {
  'use strict';

  const VERSION = 4;
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

  const FRAME_MS = 82;
  const INTERACTING_FRAME_MS = 164;
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

  function sampleTrunkBark(curve, width, seed, interacting) {
    const count = interacting ? 18 : 42;
    const left = [];
    const right = [];
    const centre = [];
    const phase = hash(seed, 70, 1) * Math.PI * 2;
    const phaseL = hash(seed, 71, 2) * Math.PI * 2;
    const phaseR = hash(seed, 72, 3) * Math.PI * 2;

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const window = Math.pow(Math.sin(Math.PI * t), 0.58);
      const somaShoulder = 0.48 * Math.exp(-Math.pow((t - 0.08) / 0.19, 2));
      const distalCollar = 0.20 * Math.exp(-Math.pow((t - 0.90) / 0.13, 2));
      const slowPulse = window * (
        Math.sin(t * Math.PI * 1.7 + phase) * 0.10
        + Math.sin(t * Math.PI * 3.1 + phase * 0.61) * 0.045
      );
      const baseHalf = width * (0.72 + somaShoulder + distalCollar + slowPulse);
      const drift = width * window * (
        Math.sin(t * Math.PI * 2.3 + phase) * 0.11
        + Math.sin(t * Math.PI * 6.4 + phase * 0.73) * 0.035
      );
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const leftRipple = window * (
        Math.sin(t * Math.PI * 3.4 + phaseL) * 0.20
        + Math.sin(t * Math.PI * 8.7 + phaseR) * 0.065
        + Math.sin(t * Math.PI * 13.2 + phaseL * 0.43) * 0.025
      );
      const rightRipple = window * (
        Math.sin(t * Math.PI * 3.9 + phaseR) * 0.22
        + Math.sin(t * Math.PI * 7.8 + phaseL) * 0.070
        + Math.sin(t * Math.PI * 12.1 + phaseR * 0.49) * 0.027
      );

      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * baseHalf * (1 + leftRipple), y: cy + ny * baseHalf * (1 + leftRipple) });
      right.push({ x: cx - nx * baseHalf * (1 + rightRipple), y: cy - ny * baseHalf * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawTrunkBark(ctx, major, width, seed, interacting) {
    const bark = sampleTrunkBark(major, width, seed, interacting);
    const body = [...bark.left, ...bark.right.slice().reverse()];
    const detail = interacting ? 0.42 : 1;

    // A darker living mantle sits over the older clean rail silhouette and breaks it into one tissue body.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(7,21,67,${(0.34 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 3 : 16;
    ctx.shadowColor = `rgba(48,67,226,${(0.18 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(major.p0.x, major.p0.y, major.p3.x, major.p3.y);
    tissue.addColorStop(0, `rgba(99,74,247,${(0.24 * detail).toFixed(3)})`);
    tissue.addColorStop(0.24, `rgba(76,77,238,${(0.22 * detail).toFixed(3)})`);
    tissue.addColorStop(0.55, `rgba(42,105,231,${(0.18 * detail).toFixed(3)})`);
    tissue.addColorStop(0.82, `rgba(41,138,238,${(0.15 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(43,109,214,${(0.11 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    // Edge membranes stay deliberately faint so they do not recreate parallel neon rails.
    traceSmooth(ctx, bark.left);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.38, width * 0.032);
    ctx.strokeStyle = `rgba(121,177,255,${(0.13 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, bark.right);
    ctx.lineWidth = Math.max(0.38, width * 0.032);
    ctx.strokeStyle = `rgba(104,157,255,${(0.12 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    // Patchy internal tissue blooms break up the long uniform cable body.
    if (!interacting) {
      for (let pocket = 0; pocket < 9; pocket += 1) {
        const local = seed + pocket * 0.619;
        const t = 0.10 + ((pocket + 0.45 + hash(local, 1, 2) * 0.25) / 9.8) * 0.82;
        const p = bark.centre[Math.min(bark.centre.length - 1, Math.round(t * (bark.centre.length - 1)))];
        const radius = width * (0.26 + hash(local, 3, 4) * 0.30);
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius * 2.1);
        glow.addColorStop(0, 'rgba(125,105,255,.12)');
        glow.addColorStop(0.42, 'rgba(66,142,255,.07)');
        glow.addColorStop(1, 'rgba(46,89,225,0)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius * 2.1, 0, Math.PI * 2);
        ctx.fillStyle = glow;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function sampleBranch(curve, baseWidth, seed, interacting) {
    const count = interacting ? 12 : 24;
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
      const window = Math.pow(Math.sin(Math.PI * t), 0.72);
      const drift = baseWidth * window * (
        Math.sin(t * Math.PI * 2.0 + phase) * 0.12
        + Math.sin(t * Math.PI * 5.6 + phase * 0.71) * 0.04
      );
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const shoulder = 0.72 * Math.exp(-Math.pow(t / 0.22, 2));
      const taper = 0.12 + Math.pow(1 - t, 0.82) * 0.88 + shoulder;
      const half = baseWidth * taper;
      const leftRipple = window * (Math.sin(t * Math.PI * 3.7 + phaseL) * 0.18 + Math.sin(t * Math.PI * 8.2 + phaseR) * 0.05);
      const rightRipple = window * (Math.sin(t * Math.PI * 4.1 + phaseR) * 0.20 + Math.sin(t * Math.PI * 7.4 + phaseL) * 0.055);
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawBranchBody(ctx, curve, width, seed, interacting) {
    const detail = interacting ? 0.28 : 1;
    const branch = sampleBranch(curve, width, seed, interacting);
    const body = [...branch.left, ...branch.right.slice().reverse()];

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(24,47,138,${(0.16 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 10;
    ctx.shadowColor = `rgba(52,75,235,${(0.17 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(84,76,238,${(0.22 * detail).toFixed(3)})`);
    tissue.addColorStop(0.50, `rgba(44,105,228,${(0.18 * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(35,124,216,${(0.08 * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, branch.centre);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.34, width * 0.045);
    ctx.strokeStyle = `rgba(207,240,255,${(0.42 * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();

    if (interacting) return;

    const tangent = tangentOnCurve(curve, 0.91);
    const nx = -tangent.y;
    const ny = tangent.x;
    const forkBase = pointOnCurve(curve, 0.84);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let fork = 0; fork < 3; fork += 1) {
      const side = fork - 1;
      const local = seed + fork * 0.733;
      const reach = width * (1.6 + hash(local, 41, 2) * 1.9);
      const forward = reach * (0.62 + hash(local, 42, 3) * 0.46);
      const spread = side * reach * (0.52 + hash(local, 43, 4) * 0.32);
      const end = { x: forkBase.x + tangent.x * forward + nx * spread, y: forkBase.y + tangent.y * forward + ny * spread };
      ctx.beginPath();
      ctx.moveTo(forkBase.x, forkBase.y);
      ctx.quadraticCurveTo(
        forkBase.x + tangent.x * forward * 0.48 + nx * spread * 0.28,
        forkBase.y + tangent.y * forward * 0.48 + ny * spread * 0.28,
        end.x,
        end.y
      );
      ctx.lineWidth = fork === 1 ? 0.38 : 0.25;
      ctx.strokeStyle = fork === 1 ? 'rgba(150,220,255,.18)' : 'rgba(122,198,255,.12)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawRootShoulder(ctx, major, t, side, mainWidth, branchWidth, interacting) {
    const origin = pointOnCurve(major, t);
    const tangent = tangentOnCurve(major, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const centre = {
      x: origin.x + nx * side * mainWidth * 0.12 - tangent.x * branchWidth * 0.42,
      y: origin.y + ny * side * mainWidth * 0.12 - tangent.y * branchWidth * 0.42
    };
    const radius = branchWidth * (interacting ? 1.15 : 1.55);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius * 2.1);
    glow.addColorStop(0, interacting ? 'rgba(90,126,245,.05)' : 'rgba(85,98,235,.15)');
    glow.addColorStop(0.50, interacting ? 'rgba(66,101,220,.03)' : 'rgba(66,103,226,.08)');
    glow.addColorStop(1, 'rgba(48,72,205,0)');
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius * 2.1, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function drawMediumBranches(ctx, major, width, seed, interacting) {
    const positions = [0.08, 0.16, 0.25, 0.35, 0.46, 0.57, 0.68, 0.78, 0.87];
    const count = interacting ? 3 : positions.length;
    for (let arm = 0; arm < count; arm += 1) {
      const local = seed + arm * 0.613;
      const t = clamp(positions[arm] + (hash(local, 1, 2) - 0.5) * 0.034, 0.06, 0.91);
      const origin = pointOnCurve(major, t);
      const tangent = tangentOnCurve(major, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = hash(local, 3, 4) > 0.47 ? 1 : -1;
      const branchWidth = width * (0.15 + hash(local, 7, 8) * 0.075) * (1 - t * 0.16);
      const reach = width * (2.5 + hash(local, 5, 6) * 2.7) * (1 - t * 0.10);
      const start = {
        x: origin.x + nx * side * width * 0.07 - tangent.x * branchWidth * 0.82,
        y: origin.y + ny * side * width * 0.07 - tangent.y * branchWidth * 0.82
      };
      const forward = reach * (0.98 + hash(local, 9, 10) * 0.75);
      const lateral = reach * (0.35 + hash(local, 11, 12) * 0.40) * side;
      const end = { x: origin.x + tangent.x * forward + nx * lateral, y: origin.y + tangent.y * forward + ny * lateral };
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const bx = -dy / len;
      const by = dx / len;
      const bend = (hash(local, 13, 14) - 0.5) * reach * 0.16;
      const curve = {
        p0: start,
        p1: {
          x: start.x + tangent.x * reach * 0.50 + nx * side * reach * 0.07 + bx * bend,
          y: start.y + tangent.y * reach * 0.50 + ny * side * reach * 0.07 + by * bend
        },
        p2: {
          x: start.x + dx * 0.74 + nx * side * reach * 0.045 + bx * bend * 0.45,
          y: start.y + dy * 0.74 + ny * side * reach * 0.045 + by * bend * 0.45
        },
        p3: end,
        length: distance(start, end)
      };
      drawRootShoulder(ctx, major, t, side, width, branchWidth, interacting);
      drawBranchBody(ctx, curve, branchWidth, local, interacting);
    }
  }

  function drawMicroRoots(ctx, major, width, seed, interacting) {
    const mobile = sourceCanvas?.clientWidth < 760;
    const count = interacting ? 8 : (mobile ? 18 : 30);
    const tips = [];
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 0; index < count; index += 1) {
      const local = seed + index * 0.347;
      const t = 0.045 + ((index + 0.35 + hash(local, 1, 2) * 0.40) / (count + 0.7)) * 0.91;
      const origin = pointOnCurve(major, t);
      const tangent = tangentOnCurve(major, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = hash(local, 3, 4) > 0.5 ? 1 : -1;
      const reach = width * (1.4 + hash(local, 5, 6) * 2.7);
      const forward = reach * (0.25 + hash(local, 7, 8) * 0.72);
      const start = { x: origin.x + nx * side * width * 0.20, y: origin.y + ny * side * width * 0.20 };
      const end = { x: origin.x + nx * side * reach + tangent.x * forward, y: origin.y + ny * side * reach + tangent.y * forward };
      const mid = {
        x: start.x + (end.x - start.x) * 0.52 + nx * side * reach * 0.16,
        y: start.y + (end.y - start.y) * 0.52 + ny * side * reach * 0.16
      };
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = interacting ? 0.20 : 0.30 + hash(local, 9, 10) * 0.22;
      ctx.strokeStyle = interacting ? 'rgba(92,166,255,.05)' : 'rgba(108,192,255,.21)';
      previousStroke.call(ctx);
      if (!interacting) tips.push(end);

      if (!interacting && hash(local, 11, 12) > 0.42) {
        const fork = {
          x: mid.x + nx * side * reach * 0.40 + tangent.x * reach * (hash(local, 13, 14) - 0.45),
          y: mid.y + ny * side * reach * 0.40 + tangent.y * reach * (hash(local, 13, 14) - 0.45)
        };
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.quadraticCurveTo((mid.x + fork.x) * 0.5, (mid.y + fork.y) * 0.5, fork.x, fork.y);
        ctx.lineWidth = 0.24;
        ctx.strokeStyle = 'rgba(148,216,255,.15)';
        previousStroke.call(ctx);
        tips.push(fork);
      }
    }

    if (!interacting) {
      for (let index = 2; index < tips.length; index += 3) {
        const a = tips[index - 2];
        const b = tips[index];
        if (distance(a, b) > width * 5.5) continue;
        const mid = {
          x: (a.x + b.x) * 0.5 + (hash(seed, index, 21) - 0.5) * width,
          y: (a.y + b.y) * 0.5 + (hash(seed, index, 22) - 0.5) * width
        };
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
        ctx.lineWidth = 0.19;
        ctx.strokeStyle = 'rgba(116,194,255,.10)';
        previousStroke.call(ctx);
      }
    }
    ctx.restore();
  }

  function drawTrunkMesh(ctx, major, width, seed, interacting) {
    if (interacting) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let lane = 0; lane < 7; lane += 1) {
      const points = [];
      const laneSeed = seed + lane * 0.817;
      const offsetBase = (lane - 3) * width * 0.13;
      for (let step = 0; step <= 30; step += 1) {
        const t = step / 30;
        const p = pointOnCurve(major, t);
        const tangent = tangentOnCurve(major, t);
        const nx = -tangent.y;
        const ny = tangent.x;
        const window = Math.sin(Math.PI * t);
        const wobble = offsetBase + width * window * (
          Math.sin(t * Math.PI * (2.1 + lane * 0.37) + laneSeed * 4.7) * 0.085
          + Math.sin(t * Math.PI * 7.3 + laneSeed * 7.9) * 0.030
        );
        points.push({ x: p.x + nx * wobble, y: p.y + ny * wobble });
      }
      traceSmooth(ctx, points);
      ctx.lineWidth = lane === 3 ? 0.36 : 0.23;
      ctx.strokeStyle = lane === 3 ? 'rgba(198,236,255,.20)' : 'rgba(103,181,255,.12)';
      previousStroke.call(ctx);
    }

    for (let rib = 1; rib < 22; rib += 1) {
      const t = rib / 22 + (hash(seed, rib, 31) - 0.5) * 0.018;
      const p = pointOnCurve(major, clamp(t, 0.04, 0.96));
      const tangent = tangentOnCurve(major, clamp(t, 0.04, 0.96));
      const nx = -tangent.y;
      const ny = tangent.x;
      const half = width * (0.36 + hash(seed, rib, 32) * 0.30);
      const a = { x: p.x + nx * half, y: p.y + ny * half };
      const b = { x: p.x - nx * half, y: p.y - ny * half };
      const bend = (hash(seed, rib, 33) - 0.5) * width * 0.44;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(p.x + tangent.x * bend, p.y + tangent.y * bend, b.x, b.y);
      ctx.lineWidth = 0.19;
      ctx.strokeStyle = 'rgba(137,207,255,.10)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function traceNexusMantle(ctx, nexus, roots, radius, seed, scale = 1) {
    const count = 72;
    ctx.beginPath();
    for (let index = 0; index <= count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      let lobe = 0;
      for (const root of roots) {
        const rootAngle = Math.atan2(root.centre.y - nexus.y, root.centre.x - nexus.x);
        const align = Math.max(0, Math.cos(angle - rootAngle));
        lobe = Math.max(lobe, Math.pow(align, 5) * 0.46);
      }
      const shape = 0.82
        + lobe
        + Math.sin(angle * 3 + seed * 5.7) * 0.085
        + Math.sin(angle * 7 + seed * 11.9) * 0.050
        + Math.sin(angle * 13 + seed * 19.3) * 0.022;
      const x = nexus.x + Math.cos(angle) * radius * shape * scale;
      const y = nexus.y + Math.sin(angle) * radius * shape * scale;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawNexusMantle(ctx, nexus, roots, interacting) {
    const detail = interacting ? 0.40 : 1;
    const radius = clamp(50 + roots.length * 7, 64, 92);
    const seed = nexus.x * 0.0013 + nexus.y * 0.0019 + roots.length * 0.81;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceNexusMantle(ctx, nexus, roots, radius, seed);
    ctx.shadowBlur = interacting ? 5 : 20;
    ctx.shadowColor = `rgba(53,68,222,${(0.22 * detail).toFixed(3)})`;
    const base = ctx.createRadialGradient(nexus.x, nexus.y, radius * 0.04, nexus.x, nexus.y, radius * 1.02);
    base.addColorStop(0, `rgba(34,49,130,${(0.34 * detail).toFixed(3)})`);
    base.addColorStop(0.48, `rgba(26,39,111,${(0.27 * detail).toFixed(3)})`);
    base.addColorStop(0.82, `rgba(16,30,87,${(0.17 * detail).toFixed(3)})`);
    base.addColorStop(1, 'rgba(11,23,70,0)');
    ctx.fillStyle = base;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceNexusMantle(ctx, nexus, roots, radius, seed + 0.371, 0.80);
    const tissue = ctx.createRadialGradient(nexus.x - radius * 0.10, nexus.y - radius * 0.08, 0, nexus.x, nexus.y, radius * 0.80);
    tissue.addColorStop(0, `rgba(117,98,255,${(0.24 * detail).toFixed(3)})`);
    tissue.addColorStop(0.42, `rgba(68,121,248,${(0.20 * detail).toFixed(3)})`);
    tissue.addColorStop(0.78, `rgba(42,89,218,${(0.13 * detail).toFixed(3)})`);
    tissue.addColorStop(1, 'rgba(52,70,214,0)');
    ctx.fillStyle = tissue;
    ctx.fill();
    ctx.restore();
  }

  function drawNexusLace(ctx, nexus, roots, interacting) {
    if (interacting) return;
    const radius = clamp(50 + roots.length * 7, 64, 92);
    const seed = nexus.x * 0.0011 + nexus.y * 0.0017 + roots.length * 0.71;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';

    for (let index = 0; index < 46; index += 1) {
      const local = seed + index * 0.433;
      const angle = (index / 46) * Math.PI * 2 + (hash(local, 1, 2) - 0.5) * 0.28;
      const r0 = radius * (0.10 + hash(local, 3, 4) * 0.28);
      const r1 = radius * (0.60 + hash(local, 5, 6) * 0.62);
      const a = { x: nexus.x + Math.cos(angle) * r0, y: nexus.y + Math.sin(angle) * r0 };
      const twist = angle + (hash(local, 7, 8) - 0.5) * 0.95;
      const b = { x: nexus.x + Math.cos(twist) * r1, y: nexus.y + Math.sin(twist) * r1 };
      const midAngle = (angle + twist) * 0.5 + (hash(local, 9, 10) - 0.5) * 0.60;
      const midRadius = (r0 + r1) * 0.52;
      const m = { x: nexus.x + Math.cos(midAngle) * midRadius, y: nexus.y + Math.sin(midAngle) * midRadius };
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(m.x, m.y, b.x, b.y);
      ctx.lineWidth = index % 8 === 0 ? 0.50 : 0.27;
      ctx.strokeStyle = index % 8 === 0 ? 'rgba(184,230,255,.22)' : 'rgba(109,195,255,.14)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawSharedArms(ctx, roots, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    roots.forEach((root, index) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      const major = controlPoints(nexus, root.centre, seed, 0.78, index + 1);
      const width = clamp(major.length * 0.055, 10, 20);
      drawTrunkBark(ctx, major, width, seed + 0.07, interacting);
      drawTrunkMesh(ctx, major, width, seed + 0.17, interacting);
      drawMicroRoots(ctx, major, width, seed + 0.29, interacting);
      drawMediumBranches(ctx, major, width, seed + 0.39, interacting);
    });
    drawNexusMantle(ctx, nexus, roots, interacting);
    drawNexusLace(ctx, nexus, roots, interacting);
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
        opacity:.90;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralArms = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();