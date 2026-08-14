(() => {
  'use strict';

  const BRIDGE_KEY = 'memory-ai-bridges-v1';
  const WORKSPACE_KEY = 'memory-space-v1';
  const publishedSignatures = new Map();
  let syncing = false;

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function activeBridge() {
    const bridges = loadJson(BRIDGE_KEY, []);
    if (!Array.isArray(bridges) || !bridges.length) return null;

    const activeId = globalThis.MemoryAI?.getActiveProviderId?.() || '';
    if (String(activeId).startsWith('memory-bridge:')) {
      const id = String(activeId).slice('memory-bridge:'.length);
      const match = bridges.find((bridge) => bridge.id === id);
      if (match) return match;
    }

    // Never guess between multiple saved customer connections. Publishing the
    // active Space to the wrong bridge would cross the customer boundary.
    return bridges.length === 1 ? bridges[0] : null;
  }

  function buildSharedActiveSpace({ includeConfirmed = true, includeJobs = false } = {}) {
    const workspace = loadJson(WORKSPACE_KEY, null);
    if (!workspace || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.memories)) return null;

    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    if (!space) return null;

    const memories = workspace.memories.filter((memory) => {
      if (memory.spaceId !== space.id) return false;
      if (includeConfirmed && String(memory.status || 'confirmed') === 'confirmed') return true;
      return includeJobs && memory.type === 'job' && memory.status === 'ready';
    });

    return {
      version: Number(workspace.version || 1),
      activeSpaceId: space.id,
      spaces: [{ ...space }],
      memories: memories.map((memory) => ({ ...memory }))
    };
  }

  function applyJobAcknowledgements(acknowledgements) {
    if (!Array.isArray(acknowledgements) || !acknowledgements.length) return 0;
    const workspace = loadJson(WORKSPACE_KEY, null);
    if (!workspace || !Array.isArray(workspace.memories)) return 0;
    let changed = 0;
    for (const acknowledgement of acknowledgements) {
      const job = workspace.memories.find((memory) => memory.id === acknowledgement?.memoryJobId && memory.type === 'job');
      if (!job || (job.officeJobId && job.officeJobId !== acknowledgement.officeJobId)) continue;
      if (job.officeCollectedAt === acknowledgement.officeCollectedAt && job.officeJobId === acknowledgement.officeJobId) continue;
      job.officeCollectedAt = acknowledgement.officeCollectedAt;
      job.officeJobId = acknowledgement.officeJobId;
      changed += 1;
    }
    if (changed) {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
      window.dispatchEvent(new CustomEvent('memory-job-acknowledged', { detail: { count: changed } }));
    }
    return changed;
  }

  function refreshPermissionSurface() {
    const dialog = document.getElementById('aiAccessDialog');
    if (!dialog?.open) return;
    window.dispatchEvent(new Event('storage'));
  }

  async function syncAuthorisedSpace({ force = false } = {}) {
    if (syncing || document.hidden) return;
    if (!globalThis.MemoryBridge?.listExternalClients || !globalThis.MemoryBridge?.publishWorkspace) return;

    const bridge = activeBridge();
    if (!bridge) return;

    syncing = true;
    try {
      const clients = await globalThis.MemoryBridge.listExternalClients(bridge);
      const officeEnabled = bridge.officeJobFeedEnabled === true;
      if (!clients.length && !officeEnabled) {
        publishedSignatures.delete(bridge.id);
        return;
      }

      const workspace = buildSharedActiveSpace({ includeConfirmed: clients.length > 0, includeJobs: officeEnabled });
      if (!workspace) return;

      const signature = JSON.stringify(workspace);
      if (!force && publishedSignatures.get(bridge.id) === signature) return;

      const result = await globalThis.MemoryBridge.publishWorkspace(bridge, workspace);
      applyJobAcknowledgements(result?.jobAcknowledgements);
      publishedSignatures.set(bridge.id, signature);
      window.dispatchEvent(new CustomEvent('memory-external-space-synced', {
        detail: {
          bridgeId: bridge.id,
          spaceId: workspace.activeSpaceId,
          memoryCount: result?.memoryCount ?? workspace.memories.length,
          clientCount: clients.length
        }
      }));
    } catch (error) {
      console.debug('Automatic external Memory Space sync is waiting for the bridge:', error?.message || error);
    } finally {
      syncing = false;
    }
  }

  function wake() {
    refreshPermissionSurface();
    syncAuthorisedSpace({ force: true });
  }

  window.addEventListener('focus', wake);
  window.addEventListener('storage', () => syncAuthorisedSpace({ force: true }));
  window.addEventListener('memory-ai-provider-changed', () => syncAuthorisedSpace({ force: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake();
  });

  setTimeout(() => syncAuthorisedSpace({ force: true }), 1200);
  setInterval(() => syncAuthorisedSpace(), 3000);

  globalThis.MemoryExternalSync = Object.freeze({
    refresh: () => syncAuthorisedSpace({ force: true })
  });
})();
