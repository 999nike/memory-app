(() => {
  'use strict';

  let installed = false;
  let lastTriggerAt = 0;
  let directSenderPromise = null;

  function installTapFix() {
    const button = document.getElementById('chatSendButton');
    const form = document.getElementById('chatForm');
    if (!button || !form) return false;
    if (installed) return true;
    installed = true;

    button.type = 'button';
    button.style.position = 'relative';
    button.style.zIndex = '1';
    button.style.pointerEvents = 'auto';
    button.style.touchAction = 'manipulation';
    button.style.minWidth = '96px';
    button.style.minHeight = '48px';
    button.style.userSelect = 'none';
    button.style.webkitUserSelect = 'none';

    const submitChat = async (event) => {
      const input = document.getElementById('chatInput');
      if (!input?.value.trim()) return;

      const current = Date.now();
      if (current - lastTriggerAt < 650) return;
      lastTriggerAt = current;

      event?.preventDefault?.();
      event?.stopPropagation?.();

      const notice = document.getElementById('chatNotice');
      if (notice) {
        notice.hidden = false;
        notice.classList.remove('error');
        notice.textContent = 'Tap received — calling chat directly…';
      }

      button.textContent = 'Sending…';

      try {
        directSenderPromise ||= import('./send-direct.js?v=2');
        const module = await directSenderPromise;
        await module.sendDirect();
      } catch (error) {
        console.error('Direct send failed:', error);
        if (notice) {
          notice.hidden = false;
          notice.classList.add('error');
          notice.textContent = `Direct send error: ${error?.message || 'unknown error'}`;
        }
        button.disabled = false;
        button.textContent = 'Send';
      }
    };

    button.addEventListener('click', submitChat, true);
    button.addEventListener('pointerup', submitChat, true);
    button.addEventListener('touchend', submitChat, { capture: true, passive: false });

    document.addEventListener('pointerup', (event) => {
      if (event.pointerType && event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      const rect = button.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside) submitChat(event);
    }, true);

    return true;
  }

  function start() {
    if (installTapFix()) return;

    const observer = new MutationObserver(() => {
      if (installTapFix()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
