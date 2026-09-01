(() => {
  'use strict';

  const VERSION = 2;
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

  const FRAME_MS = 72;
  const INTERACTING_FRAME_MS = 164;
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

  function majorCurve(from, to, seed, lane = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const side = hash(seed, lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.10 + hash(seed, lane, 2) * 0.11), 12, 94) * 0.78;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.18;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.27 + skew) + px * bend * 0.76, y: from.y + dy * (0.27 + skew) + py * bend * 0.76 },
      p2: { x: from.x + dx * (0.71 - skew) + px * bend, y: from.y + dy * (0.71 - skew) + py * bend },
      p3: to,
      length
    };
  }

  function bundledCurve(from, to, seed, index) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const side = hash(seed, index, 41) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.065 + hash(seed, index, 42) * 0.075), 4, 22);
    const skew = (hash(seed, index, 43) - 0.5) * 0.09;
    return {
      p0: from,
      p1: { x: from.x + dx * (0.32 + skew) + nx * bend * 0.46, y: from.y + dy * (0.32 + skew) + ny * bend * 0.46 },
      p2: { x: from.x + dx * (0.73 - skew) + nx * bend, y: from.y + dy * (0.73 - skew) + ny * bend },
      p3: to,
      length
    };
  }

  function sampleTube(curve, baseWidth, seed, interacting, endScale = 0.08) {
    const count = interacting ? 12 : 30;
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
      const window = Math.pow(Math.sin(Math.PI * t), 0.62);
      const shoulder = 0.78 * Math.exp(-Math.pow(t / 0.22, 2));
      const taper = endScale + Math.pow(1 - t, 0.74) * (0.92 - endScale) + shoulder * 0.46;
      const drift = baseWidth * window * (Math.sin(t * Math.PI * 2.0 + phase) * 0.12 + Math.sin(t * Math.PI * 6.4 + phase * 0.71) * 0.040);
      const cx = p.x + nx * drift;
      const cy = p.y + ny * drift;
      const leftRipple = window * (Math.sin(t * Math.PI * 3.4 + phaseL) * 0.22 + Math.sin(t * Math.PI * 8.3 + phaseR) * 0.055);
      const rightRipple = window * (Math.sin(t * Math.PI * 3.9 + phaseR) * 0.24 + Math.sin(t * Math.PI * 7.6 + phaseL) * 0.060);
      const half = baseWidth * taper;
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * half * (1 + leftRipple), y: cy + ny * half * (1 + leftRipple) });
      right.push({ x: cx - nx * half * (1 + rightRipple), y: cy - ny * half * (1 + rightRipple) });
    }
    return { left, right, centre };
  }

  function drawTube(ctx, curve, width, seed, interacting, brightness = 1, endScale = 0.08) {
    const tube = sampleTube(curve, width, seed, interacting, endScale);
    const body = [...tube.left, ...tube.right.slice().reverse()];
    const detail = interacting ? 0.40 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = `rgba(7,27,78,${(0.46 * detail).toFixed(3)})`;
    ctx.shadowBlur = interacting ? 2 : 9;
    ctx.shadowColor = `rgba(54,89,235,${(0.18 * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    tissue.addColorStop(0, `rgba(118,93,248,${(0.34 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(0.44, `rgba(72,129,244,${(0.30 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(0.80, `rgba(48,157,239,${(0.21 * detail * brightness).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(42,122,211,${(0.06 * detail * brightness).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, tube.centre);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.22, width * 0.042);
    ctx.strokeStyle = `rgba(113,207,255,${(0.29 * detail * brightness).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmooth(ctx, tube.centre);
    ctx.lineWidth = Math.max(0.15, width * 0.018);
    ctx.strokeStyle = `rgba(235,251,255,${(0.53 * detail * brightness).toFixed(3)})`;
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
    ctx.lineWidth = Math.max(6.0, width * (interacting ? 1.44 : 1.80));
    ctx.strokeStyle = interacting ? 'rgba(3,13,31,.60)' : 'rgba(3,13,31,.95)';
    previousStroke.call(ctx);
    ctx.restore();
  }

  function rootDirection(root, candidates) {
    let sx = 0;
    let sy = 0;
    for (const segment of candidates) {
      const dx = segment.to.x - root.centre.x;
      const dy = segment.to.y - root.centre.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.001) continue;
      sx += dx / length;
      sy += dy / length;
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
    const radius = clamp(width * 1.45 + count * 0.24, 8.5, 14.5);
    const seed = root.centre.x * 0.0017 + root.centre.y * 0.0023 + count * 0.61;
    const points = [];
    for (let index = 0; index < 48; index += 1) {
      const angle = (index / 48) * Math.PI * 2;
      const directional = Math.max(0, Math.cos(angle - Math.atan2(hub.y - root.centre.y, hub.x - root.centre.x)));
      const wobble = 0.76 + Math.pow(directional, 4) * 0.55 + Math.sin(angle * 3 + seed * 7.1) * 0.11 + Math.sin(angle * 8 + seed * 11.3) * 0.055;
      const r = radius * wobble;
      points.push({ x: root.centre.x + Math.cos(angle) * r, y: root.centre.y + Math.sin(angle) * r });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, points, true);
    ctx.fillStyle = interacting ? 'rgba(6,27,76,.32)' : 'rgba(6,27,76,.60)';
    ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(root.centre.x, root.centre.y, 0, root.centre.x, root.centre.y, radius * 1.65);
    glow.addColorStop(0, interacting ? 'rgba(132,128,255,.13)' : 'rgba(132,128,255,.30)');
    glow.addColorStop(0.50, interacting ? 'rgba(75,171,255,.07)' : 'rgba(75,171,255,.19)');
    glow.addColorStop(1, 'rgba(54,104,222,0)');
    ctx.beginPath();
    ctx.arc(root.centre.x, root.centre.y, radius * 1.65, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function drawLocalWeave(ctx, root, hub, branches, width, seed, interacting) {
    if (interacting || branches.length < 3) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const ring = [];
    for (let index = 0; index < branches.length; index += 1) {
      const curve = branches[index];
      ring.push(pointOnCurve(curve, 0.31 + (index % 3) * 0.045));
    }
    ring.sort((a, b) => Math.atan2(a.y - hub.y, a.x - hub.x) - Math.atan2(b.y - hub.y, b.x - hub.x));

    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (distance(a, b) > width * 8.8) continue;
      const local = seed + index * 0.437;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(
        (a.x + b.x + hub.x) / 3 + (hash(local, 1, 2) - 0.5) * width * 1.4,
        (a.y + b.y + hub.y) / 3 + (hash(local, 3, 4) - 0.5) * width * 1.4,
        b.x,
        b.y
      );
      ctx.lineWidth = 0.18 + hash(local, 5, 6) * 0.12;
      ctx.strokeStyle = 'rgba(126,205,255,.15)';
      previousStroke.call(ctx);
    }

    for (let index = 0; index < Math.min(10, branches.length * 2); index += 1) {
      const local = seed + index * 0.713;
      const curve = branches[index % branches.length];
      const t = 0.18 + hash(local, 7, 8) * 0.44;
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const side = index % 2 ? -1 : 1;
      const reach = width * (1.3 + hash(local, 9, 10) * 2.1);
      const end = { x: p.x + nx * side * reach + tangent.x * reach * (hash(local, 11, 12) - 0.40), y: p.y + ny * side * reach + tangent.y * reach * (hash(local, 11, 12) - 0.40) };
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo((p.x + end.x) * 0.5 + nx * side * reach * 0.12, (p.y + end.y) * 0.5 + ny * side * reach * 0.12, end.x, end.y);
      ctx.lineWidth = 0.17;
      ctx.strokeStyle = 'rgba(119,198,255,.12)';
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

    const baseWidth = clamp(3.9 + candidates.length * 0.24, 4.3, 6.0);
    const averageLength = candidates.reduce((sum, segment) => sum + segment.length, 0) / candidates.length;
    const direction = rootDirection(root, candidates);
    const hubDistance = clamp(averageLength * 0.20, 17, 31);
    const hub = { x: root.centre.x + direction.x * hubDistance, y: root.centre.y + direction.y * hubDistance };

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
    const stemBend = (hash(stemSeed, 80, 81) - 0.5) * clamp(stemLength * 0.28, 2, 8);
    const stem = {
      p0: root.centre,
      p1: { x: root.centre.x + stemDx * 0.34 + stemNx * stemBend, y: root.centre.y + stemDy * 0.34 + stemNy * stemBend },
      p2: { x: root.centre.x + stemDx * 0.72 + stemNx * stemBend * 0.55, y: root.centre.y + stemDy * 0.72 + stemNy * stemBend * 0.55 },
      p3: hub,
      length: stemLength
    };
    drawTube(ctx, stem, baseWidth * 1.72, stemSeed, interacting, 0.88, 0.72);

    const childCurves = [];
    candidates.forEach((segment, index) => {
      const local = segment.seed + rootIndex * 0.731 + index * 0.417;
      const width = baseWidth * (0.92 - Math.min(index, 6) * 0.045) * clamp(segment.length / 78, 0.80, 1.15);
      const curve = bundledCurve(hub, segment.to, local, index);
      childCurves.push(curve);
      drawTube(ctx, curve, width, local, interacting, 0.74, 0.035);
    });
    drawLocalWeave(ctx, root, hub, childCurves, baseWidth, stemSeed + 0.57, interacting);
  }

  function drawGlobalWeb(ctx, roots, interacting) {
    if (interacting || roots.length < 2) return;
    const nexus = nexusPoint(roots);
    const seed = roots.length * 0.71 + nexus.x * 0.0011 + nexus.y * 0.0017;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    roots.forEach((root, rootIndex) => {
      const rootSeed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + rootIndex * 0.731));
      const curve = majorCurve(nexus, root.centre, rootSeed, rootIndex + 1);
      const width = clamp(curve.length * 0.068, 14, 26);
      const count = 18;
      let previousLeft = null;
      let previousRight = null;
      for (let index = 0; index < count; index += 1) {
        const local = rootSeed + index * 0.391;
        const t = 0.06 + (index / (count - 1)) * 0.88;
        const p = pointOnCurve(curve, t);
        const tangent = tangentOnCurve(curve, t);
        const nx = -tangent.y;
        const ny = tangent.x;
        const leftReach = width * (1.35 + hash(local, 21, 22) * 2.2);
        const rightReach = width * (1.30 + hash(local, 23, 24) * 2.25);
        const left = { x: p.x + nx * leftReach + tangent.x * width * (hash(local, 25, 26) - 0.5) * 1.4, y: p.y + ny * leftReach + tangent.y * width * (hash(local, 25, 26) - 0.5) * 1.4 };
        const right = { x: p.x - nx * rightReach + tangent.x * width * (hash(local, 27, 28) - 0.5) * 1.4, y: p.y - ny * rightReach + tangent.y * width * (hash(local, 27, 28) - 0.5) * 1.4 };
        if (previousLeft && previousRight) {
          ctx.beginPath();
          ctx.moveTo(previousLeft.x, previousLeft.y);
          ctx.quadraticCurveTo((previousLeft.x + left.x) * 0.5, (previousLeft.y + left.y) * 0.5, left.x, left.y);
          ctx.lineWidth = 0.18 + hash(local, 29, 30) * 0.16;
          ctx.strokeStyle = 'rgba(100,188,255,.12)';
          previousStroke.call(ctx);

          ctx.beginPath();
          ctx.moveTo(previousRight.x, previousRight.y);
          ctx.quadraticCurveTo((previousRight.x + right.x) * 0.5, (previousRight.y + right.y) * 0.5, right.x, right.y);
          ctx.lineWidth = 0.17 + hash(local, 31, 32) * 0.15;
          ctx.strokeStyle = 'rgba(96,172,248,.105)';
          previousStroke.call(ctx);

          if (index % 2 === 0) {
            const a = index % 4 === 0 ? previousLeft : previousRight;
            const b = index % 4 === 0 ? right : left;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.quadraticCurveTo(p.x, p.y, b.x, b.y);
            ctx.lineWidth = 0.15;
            ctx.strokeStyle = 'rgba(139,211,255,.09)';
            previousStroke.call(ctx);
          }
        }
        previousLeft = left;
        previousRight = right;
      }
    });

    const averageDistance = roots.reduce((sum, root) => sum + distance(nexus, root.centre), 0) / roots.length;
    const radius = clamp(averageDistance * 0.115, 62, 112);
    const ringCount = 42;
    const ring = [];
    for (let index = 0; index < ringCount; index += 1) {
      const local = seed + index * 0.277;
      const angle = (index / ringCount) * Math.PI * 2 + (hash(local, 40, 41) - 0.5) * 0.18;
      const r = radius * (0.46 + hash(local, 42, 43) * 0.72);
      ring.push({ x: nexus.x + Math.cos(angle) * r, y: nexus.y + Math.sin(angle) * r });
    }
    for (let index = 0; index < ring.length; index += 1) {
      const local = seed + index * 0.513;
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const c = ring[(index + 6 + (index % 4)) % ring.length];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo((a.x + b.x + nexus.x) / 3, (a.y + b.y + nexus.y) / 3, b.x, b.y);
      ctx.lineWidth = 0.18 + hash(local, 44, 45) * 0.18;
      ctx.strokeStyle = 'rgba(122,205,255,.15)';
      previousStroke.call(ctx);
      if (index % 2 === 0) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(nexus.x + (hash(local, 46, 47) - 0.5) * radius * 0.40, nexus.y + (hash(local, 48, 49) - 0.5) * radius * 0.40, c.x, c.y);
        ctx.lineWidth = 0.15;
        ctx.strokeStyle = 'rgba(157,222,255,.10)';
        previousStroke.call(ctx);
      }
      if (index % 5 === 1) {
        const r = 0.55 + hash(local, 50, 51) * 0.70;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(234,250,255,.48)';
        ctx.shadowBlur = 5;
        ctx.shadowColor = 'rgba(86,185,255,.45)';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
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
    const roots = rootGroups(segments);
    drawGlobalWeb(layerContext, roots, interacting);
    roots.forEach((root, index) => drawRootBundle(layerContext, root, index, interacting));
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
