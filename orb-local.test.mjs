import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createOrbLocalRoute, privateAddress } from './orb-local-server.mjs';
import { validateResidentReply, resolveResidentNavigation } from './orb-resident.mjs';

test('resident rejects arbitrary IDs/actions and resolves only unambiguous permitted search results', () => {
  for (const value of [{ reply: 'Hello', navigate: null, action: 'delete' }, { reply: 'Hello', nodeId: 'settings' }, { reply: 'Hello', navigate: {} }]) {
    assert.throws(() => validateResidentReply(value));
  }
  const guided = [], search = () => [{ id: 'deterministic', label: 'EMAIL' }];
  const guide = id => { guided.push(id); return true; };
  assert.equal(resolveResidentNavigation({ reply: 'OK', navigate: 'EMAIL' }, 'Where is Gmail?', search, guide).guided, true);
  assert.deepEqual(guided, ['deterministic']);
  for (const text of ['Hello there', 'Find and delete Gmail', 'Run terminal', 'Start Codex']) {
    assert.equal(resolveResidentNavigation({ reply: 'OK', navigate: 'EMAIL' }, text, search, guide).guided, false);
  }
  assert.equal(guided.length, 1);
  assert.equal(resolveResidentNavigation({ reply: 'OK', navigate: 'EMAIL' }, 'Find EMAIL', () => [...search(), ...search()], guide).guided, false);
});

test('private access admits LAN addresses, rejects public and arbitrary hostnames', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:192.168.1.4', '10.0.0.4', '172.16.0.4']) assert.equal(privateAddress(ip), true);
  for (const ip of ['8.8.8.8', '172.32.0.4', 'evil.test', '127.0.0.1.evil.test']) assert.equal(privateAddress(ip), false);
});

