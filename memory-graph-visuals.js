(() => {
  'use strict';

  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphVisualsInstalled) return;

  Object.defineProperty(proto, '__memoryGraphVisualsInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const originalBeginPath = proto.beginPath;
  const originalArc = proto.arc;
  const originalFill = proto.fill;
  const originalStroke = proto.stroke;
  const originalClearRect = proto.clearRect;
  const originalMoveTo = proto.moveTo;
  const originalLineTo = proto.lineTo;

  const NORMAL_FRAME_MS = 40;
  const INTERACTING_FRAME_MS = 78;
  const SPRITE_QUALITY = 2;
  const spriteCache = new Map();

  let electricCanvas = null;
  let electricContext = null;
  let electricSourceCanvas = null;
  let electricSegments = [];
  let electricFrame = 0;
  let lastElectricPaint = 0;

  function isMemoryGraph(context) {
    const canvas = context?.canvas;
    if (!canvas) return false;
    if (typeof canvas.__memoryGraphCanvas === 'boolean') return canvas.__memoryGraphCanvas;

    const value = canvas.classList?.contains('memory-graph-canvas') === true;
    try {
      Object.defineProperty(canvas, '__memoryGraphCanvas', {
        value,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch {}
    return value;
  }

  function graphColour(style) {
    const value = String(style || '');
    if (value.includes('199, 255, 86')) return 'green';
    if (value.includes('120, 184, 255')) return 'blue';
    return null;
  }

  function styleAlpha(style, fallback = 0.3) {
    const match = String(style || '').match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/i);
    if (!match) return fallback;
    const value = Number(match[1]);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(seed, a = 0, b = 0) {
    const value = Math.sin(seed * 9187.133 + a * 73.731 + b * 193.771) * 43758.5453;
    return value - Math.floor(value);
  }

  function spriteKey(colour, radius, alpha) {
    const radiusBucket = Math.round(radius * 2) / 2;
    const alphaBucket = Math.round(clamp(alpha, 0, 1) * 4) / 4;
    return `${colour}:${radiusBucket}:${alphaBucket}`;
  }

  function createSpriteCanvas(logicalSize) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(logicalSize * SPRITE_QUALITY);
    canvas.height = Math.ceil(logicalSize * SPRITE_QUALITY);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(SPRITE_QUALITY, 0, 0, SPRITE_QUALITY, 0, 0);
    return { canvas, ctx };
  }

  function drawGlowDisc(ctx, x, y, innerRadius, outerRadius, stops) {
    const gradient = ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
    for (const [stop, colour] of stops) gradient.addColorStop(stop, colour);
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  function buildGreenSprite(radius, sourceAlpha) {
    const padding = Math.ceil(radius * 0.95 + 8);
    const logicalSize = Math.ceil(radius * 2 + padding * 2);
    const { canvas, ctx } = createSpriteCanvas(logicalSize);
    const c = logicalSize / 2;
    const strength = clamp(0.62 + sourceAlpha * 0.80, 0.66, 1);

    drawGlowDisc(ctx, c, c, radius * 0.55, radius * 1.70, [
      [0, `rgba(199, 255, 86, ${(0.16 * strength).toFixed(3)})`],
      [0.45, `rgba(121, 255, 53, ${(0.13 * strength).toFixed(3)})`],
      [0.78, `rgba(80, 238, 34, ${(0.075 * strength).toFixed(3)})`],
      [1, 'rgba(58, 222, 30, 0)']
    ]);

    const sphere = ctx.createRadialGradient(
      c - radius * 0.32,
      c - radius * 0.38,
      Math.max(1, radius * 0.08),
      c,
      c,
      radius * 1.04
    );
    sphere.addColorStop(0, `rgba(148, 214, 83, ${(0.30 + sourceAlpha * 0.22).toFixed(3)})`);
    sphere.addColorStop(0.22, 'rgba(57, 98, 31, 0.80)');
    sphere.addColorStop(0.58, 'rgba(18, 38, 15, 0.96)');
    sphere.addColorStop(1, 'rgba(3, 12, 6, 0.99)');

    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.fillStyle = sphere;
    ctx.fill();

    ctx.save();
    ctx.shadowBlur = radius * 0.62;
    ctx.shadowColor = `rgba(142, 255, 62, ${(0.48 * strength).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.98, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, radius * 0.12);
    ctx.strokeStyle = `rgba(126, 255, 57, ${(0.78 * strength).toFixed(3)})`;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(c, c, radius * 0.92, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(0.9, radius * 0.065);
    ctx.strokeStyle = `rgba(239, 255, 219, ${(0.76 + sourceAlpha * 0.16).toFixed(3)})`;
    ctx.stroke();

    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.88, Math.PI * 1.06, Math.PI * 1.62);
    ctx.lineWidth = Math.max(1.1, radius * 0.09);
    ctx.strokeStyle = `rgba(255, 255, 244, ${(0.46 + sourceAlpha * 0.28).toFixed(3)})`;
    ctx.stroke();
    ctx.restore();

    const lowerShade = ctx.createRadialGradient(c, c + radius * 0.56, 0, c, c + radius * 0.35, radius * 1.05);
    lowerShade.addColorStop(0, 'rgba(0, 0, 0, 0.20)');
    lowerShade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.90, 0, Math.PI * 2);
    ctx.fillStyle = lowerShade;
    ctx.fill();

    return { canvas, logicalSize };
  }

  function drawCoreVeins(ctx, c, radius) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.79, 0, Math.PI * 2);
    ctx.clip();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const seed = radius * 0.137 + 2.71;
    for (let branch = 0; branch < 20; branch += 1) {
      const angle = (branch / 20) * Math.PI * 2 + (hashUnit(seed, branch, 1) - 0.5) * 0.28;
      const length = radius * (0.42 + hashUnit(seed, branch, 2) * 0.28);
      const bend = (hashUnit(seed, branch, 3) - 0.5) * radius * 0.20;
      const perpX = -Math.sin(angle);
      const perpY = Math.cos(angle);

      const points = [{ x: c, y: c }];
      for (let step = 1; step <= 4; step += 1) {
        const t = step / 4;
        const jitter = step === 4 ? 0 : (hashUnit(seed, branch, step + 7) - 0.5) * radius * 0.12;
        points.push({
          x: c + Math.cos(angle) * length * t + perpX * (bend * Math.sin(Math.PI * t) + jitter),
          y: c + Math.sin(angle) * length * t + perpY * (bend * Math.sin(Math.PI * t) + jitter)
        });
      }

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
      ctx.lineWidth = Math.max(1.2, radius * 0.055);
      ctx.strokeStyle = 'rgba(39, 92, 255, 0.24)';
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
      ctx.lineWidth = Math.max(0.45, radius * 0.018);
      ctx.strokeStyle = 'rgba(187, 224, 255, 0.72)';
      ctx.stroke();
    }
    ctx.restore();
  }

  function buildBlueSprite(radius, sourceAlpha) {
    const padding = Math.ceil(radius * 0.92 + 10);
    const logicalSize = Math.ceil(radius * 2 + padding * 2);
    const { canvas, ctx } = createSpriteCanvas(logicalSize);
    const c = logicalSize / 2;
    const strength = clamp(0.74 + sourceAlpha * 0.55, 0.78, 1);

    drawGlowDisc(ctx, c, c, radius * 0.42, radius * 1.62, [
      [0, `rgba(78, 151, 255, ${(0.20 * strength).toFixed(3)})`],
      [0.45, `rgba(45, 111, 255, ${(0.14 * strength).toFixed(3)})`],
      [0.78, `rgba(0, 92, 255, ${(0.075 * strength).toFixed(3)})`],
      [1, 'rgba(0, 80, 255, 0)']
    ]);

    const sphere = ctx.createRadialGradient(
      c - radius * 0.24,
      c - radius * 0.30,
      Math.max(1, radius * 0.06),
      c,
      c,
      radius * 1.06
    );
    sphere.addColorStop(0, 'rgba(91, 181, 255, 0.94)');
    sphere.addColorStop(0.24, 'rgba(26, 112, 219, 0.96)');
    sphere.addColorStop(0.60, 'rgba(15, 59, 146, 0.98)');
    sphere.addColorStop(1, 'rgba(4, 18, 55, 1)');

    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.fillStyle = sphere;
    ctx.fill();

    drawCoreVeins(ctx, c, radius);

    const coreGlow = ctx.createRadialGradient(c, c, 0, c, c, radius * 0.50);
    coreGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    coreGlow.addColorStop(0.07, 'rgba(207, 239, 255, 0.98)');
    coreGlow.addColorStop(0.22, 'rgba(85, 160, 255, 0.62)');
    coreGlow.addColorStop(1, 'rgba(26, 87, 255, 0)');
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.50, 0, Math.PI * 2);
    ctx.fillStyle = coreGlow;
    ctx.fill();

    ctx.save();
    ctx.shadowBlur = radius * 0.70;
    ctx.shadowColor = `rgba(54, 144, 255, ${(0.62 * strength).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.99, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, radius * 0.11);
    ctx.strokeStyle = `rgba(57, 153, 255, ${(0.82 * strength).toFixed(3)})`;
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(c, c, radius * 0.92, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, radius * 0.045);
    ctx.strokeStyle = 'rgba(221, 246, 255, 0.90)';
    ctx.stroke();

    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, radius * 0.87, Math.PI * 1.05, Math.PI * 1.59);
    ctx.lineWidth = Math.max(1.2, radius * 0.055);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)';
    ctx.stroke();
    ctx.restore();

    return { canvas, logicalSize };
  }

  function getNodeSprite(colour, radius, sourceAlpha) {
    const key = spriteKey(colour, radius, sourceAlpha);
    let sprite = spriteCache.get(key);
    if (sprite) return sprite;

    sprite = colour === 'blue'
      ? buildBlueSprite(radius, sourceAlpha)
      : buildGreenSprite(radius, sourceAlpha);
    spriteCache.set(key, sprite);
    return sprite;
  }

  function paintNodeSprite(context, colour, circle, sourceAlpha) {
    const sprite = getNodeSprite(colour, circle.radius, sourceAlpha);
    const half = sprite.logicalSize / 2;
    context.drawImage(
      sprite.canvas,
      circle.x - half,
      circle.y - half,
      sprite.logicalSize,
      sprite.logicalSize
    );
  }

  function ensureElectricLayer(sourceCanvas) {
    if (!sourceCanvas?.parentElement) return false;

    if (!electricCanvas || electricSourceCanvas !== sourceCanvas || !electricCanvas.isConnected) {
      electricCanvas?.remove();
      electricCanvas = document.createElement('canvas');
      electricCanvas.className = 'memory-graph-spark-canvas';
      electricCanvas.setAttribute('aria-hidden', 'true');
      sourceCanvas.parentElement.appendChild(electricCanvas);
      electricContext = electricCanvas.getContext('2d');
      electricSourceCanvas = sourceCanvas;
    }

    if (!electricContext) return false;

    const rect = sourceCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, sourceCanvas.width / Math.max(1, width));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (electricCanvas.width !== pixelWidth || electricCanvas.height !== pixelHeight) {
      electricCanvas.width = pixelWidth;
      electricCanvas.height = pixelHeight;
      electricContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    electricCanvas.style.width = `${width}px`;
    electricCanvas.style.height = `${height}px`;
    startElectricLoop();
    return true;
  }

  function captureElectricSegment(context) {
    const start = context.__memoryGraphLineStart;
    const end = context.__memoryGraphLineEnd;
    const sourceCanvas = context.canvas;
    if (!start || !end || !ensureElectricLayer(sourceCanvas)) return;

    const rect = sourceCanvas.getBoundingClientRect();
    const dpr = Math.max(1, sourceCanvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    const startX = (matrix.a * start.x + matrix.c * start.y + matrix.e) / dpr;
    const startY = (matrix.b * start.x + matrix.d * start.y + matrix.f) / dpr;
    const endX = (matrix.a * end.x + matrix.c * end.y + matrix.e) / dpr;
    const endY = (matrix.b * end.x + matrix.d * end.y + matrix.f) / dpr;

    electricSegments.push({
      centreX: startX,
      centreY: startY,
      outerX: endX,
      outerY: endY,
      seed: Math.abs(Math.sin(startX * 0.013 + startY * 0.017 + endX * 0.019 + endY * 0.023))
    });
  }

  function startElectricLoop() {
    if (electricFrame) return;
    electricFrame = requestAnimationFrame(drawElectricFrame);
  }

  function buildLightningPoints(segment, timestamp, interacting) {
    const dx = segment.centreX - segment.outerX;
    const dy = segment.centreY - segment.outerY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const uy = dy / length;
    const ux = dx / length;
    const px = -uy;
    const py = ux;
    const pointCount = clamp(Math.round(length / 23), 7, 16);
    const reshapeMs = interacting ? 180 : 88 + segment.seed * 54;
    const bucket = Math.floor((timestamp + segment.seed * 700) / reshapeMs);
    const amplitude = clamp(length * 0.036, 3.4, 9.5);
    const points = [];

    for (let index = 0; index <= pointCount; index += 1) {
      const t = index / pointCount;
      const envelope = Math.sin(Math.PI * t);
      const randomOffset = (hashUnit(segment.seed, bucket, index) * 2 - 1) * amplitude;
      const fineOffset = (hashUnit(segment.seed + 0.37, bucket + 11, index * 3) * 2 - 1) * amplitude * 0.32;
      const offset = (randomOffset + fineOffset) * envelope;
      points.push({
        x: segment.outerX + dx * t + px * offset,
        y: segment.outerY + dy * t + py * offset
      });
    }

    return { points, px, py, bucket };
  }

  function tracePoints(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  }

  function strokeLightning(points, interacting) {
    electricContext.save();
    electricContext.lineCap = 'round';
    electricContext.lineJoin = 'round';

    tracePoints(electricContext, points);
    electricContext.lineWidth = interacting ? 3.5 : 4.8;
    electricContext.strokeStyle = interacting ? 'rgba(55, 139, 255, 0.08)' : 'rgba(55, 139, 255, 0.13)';
    electricContext.stroke();

    tracePoints(electricContext, points);
    electricContext.lineWidth = interacting ? 1.8 : 2.4;
    electricContext.strokeStyle = interacting ? 'rgba(120, 184, 255, 0.30)' : 'rgba(120, 184, 255, 0.44)';
    electricContext.stroke();

    tracePoints(electricContext, points);
    electricContext.lineWidth = interacting ? 0.75 : 1.0;
    electricContext.strokeStyle = interacting ? 'rgba(225, 245, 255, 0.70)' : 'rgba(242, 252, 255, 0.94)';
    electricContext.stroke();
    electricContext.restore();
  }

  function drawLightningBranch(points, segment, bucket, px, py, interacting) {
    if (interacting || points.length < 7) return;
    if (hashUnit(segment.seed + 0.71, bucket, 29) < 0.64) return;

    const index = 2 + Math.floor(hashUnit(segment.seed + 0.22, bucket, 31) * Math.max(1, points.length - 5));
    const origin = points[index];
    const direction = hashUnit(segment.seed + 0.91, bucket, 37) > 0.5 ? 1 : -1;
    const branchLength = 6 + hashUnit(segment.seed, bucket, 41) * 9;
    const backX = points[Math.max(0, index - 1)].x - origin.x;
    const backY = points[Math.max(0, index - 1)].y - origin.y;
    const endX = origin.x + px * branchLength * direction + backX * 0.35;
    const endY = origin.y + py * branchLength * direction + backY * 0.35;
    const midX = origin.x + (endX - origin.x) * 0.52 + px * direction * 2;
    const midY = origin.y + (endY - origin.y) * 0.52 + py * direction * 2;

    electricContext.save();
    electricContext.lineCap = 'round';
    electricContext.beginPath();
    electricContext.moveTo(origin.x, origin.y);
    electricContext.lineTo(midX, midY);
    electricContext.lineTo(endX, endY);
    electricContext.lineWidth = 2.8;
    electricContext.strokeStyle = 'rgba(78, 156, 255, 0.10)';
    electricContext.stroke();

    electricContext.beginPath();
    electricContext.moveTo(origin.x, origin.y);
    electricContext.lineTo(midX, midY);
    electricContext.lineTo(endX, endY);
    electricContext.lineWidth = 0.75;
    electricContext.strokeStyle = 'rgba(230, 248, 255, 0.74)';
    electricContext.stroke();
    electricContext.restore();
  }

  function drawInwardPulse(points, segment, timestamp, interacting) {
    if (interacting || points.length < 2) return 0;

    const duration = 980 + segment.seed * 760;
    const progress = ((timestamp + segment.seed * duration * 0.83) % duration) / duration;
    const position = progress * (points.length - 1);
    const index = clamp(Math.floor(position), 0, points.length - 2);
    const local = position - index;
    const a = points[index];
    const b = points[index + 1];
    const x = a.x + (b.x - a.x) * local;
    const y = a.y + (b.y - a.y) * local;

    electricContext.save();
    electricContext.beginPath();
    electricContext.arc(x, y, 4.2, 0, Math.PI * 2);
    electricContext.fillStyle = 'rgba(89, 177, 255, 0.10)';
    electricContext.fill();

    electricContext.beginPath();
    electricContext.arc(x, y, 1.45, 0, Math.PI * 2);
    electricContext.fillStyle = 'rgba(250, 254, 255, 0.98)';
    electricContext.fill();
    electricContext.restore();

    return progress > 0.86 ? (progress - 0.86) / 0.14 : 0;
  }

  function drawLightningArc(segment, timestamp, interacting) {
    const { points, px, py, bucket } = buildLightningPoints(segment, timestamp, interacting);
    strokeLightning(points, interacting);
    drawLightningBranch(points, segment, bucket, px, py, interacting);
    return drawInwardPulse(points, segment, timestamp, interacting);
  }

  function drawCentrePulse(x, y, energy) {
    if (!energy || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const alpha = 0.05 + energy * 0.17;
    const radius = 43 + energy * 6;
    electricContext.save();
    electricContext.beginPath();
    electricContext.arc(x, y, radius, 0, Math.PI * 2);
    electricContext.lineWidth = 1 + energy;
    electricContext.strokeStyle = `rgba(120, 184, 255, ${alpha.toFixed(3)})`;
    electricContext.stroke();
    electricContext.restore();
  }

  function drawElectricFrame(timestamp) {
    electricFrame = requestAnimationFrame(drawElectricFrame);
    if (!electricContext || !electricCanvas || !electricSourceCanvas?.isConnected) return;

    const interacting = electricSourceCanvas.dataset.interacting === 'true';
    const frameMs = interacting ? INTERACTING_FRAME_MS : NORMAL_FRAME_MS;
    if (timestamp - lastElectricPaint < frameMs) return;
    lastElectricPaint = timestamp;

    const rect = electricSourceCanvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    electricContext.clearRect(0, 0, width, height);

    if (!electricSegments.length || document.hidden) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;

    let centreEnergy = 0;
    let centreX = 0;
    let centreY = 0;
    for (const segment of electricSegments) {
      centreEnergy += drawLightningArc(segment, timestamp, interacting);
      centreX += segment.centreX;
      centreY += segment.centreY;
    }

    if (electricSegments.length) {
      drawCentrePulse(
        centreX / electricSegments.length,
        centreY / electricSegments.length,
        clamp(centreEnergy / Math.max(1, electricSegments.length * 0.13), 0, 1)
      );
    }
  }

  proto.clearRect = function memoryGraphClearRect(...args) {
    if (isMemoryGraph(this)) electricSegments = [];
    return originalClearRect.apply(this, args);
  };

  proto.beginPath = function memoryGraphBeginPath(...args) {
    if (isMemoryGraph(this)) {
      this.__memoryGraphCircle = null;
      this.__memoryGraphLineStart = null;
      this.__memoryGraphLineEnd = null;
    }
    return originalBeginPath.apply(this, args);
  };

  proto.moveTo = function memoryGraphMoveTo(x, y, ...rest) {
    if (isMemoryGraph(this)) {
      this.__memoryGraphLineStart = { x: Number(x), y: Number(y) };
      this.__memoryGraphLineEnd = null;
    }
    return originalMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function memoryGraphLineTo(x, y, ...rest) {
    if (isMemoryGraph(this) && this.__memoryGraphLineStart) {
      this.__memoryGraphLineEnd = { x: Number(x), y: Number(y) };
    }
    return originalLineTo.call(this, x, y, ...rest);
  };

  proto.arc = function memoryGraphArc(x, y, radius, startAngle, endAngle, ...rest) {
    if (isMemoryGraph(this) && Math.abs(Number(endAngle) - Number(startAngle)) >= Math.PI * 1.9) {
      this.__memoryGraphCircle = {
        x: Number(x),
        y: Number(y),
        radius: Math.max(1, Number(radius) || 1)
      };
    }
    return originalArc.call(this, x, y, radius, startAngle, endAngle, ...rest);
  };

  proto.fill = function memoryGraphFill(...args) {
    if (!isMemoryGraph(this) || !this.__memoryGraphCircle) return originalFill.apply(this, args);

    const colour = graphColour(this.fillStyle);
    if (!colour) return originalFill.apply(this, args);

    const sourceAlpha = styleAlpha(this.fillStyle, colour === 'blue' ? 0.24 : 0.18);
    paintNodeSprite(this, colour, this.__memoryGraphCircle, sourceAlpha);
    return undefined;
  };

  proto.stroke = function memoryGraphStroke(...args) {
    if (!isMemoryGraph(this)) return originalStroke.apply(this, args);

    const colour = graphColour(this.strokeStyle);
    if (!colour) return originalStroke.apply(this, args);

    const sourceWidth = Math.max(0.5, Number(this.lineWidth) || 1);

    if (colour === 'blue' && sourceWidth <= 1.6 && this.__memoryGraphLineStart && this.__memoryGraphLineEnd) {
      captureElectricSegment(this);
      return undefined;
    }

    if (sourceWidth > 1.6) return originalStroke.apply(this, args);

    this.save();
    this.lineWidth = Math.max(1.8, sourceWidth * 2.05);
    this.strokeStyle = colour === 'green'
      ? 'rgba(199, 255, 86, 0.22)'
      : String(this.strokeStyle);
    originalStroke.apply(this, args);
    this.restore();

    return originalStroke.apply(this, args);
  };
})();
