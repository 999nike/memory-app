(() => {
  'use strict';

  const VERSION = 2;
  let observer = null;
  let raf = 0;

  function api() {
    return globalThis.MemoryGraphManualGroups || null;
  }

  function visibleInspector() {
    const inspector = document.querySelector('.memory-graph-group-inspector');
    return inspector && !inspector.hidden ? inspector : null;
  }

  function activeGroup() {
    const groupsApi = api();
    const inspector = visibleInspector();
    if (!groupsApi || !inspector) return null;
    const titleEl = inspector.querySelector('.memory-graph-group-inspector-title');
    const raw = String(titleEl?.textContent || '');
    const marker = raw.lastIndexOf(' · ');
    const title = marker >= 0 ? raw.slice(0, marker) : raw;
    const count = marker >= 0 ? Number(raw.slice(marker + 3)) : Number.NaN;
    const groups = groupsApi.groups?.() || [];
    return groups.find((group) => String(group.title || 'Group') === title && (!Number.isFinite(count) || (group.members || []).length === count))
      || groups.find((group) => String(group.title || 'Group') === title)
      || null;
  }

  function renameActiveGroup() {
    const groupsApi = api();
    const group = activeGroup();
    if (!groupsApi || !group) return;
    const next = window.prompt('Rename group', String(group.title || 'Group'));
    if (next === null) return;
    const name = String(next || '').trim().slice(0, 48);
    if (!name || name === String(group.title || '')) return;
    const groups = groupsApi.groups().map((item) => String(item.id) === String(group.id) ? { ...item, title: name } : item);
    if (!groupsApi.replaceGroups(groups)) return;
    groupsApi.openGroup?.(group.id);
    requestAnimationFrame(() => globalThis.MemoryGraph?.refresh?.());
  }

  function installStyles() {
    if (document.getElementById('memoryGraphGroupUxStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphGroupUxStyles';
    style.textContent = `
      .memory-graph-group-inspector-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .memory-graph-group-rename{min-height:34px;border:1px solid rgb(199 255 86/.22);border-radius:9px;background:rgb(199 255 86/.05);color:#c7ff56;font:700 11px/1 Inter,system-ui,sans-serif;cursor:pointer}
      .memory-graph-group-rename:hover{border-color:rgb(199 255 86/.46);background:rgb(199 255 86/.09)}
      .memory-graph-group-empty{padding:18px 12px}
      .memory-graph-group-member-remove{font:800 15px/1 Inter,system-ui,sans-serif}
    `;
    document.head.appendChild(style);
  }

  function decorateInspector() {
    const inspector = document.querySelector('.memory-graph-group-inspector');
    if (!inspector) return false;
    const actions = inspector.querySelector('.memory-graph-group-inspector-actions');
    const deleteButton = inspector.querySelector('.memory-graph-group-delete');
    if (actions && deleteButton && !actions.querySelector('.memory-graph-group-rename')) {
      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'memory-graph-group-rename';
      rename.textContent = 'Rename group';
      rename.addEventListener('click', renameActiveGroup);
      actions.insertBefore(rename, deleteButton);
    }

    const empty = inspector.querySelector('.memory-graph-group-empty');
    if (empty) empty.textContent = 'Empty group. Drag a memory bubble onto this folder.';

    inspector.querySelectorAll('.memory-graph-group-member-remove').forEach((button) => {
      button.textContent = '↗';
      button.title = 'Return memory to main graph';
      const existing = String(button.getAttribute('aria-label') || '');
      button.setAttribute('aria-label', existing.replace(/^Remove /, 'Return ').replace(/ from group$/, ' to main graph'));
    });
    return true;
  }

  function scheduleDecorate() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      decorateInspector();
    });
  }

  function loadGraphControls() {
    if (document.getElementById('memoryGraphControlsLoader') || globalThis.MemoryGraphControls) return;
    const script = document.createElement('script');
    script.id = 'memoryGraphControlsLoader';
    script.src = './memory-graph-controls.js?v=1';
    script.defer = true;
    document.head.appendChild(script);
  }

  function mount() {
    installStyles();
    scheduleDecorate();
    loadGraphControls();
    const surface = document.getElementById('memoryGraphSurface');
    if (!surface || observer) return;
    observer = new MutationObserver(scheduleDecorate);
    observer.observe(surface, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  globalThis.MemoryGraphGroupUx = Object.freeze({ version: VERSION, refresh: scheduleDecorate });
})();
