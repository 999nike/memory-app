(() => {
  'use strict';

  const BRIDGES_KEY = 'memory-ai-bridges-v1';
  const CODE_PREFIX = 'MSB1.';

  function loadBridges() {
    try {
      const value = JSON.parse(localStorage.getItem(BRIDGES_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveBridges(items) {
    localStorage.setItem(BRIDGES_KEY, JSON.stringify(items));
  }

  function toast(message) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function decodePrivateAccessCode(value) {
    const text = String(value || '').trim();
    if (!text.startsWith(CODE_PREFIX)) throw new Error('That Private Access Code is not recognised. Copy it again from Memory Bridge Setup.');

    let payload = text.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    while (payload.length % 4) payload += '=';

    let config;
    try {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      config = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('That Private Access Code could not be read. Copy the full code and try again.');
    }

    const baseUrl = String(config?.baseUrl || '').trim().replace(/\/+$/, '');
    const token = String(config?.token || '');
    const name = String(config?.name || 'My Memory Bridge').trim() || 'My Memory Bridge';
    if (Number(config?.version) !== 1 || !baseUrl.startsWith('https://') || !token) {
      throw new Error('That Private Access Code is incomplete or from an unsupported Memory Bridge.');
    }

    return { name, baseUrl, token };
  }

  function readConnection(dialog) {
    const code = dialog.querySelector('#memoryBridgeAccessCode')?.value.trim();
    if (code) return decodePrivateAccessCode(code);

    const name = dialog.querySelector('#memoryBridgeName')?.value.trim();
    const baseUrl = dialog.querySelector('#memoryBridgeUrl')?.value.trim().replace(/\/+$/, '');
    const token = dialog.querySelector('#memoryBridgeToken')?.value;
    if (!name || !baseUrl || !token) {
      throw new Error('Paste your Private Access Code, or use Advanced manual setup.');
    }
    if (!baseUrl.startsWith('https://')) throw new Error('Advanced setup requires a secure HTTPS connection address.');
    return { name, baseUrl, token };
  }

  async function connectBridge(dialog, submitButton) {
    let values;
    try {
      values = readConnection(dialog);
    } catch (error) {
      toast(error?.message || 'Could not read connection details');
      return;
    }

    if (!globalThis.MemoryBridge?.testBridge || !globalThis.MemoryBridge?.registerBridge || !globalThis.MemoryAI?.setActiveProvider) {
      toast('Memory Bridge setup is still loading. Try again.');
      return;
    }

    const bridge = {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ...values,
      createdAt: new Date().toISOString()
    };
    const providerId = `memory-bridge:${bridge.id}`;
    const original = submitButton?.textContent || 'Connect';

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Connecting…';
    }

    try {
      const info = await globalThis.MemoryBridge.testBridge(bridge);
      const items = loadBridges();
      items.push(bridge);
      saveBridges(items);
      globalThis.MemoryBridge.registerBridge({
        id: providerId,
        name: bridge.name,
        baseUrl: bridge.baseUrl,
        token: bridge.token
      });
      globalThis.MemoryAI.setActiveProvider(providerId);
      dialog.close();
      toast(`Connected to ${info?.name || bridge.name}`);
      dispatchEvent(new CustomEvent('memory-bridge-connected', { detail: { id: bridge.id } }));
    } catch (error) {
      console.error('Memory Bridge connection failed:', error);
      toast(error?.message || 'Could not connect to Memory Bridge');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = original;
      }
    }
  }

  function prepareBridgeDialog(dialog) {
    if (!dialog || dialog.dataset.guidedBridgeSetup === '1') return;
    const form = dialog.querySelector('#memoryBridgeForm');
    const nameInput = dialog.querySelector('#memoryBridgeName');
    const urlInput = dialog.querySelector('#memoryBridgeUrl');
    const tokenInput = dialog.querySelector('#memoryBridgeToken');
    if (!form || !nameInput || !urlInput || !tokenInput) return;

    dialog.dataset.guidedBridgeSetup = '1';

    const eyebrow = dialog.querySelector('.modal-header .eyebrow');
    const heading = dialog.querySelector('.modal-header h2');
    if (eyebrow) eyebrow.textContent = 'Private connection';
    if (heading) heading.textContent = 'Connect your Memory Bridge';

    const guide = document.createElement('div');
    guide.className = 'connection-help memory-bridge-guide';
    guide.innerHTML = '<strong>On your Memory Bridge computer:</strong> open <b>Memory Bridge Setup</b> from the Start menu, choose <b>Copy private access code</b>, then paste it below.';
    form.prepend(guide);

    const codeLabel = document.createElement('label');
    codeLabel.className = 'memory-bridge-code-label';
    codeLabel.innerHTML = 'Private Access Code<input id="memoryBridgeAccessCode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste your private access code">';
    guide.insertAdjacentElement('afterend', codeLabel);

    const advanced = document.createElement('details');
    advanced.className = 'memory-bridge-manual';
    advanced.innerHTML = '<summary>Advanced manual setup</summary><div class="memory-bridge-manual-body"></div>';
    codeLabel.insertAdjacentElement('afterend', advanced);
    const manualBody = advanced.querySelector('.memory-bridge-manual-body');

    [nameInput, urlInput, tokenInput].forEach((input) => {
      input.required = false;
      const label = input.closest('label');
      if (label) manualBody.appendChild(label);
    });

    const testButton = form.querySelector('[data-bridge-test-form]');
    if (testButton) {
      testButton.textContent = 'Test manual connection';
      manualBody.appendChild(testButton);
    }

    const help = form.querySelector('.connection-help:not(.memory-bridge-guide)');
    if (help) {
      help.innerHTML = '<strong>Your control:</strong> this code pairs only this browser with your bridge. It does not copy your Memory Space to the bridge. Confirmed memory stays under your control.';
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.textContent = 'Connect';

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      connectBridge(dialog, submit);
    }, true);
  }

  function waitForBridgeButton(attempts = 20) {
    const button = document.querySelector('[data-open-memory-bridge]');
    if (button) {
      button.click();
      return;
    }
    if (attempts <= 0) {
      toast('Memory Bridge setup is still loading. Try again.');
      return;
    }
    setTimeout(() => waitForBridgeButton(attempts - 1), 25);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('#aiAccessConnectExternal');
    if (!button || loadBridges().length) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const aiAccessDialog = button.closest('dialog');
    aiAccessDialog?.close();

    const oldButton = document.querySelector('.ai-connect-button');
    if (!oldButton) {
      toast('Connection setup is still loading. Try again.');
      return;
    }

    oldButton.click();
    waitForBridgeButton();
  }, true);

  const observer = new MutationObserver(() => {
    prepareBridgeDialog(document.getElementById('memoryBridgeDialog'));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  prepareBridgeDialog(document.getElementById('memoryBridgeDialog'));
})();
