(() => {
  'use strict';

  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphOrbMatrixGuardInstalled) return;
  Object.defineProperty(proto, '__memoryGraphOrbMatrixGuardInstalled', { value: true });

  // Manual folder/title projection learns the graph world matrix from the main
  // canvas fillText path. The resident Orb also draws its state label on that
  // canvas after translating into Orb-local coordinates. Do not let that HUD
  // label pass through the folder projection hook or it overwrites the graph
  // matrix and sends the separate folder/title overlay toward the Orb.
  const previousFillText = proto.fillText;
  proto.fillText = function memoryGraphOrbMatrixGuard(text, x, y, ...rest) {
    const isMainGraph = this?.canvas?.classList?.contains('memory-graph-canvas') === true;
    const isOrbHudLabel = /^Orb\s*[·•]\s*/.test(String(text || ''));
    if (isMainGraph && isOrbHudLabel) {
      // Keep the label visible without invoking the wrapped fillText chain.
      this.save();
      try {
        this.strokeStyle = this.fillStyle;
        this.lineWidth = 0.7;
        return this.strokeText(text, x, y, ...rest);
      } finally {
        this.restore();
      }
    }
    return previousFillText.call(this, text, x, y, ...rest);
  };
})();
