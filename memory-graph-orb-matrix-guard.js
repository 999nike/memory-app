(() => {
  'use strict';

  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphOrbMatrixGuardInstalled) return;
  Object.defineProperty(proto, '__memoryGraphOrbMatrixGuardInstalled', { value: true });

  // The manual folder/title overlay learns its world->screen matrix by watching
  // fillText on the main graph canvas. Only real graph node labels are drawn
  // while the graph world transform is active; Orb/HUD/post-draw text is not.
  // Keep non-node text out of the manual-gravity hook so it cannot overwrite
  // the projection matrix with identity or Orb-local transforms.
  const previousFillText = proto.fillText;
  proto.fillText = function memoryGraphOrbMatrixGuard(text, x, y, ...rest) {
    const graphCanvas = this?.canvas;
    const isMainGraph = graphCanvas?.classList?.contains('memory-graph-canvas') === true;
    const isGraphNodeLabel = Boolean(this?.__memoryGraphLabelNode);

    if (isMainGraph && !isGraphNodeLabel) {
      graphCanvas.classList.remove('memory-graph-canvas');
      try {
        return previousFillText.call(this, text, x, y, ...rest);
      } finally {
        graphCanvas.classList.add('memory-graph-canvas');
      }
    }

    return previousFillText.call(this, text, x, y, ...rest);
  };
})();
