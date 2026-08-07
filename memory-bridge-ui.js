(() => {
  'use strict';

  const STORAGE_KEY = 'memory-ai-bridges-v1';
  let restoreStarted = false;

  function loadBridges() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveBridges(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function providerId(id) {
    return `memory-bridge:${id}`;
  }

  function ready() {
    return Boolean(globalThis.MemoryAI && globalThis.MemoryBridge);
  }

  function restore() {
    if (restoreStarted) return;
    if (!ready()) {
      setTimeout(restore, 25);
      return;
    }
    restoreStarted = true;
    for (const bridge of loadBridges()) register(bridge, false);
  }

  function register(bridge, select = true) {
    try {
      globalThis.MemoryBridge.registerBridge({
        id: providerId(bridge.id),
        name: bridge.name,
        baseUrl: bridge.baseUrl,
        token: bridge.token
      });
      if (select) globalThis.MemoryAI.setActiveProvider(providerId(bridge.id));
    } catch (error) {
      console.error('Could not register Memory Bridge:', error);
      toast(error?.message || 'Could not register Memory Bridge');
    }
  }

  function observeConnectionDialog() {
    const mount = () => {
      const dialog = document.getElementById('aiConnectionDialog');
      const list = dialog?.querySelector('#connectionList');
      if (!dialog || !list || dialog.querySelector('[data-open-memory-bridge]')) return;

      const entry = document.createElement('div');
      entry.className = 'memory-bridge-entry';
      entry.innerHTML = `
        <div>
          <strong>Another machine?</strong>
          <small>Pair this Memory Space with a trusted PC or server running Memory Bridge.</small>
        </div>
        <button type="button" data-open-memory-bridge>Memory Bridge</button>`;
      list.insertAdjacentElement('afterend', entry);
      entry.querySelector('button')?.addEventListener('click', openBridgeDialog);
    };

    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function buildBridgeDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'memoryBridgeDialog';
    dialog.className = 'connection-dialog memory-bridge-dialog';
    dialog.innerHTML = `
      <div class="connection-dialog-inner">
        <div class="modal-header">
          <div>
            <p class="eyebrow">Remote-local AI</p>
            <h2>Pair a Memory Bridge</h2>
          </div>
          <button class="icon-button" type="button" data-bridge-close aria-label="Close">×</button>
        </div>

        <div id="memoryBridgeList" class="connection-list"></div>

        <form id="memoryBridgeForm" class="connection-form">
          <label>
            Connection name
            <input id="memoryBridgeName" maxlength="60" required value="My Memory Bridge">
          </label>
          <label>
            HTTPS bridge URL
            <input id="memoryBridgeUrl" type="url" inputmode="url" autocomplete="off" required placeholder="https://bridge.example.com">
          </label>
          <label>
            Pairing token
            <input id="memoryBridgeToken" type="password" autocomplete="off" required placeholder="Pairing secret from the bridge machine">
          </label>

          <div class="connection-help">
            <strong>Privacy boundary:</strong> Test sends no workspace memory. During real chat, only the current context package already approved by the Memory Space firewall is sent to this bridge. The bridge does not become the owner of your workspace.
          </div>

          <div class="connection-form-actions">
            <button type="button" class="ghost-button" data-bridge-close>Cancel</button>
            <button type="button" class="ghost-button" data-bridge-test-form>Test pairing</button>
            <button type="submit" class="primary-button">Save & use</button>
          </div>
        </form>
      </div>`;

    dialog.addEventListener('click', handleDialogClick);
    dialog.querySelector('#memoryBridgeForm')?.addEventListener('submit', saveFromForm);
    document.body.appendChild(dialog);
    return dialog;
  }

  function openBridgeDialog() {
    const parent = document.getElementById('aiConnectionDialog');
    if (parent?.open) parent.close();
    const dialog = document.getElementById('memoryBridgeDialog') || buildBridgeDialog();
    renderBridgeList(dialog);
    dialog.showModal();
  }

  function readForm(dialog) {
    const name = dialog.querySelector('#memoryBridgeName')?.value.trim();
    const baseUrl = dialog.querySelector('#memoryBridgeUrl')?.value.trim();
    const token = dialog.querySelector('#memoryBridgeToken')?.value;
    if (!name || !baseUrl || !token) {
      toast('Enter a name, HTTPS bridge URL, and pairing token');
      return null;
    }
    return { name, baseUrl, token };
  }

  async function testPairing(bridge, button) {
    if (!ready()) return false;
    const original = button?.textContent || 'Test pairing';
    if (button) {
      button.disabled = true;
      button.textContent = 'Testing…';
    }
    try {
      const info = await globalThis.MemoryBridge.testBridge(bridge);
      toast(`Paired with ${info.name || 'Memory Bridge'} · ${info.model || 'model ready'}`);
      if (button) button.textContent = 'Passed';
      setTimeout(() => {
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
      }, 1400);
      return true;
    } catch (error) {
      console.error('Memory Bridge test failed:', error);
      toast(error?.message || 'Memory Bridge pairing failed');
      if (button) {
        button.disabled = false;
        button.textContent = 'Failed';
        setTimeout(() => { button.textContent = original; }, 1800);
      }
      return false;
    }
  }

  function saveFromForm(event) {
    event.preventDefault();
    const dialog = event.currentTarget.closest('dialog');
    const values = readForm(dialog);
    if (!values) return;
    const bridge = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ...values,
      createdAt: new Date().toISOString()
    };
    const items = loadBridges();
    items.push(bridge);
    saveBridges(items);
    register(bridge, true);
    renderBridgeList(dialog);
    event.currentTarget.reset();
    dialog.querySelector('#memoryBridgeName').value = 'My Memory Bridge';
    toast(`${bridge.name} saved and selected`);
  }

  function handleDialogClick(event) {
    const dialog = event.currentTarget;
    if (event.target.closest('[data-bridge-close]')) {
      dialog.close();
      return;
    }

    const formTest = event.target.closest('[data-bridge-test-form]');
    if (formTest) {
      const bridge = readForm(dialog);
      if (bridge) testPairing(bridge, formTest);
      return;
    }

    const rowTest = event.target.closest('[data-bridge-test]');
    if (rowTest) {
      const bridge = loadBridges().find((item) => item.id === rowTest.dataset.bridgeTest);
      if (bridge) testPairing(bridge, rowTest);
      return;
    }

    const use = event.target.closest('[data-bridge-use]');
    if (use) {
      const bridge = loadBridges().find((item) => item.id === use.dataset.bridgeUse);
      if (!bridge) return;
      register(bridge, true);
      dialog.close();
      toast(`Using ${bridge.name}`);
      return;
    }

    const remove = event.target.closest('[data-bridge-remove]');
    if (remove) {
      const id = remove.dataset.bridgeRemove;
      const bridge = loadBridges().find((item) => item.id === id);
      if (!bridge || !confirm(`Remove “${bridge.name}” from this browser?`)) return;
      if (globalThis.MemoryAI?.getActiveProviderId?.() === providerId(id)) {
        globalThis.MemoryAI.setActiveProvider('browser-local');
      }
      saveBridges(loadBridges().filter((item) => item.id !== id));
      renderBridgeList(dialog);
      toast('Memory Bridge removed');
    }
  }

  function renderBridgeList(dialog) {
    const container = dialog.querySelector('#memoryBridgeList');
    if (!container) return;
    const items = loadBridges();
    if (!items.length) {
      container.innerHTML = '<div class="connection-empty">No Memory Bridges paired on this browser yet.</div>';
      return;
    }
    container.innerHTML = items.map((bridge) => `
      <div class="connection-row">
        <div>
          <strong>${escapeHtml(bridge.name)}</strong>
          <small>${escapeHtml(bridge.baseUrl)}</small>
        </div>
        <div class="connection-row-actions">
          <button type="button" data-bridge-test="${escapeHtml(bridge.id)}">Test</button>
          <button type="button" data-bridge-use="${escapeHtml(bridge.id)}">Use</button>
          <button type="button" class="danger" data-bridge-remove="${escapeHtml(bridge.id)}">Remove</button>
        </div>
      </div>`).join('');
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  restore();
  observeConnectionDialog();
})();
