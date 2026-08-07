(() => {
  'use strict';

  const BRIDGE_STORAGE_KEY = 'memory-ai-bridges-v1';
  const PROTOCOL_VERSION = '2026-07-28';

  function loadBridges() {
    try {
      const value = JSON.parse(localStorage.getItem(BRIDGE_STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function bridgeForRow(row) {
    const button = row?.querySelector('[data-bridge-test]');
    const id = button?.dataset.bridgeTest;
    if (!id) return null;
    return loadBridges().find((bridge) => bridge.id === id) || null;
  }

  function setStatus(row, message, tone = 'neutral') {
    const status = row?.querySelector('[data-bridge-status]');
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async function rpc(bridge, id, method, params = {}) {
    const baseUrl = String(bridge?.baseUrl || '').trim().replace(/\/+$/, '');
    const token = String(bridge?.token || '');
    if (!baseUrl || !token) throw new Error('Bridge URL or pairing token is missing');

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Memory-Bridge-Protocol': 'memory-space-bridge/1'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || `MCP returned HTTP ${response.status}`);
    if (data?.error) throw new Error(data.error.message || 'MCP request failed');
    return data?.result;
  }

  async function runSelfTest(row, button) {
    const bridge = bridgeForRow(row);
    if (!bridge) {
      setStatus(row, 'MCP test failed · saved bridge not found', 'error');
      return;
    }

    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'MCP…';
    setStatus(row, 'MCP self-test · authenticating and discovering tools…');

    try {
      const initialized = await rpc(bridge, 1, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'memory-space-browser-self-test', version: '1.0.0' }
      });

      const toolsResult = await rpc(bridge, 2, 'tools/list', {});
      const tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
      if (!tools.length) throw new Error('MCP connected but returned no tools');

      const contextResult = await rpc(bridge, 3, 'tools/call', {
        name: 'get_current_space_context',
        arguments: {}
      });
      const text = contextResult?.content?.find?.((item) => item?.type === 'text')?.text || '';
      if (!text.includes('SPACE:')) throw new Error('MCP tools work, but no shared workspace context was returned');

      const protocol = initialized?.protocolVersion || PROTOCOL_VERSION;
      setStatus(row, `MCP verified · ${tools.length} tools · shared workspace readable · ${protocol}`, 'success');
      button.textContent = 'Passed';
    } catch (error) {
      console.error('MCP self-test failed:', error);
      setStatus(row, error?.message || 'MCP self-test failed', 'error');
      button.textContent = 'Failed';
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 1800);
    }
  }

  function decorate() {
    document.querySelectorAll('.memory-bridge-row').forEach((row) => {
      const actions = row.querySelector('.connection-row-actions');
      if (!actions || actions.querySelector('[data-mcp-self-test]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.mcpSelfTest = '1';
      button.textContent = 'MCP Test';
      button.addEventListener('click', () => runSelfTest(row, button));
      const remove = actions.querySelector('[data-bridge-remove]');
      actions.insertBefore(button, remove || null);
    });
  }

  function mount() {
    decorate();
    const observer = new MutationObserver(decorate);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();