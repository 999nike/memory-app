(() => {
  'use strict';

  const VERSION = 2;
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

  // IMPORTANT: this hash exactly matches memory-graph-neural-arms.js.
  // This terminal layer now follows the EXISTING medium-root geometry instead of
  // reconstructing a separate branch system, which prevents detached tip fragments.
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7829.381 + a * 101.219 + b * 241.637) * 43758.5453;
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

  function mediumBranch(major, mainWidth, seed, arm) {
    const positions = [0.08, 0.16, 0.25, 0.35, 0.46, 0.57, 0.68, 0.78, 0.87];
    const local = seed + arm * 0.613;
    const t = clamp(positions[arm] + (hash(local, 1, 2) - 0.5) * 0.034, 0.06, 0.91);
    const origin = pointOnCurve(major, t);
    const tangent = tangentOnCurve(major, t);
    const nx = -tangent.y;
    const ny = tangent.x;
    const side = hash(local, 3, 4) > 0.47 ? 1 : -1;
    const branchWidth = mainWidth * (0.15 + hash(local, 7, 8) * 0.075) * (1 - t * 0.16);
    const reach = mainWidth * (2.5 + hash(local, 5, 6) * 2.7) * (1 - t * 0.10);
    const start = {
      x: origin.x + nx * side * mainWidth * 0.07 - tangent.x * branchWidth * 0.82,
      y: origin.y + ny * side * mainWidth * 0.07 - tangent.y * branchWidth * 0.82
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
    return {
      local,
      width: branchWidth,
      curve: {
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
      }
    };
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

  function buildTail(branch) {
    const { curve, width, local } = branch;
    const centre = [];
    const halfWidths = [];
    const tangents = [];
    const startT = 0.62;
    const sourceSteps = 10;

    for (let index = 0; index <= sourceSteps; index += 1) {
      const t = startT + (1 - startT) * (index / sourceSteps);
      const p = pointOnCurve(curve, t);
      const tangent = tangentOnCurve(curve, t);
      const shoulder = 0.72 * Math.exp(-Math.pow(t / 0.22, 2));
      const taper = 0.12 + Math.pow(1 - t, 0.82) * 0.88 + shoulder;
      centre.push(p);
      tangents.push(tangent);
      halfWidths.push(width * taper * 0.96);
    }

    const oldEnd = curve.p3;
    const endTangent = tangentOnCurve(curve, 0.985);
    const nx = -endTangent.y;
    const ny = endTangent.x;
    const side = hash(local, 70, 71) > 0.5 ? 1 : -1;
    const extension = width * (3.0 + hash(local, 72, 73) * 2.6);
    const extensionSteps = 8;

    for (let index = 1; index <= extensionSteps; index += 1) {
      const u = index / extensionSteps;
      const bend = Math.sin(Math.PI * u) * extension * (0.07 + hash(local, 74, 75) * 0.07) * side;
      const p = {
        x: oldEnd.x + endTangent.x * extension * u + nx * bend,
        y: oldEnd.y + endTangent.y * extension * u + ny * bend
      };
      const tangent = {
        x: endTangent.x + nx * side * (1 - u) * 0.08,
        y: endTangent.y + ny * side * (1 - u) * 0.08
      };
      const tangentLength = Math.max(0.001, Math.hypot(tangent.x, tangent.y));
      centre.push(p);
      tangents.push({ x: tangent.x / tangentLength, y: tangent.y / tangentLength });
      halfWidths.push(width * (0.12 * Math.pow(1 - u, 0.78) + 0.004));
    }

    const left = [];
    const right = [];
    for (let index = 0; index < centre.length; index += 1) {
      const tangent = tangents[index];
      const nxLocal = -tangent.y;
      const nyLocal = tangent.x;
      const ripple = Math.sin((index / Math.max(1, centre.length - 1)) * Math.PI * 4.4 + local * 9.1) * 0.06;
      const half = halfWidths[index] * (1 + ripple);
      left.push({ x: centre[index].x + nxLocal * half, y: centre[index].y + nyLocal * half });
      right.push({ x: centre[index].x - nxLocal * half, y: centre[index].y - nyLocal * half });
    }
    return { centre, left, right, width, local };
  }

  function drawTail(ctx, branch) {
    const tail = buildTail(branch);
    const body = [...tail.left, ...tail.right.slice().reverse()];
    const first = tail.centre[0];
    const last = tail.centre[tail.centre.length - 1];

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = 'rgba(13,38,104,.26)';
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(58,95,241,.20)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
    tissue.addColorStop(0, 'rgba(108,88,248,.28)');
    tissue.addColorStop(0.45, 'rgba(69,116,241,.25)');
    tissue.addColorStop(0.78, 'rgba(55,151,242,.18)');
    tissue.addColorStop(1, 'rgba(49,154,231,.03)');
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, tail.centre);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.20, tail.width * 0.040);
    ctx.strokeStyle = 'rgba(214,244,255,.48)';
    previousStroke.call(ctx);

    const forkBaseIndex = Math.max(1, tail.centre.length - 5);
    const forkBase = tail.centre[forkBaseIndex];
    const tangent = tail.centre.length > forkBaseIndex + 1
      ? (() => {
          const next = tail.centre[forkBaseIndex + 1];
          const dx = next.x - forkBase.x;
          const dy = next.y - forkBase.y;
          const len = Math.max(0.001, Math.hypot(dx, dy));
          return { x: dx / len, y: dy / len };
        })()
      : { x: 1, y: 0 };
    const nx = -tangent.y;
    const ny = tangent.x;
    for (const side of [-1, 1]) {
      const reach = tail.width * (1.7 + hash(tail.local, side, 88) * 1.6);
      const end = {
        x: forkBase.x + tangent.x * reach * 0.72 + nx * side * reach * 0.58,
        y: forkBase.y + tangent.y * reach * 0.72 + ny * side * reach * 0.58
      };
      ctx.beginPath();
      ctx.moveTo(forkBase.x, forkBase.y);
      ctx.quadraticCurveTo(
        forkBase.x + tangent.x * reach * 0.34 + nx * side * reach * 0.18,
        forkBase.y + tangent.y * reach * 0.34 + ny * side * reach * 0.18,
        end.x,
        end.y
      );
      ctx.lineWidth = 0.22;
      ctx.strokeStyle = 'rgba(124,202,255,.20)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawMediumBranchTails(ctx, roots) {
    if (roots.length < 2) return;
    const nexus = nexusPoint(roots);
    roots.forEach((root, rootIndex) => {
      const rootSeed = Math.abs(Math.sin(root.centre.x * 0.017 + root.centre.y * 0.029 + rootIndex * 0.731));
      const major = controlPoints(nexus, root.centre, rootSeed, 0.78, rootIndex + 1);
      const mainWidth = clamp(major.length * 0.055, 10, 20);
      const branchSeed = rootSeed + 0.39;
      for (let arm = 0; arm < 9; arm += 1) {
        drawTail(ctx, mediumBranch(major, mainWidth, branchSeed, arm));
      }
    });
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
    drawMediumBranchTails(layerContext, rootGroups(segments));
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
        opacity:.92;
      }
    `;
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralTerminal = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();