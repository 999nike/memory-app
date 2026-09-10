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
