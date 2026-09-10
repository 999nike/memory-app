import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createOrbRealtimeRoute } from './orb-realtime-server.mjs';

async function routeTest(options, run) {
  let handler;
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://localhost')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  handler = createOrbRealtimeRoute({ ...options, port });
  const url = `http://127.0.0.1:${port}`;
  const request = (body = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111', headers = {}) => fetch(url + '/api/orb/realtime', {
    method: 'POST', headers: { Origin: url, 'Content-Type': 'application/sdp', ...headers }, body
  });
  try { await run(request); } finally { await new Promise(resolve => server.close(resolve)); }
}
test('route rejects cross-origin and missing credentials without contacting OpenAI', async () => {
  await routeTest({ env: {}, fetchImpl: () => { throw new Error('Must not contact API'); } }, async request => {
    assert.equal((await request(undefined, { Origin: 'https://evil.test' })).status, 403);
    const missing = await request(); assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /not configured/);
  });
});
test('server owns session, native audio, VAD and exact two read-only tools; model fallback', async () => {
  const calls = [];
  await routeTest({ env: { OPENAI_API_KEY: 'test-only-placeholder' }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/realtime/calls');
    const session = JSON.parse(options.body.get('session')); calls.push(session);
    return calls.length === 1 ? new Response(JSON.stringify({ error: { code: 'model_not_found' } }), { status: 404 }) : new Response('v=0\r\nm=audio');
  } }, async request => {
    const res = await request(); assert.equal(res.status, 200); assert.equal(await res.text(), 'v=0\r\nm=audio');
    assert.deepEqual(calls.map(s => s.model), ['gpt-realtime-2', 'gpt-realtime-1.5']);
    for (const s of calls) {
      assert.deepEqual(s.tools.map(t => t.name), ['search_nodes', 'guide_node']);
      assert.equal(s.audio.input.turn_detection.interrupt_response, true);
      assert.deepEqual(s.output_modalities, ['audio']);
    }
    assert.equal((await request()).status, 429);
  });
});
test('malformed SDP rejected and upstream errors redacted', async () => {
  await routeTest({ env: { OPENAI_API_KEY: 'test-only-placeholder' } }, async request => {
    assert.equal((await request('not sdp')).status, 400);
  });
  await routeTest({ env: { OPENAI_API_KEY: 'test-only-placeholder' }, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'private error' } }), { status: 401 }) }, async request => {
    const res = await request(); assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /private error|placeholder/);
  });
});

