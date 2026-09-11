import { privateAddress } from './orb-local-server.mjs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Provider configuration lives here; the browser consumes only the PCM TTS contract.
export function createOrbTtsRoute({ port = 4173, env = process.env, fetchImpl = fetch } = {}) {
  const voice = env.ORB_TTS_VOICE || 'bf_lily';
  const speed = Number(env.ORB_TTS_SPEED || 1.2);
  let busy = false;
  return async (req, res, url) => {
    if (url.pathname !== '/api/orb/tts') return false;
    const send = (status, error) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error })); };
    let host;
    try { host = new URL(`http://${req.headers.host}`); } catch { send(403, 'Private local access only'); return true; }
    if (!privateAddress(req.socket.remoteAddress) || !privateAddress(host.hostname.replace(/^\[|\]$/g, '')) ||
        Number(host.port || 80) !== port || req.headers.origin !== host.origin || req.headers['sec-fetch-site'] === 'cross-site') {
      send(403, 'Same-origin private access required'); return true;
    }
    if (req.method !== 'POST') { send(405, 'Method not allowed'); return true; }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') { send(415, 'JSON required'); return true; }
    if (busy) { send(429, 'Local voice is busy. Try again shortly.'); return true; }
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); if (!req.complete) req.destroy(); }, 90000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) { send(413, 'Request too large'); return true; } }
      let body;
      try { body = JSON.parse(raw); } catch { send(400, 'Invalid JSON'); return true; }
      if (!body || Array.isArray(body) || Object.keys(body).join(',') !== 'text' || typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1200) {
        send(400, 'Invalid speech request'); return true;
      }
      const upstream = await fetchImpl('http://127.0.0.1:8880/v1/audio/speech', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'kokoro', input: body.text, voice, speed: Number.isFinite(speed) && speed >= .25 && speed <= 4 ? speed : 1.2,
          response_format: 'pcm', stream: true, return_download_link: false })
      });
      if (!upstream.ok || !upstream.body) { await upstream.body?.cancel(); throw new Error('Voice unavailable'); }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
        'X-Audio-Format': 'pcm-s16le', 'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1', 'X-Accel-Buffering': 'no' });
      await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
    } catch {
      if (!res.destroyed) {
        if (res.headersSent) res.destroy();
        else send(503, 'Local voice unavailable. Check the resident voice service.');
      }
    } finally { controller.abort(); clearTimeout(timeout); res.off('close', disconnect); busy = false; }
    return true;
  };
}
