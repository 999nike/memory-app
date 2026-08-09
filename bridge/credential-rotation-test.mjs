import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createConnectionState } from './connection-state.mjs';
import { createPersistentOAuthState } from './oauth-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-bridge-rotation-'));
const connectionStateFile = path.join(tempDir, 'customer-connections.enc.json');
const rootOauthStateFile = path.join(tempDir, 'oauth-state.enc.json');
const tenantOauthStateFile = path.join(tempDir, 'tenant-oauth.enc.json');
const publicUrl = 'https://bridge.test';
const ownerToken = `owner-${crypto.randomBytes(32).toString('base64url')}`;
const oldAdminToken = ownerToken;
const newAdminToken = `admin-${crypto.randomBytes(32).toString('base64url')}`;
const clientId = 'memory-space-grok';
const expiresAt = Date.now() + 60 * 60 * 1000;

try {
  process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE = connectionStateFile;
  const before = createConnectionState({ masterToken: oldAdminToken, publicUrl, bridgeName: 'Rotation Test Bridge' });
  const customer = before.create('Plumber');
  const originalAccessCode = customer.accessCode;
  assert.ok(originalAccessCode.startsWith('MSB2.'));
  assert.equal(before.verify(customer.connectionId, originalAccessCode), true);

  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = tenantOauthStateFile;
  const tenantBefore = createPersistentOAuthState({
    issuer: `${publicUrl}/c/${encodeURIComponent(customer.connectionId)}`,
    pairingToken: originalAccessCode,
    clientId
  });
  tenantBefore.dynamicClients.set('tenant-client', { clientName: 'Claude', createdAt: Date.now() });
  tenantBefore.accessTokens.set('tenant-access-token', {
    clientId: 'tenant-client',
    scope: 'memory.read memory.propose',
    expiresAt
  });
  tenantBefore.refreshTokens.set('tenant-refresh-token', {
    clientId: 'tenant-client',
    scope: 'memory.read memory.propose',
    expiresAt
  });
  tenantBefore.flush();

  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = rootOauthStateFile;
  const rootBefore = createPersistentOAuthState({ issuer: publicUrl, pairingToken: ownerToken, clientId });
  rootBefore.dynamicClients.set('owner-client', { clientName: 'Grok', createdAt: Date.now() });
  rootBefore.accessTokens.set('owner-access-token', {
    clientId: 'owner-client',
    scope: 'memory.read memory.propose',
    expiresAt
  });
  rootBefore.refreshTokens.set('owner-refresh-token', {
    clientId: 'owner-client',
    scope: 'memory.read memory.propose',
    expiresAt
  });
  rootBefore.flush();

  const rotation = spawnSync(process.execPath, [path.join(HERE, 'rotate-master-token.mjs')], {
    cwd: HERE,
    env: {
      ...process.env,
      MEMORY_BRIDGE_OLD_TOKEN: oldAdminToken,
      MEMORY_BRIDGE_NEW_TOKEN: newAdminToken,
      MEMORY_BRIDGE_CONNECTION_STATE_FILE: connectionStateFile,
      MEMORY_BRIDGE_OAUTH_STATE_FILE: rootOauthStateFile,
      MEMORY_BRIDGE_ROTATE_OWNER_OAUTH: '0'
    },
    encoding: 'utf8'
  });
  assert.equal(rotation.status, 0, rotation.stderr || rotation.stdout);
  const rotationResult = JSON.parse(String(rotation.stdout || '').trim());
  assert.equal(rotationResult.rotated, true);
  assert.equal(rotationResult.customerConnections, 1);
  assert.equal(rotationResult.ownerOauthRotationRequested, false);
  assert.equal(rotationResult.ownerOauthRotated, false);

  process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE = connectionStateFile;
  const after = createConnectionState({ masterToken: newAdminToken, publicUrl, bridgeName: 'Rotation Test Bridge' });
  assert.equal(after.exists(customer.connectionId), true);
  assert.equal(after.accessCodeFor(customer.connectionId), originalAccessCode, 'MSB2 customer access code must survive administrator rotation');
  assert.equal(after.verify(customer.connectionId, originalAccessCode), true);

  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = tenantOauthStateFile;
  const tenantAfter = createPersistentOAuthState({
    issuer: `${publicUrl}/c/${encodeURIComponent(customer.connectionId)}`,
    pairingToken: originalAccessCode,
    clientId
  });
  assert.equal(tenantAfter.dynamicClients.has('tenant-client'), true, 'tenant OAuth client must survive administrator rotation');
  assert.equal(tenantAfter.accessTokens.has('tenant-access-token'), true, 'tenant OAuth access token must survive administrator rotation');
  assert.equal(tenantAfter.refreshTokens.has('tenant-refresh-token'), true, 'tenant OAuth refresh token must survive administrator rotation');

  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = rootOauthStateFile;
  const rootAfter = createPersistentOAuthState({ issuer: publicUrl, pairingToken: ownerToken, clientId });
  assert.equal(rootAfter.dynamicClients.has('owner-client'), true, 'owner OAuth client must remain on the retained owner credential');
  assert.equal(rootAfter.accessTokens.has('owner-access-token'), true, 'owner OAuth access token must survive administrator rotation untouched');
  assert.equal(rootAfter.refreshTokens.has('owner-refresh-token'), true, 'owner OAuth refresh token must survive administrator rotation untouched');

  console.log('PASS administrator rotation: owner access stayed stable, MSB2 customer credentials survived, and tenant/root OAuth state remained usable.');
} finally {
  delete process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE;
  delete process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
