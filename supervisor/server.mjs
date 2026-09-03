import crypto from 'node:crypto';
import http from 'node:http';
import {
  BASE,
  HOST,
  PORT,
  ensureCapability,
  loadSource,
  saveSource,
} from './runtime.mjs';

const MAX_BODY_BYTES = 16_384;
const PROTOCOL = 'wizz-supervisor';
const VERSION = 1;

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function boundedStatus(source) {
  return {
    protocol: PROTOCOL,
    version: VERSION,
    supervisor: 'running',
    memorySource: source ? 'authorised' : 'not-authorised',
    sourceName: source ? String(source.sourceName || 'Memory Bridge').slice(0, 120) : null,
    connectionId: source ? String(source.connectionId || '').slice(0, 96) : null,
    authorisedAt: source?.authorisedAt || null,
    feedAvailable: Boolean(source?.feedUrl && source?.feedToken),
  };
}

function allowedFeedUrl(feedUrl, connectionId) {
  let url;
  try {
    url = new URL(feedUrl);
  } catch {
    return null;
  }
  const loopbackHttp = url.protocol === 'http:'
    && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !loopbackHttp) return null;
  if (url.pathname.replace(/\/+$/, '') !== `/c/${connectionId}/v1/jobs`) return null;
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

export function createSupervisor({
  capability = ensureCapability(),
  loadActiveSource = () => loadSource(capability),
  saveActiveSource = (source) => saveSource(source, capability),
} = {}) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', BASE);

    if (request.method === 'GET' && url.pathname === '/v1/health') {
      return sendJson(response, 200, boundedStatus(loadActiveSource()));
    }
    if (request.headers.origin) {
      return sendJson(response, 403, { error: 'browser_origin_rejected' });
    }

    const authorization = String(request.headers.authorization || '');
    if (!authorization.startsWith('Bearer ')
      || !constantTimeEqual(authorization.slice(7), capability)) {
      return sendJson(response, 401, { error: 'supervisor_authorization_required' });
    }

    if (request.method === 'GET' && url.pathname === '/v1/office-source') {
      const source = loadActiveSource();
      return source
        ? sendJson(response, 200, { configured: true, ...source })
        : sendJson(response, 404, {
          configured: false,
          error: 'memory_bridge_not_authorised_for_office',
        });
    }

    if (request.method === 'POST' && url.pathname === '/v1/office-source') {
      try {
        const candidate = await readJsonBody(request);
        const connectionId = String(candidate.connectionId || '');
        if (!/^conn_[A-Za-z0-9_-]{8,80}$/.test(connectionId)) throw new Error('invalid_connection');

        const feedUrl = allowedFeedUrl(String(candidate.feedUrl || ''), connectionId);
        const feedToken = String(candidate.feedToken || '');
        if (!feedUrl || feedToken.length < 16 || feedToken.length > 4096) {
          throw new Error('invalid_feed');
        }

        const source = {
          connectionId,
          sourceName: String(candidate.sourceName || 'Memory Bridge').slice(0, 120),
          feedUrl,
          feedToken,
          authorisedAt: new Date().toISOString(),
        };
        saveActiveSource(source);
        return sendJson(response, 200, {
          authorised: true,
          ...boundedStatus(source),
        });
      } catch {
        return sendJson(response, 400, { error: 'invalid_office_source' });
      }
    }

    return sendJson(response, 404, { error: 'not_found' });
  });
}

async function matchingSupervisorIsRunning(fetchImplementation = fetch) {
  try {
    const response = await fetchImplementation(`${BASE}/v1/health`, {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const health = await response.json();
    return health?.protocol === PROTOCOL && health?.version === VERSION;
  } catch {
    return false;
  }
}

export async function ensureSupervisor({
  fetchImplementation = fetch,
  createServer = createSupervisor,
} = {}) {
  if (await matchingSupervisorIsRunning(fetchImplementation)) return { reused: true };

  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(PORT, HOST, resolve);
    });
    return { reused: false, server };
  } catch (error) {
    if (error?.code === 'EADDRINUSE' && await matchingSupervisorIsRunning(fetchImplementation)) {
      return { reused: true };
    }
    if (error?.code === 'EADDRINUSE') {
      throw new Error(`WIZZ Supervisor port ${PORT} is occupied by an incompatible service`);
    }
    throw error;
  }
}
