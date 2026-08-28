(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralWidthInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralWidthInstalled', { value: true });

  const originalStroke = proto.stroke;

  function isScaffold(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-neural-scaffold-canvas') === true;
  }

  function gainFor(style) {
    const s = String(style || '');
    if (s.includes('244,253,255')) return 1.9;
    if (s.includes('104,215,255')) return 2.75;
    if (s.includes('39,149,255')) return 1.65;
    if (s.includes('149,232,255')) return 1.45;
    if (s.includes('157,229,255')) return 1.55;
    if (s.includes('210,246,255')) return 1.45;
    if (s.includes('171,235,255')) return 1.55;
    return 1;
  }

  proto.stroke = function memoryGraphNeuralWidthStroke(...args) {
    if (!isScaffold(this)) return originalStroke.apply(this, args);
    const gain = gainFor(this.strokeStyle);
    if (gain === 1) return originalStroke.apply(this, args);

    const previousWidth = this.lineWidth;
    this.lineWidth = Math.max(0.25, Number(previousWidth || 1) * gain);
    try {
      return originalStroke.apply(this, args);
    } finally {
      this.lineWidth = previousWidth;
    }
  };

  globalThis.MemoryGraphNeuralWidth = Object.freeze({ version: VERSION });
})();
