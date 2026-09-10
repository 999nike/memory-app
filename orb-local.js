(() => {
  'use strict';
  globalThis.createOrbLocal = ({ state, amplitude, message, active, search, guide, phase }) => {
    let session = null, worker = null, serial = 0, pending = null;
    const history = [];
    const stopInput = s => {
      if (s.recorder?.state === 'recording') s.recorder.stop();
      s.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      s.inputSource?.disconnect();
      clearInterval(s.meter); clearTimeout(s.captureTimer);
    };
    const stop = (cancelInference = true) => {
      const s = session; session = null;
      if (s) {
        s.abort.abort(); clearTimeout(s.deadline); stopInput(s);
        if (s.output) { s.output.onended = null; try { s.output.stop(); } catch {} s.output.disconnect(); }
        s.analyser?.disconnect(); s.context?.close().catch(() => {});
      }
      if (cancelInference && worker) { worker.terminate(); worker = null; pending?.reject(new Error('Cancelled')); pending = null; }
      amplitude(0); active(false); phase?.('idle'); state('idle');
    };
    const infer = (type, payload) => {
      if (!worker) {
        worker = new Worker('./orb-local-worker.js', { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (data.id !== pending?.id) return;
          if (data.progress) { message(data.progress); return; }
          const job = pending; pending = null;
          data.error ? job.reject(new Error(data.error)) : job.resolve(data);
        };
        worker.onerror = () => { pending?.reject(new Error('Local voice worker unavailable. Check model downloads and retry.')); pending = null; worker?.terminate(); worker = null; };
      }
      return new Promise((resolve, reject) => {
        pending = { id: ++serial, resolve, reject };
        worker.postMessage({ id: serial, type, ...payload }, payload.audio ? [payload.audio.buffer] : []);
      });
    };
    const meter = s => {
      const samples = new Float32Array(s.analyser.fftSize); let envelope = 0;
      s.meter = setInterval(() => {
        if (session !== s) return;
        s.analyser.getFloatTimeDomainData(samples);
        let energy = 0; for (const v of samples) energy += v * v;
        const rms = Math.min(1, Math.sqrt(energy / samples.length) * 5);
        envelope += (rms - envelope) * (rms > envelope ? .7 : .3); amplitude(envelope);
      }, 50);
    };
    const fail = (s, error) => {
      if (session !== s) return;
      stop();
      const friendly = { NotAllowedError: 'Microphone permission denied. Allow microphone access and try again.', NotFoundError: 'No microphone found. Connect one and try again.', NotReadableError: 'Microphone is busy or unavailable.' };
      message(friendly[error.name] || error.message || 'Local voice unavailable'); state('error');
    };
    const begin = async () => {
      stop(false);
      const s = { abort: new AbortController(), phase: 'thinking', chunks: [] }; session = s;
      active(true); phase?.('thinking'); state('thinking');
      s.deadline = setTimeout(() => fail(s, new Error('Local voice timed out. Try again.')), 300000);
      if (!globalThis.AudioContext) throw new Error('Local audio is unavailable in this browser.');
      s.context = new AudioContext(); await s.context.resume();
      if (session !== s) return s;
      s.analyser = s.context.createAnalyser(); s.analyser.fftSize = 512;
      return s;
    };
    const answer = async (s, text) => {
      if (session !== s) return;
      s.phase = 'thinking'; phase?.('thinking'); state('thinking'); message('Thinking…');
      const resident = await import('./orb-resident.mjs');
      const result = await MemoryAI.generateFor('orb-local-ollama', { message: text, history, signal: s.abort.signal });
      if (session !== s) return;
      const validated = resident.validateResidentReply({ reply: result.reply, navigate: result.navigate });
      const resolved = resident.resolveResidentNavigation(validated, text, search, guide);
      history.push({ role: 'user', content: text }, { role: 'assistant', content: resolved.reply });
      history.splice(0, Math.max(0, history.length - 8));
      message(resolved.reply);
      const audio = await infer('speak', { text: resolved.reply });
      if (session !== s) return;
      message(resolved.reply);
      const buffer = s.context.createBuffer(1, audio.audio.length, audio.sampleRate);
      buffer.copyToChannel(audio.audio, 0);
      s.output = s.context.createBufferSource(); s.output.buffer = buffer;
      s.output.connect(s.analyser); s.analyser.connect(s.context.destination);
      s.phase = 'speaking'; phase?.('speaking'); state('speaking'); meter(s);
      s.output.onended = () => { if (session === s) stop(false); };
      s.output.start();
    };
    const finish = async () => {
      const s = session;
      if (!s || s.phase !== 'listening') return;
      s.phase = 'thinking'; phase?.('thinking'); state('thinking');
      stopInput(s); amplitude(0);
      try {
        await s.recorded;
        if (session !== s) return;
        message('Transcribing locally… First use downloads the speech model.');
        const decoded = await s.context.decodeAudioData(await new Blob(s.chunks, { type: s.recorder.mimeType }).arrayBuffer());
        if (session !== s) return;
        const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
        const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
        const pcm = (await offline.startRendering()).getChannelData(0);
        if (session !== s) return;
        const transcript = await infer('transcribe', { audio: pcm });
        if (session !== s) return;
        if (!transcript.text || transcript.text.length > 1000) throw new Error('I didn’t catch that. Please try a shorter phrase.');
        await answer(s, transcript.text);
      } catch (error) { fail(s, error); }
    };
    const start = async () => {
      let s;
      try {
        if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error('Microphone access requires localhost or HTTPS. You can still type to Orb.');
        s = await begin(); if (session !== s) return;
        message('Allow microphone access, then speak. Press Finish when you’re done.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (session !== s) { stream.getTracks().forEach(track => track.stop()); return; }
        s.stream = stream;
        stream.getTracks().forEach(track => { track.onended = () => fail(s, new Error('Microphone disconnected.')); });
        s.inputSource = s.context.createMediaStreamSource(stream); s.inputSource.connect(s.analyser);
        s.recorder = new MediaRecorder(stream);
        s.recorded = new Promise(resolve => { s.recorder.onstop = resolve; });
        s.recorder.ondataavailable = event => { if (event.data.size) s.chunks.push(event.data); };
        s.recorder.onerror = () => fail(s, new Error('Microphone recording failed.'));
        s.recorder.start(250); s.phase = 'listening'; phase?.('listening'); state('listening'); meter(s);
        message('I’m listening. Press Finish when you’re ready.');
        s.captureTimer = setTimeout(finish, 30000);
      } catch (error) { if (s || session) fail(s || session, error); else { message(error.message); state('error'); } }
    };
    const ask = async text => {
      let s;
      try {
        if (!text.trim() || text.length > 1000) return;
        stop(); s = await begin(); await answer(s, text.trim());
      } catch (error) { fail(s || session, error); }
    };
    globalThis.addEventListener('pagehide', () => stop());
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    return { start, stop, finish, ask, get active() { return session !== null; }, get phase() { return session?.phase || 'idle'; } };
  };
})();
