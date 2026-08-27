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

  function captureSparkSegment(context) {
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
    sparkFrame = requestAnimationFrame(drawSparkFrame);
  }

  function drawSparkFrame(timestamp) {
    sparkFrame = requestAnimationFrame(drawSparkFrame);
    if (!sparkContext || !sparkCanvas || !sparkSourceCanvas?.isConnected) return;

    if (timestamp - lastSparkPaint < 32) return;
    lastSparkPaint = timestamp;

    const rect = sparkSourceCanvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    sparkContext.clearRect(0, 0, width, height);

    if (!sparkSegments.length || document.hidden || sparkSourceCanvas.dataset.interacting === 'true') return;
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;

    for (const segment of sparkSegments) {
      drawElectricSpark(segment, timestamp);
    }
  }

  function drawElectricSpark(segment, timestamp) {
    const dx = segment.centreX - segment.outerX;
    const dy = segment.centreY - segment.outerY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const px = -uy;
    const py = ux;
    const duration = 1050 + segment.seed * 650;
    const progress = ((timestamp + segment.seed * duration * 0.84) % duration) / duration;
    const eased = Math.min(0.985, progress);
    const headX = segment.outerX + dx * eased;
    const headY = segment.outerY + dy * eased;
    const tailLength = Math.min(13, Math.max(7, length * 0.055));
    const tailX = headX - ux * tailLength;
    const tailY = headY - uy * tailLength;
    const jitter = 1.05 + segment.seed * 0.95;

    sparkContext.save();
    sparkContext.beginPath();
    sparkContext.moveTo(tailX, tailY);
    for (let step = 1; step <= 4; step += 1) {
      const amount = step / 4;
      const wave = step === 4 ? 0 : (step % 2 ? 1 : -1) * jitter;
      sparkContext.lineTo(
        tailX + (headX - tailX) * amount + px * wave,
        tailY + (headY - tailY) * amount + py * wave
      );
    }
    sparkContext.lineWidth = 1.15;
    sparkContext.strokeStyle = 'rgba(202, 235, 255, 0.88)';
    sparkContext.stroke();

    sparkContext.beginPath();
    sparkContext.arc(headX, headY, 4.2, 0, Math.PI * 2);
    sparkContext.fillStyle = 'rgba(120, 184, 255, 0.16)';
    sparkContext.fill();

    sparkContext.beginPath();
    sparkContext.arc(headX, headY, 1.45, 0, Math.PI * 2);
    sparkContext.fillStyle = 'rgba(244, 252, 255, 0.96)';
    sparkContext.fill();
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

    // Space -> Memory edges are the thin blue links. Capture their transformed
    // screen geometry for the separate low-cost spark overlay.
    if (colour === 'blue' && sourceWidth <= 1.6 && this.__memoryGraphLineStart && this.__memoryGraphLineEnd) {
      captureSparkSegment(this);
    }

    // Nodes already receive a native glow pass in memory-graph.js. Doubling those
    // strokes here was the expensive part of the first graphics pass.
    if (sourceWidth > 1.6) return originalStroke.apply(this, args);

    // Cheap luminous link: one wider translucent pass, no shadow blur/composite work.
    this.save();
    this.lineWidth = Math.max(2.0, sourceWidth * 2.35);
    this.strokeStyle = colour === 'blue'
      ? 'rgba(120, 184, 255, 0.24)'
      : 'rgba(199, 255, 86, 0.28)';
    originalStroke.apply(this, args);
    this.restore();

    return originalStroke.apply(this, args);
  };
})();
