(() => {
  'use strict';
  // The only capabilities accepted from the data channel are supplied explicitly here.
  globalThis.createOrbRealtime = ({ state, amplitude, message, active, search, guide }) => {
    let session = null;
    const stop = () => {
      const s = session; session = null;
      if (s) {
        clearTimeout(s.timeout); clearTimeout(s.disconnectTimer); clearInterval(s.meter);
        s.abort.abort();
        s.channel?.close(); s.peer?.close();
        for (const stream of [s.input, s.output]) stream?.getTracks().forEach(track => track.stop());
        s.sources.forEach(source => source.disconnect());
        s.audio?.pause(); if (s.audio) s.audio.srcObject = null;
        s.context?.close().catch(() => {});
      }
      amplitude(0); active(false); state('idle');
    };
    const start = async () => {
      stop();
      const s = { abort: new AbortController(), sources: [], targets: new Set(), calls: new Set(), playing: false, connected: false };
      session = s;
      const current = () => session === s;
      const fail = text => { if (current()) { stop(); message(text); state('error'); } };
      const send = event => { if (current() && s.channel?.readyState === 'open') s.channel.send(JSON.stringify(event)); };
      active(true); state('thinking'); message('Allow microphone access to connect. AI-generated voice via OpenAI.');
      s.timeout = setTimeout(() => fail('Voice connection timed out. Click Mic to retry.'), 30000);
      try {
        if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection || !globalThis.AudioContext) {
          throw new Error('Voice requires a browser with WebRTC and microphone access on localhost or HTTPS.');
        }
        s.context = new AudioContext();
        // Resume in the click gesture so remote playback does not depend on autoplay permission.
        await s.context.resume();
        if (!current()) return;
        const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!current()) { input.getTracks().forEach(track => track.stop()); return; }
        s.input = input;
        const analyse = (stream, output = false) => {
          const source = s.context.createMediaStreamSource(stream);
          const analyser = s.context.createAnalyser(); analyser.fftSize = 512;
          source.connect(analyser); s.sources.push(source, analyser);
          if (output) analyser.connect(s.context.destination);
          const samples = new Float32Array(analyser.fftSize);
          return () => {
            analyser.getFloatTimeDomainData(samples);
            let sum = 0; for (const value of samples) sum += value * value;
            return Math.min(1, Math.sqrt(sum / samples.length) * 5);
          };
        };
        s.inputLevel = analyse(input);
        s.peer = new RTCPeerConnection();
        for (const track of input.getTracks()) {
          s.peer.addTrack(track, input);
          track.onended = () => fail('Microphone disconnected. Click Mic to retry.');
        }
        s.peer.ontrack = event => {
          if (!current() || event.track.kind !== 'audio') return;
          s.output = event.streams[0] || new MediaStream([event.track]);
          s.outputLevel = analyse(s.output, true);
          // A muted media element also maintains WebRTC playout in Chromium; Web Audio owns audible output.
          s.audio = document.createElement('audio'); s.audio.autoplay = true; s.audio.muted = true;
          s.audio.srcObject = s.output; s.audio.play().catch(() => {});
          event.track.onended = () => fail('Voice session closed. Click Mic to reconnect.');
        };
        s.peer.onconnectionstatechange = () => {
          if (!current()) return;
          clearTimeout(s.disconnectTimer);
          if (['failed', 'closed'].includes(s.peer.connectionState)) fail('Voice connection closed. Click Mic to reconnect.');
          else if (s.peer.connectionState === 'disconnected') s.disconnectTimer = setTimeout(() => fail('Voice disconnected. Click Mic to reconnect.'), 5000);
        };
        s.channel = s.peer.createDataChannel('oai-events');
        s.channel.onclose = () => fail('Voice session closed. Click Mic to reconnect.');
        s.channel.onerror = () => fail('Voice data connection failed. Click Mic to retry.');
        s.channel.onopen = () => {
          if (!current()) return;
          clearTimeout(s.timeout); s.connected = true; state('listening');
          message('Listening. Speak naturally; interrupt at any time. Mic stops the session.');
        };
        s.channel.onmessage = event => {
          if (!current() || typeof event.data !== 'string' || event.data.length > 65536) return;
          let data; try { data = JSON.parse(event.data); } catch { return; }
          switch (data.type) {
            case 'input_audio_buffer.speech_started': s.playing = false; s.toolPending = false; state('listening'); break;
            case 'input_audio_buffer.speech_stopped': state('thinking'); break;
            case 'response.created': s.transcript = ''; state('thinking'); break;
            case 'output_audio_buffer.started': s.playing = true; state('speaking'); break;
            case 'output_audio_buffer.stopped':
            case 'output_audio_buffer.cleared': s.playing = false; state('listening'); break;
            case 'response.output_audio_transcript.delta':
              s.transcript = ((s.transcript || '') + String(data.delta || '')).slice(-2000); message(s.transcript); break;
            case 'response.done':
              if (data.response?.status === 'failed') fail('Voice response failed. Click Mic to reconnect.');
              else if (data.response?.status === 'cancelled') { s.toolPending = false; if (!s.playing) state('listening'); }
              else if (s.toolPending) { s.toolPending = false; send({ type: 'response.create' }); state('thinking'); }
              else if (!s.playing) state('listening');
              break;
            case 'error': fail('Voice session error. Click Mic to retry.'); break;
            case 'session.closed': fail('Voice session ended. Click Mic to reconnect.'); break;
            case 'response.function_call_arguments.done': {
              if (typeof data.call_id !== 'string' || data.call_id.length > 200 || s.calls.has(data.call_id)) break;
              if (s.calls.size >= 100) { fail('Voice session limit reached. Click Mic to reconnect.'); break; }
              s.calls.add(data.call_id);
              let result = { error: 'Unsupported read-only request' };
              try {
                const args = JSON.parse(data.arguments);
                if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1) throw new Error();
                if (data.name === 'search_nodes' && typeof args.query === 'string' && args.query.trim() && args.query.length <= 160) {
                  result = search(args.query).slice(0, 10).map(item => ({ id: String(item.id), label: String(item.label).slice(0, 160) }));
                  s.targets = new Set(result.map(item => item.id));
                } else if (data.name === 'guide_node' && typeof args.id === 'string' && args.id.length <= 200 && s.targets.has(args.id)) {
                  result = { guided: guide(args.id) === true };
                }
              } catch { /* Never dispatch model identifiers into app actions. */ }
              send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: data.call_id, output: JSON.stringify(result) } });
              // Continue once the current response ends, including when it contains several calls.
              s.toolPending = true;
              break;
            }
          }
        };
        const offer = await s.peer.createOffer();
        if (!current()) return;
        await s.peer.setLocalDescription(offer);
        if (!current()) return;
        message('Connecting native voice…');
        const response = await fetch('/api/orb/realtime', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer.sdp, signal: s.abort.signal });
        if (!current()) return;
        if (!response.ok) {
          const value = await response.json().catch(() => ({}));
          throw new Error(value.error || 'Voice unavailable. Restart the local server with Realtime support.');
        }
        const answer = await response.text();
        if (!current()) return;
        await s.peer.setRemoteDescription({ type: 'answer', sdp: answer });
        if (!current()) return;
        let envelope = 0;
        s.meter = setInterval(() => {
          if (!current()) return;
          const level = s.playing ? s.outputLevel?.() || 0 : s.inputLevel();
          envelope += (level - envelope) * (level > envelope ? .7 : .3);
          amplitude(envelope);
        }, 50);
      } catch (error) {
        const text = ({ NotAllowedError: 'Microphone permission denied. Allow it in browser settings, then click Mic.', NotFoundError: 'No microphone found. Connect one and click Mic.', NotReadableError: 'Microphone is busy or unavailable. Close other audio apps and retry.' })[error.name];
        fail(text || error.message || 'Voice unavailable. Click Mic to retry.');
      }
    };
    globalThis.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    return { start, stop, get active() { return session !== null; } };
  };
})();
