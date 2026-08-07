(() => {
  'use strict';

  const STORAGE_KEY = 'memory-ai-connections-v1';
  const presets = {
    ollama: {
      label: 'Ollama',
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      name: 'Ollama local'
    },
    lmstudio: {
      label: 'LM Studio',
      endpoint: 'http://127.0.0.1:1234/v1/chat/completions',
      name: 'LM Studio local'
    },
    custom: {
      label: 'OpenAI-compatible',
      endpoint: '',
      name: 'Local model server'
    }
  };

  let mounted = false;
  let observer;
  let browserStatusSnapshot = globalThis.__memoryAIStatus
    ? { ...globalThis.__memoryAIStatus }
    : { mode: 'local', label: 'On-device browser' };

  restoreConnections();
  observeUi();
  addEventListener('memory-ai-provider-changed', syncActiveProviderStatus);

  function api() {
    return globalThis.MemoryAI || null;
  }

  function loadConnections() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveConnections(connections) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  }

  function restoreConnections() {
    const memoryAI = api();
    if (!memoryAI) {
      setTimeout(restoreConnections, 20);
      return;
    }

    for (const connection of loadConnections()) {
      registerConnection(connection, false);
    }
    queueMicrotask(syncActiveProviderStatus);
  }

  function registerConnection(connection, select = true) {
    const memoryAI = api();
    if (!memoryAI) return;
    const providerId = providerIdFor(connection.id);
    try {
      memoryAI.registerOpenAICompatible({
        id: providerId,
        name: connection.name,
        endpoint: connection.endpoint,
        model: connection.model,
        local: true
      });
      if (select) memoryAI.setActiveProvider(providerId);
    } catch (error) {
      console.error('Could not register local AI connection:', error);
    }
  }

  function providerIdFor(id) {
    return `local-server:${id}`;
  }

  function observeUi() {
    const run = () => {
      mountConnectionButton();
      if (!mounted) return;
      observer?.disconnect();
    };

    run();
    if (mounted) return;
    observer = new MutationObserver(run);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function mountConnectionButton() {
    const control = document.querySelector('.ai-provider-control');
    if (!control || control.querySelector('.ai-connect-button')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ai-connect-button';
    button.textContent = 'Connect';
    button.addEventListener('click', openDialog);
    control.appendChild(button);
    mounted = true;
  }

  function openDialog() {
    let dialog = document.getElementById('aiConnectionDialog');
    if (!dialog) {
      dialog = buildDialog();
      document.body.appendChild(dialog);
    }
    renderConnectionList(dialog);
    dialog.showModal();
  }

  function buildDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'aiConnectionDialog';
    dialog.className = 'connection-dialog';
    dialog.innerHTML = `
      <div class="connection-dialog-inner">
        <div class="modal-header">
          <div>
            <p class="eyebrow">AI providers</p>
            <h2>Connect a local model</h2>
          </div>
          <button class="icon-button" type="button" data-connection-close aria-label="Close">×</button>
        </div>

        <div id="connectionList" class="connection-list"></div>

        <form id="connectionForm" class="connection-form">
          <div class="connection-form-grid">
            <label>
              Runtime
              <select id="connectionType">
                <option value="ollama">Ollama</option>
                <option value="lmstudio">LM Studio</option>
                <option value="custom">OpenAI-compatible</option>
              </select>
            </label>
            <label>
              Connection name
              <input id="connectionName" maxlength="60" required>
            </label>
          </div>

          <label>
            Chat endpoint
            <input id="connectionEndpoint" type="url" inputmode="url" required autocomplete="off">
          </label>

          <label>
            Model name
            <input id="connectionModel" maxlength="120" required placeholder="Example: gemma3:4b">
          </label>

          <div class="connection-help">
            <strong>Local-first:</strong> no API key is stored here. Ollama and LM Studio run the model on your own machine. The browser still needs permission to reach the local server, and that server must allow this site's origin. Phone-to-PC connections may need a secure local bridge later; the on-device browser model remains the mobile fallback.
          </div>

          <div class="connection-form-actions">
            <button type="button" class="ghost-button" data-connection-close>Cancel</button>
            <button type="submit" class="primary-button">Save & use</button>
          </div>
        </form>
      </div>`;

    const type = dialog.querySelector('#connectionType');
    const name = dialog.querySelector('#connectionName');
    const endpoint = dialog.querySelector('#connectionEndpoint');
    const form = dialog.querySelector('#connectionForm');

    applyPreset(type.value, name, endpoint);
    type.addEventListener('change', () => applyPreset(type.value, name, endpoint));
    form.addEventListener('submit', saveConnectionFromForm);
    dialog.addEventListener('click', handleDialogClick);
    return dialog;
  }

  function applyPreset(type, nameInput, endpointInput) {
    const preset = presets[type] || presets.custom;
    nameInput.value = preset.name;
    endpointInput.value = preset.endpoint;
  }

  function saveConnectionFromForm(event) {
    event.preventDefault();
    const dialog = event.currentTarget.closest('dialog');
    const type = dialog.querySelector('#connectionType').value;
    const name = dialog.querySelector('#connectionName').value.trim();
    const endpoint = dialog.querySelector('#connectionEndpoint').value.trim();
    const model = dialog.querySelector('#connectionModel').value.trim();
    if (!name || !endpoint || !model) return;

    const connection = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
      name,
      endpoint,
      model,
      createdAt: new Date().toISOString()
    };

    const connections = loadConnections();
    connections.push(connection);
    saveConnections(connections);
    registerConnection(connection, true);
    renderConnectionList(dialog);
    event.currentTarget.reset();
    const resetType = dialog.querySelector('#connectionType').value;
    applyPreset(resetType, dialog.querySelector('#connectionName'), dialog.querySelector('#connectionEndpoint'));
    toast(`${name} connected`);
  }

  function handleDialogClick(event) {
    const close = event.target.closest('[data-connection-close]');
    if (close) {
      event.currentTarget.close();
      return;
    }

    const useButton = event.target.closest('[data-connection-use]');
    if (useButton) {
      const connection = loadConnections().find((item) => item.id === useButton.dataset.connectionUse);
      if (!connection) return;
      registerConnection(connection, true);
      event.currentTarget.close();
      toast(`Using ${connection.name}`);
      return;
    }

    const deleteButton = event.target.closest('[data-connection-delete]');
    if (deleteButton) {
      const id = deleteButton.dataset.connectionDelete;
      const connection = loadConnections().find((item) => item.id === id);
      if (!connection) return;
      if (!confirm(`Remove “${connection.name}” from this browser?`)) return;
      saveConnections(loadConnections().filter((item) => item.id !== id));
      localStorage.removeItem('memory-ai-provider-v1');
      renderConnectionList(event.currentTarget);
      toast('Connection removed');
      setTimeout(() => location.reload(), 250);
    }
  }

  function renderConnectionList(dialog) {
    const container = dialog.querySelector('#connectionList');
    if (!container) return;
    const connections = loadConnections();
    if (!connections.length) {
      container.innerHTML = '<div class="connection-empty">No external local models connected yet. The built-in on-device browser provider remains available.</div>';
      return;
    }

    container.innerHTML = connections.map((connection) => `
      <div class="connection-row">
        <div>
          <strong>${escapeHtml(connection.name)}</strong>
          <small>${escapeHtml(connection.model)} · ${escapeHtml(connection.endpoint)}</small>
        </div>
        <div class="connection-row-actions">
          <button type="button" data-connection-use="${escapeHtml(connection.id)}">Use</button>
          <button type="button" class="danger" data-connection-delete="${escapeHtml(connection.id)}">Remove</button>
        </div>
      </div>`).join('');
  }

  function syncActiveProviderStatus() {
    const memoryAI = api();
    const provider = memoryAI?.getActiveProvider?.();
    if (!provider) return;

    if (provider.id === 'browser-local') {
      globalThis.__memoryAIStatus = { ...browserStatusSnapshot };
      renderProviderStatus(browserStatusSnapshot.label, browserStatusSnapshot.mode || 'local');
      return;
    }

    if (globalThis.__memoryAIStatus?.label && !String(globalThis.__memoryAIStatus.label).endsWith(' · selected')) {
      browserStatusSnapshot = { ...globalThis.__memoryAIStatus };
    }
    const label = `${provider.name} · selected`;
    globalThis.__memoryAIStatus = { mode: 'local', label };
    renderProviderStatus(label, 'local');
  }

  function renderProviderStatus(label, mode) {
    const status = document.getElementById('aiStatus');
    if (!status) return;
    status.classList.toggle('busy', mode === 'busy');
    status.classList.toggle('provider-error', mode === 'error');
    status.classList.toggle('local-provider', mode !== 'error');
    status.innerHTML = `<span></span> ${escapeHtml(label)}`;
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 1800);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
})();
