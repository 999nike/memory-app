import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 20000 + (process.pid % 1000);
const localBase = `http://127.0.0.1:${port}`;
const ownerToken = `owner-${crypto.randomBytes(24).toString('hex')}`;
const adminToken = `admin-${crypto.randomBytes(24).toString('hex')}`;
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-job-feed-api-'));
const child = spawn(process.execPath, [path.join(here, 'server.mjs')], {
  cwd: here,
  env: {
    ...process.env,
    MEMORY_BRIDGE_HOST: '127.0.0.1',
    MEMORY_BRIDGE_PORT: String(port),
    MEMORY_BRIDGE_TOKEN: ownerToken,
    MEMORY_BRIDGE_OWNER_TOKEN: ownerToken,
    MEMORY_BRIDGE_ADMIN_TOKEN: adminToken,
    MEMORY_BRIDGE_MODEL: 'test-model',
    MEMORY_BRIDGE_TARGET: 'http://127.0.0.1:9/v1/chat/completions',
    MEMORY_BRIDGE_PUBLIC_URL: 'https://bridge.test',
    MEMORY_BRIDGE_ORIGINS: 'https://memory-app.example',
    MEMORY_BRIDGE_CONNECTION_STATE_FILE: path.join(stateDir, 'connections.enc.json'),
    MEMORY_BRIDGE_TENANT_OAUTH_DIR: path.join(stateDir, 'tenant-oauth')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk.toString(); });
child.stderr.on('data', (chunk) => { logs += chunk.toString(); });

async function json(url, options = {}) {
  const response = await fetch(url, options);
  return { response, data: await response.json().catch(() => ({})) };
}

async function waitForBridge() {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const result = await json(`${localBase}/v1/info`, { headers: { Authorization: `Bearer ${adminToken}` } });
      if (result.response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Bridge did not start\n${logs}`);
}

async function createConnection(name) {
  const result = await json(`${localBase}/v1/connections`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return result.data;
}

function workspace(owner) {
  const spaceId = `space_${owner}`;
  return {
    version: 1,
    activeSpaceId: spaceId,
    spaces: [{ id: spaceId, name: `${owner} Space` }],
    memories: [{
      id: `job_${owner}`,
      spaceId,
      title: `${owner} job`,
      content: `Work only for ${owner}`,
      details: `Work only for ${owner}`,
      type: 'job',
      importance: 'normal',
      project: 'agent-sandbox-test',
      priority: 'normal',
      createdBy: 'user',
      status: 'ready',
      officeCollectedAt: null,
      officeJobId: null
    }]
  };
}

function tenantBase(connection) {
  return `${localBase}/c/${encodeURIComponent(connection.connectionId)}`;
}

function connectionHeaders(connection) {
  return { Authorization: `Bearer ${connection.accessCode}`, 'Content-Type': 'application/json' };
}

try {
  await waitForBridge();
  const alpha = await createConnection('Alpha');
  const beta = await createConnection('Beta');

  for (const [connection, owner] of [[alpha, 'alpha'], [beta, 'beta']]) {
    const published = await json(`${tenantBase(connection)}/v1/workspace/snapshot`, {
      method: 'PUT', headers: connectionHeaders(connection), body: JSON.stringify({ workspace: workspace(owner) })
    });
    assert.equal(published.response.status, 200, JSON.stringify(published.data));
  }

  const access = await json(`${tenantBase(alpha)}/v1/jobs/access`, {
    method: 'POST', headers: connectionHeaders(alpha), body: '{}'
  });
  assert.equal(access.response.status, 200, JSON.stringify(access.data));
  const feedHeaders = { Authorization: `Bearer ${access.data.token}`, 'Content-Type': 'application/json' };

  const alphaJobs = await json(`${localBase}/c/${alpha.connectionId}/v1/jobs/ready`, { headers: feedHeaders });
  assert.equal(alphaJobs.response.status, 200);
  assert.deepEqual(alphaJobs.data.jobs.map((job) => job.id), ['job_alpha']);

  const crossedCustomer = await json(`${localBase}/c/${beta.connectionId}/v1/jobs/ready`, { headers: feedHeaders });
  assert.equal(crossedCustomer.response.status, 401, 'one customer feed token must not read another customer');

  const broaderApi = await json(`${tenantBase(alpha)}/v1/info`, { headers: feedHeaders });
  assert.equal(broaderApi.response.status, 401, 'Office feed token must not grant general Memory Bridge access');

  const acknowledged = await json(`${localBase}/c/${alpha.connectionId}/v1/jobs/job_alpha/collected`, {
    method: 'POST', headers: feedHeaders, body: JSON.stringify({ officeJobId: 'office-1' })
  });
  assert.equal(acknowledged.response.status, 200, JSON.stringify(acknowledged.data));

  const after = await json(`${localBase}/c/${alpha.connectionId}/v1/jobs/ready`, { headers: feedHeaders });
  assert.equal(after.data.count, 0);

  const staleRepublish = await json(`${tenantBase(alpha)}/v1/workspace/snapshot`, {
    method: 'PUT', headers: connectionHeaders(alpha), body: JSON.stringify({ workspace: workspace('alpha') })
  });
  assert.deepEqual(staleRepublish.data.jobAcknowledgements.map((item) => item.officeJobId), ['office-1']);

  console.log('PASS scoped Office feed token + customer isolation + acknowledgement recovery.');
} finally {
  child.kill();
  fs.rmSync(stateDir, { recursive: true, force: true });
}
