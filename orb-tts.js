// Same-origin speech interface: streamed mono PCM, independent of the voice provider.
export async function playOrbSpeech({ text, context, analyser, signal, onSpeaking }) {
  const response = await fetch('/api/orb/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal
  });
  if (!response.ok || !response.body || response.headers.get('X-Audio-Format') !== 'pcm-s16le' ||
      response.headers.get('X-Audio-Sample-Rate') !== '24000' || response.headers.get('X-Audio-Channels') !== '1') {
    await response.body?.cancel(); throw new Error('Local voice unavailable');
  }
  const reader = response.body.getReader(), sources = new Set();
  let next = context.currentTime, tail = null, started = false, complete = false, settle;
  const drained = new Promise(resolve => { settle = resolve; });
  const cancel = () => {
    void reader.cancel().catch(() => {});
    for (const source of sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    sources.clear(); settle();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    analyser.connect(context.destination);
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      let bytes = value;
      if (tail !== null) { bytes = new Uint8Array(value.length + 1); bytes[0] = tail; bytes.set(value, 1); }
      tail = bytes.length % 2 ? bytes[bytes.length - 1] : null;
      const count = Math.floor(bytes.length / 2);
      if (!count) continue;
      const buffer = context.createBuffer(1, count, 24000), samples = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(analyser); sources.add(source);
      source.onended = () => { source.disconnect(); sources.delete(source); if (complete && !sources.size) settle(); };
      next = Math.max(next, context.currentTime);
      source.start(next); next += buffer.duration;
      if (!started) { started = true; onSpeaking(); }
    }
    if (!started || tail !== null) throw new Error('Incomplete voice audio');
    complete = true;
    if (!sources.size) settle();
    await drained;
    signal.throwIfAborted();
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}
