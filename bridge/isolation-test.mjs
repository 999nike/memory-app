import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const port = 19000 + (process.pid % 1000);
const localBase = `http://127.0.0.1:${port}`;
const publicBase = 'https://bridge.test';
const ownerToken = `owner-${crypto.randomBytes(32).toString('hex')}`;
const adminToken = `admin-${crypto.randomBytes(32).toString('hex')}`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-bridge-isolation-'));
const stateFile = path.join(stateDir, 'oauth-state.enc.json');

const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
  cwd: HERE,
  env: {
    ...process.env,
    MEMORY_BRIDGE_HOST: '127.0.0.1',
    MEMORY_BRIDGE_PORT: String(port),
    MEMORY_BRIDGE_TOKEN: ownerToken,
    MEMORY_BRIDGE_OWNER_TOKEN: ownerToken,
    MEMORY_BRIDGE_ADMIN_TOKEN: adminToken,
    MEMORY_BRIDGE_NAME: 'Isolation Test Bridge',
    MEMORY_BRIDGE_MODEL: 'test-model',
    MEMORY_BRIDGE_TARGET: 'http://127.0.0.1:9/v1/chat/completions',
    MEMORY_BRIDGE_PUBLIC_URL: publicBase,
    MEMORY_BRIDGE_OAUTH_CLIENT_ID: 'memory-space-grok',
    MEMORY_BRIDGE_OAUTH_REDIRECT_HOSTS: 'example.com',
    MEMORY_BRIDGE_ORIGINS: 'https://memory-app.example',
    MEMORY_BRIDGE_OAUTH_STATE_FILE: stateFile,
    MEMORY_BRIDGE_CONNECTION_STATE_FILE: path.join(stateDir, 'connections.enc.json'),
    MEMORY_BRIDGE_TENANT_OAUTH_DIR: path.join(stateDir, 'tenant-oauth')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

function adminHeaders() {
  return { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
}

function ownerHeaders() {
  return { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' };
}

function connectionHeaders(connection) {
  return {
    Authorization: `Bearer ${connection.accessCode}`,
    'Content-Type': 'application/json'
  };
}

function connectionBase(connection) {
  return `${localBase}/c/${encodeURIComponent(connection.connectionId)}`;
}

async function json(response) {
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function waitForBridge() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${localBase}/v1/info`, { headers: adminHeaders() });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Bridge did not start\n${logs}`);
}

async function createConnection(name) {
  const { response, data } = await json(await fetch(`${localBase}/v1/connections`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ name })
  }));
  assert.equal(response.status, 201, JSON.stringify(data));
  assert.match(data.connectionId, /^conn_/);
  assert.ok(data.accessCode);
  return data;
}

function workspace(owner) {
  const spaceId = `space_${owner.toLowerCase()}`;
  return {
    version: 1,
    activeSpaceId: spaceId,
    spaces: [{ id: spaceId, name: `${owner} Space`, description: `${owner} private test` }],
    memories: [{
      id: `memory_${owner.toLowerCase()}`,
      spaceId,
      title: `OWNER = ${owner}`,
      content: `OWNER = ${owner}`,
      type: 'fact',
      importance: 'critical',
      source: 'isolation-test',
      locked: true,
      status: 'confirmed'
    }]
  };
}

async function publish(connection, owner) {
  const { response, data } = await json(await fetch(`${connectionBase(connection)}/v1/workspace/snapshot`, {
    method: 'PUT',
    headers: connectionHeaders(connection),
    body: JSON.stringify({ workspace: workspace(owner) })
  }));
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.equal(data.spaceId, `space_${owner.toLowerCase()}`);
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function issueOAuthToken(connection, scope = 'memory.read memory.propose') {
  const redirectUri = 'https://example.com/callback';
  const resource = `${publicBase}/c/${encodeURIComponent(connection.connectionId)}/mcp`;
  const { verifier, challenge } = pkce();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'memory-space-grok',
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope,
    resource,
    pairing_token: connection.accessCode
  });
  const authorize = await fetch(`${localBase}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
    redirect: 'manual'
  });
  assert.equal(authorize.status, 302, await authorize.text());
  const location = authorize.headers.get('location');
  assert.ok(location);
  const code = new URL(location).searchParams.get('code');
  assert.ok(code);

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: 'memory-space-grok',
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource
  });
  const { response, data } = await json(await fetch(`${connectionBase(connection)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody
  }));
  assert.equal(response.status, 200, JSON.stringify(data));
  assert.ok(data.access_token);
  assert.equal(data.scope, scope);
  return data.access_token;
}

