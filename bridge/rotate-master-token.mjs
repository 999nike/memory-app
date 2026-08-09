import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rotateConnectionStateMasterToken } from './connection-state.mjs';
import { rotateOAuthStatePairingToken } from './oauth-state.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const oldMasterToken = String(process.env.MEMORY_BRIDGE_OLD_TOKEN || '');
const newMasterToken = String(process.env.MEMORY_BRIDGE_NEW_TOKEN || '');
const connectionStateFile = path.resolve(
  String(process.env.MEMORY_BRIDGE_CONNECTION_STATE_FILE || path.join(moduleDir, '.state', 'customer-connections.enc.json'))
);
const oauthStateFile = path.resolve(
  String(process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE || path.join(moduleDir, '.state', 'oauth-state.enc.json'))
);

if (!oldMasterToken || !newMasterToken) {
  console.error('MEMORY_BRIDGE_OLD_TOKEN and MEMORY_BRIDGE_NEW_TOKEN are required.');
  process.exit(1);
}

try {
  const connections = rotateConnectionStateMasterToken({
    stateFile: connectionStateFile,
    oldMasterToken,
    newMasterToken
  });
  const oauth = rotateOAuthStatePairingToken({
    stateFile: oauthStateFile,
    oldPairingToken: oldMasterToken,
    newPairingToken: newMasterToken
  });
  console.log(JSON.stringify({
    rotated: true,
    customerConnections: connections.connectionCount,
    customerRegistryRotated: connections.rotated,
    ownerOauthRotated: oauth.rotated,
    ownerOauthClients: oauth.dynamicClients || 0,
    ownerAccessTokens: oauth.accessTokens || 0,
    ownerRefreshTokens: oauth.refreshTokens || 0
  }));
} catch (error) {
  console.error(`Credential rotation failed: ${error?.message || error}`);
  process.exit(1);
}
