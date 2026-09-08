(() => {
  'use strict';

  const WORKSPACE_KEY = 'memory-space-v1';
  const MEMORY_TARGET = 'memory-root';
  const OFFICE_TRANSFER_TARGET = 'office-memory-jobs';
  const OFFICE_APP_ID = 'office';
  const OFFICE_COLLECTION_NODE_ID = 'memory-jobs';
  const OFFICE_NODE_ID = 'send-to-code-space';
  const OFFICE_ROOT_TARGET = 'office-root';
  const CODE_SPACE_ROOT_TARGET = 'code-space-root';
  const CODE_SPACE_APP_ID = 'code-space';
  const CODE_SPACE_NODE_ID = 'authorise-start';
  const CODE_SPACE_OPEN_NODE_ID = 'open-code-space';
  const CODE_SPACE_HANDOFF_PREFIX = 'office-code-space-handoff:';
  const TRANSITION_MS = 2800;
  let knownCollectedJobIds = null;
  const codeSpaceHandoffs = new Map();
  let waitingCodeSpacePackageId = null;
  let runningCodeSpacePackageId = null;
  let viewedRunningCodeSpacePackageId = null;

  function workspaceJobs() {
    try {
      const workspace = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      if (!workspace || !Array.isArray(workspace.memories)) return [];
      return workspace.memories.filter((memory) => memory?.type === 'job' && memory?.status === 'ready');
    } catch {
      return [];
    }
  }

  function sameDispatch(left, right) {
    return left?.memoryJobId === right?.memoryJobId
      && left?.officeJobId === right?.officeJobId
      && left?.packageId === right?.packageId;
  }

  function acknowledgedMemoryJobIds() {
    const acknowledgements = globalThis.CodeSpaceAdapter?.getMemoryDispatchAcknowledgements?.() || [];
    return new Set(acknowledgements.map((dispatch) => String(dispatch?.memoryJobId || '')).filter(Boolean));
  }

  function currentCodeSpaceDispatch() {
    return globalThis.CodeSpaceAdapter?.getCurrentMemoryDispatchAcknowledgement?.() || null;
  }

  function handoffTargetId(dispatch) {
    return `${CODE_SPACE_HANDOFF_PREFIX}${dispatch.packageId}`;
  }

  function clearWaitingCodeSpaceActivity(dispatch = null) {
    if (dispatch && waitingCodeSpacePackageId !== dispatch.packageId) return false;
    globalThis.UniversalAppAdapters?.clearAppActivity?.(CODE_SPACE_APP_ID, CODE_SPACE_NODE_ID);
    waitingCodeSpacePackageId = null;
    return true;
  }

  function clearRunningCodeSpaceActivity(dispatch = null) {
    if (dispatch && runningCodeSpacePackageId !== dispatch.packageId) return false;
    globalThis.UniversalAppAdapters?.clearAppActivity?.(CODE_SPACE_APP_ID, CODE_SPACE_OPEN_NODE_ID);
    runningCodeSpacePackageId = null;
    viewedRunningCodeSpacePackageId = null;
    return true;
  }

  function startRunningCodeSpaceActivity(dispatch) {
    if (!dispatch || (runningCodeSpacePackageId && runningCodeSpacePackageId !== dispatch.packageId)) return false;
    const viewed = viewedRunningCodeSpacePackageId === dispatch.packageId;
    const started = globalThis.UniversalAppAdapters?.setAppActivity?.(CODE_SPACE_APP_ID, CODE_SPACE_OPEN_NODE_ID, {
      pending: true,
      count: 1,
      kind: 'job',
      palette: 'green',
      emphasis: viewed ? 'steady' : 'strong'
    }) === true;
    if (started) runningCodeSpacePackageId = dispatch.packageId;
    return started;
  }

  function markRunningCodeSpaceActivityViewed(dispatch) {
    if (!dispatch || runningCodeSpacePackageId !== dispatch.packageId) return false;
    viewedRunningCodeSpacePackageId = dispatch.packageId;
    return startRunningCodeSpaceActivity(dispatch);
  }

  function clearCodeSpaceHandoff(dispatch) {
    const targetId = handoffTargetId(dispatch);
    codeSpaceHandoffs.delete(targetId);
    globalThis.UniversalAppAdapters?.clearVisualActivity?.(targetId);
  }

  function startWaitingCodeSpaceActivity(dispatch) {
    const current = currentCodeSpaceDispatch();
    if (!sameDispatch(current, dispatch)) return false;
    const started = globalThis.UniversalAppAdapters?.setAppActivity?.(CODE_SPACE_APP_ID, CODE_SPACE_NODE_ID, {
      pending: true,
      count: 1,
      kind: 'job'
    }) === true;
    if (started) waitingCodeSpacePackageId = dispatch.packageId;
    return started;
  }

  function syncWaitingCodeSpaceActivity() {
    const current = currentCodeSpaceDispatch();
    if (!current) return clearWaitingCodeSpaceActivity();
    if ([...codeSpaceHandoffs.values()].some((dispatch) => sameDispatch(dispatch, current))) return false;
    return startWaitingCodeSpaceActivity(current);
  }

  function beginCodeSpaceHandoff(dispatch) {
    if (!sameDispatch(currentCodeSpaceDispatch(), dispatch)) return false;
    const registry = globalThis.UniversalAppAdapters;
    if (!registry?.setVisualActivity) return false;
    const targetId = handoffTargetId(dispatch);
    codeSpaceHandoffs.set(targetId, dispatch);
    clearWaitingCodeSpaceActivity();
    registry.setVisualActivity(targetId, {
      pending: true,
      count: 1,
      kind: 'job',
      jobId: dispatch.memoryJobId,
      from: OFFICE_ROOT_TARGET,
      to: CODE_SPACE_ROOT_TARGET,
      startedAt: performance.now(),
      oneShot: true
    });
    return true;
  }

  function syncActivity({ acknowledge = false, syncWaiting = true } = {}) {
    const registry = globalThis.UniversalAppAdapters;
    if (!registry?.setVisualActivity || !registry?.setAppActivity) return false;

    const jobs = workspaceJobs();
    const waiting = jobs.filter((job) => !job.officeCollectedAt && !job.officeJobId);
    const collected = jobs.filter((job) => job.officeCollectedAt && job.officeJobId);
    const acknowledged = acknowledgedMemoryJobIds();
    const awaitingCodeSpace = collected.filter((job) => !acknowledged.has(String(job.id)));
    const collectedIds = new Set(collected.map((job) => String(job.id)));

    registry.setVisualActivity(MEMORY_TARGET, { pending: waiting.length > 0, count: waiting.length, kind: 'job' });
    registry.clearAppActivity?.(OFFICE_APP_ID, OFFICE_COLLECTION_NODE_ID);
    registry.setAppActivity(OFFICE_APP_ID, OFFICE_NODE_ID, { pending: awaitingCodeSpace.length > 0, count: awaitingCodeSpace.length, kind: 'job' });
    if (syncWaiting) syncWaitingCodeSpaceActivity();

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
  window.addEventListener('code-space-memory-dispatch-waiting', (event) => {
    const dispatch = event.detail;
    syncActivity({ syncWaiting: false });
    beginCodeSpaceHandoff(dispatch);
  });
  window.addEventListener('universal-route-pulse-arrived', (event) => {
    const targetId = String(event.detail?.targetId || '');
    const dispatch = codeSpaceHandoffs.get(targetId);
    if (!dispatch) return;
    codeSpaceHandoffs.delete(targetId);
    globalThis.UniversalAppAdapters?.clearVisualActivity?.(targetId);
    startWaitingCodeSpaceActivity(dispatch);
  });
  window.addEventListener('code-space-memory-dispatch-authorised', (event) => {
    clearCodeSpaceHandoff(event.detail);
  });

  window.addEventListener('code-space-memory-dispatch-status', (event) => {
    const { dispatch, status } = event.detail || {};
    if (!dispatch) return;
    if (status === 'Running') {
      clearCodeSpaceHandoff(dispatch);
      clearWaitingCodeSpaceActivity(dispatch);
      startRunningCodeSpaceActivity(dispatch);
      return;
    }
    if (status === 'Completed' || status === 'Failed') {
      clearCodeSpaceHandoff(dispatch);
      clearWaitingCodeSpaceActivity(dispatch);
      clearRunningCodeSpaceActivity(dispatch);
    }
  });

  window.addEventListener('code-space-memory-dispatch-viewed', (event) => {
    markRunningCodeSpaceActivityViewed(event.detail);
  });

  syncActivity();
  globalThis.MemoryJobFlowActivity = Object.freeze({ sync: () => syncActivity() });
})();
