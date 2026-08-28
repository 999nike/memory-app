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

  const VERSION = 1;
  const CORE_FRAME_MS = 34;
  const MOBILE_FRAME_MS = 46;
  const INTERACTING_FRAME_MS = 72;

  let surface = null;
  let graphCanvas = null;
  let neuralCanvas = null;
  let neuralContext = null;
  let animationFrame = 0;
  let lastPaint = 0;
  let coreSegments = [];
  let groupSegments = [];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(seed, a = 0, b = 0) {
    const value = Math.sin((Number(seed) || 0) * 9187.133 + a * 73.731 + b * 193.771) * 43758.5453;
    return value - Math.floor(value);
  }

  function isCoreGraph(context) {
    return context?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isManualGravity(context) {
    return context?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  }

  function isCoreConnector(context) {
    if (!isCoreGraph(context) || !context.__neuralPathStart || !context.__neuralPathEnd) return false;
    const style = String(context.strokeStyle || '');
    const width = Math.max(0, Number(context.lineWidth) || 0);
    return width <= 1.6 && style.includes('120, 184, 255');
  }

  function styleAlpha(style, fallback = 1) {
    const match = String(style || '').match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/i);
    if (!match) return fallback;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : fallback;
  }

  function manualTracePass(context) {
    if (!isManualGravity(context) || !context.__neuralPathStart || !context.__neuralPathEnd) return '';
    const style = String(context.strokeStyle || '');
    const alpha = styleAlpha(style);
    if (style.includes('55, 139, 255') && alpha <= 0.14) return 'capture';
    if (style.includes('120, 184, 255') && alpha >= 0.36 && alpha <= 0.44) return 'suppress';
    if (style.includes('241, 251, 255') && alpha >= 0.82) return 'suppress';
    return '';
  }

  function screenPoint(context, point) {
    const canvas = context?.canvas;
    if (!canvas || !point) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    return {
      x: (matrix.a * point.x + matrix.c * point.y + matrix.e) / dpr,
      y: (matrix.b * point.x + matrix.d * point.y + matrix.f) / dpr
    };
  }

  function segmentSeed(from, to, salt = 0) {
    const raw = from.x * 0.013 + from.y * 0.017 + to.x * 0.019 + to.y * 0.023 + salt * 0.071;
    return Math.abs(Math.sin(raw * 13.731));
  }

  function captureSegment(context, target, reverse = false, widthScale = 1) {
    const start = screenPoint(context, context.__neuralPathStart);
    const end = screenPoint(context, context.__neuralPathEnd);
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

  function installStyles() {
    if (document.getElementById('memoryGraphNeuralLinksStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralLinksStyles';
    style.textContent = `
      .memory-graph-spark-canvas { display:none !important; }
      .memory-graph-neural-canvas {
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

    if (!neuralCanvas || !neuralCanvas.isConnected) {
      neuralCanvas = document.createElement('canvas');
      neuralCanvas.className = 'memory-graph-neural-canvas';
      neuralCanvas.setAttribute('aria-hidden', 'true');
      const manualOverlay = surface.querySelector('.memory-graph-manual-gravity-canvas');
      if (manualOverlay) surface.insertBefore(neuralCanvas, manualOverlay);
      else surface.appendChild(neuralCanvas);
      neuralContext = neuralCanvas.getContext('2d');
    }

    if (!neuralContext) return false;
    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
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

  function curveSpec(from, to, seed, timestamp, strandOffset = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const midX = (from.x + to.x) * 0.5;
    const midY = (from.y + to.y) * 0.5;
    const baseBend = (hashUnit(seed, 2, 7) * 2 - 1) * clamp(length * 0.095, 5, 34);
    const breathing = Math.sin(timestamp * 0.00048 + seed * 27.1) * clamp(length * 0.012, 1.2, 4.8);
    const controlOffset = baseBend + breathing + strandOffset;
    return {
      from,
      to,
      length,
      px,
      py,
      control: {
        x: midX + px * controlOffset,
        y: midY + py * controlOffset
      }
    };
  }

  function quadraticPoint(spec, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * spec.from.x + 2 * mt * t * spec.control.x + t * t * spec.to.x,
      y: mt * mt * spec.from.y + 2 * mt * t * spec.control.y + t * t * spec.to.y
    };
  }

  function buildFiberPoints(from, to, seed, timestamp, strandOffset = 0, interacting = false) {
    const spec = curveSpec(from, to, seed, timestamp, strandOffset);
    const count = clamp(Math.round(spec.length / (interacting ? 38 : 28)), 6, interacting ? 10 : 15);
    const points = [];
    const phase = seed * 31.7 + strandOffset * 0.27;
    const frequencyA = 1.7 + hashUnit(seed, 5, 4) * 1.8;
    const frequencyB = 4.2 + hashUnit(seed, 9, 2) * 2.6;
    const amplitude = clamp(spec.length * 0.0065, 0.7, interacting ? 2.2 : 3.6);

    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const point = quadraticPoint(spec, t);
      const envelope = Math.sin(Math.PI * t);
      const slowDrift = Math.sin(timestamp * 0.00034 + phase + t * 2.7) * 0.34;
      const organic = Math.sin(t * Math.PI * frequencyA + phase)
        + Math.sin(t * Math.PI * frequencyB + phase * 0.71) * 0.42
        + slowDrift;
      const offset = organic * amplitude * envelope;
      points.push({
        x: point.x + spec.px * offset,
        y: point.y + spec.py * offset
      });
    }

    return { spec, points };
  }

  function traceSmooth(ctx, points) {
    if (!points?.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
      return;
    }
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    const penultimate = points[points.length - 2];
    const last = points[points.length - 1];
    ctx.quadraticCurveTo(penultimate.x, penultimate.y, last.x, last.y);
  }

  function strokeFiber(ctx, points, width, colour, glow = 0, glowColour = colour, composite = 'source-over') {
    ctx.save();
    ctx.globalCompositeOperation = composite;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = colour;
    if (glow > 0) {
      ctx.shadowBlur = glow;
      ctx.shadowColor = glowColour;
    }
    traceSmooth(ctx, points);
    ctx.stroke();
    ctx.restore();
  }

  function drawMicroBranch(ctx, fiber, seed, timestamp, t, direction, widthScale, interacting) {
    if (interacting) return;
    const index = clamp(Math.round(t * (fiber.points.length - 1)), 1, fiber.points.length - 2);
    const origin = fiber.points[index];
    const before = fiber.points[index - 1];
    const after = fiber.points[index + 1];
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const reach = (7 + hashUnit(seed, index, 8) * 10) * widthScale;
    const tangent = (hashUnit(seed, index, 9) - 0.5) * 6;
    const end = {
      x: origin.x + px * reach * direction + (dx / length) * tangent,
      y: origin.y + py * reach * direction + (dy / length) * tangent
    };
    const control = {
      x: origin.x + (end.x - origin.x) * 0.56 + px * direction * 2.2,
      y: origin.y + (end.y - origin.y) * 0.56 + py * direction * 2.2
    };

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.32, 0.46 * widthScale);
    ctx.strokeStyle = 'rgba(121, 213, 255, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(80, 180, 255, 0.32)';
    ctx.stroke();
    ctx.restore();
  }

  function drawPulse(ctx, spec, seed, timestamp, widthScale, intensity, interacting) {
    if (interacting) return 0;
    const duration = 1500 + hashUnit(seed, 7, 3) * 1600;
    const progress = ((timestamp + seed * duration * 0.91) % duration) / duration;
    const point = quadraticPoint(spec, progress);
    const pulseRadius = clamp(5.2 * widthScale, 3.4, 7.2);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, pulseRadius);
    glow.addColorStop(0, `rgba(255,255,255,${(0.92 * intensity).toFixed(3)})`);
    glow.addColorStop(0.16, `rgba(166,229,255,${(0.72 * intensity).toFixed(3)})`);
    glow.addColorStop(0.52, `rgba(55,162,255,${(0.23 * intensity).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(38,128,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, pulseRadius, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(0.7, widthScale * 0.9), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(247,253,255,${(0.92 * intensity).toFixed(3)})`;
    ctx.fill();
    ctx.restore();

    return progress > 0.90 ? (progress - 0.90) / 0.10 : 0;
  }

  function drawConnection(ctx, from, to, seed, timestamp, options = {}) {
    if (!ctx || !from || !to) return 0;
    const widthScale = clamp(Number(options.widthScale) || 1, 0.45, 1.6);
    const intensity = clamp(Number(options.intensity) || 1, 0.35, 1.5);
    const interacting = Boolean(options.interacting);
    const mobile = options.mobile ?? window.matchMedia?.('(max-width: 800px)')?.matches;
    const main = buildFiberPoints(from, to, seed, timestamp, 0, interacting);
    const length = main.spec.length;
    if (length < 8) return 0;

    strokeFiber(
      ctx,
      main.points,
      Math.max(4.6, 8.2 * widthScale),
      `rgba(43,132,255,${(0.048 * intensity).toFixed(3)})`,
      interacting ? 7 : 15,
      `rgba(45,151,255,${(0.34 * intensity).toFixed(3)})`,
      'lighter'
    );
    strokeFiber(
      ctx,
      main.points,
      Math.max(1.7, 2.7 * widthScale),
      `rgba(73,174,255,${(0.16 * intensity).toFixed(3)})`,
      interacting ? 3 : 7,
      `rgba(75,186,255,${(0.38 * intensity).toFixed(3)})`,
      'lighter'
    );

    const companionCount = interacting ? 0 : mobile ? 1 : 2;
    for (let index = 0; index < companionCount; index += 1) {
      const direction = index % 2 === 0 ? 1 : -1;
      const spread = (3.2 + hashUnit(seed, index, 21) * 4.8) * direction;
      const companion = buildFiberPoints(from, to, seed + (index + 1) * 0.173, timestamp, spread, false);
      strokeFiber(
        ctx,
        companion.points,
        Math.max(0.34, 0.54 * widthScale),
        `rgba(117,213,255,${(0.29 * intensity).toFixed(3)})`,
        3.5,
        `rgba(73,177,255,${(0.25 * intensity).toFixed(3)})`,
        'lighter'
      );
    }

    strokeFiber(
      ctx,
      main.points,
      Math.max(0.62, 0.92 * widthScale),
      `rgba(137,218,255,${(0.56 * intensity).toFixed(3)})`,
      interacting ? 1.5 : 3.5,
      `rgba(109,205,255,${(0.36 * intensity).toFixed(3)})`,
      'lighter'
    );
    strokeFiber(
      ctx,
      main.points,
      Math.max(0.28, 0.42 * widthScale),
      `rgba(239,251,255,${(0.86 * intensity).toFixed(3)})`,
      0,
      'rgba(255,255,255,0)',
      'source-over'
    );

    if (!mobile && length > 85) {
      drawMicroBranch(ctx, main, seed + 0.11, timestamp, 0.22, 1, widthScale, interacting);
      if (length > 145) drawMicroBranch(ctx, main, seed + 0.37, timestamp, 0.73, -1, widthScale, interacting);
    }

    return options.pulses === false
      ? 0
      : drawPulse(ctx, main.spec, seed, timestamp, widthScale, intensity, interacting);
  }

  function drawArrivalSpark(ctx, point, energy) {
    if (!ctx || !point || energy <= 0) return;
    const alpha = clamp(energy, 0, 1);
    const radius = 6 + alpha * 9;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const glow = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    glow.addColorStop(0, `rgba(255,255,255,${(0.34 * alpha).toFixed(3)})`);
    glow.addColorStop(0.28, `rgba(119,210,255,${(0.22 * alpha).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(58,139,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
  }

  function renderSegment(ctx, segment, timestamp, interacting, mobile, intensity = 1) {
    return drawConnection(ctx, segment.from, segment.to, segment.seed, timestamp, {
      widthScale: segment.widthScale,
      intensity,
      interacting,
      mobile,
      pulses: true
    });
  }

  function drawFrame(timestamp) {
    animationFrame = requestAnimationFrame(drawFrame);
    if (!ensureOverlay() || !neuralContext || !neuralCanvas || document.hidden) return;

    const rect = surface.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;

    const interacting = graphCanvas?.dataset.interacting === 'true';
    const mobile = window.matchMedia?.('(max-width: 800px)')?.matches === true;
    const frameMs = interacting ? INTERACTING_FRAME_MS : mobile ? MOBILE_FRAME_MS : CORE_FRAME_MS;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;

    neuralContext.clearRect(0, 0, rect.width, rect.height);
    if (!coreSegments.length && !groupSegments.length) return;

    let arrivalEnergy = 0;
    let arrivalPoint = null;
    for (const segment of coreSegments) {
      const energy = renderSegment(neuralContext, segment, timestamp, interacting, mobile, 1);
      if (energy > arrivalEnergy) {
        arrivalEnergy = energy;
        arrivalPoint = segment.to;
      }
    }
    for (const segment of groupSegments) {
      renderSegment(neuralContext, segment, timestamp, interacting, mobile, 0.86);
    }
    if (arrivalPoint) drawArrivalSpark(neuralContext, arrivalPoint, arrivalEnergy);
  }

  function startLoop() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(drawFrame);
  }

  proto.beginPath = function memoryGraphNeuralBeginPath(...args) {
    this.__neuralPathStart = null;
    this.__neuralPathEnd = null;
    this.__neuralPathPointCount = 0;
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function memoryGraphNeuralMoveTo(x, y, ...rest) {
    this.__neuralPathStart = { x: Number(x), y: Number(y) };
    this.__neuralPathEnd = null;
    this.__neuralPathPointCount = 1;
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function memoryGraphNeuralLineTo(x, y, ...rest) {
    if (this.__neuralPathStart) {
      this.__neuralPathEnd = { x: Number(x), y: Number(y) };
      this.__neuralPathPointCount = Number(this.__neuralPathPointCount || 1) + 1;
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function memoryGraphNeuralClearRect(...args) {
    if (isCoreGraph(this)) coreSegments = [];
    else if (isManualGravity(this)) groupSegments = [];
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function memoryGraphNeuralStroke(...args) {
    if (isCoreConnector(this)) {
      captureSegment(this, coreSegments, true, 1);
      return undefined;
    }

    const manualPass = manualTracePass(this);
    if (manualPass) {
      if (manualPass === 'capture') {
        const sourceWidth = Math.max(0.5, Number(this.lineWidth) || 1);
        captureSegment(this, groupSegments, false, clamp(sourceWidth / 4, 0.62, 1.15));
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
      return {
        version: VERSION,
        coreConnections: coreSegments.length,
        groupConnections: groupSegments.length
      };
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }
})();
