import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rotateOAuthStatePairingToken } from './oauth-state.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const oldOwnerToken = String(process.env.MEMORY_BRIDGE_OLD_OWNER_TOKEN || '');
const newOwnerToken = String(process.env.MEMORY_BRIDGE_NEW_OWNER_TOKEN || '');
const oauthStateFile = path.resolve(
  String(process.env.MEMORY_BRIDGE_OAUTH_STATE_FILE || path.join(moduleDir, '.state', 'oauth-state.enc.json'))
);

if (!oldOwnerToken || !newOwnerToken) {
  console.error('MEMORY_BRIDGE_OLD_OWNER_TOKEN and MEMORY_BRIDGE_NEW_OWNER_TOKEN are required.');
  process.exit(1);
}

try {
  const oauth = rotateOAuthStatePairingToken({
    stateFile: oauthStateFile,
    oldPairingToken: oldOwnerToken,
    newPairingToken: newOwnerToken
  });

  console.log(JSON.stringify({
    rotated: true,
    ownerOauthRotated: oauth.rotated,
    ownerOauthClients: oauth.dynamicClients || 0,
    ownerAccessTokens: oauth.accessTokens || 0,
    ownerRefreshTokens: oauth.refreshTokens || 0
  }));
} catch (error) {
  console.error(`Owner credential rotation failed: ${error?.message || error}`);
  process.exit(1);
}
