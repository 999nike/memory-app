import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSupervisor } from './supervisor/server.mjs';

const HOST = process.env.UNIVERSAL_SPACE_HOST || '0.0.0.0';
const PORT = Number(process.env.UNIVERSAL_SPACE_PORT || 4173);
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const CODE_SPACE_ROOT = resolve(ROOT_DIR, '..');
const SECRETS_DIR = resolve(ROOT_DIR, '..', '..', 'secrets', 'universal-space-gmail');
const CLIENT_SECRET_FILE = resolve(SECRETS_DIR, 'client_secret.json');
const TOKEN_FILE = resolve(SECRETS_DIR, 'token.json');
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
const GMAIL_MESSAGE_LABELS = new Set(['INBOX', 'UNREAD', 'STARRED', 'SENT', 'DRAFT']);
const REDIRECT_URI = 'http://localhost:4173/auth/gmail/callback';
const GOOGLE_AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthStates = new Map();

await ensureSupervisor().catch((error) => console.error(`WIZZ Supervisor unavailable: ${error?.message || error}`));

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
});

class GmailDisconnectedError extends Error {}
class GmailAuthError extends Error {}
class GmailTemporaryError extends Error {}
let tokenState = null;

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, value) {
  const body = String(value);
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { 'Cache-Control': 'no-store', Location: location });
  res.end();
}

