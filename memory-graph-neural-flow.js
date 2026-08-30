(() => {
  'use strict';

  const VERSION = 3;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralFlowInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralFlowInstalled', { value: true });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousClearRect = proto.clearRect;
  const previousStroke = proto.stroke;

  const mainSegments = [];
  const manualSegments = [];
  let sourceCanvas = null;
  let layer = null;
  let ctx = null;
  let frame = 0;
  let lastPaint = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 9041.713 + a * 67.731 + b * 181.913) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(context) {
    return context?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isManualOverlay(context) {
    return context?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  }

  function isSemanticBlueLine(context) {
    if (!context?.__memoryFlowStart || !context?.__memoryFlowEnd) return false;
    const style = String(context.strokeStyle || '');
    return style.includes('120, 184, 255') || style.includes('55, 139, 255') || style.includes('241, 251, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-flow-canvas';
      layer.setAttribute('aria-hidden', 'true');
      canvas.parentElement.appendChild(layer);
      ctx = layer.getContext('2d');
      sourceCanvas = canvas;
    }
    if (!ctx) return false;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, canvas.width / Math.max(1, width));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
      layer.width = pixelWidth;
      layer.height = pixelHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    if (!frame) frame = requestAnimationFrame(drawFrame);
    return true;
  }

  function transformedEndpoints(context) {
    const start = context.__memoryFlowStart;
    const end = context.__memoryFlowEnd;
    if (!start || !end) return null;
    const canvas = context.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    const project = (point) => ({
      x: (matrix.a * point.x + matrix.c * point.y + matrix.e) / dpr,
      y: (matrix.b * point.x + matrix.d * point.y + matrix.f) / dpr
    });
    return { from: project(start), to: project(end) };
  }

  function seedFor(from, to) {
    return Math.abs(Math.sin(from.x * 0.0173 + from.y * 0.0211 + to.x * 0.0127 + to.y * 0.0281));
  }

  function capture(context, compact) {
    const target = sourceCanvas || document.querySelector('.memory-graph-canvas');
    if (!target || !ensureLayer(target)) return;
    const points = transformedEndpoints(context);
    if (!points) return;
    const length = distance(points.from, points.to);
    if (length < 4) return;
    (compact ? manualSegments : mainSegments).push({
      ...points,
      compact,
      length,
      angle: Math.atan2(points.to.y - points.from.y, points.to.x - points.from.x),
      seed: seedFor(points.from, points.to),
      activityTarget: context.__memoryFlowActivityTarget
        ? { ...context.__memoryFlowActivityTarget }
        : null
    });
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
      if (!previous || (angleDelta(previous.angle, segment.angle) <= gapLimit && current.length < maxCluster)) current.push(segment);
      else {
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
      p1: { x: from.x + dx * (0.28 + skew) + px * bend * 0.72, y: from.y + dy * (0.28 + skew) + py * bend * 0.72 },
      p2: { x: from.x + dx * (0.70 - skew) + px * bend, y: from.y + dy * (0.70 - skew) + py * bend },
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
        children.push({
          stem: controlPoints(junction, shared, childSeed + 0.33, 0.66, i + 4),
          branch: controlPoints(shared, target, childSeed + 0.71, 0.82, i + 7),
          shared,
          seed: childSeed,
          activityTarget: segment.activityTarget
        });
      } else {
        children.push({
          branch: controlPoints(junction, target, childSeed, compact ? 0.72 : 0.88, i + 2),
          shared: junction,
          seed: childSeed,
          activityTarget: segment.activityTarget
        });
      }
    }
    return { trunk, junction, children, seed: trunkSeed };
  }

  function routeMetrics(curves) {
    const lengths = curves.map((curve) => Math.max(1, curve.length));
    const total = lengths.reduce((sum, value) => sum + value, 0);
    const boundaries = [];
    let running = 0;
    for (let i = 0; i < lengths.length - 1; i += 1) {
      running += lengths[i];
      boundaries.push({ progress: running / total, point: curves[i].p3 });
    }
    return { lengths, total, boundaries };
  }

  function routePoint(curves, metrics, progress) {
    const target = clamp(progress, 0, 1) * metrics.total;
    let running = 0;
    for (let i = 0; i < curves.length; i += 1) {
      const next = running + metrics.lengths[i];
      if (target <= next || i === curves.length - 1) {
        const local = clamp((target - running) / metrics.lengths[i], 0, 1);
        return pointOnCurve(curves[i], local);
      }
      running = next;
    }
    return curves[curves.length - 1].p3;
  }

  function glow(point, radius, alpha, hot = false, palette = 'blue') {
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    if (palette === 'purple') {
      gradient.addColorStop(0.25, hot ? `rgba(239,184,255,${(alpha * 0.94).toFixed(3)})` : `rgba(214,118,255,${(alpha * 0.84).toFixed(3)})`);
      gradient.addColorStop(0.62, `rgba(178,64,255,${(alpha * 0.48).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(102,0,255,0)');
    } else {
      gradient.addColorStop(0.25, hot ? `rgba(173,240,255,${(alpha * 0.84).toFixed(3)})` : `rgba(108,222,255,${(alpha * 0.72).toFixed(3)})`);
      gradient.addColorStop(0.62, `rgba(49,144,255,${(alpha * 0.34).toFixed(3)})`);
      gradient.addColorStop(1, 'rgba(30,88,255,0)');
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  function drawRoutePulse(curves, seed, timestamp, phase, compact, options = {}) {
    if (!curves.length) return;
    const metrics = routeMetrics(curves);
    const duration = (compact ? 3000 : 3400) + seed * 1500;
    const raw = ((timestamp + phase * duration + seed * 1100) % duration) / duration;
    const activity = options.activity === true;
    const reverse = options.reverse !== false;
    const routeProgress = activity ? (reverse ? 1 - raw : raw) : 0.5 - 0.5 * Math.cos(raw * Math.PI * 2);
    const point = routePoint(curves, metrics, routeProgress);
    const direction = activity ? (reverse ? -1 : 1) : raw < 0.5 ? 1 : -1;
    const radius = (compact ? 8.5 : 11.5) * (activity ? 1.18 : 1);
    const palette = activity ? 'purple' : 'blue';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 3; i >= 1; i -= 1) {
      const trailProgress = clamp(routeProgress - direction * i * 0.012, 0, 1);
      const trailPoint = routePoint(curves, metrics, trailProgress);
      glow(trailPoint, radius * (0.34 + i * 0.09), 0.10 + (4 - i) * 0.035, false, palette);
    }
    glow(point, radius * (activity ? 1.88 : 1.75), activity ? 0.34 : compact ? 0.20 : 0.26, false, palette);
    glow(point, radius, activity ? 1 : compact ? 0.74 : 0.92, true, palette);

    for (const boundary of metrics.boundaries) {
      const delta = Math.abs(routeProgress - boundary.progress);
      if (delta < 0.052) {
        const strength = 1 - delta / 0.052;
        glow(boundary.point, radius * (1.10 + strength * 0.95), 0.16 + strength * (activity ? 0.52 : 0.40), true, palette);
      }
    }
    ctx.restore();
  }

  function reverseCurve(curve) {
    return {
      ...curve,
      p0: curve.p3,
      p1: curve.p2,
      p2: curve.p1,
      p3: curve.p0
    };
  }

  function activityRoute(source, target, trunk, targetRoute = null) {
    const sourceLeg = [trunk];
    if (source.stem) sourceLeg.push(source.stem);
    sourceLeg.push(source.branch);
    if (source === target) return sourceLeg;
    if (targetRoute?.length) return sourceLeg.slice().reverse().map(reverseCurve).concat(targetRoute);
    const targetLeg = [trunk];
    if (target?.stem) targetLeg.push(target.stem);
    if (target?.branch) targetLeg.push(target.branch);
    return sourceLeg.slice().reverse().map(reverseCurve).concat(targetLeg);
  }

  function collectActivityContext(segments, centre, compact = false) {
    const activeByApp = new Map();
    for (const segment of segments) {
      const activity = activityFor(segment.activityTarget);
      const appId = segment.activityTarget?.appId;
      if (!activity || !appId || activeByApp.has(appId)) continue;
      const targetGeometry = buildClusterGeometry([segment], centre, -1, compact);
      const targetChild = targetGeometry.children[0] || null;
      activeByApp.set(appId, {
        target: segment.activityTarget,
        activity,
        targetRoute: targetChild ? [targetGeometry.trunk, ...(targetChild.stem ? [targetChild.stem] : []), targetChild.branch] : []
      });
    }
    return activeByApp;
  }

  function activityFor(target) {
    if (!target?.appId || !target?.nodeId) return null;
    const activity = globalThis.UniversalAppAdapters?.getAppActivity?.(target.appId, target.nodeId);
    return activity?.pending ? activity : null;
  }

  function drawActivityHeartbeat(point, count, timestamp) {
    const pulse = 0.5 + Math.sin(timestamp * 0.0042) * 0.5;
    const strength = Math.min(1, 0.42 + Math.log2(Math.max(1, Number(count || 1)) + 1) * 0.12);
    glow(point, 15 + pulse * 5, strength * (0.24 + pulse * 0.12), false, 'purple');
  }

  function drawNetworkFlow(segments, timestamp, compact = false, activityContext = null) {
    if (!segments.length) return;
    const centre = centrePoint(segments);
    if (!centre) return;
    const activeByApp = activityContext || collectActivityContext(segments, centre, compact);
    const clusters = makeClusters(segments, centre, compact);

    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      const geometry = buildClusterGeometry(clusters[clusterIndex], centre, clusterIndex, compact);
      const children = geometry.children;
      const maxPulses = compact ? 2 : 3;
      if (!children.length) {
        drawRoutePulse([geometry.trunk], geometry.seed, timestamp, clusterIndex * 0.21, compact);
        continue;
      }
      const stride = Math.max(1, Math.ceil(children.length / maxPulses));
      let emitted = 0;
      for (let childIndex = 0; childIndex < children.length && emitted < maxPulses; childIndex += stride) {
        const child = children[childIndex];
        const route = [geometry.trunk];
        if (child.stem) route.push(child.stem);
        route.push(child.branch);
        drawRoutePulse(route, child.seed + geometry.seed, timestamp, clusterIndex * 0.17 + emitted * 0.31, compact);
        emitted += 1;
      }

      let pendingCount = 0;
      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const child = children[childIndex];
        const appId = child.activityTarget?.appId;
        const active = appId ? activeByApp.get(appId) : null;
        if (!active) continue;
        const isTarget = child.activityTarget.nodeId === active.target.nodeId;
        const targetChild = children.find((candidate) => candidate.activityTarget?.nodeId === active.target.nodeId);
        const route = isTarget && targetChild
          ? activityRoute(child, child, geometry.trunk)
          : activityRoute(child, targetChild, geometry.trunk, active.targetRoute);
        drawRoutePulse(route, child.seed + geometry.seed, timestamp, clusterIndex * 0.17 + childIndex * 0.083, compact, {
          activity: true,
          activityTarget: active.target,
          reverse: false
        });
        if (isTarget) pendingCount += active.activity.count;
      }
      if (pendingCount > 0) drawActivityHeartbeat(centre, pendingCount, timestamp);
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

  function drawFrame(timestamp) {
    frame = requestAnimationFrame(drawFrame);
    if (!ctx || !layer || !sourceCanvas?.isConnected || document.hidden) return;
    const interacting = sourceCanvas.dataset.interacting === 'true';
    const frameMs = interacting ? 72 : 34;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;

    const rect = sourceCanvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (!interacting) {
      for (const group of groupManualSegments(mainSegments)) {
        const centre = centrePoint(group.segments);
        drawNetworkFlow(group.segments, timestamp, false, centre ? collectActivityContext(group.segments, centre, false) : null);
      }
    }

    if (!interacting) {
      for (const group of groupManualSegments(manualSegments)) {
        // Folder pulses use the same route geometry, pulse count and glow size
        // as normal memory routes; grouping remains semantic only.
        drawNetworkFlow(group.segments, timestamp, false);
      }
    }
  }

  proto.beginPath = function memoryGraphNeuralFlowBeginPath(...args) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryFlowStart = null;
      this.__memoryFlowEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function memoryGraphNeuralFlowMoveTo(x, y, ...rest) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryFlowStart = { x: Number(x), y: Number(y) };
      this.__memoryFlowEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function memoryGraphNeuralFlowLineTo(x, y, ...rest) {
    if ((isMainGraph(this) || isManualOverlay(this)) && this.__memoryFlowStart) this.__memoryFlowEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function memoryGraphNeuralFlowClearRect(...args) {
    if (isMainGraph(this)) mainSegments.length = 0;
    if (isManualOverlay(this)) manualSegments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function memoryGraphNeuralFlowStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this, false);
    else if (isManualOverlay(this) && isSemanticBlueLine(this) && String(this.strokeStyle || '').includes('55, 139, 255')) capture(this, true);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralFlowStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralFlowStyles';
    style.textContent = '.memory-graph-neural-flow-canvas{position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;opacity:1}';
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralFlow = Object.freeze({
    version: VERSION,
    mainSegmentCount: () => mainSegments.length,
    manualSegmentCount: () => manualSegments.length,
    redraw() { lastPaint = 0; }
  });
})();
