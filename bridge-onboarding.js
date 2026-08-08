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
      const code = dialog.querySelector('#memoryBridgeAccessCode')?.value.trim();
      if (code) {
        try {
          const config = decodePrivateAccessCode(code);
          nameInput.value = config.name;
          urlInput.value = config.baseUrl;
          tokenInput.value = config.token;
          return;
        } catch (error) {
          event.preventDefault();
          event.stopImmediatePropagation();
          toast(error?.message || 'Could not read that Private Access Code');
          return;
        }
      }

      if (!nameInput.value.trim() || !urlInput.value.trim() || !tokenInput.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toast('Paste your Private Access Code, or use Advanced manual setup.');
      }
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