async function readJson(pathName, missingValue = null) {
  try {
    return JSON.parse(await readFile(pathName, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return missingValue;
    throw error;
  }
}

function assertKnownGmailScopes(scopeValue) {
  const scopes = String(scopeValue || GMAIL_SCOPE).split(/\s+/).filter(Boolean);
  if (scopes.some((scope) => scope !== GMAIL_SCOPE && scope !== GMAIL_METADATA_SCOPE)) {
    throw new Error('Stored Gmail authorization contains an unexpected scope');
  }
}

function hasGmailReadonlyScope(scopeValue) {
  return String(scopeValue || '').split(/\s+/).includes(GMAIL_SCOPE);
}

async function loadClientConfig() {
  const document = await readJson(CLIENT_SECRET_FILE);
  const config = document?.web;
  if (!config?.client_id || !config?.client_secret) {
    throw new Error('A Google OAuth Web application client_secret.json is required');
  }
  if (!Array.isArray(config.redirect_uris) || !config.redirect_uris.includes(REDIRECT_URI)) {
    throw new Error(`Google OAuth redirect URI must include ${REDIRECT_URI}`);
  }
  return {
    clientId: String(config.client_id),
    clientSecret: String(config.client_secret),
    authUri: String(config.auth_uri || GOOGLE_AUTH_URI),
    tokenUri: String(config.token_uri || GOOGLE_TOKEN_URI)
  };
}

async function readToken() {
  const token = await readJson(TOKEN_FILE);
  if (!token || typeof token !== 'object') return null;
  assertKnownGmailScopes(token.scope);
  return token;
}

async function writeToken(token) {
  assertKnownGmailScopes(token.scope);
  await mkdir(SECRETS_DIR, { recursive: true });
  await writeFile(TOKEN_FILE, `${JSON.stringify(token, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  tokenState = token;
}

async function requestTokens(parameters, config) {
  const response = await fetch(config.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(parameters)
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || !value?.access_token) {
    throw new Error(`Google OAuth token request failed with HTTP ${response.status}`);
  }
  return value;
}

function normalizedToken(value, existing = null) {
  const scope = String(value.scope || existing?.scope || GMAIL_SCOPE);
  assertKnownGmailScopes(scope);
  return {
    access_token: String(value.access_token),
    refresh_token: value.refresh_token ? String(value.refresh_token) : existing?.refresh_token || null,
    token_type: String(value.token_type || existing?.token_type || 'Bearer'),
    scope,
    expiry_date: Date.now() + Math.max(0, Number(value.expires_in || 3600)) * 1000
  };
}

async function accessToken(forceRefresh = false) {
  const config = await loadClientConfig();
  const token = tokenState || await readToken();
  tokenState = token;
  if (!token) throw new GmailDisconnectedError('Gmail is not connected');

  if (!forceRefresh && token.access_token && Number(token.expiry_date || 0) > Date.now() + 60_000) {
    return String(token.access_token);
  }
  if (!token.refresh_token) throw new GmailDisconnectedError('Gmail authorization has expired');

  let refreshed;
  try {
    refreshed = await requestTokens({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: String(token.refresh_token)
    }, config);
  } catch {
    throw new GmailTemporaryError('gmail_token_refresh_failed');
  }
  let nextToken;
  try {
    nextToken = normalizedToken(refreshed, token);
    await writeToken(nextToken);
  } catch {
    throw new GmailTemporaryError('gmail_token_persist_failed');
  }
  return nextToken.access_token;
}

async function gmailRequest(pathName, parameters = null) {
  const url = new URL(pathName, GMAIL_API);
  if (parameters) {
    for (const [name, value] of parameters) {
      url.searchParams.append(name, String(value));
    }
  }

  const request = async (forceRefresh) => {
    const token = await accessToken(forceRefresh);
    return fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  };

  let response = await request(false);
  if (response.status === 401) response = await request(true);
  const value = await response.json().catch(() => ({}));
  if (response.status === 401) throw new GmailAuthError('gmail_auth_rejected');
  if (!response.ok) throw new GmailTemporaryError(`gmail_api_http_${response.status}`);
  return value;
}

async function gmailSummary() {
  const [inbox, unread, drafts] = await Promise.all([
    gmailRequest('labels/INBOX'),
    gmailRequest('labels/UNREAD'),
    gmailRequest('labels/DRAFT')
  ]);
  return {
    connected: true,
    inbox: Math.max(0, Number(inbox.messagesTotal || 0)),
    unread: Math.max(0, Number(unread.messagesTotal || 0)),
    drafts: Math.max(0, Number(drafts.messagesTotal || 0))
  };
}

function headerValue(message, headerName) {
  const headers = Array.isArray(message?.payload?.headers) ? message.payload.headers : [];
  return String(headers.find((header) => String(header?.name).toLowerCase() === headerName.toLowerCase())?.value || '');
}

async function latestMessages(labelId, limit) {
  const listing = await gmailRequest('messages', [
    ['labelIds', labelId],
    ['maxResults', limit]
  ]);
  const messages = Array.isArray(listing.messages) ? listing.messages.slice(0, limit) : [];
  const normalized = await Promise.all(messages.map(async (item) => {
    const detail = await gmailRequest(`messages/${encodeURIComponent(String(item.id))}`, [
      ['format', 'METADATA'],
      ['metadataHeaders', 'From'],
      ['metadataHeaders', 'Subject'],
      ['metadataHeaders', 'Date']
    ]);
    return {
      id: String(detail.id || item.id || ''),
      sender: headerValue(detail, 'From'),
      subject: headerValue(detail, 'Subject'),
      date: headerValue(detail, 'Date')
    };
  }));
  return { connected: true, messages: normalized };
}

function decodeBase64Url(value) {
  try {
    return Buffer.from(String(value || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function collectMessageParts(part, result) {
  if (!part || typeof part !== 'object') return;
  const mimeType = String(part.mimeType || '').toLowerCase();
  if (part.body?.data && mimeType === 'text/plain' && !result.text) result.text = decodeBase64Url(part.body.data);
  if (part.body?.data && mimeType === 'text/html' && !result.html) result.html = decodeBase64Url(part.body.data);
  for (const child of Array.isArray(part.parts) ? part.parts : []) collectMessageParts(child, result);
}

async function gmailMessage(messageId, token) {
  if (!hasGmailReadonlyScope(token?.scope)) throw new Error('gmail_readonly_required');
  const detail = await gmailRequest(`messages/${encodeURIComponent(messageId)}`, [['format', 'FULL']]);
  const body = { text: '', html: '' };
  collectMessageParts(detail.payload, body);
  if (!body.text && body.html) body.text = body.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    id: String(detail.id || messageId),
    sender: headerValue(detail, 'From'),
    subject: headerValue(detail, 'Subject'),
    date: headerValue(detail, 'Date'),
    bodyText: body.text,
    bodyHtmlAvailable: Boolean(body.html)
  };
}

function localOAuthRequest(req) {
  try {
    return new URL(`http://${req.headers.host || ''}`).hostname.toLowerCase() === 'localhost';
  } catch {
    return false;
  }
}

function pruneOauthStates() {
  const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
  for (const [state, pending] of oauthStates) {
    if (pending.createdAt < cutoff) oauthStates.delete(state);
  }
}

async function startGmailAuth(req, res) {
  if (!localOAuthRequest(req)) {
    sendJson(res, 400, { error: 'gmail_auth_requires_localhost' });
    return;
  }
  const config = await loadClientConfig();
  pruneOauthStates();
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  oauthStates.set(state, { verifier, createdAt: Date.now() });

  const authorization = new URL(config.authUri);
  authorization.search = new URLSearchParams({
    access_type: 'offline',
    client_id: config.clientId,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    state
  }).toString();
  redirect(res, authorization.toString());
}

async function finishGmailAuth(requestUrl, res) {
  const state = String(requestUrl.searchParams.get('state') || '');
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  if (!pending || Date.now() - pending.createdAt > OAUTH_STATE_TTL_MS) {
    sendText(res, 400, 'Gmail authorization state is invalid or expired.');
    return;
  }
  if (requestUrl.searchParams.get('error')) {
    sendText(res, 400, 'Gmail authorization was not completed.');
    return;
  }
  const code = String(requestUrl.searchParams.get('code') || '');
  if (!code) {
    sendText(res, 400, 'Gmail authorization code is missing.');
    return;
  }

  const config = await loadClientConfig();
  const current = await readToken();
  const response = await requestTokens({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: pending.verifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI
  }, config);
  await writeToken(normalizedToken(response, current));
  redirect(res, '/?gmail=connected');
}

async function gmailStatus() {
  try {
    await loadClientConfig();
  } catch {
    return { configured: false, connected: false };
  }
  try {
    const token = await readToken();
    return {
      configured: true,
      connected: Boolean(token?.refresh_token || token?.access_token),
      readonly: hasGmailReadonlyScope(token?.scope)
    };
  } catch {
    return { configured: true, connected: false };
  }
}

async function codeSpaceProjects() {
  const entries = await readdir(CODE_SPACE_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).slice(0, 40).map((entry) => ({ name: entry.name }));
}

async function codeSpaceFiles(project = 'universal-space') {
  const projectRoot = resolve(CODE_SPACE_ROOT, project);
  const relativeProject = relative(CODE_SPACE_ROOT, projectRoot);
  if (!isAbsolute(projectRoot) || relativeProject.startsWith(`..${sep}`) || relativeProject === '..') throw new Error('invalid_code_space_project');
  const output = [];
  async function visit(directory, depth = 0) {
    if (depth > 2 || output.length >= 100) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (output.length >= 100) break;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = resolve(directory, entry.name);
      const relativeName = relative(projectRoot, full).split(sep).join('/');
      if (entry.isDirectory()) {
        output.push({ path: relativeName, kind: 'directory' });
        await visit(full, depth + 1);
      } else if (entry.isFile()) output.push({ path: relativeName, kind: 'file' });
    }
  }
  await visit(projectRoot);
  return { project, files: output };
}

async function handleCodeSpaceRoute(req, res, requestUrl) {
  if (req.method !== 'GET') return false;
  try {
    if (requestUrl.pathname === '/api/code-space/projects') {
      sendJson(res, 200, { root: CODE_SPACE_ROOT, projects: await codeSpaceProjects() });
      return true;
    }
    if (requestUrl.pathname === '/api/code-space/files') {
      sendJson(res, 200, await codeSpaceFiles(String(requestUrl.searchParams.get('project') || 'universal-space')));
      return true;
    }
  } catch (error) {
    sendJson(res, 400, { error: error?.message === 'invalid_code_space_project' ? error.message : 'code_space_unavailable' });
    return true;
  }
  return false;
}

async function handleGmailRoute(req, res, requestUrl) {
  if (req.method !== 'GET') return false;
  if (requestUrl.pathname === '/auth/gmail/start') {
    try {
      await startGmailAuth(req, res);
    } catch {
      sendJson(res, 503, { error: 'gmail_oauth_not_configured' });
    }
    return true;
  }
  if (requestUrl.pathname === '/auth/gmail/callback') {
    try {
      await finishGmailAuth(requestUrl, res);
    } catch {
      sendText(res, 502, 'Gmail authorization could not be completed.');
    }
    return true;
  }
  if (requestUrl.pathname === '/api/gmail/status') {
    sendJson(res, 200, await gmailStatus());
    return true;
  }
  if (requestUrl.pathname === '/api/gmail/summary') {
    const status = await gmailStatus();
    if (!status.connected) {
      sendJson(res, 200, { connected: false });
      return true;
    }
    try {
      sendJson(res, 200, await gmailSummary());
    } catch (error) {
      if (error instanceof GmailDisconnectedError || error instanceof GmailAuthError) {
        sendJson(res, 200, { connected: false, reauthorize: true, error: 'gmail_reauthorization_required' });
      } else {
        sendJson(res, 200, { connected: true, stale: true, error: 'gmail_summary_unavailable' });
      }
    }
    return true;
  }
  if (requestUrl.pathname === '/api/gmail/messages') {
    const limit = Math.min(10, Math.max(1, Number.parseInt(requestUrl.searchParams.get('limit') || '10', 10) || 10));
    const labelId = String(requestUrl.searchParams.get('label') || 'INBOX').toUpperCase();
    if (!GMAIL_MESSAGE_LABELS.has(labelId)) {
      sendJson(res, 400, { error: 'unsupported_gmail_label' });
      return true;
    }
    const status = await gmailStatus();
    if (!status.connected) {
      sendJson(res, 200, { connected: false, messages: [] });
      return true;
    }
    try {
      sendJson(res, 200, await latestMessages(labelId, limit));
    } catch (error) {
      sendJson(res, error instanceof GmailDisconnectedError ? 200 : 502, { connected: false, messages: [] });
    }
    return true;
  }
  if (requestUrl.pathname === '/api/gmail/message') {
    const messageId = String(requestUrl.searchParams.get('id') || '').trim();
    if (!messageId || messageId.length > 200) {
      sendJson(res, 400, { error: 'missing_gmail_message_id' });
      return true;
    }
    const token = await readToken().catch(() => null);
    if (!token?.access_token && !token?.refresh_token) {
      sendJson(res, 200, { connected: false });
      return true;
    }
    if (!hasGmailReadonlyScope(token.scope)) {
      sendJson(res, 403, { connected: true, readonly: false, error: 'gmail_readonly_required', reauthorize: true });
      return true;
    }
    try {
      sendJson(res, 200, await gmailMessage(messageId, token));
    } catch (error) {
      sendJson(res, error?.message === 'gmail_readonly_required' ? 403 : error instanceof GmailDisconnectedError ? 200 : 502, {
        connected: error instanceof GmailDisconnectedError ? false : true,
        error: error?.message === 'gmail_readonly_required' ? 'gmail_readonly_required' : 'gmail_message_unavailable'
      });
    }
    return true;
  }
  return false;
}

async function serveStatic(req, res, requestUrl) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = resolve(ROOT_DIR, `.${pathname}`);
  const relativePath = relative(ROOT_DIR, filePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath) || relativePath.split(sep).some((part) => part.startsWith('.'))) {
    sendText(res, 404, 'Not found');
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);
  try {
    if (await handleGmailRoute(req, res, requestUrl)) return;
    if (await handleCodeSpaceRoute(req, res, requestUrl)) return;
    await serveStatic(req, res, requestUrl);
  } catch {
    sendJson(res, 500, { error: 'local_server_error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Universal Space listening on http://${HOST}:${PORT}`);
  console.log(`Gmail OAuth callback: ${REDIRECT_URI}`);
});
