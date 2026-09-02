(() => {
  'use strict';

  const EMAIL_DEFINITION = Object.freeze({
    id: 'email',
    name: 'EMAIL',
    nodes: Object.freeze([
      { id: 'inbox', label: 'Inbox', stateKey: 'inboxCount', stateInLabel: false, action: 'mailbox.open', view: 'message-list', state: { title: 'Inbox', mailbox: 'INBOX' } },
      { id: 'unread', label: 'Unread', stateKey: 'unreadCount', action: 'mailbox.open', view: 'message-list', state: { title: 'Unread', mailbox: 'UNREAD' } },
      { id: 'sent', label: 'Sent', action: 'mailbox.open', view: 'message-list', state: { title: 'Sent', mailbox: 'SENT' } },
      { id: 'drafts', label: 'Drafts', stateKey: 'draftCount', action: 'mailbox.open', view: 'message-list', state: { title: 'Drafts', mailbox: 'DRAFT' } },
      { id: 'search', label: 'Search', action: 'search', view: 'message-list' },
      { id: 'compose', label: 'Compose', action: 'compose', view: 'message' },
      {
        id: 'settings', label: 'Settings', expandable: true, children: [
          { id: 'settings:account', label: 'Account', action: 'account.open', view: 'settings' },
          { id: 'settings:connection', label: 'Connection', action: 'connection.open', view: 'settings' },
          { id: 'settings:permissions', label: 'Permissions', action: 'permissions.open', view: 'settings' },
          { id: 'settings:sync', label: 'Sync', action: 'sync.open', view: 'settings' },
          { id: 'settings:disconnect', label: 'Disconnect', action: 'disconnect.open', view: 'settings' }
        ]
      },
      {
        id: 'gmail', label: 'Gmail', expandable: true, children: [
          { id: 'gmail:status', label: 'Status', stateKey: 'connectionState', stateLabel: true, action: 'account.open', view: 'settings' },
          { id: 'gmail:connect', label: 'Connect', stateKey: 'connectionAction', stateLabel: true, action: 'connect', view: 'settings' }
        ]
      }
    ]),
    actions: Object.freeze([
      'mailbox.open', 'search', 'compose', 'account.open',
      'connection.open', 'permissions.open', 'sync.open', 'disconnect.open', 'connect'
    ]),
    views: Object.freeze(['message-list', 'message', 'settings'])
  });
  const UNREAD_ACTIVITY_KEY = 'universal-space-gmail-unread-activity-v1';
  let currentSummary = Object.freeze({ connected: false });

  function readUnreadActivityState() {
    try {
      const value = JSON.parse(localStorage.getItem(UNREAD_ACTIVITY_KEY) || 'null');
      if (!value || !Number.isFinite(Number(value.acknowledgedUnread))) return null;
      return {
        acknowledgedUnread: Math.max(0, Number(value.acknowledgedUnread)),
        observedUnread: Math.max(0, Number(value.observedUnread || 0))
      };
    } catch {
      return null;
    }
  }

  function writeUnreadActivityState(value) {
    try {
      localStorage.setItem(UNREAD_ACTIVITY_KEY, JSON.stringify({
        acknowledgedUnread: Math.max(0, Number(value.acknowledgedUnread || 0)),
        observedUnread: Math.max(0, Number(value.observedUnread || 0))
      }));
      return true;
    } catch {
      return false;
    }
  }

  function syncInboxActivity(summary) {
    const registry = globalThis.UniversalAppAdapters;
    if (!summary.connected) {
      registry?.clearAppActivity?.('email', 'inbox');
      return false;
    }

    const unread = Math.max(0, Number(summary.unread || 0));
    const stored = readUnreadActivityState();
    if (!stored) {
      writeUnreadActivityState({ acknowledgedUnread: unread, observedUnread: unread });
      registry?.clearAppActivity?.('email', 'inbox');
      return false;
    }

    const acknowledgedUnread = Math.min(stored.acknowledgedUnread, unread);
    writeUnreadActivityState({ acknowledgedUnread, observedUnread: unread });
    const pendingCount = Math.max(0, unread - acknowledgedUnread);
    if (pendingCount > 0) {
      registry?.setAppActivity?.('email', 'inbox', { pending: true, count: pendingCount });
      return true;
    }
    registry?.clearAppActivity?.('email', 'inbox');
    return false;
  }

  function acknowledgeInboxActivity() {
    if (currentSummary.connected) {
      const unread = Math.max(0, Number(currentSummary.unread || 0));
      writeUnreadActivityState({ acknowledgedUnread: unread, observedUnread: unread });
    }
    globalThis.UniversalAppAdapters?.clearAppActivity?.('email', 'inbox');
    return true;
  }

  function normalizedSummary(value) {
    if (!value?.connected) return Object.freeze({ connected: false });
    return Object.freeze({
      connected: true,
      inbox: Math.max(0, Number(value.inbox || 0)),
      unread: Math.max(0, Number(value.unread || 0)),
      drafts: Math.max(0, Number(value.drafts || 0))
    });
  }

  function applySummary(summary) {
    const connected = summary.connected === true;
    globalThis.UniversalAppAdapters?.updateAppState?.('email', connected ? {
      connected: true,
      inboxCount: summary.inbox,
      unreadCount: summary.unread,
      draftCount: summary.drafts,
      connectionState: 'Connected',
      connectionAction: 'Reconnect'
    } : {
      connected: false,
      connectionState: 'Disconnected',
      connectionAction: 'Connect'
    });
    syncInboxActivity(summary);
    document.dispatchEvent(new CustomEvent('gmail-summary-updated', { detail: summary }));
  }

  async function requestJson(pathName) {
    const response = await fetch(pathName, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Gmail adapter request failed with HTTP ${response.status}`);
    return value;
  }

  async function refresh() {
    let value;
    try {
      value = await requestJson('/api/gmail/summary');
    } catch {
      return currentSummary;
    }
    if (value?.stale === true && currentSummary.connected === true) return currentSummary;
    currentSummary = normalizedSummary(value);
    applySummary(currentSummary);
    return currentSummary;
  }

  function connect() {
    window.location.assign('/auth/gmail/start');
  }

  async function status() {
    return requestJson('/api/gmail/status');
  }

  async function messages(labelId = 'INBOX', limit = 10) {
    const safeLabel = String(labelId || 'INBOX').toUpperCase();
    const safeLimit = Math.min(10, Math.max(1, Number.parseInt(limit, 10) || 10));
    return requestJson(`/api/gmail/messages?limit=${safeLimit}&label=${encodeURIComponent(safeLabel)}`);
  }

  async function message(messageId) {
    const id = encodeURIComponent(String(messageId || '').trim());
    if (!id) throw new Error('missing_gmail_message_id');
    return requestJson(`/api/gmail/message?id=${id}`);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showPanel(titleText, content) {
    const appShell = document.querySelector('.app-shell');
    const title = document.getElementById('detailTitle');
    const detail = document.getElementById('detailContent');
    if (!appShell || !title || !detail) return false;
    title.textContent = titleText;
    detail.innerHTML = content;
    appShell.classList.add('detail-open');
    return true;
  }

  function renderMailboxPanel(title, messagesValue) {
    const items = (Array.isArray(messagesValue) ? messagesValue : [])
      .slice(0, 10)
      .map((item) => ({
        messageId: String(item?.id || '').trim(),
        sender: String(item?.sender || 'Sender unavailable'),
        subject: String(item?.subject || '(No subject)'),
        date: String(item?.date || 'Date unavailable')
      }))
      .filter((item) => item.messageId);

    if (!items.length) {
      return showPanel(title, `
        <div class="detail-block">
          <label>Mailbox headers</label>
          <p>No ${escapeHtml(title)} messages were returned.</p>
        </div>`);
    }

    const rows = items.map((item) => `
      <div class="detail-block">
        <button
          class="ghost-button full-width"
          type="button"
          data-gmail-message-id="${escapeHtml(item.messageId)}"
          data-gmail-message-sender="${escapeHtml(item.sender)}"
          data-gmail-message-subject="${escapeHtml(item.subject)}"
          data-gmail-message-date="${escapeHtml(item.date)}"
        ><strong>${escapeHtml(item.subject)}</strong><br>${escapeHtml(item.sender)}<br>${escapeHtml(item.date)}</button>
      </div>`).join('');

    return showPanel(title, `
      <div class="detail-block">
        <label>Mailbox headers</label>
        <p>Showing ${items.length} of at most 10 message headers. Message bodies load only when selected.</p>
      </div>
      ${rows}`);
  }

  async function loadMailbox(context) {
    const title = String(context?.state?.title || 'Mailbox');
    const labelId = String(context?.state?.mailbox || 'INBOX');
    showPanel(title, '<div class="inspector-placeholder"><p>Loading message headers...</p></div>');
    try {
      const result = await messages(labelId, 10);
      if (!result?.connected) {
        return showPanel(title, `
          <div class="detail-block"><label>Connection</label><p>Gmail is disconnected.</p></div>
          <div class="detail-actions"><button class="ghost-button" type="button" data-gmail-action="connect">Connect Gmail</button></div>`);
      }
      return renderMailboxPanel(title, result.messages);
    } catch {
      return showPanel(title, `
        <div class="detail-block">
          <label>Unavailable</label>
          <p>${escapeHtml(title)} headers could not be loaded.</p>
        </div>`);
    }
  }

  async function openMessage(state) {
    showPanel(state?.subject || '(No subject)', '<div class="inspector-placeholder"><p>Loading message...</p></div>');
    let detail;
    try {
      detail = await message(state?.messageId);
    } catch {
      showCapability('Gmail message', 'This message could not be loaded.');
      return false;
    }
    if (detail?.reauthorize || detail?.error === 'gmail_readonly_required') {
      showPanel('Gmail access upgrade', `
        <div class="detail-block"><label>Read-only access required</label><p>Message bodies require Gmail read-only permission. Your current authorization provides metadata only.</p></div>
        <div class="detail-actions"><button class="ghost-button" type="button" data-gmail-action="connect">Reauthorize Gmail</button></div>`);
      return false;
    }
    return showPanel(detail?.subject || state?.subject || '(No subject)', `
      <div class="detail-block">
        <label>Sender</label>
        <p>${escapeHtml(detail?.sender || state?.sender || 'Sender unavailable')}</p>
      </div>
      <div class="detail-block">
        <label>Date</label>
        <p>${escapeHtml(detail?.date || state?.date || 'Date unavailable')}</p>
      </div>
      <div class="detail-block">
        <label>Subject</label>
        <p>${escapeHtml(detail?.subject || state?.subject || '(No subject)')}</p>
      </div>
      <div class="detail-block">
        <label>Message body</label>
        <pre>${escapeHtml(detail?.bodyText || '(No readable text body was returned.)')}</pre>
      </div>`);
  }

  function showCapability(title, message) {
    return showPanel(title, `
      <div class="detail-block">
        <label>Gmail Phase 1</label>
        <p>${escapeHtml(message)}</p>
      </div>`);
  }

  async function showAccount(title) {
    showPanel(title, '<div class="inspector-placeholder"><p>Checking Gmail connection...</p></div>');
    let connection = { connected: currentSummary.connected === true };
    try {
      connection = await status();
    } catch {}
    const connected = connection.connected === true;
    const readonly = connection.readonly === true;
    const registry = globalThis.UniversalAppAdapters;
    registry?.updateAppState?.('email', {
      ...(registry.getAppState?.('email') || {}),
      connected,
      connectionState: connected ? 'Connected' : 'Disconnected',
      connectionAction: connected ? 'Reconnect' : 'Connect'
    });
    showPanel(title, `
      <div class="detail-block">
        <label>Connection</label>
        <p>${connected ? 'Connected' : 'Disconnected'}</p>
      </div>
      <div class="detail-block">
        <label>Permission</label>
        <p>${readonly ? 'Gmail read-only access is enabled for message bodies. Send, modify and delete access are not requested.' : 'Read-only Gmail access is required for message bodies. Use the upgrade action below.'}</p>
        <p>Gmail metadata only — message headers and label counts. No message bodies, send, modify or delete access.</p>
      </div>
      <div class="detail-actions">
        <button class="ghost-button" type="button" data-gmail-action="connect">${connected && !readonly ? 'Upgrade Gmail access' : connected ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
      </div>`);
  }

  async function syncNow() {
    const summary = await refresh();
    return showCapability('Gmail Sync', summary.connected
      ? 'Gmail metadata counts were refreshed successfully.'
      : 'Gmail is disconnected, so metadata could not be refreshed.');
  }

  function handleAction(actionId, context = {}) {
    if (actionId === 'mailbox.open') {
      if (String(context.nodeId || '') === 'inbox') acknowledgeInboxActivity();
      return loadMailbox(context);
    }
    if (actionId === 'search') {
      return showCapability('Search', 'Gmail search is not enabled in Phase 1 because the current gmail.metadata permission does not allow Gmail search queries.');
    }
    if (actionId === 'compose') {
      return showCapability('Compose', 'Compose and send require a later Gmail permission phase. No send permission is currently requested.');
    }
    if (actionId === 'account.open') return showAccount('Gmail');
    if (actionId === 'connection.open') return showAccount('Gmail Connection');
    if (actionId === 'permissions.open') {
      return showCapability('Gmail Permissions', 'Gmail read-only access enables message bodies. Send, modify and delete access are not requested. Use Reauthorize Gmail if your current token still has metadata-only access.');
    }
    if (actionId === 'sync.open') return syncNow();
    if (actionId === 'disconnect.open') {
      return showCapability('Disconnect Gmail', 'Disconnect is not enabled in this Phase 1 interface. No credential or token has been removed.');
    }
    if (actionId === 'connect') return connect();
    return false;
  }

  function mount() {
    document.getElementById('detailContent')?.addEventListener('click', (event) => {
      const messageRow = event.target.closest?.('[data-gmail-message-id]');
      if (messageRow) {
        event.preventDefault();
        openMessage({
          messageId: messageRow.dataset.gmailMessageId,
          sender: messageRow.dataset.gmailMessageSender,
          subject: messageRow.dataset.gmailMessageSubject,
          date: messageRow.dataset.gmailMessageDate
        });
        return;
      }
      const button = event.target.closest?.('[data-gmail-action]');
      if (button?.dataset.gmailAction === 'connect') connect();
    });
    globalThis.UniversalAppAdapters?.startAppRefresh?.('email', { intervalMs: 15000 });
  }

  const adapter = Object.freeze({
    id: 'email',
    definition: EMAIL_DEFINITION,
    handleAction,
    connect,
    messages,
    message,
    refresh,
    status,
    acknowledgeInboxActivity,
    summary: () => currentSummary
  });
  globalThis.GmailAdapter = adapter;
  globalThis.UniversalAppAdapters?.registerAppAdapter?.(adapter);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
