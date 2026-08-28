(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralCoreInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralCoreInstalled', { value: true });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousClearRect = proto.clearRect;
  const previousStroke = proto.stroke;

  const starts = [];
  let sourceCanvas = null;
  let layer = null;
  let ctx = null;
  let frame = 0;
  let lastPaint = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function isMainGraph(context) {
    return context?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isSemanticBlueLine(context) {
    if (!context?.__memoryCoreStart || !context?.__memoryCoreEnd) return false;
    const style = String(context.strokeStyle || '');
    return style.includes('120, 184, 255') || style.includes('55, 139, 255') || style.includes('241, 251, 255');
  }

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-core-canvas';
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

  function captureStart(context) {
    const canvas = context.canvas;
    if (!ensureLayer(canvas)) return;

    const start = context.__memoryCoreStart;
    if (!start) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    starts.push({
      x: (matrix.a * start.x + matrix.c * start.y + matrix.e) / dpr,
      y: (matrix.b * start.x + matrix.d * start.y + matrix.f) / dpr
    });
  }

  function centrePoint() {
    if (!starts.length) return null;
    let x = 0;
    let y = 0;
    for (const point of starts) {
      x += point.x;
      y += point.y;
    }
    return { x: x / starts.length, y: y / starts.length };
  }

  function glow(point, radius, alpha) {
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
    gradient.addColorStop(0.18, `rgba(203,248,255,${(alpha * 0.92).toFixed(3)})`);
    gradient.addColorStop(0.48, `rgba(92,198,255,${(alpha * 0.55).toFixed(3)})`);
    gradient.addColorStop(1, 'rgba(38,118,255,0)');
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  function drawHeartbeat(centre, timestamp) {
    const raw = (timestamp % 5600) / 5600;
    let charge = 0;

    if (raw >= 0.88) charge = clamp((raw - 0.88) / 0.12, 0, 1);
    else if (raw < 0.10) charge = clamp(1 - raw / 0.10, 0, 1);

    const burst = clamp(1 - Math.abs(raw - 0.10) / 0.045, 0, 1);
    if (charge <= 0 && burst <= 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (charge > 0) {
      glow(centre, 18 + charge * 24, 0.18 + charge * 0.38);
      glow(centre, 7 + charge * 11, 0.48 + charge * 0.44);

      ctx.beginPath();
      ctx.arc(centre.x, centre.y, 5 + charge * 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(238,253,255,${(0.20 + charge * 0.62).toFixed(3)})`;
      ctx.fill();
    }

    if (burst > 0) {
      glow(centre, 30 + burst * 34, 0.24 + burst * 0.42);

      ctx.beginPath();
      ctx.arc(centre.x, centre.y, 20 + burst * 31, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,247,255,${(0.14 + burst * 0.62).toFixed(3)})`;
      ctx.lineWidth = 1.4 + burst * 2.2;
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawFrame(timestamp) {
    frame = requestAnimationFrame(drawFrame);
    if (!ctx || !layer || !sourceCanvas?.isConnected || document.hidden) return;
    if (timestamp - lastPaint < 34) return;
    lastPaint = timestamp;

    const rect = sourceCanvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (sourceCanvas.dataset.interacting === 'true') return;

    const centre = centrePoint();
    if (centre) drawHeartbeat(centre, timestamp);
  }

  proto.beginPath = function memoryGraphNeuralCoreBeginPath(...args) {
    if (isMainGraph(this)) {
      this.__memoryCoreStart = null;
      this.__memoryCoreEnd = null;
    }
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function memoryGraphNeuralCoreMoveTo(x, y, ...rest) {
    if (isMainGraph(this)) {
      this.__memoryCoreStart = { x: Number(x), y: Number(y) };
      this.__memoryCoreEnd = null;
    }
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function memoryGraphNeuralCoreLineTo(x, y, ...rest) {
    if (isMainGraph(this) && this.__memoryCoreStart) {
      this.__memoryCoreEnd = { x: Number(x), y: Number(y) };
    }
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function memoryGraphNeuralCoreClearRect(...args) {
    if (isMainGraph(this)) starts.length = 0;
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function memoryGraphNeuralCoreStroke(...args) {
    if (isMainGraph(this) && isSemanticBlueLine(this) && Number(this.lineWidth || 1) <= 1.6) {
      captureStart(this);
    }
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralCoreStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralCoreStyles';
    style.textContent = '.memory-graph-neural-core-canvas{position:absolute;inset:0;z-index:3;display:block;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen}';
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralCore = Object.freeze({
    version: VERSION,
    redraw() { lastPaint = 0; }
  });
})();