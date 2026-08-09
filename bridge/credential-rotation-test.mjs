import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConnectionState, rotateConnectionStateMasterToken } from './connection-state.mjs';
import { createPersistentOAuthState, rotateOAuthStatePairingToken } from './oauth-state.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-bridge-rotation-'));
const connectionStateFile = path.join(tempDir, 'customer-connections.enc.json');
const rootOauthStateFile = path.join(tempDir, 'oauth-state.enc.json');
const tenantOauthStateFile = path.join(tempDir, 'tenant-oauth.enc.json');
const publicUrl = 'https://bridge.test';
const oldMasterToken = `old-${crypto.randomBytes(32).toString('base64url')}`;
const newMasterToken = `new-${crypto.randomBytes(32).toString('base64url')}`;
const clientId = 'memory-space-grok';
const expiresAt = Date.now() + 60 * 60 * 1000;

try {
  process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE = connectionStateFile;
  const before = createConnectionState({ masterToken: oldMasterToken, publicUrl, bridgeName: 'Rotation Test Bridge' });
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
  const rootBefore = createPersistentOAuthState({ issuer: publicUrl, pairingToken: oldMasterToken, clientId });
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

  const connectionRotation = rotateConnectionStateMasterToken({
    stateFile: connectionStateFile,
    oldMasterToken,
    newMasterToken
  });
  assert.equal(connectionRotation.rotated, true);
  assert.equal(connectionRotation.connectionCount, 1);

  const rootRotation = rotateOAuthStatePairingToken({
    stateFile: rootOauthStateFile,
    oldPairingToken: oldMasterToken,
    newPairingToken: newMasterToken
  });
  assert.equal(rootRotation.rotated, true);

  process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE = connectionStateFile;
  const after = createConnectionState({ masterToken: newMasterToken, publicUrl, bridgeName: 'Rotation Test Bridge' });
  assert.equal(after.exists(customer.connectionId), true);
  assert.equal(after.accessCodeFor(customer.connectionId), originalAccessCode, 'MSB2 customer access code must survive master rotation');
  assert.equal(after.verify(customer.connectionId, originalAccessCode), true);

  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = tenantOauthStateFile;
  const tenantAfter = createPersistentOAuthState({
    issuer: `${publicUrl}/c/${encodeURIComponent(customer.connectionId)}`,
    pairingToken: originalAccessCode,
    clientId
  });
  assert.equal(tenantAfter.dynamicClients.has('tenant-client'), true, 'tenant OAuth client must survive admin rotation');
  assert.equal(tenantAfter.accessTokens.has('tenant-access-token'), true, 'tenant OAuth access token must survive admin rotation');
  assert.equal(tenantAfter.refreshTokens.has('tenant-refresh-token'), true, 'tenant OAuth refresh token must survive admin rotation');

  process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE = rootOauthStateFile;
  const rootAfter = createPersistentOAuthState({ issuer: publicUrl, pairingToken: newMasterToken, clientId });
  assert.equal(rootAfter.dynamicClients.has('owner-client'), true, 'owner OAuth client must survive re-encryption');
  assert.equal(rootAfter.accessTokens.has('owner-access-token'), true, 'owner OAuth access token must survive re-encryption');
  assert.equal(rootAfter.refreshTokens.has('owner-refresh-token'), true, 'owner OAuth refresh token must survive re-encryption');

  console.log('PASS credential rotation: MSB2 customer credentials and tenant/root OAuth state survived master-token rotation.');
} finally {
  delete process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE;
  delete process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE;
  fs.rmSync(tempDir, { recursive: true, force: true });
}
