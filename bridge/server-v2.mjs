import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createMemoryBridgeOAuth } from './oauth.mjs';
import { createConnectionState } from './connection-state.mjs';
import { createWorkspaceRuntime, MCP_VERSION } from './workspace-runtime.mjs';

const PROTOCOL = 'memory-space-bridge';
const VERSION = 1;
const LEGACY_CONNECTION_ID = 'legacy';
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.MEMORY_BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.MEMORY_BRIDGE_PORT || 8787);
const TOKEN = process.env.MEMORY_BRIDGE_TOKEN || '';
const BRIDGE_NAME = process.env.MEMORY_BRIDGE_NAME || 'Memory Bridge';
const TARGET_ENDPOINT = process.env.MEMORY_BRIDGE_TARGET || 'http://127.0.0.1:11434/v1/chat/completions';
const TARGET_MODEL = process.env.MEMORY_BRIDGE_MODEL || '';
const PUBLIC_URL = String(process.env.MEMORY_BRIDGE_PUBLIC_URL || 'https://bridge.w-i-z-z-lab-studios.com').replace(/\/+$/, '');
const OAUTH_CLIENT_ID = process.env.MEMORY_BRIDGE_OAUTH_CLIENT_ID || 'memory-space-grok';
const OAUTH_REDIRECT_HOSTS = String(process.env.MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS || 'grok.com,x.ai')
  .split(',').map((value) => value.trim()).filter(Boolean);
const ALLOWED_ORIGINS = new Set(
  String(process.env.MEMORY_BRIDGE_ORIGINS || 'https://memory-app-ashy-one.vercel.app')
    .split(',').map((value) => value.trim()).filter(Boolean)
);
const TENANT_OAUTH_DIR = path.resolve(
  String(process.env.MEMORY_BRIDGE_TENANT_OAUTH_DIR || path.join(MODULE_DIR, '.state', 'tenant-oauth'))
);
const MCP_TOOL_SCOPES = Object.freeze({
  list_spaces: 'memory.read',
  search_memory: 'memory.read',
  get_current_space_context: 'memory.read',
  read_memory: 'memory.read',
  get_current_decisions: 'memory.read',
  inspect_provenance: 'memory.read',
  propose_memory: 'memory.propose'
});

if (!TOKEN) {
  console.error('MEMORY_BRIDGE_TOKEN is required. Refusing to start without pairing authentication.');
  process.exit(1);
}
if (!TARGET_MODEL) {
  console.error('MEMORY_BRIDGE_MODEL is required. Example: gemma3:4b');
  process.exit(1);
}
if (!PUBLIC_URL.startsWith('https://')) {
  console.error('MEMORY_BRIDGE_PUBLIC_URL must be HTTPS.');
  process.exit(1);
}

const legacyOauth = createMemoryBridgeOAuth({
  publicUrl: PUBLIC_URL,
  pairingToken: TOKEN,
  clientId: OAUTH_CLIENT_ID,
  redirectHosts: OAUTH_REDIRECT_HOSTS
});
const connections = createConnectionState({ masterToken: TOKEN, publicUrl: PUBLIC_URL, bridgeName: BRIDGE_NAME });
const workspaces = createWorkspaceRuntime();
const tenantOauth = new Map();

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin);
  return {
    Vary: 'Origin',
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Memory-Bridge-Protocol,MCP-Protocol-Version,Mcp-Method,Mcp-Name',
    'Access-Control-Expose-Headers': 'X-Memory-Bridge-Protocol,MCP-Protocol-Version',
    'Cache-Control': 'no-store'
  };
}

