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

  function isMemoryGraph(context) {
    return Boolean(context?.canvas?.classList?.contains('memory-graph-canvas'));
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

  proto.beginPath = function memoryGraphBeginPath(...args) {
    if (isMemoryGraph(this)) this.__memoryGraphCircle = null;
    return originalBeginPath.apply(this, args);
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

    const circle = this.__memoryGraphCircle;
    const sourceAlpha = styleAlpha(this.fillStyle, colour === 'blue' ? 0.24 : 0.18);
    const strength = Math.max(0.46, Math.min(0.86, 0.36 + sourceAlpha * 1.8));
    const highlightX = circle.x - circle.radius * 0.34;
    const highlightY = circle.y - circle.radius * 0.40;
    const gradient = this.createRadialGradient(
      highlightX,
      highlightY,
      Math.max(1, circle.radius * 0.10),
      circle.x,
      circle.y,
      circle.radius * 1.05
    );

    if (colour === 'blue') {
      gradient.addColorStop(0, `rgba(226, 245, 255, ${Math.min(0.94, strength + 0.16)})`);
      gradient.addColorStop(0.24, `rgba(120, 184, 255, ${strength})`);
      gradient.addColorStop(0.68, `rgba(33, 91, 154, ${Math.max(0.34, strength * 0.70)})`);
      gradient.addColorStop(1, 'rgba(7, 18, 34, 0.42)');
    } else {
      gradient.addColorStop(0, `rgba(242, 255, 211, ${Math.min(0.92, strength + 0.12)})`);
      gradient.addColorStop(0.24, `rgba(199, 255, 86, ${strength})`);
      gradient.addColorStop(0.68, `rgba(83, 124, 31, ${Math.max(0.30, strength * 0.66)})`);
      gradient.addColorStop(1, 'rgba(10, 20, 10, 0.40)');
    }

    this.save();
    this.fillStyle = gradient;
    this.shadowBlur = colour === 'blue' ? 30 : 22;
    this.shadowColor = colour === 'blue'
      ? 'rgba(120, 184, 255, 0.78)'
      : 'rgba(199, 255, 86, 0.66)';
    originalFill.apply(this, args);
    this.restore();
    return undefined;
  };

  proto.stroke = function memoryGraphStroke(...args) {
    if (!isMemoryGraph(this)) return originalStroke.apply(this, args);

    const colour = graphColour(this.strokeStyle);
    if (!colour) return originalStroke.apply(this, args);

    const sourceWidth = Math.max(0.5, Number(this.lineWidth) || 1);
    const isFineLine = sourceWidth <= 1.6;

    this.save();
    this.globalCompositeOperation = 'lighter';
    this.lineWidth = isFineLine
      ? Math.max(2.4, sourceWidth * 2.9)
      : sourceWidth * 1.45;
    this.strokeStyle = colour === 'blue'
      ? 'rgba(120, 184, 255, 0.30)'
      : 'rgba(199, 255, 86, 0.34)';
    this.shadowBlur = isFineLine ? 14 : 22;
    this.shadowColor = colour === 'blue'
      ? 'rgba(120, 184, 255, 0.82)'
      : 'rgba(199, 255, 86, 0.78)';
    originalStroke.apply(this, args);
    this.restore();

    return originalStroke.apply(this, args);
  };
})();
