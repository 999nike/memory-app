(() => {
  'use strict';

  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralLinksInstalled) return;

  Object.defineProperty(proto, '__memoryGraphNeuralLinksInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousStroke = proto.stroke;
  const previousClearRect = proto.clearRect;

  const VERSION = 2;
  const CORE_FRAME_MS = 38;
  const MOBILE_FRAME_MS = 52;
  const INTERACTING_FRAME_MS = 76;
  const POINT_EPSILON = 4.5;

  let surface = null;
  let graphCanvas = null;
  let canvas = null;
  let ctx = null;
  let frame = 0;
  let lastPaint = 0;
  let coreSegments = [];
  let manualSegments = [];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(seed, a = 0, b = 0) {
    const value = Math.sin((Number(seed) || 0) * 9187.133 + a * 73.731 + b * 193.771) * 43758.5453;
    return value - Math.floor(value);
  }

  function segmentSeed(from, to, salt = 0) {
    const raw = Number(from?.x || 0) * 0.013 + Number(from?.y || 0) * 0.017
      + Number(to?.x || 0) * 0.019 + Number(to?.y || 0) * 0.023 + salt * 0.071;
    return Math.abs(Math.sin(raw * 13.731));
  }

  function isCoreGraph(context) {
    return context?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isManualGravity(context) {
    return context?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  }

  function styleAlpha(style, fallback = 1) {
    const match = String(style || '').match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/i);
    if (!match) return fallback;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : fallback;
  }

  function isCoreConnector(context) {
    if (!isCoreGraph(context) || !context.__dendritePathStart || !context.__dendritePathEnd) return false;
    const style = String(context.strokeStyle || '');
    const width = Math.max(0, Number(context.lineWidth) || 0);
    return width <= 1.6 && style.includes('120, 184, 255');
  }

  function manualTracePass(context) {
    if (!isManualGravity(context) || !context.__dendritePathStart || !context.__dendritePathEnd) return '';
    const style = String(context.strokeStyle || '');
    const alpha = styleAlpha(style);
    if (style.includes('55, 139, 255') && alpha <= 0.14) return 'capture';
    if (style.includes('120, 184, 255') && alpha >= 0.36 && alpha <= 0.44) return 'suppress';
    if (style.includes('241, 251, 255') && alpha >= 0.82) return 'suppress';
    return '';
  }

  function screenPoint(context, point) {
    const target = context?.canvas;
    if (!target || !point) return null;
    const rect = target.getBoundingClientRect();
    const dpr = Math.max(1, target.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    return {
      x: (matrix.a * point.x + matrix.c * point.y + matrix.e) / dpr,
      y: (matrix.b * point.x + matrix.d * point.y + matrix.f) / dpr
    };
  }

  function captureSegment(context, target, reverse = false, widthScale = 1) {
    const start = screenPoint(context, context.__dendritePathStart);
    const end = screenPoint(context, context.__dendritePathEnd);
    if (!start || !end) return;
    const from = reverse ? end : start;
    const to = reverse ? start : end;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 8) return;
    target.push({
      from,
      to,
      seed: segmentSeed(from, to, target.length + widthScale),
      widthScale: clamp(Number(widthScale) || 1, 0.45, 1.5)
    });
    ensureOverlay();
  }

  function near(a, b, epsilon = POINT_EPSILON) {
    return Boolean(a && b && Math.hypot(a.x - b.x, a.y - b.y) <= epsilon);
  }

  function installStyles() {
    if (document.getElementById('memoryGraphDendriteStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphDendriteStyles';
    style.textContent = `
      .memory-graph-neural-canvas,
      .memory-graph-spark-canvas { display:none !important; }
      .memory-graph-dendrite-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
      }
      .memory-graph-manual-gravity-canvas { z-index:2 !important; }
      .memory-graph-canvas { z-index:3 !important; }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    surface = surface || document.getElementById('memoryGraphSurface');
    graphCanvas = graphCanvas || document.querySelector('.memory-graph-canvas');
    if (!surface) return false;

    if (!canvas || !canvas.isConnected) {
      canvas = document.createElement('canvas');
      canvas.className = 'memory-graph-dendrite-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      const manualOverlay = surface.querySelector('.memory-graph-manual-gravity-canvas');
      if (manualOverlay) surface.insertBefore(canvas, manualOverlay);
      else surface.appendChild(canvas);
      ctx = canvas.getContext('2d');
    }

    if (!ctx) return false;
    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    startLoop();
    return true;
  }

  function cubicPoint(spec, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * mt * spec.from.x
        + 3 * mt * mt * t * spec.c1.x
        + 3 * mt * t * t * spec.c2.x
        + t * t * t * spec.to.x,
      y: mt * mt * mt * spec.from.y
        + 3 * mt * mt * t * spec.c1.y
        + 3 * mt * t * t * spec.c2.y
        + t * t * t * spec.to.y
    };
  }

  function curveSpec(from, to, seed, timestamp, bendScale = 1) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const tx = dx / length;
    const ty = dy / length;
    const px = -ty;
    const py = tx;
    const base = (hashUnit(seed, 2, 7) * 2 - 1) * clamp(length * 0.11, 5, 42) * bendScale;
    const breathing = Math.sin(timestamp * 0.00034 + seed * 27.1) * clamp(length * 0.009, 0.8, 3.7);
    const skew = (hashUnit(seed, 8, 3) * 2 - 1) * clamp(length * 0.025, 1.5, 10);
    const bend = base + breathing;
    return {
      from,
      to,
      length,
      px,
      py,
      c1: {
        x: from.x + dx * 0.33 + px * (bend + skew),
        y: from.y + dy * 0.33 + py * (bend + skew)
      },
      c2: {
        x: from.x + dx * 0.67 - px * (bend * 0.62 - skew * 0.35),
        y: from.y + dy * 0.67 - py * (bend * 0.62 - skew * 0.35)
      }
    };
  }

  function buildFiber(from, to, seed, timestamp, interacting = false, bendScale = 1) {
    const spec = curveSpec(from, to, seed, timestamp, bendScale);
    const count = clamp(Math.round(spec.length / (interacting ? 34 : 22)), 7, interacting ? 12 : 21);
    const points = [];
    const phase = seed * 29.3;
    const freqA = 1.2 + hashUnit(seed, 4, 5) * 1.4;
    const freqB = 3.0 + hashUnit(seed, 7, 9) * 2.2;
    const amp = clamp(spec.length * 0.0048, 0.45, interacting ? 1.45 : 2.6);

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const base = cubicPoint(spec, t);
      const envelope = Math.sin(Math.PI * t);
      const drift = Math.sin(timestamp * 0.00023 + phase + t * 2.4) * 0.22;
      const organic = Math.sin(t * Math.PI * freqA + phase)
        + Math.sin(t * Math.PI * freqB + phase * 0.61) * 0.34
        + drift;
      const offset = organic * amp * envelope;
      points.push({
        x: base.x + spec.px * offset,
        y: base.y + spec.py * offset
      });
    }
    return { spec, points };
  }

  function tracePoints(context, points) {
    if (!points?.length) return;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      context.lineTo(points[1].x, points[1].y);
      return;
    }
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      context.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    const penultimate = points[points.length - 2];
    const last = points[points.length - 1];
    context.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
  }

  function strokePoints(context, points, width, colour, blur = 0, shadow = colour, composite = 'source-over') {
    if (!points?.length) return;
    context.save();
    context.globalCompositeOperation = composite;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = width;
    context.strokeStyle = colour;
    if (blur > 0) {
      context.shadowBlur = blur;
      context.shadowColor = shadow;
    }
    tracePoints(context, points);
    context.stroke();
    context.restore();
  }

  function slicePoints(points, start, end) {
    const count = points.length;
    const a = clamp(Math.floor((count - 1) * start), 0, count - 2);
    const b = clamp(Math.ceil((count - 1) * end), a + 1, count - 1);
    return points.slice(a, b + 1);
  }

  function drawHotspot(context, point, intensity = 1, radius = 5) {
    if (!point || intensity <= 0) return;
    const alpha = clamp(intensity, 0, 1);
    const size = radius * (0.9 + alpha * 0.3);
    context.save();
    context.globalCompositeOperation = 'lighter';
    const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, size);
    glow.addColorStop(0, `rgba(244,252,255,${(0.58 * alpha).toFixed(3)})`);
    glow.addColorStop(0.18, `rgba(132,221,255,${(0.42 * alpha).toFixed(3)})`);
    glow.addColorStop(0.55, `rgba(46,143,255,${(0.13 * alpha).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(26,92,220,0)');
    context.beginPath();
    context.arc(point.x, point.y, size, 0, Math.PI * 2);
    context.fillStyle = glow;
    context.fill();
    context.restore();
  }

  function pulseWindow(seed, timestamp, importance = 1) {
    const period = 7000 + hashUnit(seed, 3, 7) * 5200;
    const travel = 1500 + hashUnit(seed, 8, 4) * 1100;
    const offset = hashUnit(seed, 11, 9) * period;
    const local = (timestamp + offset) % period;
    if (local > travel * importance) return null;
    return clamp(local / travel, 0, 1);
  }

  function drawPulse(context, fiber, seed, timestamp, widthScale, intensity, importance = 1) {
    const progress = pulseWindow(seed, timestamp, importance);
    if (progress === null) return 0;
    const point = cubicPoint(fiber.spec, progress);
    const radius = clamp(3.8 * widthScale, 2.4, 5.8);
    drawHotspot(context, point, 0.82 * intensity, radius);
    context.save();
    context.globalCompositeOperation = 'lighter';
    context.beginPath();
    context.arc(point.x, point.y, Math.max(0.65, widthScale * 0.7), 0, Math.PI * 2);
    context.fillStyle = `rgba(246,253,255,${(0.74 * intensity).toFixed(3)})`;
    context.fill();
    context.restore();
    return progress > 0.93 ? (progress - 0.93) / 0.07 : 0;
  }

  function drawMicroBranch(context, fiber, seed, timestamp, t, direction, widthScale, intensity) {
    const points = fiber.points;
    const index = clamp(Math.round(t * (points.length - 1)), 1, points.length - 2);
    const origin = points[index];
    const before = points[index - 1];
    const after = points[index + 1];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const tx = dx / length;
    const ty = dy / length;
    const px = -ty;
    const py = tx;
    const reach = (6 + hashUnit(seed, index, 8) * 13) * widthScale;
    const tangent = (hashUnit(seed, index, 9) - 0.5) * 9;
    const end = {
      x: origin.x + px * reach * direction + tx * tangent,
      y: origin.y + py * reach * direction + ty * tangent
    };
    const branch = buildFiber(origin, end, seed + 0.39, timestamp, false, 0.6);
    strokePoints(context, branch.points, Math.max(0.28, 0.42 * widthScale), `rgba(92,191,242,${(0.16 * intensity).toFixed(3)})`, 2.5, 'rgba(62,156,235,0.20)', 'lighter');
    if (hashUnit(seed, index, 15) > 0.64) drawHotspot(context, end, 0.28 * intensity, 2.4);
  }

  function drawConnection(context, from, to, seed, timestamp, options = {}) {
    const widthScale = clamp(Number(options.widthScale) || 1, 0.32, 1.8);
    const intensity = clamp(Number(options.intensity) || 1, 0.20, 1.35);
    const interacting = Boolean(options.interacting);
    const fiber = buildFiber(from, to, seed, timestamp, interacting, Number(options.bendScale) || 1);
    if (fiber.spec.length < 8) return 0;

    const glowWidth = Math.max(3.2, 7.2 * widthScale);
    const bodyWidth = Math.max(1.0, 2.35 * widthScale);
    strokePoints(context, fiber.points, glowWidth, `rgba(32,112,212,${(0.026 * intensity).toFixed(3)})`, interacting ? 5 : 11, `rgba(35,128,230,${(0.20 * intensity).toFixed(3)})`, 'lighter');

    const first = slicePoints(fiber.points, 0, 0.38);
    const middle = slicePoints(fiber.points, 0.34, 0.72);
    const end = slicePoints(fiber.points, 0.68, 1);
    strokePoints(context, first, bodyWidth * 1.12, `rgba(49,145,224,${(0.20 * intensity).toFixed(3)})`, 4, 'rgba(48,151,231,0.24)', 'lighter');
    strokePoints(context, middle, bodyWidth * 0.92, `rgba(67,166,231,${(0.18 * intensity).toFixed(3)})`, 3.5, 'rgba(64,170,235,0.22)', 'lighter');
    strokePoints(context, end, bodyWidth * 0.72, `rgba(84,184,237,${(0.16 * intensity).toFixed(3)})`, 3, 'rgba(76,180,238,0.20)', 'lighter');

    if (!interacting) {
      const companionCount = options.companions === false ? 0 : fiber.spec.length > 120 ? 2 : 1;
      for (let index = 0; index < companionCount; index += 1) {
        const sign = index % 2 === 0 ? 1 : -1;
        const supportSeed = seed + 0.21 + index * 0.33;
        const support = buildFiber(from, to, supportSeed, timestamp, false, 0.72 + index * 0.08);
        const shift = (2.0 + hashUnit(seed, index, 12) * 3.0) * sign;
        const shifted = support.points.map((point, pointIndex) => {
          const t = pointIndex / Math.max(1, support.points.length - 1);
          const envelope = Math.sin(Math.PI * t);
          return { x: point.x + support.spec.px * shift * envelope, y: point.y + support.spec.py * shift * envelope };
        });
        strokePoints(context, shifted, Math.max(0.24, 0.38 * widthScale), `rgba(84,182,231,${(0.11 * intensity).toFixed(3)})`, 2, 'rgba(61,154,224,0.14)', 'lighter');
      }

      const coreA = slicePoints(fiber.points, 0.18, 0.46);
      strokePoints(context, coreA, Math.max(0.32, 0.50 * widthScale), `rgba(201,239,255,${(0.28 * intensity).toFixed(3)})`, 1.6, 'rgba(177,231,255,0.20)', 'lighter');
      if (fiber.spec.length > 100) {
        const coreB = slicePoints(fiber.points, 0.70, 0.86);
        strokePoints(context, coreB, Math.max(0.26, 0.42 * widthScale), `rgba(218,245,255,${(0.22 * intensity).toFixed(3)})`, 1.2, 'rgba(190,235,255,0.18)', 'lighter');
      }

      if (options.microBranches !== false && fiber.spec.length > 70) {
        drawMicroBranch(context, fiber, seed + 0.13, timestamp, 0.27, 1, widthScale, intensity);
        if (fiber.spec.length > 135) drawMicroBranch(context, fiber, seed + 0.47, timestamp, 0.67, -1, widthScale, intensity);
      }
    }

    return options.pulses === false || interacting
      ? 0
      : drawPulse(context, fiber, seed, timestamp, widthScale, intensity, Number(options.pulseImportance) || 1);
  }

  function deriveClusters() {
    const trunks = [];
    for (let index = 0; index < manualSegments.length; index += 1) {
      const candidate = manualSegments[index];
      const hasChildren = manualSegments.some((other, otherIndex) => otherIndex !== index && near(candidate.to, other.from));
      if (!hasChildren) continue;
      if (trunks.some((item) => near(item.to, candidate.to) && near(item.from, candidate.from))) continue;
      trunks.push(candidate);
    }

    return trunks.map((trunk, trunkIndex) => ({
      trunk,
      centre: trunk.to,
      seed: trunk.seed + trunkIndex * 0.173,
      children: manualSegments.filter((segment) => segment !== trunk && near(segment.from, trunk.to))
    }));
  }

  function groupedChildPoints(clusters) {
    return clusters.flatMap((cluster) => cluster.children.map((child) => child.to));
  }

  function isGroupedCoreSegment(segment, childPoints) {
    return childPoints.some((point) => near(segment.from, point, 7.5) || near(segment.to, point, 7.5));
  }

  function branchArms(cluster) {
    const children = cluster.children.slice();
    if (!children.length) return [];
    const centre = cluster.centre;
    children.sort((a, b) => Math.atan2(a.to.y - centre.y, a.to.x - centre.x) - Math.atan2(b.to.y - centre.y, b.to.x - centre.x));
    const armCount = children.length === 1 ? 1 : clamp(Math.ceil(children.length / 3), 2, 5);
    const arms = Array.from({ length: armCount }, () => []);
    for (let index = 0; index < children.length; index += 1) {
      const armIndex = Math.min(armCount - 1, Math.floor(index * armCount / children.length));
      arms[armIndex].push(children[index]);
    }
    return arms.filter((items) => items.length);
  }

  function junctionFor(centre, children, seed) {
    let vx = 0;
    let vy = 0;
    let distance = 0;
    for (const child of children) {
      const dx = child.to.x - centre.x;
      const dy = child.to.y - centre.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      vx += dx / length;
      vy += dy / length;
      distance += length;
    }
    const norm = Math.max(1e-6, Math.hypot(vx, vy));
    const ux = vx / norm;
    const uy = vy / norm;
    const px = -uy;
    const py = ux;
    const avgDistance = distance / Math.max(1, children.length);
    const reach = clamp(avgDistance * 0.46, 18, 48);
    const skew = (hashUnit(seed, 4, 8) * 2 - 1) * clamp(reach * 0.25, 2, 9);
    return {
      x: centre.x + ux * reach + px * skew,
      y: centre.y + uy * reach + py * skew
    };
  }

  function drawLocalMesh(context, cluster, timestamp, interacting) {
    if (interacting || cluster.children.length < 2) return;
    const candidates = [];
    for (let i = 0; i < cluster.children.length; i += 1) {
      for (let j = i + 1; j < cluster.children.length; j += 1) {
        const a = cluster.children[i].to;
        const b = cluster.children[j].to;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance <= 105) candidates.push({ a, b, distance, seed: segmentSeed(a, b, i * 19 + j * 31) });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const used = new Set();
    const maxLinks = Math.min(6, Math.ceil(cluster.children.length * 0.55));
    let drawn = 0;
    for (const link of candidates) {
      if (drawn >= maxLinks) break;
      const keyA = `${Math.round(link.a.x)}:${Math.round(link.a.y)}`;
      const keyB = `${Math.round(link.b.x)}:${Math.round(link.b.y)}`;
      if (used.has(keyA) && used.has(keyB)) continue;
      const fiber = buildFiber(link.a, link.b, link.seed, timestamp, false, 0.42);
      strokePoints(context, fiber.points, 0.34, 'rgba(57,145,207,0.085)', 1.8, 'rgba(55,137,203,0.10)', 'lighter');
      if (hashUnit(link.seed, 9, 2) > 0.72) drawHotspot(context, cubicPoint(fiber.spec, 0.5), 0.16, 2.0);
      used.add(keyA);
      used.add(keyB);
      drawn += 1;
    }
  }

  function drawCluster(context, cluster, timestamp, interacting, mobile) {
    const trunkEnergy = drawConnection(context, cluster.trunk.from, cluster.trunk.to, cluster.seed, timestamp, {
      widthScale: mobile ? 1.02 : 1.18,
      intensity: 0.84,
      interacting,
      pulses: true,
      pulseImportance: 1.16,
      companions: !mobile
    });

    drawHotspot(context, cluster.centre, 0.56 + trunkEnergy * 0.38, mobile ? 4.4 : 5.3);
    const arms = branchArms(cluster);
    for (let armIndex = 0; armIndex < arms.length; armIndex += 1) {
      const children = arms[armIndex];
      const seed = cluster.seed + 0.43 + armIndex * 0.291;
      const junction = junctionFor(cluster.centre, children, seed);
      drawConnection(context, cluster.centre, junction, seed, timestamp, {
        widthScale: 0.74,
        intensity: 0.58,
        interacting,
        pulses: false,
        companions: false,
        microBranches: children.length > 1,
        bendScale: 0.72
      });
      drawHotspot(context, junction, 0.34, 3.4);

      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const child = children[childIndex];
        const childSeed = seed + 0.17 + childIndex * 0.149;
        drawConnection(context, junction, child.to, childSeed, timestamp, {
          widthScale: 0.48 + (childIndex % 3) * 0.055,
          intensity: 0.48,
          interacting,
          pulses: false,
          companions: false,
          microBranches: false,
          bendScale: 0.62
        });
        drawHotspot(context, child.to, 0.26, 2.8);
      }
    }

    drawLocalMesh(context, cluster, timestamp, interacting);
  }

  function drawFrame(timestamp) {
    frame = requestAnimationFrame(drawFrame);
    if (!ensureOverlay() || !ctx || !canvas || document.hidden) return;

    const rect = surface.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;

    const interacting = graphCanvas?.dataset.interacting === 'true';
    const mobile = window.matchMedia?.('(max-width: 800px)')?.matches === true;
    const frameMs = interacting ? INTERACTING_FRAME_MS : mobile ? MOBILE_FRAME_MS : CORE_FRAME_MS;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;

    ctx.clearRect(0, 0, rect.width, rect.height);
    const clusters = deriveClusters();
    const childPoints = groupedChildPoints(clusters);
    const visibleCore = coreSegments.filter((segment) => !isGroupedCoreSegment(segment, childPoints));

    let hubPoint = null;
    let hubEnergy = 0;
    for (const segment of visibleCore) {
      const energy = drawConnection(ctx, segment.from, segment.to, segment.seed, timestamp, {
        widthScale: 0.86,
        intensity: 0.62,
        interacting,
        pulses: true,
        pulseImportance: 0.72,
        companions: !mobile
      });
      drawHotspot(ctx, segment.from, 0.22, 2.6);
      if (energy > hubEnergy) {
        hubEnergy = energy;
        hubPoint = segment.to;
      }
    }

    for (const cluster of clusters) drawCluster(ctx, cluster, timestamp, interacting, mobile);
    if (hubPoint) drawHotspot(ctx, hubPoint, 0.22 + hubEnergy * 0.36, 5.4);
  }

  function startLoop() {
    if (frame) return;
    frame = requestAnimationFrame(drawFrame);
  }

  proto.beginPath = function memoryGraphDendriteBeginPath(...args) {
    this.__dendritePathStart = null;
    this.__dendritePathEnd = null;
    this.__dendritePathPointCount = 0;
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function memoryGraphDendriteMoveTo(x, y, ...rest) {
    this.__dendritePathStart = { x: Number(x), y: Number(y) };
    this.__dendritePathEnd = null;
    this.__dendritePathPointCount = 1;
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function memoryGraphDendriteLineTo(x, y, ...rest) {
    if (this.__dendritePathStart) {
      this.__dendritePathEnd = { x: Number(x), y: Number(y) };
      this.__dendritePathPointCount = Number(this.__dendritePathPointCount || 1) + 1;
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function memoryGraphDendriteClearRect(...args) {
    if (isCoreGraph(this)) coreSegments = [];
    else if (isManualGravity(this)) manualSegments = [];
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function memoryGraphDendriteStroke(...args) {
    if (isCoreConnector(this)) {
      captureSegment(this, coreSegments, true, 1);
      return undefined;
    }

    const manualPass = manualTracePass(this);
    if (manualPass) {
      if (manualPass === 'capture') {
        const sourceWidth = Math.max(0.5, Number(this.lineWidth) || 1);
        captureSegment(this, manualSegments, false, clamp(sourceWidth / 4, 0.62, 1.15));
      }
      return undefined;
    }

    return previousStroke.apply(this, args);
  };

  function mount() {
    installStyles();
    surface = document.getElementById('memoryGraphSurface');
    graphCanvas = document.querySelector('.memory-graph-canvas');
    ensureOverlay();
  }

  globalThis.MemoryGraphNeuralLinks = Object.freeze({
    version: VERSION,
    drawConnection,
    snapshot() {
      const clusters = deriveClusters();
      return {
        version: VERSION,
        coreConnections: coreSegments.length,
        groupedClusters: clusters.length,
        groupedChildren: groupedChildPoints(clusters).length
      };
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }
})();
