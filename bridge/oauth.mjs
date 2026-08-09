import crypto from 'node:crypto';
import { createPersistentOAuthState } from './oauth-state.mjs';

const DEFAULT_SCOPES = ['memory.read', 'memory.propose'];
const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DCR_MAX_CLIENTS = 64;
const CURSOR_REDIRECT_URIS = new Set([
  'cursor://anysphere.cursor-mcp/oauth/callback',
  'https://www.cursor.com/agents/mcp/oauth/callback',
  'http://localhost:8787/callback'
]);

export function createMemoryBridgeOAuth({
  publicUrl,
  pairingToken,
  clientId = 'memory-space-grok',
  redirectHosts = ['grok.com', 'x.ai']
}) {
  const issuer = String(publicUrl || '').replace(/\/+$/, '');
  const authorizationCodes = new Map();

  if (!issuer.startsWith('https://')) throw new Error('OAuth publicUrl must be HTTPS');
  if (!pairingToken) throw new Error('OAuth pairingToken is required');

  // Private MSB2 issuers already use an unguessable customer-scoped URL and
  // explicit human consent. Keep the pairing credential internal for OAuth
  // state encryption, but never ask the customer to paste that bridge secret
  // into the external-AI authorization page.
  const issuerPath = new URL(issuer).pathname.replace(/\/+$/, '');
  const requiresPairingToken = !/^\/c\/[^/]+$/.test(issuerPath);

  const { accessTokens, refreshTokens, dynamicClients } = createPersistentOAuthState({
    issuer,
    pairingToken,
    clientId
  });

  function log(event, detail = '') {
    console.log(`[oauth] ${event}${detail ? ` ${detail}` : ''}`);
  }

  function timingSafeEqualText(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
  }

  function sha256Base64Url(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('base64url');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function sendJson(res, status, value, extraHeaders = {}) {
    const body = JSON.stringify(value);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      ...extraHeaders
    });
    res.end(body);
  }

  function sendHtml(res, status, html) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY'
    });
    res.end(html);
  }

  async function readText(req, maxBytes = 64_000) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('OAuth request is too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function readParams(req) {
    const text = await readText(req);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (contentType.includes('application/json')) {
      const parsed = text ? JSON.parse(text) : {};
      return new URLSearchParams(Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]));
    }
    return new URLSearchParams(text);
  }

  async function readJson(req) {
    const text = await readText(req);
    return text ? JSON.parse(text) : {};
  }

  function hostRedirectUriAllowed(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return false;
      return redirectHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }

  function dynamicRedirectUriAllowed(value) {
    const redirectUri = String(value || '');
    return CURSOR_REDIRECT_URIS.has(redirectUri) || hostRedirectUriAllowed(redirectUri);
  }

  function normalizeScope(value) {
    const requested = String(value || '').split(/\s+/).filter(Boolean);
    const scopes = requested.length ? requested : DEFAULT_SCOPES;
    return scopes.filter((scope) => DEFAULT_SCOPES.includes(scope));
  }

  function registeredRedirectAllowed(requestedClientId, redirectUri) {
    if (requestedClientId === clientId) return hostRedirectUriAllowed(redirectUri);
    const registration = dynamicClients.get(requestedClientId);
    return Boolean(registration && registration.redirectUris.includes(String(redirectUri || '')));
  }

  function clientSupportsRefreshToken(requestedClientId) {
    if (requestedClientId === clientId) return true;
    const registration = dynamicClients.get(requestedClientId);
    return Boolean(registration && registration.grantTypes.includes('refresh_token'));
  }

  function validateRegistrationRequest(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('OAuth client registration body must be a JSON object');
    }

    const redirectUris = Array.isArray(body.redirect_uris)
      ? [...new Set(body.redirect_uris.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];
    if (!redirectUris.length) throw new Error('redirect_uris is required');
    if (!redirectUris.every(dynamicRedirectUriAllowed)) {
      throw new Error('One or more OAuth redirect_uris are not allowed');
    }

    const tokenAuthMethod = String(body.token_endpoint_auth_method || 'none');
    if (tokenAuthMethod !== 'none') throw new Error('Only token_endpoint_auth_method=none is supported');

    const grantTypes = Array.isArray(body.grant_types) && body.grant_types.length
      ? [...new Set(body.grant_types.map(String))]
      : ['authorization_code'];
    const supportedGrantTypes = new Set(['authorization_code', 'refresh_token']);
    if (!grantTypes.includes('authorization_code')) {
      throw new Error('authorization_code grant type is required');
    }
    if (grantTypes.some((value) => !supportedGrantTypes.has(value))) {
      throw new Error('Only authorization_code and refresh_token grant types are supported');
    }

    const responseTypes = Array.isArray(body.response_types) && body.response_types.length
      ? body.response_types.map(String)
      : ['code'];
    if (responseTypes.some((value) => value !== 'code')) {
      throw new Error('Only response_type=code is supported');
    }

    return {
      redirectUris,
      tokenAuthMethod,
      grantTypes,
      responseTypes,
      clientName: String(body.client_name || 'External MCP client').slice(0, 120),
      applicationType: String(body.application_type || 'web').slice(0, 32)
    };
  }

  function cleanup() {
    const now = Date.now();
    for (const [code, item] of authorizationCodes) {
      if (item.expiresAt <= now) authorizationCodes.delete(code);
    }
    for (const [token, item] of accessTokens) {
      if (item.expiresAt <= now) accessTokens.delete(token);
    }
    for (const [token, item] of refreshTokens) {
      if (item.expiresAt <= now) refreshTokens.delete(token);
    }
  }

  function clientNameFor(clientIdValue) {
    const registration = dynamicClients.get(clientIdValue);
    if (registration?.clientName) return registration.clientName;
    if (clientIdValue === clientId) return 'Grok';
    return 'External AI';
  }

  function listAuthorizedClients() {
    cleanup();
    const clients = new Map();

    function touch(record, kind) {
      if (!record?.clientId) return;
      let item = clients.get(record.clientId);
      if (!item) {
        const registration = dynamicClients.get(record.clientId);
        item = {
          clientId: record.clientId,
          clientName: clientNameFor(record.clientId),
          applicationType: registration?.applicationType || 'web',
          registeredAt: registration?.createdAt || null,
          scopes: new Set(),
          accessTokenActive: false,
          refreshTokenActive: false,
          accessExpiresAt: null,
          refreshExpiresAt: null
        };
        clients.set(record.clientId, item);
      }
      for (const scope of String(record.scope || '').split(/\s+/).filter(Boolean)) item.scopes.add(scope);
      if (kind === 'access') {
        item.accessTokenActive = true;
        item.accessExpiresAt = Math.max(item.accessExpiresAt || 0, Number(record.expiresAt || 0));
      } else {
        item.refreshTokenActive = true;
        item.refreshExpiresAt = Math.max(item.refreshExpiresAt || 0, Number(record.expiresAt || 0));
      }
    }

    for (const record of accessTokens.values()) touch(record, 'access');
    for (const record of refreshTokens.values()) touch(record, 'refresh');

    return [...clients.values()]
      .map((item) => {
        const scopes = [...item.scopes];
        return {
          clientId: item.clientId,
          clientName: item.clientName,
          applicationType: item.applicationType,
          registeredAt: item.registeredAt,
          scopes,
          canRead: scopes.includes('memory.read'),
          canPropose: scopes.includes('memory.propose'),
          accessTokenActive: item.accessTokenActive,
          refreshTokenActive: item.refreshTokenActive,
          accessExpiresAt: item.accessExpiresAt,
          refreshExpiresAt: item.refreshExpiresAt
        };
      })
      .sort((a, b) => String(a.clientName).localeCompare(String(b.clientName)));
  }

  function revokeClient(clientIdValue) {
    cleanup();
    const requestedClientId = String(clientIdValue || '').trim();
    if (!requestedClientId) throw new Error('clientId is required');

    let revoked = 0;
    for (const [code, item] of authorizationCodes) {
      if (item.clientId !== requestedClientId) continue;
      authorizationCodes.delete(code);
      revoked += 1;
    }
    for (const [token, item] of accessTokens) {
      if (item.clientId !== requestedClientId) continue;
      accessTokens.delete(token);
      revoked += 1;
    }
    for (const [token, item] of refreshTokens) {
      if (item.clientId !== requestedClientId) continue;
      refreshTokens.delete(token);
      revoked += 1;
    }

    log('client revoked', `client=${requestedClientId} credentials=${revoked}`);
    return {
      clientId: requestedClientId,
      clientName: clientNameFor(requestedClientId),
      revokedCredentials: revoked,
      disconnected: revoked > 0
    };
  }

  function validateAuthorizeParams(params) {
    const responseType = params.get('response_type');
    const requestedClientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const codeChallenge = params.get('code_challenge');
    const codeChallengeMethod = params.get('code_challenge_method');

    if (responseType !== 'code') throw new Error('response_type=code is required');
    if (requestedClientId !== clientId && !dynamicClients.has(requestedClientId)) {
      throw new Error('Unknown OAuth client_id');
    }
    if (!registeredRedirectAllowed(requestedClientId, redirectUri)) {
      throw new Error('OAuth redirect_uri is not allowed for this client');
    }
    if (!codeChallenge || codeChallengeMethod !== 'S256') throw new Error('PKCE S256 is required');

    return {
      clientId: requestedClientId,
      redirectUri,
      codeChallenge,
      state: params.get('state') || '',
      scope: normalizeScope(params.get('scope')).join(' ')
    };
  }

  function consentPage(request, error = '') {
    const fields = {
      response_type: 'code',
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      code_challenge: request.codeChallenge,
      code_challenge_method: 'S256',
      state: request.state,
      scope: request.scope
    };
    const hidden = Object.entries(fields)
      .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
      .join('');
    const pairingField = requiresPairingToken
      ? '<label>Bridge pairing token<input name="pairing_token" type="password" autocomplete="off" required placeholder="Enter your Memory Bridge pairing token"></label>'
      : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize Memory Space</title>
<style>
  :root{color-scheme:dark}body{margin:0;background:#080b0f;color:#edf2f7;font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}.card{width:min(520px,100%);background:#10151c;border:1px solid #26303b;border-radius:18px;padding:24px;box-shadow:0 18px 60px #0008}h1{font-size:1.35rem;margin:0 0 10px}p{color:#aeb8c4;line-height:1.5}.scope{background:#0b1016;border:1px solid #26303b;border-radius:12px;padding:12px;margin:16px 0;font-size:.9rem}.warn{color:#ff9a9a}.ok{color:#c7ff56}label{display:grid;gap:7px;margin-top:18px;font-weight:700;font-size:.86rem}input{width:100%;box-sizing:border-box;background:#080b0f;border:1px solid #344150;border-radius:11px;color:#fff;padding:12px;font-size:16px}.actions{display:flex;justify-content:flex-end;margin-top:18px}button{border:0;border-radius:11px;background:#c7ff56;color:#111;font-weight:900;padding:12px 18px;cursor:pointer}
</style>
</head>
<body><main class="card">
  <div class="ok">MEMORY BRIDGE</div>
  <h1>Authorize external AI access</h1>
  <p>An external MCP client wants access to the Memory Space currently shared in bridge RAM.</p>
  <div class="scope"><strong>Requested scopes</strong><br>${escapeHtml(request.scope || DEFAULT_SCOPES.join(' '))}</div>
  ${error ? `<p class="warn">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="${escapeHtml(`${issuer}/authorize`)}">
    ${hidden}
    ${pairingField}
    <div class="actions"><button type="submit">Authorize</button></div>
  </form>
</main></body></html>`;
  }

  function authorizeRedirect(request, code) {
    const target = new URL(request.redirectUri);
    target.searchParams.set('code', code);
    if (request.state) target.searchParams.set('state', request.state);
    return target.toString();
  }

  function isAuthorized(req, requiredScope = '') {
    cleanup();
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) return false;
    const token = auth.slice(7);
    const record = accessTokens.get(token);
    if (!record || record.expiresAt <= Date.now()) return false;
    const required = String(requiredScope || '').trim();
    if (!required) return true;
    const scopes = new Set(String(record.scope || '').split(/\s+/).filter(Boolean));
    return scopes.has(required);
  }

  function issueAccessToken(clientIdValue, scope) {
    const accessToken = randomToken();
    const expiresIn = Math.floor(TOKEN_TTL_MS / 1000);
    accessTokens.set(accessToken, {
      clientId: clientIdValue,
      scope,
      expiresAt: Date.now() + TOKEN_TTL_MS
    });
    return { accessToken, expiresIn };
  }

  function issueRefreshToken(clientIdValue, scope) {
    const refreshToken = randomToken();
    refreshTokens.set(refreshToken, {
      clientId: clientIdValue,
      scope,
      expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS
    });
    return refreshToken;
  }

  async function handle(req, res) {
    cleanup();
    const url = new URL(req.url || '/', issuer);

    if (req.method === 'GET' && (
      url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname === '/.well-known/oauth-protected-resource/mcp'
    )) {
      log('protected-resource metadata', url.pathname);
      sendJson(res, 200, {
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        bearer_methods_supported: ['header'],
        scopes_supported: DEFAULT_SCOPES
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      log('authorization-server metadata');
      sendJson(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: DEFAULT_SCOPES
      });
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      try {
        if (dynamicClients.size >= DCR_MAX_CLIENTS) {
          log('registration rejected', 'capacity-reached');
          sendJson(res, 503, {
            error: 'temporarily_unavailable',
            error_description: 'OAuth client registration capacity reached; restart the bridge or remove stale registrations.'
          });
          return true;
        }

        const registration = validateRegistrationRequest(await readJson(req));
        const dynamicClientId = `memory-space-dcr-${randomToken(18)}`;
        dynamicClients.set(dynamicClientId, {
          redirectUris: registration.redirectUris,
          tokenAuthMethod: registration.tokenAuthMethod,
          grantTypes: registration.grantTypes,
          responseTypes: registration.responseTypes,
          clientName: registration.clientName,
          applicationType: registration.applicationType,
          createdAt: Date.now()
        });

        log(
          'client registered',
          `client=${dynamicClientId} redirectHosts=${registration.redirectUris.map((value) => new URL(value).hostname).join(',')} grants=${registration.grantTypes.join(',')}`
        );
        sendJson(res, 201, {
          client_id: dynamicClientId,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          redirect_uris: registration.redirectUris,
          token_endpoint_auth_method: registration.tokenAuthMethod,
          grant_types: registration.grantTypes,
          response_types: registration.responseTypes,
          client_name: registration.clientName,
          application_type: registration.applicationType
        });
      } catch (error) {
        log('registration rejected', error?.message || 'invalid request');
        sendJson(res, 400, {
          error: 'invalid_client_metadata',
          error_description: error?.message || 'Invalid OAuth client registration request'
        });
      }
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/authorize') {
      try {
        const request = validateAuthorizeParams(url.searchParams);
        log('authorize page', `client=${request.clientId} redirectHost=${new URL(request.redirectUri).hostname}`);
        sendHtml(res, 200, consentPage(request));
      } catch (error) {
        log('authorize rejected', error?.message || 'invalid request');
        sendHtml(res, 400, `<h1>OAuth request rejected</h1><p>${escapeHtml(error?.message || 'Invalid authorization request')}</p>`);
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/authorize') {
      try {
        const params = await readParams(req);
        const request = validateAuthorizeParams(params);
        if (requiresPairingToken && !timingSafeEqualText(params.get('pairing_token'), pairingToken)) {
          log('consent denied', 'pairing-token-mismatch');
          sendHtml(res, 403, consentPage(request, 'Pairing token was not accepted.'));
          return true;
        }

        const code = randomToken();
        authorizationCodes.set(code, {
          ...request,
          expiresAt: Date.now() + CODE_TTL_MS
        });
        log('consent approved', `client=${request.clientId} redirectHost=${new URL(request.redirectUri).hostname}`);
        res.writeHead(302, { Location: authorizeRedirect(request, code), 'Cache-Control': 'no-store' });
        res.end();
      } catch (error) {
        log('authorization failed', error?.message || 'unknown');
        sendHtml(res, 400, `<h1>OAuth authorization failed</h1><p>${escapeHtml(error?.message || 'Authorization failed')}</p>`);
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      try {
        const params = await readParams(req);
        const grantType = params.get('grant_type') || '';
        log('token request', `grant=${grantType || 'missing'} client=${params.get('client_id') || 'missing'} redirect=${params.get('redirect_uri') ? 'present' : 'missing'} verifier=${params.get('code_verifier') ? 'present' : 'missing'}`);

        if (grantType === 'authorization_code') {
          const code = params.get('code') || '';
          const record = authorizationCodes.get(code);
          authorizationCodes.delete(code);
          if (!record || record.expiresAt <= Date.now()) {
            log('token rejected', 'invalid-or-expired-code');
            sendJson(res, 400, { error: 'invalid_grant' });
            return true;
          }
          if (params.get('client_id') !== record.clientId || params.get('redirect_uri') !== record.redirectUri) {
            log('token rejected', 'client-or-redirect-mismatch');
            sendJson(res, 400, { error: 'invalid_grant' });
            return true;
          }
          const verifier = params.get('code_verifier') || '';
          if (!verifier || !timingSafeEqualText(sha256Base64Url(verifier), record.codeChallenge)) {
            log('token rejected', 'pkce-verification-failed');
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
            return true;
          }

          const { accessToken, expiresIn } = issueAccessToken(record.clientId, record.scope);
          const response = {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: expiresIn,
            scope: record.scope
          };
          if (clientSupportsRefreshToken(record.clientId)) {
            response.refresh_token = issueRefreshToken(record.clientId, record.scope);
          }

          log('token issued', `client=${record.clientId} expiresIn=${expiresIn} refresh=${response.refresh_token ? 'issued' : 'none'}`);
          sendJson(res, 200, response);
          return true;
        }

        if (grantType === 'refresh_token') {
          const oldRefreshToken = params.get('refresh_token') || '';
          const record = refreshTokens.get(oldRefreshToken);
          refreshTokens.delete(oldRefreshToken);
          if (!record || record.expiresAt <= Date.now()) {
            log('refresh rejected', 'invalid-or-expired-refresh-token');
            sendJson(res, 400, { error: 'invalid_grant' });
            return true;
          }
          if (!clientSupportsRefreshToken(record.clientId) || params.get('client_id') !== record.clientId) {
            log('refresh rejected', 'client-mismatch-or-refresh-not-registered');
            sendJson(res, 400, { error: 'invalid_grant' });
            return true;
          }

          let scope = record.scope;
          const requestedScopeText = String(params.get('scope') || '').trim();
          if (requestedScopeText) {
            const requestedScopes = [...new Set(requestedScopeText.split(/\s+/).filter(Boolean))];
            const grantedScopes = new Set(record.scope.split(/\s+/).filter(Boolean));
            if (requestedScopes.some((value) => !DEFAULT_SCOPES.includes(value) || !grantedScopes.has(value))) {
              log('refresh rejected', 'invalid-scope');
              sendJson(res, 400, { error: 'invalid_scope' });
              return true;
            }
            scope = requestedScopes.join(' ');
          }

          const { accessToken, expiresIn } = issueAccessToken(record.clientId, scope);
          const newRefreshToken = issueRefreshToken(record.clientId, scope);
          log('token refreshed', `client=${record.clientId} expiresIn=${expiresIn}`);
          sendJson(res, 200, {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: expiresIn,
            refresh_token: newRefreshToken,
            scope
          });
          return true;
        }

        log('token rejected', 'unsupported_grant_type');
        sendJson(res, 400, { error: 'unsupported_grant_type' });
      } catch (error) {
        log('token error', error?.message || 'unknown');
        sendJson(res, 400, { error: 'invalid_request', error_description: error?.message || 'Token request failed' });
      }
      return true;
    }

    return false;
  }

  return Object.freeze({
    clientId,
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    registrationEndpoint: `${issuer}/register`,
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    isAuthorized,
    listAuthorizedClients,
    revokeClient,
    handle,
    challengeHeaders: {
      'WWW-Authenticate': `Bearer resource_metadata=\"${issuer}/.well-known/oauth-protected-resource/mcp\"`
    }
  });
}