function sendJson(res, status, value, origin, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    ...corsHeaders(origin),
    ...extraHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Memory-Bridge-Protocol': `${PROTOCOL}/${VERSION}`
  });
  res.end(body);
}

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function bearer(req) {
  const auth = String(req.headers.authorization || '');
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isAdminAuthorized(req) {
  return safeEqual(bearer(req), TOKEN);
}

function mcpScopeCheck(oauth, req, body, adminAuthorized = false) {
  if (String(body?.method || '') !== 'tools/call') return { allowed: true };
  const toolName = String(body?.params?.name || '').trim();
  const requiredScope = Object.prototype.hasOwnProperty.call(MCP_TOOL_SCOPES, toolName)
    ? MCP_TOOL_SCOPES[toolName]
    : null;
  if (!requiredScope) {
    return {
      allowed: false,
      error: `MCP tool has no declared permission scope: ${toolName || '(missing tool name)'}`
    };
  }
  if (adminAuthorized || oauth.isAuthorized(req, requiredScope)) return { allowed: true };
  return {
    allowed: false,
    error: `OAuth scope ${requiredScope} is required for MCP tool ${toolName}`,
    requiredScope
  };
}

function parseTenantPath(pathname) {
  const match = String(pathname || '').match(/^\/c\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  try {
    return { connectionId: decodeURIComponent(match[1]), suffix: match[2] || '/' };
  } catch {
    return null;
  }
}

function parseWellKnownTenant(pathname) {
  let match = String(pathname || '').match(/^\/\.well-known\/oauth-protected-resource\/c\/([^/]+)\/mcp$/);
  if (match) {
    try { return { connectionId: decodeURIComponent(match[1]), suffix: '/.well-known/oauth-protected-resource/mcp' }; } catch { return null; }
  }
  match = String(pathname || '').match(/^\/\.well-known\/oauth-authorization-server\/c\/([^/]+)$/);
  if (match) {
    try { return { connectionId: decodeURIComponent(match[1]), suffix: '/.well-known/oauth-authorization-server' }; } catch { return null; }
  }
  return null;
}

function tenantIssuer(connectionId) {
  return `${PUBLIC_URL}/c/${encodeURIComponent(connectionId)}`;
}

function tenantOauthStateFile(connectionId) {
  return path.join(TENANT_OAUTH_DIR, `${connectionId}.enc.json`);
}

function getTenantOauth(connectionId) {
  if (!connections.exists(connectionId)) return null;
  if (tenantOauth.has(connectionId)) return tenantOauth.get(connectionId);
  const credential = connections.credentialFor(connectionId);
  const previous = process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE;
  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = tenantOauthStateFile(connectionId);
  try {
    const instance = createMemoryBridgeOAuth({
      publicUrl: tenantIssuer(connectionId),
      pairingToken: credential,
      clientId: OAUTH_CLIENT_ID,
      redirectHosts: OAUTH_REDIRECT_HOSTS
    });
    tenantOauth.set(connectionId, instance);
    return instance;
  } finally {
    if (previous == null) delete process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE;
    else process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = previous;
  }
}

async function withRequestUrl(req, temporaryUrl, callback) {
  const original = req.url;
  req.url = temporaryUrl;
  try { return await callback(); }
  finally { req.url = original; }
}

function oauthPath(suffix) {
  return suffix === '/authorize'
    || suffix === '/token'
    || suffix === '/register'
    || suffix === '/.well-known/oauth-protected-resource'
    || suffix === '/.well-known/oauth-protected-resource/mcp'
    || suffix === '/.well-known/oauth-authorization-server';
}

function connectionIdFromAccessCode(value) {
  const text = String(value || '').trim();
  if (!text.startsWith('MSB2.')) return null;
  try {
    const payload = JSON.parse(Buffer.from(text.slice(5), 'base64url').toString('utf8'));
    const connectionId = String(payload?.connectionId || '');
    return connections.verify(connectionId, text) ? connectionId : null;
  } catch {
    return null;
  }
}

function replayRequest(req, bodyText, temporaryUrl) {
  const replay = Readable.from([Buffer.from(bodyText, 'utf8')]);
  replay.method = req.method;
  replay.url = temporaryUrl;
  replay.headers = { ...req.headers, 'content-length': String(Buffer.byteLength(bodyText)) };
  return replay;
}

async function readTextBody(req, maxBytes = 64_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('OAuth request is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
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
  if (body?.protocol !== PROTOCOL || Number(body?.version) !== VERSION) throw new Error('Unsupported Memory Bridge protocol');
  if (typeof body?.message !== 'string' || !body.message.trim()) throw new Error('message is required');
  if (body.context != null && typeof body.context !== 'string') throw new Error('context must be a string');
  if (body.history != null && !Array.isArray(body.history)) throw new Error('history must be an array');
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
    ...history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content) })),
    { role: 'user', content: body.message }
  ];
  const response = await fetch(TARGET_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: TARGET_MODEL, messages, temperature: 0.6, stream: false })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `Local model returned HTTP ${response.status}`);
  const reply = data?.choices?.[0]?.message?.content;
  if (!reply) throw new Error('Local model returned no chat message');
  return String(reply);
}

