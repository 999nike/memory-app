(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);

  window.fetch = async function memoryControllerPlusFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();

    if (!isChatRequest(url, method)) return previousFetch(input, init);

    let body = null;
    try {
      body = JSON.parse(init.body || '{}');
    } catch {
      return previousFetch(input, init);
    }

    const projectProposal = buildProjectProposal(body);
    if (projectProposal) {
      setStatus('Memory controller · ready', 'local');
      return jsonResponse(200, {
        reply: 'That looks like durable project information. I’ve prepared it as a memory proposal for you to review.',
        usedMemoryTitles: [],
        proposals: [projectProposal],
        model: 'local/memory-controller-projects',
        local: true
      });
    }

    const response = await previousFetch(input, init);
    if (response.ok) return response;

    let data = null;
    try {
      data = await response.clone().json();
    } catch {}

    if (response.status >= 500) {
      console.warn('Local conversation model failed; using safe local fallback.', data?.error || response.status);
      setStatus('Mobile AI · retry available', 'local');
      return jsonResponse(200, {
        reply: 'The local conversation model couldn’t answer that message on this device. Your workspace is still safe and the memory controller is working. Try a shorter question, or tell me explicitly what you want remembered.',
        usedMemoryTitles: [],
        proposals: [],
        model: 'local/safe-fallback',
        local: true
      });
    }

    return response;
  };

  function buildProjectProposal(body) {
    const raw = String(body?.message || '').trim();
    if (!raw || raw.length < 8) return null;

    const cleaned = cleanMemoryStatement(raw);
    const projectNameRaw = extractProjectName(cleaned);
    if (!projectNameRaw) return null;

    const content = normalizeSentence(cleaned);
    const context = String(body?.context || '');
    if (alreadyInContext(projectNameRaw, content, context)) return null;

    return {
      title: `Project: ${titleCase(projectNameRaw)}`.slice(0, 100),
      content: content.slice(0, 900),
      type: 'fact',
      importance: 'high',
      reason: 'This introduces a named project and description that may matter across future work.'
    };
  }

  function extractProjectName(value) {
    let text = String(value || '').trim();
    if (!text) return '';

    const explicitPrefix = text.match(/^(?:my\s+(?:new\s+)?(?:project|game|app)\s+is|i\s+am\s+building|i['’]?m\s+building|i\s+am\s+working\s+on|i['’]?m\s+working\s+on)\s+(.+)$/i);
    let candidate = explicitPrefix ? explicitPrefix[1].trim() : text;

    const hasProjectSignal = Boolean(explicitPrefix)
      || /\ban\s+indie\b/i.test(candidate)
      || /\b(?:game|app|project)\b.*\b(?:i['’]?m|im|i\s+am)\s+working\s+on\b/i.test(candidate);
    if (!hasProjectSignal) return '';

    candidate = candidate
      .split(/\s*,\s*(?=(?:an?|the)\s+(?:indie\s+)?(?:game|app|project)\b)/i)[0]
      .split(/\s+an\s+indie\b/i)[0]
      .split(/\s+(?:which|that)\s+/i)[0]
      .trim();

    candidate = stripTrailingInstruction(candidate)
      .replace(/[,:;.!?-]+$/g, '')
      .trim();

    const words = candidate.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 10) return '';
    return candidate;
  }

  function cleanMemoryStatement(value) {
    let text = String(value || '').trim()
      .replace(/^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening))\b[\s,!.:;-]*/i, '')
      .trim();

    text = stripTrailingInstruction(text);
    return text.trim();
  }

  function stripTrailingInstruction(value) {
    let text = String(value || '').trim();
    const patterns = [
      /(?:[,;:.!?-]+\s*)?(?:please\s+)?(?:save|store|keep)\s+(?:it|this|that)(?:\s+for\s+later)?[.!?]*$/i,
      /(?:[,;:.!?-]+\s*)?(?:please\s+)?remember\s+(?:it|this|that)(?:\s+for\s+later)?[.!?]*$/i,
      /(?:[,;:.!?-]+\s*)?(?:please\s+)?don['’]?t\s+forget\s+(?:it|this|that)[.!?]*$/i,
      /(?:[,;:.!?-]+\s*)?(?:please\s+)?add\s+(?:it|this|that)\s+to\s+(?:memory|my\s+memory|the\s+memory)[.!?]*$/i
    ];

    let previous;
    do {
      previous = text;
      for (const pattern of patterns) text = text.replace(pattern, '').trim();
    } while (text !== previous);

    return text;
  }

  function alreadyInContext(projectName, content, context) {
    const haystack = normalizeForMatch(context);
    const name = normalizeForMatch(projectName);
    const sentence = normalizeForMatch(content);
    if (name.length >= 4 && haystack.includes(name)) return true;
    if (sentence.length >= 12 && haystack.includes(sentence)) return true;
    return false;
  }

  function normalizeSentence(value) {
    let text = String(value || '').trim();
    if (!text) return '';
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (!/[.!?]$/.test(text)) text += '.';
    return text;
  }

  function titleCase(value) {
    return String(value || '').trim().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  }

  function normalizeForMatch(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function setStatus(label, mode) {
    globalThis.__memoryAIStatus = { label, mode };
    const status = document.getElementById('aiStatus');
    if (!status) return;
    status.classList.toggle('busy', mode === 'busy');
    status.classList.toggle('local-provider', mode === 'local');
    status.classList.toggle('provider-error', mode === 'error');
    status.innerHTML = `<span></span> ${escapeHtml(label)}`;
  }

  function isChatRequest(url, method) {
    if (method !== 'POST' || !url) return false;
    try {
      const parsed = new URL(url, location.href);
      return parsed.origin === location.origin && parsed.pathname === '/api/chat';
    } catch {
      return url === '/api/chat';
    }
  }

  function jsonResponse(status, value) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
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
