import { isIP } from 'node:net';
import { residentPrompt, validateResidentReply } from './orb-resident.mjs';

export function privateAddress(value = '') {
  const ip = value.replace(/^::ffff:/, '');
  if (ip === '::1' || ip === 'localhost') return true;
  if (isIP(ip) === 6) return /^(fc|fd|fe[89ab])/i.test(ip);
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split('.').map(Number);
  return a === 127 || a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}

export function createOrbLocalRoute({ fetchImpl = fetch, env = process.env, port = 4173 } = {}) {
  let model = '', expires = 0, busy = false;
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
    if (!['/api/orb/local/status', '/api/orb/local/chat'].includes(url.pathname)) return false;
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
    if (busy && !status) { send(429, { error: 'Local AI is busy. Try again shortly.' }); return true; }
    if (!status) busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, status ? 5000 : 90000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      const selected = await detect(controller.signal);
      if (status) { send(200, { available: true, model: selected }); return true; }
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) { send(413, { error: 'Request too large' }); return true; } }
      let body; try { body = JSON.parse(raw); } catch { send(400, { error: 'Invalid JSON' }); return true; }
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
      if (!res.destroyed) send(503, { error: error.message.startsWith('Local AI') ? error.message : 'Local AI unavailable. Check Ollama and try again.' });
    } finally { clearTimeout(timeout); res.off('close', disconnect); if (!status) busy = false; }
    return true;
  };
}
