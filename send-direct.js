const WORKSPACE_KEY = 'memory-space-v1';
const CHAT_KEY = 'memory-space-chat-v1';

let sending = false;

const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;

export async function sendDirect() {
  if (sending) return;

  const input = document.getElementById('chatInput');
  const button = document.getElementById('chatSendButton');
  const status = document.getElementById('aiStatus');
  const notice = document.getElementById('chatNotice');
  const text = input?.value.trim();
  if (!text) return;

  const workspace = loadJson(WORKSPACE_KEY);
  const chat = loadJson(CHAT_KEY) || { version: 1, messages: [], proposals: [] };
  const space = workspace?.spaces?.find((item) => item.id === workspace.activeSpaceId) || workspace?.spaces?.[0];

  if (!workspace || !space || !Array.isArray(workspace.memories)) {
    showError('Could not read the local workspace.');
    return;
  }

  const priorHistory = (chat.messages || [])
    .filter((message) => message.spaceId === space.id)
    .slice(-10)
    .map((message) => ({ role: message.role, content: message.content }));

  const context = buildContext(workspace, space);

  chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
  chat.proposals = Array.isArray(chat.proposals) ? chat.proposals : [];
  chat.messages.push({
    id: uid('msg'),
    spaceId: space.id,
    role: 'user',
    content: text,
    createdAt: now()
  });
  saveJson(CHAT_KEY, chat);

  input.value = '';
  appendMessage('user', text);

  sending = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Working…';
  }
  if (status) {
    status.classList.add('busy');
    status.innerHTML = '<span></span> Preparing local AI';
  }
  if (notice) {
    notice.hidden = false;
    notice.classList.remove('error');
    notice.textContent = 'Message accepted — preparing the local model…';
  }

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Memory-Client': 'workspace-v1'
      },
      body: JSON.stringify({
        message: text,
        space: { id: space.id, name: space.name, description: space.description },
        context,
        history: priorHistory
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `AI request failed (${response.status})`);

    chat.messages.push({
      id: uid('msg'),
      spaceId: space.id,
      role: 'assistant',
      content: data.reply || 'I could not produce a reply.',
      usedMemoryTitles: Array.isArray(data.usedMemoryTitles) ? data.usedMemoryTitles : [],
      contextSnapshot: context,
      model: data.model || null,
      createdAt: now()
    });

    for (const proposal of Array.isArray(data.proposals) ? data.proposals : []) {
      chat.proposals.push({
        id: uid('proposal'),
        spaceId: space.id,
        title: String(proposal.title || 'Proposed memory'),
        content: String(proposal.content || ''),
        type: proposal.type || 'note',
        importance: proposal.importance || 'normal',
        reason: String(proposal.reason || 'AI suggested this as durable context.'),
        sourceMessage: text,
        status: 'pending',
        createdAt: now()
      });
    }

    saveJson(CHAT_KEY, chat);
    location.reload();
  } catch (error) {
    const message = error?.message || 'Unknown local AI error';
    chat.messages.push({
      id: uid('msg'),
      spaceId: space.id,
      role: 'assistant',
      content: `Local AI error: ${message}`,
      createdAt: now()
    });
    saveJson(CHAT_KEY, chat);
    appendMessage('assistant', `Local AI error: ${message}`);
    showError(message);
  } finally {
    sending = false;
    if (button) {
      button.disabled = false;
      button.textContent = 'Send';
    }
    syncProviderStatus();
  }
}

function buildContext(workspace, space) {
  const order = { critical: 0, high: 1, normal: 2, low: 3 };
  const memories = workspace.memories
    .filter((memory) => memory.spaceId === space.id && memory.status !== 'deleted')
    .sort((a, b) => (order[a.importance] ?? 9) - (order[b.importance] ?? 9));

  const lines = [
    `SPACE: ${space.name}`,
    `PURPOSE: ${space.description || ''}`,
    '',
    'CONFIRMED MEMORY:'
  ];

  if (!memories.length) lines.push('- None yet.');
  for (const memory of memories) {
    lines.push(`- [${String(memory.importance || 'normal').toUpperCase()}] [${String(memory.type || 'note').toUpperCase()}] ${memory.title}`);
    lines.push(`  ${memory.content}`);
    if (memory.source) lines.push(`  Source: ${memory.source}`);
    if (memory.locked) lines.push('  Locked by user: yes');
  }

  lines.push('', 'MEMORY RULE: Locked and confirmed memories are trusted context. Never claim a proposed memory is saved until the user approves it.');
  return lines.join('\n');
}

function appendMessage(role, content) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  if (container.querySelector('.chat-empty')) container.innerHTML = '';

  const article = document.createElement('article');
  article.className = `chat-message ${role}`;

  const roleEl = document.createElement('div');
  roleEl.className = 'chat-role';
  roleEl.textContent = role === 'user' ? 'You' : 'AI';

  const copy = document.createElement('div');
  copy.className = 'chat-copy';
  copy.textContent = content;

  article.append(roleEl, copy);
  container.appendChild(article);
  container.scrollTop = container.scrollHeight;
}

function showError(message) {
  const notice = document.getElementById('chatNotice');
  if (notice) {
    notice.hidden = false;
    notice.classList.add('error');
    notice.textContent = message;
  }
}

function syncProviderStatus() {
  const current = globalThis.__memoryAIStatus;
  const status = document.getElementById('aiStatus');
  if (!current || !status) return;
  status.classList.toggle('busy', current.mode === 'busy');
  status.classList.toggle('local-provider', current.mode === 'local');
  status.classList.toggle('provider-error', current.mode === 'error');
  status.innerHTML = `<span></span> ${escapeHtml(current.label)}`;
}

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
