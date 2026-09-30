(() => {
  'use strict';

  // Approved visual authority:
  // scaffold blob a04fc6d1f23a72df4f76a0e9e8ac5b9cb8f9e45f
  const VERSION = 8;
  const MAX_DPR = 1.75;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralScaffoldInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralScaffoldInstalled', { value: true });

  const native = {
    beginPath: proto.beginPath,
    moveTo: proto.moveTo,
    lineTo: proto.lineTo,
    clearRect: proto.clearRect,
    stroke: proto.stroke
  };

  let sourceCanvas = null;
  let layer = null;
  let ctx = null;
  let surface = null;
  let captureDpr = 1;
  let pending = [];
  let networks = [];
  let routes = [];
  let routeRevision = 0;
  let lastSignature = '';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const lerpPoint = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  const ACCENTS = [
    { name: 'cyan', body: '83,236,255', glow: '24,166,255' },
    { name: 'lime', body: '196,255,78', glow: '70,221,103' },
    { name: 'magenta', body: '255,83,215', glow: '219,46,184' },
    { name: 'violet', body: '218,111,255', glow: '139,67,255' },
    { name: 'yellow', body: '255,235,83', glow: '255,169,42' },
    { name: 'green', body: '130,255,133', glow: '43,204,98' }
  ];

  function accentFor(seed, lane = 0) {
    const value = Math.abs(Math.floor((Number(seed) || 0) * 100003 + lane * 37));
    return ACCENTS[value % ACCENTS.length];
  }

  const rgba = (rgb, alpha) => `rgba(${rgb},${alpha})`;

  function hashText(value) {
    let result = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0) / 4294967296;
  }

  function hash(seed, a = 0, b = 0) {
    const value = Math.sin(seed * 9041.713 + a * 67.731 + b * 181.913) * 43758.5453;
    return value - Math.floor(value);
  }

  function isMainGraph(context) {
    return context?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticConnector(context) {
    if (!context?.__approvedNeuralStart || !context?.__approvedNeuralEnd) return false;
    const style = String(context.strokeStyle || '');
    return Number(context.lineWidth || 1) <= 1.6 && (
      style.includes('120, 184, 255') ||
      style.includes('55, 139, 255') ||
      style.includes('241, 251, 255') ||
      style.includes('199, 255, 86')
    );
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      if (surface) surface.removeEventListener('memory-graph-drawn', finaliseCapture);
      layer?.remove();
      sourceCanvas = canvas;
      surface = canvas.parentElement;
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-scaffold-canvas';
      layer.setAttribute('aria-hidden', 'true');
      surface.appendChild(layer);
      ctx = layer.getContext('2d');
      surface.addEventListener('memory-graph-drawn', finaliseCapture);
    }
    return Boolean(ctx);
  }

  function syncLayerSize() {
    if (!sourceCanvas || !ctx) return null;
    const width = Math.max(1, Math.round(sourceCanvas.clientWidth));
    const height = Math.max(1, Math.round(sourceCanvas.clientHeight));
    const dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
      layer.width = pixelWidth;
      layer.height = pixelHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    return { width, height, dpr };
  }

  function startCapture(context) {
    if (!ensureLayer(context.canvas)) return;
    pending = [];
    captureDpr = Math.max(1, context.canvas.width / Math.max(1, context.canvas.clientWidth));
  }

  function transformed(point, matrix) {
    return {
      x: (matrix.a * point.x + matrix.c * point.y + matrix.e) / captureDpr,
      y: (matrix.b * point.x + matrix.d * point.y + matrix.f) / captureDpr
    };
  }

  function capture(context) {
    if (!ensureLayer(context.canvas)) return;
    const matrix = context.getTransform();
    const from = transformed(context.__approvedNeuralStart, matrix);
    const to = transformed(context.__approvedNeuralEnd, matrix);
    const length = distance(from, to);
    if (length < 4) return;
    const meta = context.__memoryNeuralEdge || {};
    const id = String(meta.id || `${from.x},${from.y}:${to.x},${to.y}`);
    pending.push({
      id,
      sourceId: String(meta.sourceId || ''),
      targetId: String(meta.targetId || ''),
      sourceHub: meta.sourceHub === true,
      targetHub: meta.targetHub === true,
      kind: String(meta.kind || 'space'),
      activityTarget: meta.activityTarget ? { ...meta.activityTarget } : null,
      from,
      to,
      length,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      seed: hashText(id)
    });
  }

  function centrePoint(segments) {
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

  // Approved angular grouping: nearby targets share primary tissue.
  function makeClusters(segments, centre) {
    const sorted = segments.map((segment) => ({
      ...segment,
      angle: Math.atan2(segment.to.y - centre.y, segment.to.x - centre.x),
      radius: distance(centre, segment.to)
    })).sort((a, b) => a.angle - b.angle);
    const clusters = [];
    let current = [];
    for (const segment of sorted) {
      const previous = current[current.length - 1];
      if (!previous || (angleDelta(previous.angle, segment.angle) <= .62 && current.length < 5)) {
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
      if (first.length + last.length <= 5 &&
          angleDelta(last[last.length - 1].angle, first[0].angle) <= .62) {
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
    const norm = Math.max(.001, Math.hypot(x, y));
    return { x: x / norm, y: y / norm, radius: radius / cluster.length };
  }

  function controlPoints(from, to, seed, bendScale = 1, lane = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const side = hash(seed, lane, 1) > .5 ? 1 : -1;
    const bend = side * clamp(length * (.07 + hash(seed, lane, 2) * .08), 5, 58) * bendScale;
    const skew = (hash(seed, lane, 3) - .5) * .14;
    return {
      p0: from,
      p1: {
        x: from.x + dx * (.28 + skew) + px * bend * .72,
        y: from.y + dy * (.28 + skew) + py * bend * .72
      },
      p2: {
        x: from.x + dx * (.70 - skew) + px * bend,
        y: from.y + dy * (.70 - skew) + py * bend
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
    const x = 3 * mt * mt * (curve.p1.x - curve.p0.x) +
      6 * mt * t * (curve.p2.x - curve.p1.x) +
      3 * t * t * (curve.p3.x - curve.p2.x);
    const y = 3 * mt * mt * (curve.p1.y - curve.p0.y) +
      6 * mt * t * (curve.p2.y - curve.p1.y) +
      3 * t * t * (curve.p3.y - curve.p2.y);
    const length = Math.max(.001, Math.hypot(x, y));
    return { x: x / length, y: y / length };
  }

  function buildClusterGeometry(cluster, centre, clusterIndex) {
    const direction = averageDirection(cluster, centre);
    const spread = cluster.length;
    const junctionDistance = clamp(direction.radius * .34 + spread * 3.5, 42, 126);
    const side = hash(clusterIndex + direction.radius, 1, 2) > .5 ? 1 : -1;
    const px = -direction.y;
    const py = direction.x;
    const jitter = (hash(clusterIndex + direction.radius, 3, 4) - .5) * 28;
    const junction = {
      x: centre.x + direction.x * junctionDistance + px * side * jitter,
      y: centre.y + direction.y * junctionDistance + py * side * jitter
    };
    const trunkSeed = Math.abs(Math.sin(cluster.reduce((sum, segment) => sum + segment.seed, 0) + clusterIndex * .713));
    const trunk = controlPoints(centre, junction, trunkSeed, .86, clusterIndex);
    const children = [];
    const ordered = [...cluster].sort((a, b) => a.angle - b.angle);
    for (let index = 0; index < ordered.length; index += 1) {
      const segment = ordered[index];
      const childSeed = segment.seed + clusterIndex * .419 + index * .271;
      if (ordered.length >= 4 && index >= 2) {
        const subgroupAnchor = lerpPoint(junction, segment.to, .30 + hash(childSeed, 5, 6) * .10);
        const sibling = ordered[index - 1];
        const siblingAnchor = lerpPoint(junction, sibling.to, .30 + hash(childSeed, 7, 8) * .10);
        const shared = lerpPoint(subgroupAnchor, siblingAnchor, .5);
        children.push({
          segment,
          stem: controlPoints(junction, shared, childSeed + .33, .66, index + 4),
          branch: controlPoints(shared, segment.to, childSeed + .71, .82, index + 7),
          shared,
          seed: childSeed,
          accent: accentFor(childSeed, index)
        });
      } else {
        children.push({
          segment,
          branch: controlPoints(junction, segment.to, childSeed, .88, index + 2),
          shared: junction,
          seed: childSeed,
          accent: accentFor(childSeed, index)
        });
      }
    }
    return { junction, trunk, children, seed: trunkSeed };
  }

  function sampleCurve(curve, count = 18) {
    return Array.from({ length: count + 1 }, (_, index) => pointOnCurve(curve, index / count));
  }

  function routeFromGeometry(geometry, child) {
    const curves = [geometry.trunk, ...(child.stem ? [child.stem] : []), child.branch];
    const points = [];
    for (const curve of curves) {
      const sampled = sampleCurve(curve);
      points.push(...(points.length ? sampled.slice(1) : sampled));
    }
    const lengths = curves.map((curve) => Math.max(1, curve.length));
    const total = lengths.reduce((sum, value) => sum + value, 0);
    let running = 0;
    const boundaries = [];
    for (let index = 0; index < curves.length - 1; index += 1) {
      running += lengths[index];
      boundaries.push({ progress: running / total, point: { ...curves[index].p3 } });
    }
    const segment = child.segment;
    return {
      id: segment.id,
      sourceId: segment.sourceId,
      targetId: segment.targetId,
      sourceHub: segment.sourceHub,
      targetHub: segment.targetHub,
      kind: segment.kind,
      activityTarget: segment.activityTarget,
      from: segment.from,
      to: segment.to,
      seed: child.seed,
      palette: child.accent?.name || accentFor(child.seed).name,
      curves,
      points,
      boundaries
    };
  }

  function buildNetworks(edges) {
    const groups = new Map();
    for (const edge of edges) {
      const key = edge.sourceId || `${Math.round(edge.from.x)}:${Math.round(edge.from.y)}`;
      const group = groups.get(key) || [];
      group.push(edge);
      groups.set(key, group);
    }
    const builtNetworks = [];
    const builtRoutes = [];
    for (const [sourceId, segments] of groups) {
      const centre = centrePoint(segments);
      const clusters = makeClusters(segments, centre);
      const geometries = clusters.map((cluster, index) => buildClusterGeometry(cluster, centre, index));
      const hub = segments.some((segment) => segment.sourceHub);
      builtNetworks.push({ sourceId, centre, clusters, geometries, hub });
      for (const geometry of geometries) {
        for (const child of geometry.children) builtRoutes.push(routeFromGeometry(geometry, child));
      }
    }
    return { networks: builtNetworks, routes: builtRoutes };
  }

  function traceCurve(context, curve) {
    context.beginPath();
    context.moveTo(curve.p0.x, curve.p0.y);
    context.bezierCurveTo(curve.p1.x, curve.p1.y, curve.p2.x, curve.p2.y, curve.p3.x, curve.p3.y);
  }

  function strokeCurve(context, curve, width, colour) {
    traceCurve(context, curve);
    context.lineWidth = width;
    context.strokeStyle = colour;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    native.stroke.call(context);
  }

  function drawOrganicTube(context, curve, width, accent = accentFor(curve.seed), trunk = false) {
    context.save();
    context.globalCompositeOperation = 'lighter';

    strokeCurve(context, curve, width * 4.1, 'rgba(10,55,190,.030)');
    strokeCurve(context, curve, width * 2.55, 'rgba(21,102,245,.075)');
    strokeCurve(context, curve, width * 1.35, rgba(accent.glow, .18));
    strokeCurve(context, curve, Math.max(.88, width * .50), rgba(accent.body, .70));
    strokeCurve(context, curve, Math.max(.34, width * .13), 'rgba(247,254,255,.92)');

    const fibreCount = trunk ? 3 : 2;
    for (let lane = 0; lane < fibreCount; lane += 1) {
      const fibreAccent = trunk ? accentFor(curve.seed + lane * .319, lane + 1) : accent;
      const endT = .84 + hash(curve.seed, lane + 31, 1) * .15;
      const fibreEnd = pointOnCurve(curve, endT);
      const fibre = controlPoints(
        curve.p0,
        fibreEnd,
        curve.seed + .611 + lane * .417,
        .38 + hash(curve.seed, lane + 32, 2) * .36,
        lane + 9
      );
      strokeCurve(context, fibre, trunk ? .62 : .46, rgba(fibreAccent.glow, trunk ? .48 : .34));
      strokeCurve(context, fibre, trunk ? .22 : .18, rgba(fibreAccent.body, trunk ? .82 : .68));
    }
    context.restore();
  }

  function drawNeurite(context, origin, tangent, seed, reach, accent, mobile, forkBias = .52) {
    const px = -tangent.y;
    const py = tangent.x;
    const side = hash(seed, 2, 3) > .5 ? 1 : -1;
    const forward = (hash(seed, 4, 5) - .28) * reach * .72;
    const end = {
      x: origin.x + px * side * reach + tangent.x * forward,
      y: origin.y + py * side * reach + tangent.y * forward
    };
    const c1 = {
      x: origin.x + px * side * reach * .20 + tangent.x * forward * .12,
      y: origin.y + py * side * reach * .20 + tangent.y * forward * .12
    };
    const c2 = {
      x: origin.x + px * side * reach * .68 + tangent.x * forward * .67,
      y: origin.y + py * side * reach * .68 + tangent.y * forward * .67
    };

    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    context.lineWidth = mobile ? .34 : .46;
    context.strokeStyle = rgba(accent.glow, .34);
    native.stroke.call(context);

    const branchBase = lerpPoint(c1, c2, .62);
    if (hash(seed, 6, 7) > forkBias) {
      const forkSide = hash(seed, 8, 9) > .5 ? 1 : -1;
      const forkReach = reach * (.42 + hash(seed, 10, 11) * .28);
      const forkEnd = {
        x: branchBase.x + px * forkSide * forkReach + tangent.x * forkReach * (.05 + hash(seed, 12, 13) * .28),
        y: branchBase.y + py * forkSide * forkReach + tangent.y * forkReach * (.05 + hash(seed, 12, 13) * .28)
      };
      context.beginPath();
      context.moveTo(branchBase.x, branchBase.y);
      context.bezierCurveTo(
        branchBase.x + px * forkSide * forkReach * .22,
        branchBase.y + py * forkSide * forkReach * .22,
        forkEnd.x - tangent.x * forkReach * .18,
        forkEnd.y - tangent.y * forkReach * .18,
        forkEnd.x,
        forkEnd.y
      );
      context.lineWidth = mobile ? .22 : .28;
      context.strokeStyle = rgba(accent.body, .29);
      native.stroke.call(context);
    }
  }

  function drawDendrites(context, curve, seed, density, mobile, accent = accentFor(seed)) {
    const divisor = mobile ? 54 : 38;
    const count = clamp(Math.round(curve.length / divisor * density), 3, mobile ? 7 : 11);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (let index = 0; index < count; index += 1) {
      const localSeed = seed + index * .347;
      const t = .08 + ((index + .32 + hash(localSeed, 1, 2) * .56) / (count + 1)) * .84;
      const origin = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const reach = 20 + hash(localSeed, 5, 6) * (mobile ? 34 : 64);
      const branchAccent = hash(localSeed, 14, 15) > .72 ? accentFor(localSeed, index + 2) : accent;
      drawNeurite(context, origin, tangent, localSeed, reach, branchAccent, mobile, mobile ? .68 : .46);
    }
    context.restore();
  }

  function drawJunction(context, point, scale = 1) {
    const radius = 10 * scale;
    context.save();
    context.globalCompositeOperation = 'lighter';
    const gradient = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, 'rgba(246,254,255,.30)');
    gradient.addColorStop(.25, 'rgba(117,220,255,.22)');
    gradient.addColorStop(.72, 'rgba(44,124,255,.10)');
    gradient.addColorStop(1, 'rgba(30,82,255,0)');
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();
    context.beginPath();
    context.arc(point.x, point.y, Math.max(1.1, radius * .16), 0, Math.PI * 2);
    context.fillStyle = 'rgba(248,254,255,.88)';
    context.fill();
    context.restore();
  }

  function drawCentreMass(context, network, mobile) {
    if (!network.hub) return;
    const radius = mobile ? 40 : 58;
    const centre = network.centre;
    const networkSeed = hashText(network.sourceId || 'hub') * 1000;

    context.save();
    context.globalCompositeOperation = 'lighter';
    const gradient = context.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius * 1.22);
    gradient.addColorStop(0, 'rgba(250,255,255,.26)');
    gradient.addColorStop(.16, 'rgba(101,224,255,.24)');
    gradient.addColorStop(.42, 'rgba(44,141,255,.15)');
    gradient.addColorStop(.78, 'rgba(26,73,225,.07)');
    gradient.addColorStop(1, 'rgba(17,55,210,0)');
    context.beginPath();
    context.arc(centre.x, centre.y, radius * 1.22, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();

    const tendrilCount = mobile ? 10 : 18;
    for (let index = 0; index < tendrilCount; index += 1) {
      const localSeed = networkSeed + index * .419;
      const angle = (index / tendrilCount) * Math.PI * 2 + (hash(localSeed, 1, 2) - .5) * .34;
      const direction = { x: Math.cos(angle), y: Math.sin(angle) };
      const normal = { x: -direction.y, y: direction.x };
      const reach = radius * (.72 + hash(localSeed, 3, 4) * 1.15);
      const sway = (hash(localSeed, 5, 6) - .5) * radius * .58;
      const end = {
        x: centre.x + direction.x * reach + normal.x * sway * .34,
        y: centre.y + direction.y * reach + normal.y * sway * .34
      };
      const curve = {
        p0: centre,
        p1: {
          x: centre.x + direction.x * reach * .22 + normal.x * sway * .18,
          y: centre.y + direction.y * reach * .22 + normal.y * sway * .18
        },
        p2: {
          x: centre.x + direction.x * reach * .64 + normal.x * sway,
          y: centre.y + direction.y * reach * .64 + normal.y * sway
        },
        p3: end,
        length: reach,
        seed: localSeed
      };
      const accent = accentFor(localSeed, index);
      strokeCurve(context, curve, mobile ? 1.05 : 1.32, rgba(accent.glow, .18));
      strokeCurve(context, curve, mobile ? .32 : .40, rgba(accent.body, .52));
      if (hash(localSeed, 7, 8) > .34) {
        const origin = pointOnCurve(curve, .52 + hash(localSeed, 9, 10) * .16);
        const tangent = tangentOnCurve(curve, .58);
        drawNeurite(context, origin, tangent, localSeed + .77, reach * .52, accent, mobile, .40);
      }
    }

    for (let index = 0; index < network.clusters.length; index += 1) {
      const direction = averageDirection(network.clusters[index], centre);
      const rootEnd = {
        x: centre.x + direction.x * radius * (.70 + hash(index + 1.7, 1, 2) * .28),
        y: centre.y + direction.y * radius * (.70 + hash(index + 1.7, 1, 2) * .28)
      };
      const accent = accentFor(networkSeed + index * .293, index);
      const root = controlPoints(centre, rootEnd, networkSeed + index * .377 + 1.3, .42, index);
      strokeCurve(context, root, mobile ? 1.0 : 1.25, rgba(accent.glow, .28));
      strokeCurve(context, root, .34, rgba(accent.body, .68));
    }
    context.restore();
  }

  function drawCluster(context, geometry, mobile) {
    const trunkWidth = clamp(geometry.trunk.length * .052, 4.8, 10.8);
    const trunkAccent = accentFor(geometry.seed, 0);
    drawOrganicTube(context, geometry.trunk, trunkWidth, trunkAccent, true);
    drawDendrites(context, geometry.trunk, geometry.seed, 1.18, mobile, trunkAccent);
    drawJunction(context, geometry.junction, .94);

    for (const child of geometry.children) {
      const accent = child.accent || accentFor(child.seed);
      if (child.stem) {
        const stemWidth = clamp(child.stem.length * .040, 2.3, 5.8);
        drawOrganicTube(context, child.stem, stemWidth, accent, false);
        drawDendrites(context, child.stem, child.seed + 1.1, .70, mobile, accent);
        if (hash(child.seed, 11, 12) > .35) drawJunction(context, child.shared, .56);
      }
      const branchWidth = clamp(child.branch.length * .030, 2.0, 5.5);
      drawOrganicTube(context, child.branch, branchWidth, accent, false);
      drawDendrites(context, child.branch, child.seed + 2.3, .82, mobile, accent);
    }
  }

  function paintStatic() {
    const metrics = syncLayerSize();
    if (!metrics) return;
    const mobile = metrics.width < 700;
    ctx.clearRect(0, 0, metrics.width, metrics.height);
    for (const network of networks) {
      drawCentreMass(ctx, network, mobile);
      for (const geometry of network.geometries) drawCluster(ctx, geometry, mobile);
    }
  }

  function captureSignature(metrics) {
    const edges = pending.map((edge) => [
      edge.id,
      Math.round(edge.from.x * 2), Math.round(edge.from.y * 2),
      Math.round(edge.to.x * 2), Math.round(edge.to.y * 2)
    ].join(':')).join('|');
    return `${metrics.width}x${metrics.height}@${metrics.dpr}:${edges}`;
  }

  function finaliseCapture() {
    if (!pending.length || !ensureLayer(sourceCanvas)) return;
    const metrics = syncLayerSize();
    if (!metrics) return;
    const signature = captureSignature(metrics);
    if (signature === lastSignature) return;
    lastSignature = signature;
    const built = buildNetworks(pending);
    networks = built.networks;
    routes = built.routes;
    routeRevision += 1;
    paintStatic();
    window.dispatchEvent(new CustomEvent('memory-neural-routes-changed', { detail: { revision: routeRevision } }));
  }

  function polylineLength(points) {
    let total = 0;
    for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
    return Math.max(1, total);
  }

  function combineRouteLegs(legs, sourceId, targetId) {
    const oriented = legs.map((leg) => {
      const points = leg.reverse ? [...leg.route.points].reverse() : leg.route.points;
      const boundaries = leg.reverse
        ? leg.route.boundaries.map((boundary) => ({ progress: 1 - boundary.progress, point: boundary.point })).reverse()
        : leg.route.boundaries;
      return { points, boundaries, length: polylineLength(points) };
    });
    const total = oriented.reduce((sum, leg) => sum + leg.length, 0);
    const points = [];
    const boundaries = [];
    let travelled = 0;
    for (const leg of oriented) {
      points.push(...(points.length ? leg.points.slice(1) : leg.points));
      for (const boundary of leg.boundaries) {
        boundaries.push({ progress: (travelled + boundary.progress * leg.length) / total, point: { ...boundary.point } });
      }
      travelled += leg.length;
      if (travelled < total) {
        boundaries.push({ progress: travelled / total, point: { ...leg.points[leg.points.length - 1] } });
      }
    }
    return { sourceId, targetId, points, boundaries, palette: legs[0]?.route?.palette || 'cyan', legs: legs.map((leg) => leg.route.id) };
  }

  function routeBetween(sourceId, targetId) {
    const source = String(sourceId || '');
    const target = String(targetId || '');
    if (!source || !target || source === target) return null;
    const adjacency = new Map();
    for (const route of routes) {
      if (!adjacency.has(route.sourceId)) adjacency.set(route.sourceId, []);
      if (!adjacency.has(route.targetId)) adjacency.set(route.targetId, []);
      adjacency.get(route.sourceId).push({ next: route.targetId, route, reverse: false });
      adjacency.get(route.targetId).push({ next: route.sourceId, route, reverse: true });
    }
    const queue = [{ id: source, legs: [] }];
    const visited = new Set([source]);
    while (queue.length) {
      const current = queue.shift();
      for (const edge of adjacency.get(current.id) || []) {
        if (visited.has(edge.next)) continue;
        const legs = [...current.legs, edge];
        if (edge.next === target) return combineRouteLegs(legs, source, target);
        visited.add(edge.next);
        queue.push({ id: edge.next, legs });
      }
    }
    return null;
  }

  proto.beginPath = function approvedNeuralBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__approvedNeuralStart = null;
      this.__approvedNeuralEnd = null;
    }
    return native.beginPath.apply(this, args);
  };

  proto.moveTo = function approvedNeuralMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__approvedNeuralStart = { x: Number(x), y: Number(y) };
      this.__approvedNeuralEnd = null;
    }
    return native.moveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function approvedNeuralLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__approvedNeuralStart) {
      this.__approvedNeuralEnd = { x: Number(x), y: Number(y) };
    }
    return native.lineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function approvedNeuralClearRect(...args) {
    if (isMainGraph(this)) startCapture(this);
    return native.clearRect.apply(this, args);
  };

  proto.stroke = function approvedNeuralStroke(...args) {
    if (isMainGraph(this) && isSemanticConnector(this)) {
      capture(this);
      return undefined;
    }
    return native.stroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralScaffoldStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralScaffoldStyles';
    style.textContent = '.memory-graph-neural-scaffold-canvas{position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;opacity:.98}';
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralScaffold = Object.freeze({
    version: VERSION,
    routeRevision: () => routeRevision,
    routes: () => routes,
    routeBetween,
    nodePoint(id) {
      const key = String(id || '');
      const route = routes.find((candidate) => candidate.sourceId === key || candidate.targetId === key);
      if (!route) return null;
      return route.sourceId === key ? { ...route.from } : { ...route.to };
    },
    metrics: () => layer ? {
      width: layer.clientWidth,
      height: layer.clientHeight,
      dpr: Math.min(MAX_DPR, window.devicePixelRatio || 1)
    } : null,
    redraw() { paintStatic(); }
  });
})();
