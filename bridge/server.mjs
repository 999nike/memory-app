import http from 'node:http';
import crypto from 'node:crypto';
import { createMemoryBridgeOAuth } from './oauth.mjs';

const PROTOCOL = 'memory-space-bridge';
const VERSION = 1;
const MCP_VERSION = '2026-07-28';
const HOST = process.env.MEMORY_BRIDGE_HOST || '127.0.0.1';
const PORT = Number(process.env.MEMORY_BRIDGE_PORT || 8787);
const TOKEN = process.env.MEMORY_BRIDGE_TOKEN || '';
const BRIDGE_NAME = process.env.MEMORY_BRIDGE_NAME || 'Memory Bridge';
const TARGET_ENDPOINT = process.env.MEMORY_BRIDGE_TARGET || 'http://127.0.0.1:11434/v1/chat/completions';
const TARGET_MODEL = process.env.MEMORY_BRIDGE_MODEL || '';
const PUBLIC_URL = String(process.env.MEMORY_BRIDGE_PUBLIC_URL || 'https://bridge.w-i-z-z-lab-studios.com').replace(/\/+$/, '');
const OAUTH_CLIENT_ID = process.env.MEMORY_BRIDGE_OAUTH_CLIENT_ID || 'memory-space-grok';
const OAUTH_REDIRECT_HOSTS = String(process.env.MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS || 'grok.com,x.ai')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
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

const oauth = createMemoryBridgeOAuth({
  publicUrl: PUBLIC_URL,
  pairingToken: TOKEN,
  clientId: OAUTH_CLIENT_ID,
  redirectHosts: OAUTH_REDIRECT_HOSTS
});

let publishedWorkspace = null;
let publishedWorkspaceAt = null;
let pendingExternalProposals = [];

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin);
  return {
    'Vary': 'Origin',
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

function validatePublishedWorkspace(body) {
  const workspace = body?.workspace;
  if (!workspace || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.memories)) {
    throw new Error('workspace with spaces and memories is required');
  }
  if (workspace.spaces.length !== 1) {
    throw new Error('This proof only accepts one explicitly shared active space');
  }
  const space = workspace.spaces[0];
  if (!space?.id || !space?.name) throw new Error('Shared space id and name are required');
  if (workspace.activeSpaceId !== space.id) throw new Error('activeSpaceId must match the shared space');

  const memories = workspace.memories.map((memory) => ({
    id: String(memory?.id || ''),
    spaceId: String(memory?.spaceId || ''),
    title: String(memory?.title || ''),
    content: String(memory?.content || ''),
    type: String(memory?.type || 'note'),
    importance: String(memory?.importance || 'normal'),
    source: String(memory?.source || ''),
    locked: Boolean(memory?.locked),
    status: String(memory?.status || 'confirmed'),
    createdAt: memory?.createdAt || null,
    updatedAt: memory?.updatedAt || null
  }));

  for (const memory of memories) {
    if (!memory.id || !memory.title || !memory.content) throw new Error('Every shared memory needs id, title, and content');
    if (memory.spaceId !== space.id) throw new Error('Shared memories must belong to the shared space');
    if (memory.status !== 'confirmed') throw new Error('Only current confirmed memories may be published');
  }

  return {
    version: Number(workspace.version || 1),
    activeSpaceId: space.id,
    spaces: [{
      id: String(space.id),
      name: String(space.name),
      description: String(space.description || ''),
      createdAt: space.createdAt || null,
      updatedAt: space.updatedAt || null
    }],
    memories
  };
}

function requireWorkspace() {
  if (!publishedWorkspace) throw new Error('No Memory Space is currently shared with external AI tools');
  return publishedWorkspace;
}

function activePublishedSpace() {
  const workspace = requireWorkspace();
  return workspace.spaces.find((space) => space.id === workspace.activeSpaceId) || workspace.spaces[0];
}

function activePublishedMemories() {
  const workspace = requireWorkspace();
  return workspace.memories.filter((memory) => memory.spaceId === workspace.activeSpaceId && memory.status === 'confirmed');
}

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: typeof value === 'string' ? undefined : value };
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: String(message) }] };
}

