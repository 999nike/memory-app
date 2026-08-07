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

  const workspace = loadWorkspaceOrSeed();
  const chat = loadJson(CHAT_KEY) || { version: 1, messages: [], proposals: [] };
  const space = workspace?.spaces?.find((item) => item.id === workspace.activeSpaceId) || workspace?.spaces?.[0];

  if (!workspace || !space || !Array.isArray(workspace.memories)) {
    showError('Could not initialise the local workspace.');
    if (button) button.textContent = 'Send';
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

function loadWorkspaceOrSeed() {
  const existing = loadJson(WORKSPACE_KEY);
  if (existing && Array.isArray(existing.spaces) && Array.isArray(existing.memories) && existing.spaces.length) {
    return existing;
  }

  const stamp = now();
  const seeded = {
    version: 1,
    activeSpaceId: 'space_memory_app',
    spaces: [
      {
        id: 'space_memory_app',
        name: 'Memory App',
        description: 'A private, visible long-term context space controlled by the user and built together with an AI.',
        createdAt: stamp,
        updatedAt: stamp
      }
    ],
    memories: [
      {
        id: 'memory_visible',
        spaceId: 'space_memory_app',
        title: 'Memory must be visible',
        content: 'The user should be able to see, understand, edit, lock, export, and delete the information an AI uses as long-term context.',
        type: 'decision',
        importance: 'critical',
        source: 'User confirmed in project conversation',
        locked: true,
        status: 'confirmed',
        createdAt: stamp,
        updatedAt: stamp
      },
      {
        id: 'memory_local',
        spaceId: 'space_memory_app',
        title: 'Local-first and private',
        content: 'Version one stores its workspace on the user’s device. Pinecone, Upstash, accounts, and cloud sync are deliberately excluded from the first build.',
        type: 'decision',
        importance: 'critical',
        source: 'User confirmed in project conversation',
        locked: true,
        status: 'confirmed',
        createdAt: stamp,
        updatedAt: stamp
      },
      {
        id: 'memory_product',
        spaceId: 'space_memory_app',
        title: 'The shared space is the product',
        content: 'This is not a hidden chatbot memory list. It is a dedicated virtual workspace that a human and AI can both interact with over time.',
        type: 'goal',
        importance: 'critical',
        source: 'User confirmed in project conversation',
        locked: true,
        status: 'confirmed',
        createdAt: stamp,
        updatedAt: stamp
      },
      {
        id: 'memory_ai_connection',
        spaceId: 'space_memory_app',
        title: 'How should AI access be granted?',
        content: 'Define a permission model where each AI can only read or propose changes within spaces the user explicitly authorises.',
        type: 'question',
        importance: 'high',
        source: 'Phase 2 planning',
        locked: false,
        status: 'confirmed',
        createdAt: stamp,
        updatedAt: stamp
      }
    ]
  };

  saveJson(WORKSPACE_KEY, seeded);
  return seeded;
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
