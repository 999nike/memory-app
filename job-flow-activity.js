(() => {
  'use strict';

  const WORKSPACE_KEY = 'memory-space-v1';
  const MEMORY_TARGET = 'memory-root';
  const OFFICE_TRANSFER_TARGET = 'office-memory-jobs';
  const OFFICE_APP_ID = 'office';
  const OFFICE_COLLECTION_NODE_ID = 'memory-jobs';
  const OFFICE_NODE_ID = 'send-to-code-space';
  const TRANSITION_MS = 2800;
  let knownCollectedJobIds = null;

  function workspaceJobs() {
    try {
      const workspace = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      if (!workspace || !Array.isArray(workspace.memories)) return [];
      return workspace.memories.filter((memory) => memory?.type === 'job' && memory?.status === 'ready');
    } catch {
      return [];
    }
  }

  function syncActivity({ acknowledge = false } = {}) {
    const registry = globalThis.UniversalAppAdapters;
    if (!registry?.setVisualActivity || !registry?.setAppActivity) return false;

    const jobs = workspaceJobs();
    const waiting = jobs.filter((job) => !job.officeCollectedAt && !job.officeJobId);
    const collected = jobs.filter((job) => job.officeCollectedAt && job.officeJobId);
    const collectedIds = new Set(collected.map((job) => String(job.id)));

    registry.setVisualActivity(MEMORY_TARGET, { pending: waiting.length > 0, count: waiting.length, kind: 'job' });
    registry.clearAppActivity?.(OFFICE_APP_ID, OFFICE_COLLECTION_NODE_ID);
    registry.setAppActivity(OFFICE_APP_ID, OFFICE_NODE_ID, { pending: collected.length > 0, count: collected.length, kind: 'job' });

    if (knownCollectedJobIds === null) {
      knownCollectedJobIds = collectedIds;
      return true;
    }

    if (acknowledge) {
      const startedAt = performance.now();
      for (const job of collected) {
        const jobId = String(job.id);
        if (knownCollectedJobIds.has(jobId)) continue;
        const targetId = `job-transition:${jobId}`;
        registry.setVisualActivity(targetId, {
          pending: true,
          kind: 'job',
          jobId,
          from: MEMORY_TARGET,
          to: OFFICE_TRANSFER_TARGET,
          startedAt,
          expiresAt: startedAt + TRANSITION_MS
        });
        window.setTimeout(() => registry.clearVisualActivity?.(targetId), TRANSITION_MS + 80);
      }
    }

    knownCollectedJobIds = collectedIds;
    return true;
  }

  window.addEventListener('memory-workspace-changed', () => syncActivity());
  window.addEventListener('storage', (event) => {
    if (event.key === WORKSPACE_KEY) syncActivity();
  });
  window.addEventListener('memory-job-acknowledged', () => syncActivity({ acknowledge: true }));

  syncActivity();
  globalThis.MemoryJobFlowActivity = Object.freeze({ sync: () => syncActivity() });
})();