const source = await readFile(new URL('./orb-realtime.js', import.meta.url), 'utf8');
function harness({ mediaError, deferredMedia, fetchError } = {}) {
  const states = [], messages = [], levels = [], guided = [], streams = [], contexts = [], peers = [], intervals = new Map();
  let sample = .1, intervalId = 0;
  const stream = () => { const track = { stopped: false, stop() { this.stopped = true; } }; const s = { getTracks: () => [track] }; streams.push(s); return s; };
  class AudioContext {
    constructor() { contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 512, connect() {}, disconnect() {}, getFloatTimeDomainData(a) { a.fill(sample); } }; }
  }
  class RTCPeerConnection {
    constructor() { peers.push(this); this.connectionState = 'new'; }
    createDataChannel() { return this.channel = { readyState: 'open', sent: [], send(value) { this.sent.push(JSON.parse(value)); }, close() { this.readyState = 'closed'; } }; }
    addTrack() {}
    async createOffer() { return { sdp: 'v=0\r\nm=audio' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.channel.onopen(); }
    close() { this.closed = true; }
  }
  const box = { AudioContext, RTCPeerConnection, AbortController, Float32Array, console,
    navigator: { mediaDevices: { getUserMedia: async () => { if (mediaError) throw Object.assign(new Error(), { name: mediaError }); return deferredMedia ? deferredMedia() : stream(); } } },
    document: { addEventListener() {}, createElement: () => ({ play: async () => {}, pause() {} }) }, addEventListener() {},
    setTimeout, clearTimeout, setInterval: fn => { intervals.set(++intervalId, fn); return intervalId; }, clearInterval: id => intervals.delete(id),
    fetch: async () => fetchError ? new Response(JSON.stringify({ error: 'Voice unavailable' }), { status: 503 }) : new Response('v=0\r\nm=audio')
  };
  vm.runInNewContext(source, box);
  const client = box.createOrbRealtime({ state: s => states.push(s), amplitude: x => levels.push(x), message: m => messages.push(m), active() {}, search: () => [{ id: 'safe', label: 'Safe' }], guide: id => { guided.push(id); return true; } });
  return { client, states, messages, levels, guided, streams, contexts, peers, intervals, stream,
    event: data => peers.at(-1).channel.onmessage({ data: JSON.stringify(data) }),
    tick: () => intervals.forEach(fn => fn()), sample: x => { sample = x; } };
}
test('native voice state events, actual input/output envelope, barge-in, read-only validation and cleanup', async () => {
  const h = harness(); await h.client.start();
  assert.equal(h.states.at(-1), 'listening'); h.tick(); assert.ok(h.levels.at(-1) > 0);
  h.event({ type: 'input_audio_buffer.speech_stopped' }); assert.equal(h.states.at(-1), 'thinking');
  const output = h.stream(); h.peers[0].ontrack({ track: { kind: 'audio' }, streams: [output] });
  h.event({ type: 'output_audio_buffer.started' }); assert.equal(h.states.at(-1), 'speaking');
  h.sample(.15); h.tick(); const loud = h.levels.at(-1);
  h.sample(0); for (let i = 0; i < 30; i++) h.tick(); assert.ok(h.levels.at(-1) < loud / 100);
  h.event({ type: 'input_audio_buffer.speech_started' }); assert.equal(h.states.at(-1), 'listening');
  const call = (id, name, args) => h.event({ type: 'response.function_call_arguments.done', call_id: id, name, arguments: JSON.stringify(args) });
  call('1', 'guide_node', { id: 'arbitrary' }); call('2', 'execute', { id: 'safe' }); assert.deepEqual(h.guided, []);
  call('3', 'search_nodes', { query: 'Safe' }); call('4', 'guide_node', { id: 'safe' }); assert.deepEqual(h.guided, ['safe']);
  call('4', 'guide_node', { id: 'safe' }); call('5', 'guide_node', { id: 'safe', action: 'delete' }); assert.equal(h.guided.length, 1);
  assert.equal(h.peers[0].channel.sent.filter(e => e.type === 'response.create').length, 0);
  h.event({ type: 'response.done', response: { status: 'completed' } });
  assert.equal(h.peers[0].channel.sent.filter(e => e.type === 'response.create').length, 1);
  h.client.stop(); assert.equal(h.client.active, false); assert.equal(h.intervals.size, 0);
  assert.ok(h.streams.every(s => s.getTracks()[0].stopped)); assert.ok(h.contexts.every(c => c.closed)); assert.ok(h.peers.every(p => p.closed));
  h.event({ type: 'output_audio_buffer.started' }); assert.equal(h.states.at(-1), 'idle');
  await h.client.start(); assert.equal(h.states.at(-1), 'listening'); h.client.stop();
});
test('permission, missing microphone, API failure and remote close release resources', async () => {
  for (const options of [{ mediaError: 'NotAllowedError' }, { mediaError: 'NotFoundError' }, { fetchError: true }, {}]) {
    const h = harness(options); await h.client.start();
    if (!Object.keys(options).length) h.event({ type: 'session.closed' });
    assert.equal(h.states.at(-1), 'error'); assert.equal(h.client.active, false);
    assert.ok(h.contexts.every(c => c.closed)); assert.ok(h.streams.every(s => s.getTracks()[0].stopped));
  }
});
test('stop during microphone permission closes late stream without creating peer', async () => {
  let resolveMedia;
  const h = harness({ deferredMedia: () => new Promise(resolve => { resolveMedia = resolve; }) });
  const starting = h.client.start(); await new Promise(resolve => setImmediate(resolve));
  h.client.stop(); resolveMedia(h.stream()); await starting;
  assert.ok(h.streams[0].getTracks()[0].stopped); assert.equal(h.peers.length, 0); assert.equal(h.client.active, false);
});
