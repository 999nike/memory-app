import { isIP } from 'node:net';
import { residentPrompt, residentProposalPrompt, validateResidentReply, validateResidentProposalReply } from './orb-resident.mjs';

export function privateAddress(value = '') {
  const ip = value.replace(/^::ffff:/, '');
  if (ip === '::1' || ip === 'localhost') return true;
  if (isIP(ip) === 6) return /^(fc|fd|fe[89ab])/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 127 || a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}

export function createOrbLocalRoute({ fetchImpl = fetch, env = process.env, port = 4173 } = {}) {
  let model = '', expires = 0, busy = false, proposalBusy = false;
  const detect = async signal => {
    if (model && Date.now() < expires) return model;
    const response = await fetchImpl('http://127.0.0.1:11434/api/tags', { signal });
    if (!response.ok) throw new Error('Local AI unavailable');
    const tags = (await response.json()).models?.map(item => item.name) || [];
    model = (tags.includes(env.OLLAMA_MODEL) && env.OLLAMA_MODEL) || tags.find(tag => /^gemma[^:]*:1b(?:-|$)/i.test(tag)) || tags[0];
    if (!model) throw new Error('Local AI unavailable: no Ollama model installed');
    expires = Date.now() + 30000; return model;
  };
  return async (req, res, url) => {
    if (!['/api/orb/local/status', '/api/orb/local/chat', '/api/orb/local/proposal'].includes(url.pathname)) return false;
    const proposalMode = url.pathname.endsWith('/proposal');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    let host; try { host = new URL(`http://${req.headers.host}`); } catch { send(403, { error: 'Private local access only' }); return true; }
    if (!privateAddress(req.socket.remoteAddress) || !privateAddress(host.hostname.replace(/^\[|\]$/g, '')) || Number(host.port || 80) !== port ||
        req.headers['sec-fetch-site'] === 'cross-site' || req.headers.origin && req.headers.origin !== host.origin) {
      send(403, { error: 'Private local access only' }); return true;
    }
    const status = url.pathname.endsWith('/status');
    if (req.method !== (status ? 'GET' : 'POST')) { send(405, { error: 'Method not allowed' }); return true; }
    if (!status && (req.headers.origin !== host.origin || req.headers['content-type']?.split(';')[0] !== 'application/json')) {
      send(403, { error: 'Same-origin JSON required' }); return true;
    }
    if (!status && (proposalMode ? proposalBusy : busy)) { send(429, { error: 'Local AI is busy. Try again shortly.' }); return true; }
    if (!status) {
      if (proposalMode) proposalBusy = true;
      else busy = true;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, status ? 5000 : 90000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      const selected = await detect(controller.signal);
      if (status) { send(200, { available: true, model: selected }); return true; }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) { send(413, { error: 'Request too large' }); return true; } }
      let body; try { body = JSON.parse(raw); } catch { send(400, { error: 'Invalid JSON' }); return true; }
      if (proposalMode) {
        const projects = Array.isArray(body.projects) ? body.projects : [];
        const space = body.space;
        const defaultProject = String(body.defaultProject || '');
        if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000 ||
            Object.keys(body).some(key => !['message', 'space', 'projects', 'defaultProject'].includes(key)) ||
            !space || Object.keys(space).some(key => !['id', 'name'].includes(key)) ||
            typeof space.id !== 'string' || !space.id || space.id.length > 160 || typeof space.name !== 'string' || !space.name || space.name.length > 100 ||
            projects.length > 40 || projects.some(project => typeof project !== 'string' || !project || project.length > 100) ||
            defaultProject && !projects.includes(defaultProject)) {
          send(400, { error: 'Invalid proposal request' }); return true;
        }
        const response = await fetchImpl('http://127.0.0.1:11434/api/chat', {
          method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: selected, stream: false, format: 'json', options: { temperature: .1, num_predict: 420 },
            messages: [{ role: 'system', content: residentProposalPrompt },
              ...(defaultProject ? [{ role: 'user', content: `CURRENT MEMORY SPACE: ${space.name}\nALLOWED CODE SPACE PROJECTS: ${projects.join(', ')}\nDEFAULT PROJECT: ${defaultProject}\nUSER REQUEST: Make a job for Codex to write a test page with TEST at the top.` },
                { role: 'assistant', content: JSON.stringify({
                  action: 'propose_memory', title: 'Test page', content: 'Write a test page with TEST at the top.', type: 'job',
                  importance: 'normal', project: defaultProject, priority: 'normal', reason: 'Requested by the user through WIZZ.' }) }] : []),
              { role: 'user', content:
                `CURRENT MEMORY SPACE: ${space.name}\nALLOWED CODE SPACE PROJECTS: ${projects.length ? projects.join(', ') : 'none'}\nDEFAULT PROJECT: ${defaultProject || 'none'}\nUSER REQUEST: ${body.message}` }]
          })
        });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          const detail = String(failure?.error?.message || failure?.error || '').replace(/[\r\n]+/g, ' ').slice(0, 240);
          throw new Error(`WIZZ proposal model request failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
        }
        const data = await response.json();
        const result = validateResidentProposalReply(data.message?.content, projects);
        send(200, { ...result, model: selected, local: true });
        return true;
      }
      if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 1000 ||
          Object.keys(body).some(key => !['message', 'history'].includes(key)) ||
          body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 8 || body.history.some(item =>
            !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 1200))) {
        send(400, { error: 'Invalid conversation request' }); return true;
      }
      const response = await fetchImpl('http://127.0.0.1:11434/v1/chat/completions', {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: selected, stream: false, temperature: .5, max_tokens: 220,
          response_format: { type: 'json_schema', json_schema: { name: 'orb_reply', strict: true, schema: {
            type: 'object', additionalProperties: false, required: ['reply', 'navigate'],
            properties: { reply: { type: 'string', minLength: 1, maxLength: 1200 }, navigate: { anyOf: [{ type: 'null' }, { type: 'string', minLength: 1, maxLength: 160 }] } }
          } } },
          messages: [{ role: 'system', content: residentPrompt },
            { role: 'user', content: 'Hello Orb. How are you?' },
            { role: 'assistant', content: '{"reply":"I’m here and ready to help. How are you doing?","navigate":null}' },
            { role: 'user', content: 'Where is Gmail?' },
            { role: 'assistant', content: '{"reply":"Let me find it for you.","navigate":"EMAIL"}' },
            ...(body.history || []), { role: 'user', content: body.message }] })
      });
      if (!response.ok) throw new Error('Local AI unavailable');
      const data = await response.json();
      const result = validateResidentReply(data.choices?.[0]?.message?.content);
      send(200, { ...result, model: selected, local: true });
    } catch (error) {
      expires = 0;
      if (!res.destroyed) {
        const detail = String(error?.message || 'Unknown proposal error').replace(/[\r\n]+/g, ' ').slice(0, 300);
        send(503, { error: proposalMode
          ? (detail.startsWith('WIZZ proposal') ? detail : `WIZZ proposal response failed: ${detail}`)
          : (detail.startsWith('Local AI') ? detail : 'Local AI unavailable. Check Ollama and try again.') });
      }
    } finally {
      clearTimeout(timeout); res.off('close', disconnect);
      if (proposalMode) proposalBusy = false;
      else if (!status) busy = false;
    }
    return true;
  };
}
