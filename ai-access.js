(() => {
  'use strict';

  const WORKSPACE_KEY = 'memory-space-v1';
  const BRIDGES_KEY = 'memory-ai-bridges-v1';
  let observer;
  let externalStatusRequest = 0;

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function activeSpaceName() {
    const workspace = loadJson(WORKSPACE_KEY, null);
    if (!workspace || !Array.isArray(workspace.spaces)) return 'Memory Space';
    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    return String(space?.name || 'Memory Space');
  }

  function loadBridges() {
    const bridges = loadJson(BRIDGES_KEY, []);
    return Array.isArray(bridges) ? bridges : [];
  }

  function activeBridge() {
    const bridges = loadBridges();
    if (!bridges.length) return null;

    const activeId = globalThis.MemoryAI?.getActiveProviderId?.() || '';
    if (String(activeId).startsWith('memory-bridge:')) {
      const id = String(activeId).slice('memory-bridge:'.length);
      const match = bridges.find((bridge) => bridge.id === id);
      if (match) return match;
    }

    // With multiple saved customer connections, guessing the first bridge can
    // expose or revoke the wrong customer's OAuth grants. Fail closed until
    // the user selects the intended Memory Bridge.
    return bridges.length === 1 ? bridges[0] : null;
  }

  function mountControl() {
    const control = document.querySelector('.ai-provider-control');
    if (!control) return false;

    control.classList.add('ai-access-mounted');
    if (control.querySelector('.ai-access-launch')) return true;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-access-launch';
    button.textContent = 'AI Access';
    button.addEventListener('click', openDialog);
    control.appendChild(button);
    return true;
  }

  function observeControl() {
    if (mountControl()) return;
    observer = new MutationObserver(() => {
      if (!mountControl()) return;
      observer?.disconnect();
      observer = null;
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function ensureDialog() {
    let dialog = document.getElementById('aiAccessDialog');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.id = 'aiAccessDialog';
    dialog.className = 'ai-access-dialog';
    dialog.innerHTML = `
      <div class="ai-access-inner">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Your permissions</p>
            <h2>AI Access</h2>
          </div>
          <button class="icon-button" type="button" data-ai-access-close aria-label="Close">×</button>
        </div>

        <p class="ai-access-intro">Choose how AI can work with this Space. Your confirmed memory stays under your control, and AI can only suggest lasting changes for you to approve.</p>

        <div class="ai-access-space">
          <span>Current Space</span>
          <strong id="aiAccessSpaceName">Memory Space</strong>
        </div>

        <section class="ai-access-section">
          <div class="ai-access-section-heading">
            <div>
              <h3>AI in this app</h3>
              <p>Choose which available AI handles the Shared Chat.</p>
            </div>
          </div>
          <div class="ai-access-list" id="aiAccessProviderList"></div>
        </section>

        <section class="ai-access-section">
          <div class="ai-access-section-heading">
            <div>
              <h3>External AI apps</h3>
              <p>Use the same Space from another AI without rebuilding your memory.</p>
            </div>
          </div>
          <div class="ai-access-provider-chips" aria-label="Verified compatible AI apps">
            <span>Grok</span><span>Mistral</span><span>Claude</span><span>Cursor</span>
          </div>
          <div class="ai-access-external-status" id="aiAccessExternalStatus"></div>
          <div class="ai-access-list" id="aiAccessAuthorizedList"></div>
          <button type="button" class="primary-button" id="aiAccessConnectExternal">Connect AI app</button>
        </section>

        <details class="ai-access-advanced">
          <summary>Advanced</summary>
          <div class="ai-access-advanced-body">
            <p>The current developer connection controls are kept here while the final one-click provider handoff is being built.</p>
            <button type="button" class="ai-access-secondary-button" id="aiAccessOpenAdvanced">Open connection setup</button>
          </div>
        </details>
      </div>`;

    dialog.addEventListener('click', handleDialogClick);
    dialog.querySelector('#aiAccessProviderList')?.addEventListener('click', handleProviderClick);
    dialog.querySelector('#aiAccessAuthorizedList')?.addEventListener('click', handleExternalClientClick);
    dialog.querySelector('#aiAccessConnectExternal')?.addEventListener('click', connectExternal);
    dialog.querySelector('#aiAccessOpenAdvanced')?.addEventListener('click', openAdvancedSetup);
    document.body.appendChild(dialog);
    return dialog;
  }

  function openDialog() {
    const dialog = ensureDialog();
    render(dialog);
    dialog.showModal();
  }

  function render(dialog) {
    const spaceName = dialog.querySelector('#aiAccessSpaceName');
    if (spaceName) spaceName.textContent = activeSpaceName();
    renderProviders(dialog);
    renderExternalStatus(dialog);
  }

  function renderProviders(dialog) {
    const list = dialog.querySelector('#aiAccessProviderList');
    if (!list) return;

    const memoryAI = globalThis.MemoryAI;
    if (!memoryAI?.listProviders) {
      list.innerHTML = '<div class="connection-empty">AI providers are still loading…</div>';
      return;
    }

    const providers = memoryAI.listProviders();
    const activeId = memoryAI.getActiveProviderId?.();
    if (!providers.length) {
      list.innerHTML = '<div class="connection-empty">No AI is available in this browser yet.</div>';
      return;
    }

    list.innerHTML = providers.map((provider) => {
      const active = provider.id === activeId;
      const copy = providerCopy(provider);
      return `
        <div class="ai-access-card">
          <div class="ai-access-card-copy">
            <strong>${escapeHtml(copy.name)}</strong>
            <small>${escapeHtml(copy.description)}</small>
          </div>
          <div class="ai-access-card-actions">
            <span class="ai-access-badge ${active ? 'active' : 'ready'}">${active ? 'In use' : 'Ready'}</span>
            <button type="button" data-ai-access-use="${escapeAttr(provider.id)}" ${active ? 'disabled' : ''}>${active ? 'Using' : 'Use'}</button>
          </div>
        </div>`;
    }).join('');
  }

  function providerCopy(provider) {
    if (provider.id === 'browser-local') {
      return {
        name: 'On-device AI',
        description: 'Private AI available directly in this browser. It uses the current Space context.'
      };
    }
    if (provider.kind === 'memory-bridge') {
      return {
        name: provider.name || 'Private computer',
        description: 'Your private computer or server is connected for AI chat.'
      };
    }
    if (provider.kind === 'openai-compatible') {
      return {
        name: provider.name || 'Local AI',
        description: 'A local AI model connection saved on this device.'
      };
    }
    return {
      name: provider.name || 'AI provider',
      description: provider.local ? 'Available through a private/local connection.' : 'Available to this Space.'
    };
  }

  async function renderExternalStatus(dialog) {
    const status = dialog.querySelector('#aiAccessExternalStatus');
    const list = dialog.querySelector('#aiAccessAuthorizedList');
    const button = dialog.querySelector('#aiAccessConnectExternal');
    if (!status || !list || !button) return;

    const requestId = ++externalStatusRequest;
    const bridges = loadBridges();
    button.disabled = false;
    if (!bridges.length) {
      status.classList.remove('ready');
      status.textContent = 'External AI access has not been set up on this device yet. Your on-device AI still works normally.';
      list.innerHTML = '';
      button.textContent = 'Set up external access';
      return;
    }

    const bridge = activeBridge();
    if (!bridge) {
      status.classList.remove('ready');
      status.textContent = 'More than one private Memory Bridge connection is saved. Choose the Memory Bridge for this Space above before managing external AI access.';
      list.innerHTML = '';
      button.textContent = 'Select Memory Bridge above';
      button.disabled = true;
      return;
    }

    status.classList.add('ready');
    status.textContent = 'Checking which AI apps currently have access…';
    list.innerHTML = '';
    button.textContent = 'Connect AI app';
    if (!globalThis.MemoryBridge?.listExternalClients) {
      status.textContent = 'Private AI access is ready. Restart the updated Memory Bridge once to enable live permission controls.';
      return;
    }

    try {
      const clients = await globalThis.MemoryBridge.listExternalClients(bridge);
      if (requestId !== externalStatusRequest) return;

      if (!clients.length) {
        status.textContent = 'Private AI access is ready. No external AI app is currently authorised.';
        list.innerHTML = '';
        return;
      }

      status.textContent = `${clients.length} external AI app${clients.length === 1 ? '' : 's'} currently authorised.`;
      list.innerHTML = clients.map((client) => {
        const name = friendlyExternalName(client.clientName);
        const permissions = [
          client.canRead ? 'Read ✓' : null,
          client.canPropose ? 'Propose ✓' : null
        ].filter(Boolean).join(' · ') || 'No active memory scope';
        const durable = client.refreshTokenActive ? ' · stays connected' : '';
        return `
          <div class="ai-access-card">
            <div class="ai-access-card-copy">
              <strong>${escapeHtml(name)}</strong>
              <small>${escapeHtml(permissions)}${escapeHtml(durable)}</small>
            </div>
            <div class="ai-access-card-actions">
              <span class="ai-access-badge active">Connected</span>
              <button type="button" data-ai-access-revoke="${escapeAttr(client.clientId)}" data-ai-access-client-name="${escapeAttr(name)}">Disconnect</button>
            </div>
          </div>`;
      }).join('');
    } catch (error) {
      if (requestId !== externalStatusRequest) return;
      console.error('Could not read external AI permissions:', error);
      list.innerHTML = '';
      status.textContent = 'Private AI access is ready, but live permission status is unavailable until the updated bridge is running.';
    }
  }

  function friendlyExternalName(value) {
    const name = String(value || 'External AI').trim();
    const lower = name.toLowerCase();
    if (lower.includes('cursor')) return 'Cursor';
    if (lower.includes('claude')) return 'Claude';
    if (lower.includes('mistral')) return 'Mistral';
    if (lower.includes('grok') || lower.includes('x.ai')) return 'Grok';
    return name || 'External AI';
  }

  function handleProviderClick(event) {
    const button = event.target.closest('[data-ai-access-use]');
    if (!button || !globalThis.MemoryAI?.setActiveProvider) return;
    try {
      globalThis.MemoryAI.setActiveProvider(button.dataset.aiAccessUse);
      render(event.currentTarget.closest('dialog'));
      toast('AI changed for Shared Chat');
    } catch (error) {
      console.error(error);
      toast(error?.message || 'Could not change AI');
    }
  }

  async function handleExternalClientClick(event) {
    const button = event.target.closest('[data-ai-access-revoke]');
    if (!button) return;

    const dialog = event.currentTarget.closest('dialog');
    const bridge = activeBridge();
    const clientId = button.dataset.aiAccessRevoke;
    const name = button.dataset.aiAccessClientName || 'this AI app';
    if (!bridge) {
      toast('Select the Memory Bridge for this Space before disconnecting an AI app');
      return;
    }
    if (!clientId || !globalThis.MemoryBridge?.revokeExternalClient) return;
    if (!confirm(`Disconnect ${name} from Memory Space? It will need your approval again before it can access memory.`)) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Disconnecting…';
    try {
      const result = await globalThis.MemoryBridge.revokeExternalClient(bridge, clientId);
      toast(result?.disconnected ? `${name} disconnected` : `${name} had no live access left`);
      await renderExternalStatus(dialog);
    } catch (error) {
      console.error('Could not disconnect external AI:', error);
      toast(error?.message || `Could not disconnect ${name}`);
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function connectExternal(event) {
    const dialog = event.currentTarget.closest('dialog');
    const status = dialog?.querySelector('#aiAccessExternalStatus');
    const bridges = loadBridges();

    if (!bridges.length) {
      const oldButton = document.querySelector('.ai-connect-button');
      if (!oldButton) {
        if (status) {
          status.classList.remove('ready');
          status.textContent = 'Connection setup is still loading. Please try again.';
        }
        return;
      }
      dialog?.close();
      oldButton.click();
      return;
    }

    const bridge = activeBridge();
    if (!bridge) {
      if (status) {
        status.classList.remove('ready');
        status.textContent = 'More than one private Memory Bridge connection is saved. Choose the Memory Bridge for this Space above before connecting an external AI app.';
      }
      return;
    }

    const address = `${String(bridge.baseUrl || '').replace(/\/+$/, '')}/mcp`;
    if (!address.startsWith('https://')) {
      if (status) status.textContent = 'This saved bridge does not have a secure external connection address.';
      return;
    }

    try {
      await navigator.clipboard.writeText(address);
      if (status) {
        status.classList.add('ready');
        status.textContent = 'Connection copied. Open the AI app you want to use, add a custom connection, paste it, then approve Memory Space access.';
      }
      toast('AI connection copied');
    } catch {
      if (status) {
        status.classList.add('ready');
        status.textContent = 'Your private bridge is ready. Use Advanced connection setup if your browser blocks copying the connection.';
      }
    }
  }

  function openAdvancedSetup(event) {
    const dialog = event.currentTarget.closest('dialog');
    const oldButton = document.querySelector('.ai-connect-button');
    if (!oldButton) {
      toast('Connection setup is still loading');
      return;
    }
    dialog?.close();
    oldButton.click();
  }

  function handleDialogClick(event) {
    if (event.target.closest('[data-ai-access-close]')) {
      event.currentTarget.close();
      return;
    }
    if (event.target !== event.currentTarget) return;
    event.currentTarget.close();
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2400);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  addEventListener('memory-ai-providers-changed', () => {
    const dialog = document.getElementById('aiAccessDialog');
    if (dialog?.open) render(dialog);
  });
  addEventListener('memory-ai-provider-changed', () => {
    const dialog = document.getElementById('aiAccessDialog');
    if (dialog?.open) render(dialog);
  });
  addEventListener('storage', () => {
    const dialog = document.getElementById('aiAccessDialog');
    if (dialog?.open) render(dialog);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeControl, { once: true });
  } else {
    observeControl();
  }
})();