async function mcp(connection, token, name, args = {}) {
  const response = await fetch(`${localBase}/c/${encodeURIComponent(connection.connectionId)}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: { name, arguments: args }
    })
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function structured(result) {
  return result?.data?.result?.structuredContent;
}

try {
  await waitForBridge();

  const ownerInfo = await json(await fetch(`${localBase}/v1/info`, { headers: ownerHeaders() }));
  assert.equal(ownerInfo.response.status, 200, 'owner credential must keep legacy owner bridge working');

  const ownerCannotCreateCustomer = await json(await fetch(`${localBase}/v1/connections`, {
    method: 'POST',
    headers: ownerHeaders(),
    body: JSON.stringify({ name: 'Must not be created' })
  }));
  assert.equal(ownerCannotCreateCustomer.response.status, 401, 'owner credential must not have administrator connection-management rights');

  const nike = await createConnection('Nike');
  const plumber = await createConnection('Plumber');
  assert.notEqual(nike.connectionId, plumber.connectionId);
  assert.notEqual(nike.accessCode, plumber.accessCode);

  await publish(nike, 'NIKE');
  await publish(plumber, 'PLUMBER');

  const nikeToken = await issueOAuthToken(nike);
  const plumberToken = await issueOAuthToken(plumber);

  const nikeOwn = await mcp(nike, nikeToken, 'search_memory', { query: 'OWNER = NIKE' });
  assert.equal(nikeOwn.response.status, 200);
  assert.equal(structured(nikeOwn)?.count, 1);

  const plumberOwn = await mcp(plumber, plumberToken, 'search_memory', { query: 'OWNER = PLUMBER' });
  assert.equal(plumberOwn.response.status, 200);
  assert.equal(structured(plumberOwn)?.count, 1);

  const nikeCannotSeePlumber = await mcp(nike, nikeToken, 'search_memory', { query: 'OWNER = PLUMBER' });
  assert.equal(nikeCannotSeePlumber.response.status, 200);
  assert.equal(structured(nikeCannotSeePlumber)?.count, 0);

  const plumberCannotSeeNike = await mcp(plumber, plumberToken, 'search_memory', { query: 'OWNER = NIKE' });
  assert.equal(plumberCannotSeeNike.response.status, 200);
  assert.equal(structured(plumberCannotSeeNike)?.count, 0);

  const crossedPath = await mcp(plumber, nikeToken, 'search_memory', { query: 'OWNER' });
  assert.equal(crossedPath.response.status, 401, 'Nike token must be rejected on Plumber MCP route');

  const readOnlyToken = await issueOAuthToken(plumber, 'memory.read');
  const readOnlyRead = await mcp(plumber, readOnlyToken, 'search_memory', { query: 'OWNER = PLUMBER' });
  assert.equal(readOnlyRead.response.status, 200, 'memory.read must allow read tools');
  assert.equal(structured(readOnlyRead)?.count, 1);
  const readOnlyPropose = await mcp(plumber, readOnlyToken, 'propose_memory', { title: 'Denied proposal', content: 'Read-only token must not propose.' });
  assert.equal(readOnlyPropose.response.status, 403, 'memory.read alone must not allow propose_memory');
  assert.equal(readOnlyPropose.data.requiredScope, 'memory.propose');

  const proposeOnlyToken = await issueOAuthToken(plumber, 'memory.propose');
  const proposeOnlyProposal = await mcp(plumber, proposeOnlyToken, 'propose_memory', { title: 'Scoped proposal', content: 'Proposal-only token may submit for human review.' });
  assert.equal(proposeOnlyProposal.response.status, 200, 'memory.propose must allow propose_memory');
  assert.equal(structured(proposeOnlyProposal)?.acceptedAsProposal, true);
  const proposeOnlyRead = await mcp(plumber, proposeOnlyToken, 'search_memory', { query: 'OWNER = PLUMBER' });
  assert.equal(proposeOnlyRead.response.status, 403, 'memory.propose alone must not allow read tools');
  assert.equal(proposeOnlyRead.data.requiredScope, 'memory.read');

  const undeclaredTool = await mcp(plumber, plumberToken, 'future_unscoped_tool', {});
  assert.equal(undeclaredTool.response.status, 403, 'MCP tools without a declared scope must fail closed');

  const revoke = await json(await fetch(`${localBase}/v1/connections/revoke`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ connectionId: nike.connectionId })
  }));
  assert.equal(revoke.response.status, 200);
  assert.equal(revoke.data.revoked, true);

  const nikeAfterRevoke = await mcp(nike, nikeToken, 'search_memory', { query: 'OWNER = NIKE' });
  assert.equal(nikeAfterRevoke.response.status, 401, 'Revoked Nike connection must stop working');

  const plumberAfterNikeRevoke = await mcp(plumber, plumberToken, 'search_memory', { query: 'OWNER = PLUMBER' });
  assert.equal(plumberAfterNikeRevoke.response.status, 200, 'Plumber must remain working after Nike revocation');
  assert.equal(structured(plumberAfterNikeRevoke)?.count, 1);

  console.log('PASS owner/admin split + customer isolation + MCP scopes: owner stayed compatible without admin rights; customer data stayed separate; revocation and permissions remained scoped.');
} finally {
  child.kill('SIGTERM');
  fs.rmSync(stateDir, { recursive: true, force: true });
}