function buildCurrentContext() {
  const space = activePublishedSpace();
  const memories = activePublishedMemories();
  const lines = [
    `SPACE: ${space.name}`,
    `PURPOSE: ${space.description}`,
    '',
    'CURRENT CONFIRMED MEMORY:'
  ];
  if (!memories.length) lines.push('- None shared.');
  for (const memory of memories) {
    lines.push(`- [${memory.importance.toUpperCase()}] [${memory.type.toUpperCase()}] ${memory.title}`);
    lines.push(`  ${memory.content}`);
    if (memory.source) lines.push(`  Source: ${memory.source}`);
    if (memory.locked) lines.push('  Locked by user: yes');
  }
  return lines.join('\n');
}

const MCP_TOOLS = [
  {
    name: 'list_spaces',
    description: 'List the Memory Spaces the user explicitly shared with this external AI connection.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'search_memory',
    description: 'Search current confirmed memory in the explicitly shared Memory Space.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', minLength: 1 } },
      required: ['query'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_current_space_context',
    description: 'Return the focused current confirmed context for the explicitly shared Memory Space.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'read_memory',
    description: 'Read one current confirmed memory by id, including its provenance fields.',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string', minLength: 1 } },
      required: ['memory_id'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_current_decisions',
    description: 'Return current confirmed decision memories in the explicitly shared Memory Space.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'inspect_provenance',
    description: 'Inspect the recorded source/provenance for one current confirmed memory.',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string', minLength: 1 } },
      required: ['memory_id'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'propose_memory',
    description: 'Leave a proposed memory for the user to review in Memory Space. This does not approve or permanently save it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100 },
        content: { type: 'string', minLength: 1, maxLength: 2000 },
        type: { type: 'string', enum: ['decision', 'fact', 'goal', 'question', 'note'] },
        importance: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
        reason: { type: 'string', maxLength: 500 }
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }
];

function callMcpTool(name, args = {}) {
  const memories = () => activePublishedMemories();

  switch (name) {
    case 'list_spaces': {
      const workspace = requireWorkspace();
      return textResult({
        publishedAt: publishedWorkspaceAt,
        spaces: workspace.spaces.map((space) => ({
          id: space.id,
          name: space.name,
          description: space.description,
          active: space.id === workspace.activeSpaceId,
          memoryCount: workspace.memories.filter((memory) => memory.spaceId === space.id).length
        }))
      });
    }
    case 'search_memory': {
      const query = String(args.query || '').trim().toLowerCase();
      if (!query) return toolError('query is required');
      const results = memories().filter((memory) =>
        [memory.title, memory.content, memory.source, memory.type, memory.importance]
          .some((value) => String(value || '').toLowerCase().includes(query))
      );
      return textResult({ query, count: results.length, memories: results });
    }
    case 'get_current_space_context':
      return textResult(buildCurrentContext());
    case 'read_memory': {
      const id = String(args.memory_id || '');
      const memory = memories().find((item) => item.id === id);
      return memory ? textResult(memory) : toolError('Memory not found in the currently shared space');
    }
    case 'get_current_decisions': {
      const decisions = memories().filter((memory) => memory.type === 'decision');
      return textResult({ count: decisions.length, decisions });
    }
    case 'inspect_provenance': {
      const id = String(args.memory_id || '');
      const memory = memories().find((item) => item.id === id);
      if (!memory) return toolError('Memory not found in the currently shared space');
      return textResult({
        id: memory.id,
        title: memory.title,
        source: memory.source || null,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
        locked: memory.locked,
        status: memory.status
      });
    }
    case 'propose_memory': {
      requireWorkspace();
      const title = String(args.title || '').trim();
      const content = String(args.content || '').trim();
      if (!title || !content) return toolError('title and content are required');
      const proposal = {
        id: `external_${crypto.randomUUID()}`,
        spaceId: activePublishedSpace().id,
        title: title.slice(0, 100),
        content: content.slice(0, 2000),
        type: ['decision', 'fact', 'goal', 'question', 'note'].includes(args.type) ? args.type : 'note',
        importance: ['critical', 'high', 'normal', 'low'].includes(args.importance) ? args.importance : 'normal',
        reason: String(args.reason || 'External AI suggested this as durable context.').slice(0, 500),
        status: 'pending',
        sourceKind: 'external-mcp',
        createdAt: new Date().toISOString()
      };
      pendingExternalProposals.push(proposal);
      return textResult({
        acceptedAsProposal: true,
        proposalId: proposal.id,
        message: 'Proposal queued for human review. It is not confirmed memory.'
      });
    }
    default:
      return toolError(`Unknown tool: ${name}`);
  }
}

function handleMcp(body) {
  const id = body?.id ?? null;
  const method = String(body?.method || '');
  const protocolVersion = body?.params?.protocolVersion || MCP_VERSION;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'memory-space', version: '0.1.0' }
      }
    };
  }
  if (method === 'notifications/initialized') return null;
  if (method === 'server/discover') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_VERSION,
        serverInfo: { name: 'memory-space', version: '0.1.0' },
        capabilities: { tools: {} }
      }
    };
  }
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS, ttlMs: 60_000, cacheScope: 'private' }
    };
  }
  if (method === 'tools/call') {
    const name = String(body?.params?.name || '');
    try {
      const result = callMcpTool(name, body?.params?.arguments || {});
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      return { jsonrpc: '2.0', id, result: toolError(error?.message || 'Tool call failed') };
    }
  }
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` }
  };
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
  const requestUrl = new URL(req.url || '/', PUBLIC_URL);

  if (await oauth.handle(req, res)) return;

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

  const mcpRequest = requestUrl.pathname === '/mcp';
  if (mcpRequest) {
    if (!isAuthorized(req) && !oauth.isAuthorized(req)) {
      sendJson(res, 401, { error: 'MCP authorization required' }, origin, oauth.challengeHeaders);
      return;
    }
  } else if (!isAuthorized(req)) {
    sendJson(res, 401, { error: 'Bridge pairing token is invalid' }, origin);
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/v1/oauth/clients') {
      const clients = oauth.listAuthorizedClients();
      sendJson(res, 200, { clients, count: clients.length }, origin);
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/oauth/clients/revoke') {
      const body = await readBody(req);
      const result = oauth.revokeClient(body?.clientId);
      sendJson(res, 200, result, origin);
      return;
    }

    if (req.method === 'GET' && req.url === '/v1/info') {
      sendJson(res, 200, {
        protocol: PROTOCOL,
        version: VERSION,
        name: BRIDGE_NAME,
        model: TARGET_MODEL,
        transport: 'openai-compatible-local-target',
        storesWorkspace: false,
        externalTools: {
          mcp: true,
          endpoint: '/mcp',
          protocolVersion: MCP_VERSION,
          workspacePublishedInMemory: Boolean(publishedWorkspace),
          pendingProposals: pendingExternalProposals.length,
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

    if (req.method === 'PUT' && req.url === '/v1/workspace/snapshot') {
      const body = await readBody(req);
      publishedWorkspace = validatePublishedWorkspace(body);
      publishedWorkspaceAt = new Date().toISOString();
      pendingExternalProposals = pendingExternalProposals.filter((proposal) => proposal.spaceId === publishedWorkspace.activeSpaceId);
      console.log(`[bridge] shared active space ${publishedWorkspace.activeSpaceId} memories=${publishedWorkspace.memories.length}`);
      sendJson(res, 200, {
        shared: true,
        ephemeral: true,
        storedOnDisk: false,
        publishedAt: publishedWorkspaceAt,
        spaceId: publishedWorkspace.activeSpaceId,
        memoryCount: publishedWorkspace.memories.length,
        mcpEndpoint: '/mcp'
      }, origin);
      return;
    }

    if (req.method === 'POST' && req.url === '/v1/workspace/proposals/pull') {
      const proposals = pendingExternalProposals;
      pendingExternalProposals = [];
      sendJson(res, 200, { proposals }, origin);
      return;
    }

    if (req.method === 'GET' && req.url === '/mcp') {
      sendJson(res, 405, { error: 'Standalone SSE stream is not supported; use POST /mcp' }, origin, {
        Allow: 'POST',
        'MCP-Protocol-Version': MCP_VERSION
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/mcp') {
      const body = await readBody(req);
      const response = handleMcp(body);
      if (response === null) {
        res.writeHead(202, { ...corsHeaders(origin), 'MCP-Protocol-Version': MCP_VERSION });
        res.end();
        return;
      }
      sendJson(res, 200, response, origin, { 'MCP-Protocol-Version': MCP_VERSION });
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
  console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp (${MCP_VERSION})`);
  console.log(`OAuth: ${oauth.authorizationEndpoint} -> ${oauth.tokenEndpoint} client=${oauth.clientId} PKCE=S256`);
  console.log('Workspace and OAuth grants are held in RAM only; they are not written to disk by the bridge.');
});
