(() => {
  'use strict';

  // The query switch is intentionally local to the visual lab.  It ensures that
  // parity comparisons never initialise two canvases or two simulation ticks.
  const molecular = new URLSearchParams(location.search).get('molecularEngine') === '1';
  const scripts = molecular
    ? [
      './memory-graph-visuals.js?v=static-neural-20260930',
      './memory-graph-neural-width.js?v=approved-neural-width-20260930',
      './memory-graph-neural-scaffold.js?v=dendritic-body-v5-20260930',
      './memory-graph-neural-flow.js?v=neutral-synapse-v3-20260930',
      './molecular-engine.js?v=2',
      './memory-molecular-adapter.js?v=2',
      './memory-graph-nebula.js?v=space-junkz-video-20260921'
    ]
    : [
      './memory-graph-visuals.js?v=hub-circulation-20260921',
      './memory-graph-mobile.js?v=1',
      './memory-graph-rotation.js?v=1',
      './memory-graph-manual-groups.js?v=1',
      './memory-graph-neural-width.js?v=approved-neural-width-20260930',
      './memory-graph-neural-scaffold.js?v=dendritic-body-v5-20260930',
      './memory-graph-neural-flow.js?v=neutral-synapse-v3-20260930',
      './memory-graph-manual-gravity.js?v=2',
      './memory-graph-orb-matrix-guard.js?v=1',
      './memory-graph.js?v=neural-renderer-20260930',
      './memory-graph-folder-startup-settle.js?v=1',
      './memory-graph-nebula.js?v=space-junkz-video-20260921'
    ];
  for (const src of scripts) document.write(`<script src="${src}" defer><\/script>`);
})();
