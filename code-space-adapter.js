(() => {
  'use strict';

  const CODE_SPACE_ORIGIN = 'http://127.0.0.1:8090';
  const BRIDGE_PROTOCOL = 'universal-code-space-authorise-v1';
  const MEMORY_DISPATCH_SESSION_KEY = 'universal-code-space-memory-dispatch-acknowledgements-v1';
  const CURRENT_MEMORY_DISPATCH_SESSION_KEY = 'universal-code-space-current-memory-dispatch-v1';
  let bridgeFrame = null;
  let bridgeReady = false;
  let bridgeReadyPromise = null;
  let bridgeReadyResolve = null;
  let bridgeRequestNumber = 0;
  const bridgePendingRequests = new Map();
  const pendingMemoryDispatches = new Map();
  let currentMemoryDispatch = null;
  let activeMemoryDispatch = null;

  const DEFINITION = Object.freeze({
    id: 'code-space',
    name: 'CODE SPACE',
    nodes: Object.freeze([
      { id: 'projects', label: 'Projects', action: 'projects.open', view: 'list', expandable: true },
      { id: 'files', label: 'Files', action: 'files.open', view: 'list', expandable: true },
      { id: 'jobs', label: 'Jobs', action: 'jobs.open', view: 'status' },
      { id: 'authorise-start', label: 'Authorise & Start', action: 'dispatch.authorise-start', view: 'status' },
      { id: 'codex', label: 'Codex', action: 'codex.open', view: 'status' },
      { id: 'terminal', label: 'Terminal', action: 'terminal.open', view: 'status' },
      { id: 'git', label: 'Git', action: 'git.open', view: 'status' },
      {
        id: 'settings', label: 'Settings', action: 'settings.open', view: 'settings', expandable: true, children: [
          { id: 'settings:root', label: 'Workspace root', action: 'settings.root', view: 'settings' },
          { id: 'settings:limits', label: 'Read limits', action: 'settings.limits', view: 'settings' },
          { id: 'settings:refresh', label: 'Refresh', action: 'settings.refresh', view: 'settings' }
        ]
      },
      { id: 'open-code-space', label: 'Open Code Space', action: 'code-space.open', view: 'status' }
    ])
  });

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

  function showPanel(titleText, content) {
    const shell = document.querySelector('.app-shell');
    const title = document.getElementById('detailTitle');
    const detail = document.getElementById('detailContent');
    if (!shell || !title || !detail) return false;
    title.textContent = titleText;
    detail.innerHTML = content;
    shell.classList.add('detail-open');
    return true;
  }

  function replaceChildren(parentId, children) {
    return globalThis.UniversalAppAdapters?.replaceAppNodeChildren?.('code-space', parentId, children) === true;
  }

  async function requestJson(pathName) {
    const response = await fetch(pathName, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(value.error || `Code Space request failed with HTTP ${response.status}`));
    return value;
  }

  async function openProjects() {
    showPanel('Code Space Projects', '<div class="inspector-placeholder"><p>Loading configured projects...</p></div>');
    try {
      const result = await requestJson('/api/code-space/projects');
      replaceChildren('code-space:projects', (result.projects || []).map((project) => ({
        id: `projects:${project.name}`, label: project.name, action: 'project.open', view: 'list', state: { name: project.name }
      })) || [{ id: 'projects:empty', label: 'No projects found', action: 'projects.status' }]);
      showPanel('Code Space Projects', `<div class="detail-block"><label>Configured root</label><p>${escapeHtml(result.root)}</p></div><p>${(result.projects || []).length} project folders available.</p>`);
    } catch {
      showPanel('Code Space Projects', '<p>Configured workspace projects are unavailable.</p>');
    }
  }

  async function openFiles(project = 'universal-space') {
    showPanel('Code Space Files', '<div class="inspector-placeholder"><p>Loading read-only file listing...</p></div>');
    try {
      const result = await requestJson(`/api/code-space/files?project=${encodeURIComponent(project)}`);
      replaceChildren('code-space:files', (result.files || []).slice(0, 100).map((file, index) => ({
        id: `files:${index}`, label: file.path, action: 'file.open', view: 'status', state: { path: file.path, kind: file.kind }
      })));
      showPanel('Code Space Files', `<div class="detail-block"><label>Project</label><p>${escapeHtml(project)}</p></div><p>${(result.files || []).length} read-only entries (maximum 100).</p>`);
    } catch {
      showPanel('Code Space Files', '<p>The configured project file listing is unavailable.</p>');
    }
  }

  function status(title, message) { return showPanel(title, `<div class="detail-block"><p>${escapeHtml(message)}</p></div>`); }

  function ensureBridge() {
    if (!bridgeFrame) {
      bridgeFrame = document.createElement('iframe');
      bridgeFrame.style.position = 'fixed';
      bridgeFrame.style.width = '1px';
      bridgeFrame.style.height = '1px';
      bridgeFrame.style.opacity = '0';
      bridgeFrame.style.pointerEvents = 'none';
      bridgeFrame.style.border = '0';
      bridgeFrame.style.left = '0';
      bridgeFrame.style.top = '0';
      bridgeFrame.tabIndex = -1;
      bridgeFrame.setAttribute('aria-hidden', 'true');
      bridgeFrame.src = `${CODE_SPACE_ORIGIN}/`;
      document.body.appendChild(bridgeFrame);
    }
    if (bridgeReady) return Promise.resolve();
    if (!bridgeReadyPromise) {
      bridgeReadyPromise = new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Code Space authorisation bridge timed out.')), 6000);
        bridgeReadyResolve = () => {
          window.clearTimeout(timer);
          resolve();
        };
      });
    }
    return bridgeReadyPromise;
  }

  function validatedMemoryDispatchAcknowledgements(acknowledgedJobs) {
    const next = new Map();
    for (const item of Array.isArray(acknowledgedJobs) ? acknowledgedJobs : []) {
      const memoryJobId = String(item?.memoryJobId || '');
      const officeJobId = String(item?.officeJobId || '');
      const packageId = String(item?.packageId || '');
      if (!memoryJobId || !officeJobId || !packageId) continue;
      next.set(memoryJobId, Object.freeze({ memoryJobId, officeJobId, packageId }));
    }
    return next;
  }

  function persistMemoryDispatchAcknowledgements() {
    try {
      sessionStorage.setItem(MEMORY_DISPATCH_SESSION_KEY, JSON.stringify([...pendingMemoryDispatches.values()]));
      return true;
    } catch {
      return false;
    }
  }

  function sameMemoryDispatch(left, right) {
    return left?.memoryJobId === right?.memoryJobId
      && left?.officeJobId === right?.officeJobId
      && left?.packageId === right?.packageId;
  }

  function lifecycleStatus(value) {
    const status = String(value || '');
    return ['Running', 'Completed', 'Failed'].includes(status) ? status : null;
  }

  function emitMemoryDispatchActivity(type, dispatch) {
    if (!dispatch || typeof window === 'undefined') return false;
    window.dispatchEvent(new CustomEvent(type, { detail: dispatch }));
    return true;
  }

  function acceptMemoryDispatchLifecycle(packageId, statusValue) {
    const status = lifecycleStatus(statusValue);
    if (!status || activeMemoryDispatch?.dispatch?.packageId !== packageId) return false;
    const dispatch = activeMemoryDispatch.dispatch;
    activeMemoryDispatch = Object.freeze({ dispatch, status });
    emitMemoryDispatchActivity('code-space-memory-dispatch-status', Object.freeze({ dispatch, status }));
    if (status !== 'Running') activeMemoryDispatch = null;
    return true;
  }

  function markRunningMemoryDispatchViewed() {
    if (activeMemoryDispatch?.status !== 'Running') return false;
    return emitMemoryDispatchActivity('code-space-memory-dispatch-viewed', activeMemoryDispatch.dispatch);
  }

  function getMemoryDispatchAcknowledgements() {
    return Object.freeze([...pendingMemoryDispatches.values()]);
  }

  function getCurrentMemoryDispatchAcknowledgement() {
    return currentMemoryDispatch;
  }

  function persistCurrentMemoryDispatch() {
    try {
      if (currentMemoryDispatch) sessionStorage.setItem(CURRENT_MEMORY_DISPATCH_SESSION_KEY, JSON.stringify(currentMemoryDispatch));
      else sessionStorage.removeItem(CURRENT_MEMORY_DISPATCH_SESSION_KEY);
      return true;
    } catch {
      return false;
    }
  }

  function hydrateMemoryDispatchAcknowledgements() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(MEMORY_DISPATCH_SESSION_KEY) || '[]');
      const hydrated = validatedMemoryDispatchAcknowledgements(stored);
      for (const [memoryJobId, dispatch] of hydrated) pendingMemoryDispatches.set(memoryJobId, dispatch);
      return hydrated.size;
    } catch {
      return 0;
    }
  }

  function hydrateCurrentMemoryDispatch() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(CURRENT_MEMORY_DISPATCH_SESSION_KEY) || 'null');
      const candidate = [...validatedMemoryDispatchAcknowledgements([stored]).values()][0] || null;
      const retained = candidate ? pendingMemoryDispatches.get(candidate.memoryJobId) : null;
      currentMemoryDispatch = sameMemoryDispatch(retained, candidate) ? retained : null;
      return currentMemoryDispatch;
    } catch {
      currentMemoryDispatch = null;
      return null;
    }
  }

  function recordMemoryDispatchAcknowledgements(acknowledgedJobs, expectedCount = null, currentAcknowledgement = null) {
    const next = validatedMemoryDispatchAcknowledgements(acknowledgedJobs);
    if (Number.isInteger(expectedCount) && next.size !== expectedCount) return next.size;
    const previousCurrent = currentMemoryDispatch;
    for (const [memoryJobId, dispatch] of next) pendingMemoryDispatches.set(memoryJobId, dispatch);
    const current = [...validatedMemoryDispatchAcknowledgements([currentAcknowledgement]).values()][0] || null;
    const recorded = current ? pendingMemoryDispatches.get(current.memoryJobId) : null;
    if (sameMemoryDispatch(recorded, current)) currentMemoryDispatch = recorded;
    persistMemoryDispatchAcknowledgements();
    persistCurrentMemoryDispatch();
    if (currentMemoryDispatch && !sameMemoryDispatch(previousCurrent, currentMemoryDispatch)) {
      emitMemoryDispatchActivity('code-space-memory-dispatch-waiting', currentMemoryDispatch);
    }
    return next.size;
  }

  function requestAuthoriseStart(packageId) {
    return ensureBridge().then(() => new Promise((resolve, reject) => {
      const requestId = `code_space_${Date.now()}_${++bridgeRequestNumber}`;
      const timer = window.setTimeout(() => {
        bridgePendingRequests.delete(requestId);
        reject(new Error('Code Space authorisation request timed out.'));
      }, 12000);
      bridgePendingRequests.set(requestId, { resolve, reject, timer });
      bridgeFrame.contentWindow.postMessage({
        protocol: BRIDGE_PROTOCOL,
        type: 'authorise-start',
        requestId,
        packageId
      }, CODE_SPACE_ORIGIN);
    }));
  }

  async function authoriseAndStart() {
    const dispatch = currentMemoryDispatch;
    if (!dispatch) {
      return status('Authorise & Start', 'Universal requires one acknowledged package from the current Office dispatch before authorisation.');
    }
    status('Authorise & Start', 'Checking the existing Code Space authorisation boundary...');
    try {
      const response = await requestAuthoriseStart(dispatch.packageId);
      if (response.ok !== true || String(response.packageId || '') !== dispatch.packageId) throw new Error(String(response.reason || 'Code Space cannot authorise the acknowledged waiting job.'));
      pendingMemoryDispatches.delete(dispatch.memoryJobId);
      currentMemoryDispatch = null;
      persistMemoryDispatchAcknowledgements();
      persistCurrentMemoryDispatch();
      activeMemoryDispatch = Object.freeze({ dispatch, status: null });
      emitMemoryDispatchActivity('code-space-memory-dispatch-authorised', dispatch);
      acceptMemoryDispatchLifecycle(dispatch.packageId, response.taskStatus);
      return status('Authorise & Start', `Code Space accepted ${dispatch.packageId} through its existing ${String(response.boundary || 'authorisation')} control.`);
    } catch (error) {
      return status('Authorise & Start', String(error?.message || 'Code Space authorisation is unavailable.'));
    }
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== CODE_SPACE_ORIGIN || event.source !== bridgeFrame?.contentWindow) return;
    const message = event.data;
    if (!message || message.protocol !== BRIDGE_PROTOCOL) return;
    if (message.type === 'task-status') {
      acceptMemoryDispatchLifecycle(String(message.packageId || ''), message.status);
      return;
    }
    if (message.type === 'ready') {
      bridgeReady = true;
      bridgeReadyResolve?.();
      return;
    }
    if (message.type !== 'response' || typeof message.requestId !== 'string') return;
    const pending = bridgePendingRequests.get(message.requestId);
    if (!pending) return;
    bridgePendingRequests.delete(message.requestId);
    window.clearTimeout(pending.timer);
    pending.resolve(message);
  });

  function handleAction(actionId, context = {}) {
    if (actionId === 'projects.open') return openProjects();
    if (actionId === 'files.open') return openFiles();
    if (actionId === 'project.open') return openFiles(context.state?.name || 'universal-space');
    if (actionId === 'file.open') return status('Code Space File', `${context.state?.kind || 'File'}: ${context.state?.path || 'Unknown path'} (read-only listing; contents are not opened).`);
    if (actionId === 'projects.status') return status('Code Space Projects', 'No project folders were found under the configured workspace root.');
    if (actionId === 'jobs.open') return status('Code Space Jobs', 'Local job activity is not connected yet. This capability is available for future adapter activity.');
    if (actionId === 'dispatch.authorise-start') return authoriseAndStart();
    if (actionId === 'codex.open' || actionId === 'code-space.open') {
      const opened = showPanel('Code Space', '<div class="code-space-embed"><iframe src="http://127.0.0.1:8090/" title="Code Space" loading="eager" referrerpolicy="no-referrer"></iframe></div>');
      if (opened) document.querySelector('.app-shell')?.classList.add('detail-overlay');
      if (opened && actionId === 'code-space.open') markRunningMemoryDispatchViewed();
      return opened;
    }
    if (actionId === 'terminal.open') return status('Terminal', 'Terminal capability is status-only. Arbitrary command execution is disabled.');
    if (actionId === 'git.open') return status('Git', 'Repository status is read-only in this milestone. No Git commands are executed.');
    if (actionId === 'settings.open') return status('Code Space Settings', 'Read-only workspace controls. Expand this node for configured root, limits and refresh.');
    if (actionId === 'settings.root') return status('Workspace root', 'E:\\WIZZ-Server\\new-version');
    if (actionId === 'settings.limits') return status('Read limits', 'Projects: 40 folders. Files: 100 entries, depth 2.');
    if (actionId === 'settings.refresh') return openProjects();
    return false;
  }

  hydrateMemoryDispatchAcknowledgements();
  hydrateCurrentMemoryDispatch();
  const adapter = Object.freeze({
    id: 'code-space',
    definition: DEFINITION,
    handleAction,
    recordMemoryDispatchAcknowledgements,
    getMemoryDispatchAcknowledgements,
    getCurrentMemoryDispatchAcknowledgement
  });
  globalThis.CodeSpaceAdapter = adapter;
  globalThis.UniversalAppAdapters?.registerAppAdapter?.(adapter);
})();
