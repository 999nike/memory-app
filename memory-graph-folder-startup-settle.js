(() => {
  'use strict';

  // Manual folder/title bodies restore their saved world offsets on load, but
  // the gravity solver starts asleep. Wake it once after MemoryGraph exists so
  // stale/off-orbit folder positions settle back toward the same normal orbit
  // used by the Memory cluster. This does not reset titles, members or storage.
  function settleFolders() {
    const gravity = globalThis.MemoryGraphManualGravity;
    const graph = globalThis.MemoryGraph;
    if (!gravity || !graph) return false;
    gravity.wake?.();
    gravity.redraw?.();
    return true;
  }

  if (!settleFolders()) {
    let attempts = 0;
    const retry = () => {
      attempts += 1;
      if (!settleFolders() && attempts < 30) requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  }
})();
