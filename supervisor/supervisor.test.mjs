import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createSupervisor } from './server.mjs';
import { ensureCapability, loadSource, saveSource } from './runtime.mjs';

const temporaryDirectories = [];
after(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wizz-supervisor-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function startTestSupervisor() {
  const capability = 'test-capability-that-is-at-least-forty-three-characters-long';
  let activeSource = null;
  const server = createSupervisor({
    capability,
    loadActiveSource: () => activeSource,
    saveActiveSource: (source) => {
      activeSource = source;
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    capability,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('runtime persists an encrypted active source and a stable capability', () => {
  const directory = temporaryDirectory();
  const capabilityFile = path.join(directory, 'service-capability');
  const stateFile = path.join(directory, 'office-source.enc.json');
  const capability = ensureCapability(capabilityFile);
  const source = {
    connectionId: 'conn_abcdefgh',
    sourceName: 'Test Bridge',
    feedUrl: 'http://127.0.0.1:8787/c/conn_abcdefgh/v1/jobs',
    feedToken: 'private-feed-token-value',
    authorisedAt: '2026-09-03T00:00:00.000Z',
  };

  saveSource(source, capability, stateFile);
  assert.deepEqual(loadSource(capability, stateFile), source);
  assert.equal(fs.readFileSync(stateFile, 'utf8').includes(source.feedToken), false);
  assert.equal(ensureCapability(capabilityFile), capability);
});

test('health is bounded and secret APIs reject browser-origin and unauthorised requests', async () => {
  const supervisor = await startTestSupervisor();
  try {
    const healthResponse = await fetch(`${supervisor.baseUrl}/v1/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.status, 200);
    assert.equal(health.protocol, 'wizz-supervisor');
    assert.equal(health.feedAvailable, false);
    assert.equal(JSON.stringify(health).includes('feedToken'), false);

    assert.equal((await fetch(`${supervisor.baseUrl}/v1/office-source`)).status, 401);
    const browserRequest = await fetch(`${supervisor.baseUrl}/v1/office-source`, {
      headers: {
        Authorization: `Bearer ${supervisor.capability}`,
        Origin: 'http://127.0.0.1:8001',
      },
    });
    assert.equal(browserRequest.status, 403);
    assert.equal(browserRequest.headers.has('access-control-allow-origin'), false);
  } finally {
    await supervisor.close();
  }
});

test('server clients register one scoped source without exposing it in the response', async () => {
  const supervisor = await startTestSupervisor();
  const connectionId = 'conn_abcdefgh';
  const feedToken = 'private-feed-token-value';
  const headers = {
    Authorization: `Bearer ${supervisor.capability}`,
    'Content-Type': 'application/json',
  };
  const register = (body) => fetch(`${supervisor.baseUrl}/v1/office-source`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  try {
    const registrationResponse = await register({
      connectionId,
      sourceName: 'WIZZ HP Bridge',
      feedUrl: `http://127.0.0.1:8787/c/${connectionId}/v1/jobs`,
      feedToken,
    });
    const registration = await registrationResponse.json();
    assert.equal(registrationResponse.status, 200);
    assert.equal(registration.authorised, true);
    assert.equal(registration.feedAvailable, true);
    assert.equal(JSON.stringify(registration).includes(feedToken), false);
    assert.equal(Object.hasOwn(registration, 'feedUrl'), false);

    const sourceResponse = await fetch(`${supervisor.baseUrl}/v1/office-source`, {
      headers: { Authorization: `Bearer ${supervisor.capability}` },
    });
    const source = await sourceResponse.json();
    assert.equal(sourceResponse.status, 200);
    assert.equal(source.connectionId, connectionId);
    assert.equal(source.feedToken, feedToken);

    assert.equal((await register({
      connectionId: 'conn_other123',
      feedUrl: `http://127.0.0.1:8787/c/${connectionId}/v1/jobs`,
      feedToken,
    })).status, 400);

    assert.equal((await register({
      connectionId,
      feedUrl: `http://192.168.1.8:8787/c/${connectionId}/v1/jobs`,
      feedToken,
    })).status, 400);

    assert.equal((await register({
      connectionId,
      feedUrl: `https://bridge.w-i-z-z-lab-studios.com/c/${connectionId}/v1/jobs`,
      feedToken,
    })).status, 200);
  } finally {
    await supervisor.close();
  }
});
