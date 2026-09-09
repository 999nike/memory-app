(() => {
  'use strict';

  const HOME_SCALE = 1.18;
  const SETTINGS_CONTROLS = [
    { id: 'settings', label: 'Settings', sectorAngle: 0.10, radius: 30, expandable: true },

    { id: 'settings:memories', parentId: 'settings', label: 'Memories', action: 'open-memories', radius: 20 },
    { id: 'settings:new-memory', parentId: 'settings', label: 'New Memory', action: 'add-memory', radius: 20 },
    { id: 'settings:groups', parentId: 'settings', label: 'Groups', action: 'open-groups', radius: 20 },
    { id: 'settings:search', parentId: 'settings', label: 'Search', action: 'open-memory-search', radius: 20 },
    { id: 'settings:open-memory-app', parentId: 'settings', label: 'Open Memory App', action: 'open-memory-app', radius: 20 },

    { id: 'settings:ai-access', parentId: 'settings', label: 'AI Access', radius: 20, expandable: true, orbitScale: 0.96, angleOffset: -0.06 },
    { id: 'settings:memory-bridge', parentId: 'settings', label: 'Memory Bridge', radius: 20, expandable: true, orbitScale: 1.08, angleOffset: 0.05 },
    { id: 'settings:local-model', parentId: 'settings', label: 'Local Model', radius: 19, expandable: true, orbitScale: 0.90, angleOffset: -0.04 },
    { id: 'settings:inbox', parentId: 'settings', label: 'AI Inbox', radius: 19, expandable: true, orbitScale: 1.06, angleOffset: 0.06 },
    { id: 'settings:workspace', parentId: 'settings', label: 'Workspace', radius: 20, expandable: true, orbitScale: 0.88, angleOffset: -0.03 },

    { id: 'settings:ai-access:app', parentId: 'settings:ai-access', label: 'AI in this app', action: 'open-ai-access', radius: 12, orbitScale: 0.92, angleOffset: -0.06 },
    { id: 'settings:ai-access:device', parentId: 'settings:ai-access', label: 'On-device AI', action: 'open-ai-access', radius: 12, orbitScale: 1.06, angleOffset: 0.04 },
    { id: 'settings:ai-access:external', parentId: 'settings:ai-access', label: 'External AI Apps', action: 'open-ai-access', radius: 12, orbitScale: 0.86, angleOffset: -0.02 },
    { id: 'settings:ai-access:connect', parentId: 'settings:ai-access', label: 'Connect AI App', action: 'connect-ai-app', radius: 12, orbitScale: 1.12, angleOffset: 0.05 },
    { id: 'settings:context', parentId: 'settings:ai-access', label: 'AI Context', radius: 19, expandable: true, orbitScale: 1.13, angleOffset: 0.04 },
    { id: 'settings:lifecycle', parentId: 'settings:ai-access', label: 'Lifecycle', radius: 19, expandable: true, orbitScale: 0.94, angleOffset: -0.05 },

    { id: 'settings:memory-bridge:pair', parentId: 'settings:memory-bridge', label: 'Pair Bridge', action: 'open-memory-bridge', radius: 12, orbitScale: 0.90, angleOffset: -0.05 },
    { id: 'settings:memory-bridge:url', parentId: 'settings:memory-bridge', label: 'HTTPS URL', action: 'open-memory-bridge', radius: 11, orbitScale: 1.06, angleOffset: 0.03 },
    { id: 'settings:memory-bridge:token', parentId: 'settings:memory-bridge', label: 'Pairing token', action: 'open-memory-bridge', radius: 11, orbitScale: 0.84, angleOffset: -0.03 },
    { id: 'settings:memory-bridge:test', parentId: 'settings:memory-bridge', label: 'Test / Share', action: 'open-memory-bridge', radius: 11, orbitScale: 1.12, angleOffset: 0.05 },
    { id: 'settings:memory-bridge:pull', parentId: 'settings:memory-bridge', label: 'Pull', action: 'open-memory-bridge', radius: 11, orbitScale: 0.94, angleOffset: -0.04 },
    { id: 'settings:memory-bridge:mcp', parentId: 'settings:memory-bridge', label: 'MCP URL', action: 'open-memory-bridge', radius: 11, orbitScale: 1.05, angleOffset: 0.03 },

    { id: 'settings:local-model:ollama', parentId: 'settings:local-model', label: 'Ollama', action: 'local-preset-ollama', radius: 12, orbitScale: 0.88, angleOffset: -0.05 },
    { id: 'settings:local-model:lmstudio', parentId: 'settings:local-model', label: 'LM Studio', action: 'local-preset-lmstudio', radius: 12, orbitScale: 1.06, angleOffset: 0.04 },
    { id: 'settings:local-model:compatible', parentId: 'settings:local-model', label: 'OpenAI-compatible', action: 'local-preset-custom', radius: 12, orbitScale: 0.94, angleOffset: -0.03 },
    { id: 'settings:local-model:endpoint', parentId: 'settings:local-model', label: 'Endpoint', action: 'local-focus-endpoint', radius: 11, orbitScale: 1.12, angleOffset: 0.05 },
    { id: 'settings:local-model:model', parentId: 'settings:local-model', label: 'Model name', action: 'local-focus-model', radius: 11, orbitScale: 0.86, angleOffset: -0.04 },

    { id: 'settings:context:confirmed', parentId: 'settings:context', label: 'Current confirmed', action: 'open-context', radius: 12, orbitScale: 0.90, angleOffset: -0.05 },
    { id: 'settings:context:approval', parentId: 'settings:context', label: 'Approval required', action: 'open-context', radius: 12, orbitScale: 1.08, angleOffset: 0.04 },
    { id: 'settings:context:archived', parentId: 'settings:context', label: 'Exclude archived', action: 'open-context', radius: 11, orbitScale: 0.86, angleOffset: -0.03 },
    { id: 'settings:context:view', parentId: 'settings:context', label: 'Context view', action: 'open-context', radius: 12, orbitScale: 1.12, angleOffset: 0.05 },
    { id: 'settings:context:copy', parentId: 'settings:context', label: 'Copy context', action: 'copy-context', radius: 11, orbitScale: 0.96, angleOffset: -0.02 },

    { id: 'settings:lifecycle:active', parentId: 'settings:lifecycle', label: 'Active', action: 'open-lifecycle', radius: 11, orbitScale: 0.90, angleOffset: -0.05 },
    { id: 'settings:lifecycle:locked', parentId: 'settings:lifecycle', label: 'Locked', action: 'lifecycle-lock', radius: 11, orbitScale: 1.08, angleOffset: 0.04 },
    { id: 'settings:lifecycle:critical', parentId: 'settings:lifecycle', label: 'Critical', action: 'open-lifecycle', radius: 11, orbitScale: 0.86, angleOffset: -0.03 },
    { id: 'settings:lifecycle:history', parentId: 'settings:lifecycle', label: 'History', action: 'lifecycle-history', radius: 12, orbitScale: 1.12, angleOffset: 0.05 },
    { id: 'settings:lifecycle:archive', parentId: 'settings:lifecycle', label: 'Archive', action: 'lifecycle-archive', radius: 11, orbitScale: 0.95, angleOffset: -0.02 },

    { id: 'settings:inbox:suggestions', parentId: 'settings:inbox', label: 'Suggestions', action: 'open-proposals', radius: 12, orbitScale: 0.90, angleOffset: -0.05 },
    { id: 'settings:inbox:approval', parentId: 'settings:inbox', label: 'Requires approval', action: 'open-proposals', radius: 12, orbitScale: 1.10, angleOffset: 0.04 },
    { id: 'settings:inbox:review', parentId: 'settings:inbox', label: 'Review', action: 'open-proposals', radius: 12, orbitScale: 0.94, angleOffset: -0.02 },

    { id: 'settings:workspace:add', parentId: 'settings:workspace', label: 'Add Memory', action: 'add-memory', radius: 12, orbitScale: 0.90, angleOffset: -0.05 },
    { id: 'settings:workspace:export', parentId: 'settings:workspace', label: 'Export', action: 'export-workspace', radius: 11, orbitScale: 1.08, angleOffset: 0.04 },
    { id: 'settings:workspace:import', parentId: 'settings:workspace', label: 'Import', action: 'import-workspace', radius: 11, orbitScale: 0.86, angleOffset: -0.03 },
    { id: 'settings:workspace:recenter', parentId: 'settings:workspace', label: 'Recenter', action: 'recenter', radius: 12, orbitScale: 1.12, angleOffset: 0.05 },
    { id: 'settings:workspace:list', parentId: 'settings:workspace', label: 'Workspace view', action: 'workspace-view', radius: 12, orbitScale: 0.95, angleOffset: -0.02 }
  ];

  let surface = null;
  let closeToolButton = null;
  let chatPanelRestorePoint = null;

  function graphApi() {
    return globalThis.MemoryGraph || null;
  }

  function triggerExisting(selector) {
    const target = document.querySelector(selector);
    if (!target) return false;
    target.click();
    return true;
  }

  function openMemoryApp(focusSelector = null) {
    deactivate();
    requestAnimationFrame(() => {
      const target = document.querySelector(focusSelector || '#memoryGrid');
      target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      target?.focus?.();
    });
    return true;
  }

  function openMemoryBridge() {
    const existing = document.querySelector('[data-open-memory-bridge]');
    if (existing) return triggerExisting('[data-open-memory-bridge]');
    if (!triggerExisting('.ai-connect-button')) return false;
    requestAnimationFrame(() => triggerExisting('[data-open-memory-bridge]'));
    return true;
  }

  function openLocalModel({ preset = null, focus = null } = {}) {
    if (!triggerExisting('.ai-connect-button')) return false;
    requestAnimationFrame(() => {
      const type = document.getElementById('connectionType');
      if (preset && type) {
        type.value = preset;
        type.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.querySelector(focus || '#connectionModel')?.focus?.();
    });
    return true;
  }

  function openAiAccess({ connect = false } = {}) {
    if (!triggerExisting('.ai-access-launch')) return false;
    if (connect) requestAnimationFrame(() => triggerExisting('#aiAccessConnectExternal'));
    return true;
  }

  function openLifecycle(focusSelector = null) {
    const selected = document.querySelector('#memoryGrid .memory-card.selected[data-memory-id]');
    const firstMemory = document.querySelector('#memoryGrid .memory-card[data-memory-id]');
    const trigger = selected || firstMemory;
    if (trigger) {
      trigger.click();
      if (focusSelector) {
        requestAnimationFrame(() => {
          const target = document.querySelector(focusSelector);
          target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
          target?.focus?.();
        });
      }
      return true;
    }
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = 'Add a memory to view lifecycle and history controls';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 1900);
    }
    return false;
  }

  function openProposals() {
    const panel = document.getElementById('phase2ChatPanel');
    if (!panel || chatPanelRestorePoint) return false;
    chatPanelRestorePoint = document.createComment('molecular-proposals-restore');
    panel.parentNode?.insertBefore(chatPanelRestorePoint, panel);
    document.body.appendChild(panel);
    panel.classList.add('molecular-tool-open');
    if (closeToolButton) closeToolButton.hidden = false;
    return true;
  }

  function closeToolPanel() {
    const panel = document.getElementById('phase2ChatPanel');
    if (panel && chatPanelRestorePoint?.parentNode) {
      chatPanelRestorePoint.parentNode.insertBefore(panel, chatPanelRestorePoint);
      chatPanelRestorePoint.remove();
      panel.classList.remove('molecular-tool-open');
      panel.classList.remove('molecular-chat-open');
    }
    chatPanelRestorePoint = null;
    if (closeToolButton) closeToolButton.hidden = true;
  }

  function handleControlAction(event) {
    const action = String(event.detail?.action || '');
    if (action === 'open-memories') openMemoryApp('#memoryGrid');
    else if (action === 'open-groups') openMemoryApp('#memoryGraphSurface');
    else if (action === 'open-memory-search') openMemoryApp('#searchInput');
    else if (action === 'open-memory-app') openMemoryApp();
    else if (action === 'open-ai-access') openAiAccess();
    else if (action === 'connect-ai-app') openAiAccess({ connect: true });
    else if (action === 'open-memory-bridge') openMemoryBridge();
    else if (action === 'local-preset-ollama') openLocalModel({ preset: 'ollama', focus: '#connectionModel' });
    else if (action === 'local-preset-lmstudio') openLocalModel({ preset: 'lmstudio', focus: '#connectionModel' });
    else if (action === 'local-preset-custom') openLocalModel({ preset: 'custom', focus: '#connectionEndpoint' });
    else if (action === 'local-focus-endpoint') openLocalModel({ focus: '#connectionEndpoint' });
    else if (action === 'local-focus-model') openLocalModel({ focus: '#connectionModel' });
    else if (action === 'open-context') triggerExisting('#contextButton');
    else if (action === 'copy-context') {
      triggerExisting('#contextButton');
      requestAnimationFrame(() => triggerExisting('#copyContextButton'));
    }
    else if (action === 'open-lifecycle') openLifecycle();
    else if (action === 'lifecycle-lock') openLifecycle('#detailContent [data-action="toggle-lock"]');
    else if (action === 'lifecycle-history') openLifecycle('#detailContent [data-memory-history]');
    else if (action === 'lifecycle-archive') openLifecycle('#detailContent [data-action="delete"]');
    else if (action === 'open-proposals') openProposals();
    else if (action === 'add-memory') triggerExisting('#newMemoryButton');
    else if (action === 'export-workspace') triggerExisting('#exportButton');
    else if (action === 'import-workspace') triggerExisting('#importInput');
    else if (action === 'recenter') graphApi()?.focusSpace?.({ animate: true, scale: HOME_SCALE });
    else if (action === 'workspace-view') deactivate();
  }

  function updateParallax(event) {
    if (!surface || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rect = surface.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 12;
    const y = ((event.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 9;
    surface.style.setProperty('--molecular-parallax-x', `${x.toFixed(2)}px`);
    surface.style.setProperty('--molecular-parallax-y', `${y.toFixed(2)}px`);
  }

  function resetParallax() {
    surface?.style.removeProperty('--molecular-parallax-x');
    surface?.style.removeProperty('--molecular-parallax-y');
  }

  function activate() {
    if (!surface) return false;
    document.body.classList.add('molecular-view-active');
    requestAnimationFrame(() => {
      graphApi()?.refresh?.();
      graphApi()?.focusSpace?.({ animate: false, scale: HOME_SCALE });
    });
    return true;
  }

  function deactivate() {
    closeToolPanel();
    graphApi()?.collapsePresentationControls?.();
    document.body.classList.remove('molecular-view-active');
    requestAnimationFrame(() => graphApi()?.refresh?.());
    return true;
  }

  function mount() {
    surface = document.getElementById('memoryGraphSurface');
    if (!surface || !graphApi()?.registerPresentationControls) return false;

    const hud = document.createElement('div');
    hud.className = 'molecular-hud';
    hud.innerHTML = '<strong>Universal Space</strong><span>Graph View</span>';
    document.body.appendChild(hud);

    // Product chrome only: these buttons route to existing application surfaces.
    const icon = path => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
    const icons = {
      graph: icon('<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m11 7-5 9m7-9 5 9M7 18h10"/>'),
      memories: icon('<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 3h6v4H9zM9 12h6m-6 4h4"/>'),
      chat: icon('<path d="M20 11a8 8 0 0 1-8 8H5l-3 2 1-6a8 8 0 1 1 17-4Z"/><path d="M8 10h8m-8 4h5"/>'),
      search: icon('<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>'),
      add: icon('<path d="M12 5v14M5 12h14"/>'),
      context: icon('<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18"/>'),
      settings: icon('<circle cx="12" cy="12" r="3"/><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z"/>')
    };
    const shell = document.createElement('header');
    shell.className = 'universe-header';
    shell.innerHTML = `<div class="universe-brand"><span class="universe-mark" aria-hidden="true">M</span><span><strong>Memory Space</strong><small>UNIVERSAL SPACE</small></span></div><nav aria-label="Universe navigation"><button type="button" data-shell-action="graph" aria-label="Graph" aria-current="page">${icons.graph}<span>Graph</span></button><button type="button" data-shell-action="memories" aria-label="Memories">${icons.memories}<span>Memories</span></button><button type="button" data-shell-action="chat" aria-label="AI Chat">${icons.chat}<span>AI Chat</span></button><button type="button" data-shell-action="search" aria-label="Search">${icons.search}<span>Search</span></button></nav><button type="button" class="universe-resident" data-shell-action="orb"><span class="resident-dot" aria-hidden="true"></span><span><strong>Orb &middot; <span data-resident-state>Ready</span></strong><small>Resident intelligence</small></span></button>`;
    const rail = document.createElement('nav');
    rail.className = 'universe-rail';
    rail.setAttribute('aria-label', 'Workspace tools');
    rail.innerHTML = `<span class="rail-caption" aria-hidden="true">U / S</span><button type="button" data-shell-action="add" aria-label="Add memory" title="Add memory">${icons.add}</button><button type="button" data-shell-action="context" aria-label="View AI context" title="View AI context">${icons.context}</button><button type="button" data-shell-action="settings" aria-label="AI access and connections" title="AI access and connections">${icons.settings}</button><span class="rail-foot" aria-hidden="true">&#10022;</span>`;
    const actions = {
      graph: () => closeToolPanel(),
      memories: () => openMemoryApp(),
      search: () => openMemoryApp('#searchInput'),
      chat: () => { closeToolPanel(); openProposals(); document.getElementById('phase2ChatPanel')?.classList.add('molecular-chat-open'); document.getElementById('chatInput')?.focus(); },
      orb: () => { const card = document.querySelector('.orb-card'); if (card) card.open = true; document.getElementById('orbRequestInput')?.focus(); },
      add: () => triggerExisting('#newMemoryButton'),
      context: () => triggerExisting('#contextButton'),
      settings: () => openAiAccess()
    };
    for (const element of [shell, rail]) {
      element.addEventListener('click', event => {
        const action = event.target.closest('[data-shell-action]')?.dataset.shellAction;
        actions[action]?.();
      });
    }
    document.addEventListener('orb-presentation-state', event => {
      shell.querySelector('[data-resident-state]').textContent = event.detail.label;
      shell.querySelector('.universe-resident').dataset.state = event.detail.state;
    });
    document.body.append(shell, rail);

    closeToolButton = document.createElement('button');
    closeToolButton.type = 'button';
    closeToolButton.className = 'molecular-close-tool';
    closeToolButton.textContent = 'Close overlay';
    closeToolButton.hidden = true;
    closeToolButton.addEventListener('click', closeToolPanel);
    document.body.appendChild(closeToolButton);

    graphApi().registerPresentationControls(SETTINGS_CONTROLS);
    surface.addEventListener('memory-graph-control-action', handleControlAction);
    surface.addEventListener('memory-graph-home', closeToolPanel);
    surface.addEventListener('pointermove', updateParallax, { passive: true });
    surface.addEventListener('pointerleave', resetParallax, { passive: true });
    activate();
    return true;
  }

  globalThis.MolecularView = Object.freeze({ activate, deactivate, close: closeToolPanel });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
