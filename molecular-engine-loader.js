(() => {
  'use strict';

  // The query switch is intentionally local to the visual lab.  It ensures that
  // parity comparisons never initialise two canvases or two simulation ticks.
  const molecular = new URLSearchParams(location.search).get('molecularEngine') === '1';
  const scripts = molecular
    ? [
      './memory-graph-visuals.js?v=3',
      './memory-graph-neural-width.js?v=5',
      './memory-graph-neural-scaffold.js?v=2',
      './memory-graph-neural-flow.js?v=2',
      './molecular-engine.js?v=2',
      './memory-molecular-adapter.js?v=2',
      './memory-graph-nebula.js?v=1'
    ]
    : [
      './memory-graph-visuals.js?v=3',
      './memory-graph-mobile.js?v=1',
      './memory-graph-rotation.js?v=1',
      './memory-graph-manual-groups.js?v=1',
      './memory-graph-neural-width.js?v=1',
      './memory-graph-neural-scaffold.js?v=2',
      './memory-graph-neural-flow.js?v=2',
      './memory-graph-manual-gravity.js?v=2',
      './memory-graph.js?v=6',
      './memory-graph-nebula.js?v=1'
    ];
  for (const src of scripts) document.write(`<script src="${src}" defer><\/script>`);
})();
