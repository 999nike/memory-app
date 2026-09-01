(() => {
  'use strict';

  const VERSION = 5;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralScaffoldInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralScaffoldInstalled', { value: true });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousClearRect = proto.clearRect;
  const previousStroke = proto.stroke;

  const mainSegments = [];
  const manualSegments = [];
  let layer = null;
  let layerContext = null;
  let sourceCanvas = null;
  let frame = 0;
  let lastPaint = 0;

  const NORMAL_FRAME_MS = 42;
  const INTERACTING_FRAME_MS = 78;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 9041.713 + a * 67.731 + b * 181.913) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isManualOverlay(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryScaffoldStart || !ctx?.__memoryScaffoldEnd) return false;
    const style = String(ctx.strokeStyle || '');
    return style.includes('120, 184, 255') || style.includes('55, 139, 255') || style.includes('241, 251, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;

    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-scaffold-canvas';
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
    const start = ctx.__memoryScaffoldStart;
    const end = ctx.__memoryScaffoldEnd;
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

  function seedFor(from, to) {
    return Math.abs(Math.sin(from.x * 0.0173 + from.y * 0.0211 + to.x * 0.0127 + to.y * 0.0281));
  }

  function capture(ctx, compact) {
    const target = sourceCanvas || document.querySelector('.memory-graph-canvas');
    if (!target || !ensureLayer(target)) return;
    const points = transformedEndpoints(ctx);
    if (!points) return;
    const length = distance(points.from, points.to);
    if (length < 4) return;
    const segment = {
      ...points,
      compact,
      length,
      angle: Math.atan2(points.to.y - points.from.y, points.to.x - points.from.x),
      seed: seedFor(points.from, points.to)
    };
    (compact ? manualSegments : mainSegments).push(segment);
  }

  function centrePoint(segments) {
    if (!segments.length) return null;
    let x = 0;
    let y = 0;
    for (const segment of segments) {
      x += segment.from.x;
      y += segment.from.y;
    }
    return { x: x / segments.length, y: y / segments.length };
  }

  function angleDelta(a, b) {
    let delta = b - a;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return Math.abs(delta);
  }

  function makeClusters(segments, centre, compact = false) {
    if (!segments.length || !centre) return [];
    const sorted = segments.map((segment) => ({
      ...segment,
      angle: Math.atan2(segment.to.y - centre.y, segment.to.x - centre.x),
      radius: distance(centre, segment.to)
    })).sort((a, b) => a.angle - b.angle);

    const gapLimit = compact ? 0.58 : 0.62;
    const maxCluster = compact ? 4 : 5;
    const clusters = [];
    let current = [];

    for (const segment of sorted) {
      const previous = current[current.length - 1];
      if (!previous || (angleDelta(previous.angle, segment.angle) <= gapLimit && current.length < maxCluster)) {
        current.push(segment);
      } else {
        clusters.push(current);
        current = [segment];
      }
    }
    if (current.length) clusters.push(current);

    if (clusters.length > 1) {
      const first = clusters[0];
      const last = clusters[clusters.length - 1];
      if (first.length + last.length <= maxCluster && angleDelta(last[last.length - 1].angle, first[0].angle) <= gapLimit) {
        clusters[0] = [...last, ...first];
        clusters.pop();
      }
    }

    return clusters;
  }

  function averageDirection(cluster, centre) {
    let x = 0;
    let y = 0;
    let radius = 0;
    for (const segment of cluster) {
      const dx = segment.to.x - centre.x;
      const dy = segment.to.y - centre.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      x += dx / length;
      y += dy / length;
      radius += length;
    }
    const norm = Math.max(0.001, Math.hypot(x, y));
    return { x: x / norm, y: y / norm, radius: radius / cluster.length };
  }

  function controlPoints(from, to, seed, bendScale = 1, lane = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const side = hash(seed, lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(length * (0.07 + hash(seed, lane, 2) * 0.08), 5, 58) * bendScale;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.14;
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

  function traceCurve(ctx, curve) {
    ctx.beginPath();
    ctx.moveTo(curve.p0.x, curve.p0.y);
    ctx.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
  }

  function strokeCurve(ctx, curve, width, colour) {
    traceCurve(ctx, curve);
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    previousStroke.call(ctx);
  }

  function strokeTaperedCore(ctx, curve, width, alpha = 1) {
    const segments = 8;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 0; index < segments; index += 1) {
      const startT = index / segments;
      const endT = (index + 1) / segments;
      const start = pointOnCurve(curve, startT);
      const end = pointOnCurve(curve, endT);
      const taper = endT <= 0.35 ? 1 : 1 - (endT - 0.35) * 0.90;

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.lineWidth = Math.max(0.65, width * taper * 0.82);
      ctx.strokeStyle = `rgba(91,208,255,${(0.55 * alpha * (0.70 + taper * 0.30)).toFixed(3)})`;
      previousStroke.call(ctx);

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.lineWidth = Math.max(0.35, width * taper * 0.20);
      ctx.strokeStyle = `rgba(239,253,255,${(0.94 * alpha * (0.56 + taper * 0.44)).toFixed(3)})`;
      previousStroke.call(ctx);
    }
    ctx.restore();
  }
  function drawOrganicTube(ctx, curve, width, interacting, compact = false) {
    const detail = interacting ? 0.58 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    strokeCurve(ctx, curve, width * 5.2, `rgba(10,55,190,${(0.055 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, width * 3.25, `rgba(21,102,245,${(0.115 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, width * 1.78, `rgba(39,149,255,${(0.24 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, Math.max(0.9, width * 0.52), `rgba(104,215,255,${(0.58 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, Math.max(0.35, width * 0.13), `rgba(244,253,255,${(0.88 * detail).toFixed(3)})`);
    strokeTaperedCore(ctx, curve, width, detail);

    if (!interacting) {
      const companions = compact ? 2 : 4;
      for (let lane = 1; lane <= companions; lane += 1) {
        const companion = controlPoints(curve.p0, curve.p3, curve.seed + lane * 0.451, 0.48 + lane * 0.12, lane);
        strokeCurve(ctx, companion, compact ? 0.38 : 0.52 + lane * 0.13, `rgba(149,232,255,${(0.34 + lane * 0.060).toFixed(3)})`);
      }
    }
    ctx.restore();
  }

  function drawTrunkBundle(ctx, curve, width, interacting, compact = false) {
    if (interacting) return;
    const lanes = compact ? 2 : 5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let lane = 1; lane <= lanes; lane += 1) {
      const filament = controlPoints(curve.p0, curve.p3, curve.seed + lane * 0.613, 0.34 + lane * 0.12, lane + 8);
      strokeCurve(ctx, filament, Math.max(0.6, width * (0.24 - lane * 0.025)), `rgba(116,222,255,${(0.48 - lane * 0.045).toFixed(3)})`);
      strokeCurve(ctx, filament, Math.max(0.22, width * (0.065 - lane * 0.006)), `rgba(245,254,255,${(0.78 - lane * 0.055).toFixed(3)})`);
    }
    ctx.restore();
  }
  function drawDendrites(ctx, curve, seed, interacting, density = 1, compact = false) {
    if (interacting) return;
    const mobile = sourceCanvas?.clientWidth < 700;
    const major = density >= 1.4;
    const divisor = compact ? 58 : major ? 24 : mobile ? 50 : 34;
    const count = clamp(Math.round(curve.length / divisor * density), compact ? 1 : major ? 5 : 3, compact ? 4 : major ? 12 : mobile ? 7 : 13);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < count; i += 1) {
      const localSeed = seed + i * 0.347;
      const t = 0.10 + ((i + 0.35 + hash(localSeed, 1, 2) * 0.55) / (count + 1)) * 0.80;
      const origin = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const px = -tangent.y;
      const py = tangent.x;
      const side = hash(localSeed, 3, 4) > 0.5 ? 1 : -1;
      const reach = (compact ? 8 : major ? 20 : 16) + hash(localSeed, 5, 6) * (compact ? 16 : major ? 66 : mobile ? 34 : 58);
      const forward = (hash(localSeed, 7, 8) - 0.35) * reach * 0.55;
      const mid = {
        x: origin.x + px * side * reach * 0.52 + tangent.x * forward * 0.42,
        y: origin.y + py * side * reach * 0.52 + tangent.y * forward * 0.42
      };
      const end = {
        x: origin.x + px * side * reach + tangent.x * forward,
        y: origin.y + py * side * reach + tangent.y * forward
      };

      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = compact ? 0.36 : major ? 0.76 : 0.48;
      ctx.strokeStyle = major ? 'rgba(157,229,255,.46)' : 'rgba(157,229,255,.28)';
      previousStroke.call(ctx);

      if (!compact && hash(localSeed, 9, 10) > (mobile ? 0.66 : 0.44)) {
        const forkSide = hash(localSeed, 11, 12) > 0.5 ? 1 : -1;
        const fork = {
          x: mid.x + px * forkSide * reach * 0.44 + tangent.x * reach * 0.15,
          y: mid.y + py * forkSide * reach * 0.44 + tangent.y * reach * 0.15
        };
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.quadraticCurveTo((mid.x + fork.x) * 0.5 + px * forkSide * 3, (mid.y + fork.y) * 0.5 + py * forkSide * 3, fork.x, fork.y);
        ctx.lineWidth = major ? 0.38 : 0.24;
        ctx.strokeStyle = major ? 'rgba(210,246,255,.34)' : 'rgba(210,246,255,.22)';
        previousStroke.call(ctx);
      }
    }
    ctx.restore();
  }

  function drawJunction(ctx, point, seed, timestamp, scale = 1) {
    const pulse = 0.80 + Math.sin(timestamp * 0.0019 + seed * 17.3) * 0.16;
    const radius = 12 * scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, `rgba(246,254,255,${(0.38 * pulse).toFixed(3)})`);
    gradient.addColorStop(0.25, `rgba(117,220,255,${(0.28 * pulse).toFixed(3)})`);
    gradient.addColorStop(0.72, `rgba(44,124,255,${(0.14 * pulse).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(30,82,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(1.1, radius * 0.16), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(248,254,255,.88)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(2.4, radius * 0.46), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(0.35, radius * 0.05);
    ctx.strokeStyle = `rgba(159,231,255,${(0.34 * pulse).toFixed(3)})`;
    previousStroke.call(ctx);
    ctx.restore();
  }

  function drawFibreLights(ctx, curve, seed, timestamp, density = 1, compact = false) {
    const count = clamp(Math.round(curve.length / (compact ? 32 : 14) * density), compact ? 3 : 6, compact ? 8 : 22);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let index = 0; index < count; index += 1) {
      const localSeed = seed + index * 0.193;
      const t = 0.06 + ((index + 0.24 + hash(localSeed, 1, 2) * 0.72) / (count + 1)) * 0.88;
      const point = pointOnCurve(curve, t);
      const flicker = 0.62 + Math.sin(timestamp * 0.004 + localSeed * 18.7) * 0.24;
      const radius = (compact ? 0.38 : 0.46) + hash(localSeed, 3, 4) * (compact ? 0.28 : 0.62);
      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(195,245,255,${(0.34 * flicker).toFixed(3)})`;
      ctx.fill();
      if (index % 4 === 0) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 2.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(72,183,255,${(0.09 * flicker).toFixed(3)})`;
        ctx.fill();
      }
    }
    ctx.restore();
  }
  function drawPulse(ctx, curve, seed, timestamp, phase = 0) {
    const duration = 1600 + seed * 1500;
    const progress = ((timestamp + phase * duration + seed * 700) % duration) / duration;
    const point = pointOnCurve(curve, progress);
    const alpha = Math.sin(Math.PI * progress);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const radius = 5.5;
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${(0.88 * alpha).toFixed(3)})`);
    gradient.addColorStop(0.35, `rgba(105,220,255,${(0.60 * alpha).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(40,116,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    for (let trail = 1; trail <= 3; trail += 1) {
      const trailPoint = pointOnCurve(curve, clamp(progress - trail * 0.022, 0, 1));
      ctx.beginPath();
      ctx.arc(trailPoint.x, trailPoint.y, Math.max(1, radius * (0.30 - trail * 0.05)), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(108,218,255,${(alpha * (0.18 - trail * 0.035)).toFixed(3)})`;
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCentreMass(ctx, centre, clusters, timestamp, interacting) {
    if (!centre) return;
    const mobile = sourceCanvas?.clientWidth < 700;
    const radius = mobile ? 42 : 62;
    const pulse = 0.90 + Math.sin(timestamp * 0.0015) * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
    gradient.addColorStop(0, `rgba(232,253,255,${((interacting ? 0.055 : 0.10) * pulse).toFixed(3)})`);
    gradient.addColorStop(0.24, `rgba(81,190,255,${((interacting ? 0.065 : 0.12) * pulse).toFixed(3)})`);
    gradient.addColorStop(0.62, `rgba(29,104,255,${((interacting ? 0.040 : 0.075) * pulse).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(17,55,210,0)');
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    if (!interacting) {
      for (let i = 0; i < clusters.length; i += 1) {
        const direction = averageDirection(clusters[i], centre);
        const rootEnd = {
          x: centre.x + direction.x * radius * (0.65 + hash(i + 1.7, 1, 2) * 0.30),
          y: centre.y + direction.y * radius * (0.65 + hash(i + 1.7, 1, 2) * 0.30)
        };
        const root = controlPoints(centre, rootEnd, i * 0.377 + 1.3, 0.45, i);
        strokeCurve(ctx, root, 1.25, 'rgba(171,235,255,.48)');
      }
    }
    ctx.restore();
  }

  function buildClusterGeometry(cluster, centre, clusterIndex, compact = false) {
    const direction = averageDirection(cluster, centre);
    const spread = cluster.length;
    const junctionDistance = clamp(direction.radius * (compact ? 0.30 : 0.34) + spread * 3.5, compact ? 28 : 42, compact ? 74 : 126);
    const side = hash(clusterIndex + direction.radius, 1, 2) > 0.5 ? 1 : -1;
    const px = -direction.y;
    const py = direction.x;
    const jitter = (hash(clusterIndex + direction.radius, 3, 4) - 0.5) * (compact ? 12 : 28);
    const junction = {
      x: centre.x + direction.x * junctionDistance + px * side * jitter,
      y: centre.y + direction.y * junctionDistance + py * side * jitter
    };

    const trunkSeed = Math.abs(Math.sin(cluster.reduce((sum, segment) => sum + segment.seed, 0) + clusterIndex * 0.713));
    const trunk = controlPoints(centre, junction, trunkSeed, compact ? 0.72 : 0.86, clusterIndex);

    const children = [];
    const ordered = [...cluster].sort((a, b) => a.angle - b.angle);
    for (let i = 0; i < ordered.length; i += 1) {
      const segment = ordered[i];
      const childSeed = segment.seed + clusterIndex * 0.419 + i * 0.271;
      const target = segment.to;

      if (!compact && ordered.length >= 4 && i >= 2) {
        const subgroupAnchor = lerp(junction, target, 0.30 + hash(childSeed, 5, 6) * 0.10);
        const sibling = ordered[i - 1];
        const siblingAnchor = lerp(junction, sibling.to, 0.30 + hash(childSeed, 7, 8) * 0.10);
        const shared = lerp(subgroupAnchor, siblingAnchor, 0.5);
        const stem = controlPoints(junction, shared, childSeed + 0.33, 0.66, i + 4);
        const branch = controlPoints(shared, target, childSeed + 0.71, 0.82, i + 7);
        children.push({ segment, stem, branch, shared, seed: childSeed });
      } else {
        const branch = controlPoints(junction, target, childSeed, compact ? 0.72 : 0.88, i + 2);
        children.push({ segment, branch, shared: junction, seed: childSeed });
      }
    }

    return { junction, trunk, children, seed: trunkSeed };
  }

  function drawCluster(ctx, geometry, timestamp, interacting, compact = false) {
    const trunkWidth = clamp(geometry.trunk.length * (compact ? 0.070 : 0.098), compact ? 5.0 : 11.0, compact ? 10.5 : 22.0);
    drawOrganicTube(ctx, geometry.trunk, trunkWidth, interacting, compact);
    drawTrunkBundle(ctx, geometry.trunk, trunkWidth, interacting, compact);
    drawDendrites(ctx, geometry.trunk, geometry.seed, interacting, compact ? 0.86 : 1.65, compact);
    if (!interacting) drawFibreLights(ctx, geometry.trunk, geometry.seed + 0.41, timestamp, compact ? 0.70 : 1.25, compact);
    if (!interacting) {
      drawJunction(ctx, geometry.trunk.p0, geometry.seed + 0.17, timestamp, compact ? 0.72 : 1.30);
      drawJunction(ctx, geometry.junction, geometry.seed, timestamp, compact ? 0.94 : 1.62);
      drawPulse(ctx, geometry.trunk, geometry.seed, timestamp, 0.10);
    }

    for (const child of geometry.children) {
      if (child.stem) {
        const stemWidth = clamp(child.stem.length * 0.045, 2.6, 6.4);
        drawOrganicTube(ctx, child.stem, stemWidth, interacting, false);
        drawDendrites(ctx, child.stem, child.seed + 1.1, interacting, 0.72, false);
        if (!interacting) drawFibreLights(ctx, child.stem, child.seed + 1.57, timestamp, 0.82, false);
      }
      const branchWidth = clamp(child.branch.length * (compact ? 0.030 : 0.034), compact ? 1.8 : 2.4, compact ? 4.6 : 6.8);
      drawOrganicTube(ctx, child.branch, branchWidth, interacting, compact);
      drawDendrites(ctx, child.branch, child.seed + 2.3, interacting, compact ? 0.62 : 0.88, compact);
      if (!interacting) drawFibreLights(ctx, child.branch, child.seed + 2.91, timestamp, compact ? 0.72 : 1.48, compact);
      if (!interacting) {
        drawPulse(ctx, child.branch, child.seed, timestamp, 0.35);
        if (child.stem && hash(child.seed, 11, 12) > 0.35) drawJunction(ctx, child.shared, child.seed + 3.3, timestamp, 0.54);
      }
    }
  }

  function groupManualSegments(segments) {
    const groups = [];
    const tolerance = 12;
    for (const segment of segments) {
      let group = groups.find((candidate) => distance(candidate.centre, segment.from) <= tolerance);
      if (!group) {
        group = { centre: segment.from, segments: [] };
        groups.push(group);
      }
      group.segments.push(segment);
    }
    return groups;
  }

  function drawNetwork(ctx, segments, timestamp, interacting, compact = false) {
    if (!segments.length) return;
    const centre = centrePoint(segments);
    const clusters = makeClusters(segments, centre, compact);
    drawCentreMass(ctx, centre, clusters, timestamp, interacting);
    for (let i = 0; i < clusters.length; i += 1) {
      const geometry = buildClusterGeometry(clusters[i], centre, i, compact);
      drawCluster(ctx, geometry, timestamp, interacting, compact);
    }
  }

  function drawFrame(timestamp) {
    frame = requestAnimationFrame(drawFrame);
    if (!layerContext || !layer || !sourceCanvas?.isConnected || document.hidden) return;

    const interacting = sourceCanvas.dataset.interacting === 'true';
    const frameMs = interacting ? INTERACTING_FRAME_MS : NORMAL_FRAME_MS;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;

    const rect = sourceCanvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
    layerContext.clearRect(0, 0, rect.width, rect.height);

    for (const group of groupManualSegments(mainSegments)) {
      drawNetwork(layerContext, group.segments, timestamp, interacting, false);
    }

    const manualGroups = groupManualSegments(manualSegments);
    for (const group of manualGroups) {
      // Manual folders are separate semantic groups, but their neural tissue is
      // rendered with the exact same full-strength geometry as normal memories.
      drawNetwork(layerContext, group.segments, timestamp, interacting, false);
    }
  }

  proto.beginPath = function neuralScaffoldBeginPath(...args) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryScaffoldStart = null;
      this.__memoryScaffoldEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralScaffoldMoveTo(x, y, ...rest) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryScaffoldStart = { x: Number(x), y: Number(y) };
      this.__memoryScaffoldEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralScaffoldLineTo(x, y, ...rest) {
    if ((isMainGraph(this) || isManualOverlay(this)) && this.__memoryScaffoldStart) {
      this.__memoryScaffoldEnd = { x: Number(x), y: Number(y) };
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralScaffoldClearRect(...args) {
    if (isMainGraph(this)) mainSegments.length = 0;
    if (isManualOverlay(this)) manualSegments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralScaffoldStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) {
      capture(this, false);
      return undefined;
    }

    if (isManualOverlay(this) && isSemanticBlueLine(this)) {
      const style = String(this.strokeStyle || '');
      if (style.includes('55, 139, 255')) {
        capture(this, true);
        return undefined;
      }
      if (style.includes('120, 184, 255') || style.includes('241, 251, 255')) return undefined;
    }

    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralScaffoldStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralScaffoldStyles';
    style.textContent = `
      .memory-graph-neural-scaffold-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.98;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralScaffold = Object.freeze({
    version: VERSION,
    mainSegmentCount: () => mainSegments.length,
    manualSegmentCount: () => manualSegments.length,
    redraw() { lastPaint = 0; }
  });
})();
