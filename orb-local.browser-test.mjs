import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const profile = join(tmpdir(), 'universal-space-orb-local-tests');
const samplePath = join(tmpdir(), 'universal-space-orb-local-sample.wav');
const base = 'http://127.0.0.1:4173';

async function open(args = []) {
  const context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', ...args] });
  const page = context.pages()[0]; page.setDefaultTimeout(300000);
  page.on('pageerror', error => console.log('PAGE ERROR', error.message));
  page.on('requestfailed', req => console.log('NETWORK FAILURE', new URL(req.url()).hostname, req.failure()?.errorText));
  await page.goto(base);
  if (await page.getByRole('button', { name: 'Create my Memory Space', exact: true }).isVisible()) {
    await page.getByLabel('Name your first Space').fill('Local voice test');
    await page.getByRole('button', { name: 'Create my Memory Space', exact: true }).click();
  }
  await page.locator('.orb-card').evaluate(el => { el.open = true; });
  await page.getByLabel('Orb voice provider').selectOption('local');
  return { context, page };
}

// First create a real Lily sample and transcribe it in the same browser worker.
let { context, page } = await open();
try {
  const result = await page.evaluate(async () => {
    const worker = new Worker('./orb-local-worker.js', { type: 'module' });
    let id = 0;
    const run = (type, payload) => new Promise((resolve, reject) => {
      const current = ++id;
      worker.onmessage = ({ data }) => {
        if (data.id !== current || data.progress) return;
        data.error ? reject(new Error(data.error)) : resolve(data);
      };
      worker.onerror = event => reject(new Error(event.message));
      worker.postMessage({ id: current, type, ...payload });
    });
    try {
      const speech = await run('speak', { text: 'Hello Orb. How are you today?' });
      const offline = new OfflineAudioContext(1, Math.ceil(speech.audio.length / speech.sampleRate * 16000), 16000);
      const buffer = offline.createBuffer(1, speech.audio.length, speech.sampleRate); buffer.copyToChannel(speech.audio, 0);
      const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
      const pcm = (await offline.startRendering()).getChannelData(0);
      const transcript = await run('transcribe', { audio: pcm });
      return { text: transcript.text, rate: speech.sampleRate, audio: Array.from(speech.audio) };
    } finally { worker.terminate(); }
  });
  assert.match(result.text, /how are you/i);
  assert.equal(result.rate, 24000); assert.ok(result.audio.length > 24000);
  console.log('PASS: real Kokoro bf_lily at speed 1.2 generated sample; real Whisper transcript:', result.text);
  const wav = Buffer.alloc(44 + result.audio.length * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(result.rate, 24); wav.writeUInt32LE(result.rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  result.audio.forEach((v, i) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + i * 2));
  await writeFile(samplePath, wav);
} finally { await context.close(); }

({ context, page } = await open([`--use-file-for-fake-audio-capture=${samplePath}`]));
const openaiRequests = [], errors = [];
page.on('request', req => { if (/api\.openai\.com|\/api\/orb\/realtime/.test(req.url())) openaiRequests.push(req.url()); });
page.on('pageerror', error => errors.push(error.message));
await page.evaluate(() => {
  window.__localTracks = []; window.__localContexts = []; window.__localStates = [];
  document.addEventListener('orb-presentation-state', event => __localStates.push(event.detail.state));
  const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async options => { const stream = await gum(options); __localTracks.push(...stream.getTracks()); return stream; };
  const AC = AudioContext;
  window.AudioContext = new Proxy(AC, { construct(target, args) { const ac = new target(...args); __localContexts.push(ac); return ac; } });
});
try {
  for (let turn = 0; turn < 2; turn++) {
    await page.getByRole('button', { name: 'Speak to Orb', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.orb-card').dataset.state === 'listening');
    await page.waitForFunction(() => parseFloat(document.querySelector('.orb-card').style.getPropertyValue('--orb-amplitude')) > .37);
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Finish speaking to Orb', exact: true }).click();
    await page.waitForFunction(() => ['speaking', 'error'].includes(document.querySelector('.orb-card').dataset.state));
    assert.equal(await page.locator('.orb-card').getAttribute('data-state'), 'speaking', await page.locator('.orb-reply').textContent());
    await page.waitForFunction(() => parseFloat(document.querySelector('.orb-card').style.getPropertyValue('--orb-amplitude')) > .37);
    console.log('Spoken reply', await page.locator('.orb-reply').textContent());
    await page.waitForFunction(() => document.querySelector('.orb-card').dataset.state === 'idle');
    assert.ok(await page.evaluate(() => __localTracks.every(t => t.readyState === 'ended') && __localContexts.every(c => c.state === 'closed')));
    console.log(`PASS turn ${turn + 1}: sample microphone -> Whisper -> Ollama -> Kokoro -> audio output, real input/output amplitude, idle and cleanup`);
  }
  assert.deepEqual(openaiRequests, []); assert.deepEqual(errors, []);
  console.log('PASS: no OpenAI requests, no runtime errors; state history', await page.evaluate(() => __localStates));
} finally { await context.close(); }
