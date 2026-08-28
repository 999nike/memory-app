(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralTissueInstalled) return;

  Object.defineProperty(proto, '__memoryGraphNeuralTissueInstalled', {
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

  const NORMAL_FRAME_MS = 34;
  const INTERACTING_FRAME_MS = 66;
  const mainSegments = [];
  let neuralCanvas = null;
  let neuralContext = null;
  let sourceCanvas = null;
  let animationFrame = 0;
  let lastPaint = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(seed, a = 0, b = 0) {
    const value = Math.sin(seed * 9187.133 + a * 73.731 + b * 193.771) * 43758.5453;
    return value - Math.floor(value);
  }

  function isMainGraph(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isManualOverlay(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  }

  function isBlueGraphLine(ctx) {
    if (!ctx?.__memoryNeuralLineStart || !ctx?.__memoryNeuralLineEnd) return false;
    const style = String(ctx.strokeStyle || '');
    return style.includes('120, 184, 255') || style.includes('55, 139, 255') || style.includes('241, 251, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;

    if (!neuralCanvas || sourceCanvas !== canvas || !neuralCanvas.isConnected) {
      neuralCanvas?.remove();
      neuralCanvas = document.createElement('canvas');
      neuralCanvas.className = 'memory-graph-neural-canvas';
      neuralCanvas.setAttribute('aria-hidden', 'true');
      canvas.parentElement.appendChild(neuralCanvas);
      neuralContext = neuralCanvas.getContext('2d');
      sourceCanvas = canvas;
    }

    if (!neuralContext) return false;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, canvas.width / Math.max(1, width));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (neuralCanvas.width !== pixelWidth || neuralCanvas.height !== pixelHeight) {
      neuralCanvas.width = pixelWidth;
      neuralCanvas.height = pixelHeight;
      neuralContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    neuralCanvas.style.width = `${width}px`;
    neuralCanvas.style.height = `${height}px`;
    startLoop();
    return true;
  }

  function transformedEndpoints(ctx) {
    const start = ctx.__memoryNeuralLineStart;
    const end = ctx.__memoryNeuralLineEnd;
    if (!start || !end) return null;

    const canvas = ctx.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = ctx.getTransform();

    return {
      start: {
        x: (matrix.a * start.x + matrix.c * start.y + matrix.e) / dpr,
        y: (matrix.b * start.x + matrix.d * start.y + matrix.f) / dpr
      },
      end: {
        x: (matrix.a * end.x + matrix.c * end.y + matrix.e) / dpr,
        y: (matrix.b * end.x + matrix.d * end.y + matrix.f) / dpr
      }
    };
  }

  function seedFor(from, to) {
    return Math.abs(Math.sin(
      from.x * 0.013 + from.y * 0.017 + to.x * 0.019 + to.y * 0.023
    ));
  }

  function captureMainSegment(ctx) {
    if (!ensureLayer(ctx.canvas)) return;
    const points = transformedEndpoints(ctx);
    if (!points) return;

    const from = points.start;
    const to = points.end;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length < 3) return;

    mainSegments.push({
      from,
      to,
      seed: seedFor(from, to),
      strength: 1,
      compact: false
    });
  }

  function curveGeometry(segment, strand = 0, timestamp = 0) {
    const from = segment.from;
    const to = segment.to;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const seed = segment.seed + strand * 0.173;
    const side = hashUnit(seed, 1, 2) > 0.5 ? 1 : -1;
    const strandSpread = strand === 0 ? 0 : side * (2.6 + strand * 1.8);
    const bend = side * clamp(length * (0.055 + hashUnit(seed, 3, 4) * 0.035), 8, 34);
    const sway = Math.sin(timestamp * 0.00075 + seed * 18.7) * Math.min(3.2, length * 0.008);

    return {
      p0: { x: from.x + px * strandSpread, y: from.y + py * strandSpread },
      p1: {
        x: from.x + dx * 0.30 + px * (bend * 0.68 + strandSpread + sway),
        y: from.y + dy * 0.30 + py * (bend * 0.68 + strandSpread + sway)
      },
      p2: {
        x: from.x + dx * 0.70 + px * (bend * 0.92 + strandSpread - sway),
        y: from.y + dy * 0.70 + py * (bend * 0.92 + strandSpread - sway)
      },
      p3: { x: to.x + px * strandSpread * 0.22, y: to.y + py * strandSpread * 0.22 },
      px,
      py,
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
    previousStroke.call(ctx);
  }

  function drawTrunk(ctx, segment, timestamp, detail = 1) {
    const curve = curveGeometry(segment, 0, timestamp);
    const strength = Number(segment.strength || 1);
    const mainWidth = clamp(curve.length * 0.024, segment.compact ? 2.8 : 4.2, segment.compact ? 6.5 : 10.5) * strength;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    strokeCurve(ctx, curve, mainWidth * 3.2, `rgba(21, 82, 255, ${(0.055 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, mainWidth * 2.0, `rgba(38, 124, 255, ${(0.10 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, mainWidth, `rgba(61, 168, 255, ${(0.23 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, Math.max(1.35, mainWidth * 0.34), `rgba(108, 219, 255, ${(0.72 * detail).toFixed(3)})`);
    strokeCurve(ctx, curve, Math.max(0.55, mainWidth * 0.11), `rgba(238, 252, 255, ${(0.94 * detail).toFixed(3)})`);
    ctx.restore();

    return curve;
  }

  function drawCompanionStrands(ctx, segment, timestamp, interacting) {
    const count = interacting || segment.compact ? 2 : 5;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let strand = 1; strand <= count; strand += 1) {
      const curve = curveGeometry(segment, strand, timestamp);
      const alpha = segment.compact ? 0.30 : 0.20 + hashUnit(curve.seed, 7, 8) * 0.22;
      strokeCurve(ctx, curve, segment.compact ? 0.65 : 0.75 + strand * 0.08, `rgba(99, 210, 255, ${alpha.toFixed(3)})`);
      if (!interacting && !segment.compact && strand <= 3) {
        strokeCurve(ctx, curve, 0.30, `rgba(239, 253, 255, ${(0.48 + strand * 0.07).toFixed(3)})`);
      }
    }
    ctx.restore();
  }

  function drawDendrites(ctx, segment, trunk, timestamp, interacting) {
    if (interacting) return;
    const branchCount = segment.compact
      ? clamp(Math.round(trunk.length / 75), 1, 3)
      : clamp(Math.round(trunk.length / 28), 5, 13);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let index = 0; index < branchCount; index += 1) {
      const seed = segment.seed + index * 0.317;
      const t = 0.10 + ((index + 0.45 + hashUnit(seed, 11, 12) * 0.55) / (branchCount + 1)) * 0.82;
      const origin = pointOnBezier(trunk, t);
      const tangent = tangentOnBezier(trunk, t);
      const px = -tangent.y;
      const py = tangent.x;
      const side = hashUnit(seed, 13, 14) > 0.5 ? 1 : -1;
      const length = (segment.compact ? 7 : 12) + hashUnit(seed, 15, 16) * (segment.compact ? 9 : 25);
      const forward = (hashUnit(seed, 17, 18) - 0.35) * length * 0.60;
      const sway = Math.sin(timestamp * 0.0011 + seed * 21.3) * 1.6;
      const mid = {
        x: origin.x + px * side * length * 0.52 + tangent.x * forward * 0.42 + px * sway,
        y: origin.y + py * side * length * 0.52 + tangent.y * forward * 0.42 + py * sway
      };
      const end = {
        x: origin.x + px * side * length + tangent.x * forward,
        y: origin.y + py * side * length + tangent.y * forward
      };

      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = segment.compact ? 1.5 : 2.2;
      ctx.strokeStyle = 'rgba(48, 137, 255, 0.10)';
      previousStroke.call(ctx);

      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = segment.compact ? 0.48 : 0.62;
      ctx.strokeStyle = 'rgba(171, 236, 255, 0.58)';
      previousStroke.call(ctx);

      if (!segment.compact && hashUnit(seed, 19, 20) > 0.40) {
        const subSide = hashUnit(seed, 21, 22) > 0.5 ? 1 : -1;
        const subEnd = {
          x: mid.x + px * subSide * length * 0.38 + tangent.x * length * 0.18,
          y: mid.y + py * subSide * length * 0.38 + tangent.y * length * 0.18
        };
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.lineTo(subEnd.x, subEnd.y);
        ctx.lineWidth = 0.42;
        ctx.strokeStyle = 'rgba(204, 244, 255, 0.42)';
        previousStroke.call(ctx);
      }
    }
    ctx.restore();
  }

  function drawPulse(ctx, segment, trunk, timestamp, phase = 0) {
    const duration = segment.compact ? 1500 : 1150 + segment.seed * 850;
    const progress = ((timestamp + phase * duration + segment.seed * 600) % duration) / duration;
    const t = 1 - progress;
    const point = pointOnBezier(trunk, t);
    const alpha = Math.sin(Math.PI * progress);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, segment.compact ? 4 : 7);
    glow.addColorStop(0, `rgba(255, 255, 255, ${(0.95 * alpha).toFixed(3)})`);
    glow.addColorStop(0.24, `rgba(99, 215, 255, ${(0.72 * alpha).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(38, 116, 255, 0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, segment.compact ? 4 : 7, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function drawConnection(ctx, segment, timestamp, interacting = false) {
    const detail = interacting ? 0.72 : 1;
    const trunk = drawTrunk(ctx, segment, timestamp, detail);
    drawCompanionStrands(ctx, segment, timestamp, interacting);
    drawDendrites(ctx, segment, trunk, timestamp, interacting);
    if (!interacting) {
      drawPulse(ctx, segment, trunk, timestamp, 0);
      if (!segment.compact && trunk.length > 170) drawPulse(ctx, segment, trunk, timestamp, 0.52);
    }
  }

  function drawJunctionGlow(ctx, point, timestamp, seed) {
    const pulse = 0.74 + Math.sin(timestamp * 0.0022 + seed * 17) * 0.16;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 18);
    gradient.addColorStop(0, `rgba(235, 253, 255, ${(0.30 * pulse).toFixed(3)})`);
    gradient.addColorStop(0.24, `rgba(87, 188, 255, ${(0.22 * pulse).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(35, 88, 255, 0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  function drawFrame(timestamp) {
    animationFrame = requestAnimationFrame(drawFrame);
    if (!neuralContext || !neuralCanvas || !sourceCanvas?.isConnected || document.hidden) return;

    const interacting = sourceCanvas.dataset.interacting === 'true';
    const frameMs = interacting ? INTERACTING_FRAME_MS : NORMAL_FRAME_MS;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;

    const rect = sourceCanvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
    neuralContext.clearRect(0, 0, rect.width, rect.height);

    for (const segment of mainSegments) drawConnection(neuralContext, segment, timestamp, interacting);

    if (mainSegments.length) {
      const centre = mainSegments[0].from;
      drawJunctionGlow(neuralContext, centre, timestamp, mainSegments[0].seed);
    }
  }

  function startLoop() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(drawFrame);
  }

  function drawManualConnection(ctx, from, to, timestamp, width) {
    const segment = {
      from,
      to,
      seed: seedFor(from, to),
      strength: width >= 3.5 ? 0.82 : 0.62,
      compact: width < 3.5
    };
    drawConnection(ctx, segment, timestamp, false);
  }

  proto.beginPath = function neuralBeginPath(...args) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryNeuralLineStart = null;
      this.__memoryNeuralLineEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralMoveTo(x, y, ...rest) {
    if (isMainGraph(this) || isManualOverlay(this)) {
      this.__memoryNeuralLineStart = { x: Number(x), y: Number(y) };
      this.__memoryNeuralLineEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralLineTo(x, y, ...rest) {
    if ((isMainGraph(this) || isManualOverlay(this)) && this.__memoryNeuralLineStart) {
      this.__memoryNeuralLineEnd = { x: Number(x), y: Number(y) };
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function neuralClearRect(...args) {
    if (isMainGraph(this)) mainSegments.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralStroke(...args) {
    if (isMainGraph(this) && isBlueGraphLine(this) && Number(this.lineWidth || 1) <= 1.6) {
      captureMainSegment(this);
      return undefined;
    }

    if (isManualOverlay(this) && isBlueGraphLine(this)) {
      const style = String(this.strokeStyle || '');
      const width = Math.max(0.5, Number(this.lineWidth) || 1);
      if (style.includes('55, 139, 255')) {
        const points = transformedEndpoints(this);
        if (points) drawManualConnection(this, points.start, points.end, performance.now(), width);
        return undefined;
      }
      if (style.includes('120, 184, 255') || style.includes('241, 251, 255')) return undefined;
    }

    return previousStroke.apply(this, args);
  };

  function installStyles() {
    if (document.getElementById('memoryGraphNeuralTissueStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralTissueStyles';
    style.textContent = `
      .memory-graph-neural-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
      }
    `;
    document.head.appendChild(style);
  }

  installStyles();

  globalThis.MemoryGraphNeuralTissue = Object.freeze({
    version: VERSION,
    segmentCount: () => mainSegments.length,
    redraw() {
      lastPaint = 0;
    }
  });
})();