async function handleApi({ req, res, origin, connectionId, oauth, pathName, mcpPath }) {
  if (req.method === 'GET' && pathName === '/v1/oauth/clients') {
    const clients = oauth.listAuthorizedClients();
    sendJson(res, 200, { clients, count: clients.length }, origin);
    return true;
  }
  if (req.method === 'POST' && pathName === '/v1/oauth/clients/revoke') {
    const body = await readBody(req);
    sendJson(res, 200, oauth.revokeClient(body?.clientId), origin);
    return true;
  }
  if (req.method === 'GET' && pathName === '/v1/info') {
    const status = workspaces.status(connectionId);
    sendJson(res, 200, {
      protocol: PROTOCOL,
      version: VERSION,
      name: BRIDGE_NAME,
      model: TARGET_MODEL,
      transport: 'openai-compatible-local-target',
      storesWorkspace: false,
      connection: { isolated: connectionId !== LEGACY_CONNECTION_ID, connectionId: connectionId === LEGACY_CONNECTION_ID ? null : connectionId },
      externalTools: {
        mcp: true,
        endpoint: mcpPath,
        protocolVersion: MCP_VERSION,
        ...status,
        oauth: {
          enabled: true,
          clientId: oauth.clientId,
          authorizationEndpoint: oauth.authorizationEndpoint,
          tokenEndpoint: oauth.tokenEndpoint,
          tokenAuthMethod: 'none',
          pkce: 'S256'
        }
      }
    }, origin);
    return true;
  }
  if (req.method === 'POST' && pathName === '/v1/chat') {
    const body = await readBody(req);
    validateChat(body);
    const requestId = String(body.requestId || crypto.randomUUID());
    console.log(`[bridge] request ${requestId} connection=${connectionId} model=${TARGET_MODEL} contextChars=${String(body.context || '').length}`);
    const reply = await runLocalModel(body);
    sendJson(res, 200, {
      reply,
      model: TARGET_MODEL,
      usedMemoryTitles: [],
      bridge: { protocol: PROTOCOL, version: VERSION, name: BRIDGE_NAME, requestId, storesWorkspace: false }
    }, origin);
    return true;
  }
  if (req.method === 'PUT' && pathName === '/v1/workspace/snapshot') {
    const body = await readBody(req);
    const { workspace, publishedAt } = workspaces.publishWorkspace(connectionId, body);
    console.log(`[bridge] shared connection=${connectionId} activeSpace=${workspace.activeSpaceId} memories=${workspace.memories.length}`);
    sendJson(res, 200, {
      shared: true,
      ephemeral: true,
      storedOnDisk: false,
      publishedAt,
      spaceId: workspace.activeSpaceId,
      memoryCount: workspace.memories.length,
      mcpEndpoint: mcpPath
    }, origin);
    return true;
  }
  if (req.method === 'POST' && pathName === '/v1/workspace/proposals/pull') {
    sendJson(res, 200, { proposals: workspaces.pullProposals(connectionId) }, origin);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || '');
  const requestUrl = new URL(req.url || '/', PUBLIC_URL);
  const tenantRoute = parseTenantPath(requestUrl.pathname);
  const wellKnownTenant = parseWellKnownTenant(requestUrl.pathname);

  try {
    // The proven OAuth consent HTML posts to absolute /authorize. Route an MSB2 credential
    // back into its private tenant issuer instead of the legacy root issuer.
    if (!tenantRoute && req.method === 'POST' && requestUrl.pathname === '/authorize') {
      const bodyText = await readTextBody(req);
      const params = new URLSearchParams(bodyText);
      const connectionId = connectionIdFromAccessCode(params.get('pairing_token'));
      const oauth = connectionId ? getTenantOauth(connectionId) : legacyOauth;
      const replay = replayRequest(req, bodyText, '/authorize');
      if (await oauth.handle(replay, res)) return;
    }

    const oauthRoute = wellKnownTenant || (tenantRoute && oauthPath(tenantRoute.suffix) ? tenantRoute : null);
    if (oauthRoute) {
      const oauth = getTenantOauth(oauthRoute.connectionId);
      if (!oauth) {
        sendJson(res, 404, { error: 'Private connection not found' }, origin);
        return;
      }
      const temporaryUrl = `${oauthRoute.suffix}${requestUrl.search}`;
      const handled = await withRequestUrl(req, temporaryUrl, () => oauth.handle(req, res));
      if (handled) return;
    } else if (!tenantRoute) {
      if (await legacyOauth.handle(req, res)) return;
    }

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

    if (!tenantRoute && requestUrl.pathname === '/v1/connections') {
      if (!isAdminAuthorized(req)) {
        sendJson(res, 401, { error: 'Bridge administrator authorization required' }, origin);
        return;
      }
      if (req.method === 'GET') {
        const items = connections.list();
        sendJson(res, 200, { connections: items, count: items.length }, origin);
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        sendJson(res, 201, connections.create(body?.name || BRIDGE_NAME), origin);
        return;
      }
    }

    if (!tenantRoute && requestUrl.pathname === '/v1/connections/revoke' && req.method === 'POST') {
      if (!isAdminAuthorized(req)) {
        sendJson(res, 401, { error: 'Bridge administrator authorization required' }, origin);
        return;
      }
      const body = await readBody(req);
      const connectionId = String(body?.connectionId || '');
      const result = connections.revoke(connectionId);
      if (result.revoked) {
        tenantOauth.delete(connectionId);
        workspaces.clear(connectionId);
        fs.rmSync(tenantOauthStateFile(connectionId), { force: true });
      }
      sendJson(res, 200, result, origin);
      return;
    }

    if (tenantRoute) {
      const connectionId = tenantRoute.connectionId;
      if (!connections.exists(connectionId)) {
        sendJson(res, 401, { error: 'Private connection is not active' }, origin);
        return;
      }
      const oauth = getTenantOauth(connectionId);
      const mcpPath = `/c/${encodeURIComponent(connectionId)}/mcp`;

      if (tenantRoute.suffix === '/mcp') {
        if (!oauth.isAuthorized(req)) {
          sendJson(res, 401, { error: 'MCP authorization required for this private connection' }, origin, oauth.challengeHeaders);
          return;
        }
        if (req.method === 'GET') {
          sendJson(res, 405, { error: `Standalone SSE stream is not supported; use POST ${mcpPath}` }, origin, { Allow: 'POST', 'MCP-Protocol-Version': MCP_VERSION });
          return;
        }
        if (req.method === 'POST') {
          const body = await readBody(req);
          const scopeCheck = mcpScopeCheck(oauth, req, body);
          if (!scopeCheck.allowed) {
            sendJson(res, 403, { error: scopeCheck.error, requiredScope: scopeCheck.requiredScope || null }, origin, { 'MCP-Protocol-Version': MCP_VERSION });
            return;
          }
          const response = workspaces.handleMcp(connectionId, body);
          if (response === null) {
            res.writeHead(202, { ...corsHeaders(origin), 'MCP-Protocol-Version': MCP_VERSION });
            res.end();
            return;
          }
          sendJson(res, 200, response, origin, { 'MCP-Protocol-Version': MCP_VERSION });
          return;
        }
      }

      if (!connections.verify(connectionId, bearer(req))) {
        sendJson(res, 401, { error: 'Private Memory Bridge connection is invalid' }, origin);
        return;
      }
      if (await handleApi({ req, res, origin, connectionId, oauth, pathName: tenantRoute.suffix, mcpPath })) return;
      sendJson(res, 404, { error: 'Not found' }, origin);
      return;
    }

    const legacyMcp = requestUrl.pathname === '/mcp';
    if (legacyMcp) {
      const adminAuthorized = isAdminAuthorized(req);
      if (!adminAuthorized && !legacyOauth.isAuthorized(req)) {
        sendJson(res, 401, { error: 'MCP authorization required' }, origin, legacyOauth.challengeHeaders);
        return;
      }
      if (req.method === 'GET') {
        sendJson(res, 405, { error: 'Standalone SSE stream is not supported; use POST /mcp' }, origin, { Allow: 'POST', 'MCP-Protocol-Version': MCP_VERSION });
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const scopeCheck = mcpScopeCheck(legacyOauth, req, body, adminAuthorized);
        if (!scopeCheck.allowed) {
          sendJson(res, 403, { error: scopeCheck.error, requiredScope: scopeCheck.requiredScope || null }, origin, { 'MCP-Protocol-Version': MCP_VERSION });
          return;
        }
        const response = workspaces.handleMcp(LEGACY_CONNECTION_ID, body);
        if (response === null) {
          res.writeHead(202, { ...corsHeaders(origin), 'MCP-Protocol-Version': MCP_VERSION });
          res.end();
          return;
        }
        sendJson(res, 200, response, origin, { 'MCP-Protocol-Version': MCP_VERSION });
        return;
      }
    }

    if (!isAdminAuthorized(req)) {
      sendJson(res, 401, { error: 'Bridge pairing token is invalid' }, origin);
      return;
    }
    if (await handleApi({ req, res, origin, connectionId: LEGACY_CONNECTION_ID, oauth: legacyOauth, pathName: requestUrl.pathname, mcpPath: '/mcp' })) return;
    sendJson(res, 404, { error: 'Not found' }, origin);
  } catch (error) {
    console.error(`[bridge] ${error?.message || error}`);
    if (!res.headersSent) sendJson(res, 502, { error: error?.message || 'Bridge request failed' }, origin);
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Memory Bridge ${PROTOCOL}/${VERSION}`);
  console.log(`Listening on http://${HOST}:${PORT}`);
  console.log(`Target: ${TARGET_ENDPOINT}`);
  console.log(`Model: ${TARGET_MODEL}`);
  console.log(`Allowed origins: ${[...ALLOWED_ORIGINS].join(', ')}`);
  console.log(`Legacy MCP endpoint: http://${HOST}:${PORT}/mcp (${MCP_VERSION})`);
  console.log('Customer MCP endpoints: /c/<connectionId>/mcp with isolated OAuth issuers and workspaces.');
  console.log('Published workspaces remain RAM-only; customer connection records and OAuth grants are encrypted on disk.');
});
