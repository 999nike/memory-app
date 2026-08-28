(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralDensityInstalled) return;

  Object.defineProperty(proto, '__memoryGraphNeuralDensityInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousClearRect = proto.clearRect;
  const previousStroke = proto.stroke;

  const NORMAL_FRAME_MS = 42;
  const INTERACTING_FRAME_MS = 76;
  const baseSegments = [];
  const manualSegments = [];

  let layer = null;
  let layerContext = null;
  let sourceCanvas = null;
  let frame = 0;
  let lastPaint = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(seed, a = 0, b = 0) {
    const value = Math.sin(seed * 9137.713 + a * 71.337 + b * 191.771) * 43758.5453;
    return value - Math.floor(value);
  }

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isManualOverlay(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  }

  function isBlueLine(ctx) {
    if (!ctx?.__memoryDensityLineStart || !ctx?.__memoryDensityLineEnd) return false;
    const style = String(ctx.strokeStyle || '');
    return style.includes('120, 184, 255') || style.includes('55, 139, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;

    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-density-canvas';
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
    startLoop();
    return true;
  }

  function transformedEndpoints(ctx) {
    const start = ctx.__memoryDensityLineStart;
    const end = ctx.__memoryDensityLineEnd;
    if (!start || !end) return null;

    const canvas = ctx.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = ctx.getTransform();

    return {
      from: {
        x: (matrix.a * start.x + matrix.c * start.y + matrix.e) / dpr,
        y: (matrix.b * start.x + matrix.d * start.y + matrix.f) / dpr
      },
      to: {
        x: (matrix.a * end.x + matrix.c * end.y + matrix.e) / dpr,
        y: (matrix.b * end.x + matrix.d * end.y + matrix.f) / dpr
      }
    };
  }

  function seedFor(from, to) {
    return Math.abs(Math.sin(from.x * 0.021 + from.y * 0.017 + to.x * 0.013 + to.y * 0.027));
  }

  function capture(ctx, manual = false) {
    const target = sourceCanvas || document.querySelector('.memory-graph-canvas');
    if (!target || !ensureLayer(target)) return;
    const points = transformedEndpoints(ctx);
    if (!points) return;
    const length = Math.hypot(points.to.x - points.from.x, points.to.y - points.from.y);
    if (length < 5) return;

    const segment = {
      ...points,
      seed: seedFor(points.from, points.to),
      compact: manual,
      length
    };
    (manual ? manualSegments : baseSegments).push(segment);
  }

  function curveGeometry(segment, lane = 0, timestamp = 0) {
    const { from, to } = segment;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const seed = segment.seed + lane * 0.193;
    const side = hashUnit(seed, 1, 2) > 0.5 ? 1 : -1;
    const spreadBase = segment.compact ? 3.2 : 4.4;
    const spread = lane === 0 ? 0 : side * (spreadBase + lane * (segment.compact ? 1.25 : 2.15));
    const bend = side * clamp(length * (0.065 + hashUnit(seed, 3, 4) * 0.055), segment.compact ? 5 : 10, segment.compact ? 22 : 48);
    const sway = Math.sin(timestamp * 0.00042 + seed * 23.1) * Math.min(segment.compact ? 1.3 : 2.4, length * 0.007);

    return {
      p0: { x: from.x + px * spread * 0.15, y: from.y + py * spread * 0.15 },
      p1: {
        x: from.x + dx * 0.27 + px * (bend * 0.72 + spread + sway),
        y: from.y + dy * 0.27 + py * (bend * 0.72 + spread + sway)
      },
      p2: {
        x: from.x + dx * 0.68 + px * (bend + spread * 0.82 - sway),
        y: from.y + dy * 0.68 + py * (bend + spread * 0.82 - sway)
      },
      p3: { x: to.x + px * spread * 0.12, y: to.y + py * spread * 0.12 },
      length,
      seed
    };
  }

  function pointOnBezier(curve, t) {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const t2 = t * t;
    return {
      x: curve.p0.x * mt2 * mt + 3 * curve.p1.x * mt2 * t + 3 * curve.p2.x * mt * t2 + curve.p3.x * t2 * t,
      y: curve.p0.y * mt2 * mt + 3 * curve.p1.y * mt2 * t + 3 * curve.p2.y * mt * t2 + curve.p3.y * t2 * t
    };
  }

  function tangentOnBezier(curve, t) {
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
    ctx.stroke();
  }

  function drawSheath(ctx, segment, timestamp, interacting) {
    const curve = curveGeometry(segment, 0, timestamp);
    const width = clamp(curve.length * 0.038, segment.compact ? 4.6 : 7.5, segment.compact ? 9 : 15.5);
    const strength = interacting ? 0.56 : 1;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    strokeCurve(ctx, curve, width * 3.4, `rgba(12, 50, 172, ${(0.035 * strength).toFixed(3)})`);
    strokeCurve(ctx, curve, width * 2.25, `rgba(18, 92, 255, ${(0.052 * strength).toFixed(3)})`);
    strokeCurve(ctx, curve, width * 1.28, `rgba(31, 132, 255, ${(0.080 * strength).toFixed(3)})`);
    ctx.restore();
    return curve;
  }

  function drawFibres(ctx, segment, timestamp, interacting) {
    const mobile = sourceCanvas?.clientWidth < 700;
    const count = interacting ? 3 : mobile ? (segment.compact ? 3 : 5) : (segment.compact ? 5 : 9);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let lane = 1; lane <= count; lane += 1) {
      const curve = curveGeometry(segment, lane, timestamp);
      const bright = hashUnit(curve.seed, 7, 9) > 0.52;
      const alpha = (segment.compact ? 0.16 : 0.13) + hashUnit(curve.seed, 8, 10) * (segment.compact ? 0.17 : 0.20);
      strokeCurve(ctx, curve, segment.compact ? 0.72 : 0.72 + lane * 0.055, `rgba(77, 188, 255, ${alpha.toFixed(3)})`);
      if (!interacting && bright && lane <= (mobile ? 3 : 6)) {
        strokeCurve(ctx, curve, 0.26, `rgba(219, 249, 255, ${(0.32 + hashUnit(curve.seed, 11, 12) * 0.28).toFixed(3)})`);
      }
    }
    ctx.restore();
  }

  function branchPath(ctx, origin, tangent, seed, length, side, timestamp, depth = 0) {
    const px = -tangent.y;
    const py = tangent.x;
    const forward = (hashUnit(seed, 13, 14) - 0.30) * length * 0.72;
    const arc = side * length * (0.50 + hashUnit(seed, 15, 16) * 0.32);
    const sway = Math.sin(timestamp * 0.00055 + seed * 27.2) * (depth ? 0.8 : 1.6);
    const mid = {
      x: origin.x + px * arc * 0.50 + tangent.x * forward * 0.38 + px * sway,
      y: origin.y + py * arc * 0.50 + tangent.y * forward * 0.38 + py * sway
    };
    const end = {
      x: origin.x + px * arc + tangent.x * forward,
      y: origin.y + py * arc + tangent.y * forward
    };

    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
    ctx.lineWidth = depth ? 0.34 : 0.48;
    ctx.strokeStyle = depth ? 'rgba(165, 229, 255, 0.24)' : 'rgba(118, 211, 255, 0.35)';
    ctx.stroke();

    return { mid, end };
  }

  function drawBranchForest(ctx, segment, trunk, timestamp, interacting) {
    if (interacting) return;
    const mobile = sourceCanvas?.clientWidth < 700;
    const divisor = segment.compact ? 46 : mobile ? 42 : 30;
    const count = clamp(Math.round(trunk.length / divisor), segment.compact ? 2 : 5, segment.compact ? 6 : mobile ? 9 : 15);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 0; index < count; index += 1) {
      const seed = segment.seed + index * 0.331;
      const t = 0.06 + ((index + 0.35 + hashUnit(seed, 17, 18) * 0.62) / (count + 1)) * 0.88;
      const origin = pointOnBezier(trunk, t);
      const tangent = tangentOnBezier(trunk, t);
      const side = hashUnit(seed, 19, 20) > 0.5 ? 1 : -1;
      const length = (segment.compact ? 10 : 20) + hashUnit(seed, 21, 22) * (segment.compact ? 18 : 52);

      const primary = branchPath(ctx, origin, tangent, seed, length, side, timestamp, 0);

      if (!segment.compact && hashUnit(seed, 23, 24) > (mobile ? 0.64 : 0.38)) {
        const splitTangent = {
          x: tangent.x * 0.68 + (-tangent.y) * side * 0.32,
          y: tangent.y * 0.68 + tangent.x * side * 0.32
        };
        branchPath(ctx, primary.mid, splitTangent, seed + 0.71, length * 0.56, -side, timestamp, 1);
      }

      if (!segment.compact && !mobile && hashUnit(seed, 25, 26) > 0.58) {
        const splitTangent = {
          x: tangent.x * 0.74 - (-tangent.y) * side * 0.26,
          y: tangent.y * 0.74 - tangent.x * side * 0.26
        };
        branchPath(ctx, primary.end, splitTangent, seed + 1.19, length * 0.38, side, timestamp, 1);
      }
    }
    ctx.restore();
  }

  function drawRootFan(ctx, segment, timestamp, interacting) {
    if (interacting || segment.compact) return;
    const mobile = sourceCanvas?.clientWidth < 700;
    const count = mobile ? 3 : 6;
    const baseCurve = curveGeometry(segment, 0, timestamp);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let index = 0; index < count; index += 1) {
      const seed = segment.seed + 2.7 + index * 0.417;
      const t = 0.05 + index * (mobile ? 0.045 : 0.032);
      const origin = pointOnBezier(baseCurve, t);
      const tangent = tangentOnBezier(baseCurve, t);
      const side = index % 2 === 0 ? 1 : -1;
      const length = 18 + hashUnit(seed, 27, 28) * (mobile ? 26 : 50);
      branchPath(ctx, origin, tangent, seed, length, side, timestamp, 0);
    }
    ctx.restore();
  }

  function drawNodeNexus(ctx, point, timestamp, seed, compact = false) {
    const pulse = 0.78 + Math.sin(timestamp * 0.0018 + seed * 19) * 0.18;
    const radius = compact ? 13 : 25;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, `rgba(226, 251, 255, ${(0.18 * pulse).toFixed(3)})`);
    gradient.addColorStop(0.22, `rgba(79, 185, 255, ${(0.12 * pulse).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(24, 87, 255, 0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  function drawSegment(ctx, segment, timestamp, interacting) {
    const trunk = drawSheath(ctx, segment, timestamp, interacting);
    drawFibres(ctx, segment, timestamp, interacting);
    drawBranchForest(ctx, segment, trunk, timestamp, interacting);
    drawRootFan(ctx, segment, timestamp, interacting);
    if (!interacting) drawNodeNexus(ctx, segment.to, timestamp, segment.seed, segment.compact);
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

    for (const segment of baseSegments) drawSegment(layerContext, segment, timestamp, interacting);
    for (const segment of manualSegments) drawSegment(layerContext, segment, timestamp, interacting);

    if (!interacting && baseSegments.length) {
      const centre = baseSegments[0].from;
      drawNodeNexus(layerContext, centre, timestamp, baseSegments[0].seed + 4.2, false);
    }
  }

  function startLoop() {
    if (frame) return;
    frame = requestAnimationFrame(drawFrame);
  }

  proto.beginPath = function neuralDensityBeginPath(...args) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryDensityLineStart = null;
      this.__memoryDensityLineEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralDensityMoveTo(x, y, ...rest) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryDensityLineStart = { x: Number(x), y: Number(y) };
      this.__memoryDensityLineEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralDensityLineTo(x, y, ...rest) {
    if ((isMainGraph(this) || isManualOverlay(this)) && this.__memoryDensityLineStart) {
      this.__memoryDensityLineEnd = { x: Number(x), y: Number(y) };
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralDensityClearRect(...args) {
    if (isMainGraph(this)) baseSegments.length = 0;
    if (isManualOverlay(this)) manualSegments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralDensityStroke(...args) {
    if (isMainGraph(this) && isBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) {
      capture(this, false);
    } else if (isManualOverlay(this) && isBlueLine(this)) {
      const style = String(this.strokeStyle || '');
      if (style.includes('55, 139, 255')) capture(this, true);
    }
    return previousStroke.apply(this, args);
  };

  function installStyles() {
    if (document.getElementById('memoryGraphNeuralDensityStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralDensityStyles';
    style.textContent = `
      .memory-graph-neural-density-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.96;
      }
    `;
    document.head.appendChild(style);
  }

  installStyles();

  globalThis.MemoryGraphNeuralDensity = Object.freeze({
    version: VERSION,
    baseSegmentCount: () => baseSegments.length,
    manualSegmentCount: () => manualSegments.length,
    redraw() {
      lastPaint = 0;
    }
  });
})();