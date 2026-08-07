import crypto from 'node:crypto';

const DEFAULT_SCOPES = ['memory.read', 'memory.propose'];
const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

export function createMemoryBridgeOAuth({
  publicUrl,
  pairingToken,
  clientId = 'memory-space-grok',
  redirectHosts = ['grok.com', 'x.ai']
}) {
  const issuer = String(publicUrl || '').replace(/\/+$/, '');
  const authorizationCodes = new Map();
  const accessTokens = new Map();

  if (!issuer.startsWith('https://')) throw new Error('OAuth publicUrl must be HTTPS');
  if (!pairingToken) throw new Error('OAuth pairingToken is required');

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
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
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

  function redirectUriAllowed(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'https:') return false;
      return redirectHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    } catch {
      return false;
    }
  }

  function normalizeScope(value) {
    const requested = String(value || '').split(/\s+/).filter(Boolean);
    const scopes = requested.length ? requested : DEFAULT_SCOPES;
    return scopes.filter((scope) => DEFAULT_SCOPES.includes(scope));
  }

  function cleanup() {
    const now = Date.now();
    for (const [code, item] of authorizationCodes) {
      if (item.expiresAt <= now) authorizationCodes.delete(code);
    }
    for (const [token, item] of accessTokens) {
      if (item.expiresAt <= now) accessTokens.delete(token);
    }
  }

  function validateAuthorizeParams(params) {
    const responseType = params.get('response_type');
    const requestedClientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const codeChallenge = params.get('code_challenge');
    const codeChallengeMethod = params.get('code_challenge_method');

    if (responseType !== 'code') throw new Error('response_type=code is required');
    if (requestedClientId !== clientId) throw new Error('Unknown OAuth client_id');
    if (!redirectUriAllowed(redirectUri)) throw new Error('OAuth redirect_uri is not allowed');
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
  <form method="post" action="/authorize">
    ${hidden}
    <label>Bridge pairing token<input name="pairing_token" type="password" autocomplete="off" required placeholder="Enter your Memory Bridge pairing token"></label>
    <div class="actions"><button type="submit">Authorize</button></div>
  </form>
</main></body></html>`;
  }

  function authorizeRedirect(request, code) {
    const target = new URL(request.redirectUri);
    target.searchParams.set('code', code);
    if (request.state) target.searchParams.set('state', request.state);
    target.searchParams.set('iss', issuer);
    return target.toString();
  }

  function isAuthorized(req) {
    cleanup();
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ')) return false;
    const token = auth.slice(7);
    const record = accessTokens.get(token);
    return Boolean(record && record.expiresAt > Date.now());
  }

  async function handle(req, res) {
    cleanup();
    const url = new URL(req.url || '/', issuer);

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      sendJson(res, 200, {
        resource: `${issuer}/mcp`,
        authorization_servers: [issuer],
        bearer_methods_supported: ['header'],
        scopes_supported: DEFAULT_SCOPES
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      sendJson(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: DEFAULT_SCOPES
      });
      return true;
    }

    if (req.method === 'GET' && url.pathname === '/authorize') {
      try {
        const request = validateAuthorizeParams(url.searchParams);
        sendHtml(res, 200, consentPage(request));
      } catch (error) {
        sendHtml(res, 400, `<h1>OAuth request rejected</h1><p>${escapeHtml(error?.message || 'Invalid authorization request')}</p>`);
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/authorize') {
      try {
        const params = await readParams(req);
        const request = validateAuthorizeParams(params);
        if (!timingSafeEqualText(params.get('pairing_token'), pairingToken)) {
          sendHtml(res, 403, consentPage(request, 'Pairing token was not accepted.'));
          return true;
        }

        const code = randomToken();
        authorizationCodes.set(code, {
          ...request,
          expiresAt: Date.now() + CODE_TTL_MS
        });
        res.writeHead(302, { Location: authorizeRedirect(request, code), 'Cache-Control': 'no-store' });
        res.end();
      } catch (error) {
        sendHtml(res, 400, `<h1>OAuth authorization failed</h1><p>${escapeHtml(error?.message || 'Authorization failed')}</p>`);
      }
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      try {
        const params = await readParams(req);
        if (params.get('grant_type') !== 'authorization_code') {
          sendJson(res, 400, { error: 'unsupported_grant_type' });
          return true;
        }

        const code = params.get('code') || '';
        const record = authorizationCodes.get(code);
        authorizationCodes.delete(code);
        if (!record || record.expiresAt <= Date.now()) {
          sendJson(res, 400, { error: 'invalid_grant' });
          return true;
        }
        if (params.get('client_id') !== record.clientId || params.get('redirect_uri') !== record.redirectUri) {
          sendJson(res, 400, { error: 'invalid_grant' });
          return true;
        }
        const verifier = params.get('code_verifier') || '';
        if (!verifier || !timingSafeEqualText(sha256Base64Url(verifier), record.codeChallenge)) {
          sendJson(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
          return true;
        }

        const accessToken = randomToken();
        const expiresIn = Math.floor(TOKEN_TTL_MS / 1000);
        accessTokens.set(accessToken, {
          clientId: record.clientId,
          scope: record.scope,
          expiresAt: Date.now() + TOKEN_TTL_MS
        });
        sendJson(res, 200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: expiresIn,
          scope: record.scope
        });
      } catch (error) {
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
    protectedResourceMetadata: `${issuer}/.well-known/oauth-protected-resource`,
    isAuthorized,
    handle,
    challengeHeaders: {
      'WWW-Authenticate': `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource"`
    }
  });
}
