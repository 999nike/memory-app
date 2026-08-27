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

  let sparkCanvas = null;
  let sparkContext = null;
  let sparkSourceCanvas = null;
  let sparkSegments = [];
  let sparkFrame = 0;
  let lastSparkPaint = 0;

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

  function ensureSparkLayer(sourceCanvas) {
    if (!sourceCanvas?.parentElement) return false;

    if (!sparkCanvas || sparkSourceCanvas !== sourceCanvas || !sparkCanvas.isConnected) {
      sparkCanvas?.remove();
      sparkCanvas = document.createElement('canvas');
      sparkCanvas.className = 'memory-graph-spark-canvas';
      sparkCanvas.setAttribute('aria-hidden', 'true');
      sourceCanvas.parentElement.appendChild(sparkCanvas);
      sparkContext = sparkCanvas.getContext('2d');
      sparkSourceCanvas = sourceCanvas;
    }

    if (!sparkContext) return false;

    const rect = sourceCanvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, sourceCanvas.width / Math.max(1, width));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (sparkCanvas.width !== pixelWidth || sparkCanvas.height !== pixelHeight) {
      sparkCanvas.width = pixelWidth;
      sparkCanvas.height = pixelHeight;
      sparkContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    sparkCanvas.style.width = `${width}px`;
    sparkCanvas.style.height = `${height}px`;
    startSparkLoop();
    return true;
  }

  function captureElectricSegment(context) {
    const start = context.__memoryGraphLineStart;
    const end = context.__memoryGraphLineEnd;
    const sourceCanvas = context.canvas;
    if (!start || !end || !ensureSparkLayer(sourceCanvas)) return;

    const rect = sourceCanvas.getBoundingClientRect();
    const dpr = Math.max(1, sourceCanvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    const startX = (matrix.a * start.x + matrix.c * start.y + matrix.e) / dpr;
    const startY = (matrix.b * start.x + matrix.d * start.y + matrix.f) / dpr;
    const endX = (matrix.a * end.x + matrix.c * end.y + matrix.e) / dpr;
    const endY = (matrix.b * end.x + matrix.d * end.y + matrix.f) / dpr;

    sparkSegments.push({
      centreX: startX,
      centreY: startY,
      outerX: endX,
      outerY: endY,
      seed: Math.abs(Math.sin(startX * 0.013 + startY * 0.017 + endX * 0.019 + endY * 0.023))
    });
  }

  function startSparkLoop() {
    if (sparkFrame) return;
    sparkFrame = requestAnimationFrame(drawElectricFrame);
  }

  function drawElectricFrame(timestamp) {
    sparkFrame = requestAnimationFrame(drawElectricFrame);
    if (!sparkContext || !sparkCanvas || !sparkSourceCanvas?.isConnected) return;

    const interacting = sparkSourceCanvas.dataset.interacting === 'true';
    const frameMs = interacting ? INTERACTING_FRAME_MS : NORMAL_FRAME_MS;
    if (timestamp - lastSparkPaint < frameMs) return;
    lastSparkPaint = timestamp;

    const rect = sparkSourceCanvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    sparkContext.clearRect(0, 0, width, height);

    if (!sparkSegments.length || document.hidden) return;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;

    let centreEnergy = 0;
    let centreX = 0;
    let centreY = 0;

    for (const segment of sparkSegments) {
      const result = drawLightningArc(segment, timestamp, interacting);
      centreEnergy += result.centreEnergy;
      centreX += segment.centreX;
      centreY += segment.centreY;
    }

    if (sparkSegments.length) {
      drawCentrePulse(
        centreX / sparkSegments.length,
        centreY / sparkSegments.length,
        clamp(centreEnergy / Math.max(1, sparkSegments.length * 0.13), 0, 1)
      );
    }
  }

  function buildLightningPoints(segment, timestamp, interacting) {
    const dx = segment.centreX - segment.outerX;
    const dy = segment.centreY - segment.outerY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
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

    return { points, length, px, py, bucket };
  }

  function tracePoints(context, points, startIndex = 0, endIndex = points.length - 1) {
    if (!points.length) return;
    const start = points[Math.max(0, startIndex)];
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (let index = Math.max(1, startIndex + 1); index <= Math.min(points.length - 1, endIndex); index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
  }

  function strokeLightning(points, interacting) {
    sparkContext.save();
    sparkContext.lineCap = 'round';
    sparkContext.lineJoin = 'round';

    tracePoints(sparkContext, points);
    sparkContext.lineWidth = interacting ? 4.0 : 5.4;
    sparkContext.strokeStyle = interacting
      ? 'rgba(55, 139, 255, 0.10)'
      : 'rgba(55, 139, 255, 0.15)';
    sparkContext.stroke();

    tracePoints(sparkContext, points);
    sparkContext.lineWidth = interacting ? 2.0 : 2.7;
    sparkContext.strokeStyle = interacting
      ? 'rgba(120, 184, 255, 0.32)'
      : 'rgba(120, 184, 255, 0.46)';
    sparkContext.stroke();

    tracePoints(sparkContext, points);
    sparkContext.lineWidth = interacting ? 0.9 : 1.15;
    sparkContext.strokeStyle = interacting
      ? 'rgba(225, 245, 255, 0.72)'
      : 'rgba(239, 251, 255, 0.94)';
    sparkContext.stroke();
    sparkContext.restore();
  }

  function drawLightningBranch(points, segment, bucket, px, py, interacting) {
    if (interacting || points.length < 7) return;
    if (hashUnit(segment.seed + 0.71, bucket, 29) < 0.58) return;

    const index = 2 + Math.floor(hashUnit(segment.seed + 0.22, bucket, 31) * Math.max(1, points.length - 5));
    const origin = points[index];
    const direction = hashUnit(segment.seed + 0.91, bucket, 37) > 0.5 ? 1 : -1;
    const branchLength = 7 + hashUnit(segment.seed, bucket, 41) * 10;
    const backX = points[Math.max(0, index - 1)].x - origin.x;
    const backY = points[Math.max(0, index - 1)].y - origin.y;
    const endX = origin.x + px * branchLength * direction + backX * 0.35;
    const endY = origin.y + py * branchLength * direction + backY * 0.35;
    const midX = origin.x + (endX - origin.x) * 0.52 + px * direction * 2.2;
    const midY = origin.y + (endY - origin.y) * 0.52 + py * direction * 2.2;

    sparkContext.save();
    sparkContext.lineCap = 'round';
    sparkContext.lineJoin = 'round';

    sparkContext.beginPath();
    sparkContext.moveTo(origin.x, origin.y);
    sparkContext.lineTo(midX, midY);
    sparkContext.lineTo(endX, endY);
    sparkContext.lineWidth = 3.4;
    sparkContext.strokeStyle = 'rgba(78, 156, 255, 0.13)';
    sparkContext.stroke();

    sparkContext.beginPath();
    sparkContext.moveTo(origin.x, origin.y);
    sparkContext.lineTo(midX, midY);
    sparkContext.lineTo(endX, endY);
    sparkContext.lineWidth = 0.9;
    sparkContext.strokeStyle = 'rgba(225, 246, 255, 0.78)';
    sparkContext.stroke();
    sparkContext.restore();
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

    sparkContext.save();
    sparkContext.beginPath();
    sparkContext.arc(x, y, 4.8, 0, Math.PI * 2);
    sparkContext.fillStyle = 'rgba(89, 177, 255, 0.12)';
    sparkContext.fill();

    sparkContext.beginPath();
    sparkContext.arc(x, y, 1.65, 0, Math.PI * 2);
    sparkContext.fillStyle = 'rgba(247, 253, 255, 0.98)';
    sparkContext.fill();
    sparkContext.restore();

    return progress > 0.86 ? (progress - 0.86) / 0.14 : 0;
  }

  function drawLightningArc(segment, timestamp, interacting) {
    const { points, px, py, bucket } = buildLightningPoints(segment, timestamp, interacting);
    strokeLightning(points, interacting);
    drawLightningBranch(points, segment, bucket, px, py, interacting);
    const centreEnergy = drawInwardPulse(points, segment, timestamp, interacting);
    return { centreEnergy };
  }

  function drawCentrePulse(x, y, energy) {
    if (!energy || !Number.isFinite(x) || !Number.isFinite(y)) return;

    const alpha = 0.08 + energy * 0.24;
    const radius = 43 + energy * 7;
    sparkContext.save();
    sparkContext.beginPath();
    sparkContext.arc(x, y, radius, 0, Math.PI * 2);
    sparkContext.lineWidth = 1.2 + energy * 1.4;
    sparkContext.strokeStyle = `rgba(120, 184, 255, ${alpha.toFixed(3)})`;
    sparkContext.stroke();
    sparkContext.restore();
  }

  proto.clearRect = function memoryGraphClearRect(...args) {
    if (isMemoryGraph(this)) sparkSegments = [];
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
    if (!isMemoryGraph(this) || !this.__memoryGraphCircle) {
      return originalFill.apply(this, args);
    }

    const colour = graphColour(this.fillStyle);
    if (!colour) return originalFill.apply(this, args);

    // Keep pointer interaction cheap. The normal graph redraw restores shading immediately.
    if (this.canvas?.dataset?.interacting === 'true') {
      return originalFill.apply(this, args);
    }

    const circle = this.__memoryGraphCircle;
    const sourceAlpha = styleAlpha(this.fillStyle, colour === 'blue' ? 0.24 : 0.18);
    const strength = Math.max(0.44, Math.min(0.82, 0.35 + sourceAlpha * 1.65));
    const gradient = this.createRadialGradient(
      circle.x - circle.radius * 0.30,
      circle.y - circle.radius * 0.34,
      Math.max(1, circle.radius * 0.12),
      circle.x,
      circle.y,
      circle.radius
    );

    if (colour === 'blue') {
      gradient.addColorStop(0, `rgba(226, 245, 255, ${Math.min(0.92, strength + 0.14)})`);
      gradient.addColorStop(0.27, `rgba(120, 184, 255, ${strength})`);
      gradient.addColorStop(0.72, `rgba(33, 91, 154, ${Math.max(0.32, strength * 0.66)})`);
      gradient.addColorStop(1, 'rgba(7, 18, 34, 0.40)');
    } else {
      gradient.addColorStop(0, `rgba(242, 255, 211, ${Math.min(0.90, strength + 0.10)})`);
      gradient.addColorStop(0.27, `rgba(199, 255, 86, ${strength})`);
      gradient.addColorStop(0.72, `rgba(83, 124, 31, ${Math.max(0.28, strength * 0.62)})`);
      gradient.addColorStop(1, 'rgba(10, 20, 10, 0.38)');
    }

    this.save();
    this.fillStyle = gradient;
    originalFill.apply(this, args);
    this.restore();
    return undefined;
  };

  proto.stroke = function memoryGraphStroke(...args) {
    if (!isMemoryGraph(this)) return originalStroke.apply(this, args);

    const colour = graphColour(this.strokeStyle);
    if (!colour) return originalStroke.apply(this, args);

    const sourceWidth = Math.max(0.5, Number(this.lineWidth) || 1);

    // Space -> Memory edges are the thin blue links. Capture them for the dedicated
    // lightning layer and deliberately suppress the original straight spokes.
    if (colour === 'blue' && sourceWidth <= 1.6 && this.__memoryGraphLineStart && this.__memoryGraphLineEnd) {
      captureElectricSegment(this);
      return undefined;
    }

    // Node outlines and focus rings keep their normal renderer behaviour.
    if (sourceWidth > 1.6) return originalStroke.apply(this, args);

    // Revision links remain visible as their existing green relationship style.
    this.save();
    this.lineWidth = Math.max(2.0, sourceWidth * 2.35);
    this.strokeStyle = colour === 'green'
      ? 'rgba(199, 255, 86, 0.28)'
      : String(this.strokeStyle);
    originalStroke.apply(this, args);
    this.restore();

    return originalStroke.apply(this, args);
  };
})();
