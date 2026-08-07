(() => {
  'use strict';

  const STORAGE_KEY = 'memory-ai-bridges-v1';
  const WORKSPACE_KEY = 'memory-space-v1';
  const CHAT_KEY = 'memory-space-chat-v1';
  const bridgeStatuses = new Map();
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

  function setBridgeStatus(dialog, bridgeId, message, tone = 'neutral') {
    bridgeStatuses.set(bridgeId, { message, tone });
    const el = dialog?.querySelector(`[data-bridge-status="${CSS.escape(bridgeId)}"]`);
    if (!el) return;
    el.textContent = message;
    el.dataset.tone = tone;
  }

  function buildSharedActiveSpace() {
    let workspace;
    try {
      workspace = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
    } catch {
      workspace = null;
    }
    if (!workspace || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.memories)) {
      throw new Error('Memory Space workspace is unavailable');
    }
    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    if (!space) throw new Error('No active Memory Space to share');

    const memories = workspace.memories.filter((memory) =>
      memory.spaceId === space.id && String(memory.status || 'confirmed') === 'confirmed'
    );

    return {
      version: Number(workspace.version || 1),
      activeSpaceId: space.id,
      spaces: [{ ...space }],
      memories: memories.map((memory) => ({ ...memory }))
    };
  }

  async function shareActiveSpace(bridge, button) {
    if (!ready()) return;
    const dialog = button?.closest('dialog');
    const original = button?.textContent || 'Share';
    if (button) {
      button.disabled = true;
      button.textContent = 'Sharing…';
    }
    try {
      const workspace = buildSharedActiveSpace();
      const result = await globalThis.MemoryBridge.publishWorkspace(bridge, workspace);
      const count = result.memoryCount ?? workspace.memories.length;
      const spaceName = workspace.spaces[0]?.name || workspace.activeSpaceId;
      setBridgeStatus(dialog, bridge.id, `Shared ${spaceName} · ${count} confirmed memories · MCP ready`, 'success');
      toast(`Shared ${count} confirmed memories · RAM only`);
      if (button) button.textContent = 'Shared';
      setTimeout(() => {
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
      }, 1600);
    } catch (error) {
      console.error('Could not share active Memory Space:', error);
      setBridgeStatus(dialog, bridge.id, error?.message || 'Could not share active Memory Space', 'error');
      toast(error?.message || 'Could not share active Memory Space');
      if (button) {
        button.disabled = false;
        button.textContent = 'Failed';
        setTimeout(() => { button.textContent = original; }, 1800);
      }
    }
  }

  function mergeExternalProposals(proposals) {
    if (!Array.isArray(proposals) || !proposals.length) return 0;
    let chatState;
    try {
      chatState = JSON.parse(localStorage.getItem(CHAT_KEY) || 'null');
    } catch {
      chatState = null;
    }
    if (!chatState || !Array.isArray(chatState.messages) || !Array.isArray(chatState.proposals)) {
      chatState = { version: 1, messages: [], proposals: [] };
    }

    const existing = new Set(chatState.proposals.map((item) => item.id));
    let added = 0;
    for (const proposal of proposals) {
      if (!proposal?.id || existing.has(proposal.id)) continue;
      chatState.proposals.push({
        id: proposal.id,
        spaceId: proposal.spaceId,
        title: String(proposal.title || 'External AI proposal'),
        content: String(proposal.content || ''),
        type: proposal.type || 'note',
        importance: proposal.importance || 'normal',
        reason: proposal.reason || 'External AI suggested this as durable context.',
        sourceMessage: 'External MCP client proposal',
        sourceKind: 'external-mcp',
        status: 'pending',
        createdAt: proposal.createdAt || new Date().toISOString()
      });
      existing.add(proposal.id);
      added += 1;
    }
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatState));
    return added;
  }

  async function pullExternalProposals(bridge, button) {
    if (!ready()) return;
    const dialog = button?.closest('dialog');
    const original = button?.textContent || 'Pull';
    if (button) {
      button.disabled = true;
      button.textContent = 'Pulling…';
    }
    try {
      const result = await globalThis.MemoryBridge.pullExternalProposals(bridge);
      const added = mergeExternalProposals(result.proposals);
      if (!added) {
        setBridgeStatus(dialog, bridge.id, 'MCP connected · no new external AI proposals', 'success');
        toast('No new external AI proposals');
        if (button) {
          button.disabled = false;
          button.textContent = original;
        }
        return;
      }
      setBridgeStatus(dialog, bridge.id, `${added} external AI proposal${added === 1 ? '' : 's'} pulled for review`, 'success');
      toast(`${added} external AI proposal${added === 1 ? '' : 's'} added for review`);
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      console.error('Could not pull external proposals:', error);
      setBridgeStatus(dialog, bridge.id, error?.message || 'Could not pull external proposals', 'error');
      toast(error?.message || 'Could not pull external proposals');
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  async function copyMcpUrl(bridge, button) {
    const dialog = button?.closest('dialog');
    const url = `${String(bridge.baseUrl || '').replace(/\/+$/, '')}/mcp`;
    try {
      await navigator.clipboard.writeText(url);
      setBridgeStatus(dialog, bridge.id, `MCP URL copied · ${url}`, 'success');
      toast('MCP URL copied');
    } catch (error) {
      console.error('Could not copy MCP URL:', error);
      setBridgeStatus(dialog, bridge.id, `MCP endpoint · ${url}`, 'neutral');
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
            <strong>Privacy boundary:</strong> Pairing sends no workspace memory. Chat sends only the focused context package. Sharing with external AI tools is a separate explicit action and publishes only the active space's current confirmed memories to bridge RAM; the bridge does not write that snapshot to disk.
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
    const dialog = button?.closest('dialog');
    const original = button?.textContent || 'Test pairing';
    if (button) {
      button.disabled = true;
      button.textContent = 'Testing…';
    }
    try {
      const info = await globalThis.MemoryBridge.testBridge(bridge);
      setBridgeStatus(dialog, bridge.id, `Paired · ${info.model || 'model ready'} · MCP ${String(bridge.baseUrl || '').replace(/\/+$/, '')}/mcp`, 'success');
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
      setBridgeStatus(dialog, bridge.id, error?.message || 'Memory Bridge pairing failed', 'error');
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

    const share = event.target.closest('[data-bridge-share]');
    if (share) {
      const bridge = loadBridges().find((item) => item.id === share.dataset.bridgeShare);
      if (bridge) shareActiveSpace(bridge, share);
      return;
    }

    const pull = event.target.closest('[data-bridge-pull]');
    if (pull) {
      const bridge = loadBridges().find((item) => item.id === pull.dataset.bridgePull);
      if (bridge) pullExternalProposals(bridge, pull);
      return;
    }

    const copyMcp = event.target.closest('[data-bridge-copy-mcp]');
    if (copyMcp) {
      const bridge = loadBridges().find((item) => item.id === copyMcp.dataset.bridgeCopyMcp);
      if (bridge) copyMcpUrl(bridge, copyMcp);
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
      bridgeStatuses.delete(id);
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
    container.innerHTML = items.map((bridge) => {
      const status = bridgeStatuses.get(bridge.id) || {
        message: `MCP endpoint · ${String(bridge.baseUrl || '').replace(/\/+$/, '')}/mcp`,
        tone: 'neutral'
      };
      return `
        <div class="connection-row memory-bridge-row">
          <div>
            <strong>${escapeHtml(bridge.name)}</strong>
            <small>${escapeHtml(bridge.baseUrl)}</small>
          </div>
          <div class="connection-row-actions">
            <button type="button" data-bridge-test="${escapeHtml(bridge.id)}">Test</button>
            <button type="button" data-bridge-use="${escapeHtml(bridge.id)}">Use</button>
            <button type="button" data-bridge-share="${escapeHtml(bridge.id)}">Share</button>
            <button type="button" data-bridge-pull="${escapeHtml(bridge.id)}">Pull</button>
            <button type="button" data-bridge-copy-mcp="${escapeHtml(bridge.id)}">MCP URL</button>
            <button type="button" class="danger" data-bridge-remove="${escapeHtml(bridge.id)}">Remove</button>
          </div>
          <div class="memory-bridge-status" data-bridge-status="${escapeHtml(bridge.id)}" data-tone="${escapeHtml(status.tone)}">${escapeHtml(status.message)}</div>
        </div>`;
    }).join('');
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