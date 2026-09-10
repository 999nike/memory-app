// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package when not locally installed.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__voiceStreams = []; window.__voiceContexts = []; window.__voicePeers = [];
  const getMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async options => { const stream = await getMedia(options); window.__voiceStreams.push(stream); return stream; };
  const AC = window.AudioContext, PC = window.RTCPeerConnection;
  window.AudioContext = new Proxy(AC, { construct(target, args) { const c = new target(...args); window.__voiceContexts.push(c); return c; } });
  window.RTCPeerConnection = new Proxy(PC, { construct(target, args) { const p = new target(...args); window.__voicePeers.push(p); return p; } });
});
try {
  await page.goto('http://127.0.0.1:4173');
  await page.waitForSelector('.orb-card');
  console.log('Initial inputs', await page.locator('input:visible').evaluateAll(nodes => nodes.map(n => ({ id: n.id, placeholder: n.placeholder }))));
  if (await page.getByRole('button', { name: 'Create my Memory Space', exact: true }).isVisible()) {
    await page.getByLabel('Name your first Space').fill('Voice test');
    await page.getByRole('button', { name: 'Create my Memory Space', exact: true }).click();
  }
  await page.waitForFunction(() => document.querySelector('#memoryGraphSurface')?.dataset.memoryGraphReady === 'true');
  await page.locator('.orb-card').evaluate(el => { el.open = true; });
  await page.getByLabel('Orb voice provider').selectOption('realtime');
  await page.screenshot({ path: join(tmpdir(), 'universal-orb-idle.png') });
  assert.ok(await page.evaluate(() => MemoryGraph.orbSearch('Settings').length > 0));
  await page.getByRole('button', { name: 'Speak to Orb', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.orb-reply').textContent.includes('not configured'));
  assert.equal(await page.locator('.orb-card').getAttribute('data-state'), 'error');
  const clean = () => page.evaluate(() => ({ tracks: __voiceStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')), contexts: __voiceContexts.every(c => c.state === 'closed'), peers: __voicePeers.every(p => p.connectionState === 'closed') }));
  assert.deepEqual(await clean(), { tracks: true, contexts: true, peers: true });
  console.log('PASS: real browser microphone permission path, missing-key failure, all resources released');

  // An in-browser remote peer exercises actual WebRTC/AudioContext plumbing without an API key.
  // Server events below are simulated; this does not claim live GPT speech or server VAD.
  await page.route('**/api/orb/realtime', async route => {
    console.log('Local peer: received offer');
    const answer = await page.evaluate(async offer => {
      const remote = window.__remote = new RTCPeerConnection();
      const ac = window.__remoteAudio = new AudioContext(); await ac.resume();
      const tone = ac.createOscillator(), gain = ac.createGain(), dest = ac.createMediaStreamDestination();
      tone.frequency.value = 220; gain.gain.value = .12;
      tone.connect(gain).connect(dest); tone.start(); window.__remoteGain = gain;
      remote.addTrack(dest.stream.getAudioTracks()[0], dest.stream);
      remote.ondatachannel = event => {
        window.__remoteChannel = event.channel; window.__toolOutputs = [];
        event.channel.onmessage = message => {
          const data = JSON.parse(message.data);
          if (data.type === 'conversation.item.create') __toolOutputs.push(data.item);
        };
      };
      await remote.setRemoteDescription({ type: 'offer', sdp: offer });
      await remote.setLocalDescription(await remote.createAnswer());
      await new Promise(resolve => {
        setTimeout(resolve, 1200);
        if (remote.iceGatheringState === 'complete') resolve();
        else remote.addEventListener('icegatheringstatechange', () => { if (remote.iceGatheringState === 'complete') resolve(); });
      });
      return remote.localDescription.sdp;
    }, route.request().postData());
    console.log('Local peer: answering');
    await route.fulfill({ status: 200, contentType: 'application/sdp', body: answer });
    console.log('Local peer: response fulfilled');
    await page.evaluate(async () => {
      const client = __voicePeers.at(-2);
      const candidates = client.localDescription.sdp.split(/\r?\n/).filter(line => line.startsWith('a=candidate:'));
      for (const line of candidates) await __remote.addIceCandidate({ candidate: line.slice(2), sdpMid: '0' });
    });
  });
  await page.getByRole('button', { name: 'Speak to Orb', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.orb-card').dataset.state === 'listening');
  await page.waitForFunction(async () => {
    const stats = await __remote.getStats();
    return [...stats.values()].some(s => s.type === 'inbound-rtp' && s.kind === 'audio' && s.totalAudioEnergy > 0);
  });
  console.log('PASS: actual microphone audio energy received by the local peer');
  const event = data => page.evaluate(data => __remoteChannel.send(JSON.stringify(data)), data);
  await event({ type: 'input_audio_buffer.speech_stopped' });
  await page.waitForFunction(() => document.querySelector('.orb-card').dataset.state === 'thinking');
  await event({ type: 'output_audio_buffer.started' });
  await page.waitForFunction(() => document.querySelector('.orb-card').dataset.state === 'speaking');
  await page.waitForFunction(() => parseFloat(document.querySelector('.orb-card').style.getPropertyValue('--orb-amplitude')) > .45);
  await page.screenshot({ path: join(tmpdir(), 'universal-orb-speaking.png') });
  await page.evaluate(() => { __remoteGain.gain.value = 0; });
  await page.waitForFunction(() => parseFloat(document.querySelector('.orb-card').style.getPropertyValue('--orb-amplitude')) < .36);
  await event({ type: 'input_audio_buffer.speech_started' });
  await page.waitForFunction(() => document.querySelector('.orb-card').dataset.state === 'listening');
  const tool = async (call_id, name, args) => {
    await event({ type: 'response.function_call_arguments.done', call_id, name, arguments: JSON.stringify(args) });
    await page.waitForFunction(id => __toolOutputs.some(item => item.call_id === id), call_id);
    return page.evaluate(id => JSON.parse(__toolOutputs.find(item => item.call_id === id).output), call_id);
  };
  assert.ok((await tool('unsafe', 'guide_node', { id: 'settings:ai-access' })).error);
  assert.deepEqual(await tool('action', 'search_nodes', { query: 'Codex' }), []);
  const targets = await tool('safe-search', 'search_nodes', { query: 'Settings' });
  assert.ok(targets.length);
  assert.equal((await tool('safe-guide', 'guide_node', { id: targets[0].id })).guided, true);
  assert.equal(await page.locator('.orb-card').getAttribute('data-voice'), 'true');
  console.log('PASS: actual graph tool boundary excludes action nodes, rejects arbitrary IDs, guides validated target without disconnecting voice');
  await page.getByRole('button', { name: 'Stop Orb voice', exact: true }).click();
  await page.evaluate(async () => { __remote.close(); await __remoteAudio.close(); });
  assert.deepEqual(await clean(), { tracks: true, contexts: true, peers: true });
  console.log('PASS: real local WebRTC connects, remote audio meters rise/fall with tone/silence, listening/thinking/speaking and interruption events, stop cleanup');

  const before = await page.evaluate(() => MemoryGraphRotation.snapshot());
  await page.keyboard.down('Control');
  await page.mouse.move(650, 850); await page.mouse.down(); await page.mouse.move(790, 780, { steps: 12 }); await page.mouse.up();
  await page.keyboard.up('Control');
  const after = await page.evaluate(() => MemoryGraphRotation.snapshot());
  assert.notEqual(after.yaw, before.yaw);
  console.log('Rotation before/after', before, after);
  await page.evaluate(() => MemoryGraph.resetRotation());
  const settings = await page.evaluate(() => MemoryGraph.projectPresentationControl('settings'));
  assert.ok(settings);
  await page.mouse.click(settings.screenX, settings.screenY);
  await page.waitForFunction(() => MemoryGraph.presentationControlState('settings:ai-access')?.hidden === false);
  console.log('PASS: pointer click expands existing Settings nodes');
  const zoomBefore = await page.evaluate(() => MemoryGraph.presentationState().view.scale);
  await page.mouse.move(650, 500); await page.mouse.wheel(0, -120);
  await page.waitForFunction(before => MemoryGraph.presentationState().view.scale !== before, zoomBefore);
  console.log('PASS: graph wheel zoom');
  console.log('Average graph redraw ms', await page.evaluate(() => {
    const start = performance.now(); for (let i = 0; i < 20; i++) MemoryGraph.redraw();
    return Math.round((performance.now() - start) / 20 * 10) / 10;
  }));
  const result = await page.evaluate(() => MemoryGraph.askOrb('Settings'));
  assert.equal(result.ok, true);
  assert.ok(await page.evaluate(() => MemoryGraph.orbGuidanceState().targetId));
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(tmpdir(), 'universal-orb-mobile.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => MemoryGraph.redraw());
  assert.equal(await page.locator('.orb-equaliser i').first().evaluate(el => getComputedStyle(el).animationName), 'none');
  console.log('PASS: deterministic guidance, resize, mobile overflow, reduced motion');
  assert.deepEqual(errors, []);
  console.log('PASS: no browser runtime exceptions. Screenshots:', tmpdir());
} catch (error) {
  console.log('Browser failure state', await page.evaluate(() => ({ state: document.querySelector('.orb-card')?.dataset.state, reply: document.querySelector('.orb-reply')?.textContent, peers: __voicePeers.map(p => ({ state: p.connectionState, ice: p.iceConnectionState, gathering: p.iceGatheringState, signaling: p.signalingState, localCandidates: (p.localDescription?.sdp.match(/a=candidate/g) || []).length, remoteCandidates: (p.remoteDescription?.sdp.match(/a=candidate/g) || []).length })), contexts: __voiceContexts.map(c => c.state), channel: window.__remoteChannel?.readyState })));
  throw error;
} finally { await browser.close(); }
