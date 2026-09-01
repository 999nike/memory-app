(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralTerminalInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralTerminalInstalled', { value: true });

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

  const FRAME_MS = 76;
  const INTERACTING_FRAME_MS = 180;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7937.511 + a * 97.137 + b * 251.843) * 43758.5453;
    return value - Math.floor(value);
  };

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(ctx) {
    if (!ctx?.__memoryNeuralTerminalStart || !ctx?.__memoryNeuralTerminalEnd) return false;
    return String(ctx.strokeStyle || '').includes('120, 184, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-terminal-canvas';
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
    const start = ctx.__memoryNeuralTerminalStart;
    const end = ctx.__memoryNeuralTerminalEnd;
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
        p1: { x: start.x + tangent.x * reach * 0.42 + nx * side * reach * 0.12, y: start.y + tangent.y * reach * 0.42 + ny * side * reach * 0.12 },
        p2: { x: start.x + dx * 0.73 + nx * side * reach * 0.08, y: start.y + dy * 0.73 + ny * side * reach * 0.08 },
        p3: end,
        length: distance(start, end)
      },
      width: branchWidth
    };
  }

  function childCurve(parentCurve, parentWidth, seed) {
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
    return {
      curve: {
        p0: { x: origin.x - tangent.x * width * 1.2, y: origin.y - tangent.y * width * 1.2 },
        p1: { x: origin.x + tangent.x * reach * 0.24 + nx * side * reach * 0.26, y: origin.y + tangent.y * reach * 0.24 + ny * side * reach * 0.26 },
        p2: { x: origin.x + tangent.x * reach * 0.46 + nx * side * reach * 0.72, y: origin.y + tangent.y * reach * 0.46 + ny * side * reach * 0.72 },
        p3: end,
        length: distance(origin, end)
      },
      width
    };
  }

  function drawTip(ctx, parent, width, seed) {
    const start = pointOnCurve(parent, 0.61);
    const tangent = tangentOnCurve(parent, 0.98);
    const nx = -tangent.y;
    const ny = tangent.x;
    const oldEnd = parent.p3;
    const extension = width * (3.8 + hash(seed, 1, 2) * 3.4);
    const side = hash(seed, 3, 4) > 0.5 ? 1 : -1;
    const end = {
      x: oldEnd.x + tangent.x * extension + nx * side * extension * (0.12 + hash(seed, 5, 6) * 0.22),
      y: oldEnd.y + tangent.y * extension + ny * side * extension * (0.12 + hash(seed, 5, 6) * 0.22)
    };
    const curve = {
      p0: start,
      p1: { x: start.x + tangent.x * extension * 0.40 + nx * side * extension * 0.08, y: start.y + tangent.y * extension * 0.40 + ny * side * extension * 0.08 },
      p2: { x: oldEnd.x + tangent.x * extension * 0.42 + nx * side * extension * 0.18, y: oldEnd.y + tangent.y * extension * 0.42 + ny * side * extension * 0.18 },
      p3: end,
      length: distance(start, end)
    };

    const count = 18;
    const left = [];
    const right = [];
    const centre = [];
    const phase = hash(seed, 7, 8) * Math.PI * 2;
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const p = pointOnCurve(curve, t);
      const tan = tangentOnCurve(curve, t);
      const px = -tan.y;
      const py = tan.x;
      const taper = Math.pow(1 - t, 0.76);
      const ripple = Math.sin(t * Math.PI * 4.2 + phase) * 0.10 * Math.sin(Math.PI * t);
      const half = width * (0.84 * taper + 0.012) * (1 + ripple);
      centre.push(p);
      left.push({ x: p.x + px * half, y: p.y + py * half });
      right.push({ x: p.x - px * half, y: p.y - py * half });
    }
    const body = [...left, ...right.reverse()];

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(body[0].x, body[0].y);
    for (let i = 1; i < body.length; i += 1) ctx.lineTo(body[i].x, body[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(9,31,88,.42)';
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(62,101,244,.24)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath();
    ctx.moveTo(body[0].x, body[0].y);
    for (let i = 1; i < body.length; i += 1) ctx.lineTo(body[i].x, body[i].y);
    ctx.closePath();
    const tissue = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
    tissue.addColorStop(0, 'rgba(124,94,255,.44)');
    tissue.addColorStop(0.55, 'rgba(69,132,250,.34)');
    tissue.addColorStop(1, 'rgba(43,145,235,.08)');
    ctx.fillStyle = tissue;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(centre[0].x, centre[0].y);
    for (let i = 1; i < centre.length; i += 1) ctx.lineTo(centre[i].x, centre[i].y);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.18, width * 0.055);
    ctx.strokeStyle = 'rgba(224,249,255,.70)';
    previousStroke.call(ctx);

    const forkBase = pointOnCurve(curve, 0.76);
    const forkTan = tangentOnCurve(curve, 0.84);
    const fx = -forkTan.y;
    const fy = forkTan.x;
    for (const forkSide of [-1, 1]) {
      const local = seed + forkSide * 0.71;
      const reach = width * (2.2 + hash(local, 9, 10) * 2.6);
      ctx.beginPath();
      ctx.moveTo(forkBase.x, forkBase.y);
      ctx.quadraticCurveTo(
        forkBase.x + forkTan.x * reach * 0.42 + fx * forkSide * reach * 0.20,
        forkBase.y + forkTan.y * reach * 0.42 + fy * forkSide * reach * 0.20,
        forkBase.x + forkTan.x * reach * 0.72 + fx * forkSide * reach * 0.62,
        forkBase.y + forkTan.y * reach * 0.72 + fy * forkSide * reach * 0.62
      );
      ctx.lineWidth = Math.max(0.18, width * 0.11);
      ctx.strokeStyle = 'rgba(103,184,255,.28)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function angleDelta(a, b) {
    return Math.atan2(Math.sin(a - b), Math.cos(a - b));
  }

  function drawChildTips(ctx, roots) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    const positions = [0.13, 0.27, 0.42, 0.58, 0.74];
    roots.forEach((root, rootIndex) => {
      const seed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + rootIndex * 0.731));
      const major = controlPoints(nexus, root.centre, seed, 0.78, rootIndex + 1);
      const mainWidth = clamp(major.length * 0.055, 10, 20);
      for (let index = 0; index < positions.length - 1; index += 1) {
        const local = seed + 0.17 + index * 0.733;
        const t = clamp(positions[index] + (hash(local, 11, 12) - 0.5) * 0.052, 0.09, 0.82);
        const side = (index % 2 ? -1 : 1) * (hash(local, 13, 14) > 0.22 ? 1 : -1);
        const branch = branchCurveFromMajor(major, mainWidth, t, side, local);
        const child = childCurve(branch.curve, branch.width, local + 0.47);
        drawTip(ctx, child.curve, child.width, local + 1.31);
      }
    });
  }

  function drawFreeRootTips(ctx, roots) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    const rootAngles = roots.map((root) => Math.atan2(root.centre.y - nexus.y, root.centre.x - nexus.x));
    const averageDistance = roots.reduce((sum, root) => sum + distance(nexus, root.centre), 0) / Math.max(1, roots.length);
    const baseWidth = clamp(averageDistance * 0.016, 5.0, 9.2);
    const seed = roots.length * 0.31 + nexus.x * 0.001 + nexus.y * 0.0017;
    const rotation = hash(seed, 30, 31) * Math.PI * 2;
    let drawn = 0;

    for (let slot = 0; slot < 18 && drawn < 10; slot += 1) {
      const angle = rotation + (slot / 18) * Math.PI * 2;
      if (rootAngles.some((rootAngle) => Math.abs(angleDelta(angle, rootAngle)) < 0.25)) continue;
      const local = seed + slot * 0.527;
      const reach = baseWidth * (7.8 + hash(local, 32, 33) * 5.6);
      const endAngle = angle + (hash(local, 34, 35) - 0.5) * 0.74;
      const start = { x: nexus.x - Math.cos(angle) * baseWidth * 0.86, y: nexus.y - Math.sin(angle) * baseWidth * 0.86 };
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
      const width = baseWidth * (0.58 + hash(local, 38, 39) * 0.25);
      drawTip(ctx, curve, width, local + 1.73);
      drawn += 1;
    }
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
    if (interacting) return;
    const roots = rootGroups(segments);
    drawChildTips(layerContext, roots);
    drawFreeRootTips(layerContext, roots);
  }

  proto.beginPath = function neuralTerminalBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryNeuralTerminalStart = null;
      this.__memoryNeuralTerminalEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralTerminalMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryNeuralTerminalStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralTerminalEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralTerminalLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryNeuralTerminalStart) this.__memoryNeuralTerminalEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralTerminalClearRect(...args) {
    if (isMainGraph(this)) segments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralTerminalStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralTerminalStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralTerminalStyles';
    style.textContent = `
      .memory-graph-neural-terminal-canvas {
        position:absolute;
        inset:0;
        z-index:3;
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

  globalThis.MemoryGraphNeuralTerminal = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();