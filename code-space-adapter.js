(() => {
  'use strict';

  const DEFINITION = Object.freeze({
    id: 'code-space',
    name: 'CODE SPACE',
    nodes: Object.freeze([
      { id: 'projects', label: 'Projects', action: 'projects.open', view: 'list', expandable: true },
      { id: 'files', label: 'Files', action: 'files.open', view: 'list', expandable: true },
      { id: 'jobs', label: 'Jobs', action: 'jobs.open', view: 'status' },
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

  function handleAction(actionId, context = {}) {
    if (actionId === 'projects.open') return openProjects();
    if (actionId === 'files.open') return openFiles();
    if (actionId === 'project.open') return openFiles(context.state?.name || 'universal-space');
    if (actionId === 'file.open') return status('Code Space File', `${context.state?.kind || 'File'}: ${context.state?.path || 'Unknown path'} (read-only listing; contents are not opened).`);
    if (actionId === 'projects.status') return status('Code Space Projects', 'No project folders were found under the configured workspace root.');
    if (actionId === 'jobs.open') return status('Code Space Jobs', 'Local job activity is not connected yet. This capability is available for future adapter activity.');
    if (actionId === 'codex.open' || actionId === 'code-space.open') {
      const opened = showPanel('Code Space', '<div class="code-space-embed"><iframe src="http://127.0.0.1:8090/" title="Code Space" loading="eager" referrerpolicy="no-referrer"></iframe></div>');
      if (opened) document.querySelector('.app-shell')?.classList.add('detail-overlay');
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

  const adapter = Object.freeze({ id: 'code-space', definition: DEFINITION, handleAction });
  globalThis.CodeSpaceAdapter = adapter;
  globalThis.UniversalAppAdapters?.registerAppAdapter?.(adapter);
})();
