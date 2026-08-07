(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);

  window.fetch = async function normalizedMemoryFetch(input, init = {}) {
    const response = await previousFetch(input, init);
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init.method || (typeof input !== 'string' ? input?.method : 'GET') || 'GET').toUpperCase();

    if (!isChatRequest(url, method)) return response;

    let data;
    try {
      data = await response.clone().json();
    } catch {
      return response;
    }

    if (!response.ok || !Array.isArray(data?.proposals) || !data.proposals.length) return response;

    let changed = false;
    data.proposals = data.proposals.map((proposal) => {
      const original = String(proposal?.content || '');
      const content = normalizeProposal(original);
      if (content === original) return proposal;
      changed = true;
      return { ...proposal, content };
    });

    if (!changed) return response;

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  };

  function normalizeProposal(value) {
    let text = String(value || '').trim();
    text = text.replace(/^(?:hi|hello|hey|hiya|yo|good\s+(?:morning|afternoon|evening))\b[\s,!.:;-]*/i, '');
    if (!text) return String(value || '').trim();
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return text;
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
})();