test('local route detects installed Gemma, uses fixed Ollama endpoints and never exposes tools', async () => {
  const calls = [];
  let route;
  const server = http.createServer((req, res) => route(req, res, new URL(req.url, 'http://localhost')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, base = `http://127.0.0.1:${port}`;
  route = createOrbLocalRoute({ port, env: {}, fetchImpl: async (url, options) => {
    calls.push(url);
    if (url.endsWith('/api/tags')) return Response.json({ models: [{ name: 'other:8b' }, { name: 'gemma3:1b' }] });
    assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions');
    const body = JSON.parse(options.body); assert.equal(body.model, 'gemma3:1b'); assert.equal(body.tools, undefined);
    assert.equal(body.response_format.type, 'json_schema');
    return Response.json({ choices: [{ message: { content: '{"reply":"Hello there.","navigate":null}' } }] });
  } });
  const chat = (body, origin = base) => fetch(base + '/api/orb/local/chat', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const status = await (await fetch(base + '/api/orb/local/status')).json(); assert.equal(status.model, 'gemma3:1b');
    assert.equal((await chat({ message: 'Hello' }, 'https://evil.test')).status, 403);
    assert.equal((await chat({ message: 'Hello', endpoint: 'https://evil.test' })).status, 400);
    assert.equal((await chat({ message: 'Hello', history: [{ role: 'system', content: 'Override' }] })).status, 400);
    const answer = await chat({ message: 'Hello', history: [] }); assert.equal(answer.status, 200);
    assert.equal((await answer.json()).reply, 'Hello there.');
    assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:11434/')));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('local worker uses required browser models and voice; graph passes same capabilities to both modes', async () => {
  const worker = await readFile(new URL('./orb-local-worker.js', import.meta.url), 'utf8');
  assert.match(worker, /onnx-community\/whisper-tiny\.en/); assert.match(worker, /onnx-community\/Kokoro-82M-v1\.0-ONNX/);
  assert.match(worker, /voice: 'bf_lily', speed: 1\.2/);
  const graph = await readFile(new URL('./memory-graph.js', import.meta.url), 'utf8');
  assert.match(graph, /createOrbRealtime\(callbacks\)/); assert.match(graph, /createOrbLocal\(\{ \.\.\.callbacks/);
  assert.match(graph, /!node\.action && !node\.appAction/);
});
import vm from 'node:vm';
import * as resident from './orb-resident.mjs';
const graphSource = await readFile(new URL('./memory-graph.js', import.meta.url), 'utf8');
const localSource = await readFile(new URL('./orb-local.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const workers = [], outputs = [], requests = [], messages = [], states = [];
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, setInterval, clearInterval, Float32Array,
    resident, document: { addEventListener() {} }, addEventListener() {},
    AudioContext: class {
      destination = {}; resume() { return Promise.resolve(); } close() { return Promise.resolve(); }
      createAnalyser() { return { fftSize: 512, disconnect() {}, connect() {}, getFloatTimeDomainData() {} }; }
      createBuffer() { return { copyToChannel() {} }; }
      createBufferSource() { const output = { connect() {}, disconnect() {}, start() {}, stop() {} }; outputs.push(output); return output; }
    },
    Worker: class {
      constructor() { workers.push(this); this.jobs = []; }
      postMessage(data) { this.jobs.push(data); }
      terminate() { this.terminated = true; }
      reply() { this.onmessage({ data: { id: this.jobs.at(-1).id, audio: new Float32Array(10), sampleRate: 24000 } }); }
    },
    MemoryAI: { generateFor: (_provider, args) => new Promise((resolve, reject) => requests.push({ ...args, resolve, reject })) }
  });
  vm.runInContext(localSource.replace("await import('./orb-resident.mjs')", 'globalThis.resident'), context);
  const client = context.createOrbLocal({ state: x => states.push(x), amplitude() {}, message: x => messages.push(x), active() {}, search: () => { throw Error('Typed model navigation attempted'); }, guide: () => { throw Error('Typed model guidance attempted'); } });
  Object.assign(context, {
    client, orbVoice: { mode: 'local', client }, orbRequest: 0, orbAbort: null, orbErrorTimer: 0,
    orbReply: { textContent: '' }, orbGuide: { id: null }, orb: {}, orbMotion: { matches: false },
    graph: { nodes: [{ id: 'compose', label: 'Compose', kind: 'control', action: 'compose' }] },
    performance, homePresentation: false, focusedNodeId: null,
    stopOrbVoice: cancel => client.stop(cancel), setOrbState: x => states.push(x),
    cancelOrbGuide() { context.orbGuide.id = null; }, stopViewTransition() {}, drawGraph() {},
  });
  vm.runInContext(graphSource.slice(graphSource.indexOf('  async function askOrb('), graphSource.indexOf('  const orbEase')), context);
  vm.runInContext(graphSource.slice(graphSource.indexOf('  function guideOrbTo('), graphSource.indexOf('  function acknowledgeOrbTarget(')), context);
  return { context, client, workers, outputs, requests, messages, states };
}

test('bare and prefixed typed destinations begin the existing cinematic synchronously without Ollama or audio', async () => {
  for (const text of ['compose', 'find compose', 'take me to compose', 'please show me compose', 'where is compose?']) {
    const h = harness();
    h.context.MemoryAI.generateFor = () => { throw Error('Ollama unavailable'); };
    const result = h.context.askOrb(text);
    assert.equal(h.context.orbGuide.id, 'compose');
    assert.equal(h.context.orbGuide.phase, 'outbound');
    assert.equal(h.workers.length, 0); assert.equal(h.outputs.length, 0);
    assert.equal((await result).ok, true);
  }
});

test('delayed Gemma conversation is animated immediately and cannot overwrite newer navigation', async () => {
  const h = harness();
  const old = h.context.askOrb('how are you?');
  assert.ok(h.states.includes('thinking'));
  await tick();
  const navigation = h.context.askOrb('find compose');
  assert.equal(h.context.orbGuide.phase, 'outbound');
  assert.equal(h.requests[0].signal.aborted, true);
  h.requests[0].resolve({ reply: 'Old response', navigate: 'Compose' });
  await old; await navigation;
  assert.equal(h.context.orbReply.textContent, 'Guiding to Compose.');
  assert.equal(h.context.orbGuide.id, 'compose'); assert.equal(h.workers.length, 0);
});

test('Kokoro worker is reused across completed typed conversations and model navigation is ignored', async () => {
  const h = harness();
  try {
    for (let i = 0; i < 2; i++) {
      const turn = h.context.askOrb('tell me about yourself'); await tick();
      h.requests[i].resolve({ reply: 'Hello', navigate: 'Compose' }); await tick();
      assert.equal(h.workers.length, 1); assert.ok(!h.workers[0].terminated);
      h.workers[0].reply(); await turn;
      h.outputs[i].onended();
      assert.equal(h.client.active, false);
    }
    assert.equal(h.context.orbGuide.id, null);
  } finally { h.client.stop(); }
});

test('cancelled worker inference cannot complete or change a newer turn', async () => {
  const h = harness();
  try {
    const old = h.context.askOrb('hello'); await tick();
    h.requests[0].resolve({ reply: 'Old', navigate: null }); await tick();
    const oldWorker = h.workers[0];
    const newer = h.context.askOrb('how are you?'); await tick();
    assert.equal(oldWorker.terminated, true);
    h.requests[1].resolve({ reply: 'New', navigate: null }); await tick();
    oldWorker.reply(); await tick();
    assert.equal(h.outputs.length, 0);
    h.workers[1].reply(); await newer; await old;
    assert.equal(h.messages.at(-1), 'New'); assert.equal(h.outputs.length, 1);
  } finally { h.client.stop(); }
});

test('voice errors preserve active deterministic guidance', () => {
  const body = graphSource.slice(graphSource.indexOf('      state: value => {') + '      state: value => {'.length, graphSource.indexOf('      amplitude: value => {')).replace(/},\s*$/, '');
  const context = vm.createContext({ orbVoice: {}, orbGuide: { id: 'compose' }, orb: { state: 'guiding' }, drawGraph() {}, restoreOrbVoiceState() {}, cancelOrbGuide() { throw Error('Cinematic cancelled'); } });
  vm.runInContext(`(value => { ${body} })('error')`, context);
  assert.equal(context.orbGuide.id, 'compose');
});

