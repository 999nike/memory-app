import http from 'node:http';
import crypto from 'node:crypto';

const PROTOCOL = 'memory-space-bridge';
const VERSION = 1;
const HOST = process.env.MEMORY_BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.MEMORY_BRIDGE_PORT || 8787);
const TOKEN = process.env.MEMORY_BRIDGE_TOKEN || '';
const BRIDGE_NAME = process.env.MEMORY_BRIDGE_NAME || 'Memory Bridge';
const TARGET_ENDPOINT = process.env.MEMORY_BRIDGE_TARGET || 'http://127.0.0.1:11434/v1/chat/completions';
const TARGET_MODEL = process.env.MEMORY_BRIDGE_MODEL || '';
const ALLOWED_ORIGINS = new Set(
  String(process.env.MEMORY_BRIDGE_ORIGINS || 'https://memory-app-ashy-one.vercel.app')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

if (!TOKEN) {
  console.error('MEMORY_BRIDGE_TOKEN is required. Refusing to start without pairing authentication.');
  process.exit(1);
}

if (!TARGET_MODEL) {
  console.error('MEMORY_BRIDGE_MODEL is required. Example: gemma3:4b');
  process.exit(1);
}

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin);
  return {
    'Vary': 'Origin',
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Memory-Bridge-Protocol',
    'Access-Control-Expose-Headers': 'X-Memory-Bridge-Protocol',
    'Cache-Control': 'no-store'
  };
}

function sendJson(res, status, value, origin) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    ...corsHeaders(origin),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Memory-Bridge-Protocol': `${PROTOCOL}/${VERSION}`
  });
  res.end(body);
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function isAuthorized(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(auth.slice(7));
  const expected = Buffer.from(TOKEN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

async function readBody(req, maxBytes = 512_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request is too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function validateChat(body) {
  if (body?.protocol !== PROTOCOL || Number(body?.version) !== VERSION) {
    throw new Error('Unsupported Memory Bridge protocol');
  }
  if (typeof body?.message !== 'string' || !body.message.trim()) {
    throw new Error('message is required');
  }
  if (body.context != null && typeof body.context !== 'string') {
    throw new Error('context must be a string');
  }
  if (body.history != null && !Array.isArray(body.history)) {
    throw new Error('history must be an array');
  }
}

async function runLocalModel(body) {
  const history = Array.isArray(body.history)
    ? body.history.slice(-10).filter((item) => item && typeof item.content === 'string')
    : [];

  const system = [
    'You are an AI collaborator inside a user-owned Memory Space.',
    'Confirmed current memory supplied below is trusted context for this request.',
    'Do not claim that a memory was permanently saved unless the application says the user approved it.',
    'Do not invent memories that are not present in the supplied context.',
    body.context ? `\nMEMORY SPACE CONTEXT:\n${body.context}` : ''
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system', content: system },
    ...history.map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content)
    })),
    { role: 'user', content: body.message }
  ];

  const response = await fetch(TARGET_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TARGET_MODEL,
      messages,
      temperature: 0.6,
      stream: false
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.error || `Local model returned HTTP ${response.status}`);
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error('Local model returned no chat message');
  return String(reply);
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');

  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed(origin)) {
      sendJson(res, 403, { error: 'Origin is not allowed' }, origin);
      return;
    }
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  if (!isOriginAllowed(origin)) {
    sendJson(res, 403, { error: 'Origin is not allowed' }, origin);
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'Bridge pairing token is invalid' }, origin);
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/v1/info') {
      sendJson(res, 200, {
        protocol: PROTOCOL,
        version: VERSION,
        name: BRIDGE_NAME,
        model: TARGET_MODEL,
        transport: 'openai-compatible-local-target',
        storesWorkspace: false
      }, origin);
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/chat') {
      const body = await readBody(req);
      validateChat(body);
      const requestId = String(body.requestId || crypto.randomUUID());
      console.log(`[bridge] request ${requestId} model=${TARGET_MODEL} contextChars=${String(body.context || '').length} history=${Array.isArray(body.history) ? body.history.length : 0}`);
      const reply = await runLocalModel(body);
      sendJson(res, 200, {
        reply,
        model: TARGET_MODEL,
        usedMemoryTitles: [],
        bridge: {
          protocol: PROTOCOL,
          version: VERSION,
          name: BRIDGE_NAME,
          requestId,
          storesWorkspace: false
        }
      }, origin);
      return;
    }

    sendJson(res, 404, { error: 'Not found' }, origin);
  } catch (error) {
    console.error(`[bridge] ${error?.message || error}`);
    sendJson(res, 502, { error: error?.message || 'Bridge request failed' }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Memory Bridge ${PROTOCOL}/${VERSION}`);
  console.log(`Listening on http://${HOST}:${PORT}`);
  console.log(`Target: ${TARGET_ENDPOINT}`);
  console.log(`Model: ${TARGET_MODEL}`);
  console.log(`Allowed origins: ${[...ALLOWED_ORIGINS].join(', ')}`);
  console.log('Workspace memory is not stored by the bridge.');
});
