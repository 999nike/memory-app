(() => {
  'use strict';

  const VERSION = 10;
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
  // The chosen anatomical route follows its root while the graph moves.  It is
  // seeded from geometry, never from canvas capture order.
  let focusRootAnchor = null;

  const FRAME_MS = 42;
  const INTERACTING_FRAME_MS = 84;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const lerp = (a, b, t) => a + (b - a) * t;
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7127.913 + a * 79.117 + b * 193.731) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNexusStart || !ctx?.__memoryNexusEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
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
    const bend = side * clamp(length * (0.10 + hash(seed, lane, 2) * 0.11), 12, 94) * bendScale;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.18;
    return {
      p0: from,
      p1: {
        x: from.x + dx * (0.27 + skew) + px * bend * 0.76,
        y: from.y + dy * (0.27 + skew) + py * bend * 0.76
      },
      p2: {
        x: from.x + dx * (0.71 - skew) + px * bend,
        y: from.y + dy * (0.71 - skew) + py * bend
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

  function traceSmoothOpen(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 1) return;
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  function traceClosedTube(ctx, tube) {
    const points = [...tube.left, ...tube.right.slice().reverse()];
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index <= points.length; index += 1) {
      const current = points[index % points.length];
      const next = points[(index + 1) % points.length];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    ctx.closePath();
  }

  function organicTubePoints(curve, width, seed, interacting, focus = false) {
    const sampleCount = interacting ? 24 : 52;
    const left = [];
    const right = [];
    const centre = [];
    const phaseCentre = hash(seed, 2, 7) * Math.PI * 2;
    const phaseLeftA = hash(seed, 4, 1) * Math.PI * 2;
    const phaseLeftB = hash(seed, 5, 2) * Math.PI * 2;
    const phaseRightA = hash(seed, 6, 3) * Math.PI * 2;
    const phaseRightB = hash(seed, 7, 4) * Math.PI * 2;
    const leftFrequency = 2.6 + hash(seed, 8, 5) * 2.1;
    const rightFrequency = 2.9 + hash(seed, 9, 6) * 2.3;

    for (let index = 0; index <= sampleCount; index += 1) {
      const t = index / sampleCount;
      const point = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const nx = -tangent.y;
      const ny = tangent.x;
      const edgeWindow = Math.pow(Math.sin(Math.PI * t), 0.52);

      const nexusSwell = 0.82 * Math.exp(-Math.pow((t - 0.08) / 0.22, 2));
      const distalSwell = 0.28 * Math.exp(-Math.pow((t - 0.90) / 0.16, 2));
      const midSwell = 0.16 * Math.exp(-Math.pow((t - (0.43 + hash(seed, 18, 2) * 0.18)) / 0.24, 2));
      const rhythm = edgeWindow * (
        Math.sin(t * Math.PI * 1.55 + phaseCentre) * 0.10
        + Math.sin(t * Math.PI * 4.1 + phaseCentre * 0.61) * 0.038
      );
      // The focus root keeps a full distal collar so its app end stays visibly
      // attached.  The other accepted routes retain their recovered V8 shape.
      const distalFloor = focus ? 0.88 : 0.63;
      const taper = distalFloor + (1 - t) * (focus ? 0.24 : 0.37)
        + nexusSwell + distalSwell + midSwell + rhythm;
      const baseHalfWidth = width * 0.82 * taper;

      const centreDrift = width * edgeWindow * (
        Math.sin(t * Math.PI * 1.95 + phaseCentre) * 0.14
        + Math.sin(t * Math.PI * 4.8 + phaseCentre * 0.73) * 0.052
      );
      const cx = point.x + nx * centreDrift;
      const cy = point.y + ny * centreDrift;

      const leftRipple = edgeWindow * (
        Math.sin(t * Math.PI * leftFrequency + phaseLeftA) * 0.25
        + Math.sin(t * Math.PI * (leftFrequency * 2.45) + phaseLeftB) * 0.095
        + Math.sin(t * Math.PI * 0.84 + phaseLeftB * 0.55) * 0.070
      );
      const rightRipple = edgeWindow * (
        Math.sin(t * Math.PI * rightFrequency + phaseRightA) * 0.27
        + Math.sin(t * Math.PI * (rightFrequency * 2.15) + phaseRightB) * 0.10
        + Math.sin(t * Math.PI * 1.04 + phaseRightA * 0.61) * 0.068
      );

      const leftWidth = baseHalfWidth * (1 + leftRipple);
      const rightWidth = baseHalfWidth * (1 + rightRipple);
      centre.push({ x: cx, y: cy });
      left.push({ x: cx + nx * leftWidth, y: cy + ny * leftWidth });
      right.push({ x: cx - nx * rightWidth, y: cy - ny * rightWidth });
    }

    return { left, right, centre };
  }

  function interiorLane(tube, ratio, seed) {
    return tube.left.map((left, index) => {
      const right = tube.right[index];
      const t = index / Math.max(1, tube.left.length - 1);
      const localRatio = clamp(
        ratio + Math.sin(t * Math.PI * (2.4 + seed * 0.7) + seed * 9.1) * 0.055,
        0.12,
        0.88
      );
      return { x: lerp(left.x, right.x, localRatio), y: lerp(left.y, right.y, localRatio) };
    });
  }

  function drawTrunkFibres(ctx, tube, curve, width, seed, interacting, focus = false) {
    // Grow bounded forks from the rendered tissue itself, on this existing canvas.
    // No independent overlay, recursive growth, particle loop or endpoint changes.
    const count = interacting ? 4 : focus ? 6 : 9;
    const branches = [];
    const synapses = [];
    for (let index = 0; index < count; index += 1) {
      for (const side of [-1, 1]) {
        const t = 0.16 + index / Math.max(1, count - 1) * 0.66
          + (hash(seed, index, side + 8) - 0.5) * 0.055;
        const sample = Math.round(t * (tube.centre.length - 1));
        const anchor = tube.centre[sample];
        const tangent = tangentOnCurve(curve, t);
        const nx = -tangent.y * side, ny = tangent.x * side;
        const reach = clamp(curve.length * 0.17, 24, 66) * (0.42 + hash(seed, index, side + 4) * 0.86);
        const sweep = -0.2 + hash(seed, index, side + 12) * 1.1;
        const control = { x: anchor.x + nx * width * 1.4 + tangent.x * reach * sweep,
          y: anchor.y + ny * width * 1.4 + tangent.y * reach * sweep };
        const tip = { x: anchor.x + nx * reach + tangent.x * reach * sweep * 1.3,
          y: anchor.y + ny * reach + tangent.y * reach * sweep * 1.3 };
        // A quadratic control point is off the drawn curve. Attach forks at B(.55).
        const u = 0.55, v = 1 - u;
        const join = { x: v * v * anchor.x + 2 * v * u * control.x + u * u * tip.x,
          y: v * v * anchor.y + 2 * v * u * control.y + u * u * tip.y };
        const fork = { x: join.x + nx * reach * 0.44 - tangent.x * reach * 0.36,
          y: join.y + ny * reach * 0.44 - tangent.y * reach * 0.36 };
        branches.push([anchor, control, tip], [join, {
          x: join.x + nx * reach * 0.24, y: join.y + ny * reach * 0.24
        }, fork]);
        synapses.push(join);
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.shadowBlur = 0;
    ctx.lineCap = 'round';
    // Each pass batches every fork; work is bounded per trunk.
    ctx.beginPath();
    for (const [start, control, end] of branches) {
      ctx.moveTo(start.x, start.y);
      ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    }
    ctx.lineWidth = interacting ? 1.4 : 2.4;
    ctx.strokeStyle = 'rgba(44,99,245,.16)';
    previousStroke.call(ctx);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = 'rgba(103,195,255,.42)';
    previousStroke.call(ctx);
    if (!interacting) {
      ctx.beginPath();
      for (const point of synapses) {
        ctx.moveTo(point.x + 1.25, point.y);
        ctx.arc(point.x, point.y, 1.25, 0, Math.PI * 2);
      }
      ctx.fillStyle = 'rgba(168,231,255,.78)';
      ctx.fill();
      // Cross fibres share the same tube samples as the longitudinal strands.
      ctx.beginPath();
      for (let index = 3; index < tube.centre.length - 4; index += 4) {
        const left = tube.left[index], right = tube.right[index + 3];
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(tube.centre[index + 1].x, tube.centre[index + 1].y);
        ctx.lineTo(right.x, right.y);
      }
      ctx.lineWidth = 0.48;
      ctx.strokeStyle = 'rgba(127,194,255,.38)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawOrganicTube(ctx, curve, width, seed, interacting, focus = false) {
    const tube = organicTubePoints(curve, width, seed, interacting, focus);
    const detail = interacting ? 0.62 : focus ? 1.18 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceClosedTube(ctx, tube);
    ctx.shadowBlur = interacting ? 2 : focus ? 13 : 8;
    ctx.shadowColor = `rgba(46,67,228,${((focus ? 0.38 : 0.26) * detail).toFixed(3)})`;
    ctx.fillStyle = `rgba(20,43,128,${((focus ? 0.13 : 0.08) * detail).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceClosedTube(ctx, tube);
    const tissue = ctx.createLinearGradient(curve.p0.x, curve.p0.y, curve.p3.x, curve.p3.y);
    const tissueGain = focus ? 1.7 : 1;
    tissue.addColorStop(0, `rgba(113,73,255,${(0.14 * tissueGain * detail).toFixed(3)})`);
    tissue.addColorStop(0.23, `rgba(74,85,249,${(0.12 * tissueGain * detail).toFixed(3)})`);
    tissue.addColorStop(0.54, `rgba(42,112,235,${(0.10 * tissueGain * detail).toFixed(3)})`);
    tissue.addColorStop(0.80, `rgba(38,138,236,${(0.085 * tissueGain * detail).toFixed(3)})`);
    tissue.addColorStop(1, `rgba(44,106,207,${(0.06 * tissueGain * detail).toFixed(3)})`);
    ctx.fillStyle = tissue;
    ctx.fill();

    if (!interacting) {
      const lanes = [
        { ratio: 0.32, alpha: focus ? 0.52 : 0.42, width: Math.max(0.42, width * (focus ? 0.046 : 0.035)) },
        { ratio: 0.50, alpha: focus ? 0.76 : 0.60, width: Math.max(0.45, width * (focus ? 0.060 : 0.040)) },
        { ratio: 0.68, alpha: focus ? 0.50 : 0.40, width: Math.max(0.38, width * (focus ? 0.040 : 0.030)) }
      ];
      lanes.forEach((lane, laneIndex) => {
        traceSmoothOpen(ctx, interiorLane(tube, lane.ratio, seed + laneIndex * 0.73));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = lane.width;
        ctx.strokeStyle = `rgba(129,205,255,${lane.alpha.toFixed(3)})`;
        previousStroke.call(ctx);
      });
    }

    ctx.shadowBlur = interacting ? 0 : 2;
    traceSmoothOpen(ctx, tube.left);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.48, width * 0.038);
    ctx.strokeStyle = `rgba(126,173,255,${(0.26 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceSmoothOpen(ctx, tube.right);
    ctx.lineWidth = Math.max(0.48, width * 0.038);
    ctx.strokeStyle = `rgba(111,158,249,${(0.22 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    traceSmoothOpen(ctx, tube.centre);
    ctx.lineWidth = Math.max(focus ? 1.05 : 0.75, width * (focus ? 0.078 : 0.050));
    ctx.strokeStyle = `rgba(64,166,255,${((focus ? 0.68 : 0.50) * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    traceSmoothOpen(ctx, tube.centre);
    ctx.lineWidth = Math.max(focus ? 0.78 : 0.55, width * (focus ? 0.040 : 0.026));
    ctx.strokeStyle = `rgba(226,248,255,${Math.min(0.98, (focus ? 1 : 0.95) * detail).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();
    drawTrunkFibres(ctx, tube, curve, width, seed, interacting, focus);
  }

  function angleDelta(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  function nexusRootLobe(angle, point, roots) {
    let influence = 0;
    for (const root of roots) {
      const rootAngle = Math.atan2(root.centre.y - point.y, root.centre.x - point.x);
      const alignment = Math.max(0, Math.cos(angleDelta(angle, rootAngle)));
      influence = Math.max(influence, Math.pow(alignment, 5) * 0.34);
    }
    return influence;
  }

  function traceOrganicNexus(ctx, point, radius, seed, roots, scale = 1) {
    const count = 72;
    ctx.beginPath();
    for (let index = 0; index <= count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      const lobe = nexusRootLobe(angle, point, roots);
      const shape = 0.86
        + lobe
        + Math.sin(angle * 2 + seed * 5.3) * 0.060
        + Math.sin(angle * 5 + seed * 11.1) * 0.075
        + Math.sin(angle * 9 + seed * 17.7) * 0.036
        + Math.sin(angle * 13 + seed * 23.9) * 0.020;
      const x = point.x + Math.cos(angle) * radius * shape * scale;
      const y = point.y + Math.sin(angle) * radius * shape * scale;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawNexusWeb(ctx, point, radius, seed, interacting) {
    if (interacting) return;
    // Shared junctions form a connected mesh using the existing 26 strokes.
    const ring = (count, reach, phase) => Array.from({ length: count }, (_, index) => {
      const angle = index / count * Math.PI * 2 + phase + (hash(seed, index, count) - 0.5) * 0.18;
      const r = radius * (reach + hash(seed, index, count + 1) * 0.12);
      return { x: point.x + Math.cos(angle) * r, y: point.y + Math.sin(angle) * r };
    });
    const outer = ring(7, 0.76, seed);
    const inner = ring(6, 0.28, seed + 0.28);
    const links = [];
    outer.forEach((p, i) => links.push([p, outer[(i + 1) % outer.length]]));
    inner.forEach((p, i) => links.push([p, inner[(i + 1) % inner.length]]));
    outer.forEach((p, i) => links.push([p, inner[Math.floor(i * inner.length / outer.length)]]));
    inner.forEach((p, i) => links.push([p, outer[Math.ceil((i + 1) * outer.length / inner.length) % outer.length]]));

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    links.forEach(([p0, p1], index) => {
      const bend = (hash(seed, index, 23) - 0.5) * 0.12;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(
        (p0.x + p1.x) * 0.5 - (p1.y - p0.y) * bend,
        (p0.y + p1.y) * 0.5 + (p1.x - p0.x) * bend,
        p1.x, p1.y
      );
      ctx.lineWidth = index % 6 === 0 ? 1.10 : 0.75;
      ctx.strokeStyle = index % 6 === 0 ? 'rgba(211,243,255,.92)' : 'rgba(139,204,255,.68)';
      previousStroke.call(ctx);
    });
    ctx.restore();
  }

  function drawNexus(ctx, point, roots, timestamp, interacting) {
    const rootCount = roots.length;
    const pulse = 0.994 + Math.sin(timestamp * 0.00115) * 0.010;
    const radius = clamp(26 + rootCount * 2.2, 32, 46);
    const seed = rootCount * 0.173 + point.x * 0.0007 + point.y * 0.0009;
    const detail = interacting ? 0.62 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceOrganicNexus(ctx, point, radius * pulse, seed, roots);
    ctx.shadowBlur = interacting ? 3 : 12;
    ctx.shadowColor = `rgba(48,66,220,${(0.32 * detail).toFixed(3)})`;
    const body = ctx.createRadialGradient(point.x, point.y, radius * 0.04, point.x, point.y, radius * 1.18);
    body.addColorStop(0, `rgba(91,103,229,${(0.20 * detail).toFixed(3)})`);
    body.addColorStop(0.32, `rgba(67,77,212,${(0.18 * detail).toFixed(3)})`);
    body.addColorStop(0.66, `rgba(51,59,178,${(0.13 * detail).toFixed(3)})`);
    body.addColorStop(1, `rgba(24,38,112,${(0.05 * detail).toFixed(3)})`);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceOrganicNexus(ctx, point, radius * pulse, seed + 0.371, roots, 0.79);
    const tissue = ctx.createRadialGradient(point.x - radius * 0.12, point.y - radius * 0.10, 0, point.x, point.y, radius * 0.88);
    tissue.addColorStop(0, `rgba(112,145,255,${(0.46 * detail).toFixed(3)})`);
    tissue.addColorStop(0.42, `rgba(65,160,255,${(0.32 * detail).toFixed(3)})`);
    tissue.addColorStop(0.78, `rgba(42,92,214,${(0.10 * detail).toFixed(3)})`);
    tissue.addColorStop(1, 'rgba(55,70,214,0)');
    ctx.fillStyle = tissue;
    ctx.fill();

    traceOrganicNexus(ctx, point, radius * pulse, seed, roots);
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = `rgba(127,179,255,${(0.48 * detail).toFixed(3)})`;
    previousStroke.call(ctx);

    const nucleusRadius = radius * 0.18;
    const nucleus = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, nucleusRadius);
    nucleus.addColorStop(0, `rgba(220,245,255,${(0.90 * detail).toFixed(3)})`);
    nucleus.addColorStop(0.42, `rgba(99,180,255,${(0.44 * detail).toFixed(3)})`);
    nucleus.addColorStop(1, 'rgba(65,83,244,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, nucleusRadius, 0, Math.PI * 2);
    ctx.fillStyle = nucleus;
    ctx.fill();
    ctx.restore();

  }

  function selectFocusRoot(roots, nexus) {
    if (!roots.length) return null;
    let selected = null;
    if (focusRootAnchor) {
      selected = roots.reduce((closest, root) => (
        distance(root.centre, focusRootAnchor) < distance(closest.centre, focusRootAnchor)
          ? root
          : closest
      ));
    } else {
      // The longest route is most useful for a visual review and is fully
      // deterministic from the graph's present geometry.
      selected = roots.reduce((longest, root) => (
        distance(root.centre, nexus) > distance(longest.centre, nexus)
          ? root
          : longest
      ));
    }
    focusRootAnchor = { ...selected.centre };
    return selected;
  }

  function drawSharedNetwork(ctx, roots, timestamp, interacting) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    const focusRoot = selectFocusRoot(roots, nexus);
    roots.forEach((root, index) => {
      const focus = root === focusRoot;
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + index * 0.731));
      // The test route's geometry is independent of renderer capture order.
      const focusSeed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029
        + nexus.x * 0.011 + nexus.y * 0.007));
      const curve = controlPoints(nexus, root.centre, focus ? focusSeed : seed, 0.78, focus ? 0 : index + 1);
      const width = focus
        ? clamp(curve.length * 0.062, 18, 28)
        : clamp(curve.length * 0.035, 7, 14);
      drawOrganicTube(ctx, curve, width, focus ? focusSeed : seed, interacting, focus);
    });

    drawNexus(ctx, nexus, roots, timestamp, interacting);
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
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
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
        opacity:.94;
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
