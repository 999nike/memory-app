(() => {
  'use strict';

  const VERSION = 14;
  const WORKSPACE_KEY = 'memory-space-v1';
  const GRAPH_STATE_KEY = 'memory-graph-layout-v1';
  const GRAPH_STATE_VERSION = 1;
  const MAX_SIMULATION_FRAMES = 900;
  const SETTLED_SPEED = 0.035;
  const MIN_SCALE = 0.45;
  const MAX_SCALE = 2.8;
  const UNIVERSE_BOUNDARY_FORCE = 0.0012;
  const CLUSTER_ROOT_INERTIA = 5;
  const DIRECT_APP_CHILD_ORBIT = 72;
  const DIRECT_APP_CHILD_ORBIT_STEP = 9;
  const DIRECT_APP_CHILD_MAX_ORBIT = 135;
  const IMPORTANCE_WEIGHT = {
    critical: 1.42,
    high: 1.20,
    normal: 1,
    low: 0.86
  };
  const IMPORTANCE_RADIUS = {
    critical: 23,
    high: 19,
    normal: 15,
    low: 12
  };
  let surface = null;
  let canvas = null;
  let context = null;
  let resizeObserver = null;
  let workspaceObserver = null;
  let inspectorBridgeActive = false;
  let graph = null;
  let animationFrame = 0;
  let simulationFrames = 0;
  let pointerState = null;
  let interactionsBound = false;
  let searchBound = false;
  let appAdaptersBound = false;
  let focusedNodeId = null;
  let homePresentation = false;
  let persistTimer = 0;
  let viewTransitionFrame = 0;
  const presentationControlSpecs = new Map();
  const presentationControlNodes = new Map();
  const expandedAppNodeIds = new Set();
  const expansionAnchoredRootIds = new Set();
  let activeControlParentId = null;
  // Resident visual only: never enters graph collections, hit testing or storage.
  const orbStates = ['idle', 'listening', 'thinking', 'speaking', 'guiding', 'arrived', 'error'];
  const orbMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const orb = { state: 'idle', amplitude: 0.5, time: 0, last: 0, frame: 0, mounted: false };
  const orbGuide = { id: null, start: 0, from: null, position: null, timer: 0, arrived: 0, phase: null, viewFrom: null, spatialOwned: false };
  let orbRequest = 0, orbAbort = null, orbReply = null, orbErrorTimer = 0;

  const orbVoice = { recognition: null, speaking: false, utterance: null, token: 0, button: null };

  function restoreOrbVoiceState() {
    orb.state = orbVoice.speaking ? 'speaking' : orbGuide.id ? (orbGuide.phase === 'arrived' ? 'arrived'
      : orbGuide.phase === 'lock' ? 'thinking' : 'guiding') : 'idle';
    drawGraph();
  }

  function stopOrbVoice() {
    orbVoice.token++;
    const recognition = orbVoice.recognition;
    orbVoice.recognition = null;
    try { recognition?.abort(); } catch { /* Already ended. */ }
    if (orbVoice.utterance) globalThis.speechSynthesis?.cancel();
    orbVoice.utterance = null; orbVoice.speaking = false;
    orbVoice.button?.setAttribute('aria-pressed', 'false');
  }

  function speakOrbReply(reply, requestId) {
    if (!globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    const token = orbVoice.token;
    const utterance = new SpeechSynthesisUtterance(reply);
    orbVoice.utterance = utterance;
    utterance.rate = .95;
    utterance.onstart = () => {
      if (token !== orbVoice.token || requestId !== orbRequest) return;
      orbVoice.speaking = true; orb.state = 'speaking'; drawGraph();
    };
    const finish = () => {
      if (token !== orbVoice.token || requestId !== orbRequest) return;
      orbVoice.speaking = false; orbVoice.utterance = null;
      restoreOrbVoiceState();
    };
    utterance.onend = finish; utterance.onerror = finish;
    try { speechSynthesis.speak(utterance); } catch { finish(); }
  }

  function mountOrbMicrophone(card, input) {
    const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) return;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = 'Mic';
    button.setAttribute('aria-label', 'Speak to Orb');
    button.setAttribute('aria-pressed', 'false');
    orbVoice.button = button;
    card.querySelector('.orb-input-row').append(button);
    button.addEventListener('click', () => {
      if (orbVoice.recognition) {
        stopOrbVoice(); restoreOrbVoiceState(); return;
      }
      stopOrbVoice();
      ++orbRequest; orbAbort?.abort(); clearTimeout(orbErrorTimer);
      cancelOrbGuide();
      let recognition;
      try { recognition = new Recognition(); } catch {
        orbReply.textContent = 'Microphone unavailable. Type your request instead.'; restoreOrbVoiceState(); return;
      }
      orbVoice.recognition = recognition;
      recognition.lang = document.documentElement.lang || navigator.language || 'en-GB';
      recognition.continuous = false; recognition.interimResults = false;
      let accepted = false;
      const current = () => orbVoice.recognition === recognition;
      recognition.onstart = () => {
        if (!current()) return;
        orb.state = 'listening'; button.setAttribute('aria-pressed', 'true');
        orbReply.textContent = 'Listening...'; drawGraph();
      };
      recognition.onresult = event => {
        if (!current() || accepted) return;
        const transcript = Array.from(event.results).filter(result => result.isFinal)
          .map(result => result[0].transcript).join(' ').trim();
        if (!transcript) return;
        accepted = true; input.value = transcript;
        askOrb(transcript);
      };
      recognition.onerror = () => {
        if (!current()) return;
        orbReply.textContent = 'Microphone unavailable. Type your request instead.';
        stopOrbVoice(); restoreOrbVoiceState();
      };
      recognition.onend = () => {
        if (!current()) return;
        orbVoice.recognition = null; button.setAttribute('aria-pressed', 'false');
        if (!accepted) {
          orbReply.textContent = 'No speech received. Try again or type your request.';
          restoreOrbVoiceState();
        }
      };
      try { recognition.start(); } catch {
        orbReply.textContent = 'Microphone unavailable. Type your request instead.';
        stopOrbVoice(); restoreOrbVoiceState();
      }
    });
  }

  async function askOrb(value) {
    const text = String(value || '').trim();
    const requestId = ++orbRequest;
    stopOrbVoice();
    orbAbort?.abort(); clearTimeout(orbErrorTimer);
    const controller = new AbortController(); orbAbort = controller;
    setOrbState('thinking');
    const say = reply => { if (orbReply) orbReply.textContent = reply; };
    const fail = reply => {
      say(reply); setOrbState('error');
      orbErrorTimer = setTimeout(() => { if (requestId === orbRequest) setOrbState('idle'); }, 1600);
      return { ok: false, reply };
    };
    if (!text || text.length > 500) return fail('Enter a request of 1–500 characters.');
    say('Finding a safe destination…');
    let intent = { operation: 'find', query: text }, fallback = false;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const provider = globalThis.MemoryAI?.getActiveProvider?.();
      if (!provider?.local || provider.kind !== 'openai-compatible') throw new Error('Local interpreter unavailable');
      const result = await globalThis.MemoryAI.generate({
        signal: controller.signal, context: '', history: [],
        message: 'Interpret a read-only navigation request. Return ONLY JSON with exactly operation (find, guide, or open), query (a short node label, retaining app qualifiers), and reply (short text). Never return IDs, tools, actions, or commands. For unsupported write requests return operation "unsupported". Gmail is labelled EMAIL. Request: ' + JSON.stringify(text)
      });
      if (requestId !== orbRequest) return { ok: false, stale: true };
      let parsed;
      try { parsed = JSON.parse(result.reply); } catch { return fail('Invalid interpreter response. Try a direct node label.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
          Object.keys(parsed).sort().join(',') !== 'operation,query,reply' ||
          !['find', 'guide', 'open'].includes(parsed.operation) ||
          typeof parsed.query !== 'string' || !parsed.query.trim() || parsed.query.length > 160 ||
          typeof parsed.reply !== 'string' || parsed.reply.length > 240) {
        return fail('Unsupported interpreter response. No action taken.');
      }
      intent = parsed;
    } catch {
      if (requestId !== orbRequest) return { ok: false, stale: true };
      fallback = true;
    } finally { clearTimeout(timeout); }
    if (requestId !== orbRequest) return { ok: false, stale: true };
    // Only renderer-owned search may supply an ID. Model reply is never executed.
    const target = orbSearch(intent.query)[0];
    if (!target || !guideOrbTo(target.id, requestId)) return fail('No safe visible node matched. Try its label.');
    const reply = `${fallback ? 'Local AI unavailable. ' : ''}Guiding to ${target.label}.${intent.operation === 'open' ? ' Opening is disabled; guidance only.' : ''}`;
    say(reply);
    speakOrbReply(reply, requestId);
    return { ok: true, targetId: target.id, fallback, reply };
  }

  // Guidance destinations may carry actions; targeting never dispatches or expands them.
  function orbSafeNode(id) {
    return graph?.nodes.find(node => String(node.id) === String(id) && !node.hidden &&
      ['space', 'memory', 'control'].includes(node.kind)) || null;
  }

  function orbSearch(query) {
    const text = String(query || '').trim().toLowerCase();
    if (!text || !graph) return [];
    const matches = node => {
      const labels = [String(node.label || node.name || '')];
      const seen = new Set([node.id]);
      let parent = graph.nodes.find(item => item.id === node.parentId);
      while (parent && !seen.has(parent.id)) {
        seen.add(parent.id); labels.push(String(parent.label || parent.name || ''));
        parent = graph.nodes.find(item => item.id === parent.parentId);
      }
      const path = labels.join(' ').toLowerCase();
      return text.split(/\s+/).every(word => path.includes(word));
    };
    return graph.nodes.filter(node => orbSafeNode(node.id) && matches(node))
      .sort((a, b) => Number(String(b.label || b.name).toLowerCase() === text) -
        Number(String(a.label || a.name).toLowerCase() === text) || String(a.id).localeCompare(String(b.id)))
      .slice(0, 10).map(node => ({ id: String(node.id), label: String(node.label || node.name || '') }));
  }

  const orbEase = value => {
    const t = clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  function resetOrbSpatial(node = orbSafeNode(orbGuide.id)) {
    if (!orbGuide.spatialOwned) return;
    const projected = node && projectPresentationNode(node);
    // Same underlying reset as Escape; completion is not a manual takeover.
    rotationApi()?.reset?.({ manual: false });
    orbGuide.spatialOwned = false;
    syncRotationState();
    if (node && projected) {
      focusedNodeId = node.id;
      focusPresentationNode(node, {
        redraw: false, exactScale: view.scale,
        screenX: projected.screenX, screenY: projected.screenY
      });
    }
  }

  function cancelOrbGuide(preserveSpatial = false) {
    clearTimeout(orbGuide.timer); orbGuide.timer = 0;
    if (!preserveSpatial) resetOrbSpatial();
    orbGuide.spatialOwned = false;
    rotationApi()?.cancelCinematic?.();
    if (orbGuide.phase) stopViewTransition();
    orbGuide.id = null; orbGuide.arrived = 0;
    orbGuide.phase = orbGuide.position && !orbMotion.matches ? 'return' : null;
    orbGuide.start = performance.now();
    orbGuide.from = orbGuide.position && { ...orbGuide.position };
    orbGuide.viewFrom = null; orbGuide.midpoint = null;
  }

  globalThis.addEventListener('orb-spatial-takeover', () => {
    homePresentation = false;
    ++orbRequest; orbAbort?.abort(); clearTimeout(orbErrorTimer);
    stopOrbVoice();
    cancelOrbGuide(true);
    orb.state = 'idle';
  });

  function guideOrbTo(id, requestId = null) {
    if (requestId !== null && requestId !== orbRequest) return false;
    const node = orbSafeNode(id);
    if (!node) return false;
    if (requestId === null) {
      ++orbRequest; orbAbort?.abort(); clearTimeout(orbErrorTimer); stopOrbVoice();
    }
    cancelOrbGuide();
    stopViewTransition();
    orbGuide.id = String(node.id);
    focusedNodeId = node.id;
    homePresentation = false;
    orbGuide.start = performance.now();
    orbGuide.from = orbGuide.position && { ...orbGuide.position };
    orbGuide.phase = orbMotion.matches ? 'arrived' : 'outbound';
    orb.state = 'guiding';
    if (orbMotion.matches) {
      focusPresentationNode(node, { animate: false });
      orb.state = 'arrived'; orbGuide.arrived = performance.now();
      orbGuide.timer = setTimeout(() => {
        cancelOrbGuide(); frameUniverse(); restoreOrbVoiceState();
      }, 1000);
    }
    drawGraph();
    return true;
  }

  // Advance before graph projection so both the graph and Orb see the same view.
  function updateOrbCinematic(now) {
    if (!orbGuide.id) return;
    const node = orbSafeNode(orbGuide.id);
    if (!node) { cancelOrbGuide(); orb.state = 'idle'; return; }
    if (orbMotion.matches) return;
    const elapsed = now - orbGuide.start;
    const durations = { outbound: 1050, lock: 500, cinematic: 3100, final: 950, arrived: 1000 };
    if (elapsed >= durations[orbGuide.phase]) {
      const next = { outbound: 'lock', lock: 'cinematic', cinematic: 'final', final: 'arrived', arrived: 'return' };
      if (orbGuide.phase === 'cinematic') rotationApi()?.advanceCinematic?.(1);
      orbGuide.phase = next[orbGuide.phase];
      orbGuide.start = now;
      orbGuide.from = orbGuide.position && { ...orbGuide.position };
      if (orbGuide.phase === 'cinematic') {
        orbGuide.viewFrom = { ...view };
        orbGuide.spatialOwned = rotationApi()?.beginCinematic?.(node, graph) === true;
      }
      if (orbGuide.phase === 'arrived') orbGuide.arrived = now;
      if (orbGuide.phase === 'return') {
        resetOrbSpatial(node);
        orbGuide.id = null; orbGuide.arrived = 0;
        orbGuide.viewFrom = null; orbGuide.midpoint = null;
        frameUniverse({ animate: true, duration: 1050 });
      }
    }
    if (orbGuide.phase === 'cinematic') {
      const progress = clamp((now - orbGuide.start) / 3100, 0, 1);
      rotationApi()?.advanceCinematic?.(orbEase(progress));
      const root = rotationApi()?.familyRoot?.(node, graph) || node;
      // Family first, then the canonical destination; retain surrounding structure.
      const family = projectPresentationNode(root), target = projectPresentationNode(node);
      const precise = orbEase((progress - .4) / .6);
      const scale = clamp(Math.max(orbGuide.viewFrom.scale, 1.08), MIN_SCALE, 1.4);
      focusPresentationNode(node, {
        redraw: false, from: orbGuide.viewFrom, progress: orbEase(progress), exactScale: scale,
        screenX: graph.width * (orbGuide.from?.x >= graph.width / 2 ? .36 : .64),
        projected: { x: family.x + (target.x - family.x) * precise,
          y: family.y + (target.y - family.y) * precise }
      });
    }
    if (!orbVoice.speaking) orb.state = orbGuide.phase === 'lock' ? 'thinking'
      : orbGuide.phase === 'arrived' ? 'arrived' : orbGuide.phase === 'return' ? 'idle' : 'guiding';
  }

  function setOrbState(state) {
    if (!orbStates.includes(state)) return false;
    cancelOrbGuide();
    orb.state = state;
    drawGraph();
    return true;
  }

  function setOrbAmplitude(value) {
    const amplitude = Number(value);
    if (!Number.isFinite(amplitude)) return false;
    orb.amplitude = Math.max(0, Math.min(1, amplitude));
    drawGraph();
    return true;
  }

  function orbLowDetail() {
    return (graph?.width || innerWidth) < 640 || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  }

  function homeComposition() {
    const desktop = graph.width > 800;
    const left = desktop ? 84 : 16;
    const right = graph.width - (desktop ? 24 : 16);
    const usable = right - left;
    const graphRight = desktop ? left + usable * .71 : right;
    return {
      desktop, left, graphRight, top: desktop ? 150 : 130,
      bottom: graph.height - (desktop ? 44 : 80),
      residentX: (graphRight + right) / 2,
      residentWidth: right - graphRight
    };
  }

  function drawOrb() {
    if (!document.body.classList.contains('molecular-view-active')) return;
    orb.syncPresentation?.();
    const low = orbLowDetail(), t = orbMotion.matches ? 0 : orb.time;
    const composition = homeComposition();
    // Overall filaments span ~2.8 radii: up to 440px in the resident zone.
    const radius = composition.desktop
      ? Math.min(157, (composition.residentWidth - 12) / 2.8, Math.max(64, (graph.height - 340) / 2.8))
      : Math.min(64, graph.width * .16, graph.height * .20);
    const margin = radius * 1.4 + 8;
    const home = composition.desktop
      ? { x: composition.residentX, y: 132 + radius * 1.4 }
      : { x: Math.max(graph.width / 2, graph.width - margin - 16),
          y: Math.min(graph.height / 2, margin + 116) };
    if (orb.card && composition.desktop && canvas) {
      const rect = canvas.getBoundingClientRect();
      const panelWidth = Math.min(420, composition.residentWidth);
      const top = Math.min(rect.top + home.y + radius * 1.4 + 24, innerHeight - 170);
      orb.card.style.setProperty('--orb-panel-width', panelWidth + 'px');
      orb.card.style.setProperty('--orb-panel-top', Math.max(90, top) + 'px');
      orb.card.style.setProperty('--orb-panel-right', Math.max(16, innerWidth - rect.left - home.x - panelWidth / 2) + 'px');
    }
    let { x, y } = orbGuide.position || home;
    const now = performance.now();
    const from = orbGuide.from || home;
    const mix = (destination, progress) => {
      const eased = orbEase(progress);
      x = from.x + (destination.x - from.x) * eased;
      y = from.y + (destination.y - from.y) * eased;
    };
    if (orbGuide.id) {
      const target = orbSafeNode(orbGuide.id);
      if (target) {
        const p = projectPresentationNode(target);
        const clearance = p.screenRadius + radius * 1.4 + 22;
        const candidates = [
          { x: p.screenX + clearance, y: p.screenY },
          { x: p.screenX - clearance, y: p.screenY },
          { x: p.screenX, y: p.screenY - clearance },
          { x: p.screenX, y: p.screenY + clearance }
        ];
        // Choose a fitting side before flight; never clamp the Orb into the node.
        const fitting = candidates.filter(q => q.x >= margin && q.x <= graph.width - margin &&
          q.y >= margin && q.y <= graph.height - margin);
        const beside = (fitting.length ? fitting : candidates).reduce((best, q) =>
          Math.hypot(q.x - from.x, q.y - from.y) < Math.hypot(best.x - from.x, best.y - from.y) ? q : best);
        if (orbGuide.phase === 'outbound') {
          if (!orbGuide.midpoint) orbGuide.midpoint = {
            x: from.x + (beside.x - from.x) * .48, y: from.y + (beside.y - from.y) * .48
          };
          mix(orbGuide.midpoint, (now - orbGuide.start) / 1050);
        } else if (orbGuide.phase === 'final' || orbGuide.phase === 'arrived') {
          const progress = orbGuide.phase === 'arrived' ? 1 : orbEase((now - orbGuide.start) / 950);
          const startAngle = Math.atan2(from.y - p.screenY, from.x - p.screenX);
          const endAngle = Math.atan2(beside.y - p.screenY, beside.x - p.screenX);
          const turn = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
          const startDistance = Math.hypot(from.x - p.screenX, from.y - p.screenY);
          const distance = startDistance + (clearance - startDistance) * progress;
          const angle = startAngle + turn * progress;
          x = p.screenX + Math.cos(angle) * distance;
          y = p.screenY + Math.sin(angle) * distance;
        }
        context.save();
        const pulse = orbGuide.arrived && !orbMotion.matches ? Math.sin(clamp((now - orbGuide.arrived) / 1000, 0, 1) * Math.PI) : 0;
        context.strokeStyle = '#7dff41'; context.lineWidth = 2;
        context.globalAlpha = .55 + pulse * .4;
        context.beginPath(); context.arc(p.screenX, p.screenY, p.screenRadius + 10 + pulse * 8, 0, Math.PI * 2); context.stroke();
        context.restore();
      }
    } else if (orbGuide.phase === 'return' && !orbMotion.matches) {
      const progress = (now - orbGuide.start) / 1050;
      mix(home, progress);
      if (progress >= 1) {
        orbGuide.phase = null; orbGuide.from = null; orbGuide.position = null;
        orbGuide.start = 0; orbGuide.viewFrom = null; orbGuide.midpoint = null;
      }
    } else {
      x = home.x; y = home.y;
      orbGuide.phase = null;
    }
    if (orbGuide.phase) orbGuide.position = { x, y };
    else { orbGuide.position = null; y += Math.sin(t * .6) * 3; }
    drawOrbWaveform(x, y, radius, t, low);
  }

  // Visual signal boundary: a future audio analyser can feed the existing
  // setOrbAmplitude(0..1) API. Geometry consumes only this bounded envelope.
  function orbVisualSignal(t) {
    if (orb.visualState !== orb.state) {
      orb.visualState = orb.state;
      orb.visualSince = t;
    }
    const age = Math.max(0, t - orb.visualSince);
    const speech = orb.state === 'speaking' ? orb.amplitude * (orbVoice.speaking ? .6 + .4 * Math.pow(Math.sin(t * 8.3) * Math.cos(t * 3.7), 2) : 1) : 0;
    const pulse = orb.state === 'arrived' ? Math.exp(-age * 3) * Math.sin(Math.min(1, age * 2) * Math.PI) : 0;
    const fault = orb.state === 'error' ? Math.exp(-age * 4) : 0;
    return {
      speech, pulse, fault, age,
      energy: (orbGuide.phase === 'lock' ? .35 * Math.sin(clamp((performance.now() - orbGuide.start) / 500, 0, 1) * Math.PI) : 0) + ({ idle: .16, listening: .36, thinking: .65, guiding: .42, arrived: .4, error: .2, speaking: .3 }[orb.state]) + speech * .65 + pulse * .4,
      strength: ({ idle: .032, listening: .052, thinking: .083, guiding: .06, arrived: .035, error: .032, speaking: .04 }[orb.state]) + speech * .23,
      speed: orb.state === 'thinking' ? 2.1 : orb.state === 'speaking' ? 2.05 : orb.state === 'listening' ? 1.05 : .65
    };
  }

  function drawOrbWaveform(x, y, radius, t, low) {
    const signal = orbVisualSignal(t), tau = Math.PI * 2;
    const phase = t * signal.speed;
    const rotation = t * .105, cr = Math.cos(rotation), sr = Math.sin(rotation);
    const direction = orbGuide.from ? Math.atan2(y - orbGuide.from.y, x - orbGuide.from.x) : -.3;
    const dx = Math.cos(direction), dy = Math.sin(direction);
    // Every mesh vertex samples the same continuous travelling field. Cartesian
    // harmonics close the longitude seam and remain continuous at both poles.
    const point = (lat, lon, shell = 1) => {
      const px = Math.sin(lat) * Math.cos(lon), py = Math.cos(lat), pz = Math.sin(lat) * Math.sin(lon);
      const wave = .48 * Math.sin(py * 9 + px * 3 - phase * 2.4)
        + .32 * Math.sin(pz * 8 - py * 4 + phase * 1.7)
        + .20 * Math.sin(px * 12 + pz * 5 - phase * 3.1);
      const voice = Math.sin(py * 17 + pz * 5 - t * 7.5) * Math.sin(px * 6 - pz * 4 + t * 2.3);
      const r = shell * (1 + .012 * Math.sin(t * .8) + signal.strength * wave
        + signal.speech * .075 * voice + signal.pulse * .12
        + signal.fault * .065 * Math.sin(py * 31 + px * 19 - t * 19));
      const rx = px * cr + pz * sr, rz = pz * cr - px * sr;
      const yy = py * .94 - rz * .342, z = py * .342 + rz * .94;
      const stretch = orb.state === 'guiding' ? .11 * (1 - Math.exp(-signal.age * 8)) * (rx * dx + yy * dy) : 0;
      const perspective = 3.8 / (3.8 - z * .35);
      return { x: (rx + dx * stretch) * radius * r * perspective,
        y: (yy + dy * stretch) * radius * r * perspective, z, wave };
    };
    // Batch paths by depth and colour: thousands of fine segments, few strokes.
    const mesh = Array.from({ length: 8 }, () => new Path2D());
    const bands = Array.from({ length: 8 }, () => new Path2D());
    const highlights = Array.from({ length: 8 }, () => new Path2D());
    const segment = (paths, a, b, green) => {
      const depth = Math.max(0, Math.min(3, Math.floor(((a.z + b.z) * .25 + .5) * 4)));
      const path = paths[depth * 2 + Number(green)];
      path.moveTo(a.x, a.y); path.lineTo(b.x, b.y);
      // A compact travelling crest catches selected filaments, not whole rings.
      const crest = Math.sin((a.x * .65 + a.y * .4) / radius * 5 + a.z * 4 - phase * 2.5);
      if (depth >= 2 && crest > (paths === bands ? .72 : .975)) {
        const light = highlights[depth * 2 + Number(green)];
        light.moveTo(a.x, a.y); light.lineTo(b.x, b.y);
      }
    };
    const steps = low ? 72 : 128, rings = low ? 24 : 46, meridians = low ? 32 : 64;
    for (let family = 0; family < 2; family++) {
      const count = family ? meridians : rings;
      for (let line = 0; line < count; line++) {
        let previous;
        for (let step = 0; step <= steps; step++) {
          const lat = family ? step / steps * Math.PI : (line + 1) / (rings + 1) * Math.PI;
          const lon = family ? line / meridians * tau : step / steps * tau;
          const p = point(lat, lon);
          if (previous) segment(mesh, previous, p, !family && Math.sin(lat * 6 + phase * .7) > .1);
          previous = p;
        }
      }
    }
    // Six ribbon bundles wrap the surface; each fine strand follows the mesh's
    // displacement, with extra speech modulation travelling along the ribbon.
    for (let band = 0; band < 6; band++) {
      for (let strand = -2; strand <= 2; strand++) {
        let previous;
        for (let step = 0; step <= steps; step++) {
          const lon = step / steps * tau;
          const lat = .38 + band * .47 + strand * .014 * (1 + .45 * Math.sin(lon * 3 - phase * 1.6 + band))
            + (.09 + signal.speech * .055) * Math.sin(lon * 3 + phase * 1.2 + band * .9)
            + .035 * Math.sin(lon * 7 - phase * 2 + band);
          const p = point(lat, lon, 1.009);
          if (previous) segment(bands, previous, p, band % 3 !== 1);
          previous = p;
        }
      }
    }
    context.save();
    try {
      context.translate(x, y);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.shadowBlur = 0;
      context.setLineDash([]);
      const core = context.createRadialGradient(-radius * .18, -radius * .12, 0, 0, 0, radius * 1.1);
      core.addColorStop(0, 'rgba(0,42,81,.16)');
      core.addColorStop(.72, 'rgba(0,13,27,.3)');
      core.addColorStop(1, 'rgba(0,8,16,0)');
      context.fillStyle = core;
      context.beginPath(); context.arc(0, 0, radius * 1.1, 0, tau); context.fill();
      context.globalCompositeOperation = 'lighter';
      // A faint edge aura leaves the waveform crisp, without a canvas blur pass.
      const aura = context.createRadialGradient(0, 0, radius * .88, 0, 0, radius * 1.48);
      aura.addColorStop(0, 'rgba(15,115,207,0)');
      aura.addColorStop(.35, `rgba(20,142,235,${.025 + signal.speech * .045})`);
      aura.addColorStop(.66, `rgba(90,210,136,${.012 + signal.speech * .018})`);
      aura.addColorStop(1, 'rgba(15,115,207,0)');
      context.fillStyle = aura;
      context.beginPath(); context.arc(0, 0, radius * 1.48, 0, tau); context.fill();
      // Interior light is confined beneath the crisp shell, with no blur pass.
      const energy = context.createRadialGradient(-radius * .22, radius * .08, radius * .03, 0, 0, radius * .94);
      energy.addColorStop(0, `rgba(12,111,255,${.12 + signal.energy * .12})`);
      energy.addColorStop(.45, `rgba(5,65,191,${.07 + signal.energy * .06})`);
      energy.addColorStop(1, 'rgba(0,30,100,0)');
      context.fillStyle = energy;
      context.beginPath(); context.arc(0, 0, radius * .94, 0, tau); context.fill();
      for (let depth = 0; depth < 4; depth++) {
        for (let green = 0; green < 2; green++) {
          const color = green ? '125,255,65' : '24,151,255';
          const alpha = [.035, .085, .28, .62][depth] * (.8 + signal.energy * .45);
          context.strokeStyle = `rgba(${color},${alpha})`;
          context.lineWidth = (low ? .42 : .46) + depth * .045;
          context.stroke(mesh[depth * 2 + green]);
          // A narrow bloom beneath an exact filament, never full-sphere blur.
          context.strokeStyle = `rgba(${color},${alpha * .16})`;
          context.lineWidth = 2.4 + signal.speech;
          context.stroke(bands[depth * 2 + green]);
          context.strokeStyle = `rgba(${signal.fault > .1 ? '255,167,119' : green ? '192,255,156' : '139,225,255'},${(.18 + signal.energy * .38) * (depth / 3)})`;
          context.lineWidth = .75 + signal.speech * .35;
          context.stroke(highlights[depth * 2 + green]);
          context.strokeStyle = `rgba(${green ? '153,255,100' : '67,191,255'},${Math.min(.95, alpha * 1.5)})`;
          context.lineWidth = .7 + signal.speech * .3;
          context.stroke(bands[depth * 2 + green]);
        }
      }
      // Sparse tilted orbital fragments and outward state ripples.
      for (let ring = 0; ring < 3; ring++) {
        const listening = orb.state === 'listening' ? (t * .35 + ring / 3) % 1 : 0;
        const r = radius * (1.17 + ring * .08 + listening * .2 + signal.pulse * .18);
        context.strokeStyle = `rgba(${ring === 1 ? '125,255,65' : '30,154,255'},${(.1 + signal.energy * .09) * (1 - listening)})`;
        context.lineWidth = .55;
        context.beginPath();
        context.ellipse(0, 0, r, r * (.80 + ring * .06), -.4 + ring * .6, t * .12 + ring * 2, t * .12 + ring * 2 + 3.9);
        context.stroke();
      }
      // Fixed-count deterministic motes: no emitters, history buffers or extra RAF.
      const moteCount = low ? 10 : 28;
      for (let i = 0; i < moteCount; i++) {
        const lon = i * 2.39996 + t * (.045 + (i % 3) * .012);
        const p = point(Math.acos(1 - 2 * (i + .5) / moteCount), lon,
          1.2 + .18 * (.5 + .5 * Math.sin(i * 7 + t * .24)));
        const shimmer = .65 + .35 * Math.sin(i * 4.7 + t * 1.1);
        const alpha = (.16 + .32 * Math.max(0, p.z)) * shimmer * (.7 + signal.speech * .8);
        const color = i % 3 ? '67,184,255' : '157,255,117';
        context.fillStyle = `rgba(${color},${alpha})`;
        const size = p.z > .3 ? 1.15 : .65;
        context.beginPath(); context.arc(p.x, p.y, size, 0, tau); context.fill();
        if (!low && p.z > .3 && i % 4 === 0) {
          context.fillStyle = `rgba(${color},${alpha * .09})`;
          context.beginPath(); context.arc(p.x, p.y, size * 3.4, 0, tau); context.fill();
          // Short tangential sparks become visible during speech, never fireworks.
          context.strokeStyle = `rgba(${color},${alpha * signal.speech * .65})`;
          context.lineWidth = .65;
          const length = 2 + signal.speech * 7;
          context.beginPath(); context.moveTo(p.x, p.y);
          context.lineTo(p.x - Math.sin(lon) * length, p.y + Math.cos(lon) * length);
          context.stroke();
        }
      }
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = signal.fault > .1 ? '#ffac88' : '#a3e9df';
      context.font = '11px system-ui, sans-serif'; context.textAlign = 'center';
      context.fillText(`Orb · ${orb.state}`, 0, radius * 1.38 + 14);
    } finally {
      context.restore();
      // Canvas paths are not part of save/restore; discard our final arc too.
      context.beginPath();
    }
  }

  function mountOrb() {
    if (orb.mounted) return;
    orb.mounted = true;
    const card = document.createElement('details');
    card.className = 'orb-card';
    orb.card = card;
    card.open = !matchMedia('(max-width: 800px)').matches;
    card.innerHTML = '<summary><span class="orb-equaliser" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="orb-card-heading"><strong data-orb-state>Ready</strong><small>Orb &middot; Resident guide</small></span><span class="orb-card-chevron" aria-hidden="true">⌃</span></summary><div class="orb-card-content"><form class="orb-request-form"><label class="orb-input-label" for="orbRequestInput">Ask Orb</label><div class="orb-input-row"><input id="orbRequestInput" aria-label="Ask Orb" placeholder="Where would you like to go?" maxlength="500" autocomplete="off"><button type="submit" aria-label="Send request to Orb">Ask <span aria-hidden="true">↗</span></button></div></form></div>';
    const content = card.querySelector('.orb-card-content');
    const controls = document.createElement('details');
    controls.className = 'orb-debug';
    controls.innerHTML = '<summary>Developer tools</summary><label>Visual state <select aria-label="Orb state">' + orbStates.map(state => `<option>${state}</option>`).join('') + '</select></label><label>Simulated amplitude <input aria-label="Orb simulated amplitude" type="range" min="0" max="1" step="0.05" value="0.5"></label>';
    controls.querySelector('select').addEventListener('change', event => setOrbState(event.target.value));
    controls.querySelector('input').addEventListener('input', event => setOrbAmplitude(event.target.value));
    const search = document.createElement('input');
    search.type = 'search'; search.placeholder = 'Node label'; search.setAttribute('aria-label', 'Orb node search');
    const guide = document.createElement('button');
    guide.textContent = 'Guide to first match'; guide.type = 'button';
    const result = document.createElement('output'); result.setAttribute('aria-live', 'polite');
    guide.addEventListener('click', () => {
      const first = orbSearch(search.value)[0];
      result.textContent = first && guideOrbTo(first.id) ? `Guiding: ${first.label}` : 'No safe visible match';
    });
    controls.append(document.createElement('br'), search, guide, result);
    const request = card.querySelector('#orbRequestInput');
    orbReply = document.createElement('output'); orbReply.setAttribute('aria-live', 'polite');
    orbReply.className = 'orb-reply';
    orbReply.textContent = 'Find a memory, an app, or a place in your universe.';
    card.querySelector('form').addEventListener('submit', event => { event.preventDefault(); askOrb(request.value); });
    mountOrbMicrophone(card, request);
    content.append(orbReply, controls);
    const stats = document.createElement('details');
    stats.className = 'universe-stats';
    stats.innerHTML = '<summary><span class="resident-dot" aria-hidden="true"></span> Universe <span aria-hidden="true">＋</span></summary><dl><div><dt>Visible nodes</dt><dd></dd></div><div><dt>Memories</dt><dd></dd></div><div><dt>Connections</dt><dd></dd></div></dl>';
    const values = stats.querySelectorAll('dd');
    const stateLabel = card.querySelector('[data-orb-state]');
    let shownState = '', shownAmplitude = -1, statsAt = -Infinity;
    orb.syncPresentation = () => {
      if (shownState !== orb.state) {
        shownState = orb.state;
        card.dataset.state = orb.state;
        stateLabel.textContent = ({ idle: 'Ready', listening: 'Listening', thinking: 'Thinking', guiding: 'Guiding', arrived: 'Arrived', speaking: 'Speaking', error: 'Try again' })[orb.state];
        controls.querySelector('select').value = orb.state;
        document.dispatchEvent(new CustomEvent('orb-presentation-state', { detail: { state: orb.state, label: stateLabel.textContent } }));
      }
      if (shownAmplitude !== orb.amplitude) {
        shownAmplitude = orb.amplitude;
        card.style.setProperty('--orb-amplitude', .35 + orb.amplitude * .65);
      }
      if (graph && performance.now() - statsAt > 1000) {
        statsAt = performance.now();
        values[0].textContent = graph.nodes.filter(node => !node.hidden).length;
        values[1].textContent = graph.memoryNodes.length;
        values[2].textContent = graph.edges.filter(edge => !edge.source.hidden && !edge.target.hidden).length;
      }
    };
    document.body.append(card, stats);
    const visible = () => document.body.classList.contains('molecular-view-active') && !document.hidden;
    const animate = now => {
      orb.frame = 0;
      if (!visible() || orbMotion.matches) { orb.last = 0; return; }
      if (!orb.last || now - orb.last >= (orbLowDetail() ? 66 : 33)) {
        orb.time += orb.last ? Math.min(.1, (now - orb.last) / 1000) : 0;
        orb.last = now;
        // Drawing only; the existing simulation remains responsible for physics.
        if (!animationFrame && !viewTransitionFrame) drawGraph();
      }
      orb.frame = requestAnimationFrame(animate);
    };
    const sync = () => {
      card.hidden = stats.hidden = !visible();
      cancelAnimationFrame(orb.frame); orb.frame = 0; orb.last = 0;
      drawGraph();
      if (visible() && !orbMotion.matches) orb.frame = requestAnimationFrame(animate);
    };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    orbMotion.addEventListener('change', () => {
      if (orbMotion.matches) {
        const target = orbSafeNode(orbGuide.id);
        cancelOrbGuide();
        if (target) {
          focusPresentationNode(target, { animate: false });
          guideOrbTo(target.id);
        } else if (!orbVoice.speaking) orb.state = 'idle';
      }
      sync();
    });
    document.addEventListener('visibilitychange', sync);
    sync();
  }
  const view = {
    x: 0,
    y: 0,
    scale: 1
  };

  function startupLog(stage, detail = {}) {
    console.log('[MemoryStartup]', stage, { at: Math.round(performance.now()), ...detail });
  }

  function loadWorkspace() {
    try {
      const value = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
      if (!value || !Array.isArray(value.spaces) || !Array.isArray(value.memories)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function loadGraphState() {
    try {
      const value = JSON.parse(localStorage.getItem(GRAPH_STATE_KEY) || 'null');
      if (!value || value.version !== GRAPH_STATE_VERSION || !value.spaces || typeof value.spaces !== 'object') {
        return { version: GRAPH_STATE_VERSION, spaces: {} };
      }
      return value;
    } catch {
      return { version: GRAPH_STATE_VERSION, spaces: {} };
    }
  }

  function savedStateForSpace(spaceId) {
    if (!spaceId) return null;
    const store = loadGraphState();
    const saved = store.spaces?.[spaceId];
    return saved && typeof saved === 'object' ? saved : null;
  }

  function activeGraphData() {
    const workspace = loadWorkspace();
    if (!workspace) return null;

    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    if (!space) return null;

    const allMemories = workspace.memories.filter((memory) => memory.spaceId === space.id);
    const memories = allMemories.filter((memory) =>
      String(memory.status || 'confirmed') === 'confirmed'
    );

    return { space, memories, allMemories };
  }

  function ensureCanvas() {
    if (!surface) return false;
    if (canvas && context) return true;

    surface.classList.remove('empty-state');
    surface.innerHTML = '';

    canvas = document.createElement('canvas');
    canvas.className = 'memory-graph-canvas';
    canvas.setAttribute('aria-label', 'Memory graph showing the active Space and confirmed memories');
    surface.appendChild(canvas);
    context = canvas.getContext('2d');
    bindInteractions();
    return Boolean(context);
  }

  function resizeCanvas() {
    if (!surface || !canvas || !context) return;
    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildGraph(width, height);
  }

  function rebuildGraph(width, height) {
    const existingRoot = graph?.spaceNode;
    const liveRoot = existingRoot && Number.isFinite(existingRoot.x) && Number.isFinite(existingRoot.y)
      ? { id: String(existingRoot.id), x: existingRoot.x, y: existingRoot.y, vx: existingRoot.vx, vy: existingRoot.vy }
      : null;
    stopViewTransition();
    stopSimulation();
    context.clearRect(0, 0, width, height);

    const data = activeGraphData();
    startupLog('memory-graph.rebuildGraph:start', {
      width,
      height,
      existingRoot: liveRoot,
      data: data ? {
        spaceId: String(data.space.id),
        confirmedMemories: data.memories.length,
        allMemories: data.allMemories.length
      } : null
    });
    const count = document.getElementById('memoryGraphCount');
    if (!data) {
      graph = null;
      focusedNodeId = null;
      if (count) count.textContent = '0';
      drawMessage(width, height, 'Memory Space is unavailable');
      return;
    }

    const previousSpaceId = graph?.spaceNode?.id || null;
    const savedState = savedStateForSpace(data.space.id);
    if (previousSpaceId && previousSpaceId !== data.space.id) resetView();

    graph = buildGraph(data, width, height, savedState, liveRoot);
    if (liveRoot && liveRoot.id === String(graph.spaceNode.id)) {
      graph.spaceNode.x = liveRoot.x;
      graph.spaceNode.y = liveRoot.y;
      graph.spaceNode.vx = liveRoot.vx;
      graph.spaceNode.vy = liveRoot.vy;
      graph.centreX = liveRoot.x;
      graph.centreY = liveRoot.y;
    }
    syncCanonicalGraphCollections();
    startupLog('memory-graph.rebuildGraph:built', {
      spaceId: String(graph.spaceNode.id),
      nodes: graph.nodes.length,
      memoryNodes: graph.memoryNodes.length,
      root: { x: graph.spaceNode.x, y: graph.spaceNode.y, vx: graph.spaceNode.vx, vy: graph.spaceNode.vy }
    });
    for (const node of graph.nodes) {
      if (!node.fixed) containNode(node);
    }
    const restored = restoreSavedView(savedState?.view, width, height);
    if (homePresentation || (!previousSpaceId && (!restored || Math.abs(view.scale - 1) < .01))) frameUniverse();
    if (count) count.textContent = String(graph.memoryNodes.length + 1);
    simulationFrames = 0;

    const searchInput = document.getElementById('searchInput');
    const activeQuery = searchInput?.value?.trim() || '';
    if (activeQuery) {
      focusSearchTerm(activeQuery, false);
    } else if (!orbSafeNode(focusedNodeId)) {
      focusedNodeId = null;
    }
    drawGraph();

    if (graph.nodes.length > 1) startSimulation();
  }

  function memoryRootStartState(width, height, savedState = null, liveRoot = null) {
    if (liveRoot && Number.isFinite(liveRoot.x) && Number.isFinite(liveRoot.y)) {
      return {
        x: liveRoot.x,
        y: liveRoot.y,
        vx: Number.isFinite(liveRoot.vx) ? liveRoot.vx : 0,
        vy: Number.isFinite(liveRoot.vy) ? liveRoot.vy : 0
      };
    }

    const savedX = Number(savedState?.memoryRoot?.xRatio);
    const savedY = Number(savedState?.memoryRoot?.yRatio);
    if (Number.isFinite(savedX) && Number.isFinite(savedY)) {
      return { x: savedX * width, y: savedY * height, vx: 0, vy: 0 };
    }

    return { x: width * 0.5, y: height * 0.22, vx: 0, vy: 0 };
  }

  function buildGraph(data, width, height, savedState = null, liveRoot = null) {
    const universeCentreX = width / 2;
    const universeCentreY = height / 2;
    const rootStart = memoryRootStartState(width, height, savedState, liveRoot);
    const centreX = rootStart.x;
    const centreY = rootStart.y;
    const baseOrbit = Math.max(88, Math.min(width, height) * 0.27);
    const spaceNode = {
      id: data.space.id,
      kind: 'space',
      appRoot: true,
      clusterRoot: true,
      label: data.space.name || 'Memory Space',
      x: centreX,
      y: centreY,
      vx: rootStart.vx,
      vy: rootStart.vy,
      radius: 40,
      fixed: true
    };

    const memories = data.memories;
    const memoryNodes = memories.map((memory, index) => {
      const angle = -Math.PI / 2 + (index / Math.max(1, memories.length)) * Math.PI * 2;
      const profile = memoryProfile(memory, data.allMemories);
      const localOrbit = directAppChildOrbit(index);
      const savedNode = savedState?.nodes?.[memory.id];
      const savedOffsetX = Number(savedNode?.offsetX);
      const savedOffsetY = Number(savedNode?.offsetY);
      const hasSavedPosition = Number.isFinite(savedOffsetX) && Number.isFinite(savedOffsetY);
      return {
        id: memory.id,
        kind: 'memory',
        label: memory.title || 'Untitled memory',
        x: hasSavedPosition ? centreX + savedOffsetX * width : centreX + Math.cos(angle) * localOrbit,
        y: hasSavedPosition ? centreY + savedOffsetY * height : centreY + Math.sin(angle) * localOrbit,
        vx: 0,
        vy: 0,
        radius: profile.radius,
        targetOrbit: localOrbit,
        localOrbit,
        gravityWeight: profile.gravityWeight,
        parentId: spaceNode.id,
        relationshipCount: profile.relationshipCount,
        recencyLevel: profile.recencyLevel,
        importance: profile.importance,
        supersedesId: memory.supersedesId || null,
        supersededById: memory.supersededById || null,
        locked: Boolean(memory.locked),
        fixed: false,
        dragging: false
      };
    });

    const appOrbit = baseOrbit * 1.08;
    const appDefinitions = globalThis.UniversalAppAdapters?.getAppDefinitions?.() || [];
    const appNodes = [];
    const appEdges = [];
    appDefinitions.forEach((appDefinition, appIndex, definitions) => {
      const appAngle = Math.PI * 0.78 + (appIndex / Math.max(1, definitions.length)) * Math.PI * 2;
      const appRoot = {
        id: appDefinition.id,
        appId: appDefinition.id,
        nodeId: null,
        kind: 'control',
        appRoot: true,
        clusterRoot: true,
        label: appDefinition.name,
        x: universeCentreX + Math.cos(appAngle) * appOrbit,
        y: universeCentreY + Math.sin(appAngle) * appOrbit,
        vx: 0,
        vy: 0,
        radius: 34,
        targetOrbit: appOrbit,
        gravityWeight: 1.18,
        parentId: null,
        action: '',
        view: null,
        expandable: false,
        controlDepth: 0,
        recencyLevel: 1,
        fixed: false,
        dragging: false,
        hidden: false
      };
      const stateUpdates = new Map(
        (globalThis.UniversalAppAdapters?.getAppNodeUpdates?.(appDefinition.id) || [])
          .map((update) => [String(update.id), update])
      );
      appNodes.push(appRoot);

      const appendChildren = (children, parent, depth, parentAngle) => {
        children.forEach((definition, index, siblings) => {
          const angle = parentAngle + (index / Math.max(1, siblings.length)) * Math.PI * 2;
          const spawnOrbit = depth === 1 ? directAppChildOrbit(index) : 54 + index * 7;
          const current = stateUpdates.get(String(definition.id));
          const node = {
            id: definition.id,
            appId: appDefinition.id,
            nodeId: definition.nodeId,
            kind: 'control',
            label: current?.label || definition.label,
            state: current?.state || definition.state || null,
            x: parent.x + Math.cos(angle) * spawnOrbit,
            y: parent.y + Math.sin(angle) * spawnOrbit,
            vx: 0,
            vy: 0,
            radius: appControlRadius(depth),
            targetOrbit: appOrbit,
            localOrbit: spawnOrbit,
            gravityWeight: 0.92,
            parentId: parent.id,
            action: String(definition.action || ''),
            view: definition.view || null,
            expandable: Boolean(definition.expandable),
            controlDepth: depth,
            recencyLevel: 0.72,
            fixed: false,
            dragging: false,
            hidden: parent.appRoot ? false : (parent.hidden || !expandedAppNodeIds.has(parent.id))
          };
          appNodes.push(node);
          appEdges.push({ source: parent, target: node, kind: 'space' });
          appendChildren(definition.children || [], node, depth + 1, angle);
        });
      };
      appendChildren(appDefinition.nodes || [], appRoot, 1, appAngle);
    });
    const edges = [...buildRealEdges(spaceNode, memoryNodes), ...appEdges];
    buildPresentationControlNodes(width, height, universeCentreX, universeCentreY, baseOrbit);

    return {
      width,
      height,
      centreX,
      centreY,
      orbitRadius: baseOrbit,
      memoryGroupOrbit: directAppChildOrbit(3),
      spaceNode,
      memoryNodes,
      appNodes,
      appEdges,
      nodes: [spaceNode, ...memoryNodes, ...appNodes],
      edges
    };
  }

  function directAppChildOrbit(index) {
    const childIndex = Math.max(0, Number(index) || 0);
    return Math.min(DIRECT_APP_CHILD_MAX_ORBIT, DIRECT_APP_CHILD_ORBIT + childIndex * DIRECT_APP_CHILD_ORBIT_STEP);
  }

  function appControlRadius(depth) {
    return Math.max(9, 15 * Math.pow(0.82, Math.max(0, Number(depth || 1) - 1)));
  }

  function buildPresentationControlNodes(width, height, centreX, centreY, baseOrbit) {
    const liveIds = new Set(presentationControlSpecs.keys());
    for (const id of [...presentationControlNodes.keys()]) {
      if (!liveIds.has(id)) presentationControlNodes.delete(id);
    }

    const targetOrbit = Math.max(62, baseOrbit);
    const nodes = [];
    for (const [id, spec] of presentationControlSpecs) {
      if (spec.parentId) continue;
      let node = presentationControlNodes.get(id);
      if (!node) {
        const angle = Number(spec.sectorAngle || 0);
        node = {
          id,
          kind: 'control',
          label: String(spec.label || 'Control'),
          x: centreX + Math.cos(angle) * targetOrbit,
          y: centreY + Math.sin(angle) * targetOrbit * 0.76,
          vx: 0,
          vy: 0,
          radius: 18,
          targetOrbit,
          localOrbit: 0,
          parentId: null,
          clusterRoot: true,
          action: String(spec.action || ''),
          expandable: Boolean(spec.expandable),
          controlDepth: 0,
          recencyLevel: 0.82,
          gravityWeight: 1,
          fixed: false,
          dragging: false
        };
        presentationControlNodes.set(id, node);
      }
      node.label = String(spec.label || node.label || 'Control');
      node.radius = Math.max(12, Number(spec.radius) || 18);
      node.targetOrbit = targetOrbit;
      node.localOrbit = 0;
      node.parentId = null;
      node.clusterRoot = true;
      node.action = String(spec.action || '');
      node.expandable = Boolean(spec.expandable);
      node.controlDepth = 0;
      node.hidden = false;
      nodes.push(node);
    }

    for (const [id, spec] of presentationControlSpecs) {
      if (!spec.parentId) continue;
      const parent = presentationControlNodes.get(spec.parentId);
      if (!parent) continue;
      const siblings = [...presentationControlSpecs.values()].filter((item) => item.parentId === spec.parentId);
      const siblingIndex = Math.max(0, siblings.findIndex((item) => item.id === id));
      const depth = presentationControlDepth(spec);
      const spawnOrbit = Math.max(48, Number(parent.radius || 15) + Math.max(11, Number(spec.radius) || 15) + 22);
      let node = presentationControlNodes.get(id);
      if (!node) {
        const angle = childControlAngle(parent, siblingIndex, siblings.length, centreX, centreY);
        node = {
          id,
          kind: 'control',
          label: String(spec.label || 'Control'),
          x: parent.x + Math.cos(angle) * spawnOrbit,
          y: parent.y + Math.sin(angle) * spawnOrbit,
          vx: 0,
          vy: 0,
          radius: 15,
          targetOrbit,
          localOrbit: spawnOrbit,
          parentId: spec.parentId,
          clusterRoot: false,
          action: String(spec.action || ''),
          expandable: Boolean(spec.expandable),
          controlDepth: depth,
          recencyLevel: 0.72,
          gravityWeight: 1,
          fixed: false,
          dragging: false
        };
        presentationControlNodes.set(id, node);
      }
      node.label = String(spec.label || node.label || 'Control');
      node.radius = Math.max(11, Number(spec.radius) || 15);
      node.targetOrbit = targetOrbit;
      node.localOrbit = spawnOrbit;
      node.parentId = spec.parentId;
      node.clusterRoot = false;
      node.action = String(spec.action || '');
      node.expandable = Boolean(spec.expandable);
      node.controlDepth = depth;
      node.hidden = !presentationControlVisible(node);
      nodes.push(node);
    }
    return nodes;
  }

  function childControlAngle(parent, index, count, centreX = graph?.centreX || 0, centreY = graph?.centreY || 0) {
    const outward = Math.atan2(parent.y - centreY, parent.x - centreX);
    const arc = Math.min(Math.PI * 0.92, Math.max(Math.PI * 0.54, count * 0.34));
    return outward - arc / 2 + ((index + 0.5) / Math.max(1, count)) * arc;
  }

  function presentationControlDepth(spec) {
    let depth = 0;
    let current = spec;
    const visited = new Set();
    while (current?.parentId && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      depth += 1;
      current = presentationControlSpecs.get(String(current.parentId));
    }
    return depth;
  }

  function presentationControlVisible(node) {
    if (!node?.parentId) return true;
    if (String(node.parentId) === 'settings') return Boolean(activeControlParentId);
    return String(node.parentId) === String(activeControlParentId || '');
  }

  function visibleControlNodes() {
    return (graph?.nodes || []).filter((node) => node.kind === 'control' && !node.hidden);
  }

  function presentationControlEdges() {
    if (!graph) return [];
    const childEdges = [...presentationControlNodes.values()]
      .filter((node) => node.parentId)
      .flatMap((node) => {
        const parent = presentationControlNodes.get(String(node.parentId));
        return parent?.kind === 'control'
          ? [{ source: parent, target: node, kind: 'space' }]
          : [];
      });
    return childEdges;
  }

  function syncCanonicalGraphCollections() {
    if (!graph) return false;
    const controls = [...presentationControlNodes.values()];
    graph.nodes = [graph.spaceNode, ...graph.memoryNodes, ...(graph.appNodes || []), ...controls];
    graph.edges = [...buildRealEdges(graph.spaceNode, graph.memoryNodes), ...(graph.appEdges || []), ...presentationControlEdges()];
    return true;
  }


  function memoryProfile(memory, allMemories) {
    const importance = String(memory.importance || 'normal').toLowerCase();
    const importanceWeight = IMPORTANCE_WEIGHT[importance] || IMPORTANCE_WEIGHT.normal;
    const baseRadius = IMPORTANCE_RADIUS[importance] || IMPORTANCE_RADIUS.normal;
    const relationshipCount = countRealRelationships(memory, allMemories);
    const relationshipWeight = 1 + Math.min(4, Math.max(0, relationshipCount - 1)) * 0.07;
    const recencyLevel = recencyScore(memory.updatedAt || memory.createdAt);
    const recencyWeight = 0.93 + recencyLevel * 0.17;
    const radius = baseRadius + Math.min(3, Math.max(0, relationshipCount - 1));

    return {
      importance,
      radius,
      relationshipCount,
      recencyLevel,
      gravityWeight: importanceWeight * relationshipWeight * recencyWeight
    };
  }

  function countRealRelationships(memory, allMemories) {
    const relatedIds = new Set();
    if (memory.supersedesId) relatedIds.add(String(memory.supersedesId));
    if (memory.supersededById) relatedIds.add(String(memory.supersededById));

    for (const other of allMemories) {
      if (!other || other.id === memory.id) continue;
      if (other.supersedesId === memory.id || other.supersededById === memory.id) {
        relatedIds.add(String(other.id));
      }
    }

    // Every rendered memory has one real Space -> Memory relationship.
    return 1 + relatedIds.size;
  }

  function recencyScore(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 0.25;

    const ageDays = Math.max(0, (Date.now() - timestamp) / 86400000);
    if (ageDays <= 7) return 1;
    if (ageDays <= 30) return 0.76;
    if (ageDays <= 90) return 0.48;
    if (ageDays <= 365) return 0.24;
    return 0.08;
  }

  function buildRealEdges(spaceNode, memoryNodes) {
    const edges = memoryNodes.map((node) => ({
      source: spaceNode,
      target: node,
      kind: 'space'
    }));

    const byId = new Map(memoryNodes.map((node) => [node.id, node]));
    const seenRevisionPairs = new Set();

    for (const node of memoryNodes) {
      for (const relatedId of [node.supersedesId, node.supersededById]) {
        if (!relatedId) continue;
        const related = byId.get(String(relatedId));
        if (!related || related.id === node.id) continue;

        const key = [String(node.id), String(related.id)].sort().join('::');
        if (seenRevisionPairs.has(key)) continue;
        seenRevisionPairs.add(key);
        edges.push({
          source: node,
          target: related,
          kind: 'revision'
        });
      }
    }

    return edges;
  }

  function startSimulation() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(tick);
  }

  function releaseExpansionAnchors(rootId = null) {
    const ids = rootId == null ? [...expansionAnchoredRootIds] : [String(rootId)];
    for (const id of ids) {
      const root = graph?.nodes?.find((node) => String(node.id) === id);
      if (root) {
        root.vx = 0;
        root.vy = 0;
      }
      expansionAnchoredRootIds.delete(id);
    }
  }

  function stopSimulation() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    releaseExpansionAnchors();
  }

  function tick() {
    animationFrame = 0;
    if (!graph) return;

    const speed = simulateStep();
    drawGraph();
    simulationFrames += 1;

    if (simulationFrames < MAX_SIMULATION_FRAMES && speed > SETTLED_SPEED) {
      animationFrame = requestAnimationFrame(tick);
    } else {
      releaseExpansionAnchors();
      if (homePresentation && !orbGuide.phase && document.body.classList.contains('molecular-view-active')) {
        frameUniverse({ animate: true });
      }
      persistGraphState(false);
    }
  }

  function simulateStep() {
    const nodes = graph.nodes.filter((node) => (!node.fixed || node.appRoot) && !node.hidden);
    let totalSpeed = 0;
    let simulatedCount = 0;
    let boundaryActive = false;

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (node.dragging) continue;
      const expansionAnchored = expansionAnchoredRootIds.has(String(node.id));

      let fx = 0;
      let fy = 0;
      let boundaryX = 0;
      let boundaryY = 0;

      const localParent = node.parentId
        ? graph.nodes.find((candidate) => !candidate.hidden
          && String(candidate.id) === String(node.parentId))
        : null;
      if (localParent && !localParent.hidden) {
        const dx = node.x - localParent.x;
        const dy = node.y - localParent.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const radialOffset = distance - (node.localOrbit || node.targetOrbit || graph.orbitRadius);
        const radialForce = -radialOffset * 0.0019 * Math.max(0.8, node.gravityWeight || 1);
        fx += (dx / distance) * radialForce;
        fy += (dy / distance) * radialForce;
      }

      if (node.clusterRoot && !expansionAnchored) {
        const boundaryForce = universeBoundaryForce(node);
        boundaryActive ||= Boolean(boundaryForce.x || boundaryForce.y);
        boundaryX = boundaryForce.x;
        boundaryY = boundaryForce.y;
      }

      for (let j = i + 1; j < nodes.length; j += 1) {
        const other = nodes[j];
        const pairX = node.x - other.x;
        const pairY = node.y - other.y;
        const pairDistanceSq = Math.max(100, pairX * pairX + pairY * pairY);
        const pairDistance = Math.sqrt(pairDistanceSq);
        const repulsion = Math.min(0.9, 900 / pairDistanceSq);
        const pushX = (pairX / pairDistance) * repulsion;
        const pushY = (pairY / pairDistance) * repulsion;
        fx += pushX / Math.max(0.85, node.gravityWeight || 1);
        fy += pushY / Math.max(0.85, node.gravityWeight || 1);
        if (!other.dragging && !expansionAnchoredRootIds.has(String(other.id))) {
          const otherInertia = other.clusterRoot ? CLUSTER_ROOT_INERTIA : 1;
          other.vx -= pushX / (Math.max(0.85, other.gravityWeight || 1) * otherInertia);
          other.vy -= pushY / (Math.max(0.85, other.gravityWeight || 1) * otherInertia);
        }
      }

      if (expansionAnchored) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      const inertia = node.clusterRoot ? CLUSTER_ROOT_INERTIA : 1;
      node.vx = (node.vx + fx / inertia + boundaryX) * 0.90;
      node.vy = (node.vy + fy / inertia + boundaryY) * 0.90;
      node.x += node.vx;
      node.y += node.vy;
      containNode(node);
      if (node === graph.spaceNode) {
        graph.centreX = node.x;
        graph.centreY = node.y;
      }
      totalSpeed += Math.hypot(node.vx, node.vy);
      simulatedCount += 1;
    }

    for (const root of graph.nodes) {
      if (!root.fixed || root.appRoot || !root.clusterRoot || root.hidden || root.dragging) continue;
      const boundaryForce = universeBoundaryForce(root);
      if (!boundaryForce.x && !boundaryForce.y && !root.vx && !root.vy) continue;
      boundaryActive ||= Boolean(boundaryForce.x || boundaryForce.y);

      root.vx = (root.vx + boundaryForce.x) * 0.90;
      root.vy = (root.vy + boundaryForce.y) * 0.90;
      root.x += root.vx;
      root.y += root.vy;
      if (root === graph.spaceNode) {
        graph.centreX = root.x;
        graph.centreY = root.y;
      }
      totalSpeed += Math.hypot(root.vx, root.vy);
      simulatedCount += 1;
    }

    const averageSpeed = simulatedCount ? totalSpeed / simulatedCount : 0;
    return boundaryActive ? Math.max(averageSpeed, SETTLED_SPEED + 0.001) : averageSpeed;
  }

  function universeBoundaryForce(node) {
    const zoomExtent = Math.max(1, 1 / MIN_SCALE);
    const extraX = Math.max(0, graph.width * (zoomExtent - 1) / 2);
    const extraY = Math.max(0, graph.height * (zoomExtent - 1) / 2);
    const margin = node.radius + 34;
    const softZone = Math.max(48, node.radius * 1.5);
    const minX = margin - extraX + softZone;
    const maxX = graph.width - margin + extraX - softZone;
    const minY = margin - extraY + softZone;
    const maxY = graph.height - margin + extraY - softZone;

    return {
      x: node.x < minX
        ? (minX - node.x) * UNIVERSE_BOUNDARY_FORCE
        : node.x > maxX ? (maxX - node.x) * UNIVERSE_BOUNDARY_FORCE : 0,
      y: node.y < minY
        ? (minY - node.y) * UNIVERSE_BOUNDARY_FORCE
        : node.y > maxY ? (maxY - node.y) * UNIVERSE_BOUNDARY_FORCE : 0
    };
  }

  function containNode(node) {
    if (node.clusterRoot) return;
    const margin = node.radius + 34;
    const zoomExtent = Math.max(1, 1 / MIN_SCALE);
    const extraX = Math.max(0, graph.width * (zoomExtent - 1) / 2);
    const extraY = Math.max(0, graph.height * (zoomExtent - 1) / 2);
    const minX = margin - extraX;
    const maxX = graph.width - margin + extraX;
    const minY = margin - extraY;
    const maxY = graph.height - margin + extraY;

    if (node.x < minX) {
      node.x = minX;
      node.vx *= -0.35;
    } else if (node.x > maxX) {
      node.x = maxX;
      node.vx *= -0.35;
    }

    if (node.y < minY) {
      node.y = minY;
      node.vy *= -0.35;
    } else if (node.y > maxY) {
      node.y = maxY;
      node.vy *= -0.35;
    }
  }

  function rotationApi() {
    return globalThis.MemoryGraphRotation || null;
  }

  function rotationActive() {
    return rotationApi()?.isActive?.() === true;
  }

  function projectedNode(node) {
    if (graph?.width > 800 && document.body.classList.contains('molecular-view-active')) {
      const primary = node.kind === 'space' || node.appRoot ||
        (node.kind === 'control' && !node.parentId);
      node = { ...node, radius: node.radius * (primary ? 1.22 : 1.10) };
    }
    if (activeControlParentId && rotationActive() && node.kind === 'control') {
      return {
        x: node.x,
        y: node.y,
        radius: node.radius,
        depth: 0,
        alpha: 1,
        scale: 1
      };
    }
    const projected = rotationApi()?.project?.(node, graph);
    if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) return projected;
    return {
      x: node.x,
      y: node.y,
      radius: node.radius,
      depth: 0,
      alpha: 1,
      scale: 1
    };
  }

  function orderedDrawableNodes() {
    const nodes = graph.nodes.filter((node) => !node.fixed && !node.hidden);
    if (!rotationActive()) return nodes;
    return nodes.sort((a, b) => projectedNode(a).depth - projectedNode(b).depth);
  }

  function syncRotationState() {
    if (!surface) return;
    surface.dataset.rotationActive = rotationActive() ? 'true' : 'false';
  }

  function drawGraph() {
    if (!graph || !context) return;
    updateOrbCinematic(performance.now());
    context.clearRect(0, 0, graph.width, graph.height);
    syncRotationState();

    context.save();
    context.translate(view.x, view.y);
    context.scale(view.scale, view.scale);
    drawClusterAtmosphere();
    for (const edge of graph.edges || []) {
      if (!edge.source.hidden && !edge.target.hidden) drawEdge(edge);
    }

    if (rotationActive()) {
      for (const node of orderedDrawableNodes()) drawNodeAboveConnectors(node);
      drawNodeAboveConnectors(graph.spaceNode);
    } else {
      drawNodeAboveConnectors(graph.spaceNode);
      for (const node of graph.nodes) {
        if (!node.fixed && !node.hidden) drawNodeAboveConnectors(node);
      }
    }

    context.restore();
    drawOrb();
    surface?.dispatchEvent(new CustomEvent('memory-graph-drawn'));
  }

  function drawClusterAtmosphere() {
    if (!document.body.classList.contains('molecular-view-active')) return;
    const low = orbLowDetail();
    const detail = low ? 'low' : 'full';
    if (surface && surface.dataset.atmosphereDetail !== detail) surface.dataset.atmosphereDetail = detail;
    context.save();
    context.globalCompositeOperation = 'source-over';
    context.shadowBlur = 0;
    let count = 0;
    // Only primary anchors get support light; descendants keep their existing glow.
    for (const node of graph.nodes) {
      if (node.hidden || !(node.kind === 'space' || node.appRoot ||
        (node.kind === 'control' && !node.parentId))) continue;
      if (count >= (low ? 3 : 8)) break;
      const p = projectedNode(node);
      const radius = Math.min(135, Math.max(52, p.radius * 3.5));
      const screenX = view.x + p.x * view.scale, screenY = view.y + p.y * view.scale;
      if (screenX < -radius * view.scale || screenX > graph.width + radius * view.scale ||
          screenY < -radius * view.scale || screenY > graph.height + radius * view.scale) continue;
      count++;
      context.globalAlpha = (p.alpha || 1) * (low ? .65 : 1);
      const haze = context.createRadialGradient(p.x, p.y, p.radius, p.x, p.y, radius);
      haze.addColorStop(0, 'rgba(40,139,223,.10)');
      haze.addColorStop(.4, 'rgba(25,96,153,.045)');
      haze.addColorStop(1, 'rgba(20,68,105,0)');
      context.fillStyle = haze;
      context.beginPath(); context.arc(p.x, p.y, radius, 0, Math.PI * 2); context.fill();
    }
    context.restore();
    context.beginPath();
  }

  function drawEdge(edge) {
    const revision = edge.kind === 'revision';
    const source = projectedNode(edge.source);
    const target = projectedNode(edge.target);
    const activityTarget = edge.target?.appId && edge.target?.nodeId
      ? { appId: String(edge.target.appId), nodeId: String(edge.target.nodeId) }
      : null;

    context.save();
    context.__memoryFlowActivityTarget = activityTarget;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.lineWidth = revision ? 1.35 : 1.05;
    context.strokeStyle = revision
      ? 'rgba(199, 255, 86, 0.34)'
      : 'rgba(120, 184, 255, 0.23)';
    if (revision) context.setLineDash([5, 4]);
    context.stroke();
    context.__memoryFlowActivityTarget = null;
    context.restore();
  }

  function drawNodeAboveConnectors(node) {
    const projected = projectedNode(node);
    context.save();
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.shadowBlur = 0;
    context.beginPath();
    context.arc(projected.x, projected.y, projected.radius + 1.5, 0, Math.PI * 2);
    context.fillStyle = '#050d12';
    context.fill();
    context.restore();
    drawNode(node);
  }

  function drawNode(node) {
    const isSpace = node.kind === 'space' || node.appRoot === true;
    const recency = isSpace ? 1 : Number(node.recencyLevel || 0);
    const fillAlpha = isSpace ? 0.24 : 0.10 + recency * 0.16;
    const strokeAlpha = isSpace ? 0.95 : 0.56 + recency * 0.30;
    const glowAlpha = isSpace ? 0.55 : 0.18 + recency * 0.30;
    const glowBlur = isSpace ? 24 : 7 + recency * 13;
    const focused = node.id === focusedNodeId;
    const projected = projectedNode(node);
    const nodeX = projected.x;
    const nodeY = projected.y;
    const nodeRadius = projected.radius;
    const depthAlpha = isSpace ? 1 : Number(projected.alpha || 1);
    const activityAnchor = node.kind === 'space'
      ? 'memory-root'
      : node.appRoot && node.appId === 'office'
        ? 'office-root'
        : node.appRoot && node.appId === 'code-space'
          ? 'code-space-root'
      : node.appId === 'office' && node.nodeId === 'memory-jobs'
        ? 'office-memory-jobs'
        : null;
    if (activityAnchor) {
      globalThis.MemoryGraphNeuralFlow?.captureAnchor?.(activityAnchor, context, {
        x: nodeX,
        y: nodeY,
        radius: nodeRadius
      });
    }

    context.save();
    context.globalAlpha = depthAlpha;
    context.beginPath();
    context.arc(nodeX, nodeY, nodeRadius, 0, Math.PI * 2);
    context.fillStyle = isSpace ? 'rgba(120, 184, 255, 0.24)' : `rgba(199, 255, 86, ${fillAlpha.toFixed(3)})`;
    context.fill();

    context.lineWidth = node.locked ? 3 : isSpace ? 2.5 : 1.5;
    context.strokeStyle = isSpace
      ? 'rgba(120, 184, 255, 0.95)'
      : `rgba(199, 255, 86, ${strokeAlpha.toFixed(3)})`;
    context.stroke();

    context.shadowBlur = glowBlur;
    context.shadowColor = isSpace
      ? 'rgba(120, 184, 255, 0.55)'
      : `rgba(199, 255, 86, ${glowAlpha.toFixed(3)})`;
    context.stroke();
    context.restore();

    if (focused) {
      context.save();
      context.beginPath();
      context.arc(nodeX, nodeY, nodeRadius + 8, 0, Math.PI * 2);
      context.lineWidth = 2.5;
      context.strokeStyle = 'rgba(120, 184, 255, 0.98)';
      context.shadowBlur = 18;
      context.shadowColor = 'rgba(120, 184, 255, 0.72)';
      context.stroke();
      context.restore();
    }

    context.save();
    context.globalAlpha = depthAlpha;
    context.fillStyle = isSpace ? 'rgba(242, 244, 247, 0.94)' : `rgba(242, 244, 247, ${(0.70 + recency * 0.24).toFixed(3)})`;
    context.font = isSpace ? '700 14px Inter, system-ui, sans-serif' : '600 11px Inter, system-ui, sans-serif';
    context.shadowColor = 'rgba(2, 7, 14, .95)';
    context.shadowBlur = 4;
    context.textAlign = 'center';
    context.textBaseline = 'top';
    context.__memoryGraphLabelNode = node;
    context.fillText(shortLabel(node.label, isSpace ? 26 : 22), nodeX, nodeY + nodeRadius + 8);
    context.__memoryGraphLabelNode = null;
    context.restore();
  }

  function drawMessage(width, height, message) {
    context.save();
    context.fillStyle = 'rgba(145, 154, 170, 0.9)';
    context.font = '600 13px Inter, system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, width / 2, height / 2);
    context.restore();
  }

  function shortLabel(value, limit) {
    const text = String(value || '').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(1, limit - 1)).trim()}…`;
  }

  function bindInteractions() {
    if (!canvas || interactionsBound) return;
    interactionsBound = true;

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);
    canvas.addEventListener('dblclick', handleGraphDoubleClick);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleGraphKeyDown);
    document.getElementById('closeDetailButton')?.addEventListener('click', () => {
      inspectorBridgeActive = true;
      requestAnimationFrame(() => { inspectorBridgeActive = false; });
    }, true);
  }

  function bindSearch() {
    if (searchBound) return;
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;

    searchBound = true;
    searchInput.addEventListener('input', () => {
      focusSearchTerm(searchInput.value);
    });
  }

  function handleGraphKeyDown(event) {
    if (event.key !== 'Escape' || !rotationActive()) return;
    rotationApi()?.reset?.();
    syncRotationState();
    drawGraph();
  }

  function handlePointerDown(event) {
    if (!graph || event.button !== 0) return;
    homePresentation = false;
    stopViewTransition();

    const point = pointerPoint(event);
    const rotation = rotationApi();
    const rotateRequested = rotation?.shouldStart?.(event) === true;
    let world = null;
    let node = null;
    if (activeControlParentId && rotateRequested) {
      world = screenToWorld(point);
      node = findNodeAt(world.x, world.y);
    }
    const rotateMode = rotateRequested && (!activeControlParentId || node?.kind === 'space');

    if (rotateMode) {
      rotation.begin?.();
      stopSimulation();
      pointerState = {
        pointerId: event.pointerId,
        mode: 'rotate',
        node: null,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false
      };
    } else {
      world ||= screenToWorld(point);
      node ||= findNodeAt(world.x, world.y);
      const rotated = rotationActive();

      pointerState = {
        pointerId: event.pointerId,
        mode: node?.clusterRoot
          ? 'cluster'
          : node?.kind === 'space'
          ? 'home'
          : node?.kind === 'memory'
            ? (rotated ? 'inspect' : 'node')
            : node?.kind === 'control'
              ? (rotated ? 'control-inspect' : 'control')
              : 'pan',
        node: node?.clusterRoot || node?.kind === 'memory' || node?.kind === 'control' ? node : null,
        clusterNodes: node?.clusterRoot ? [node] : [],
        nodeStartX: node?.clusterRoot ? node.x : null,
        nodeStartY: node?.clusterRoot ? node.y : null,
        startX: point.x,
        startY: point.y,
        lastX: point.x,
        lastY: point.y,
        moved: false,
        resumeSimulation: node?.kind === 'space' && Boolean(animationFrame)
      };

      if (pointerState.mode === 'cluster') {
        releaseExpansionAnchors(pointerState.node?.id);
        for (const clusterNode of pointerState.clusterNodes) {
          clusterNode.dragging = true;
          clusterNode.vx = 0;
          clusterNode.vy = 0;
        }
      } else if ((pointerState.mode === 'node' || pointerState.mode === 'control') && pointerState.node) {
        pointerState.node.dragging = true;
        pointerState.node.vx = 0;
        pointerState.node.vy = 0;
        stopSimulation();
      } else if (pointerState.mode === 'home') {
        stopSimulation();
      }
    }

    canvas.setPointerCapture?.(event.pointerId);
    canvas.dataset.interacting = 'true';
    syncRotationState();
    event.preventDefault();
  }

  function handlePointerMove(event) {
    if (!graph || !canvas) return;

    const point = pointerPoint(event);
    if (!pointerState || pointerState.pointerId !== event.pointerId) {
      const world = screenToWorld(point);
      const hoveredKind = findNodeAt(world.x, world.y)?.kind;
      canvas.dataset.hoverNode = hoveredKind === 'memory' || hoveredKind === 'control' ? 'true' : 'false';
      return;
    }

    const wasMoved = pointerState.moved;
    if (Math.hypot(point.x - pointerState.startX, point.y - pointerState.startY) > 6) {
      pointerState.moved = true;
    }
    if (!wasMoved && pointerState.moved && pointerState.mode === 'cluster') {
      simulationFrames = 0;
      startSimulation();
    }

    const deltaX = point.x - pointerState.lastX;
    const deltaY = point.y - pointerState.lastY;

    if (pointerState.mode === 'rotate') {
      rotationApi()?.update?.(deltaX, deltaY);
      syncRotationState();
    } else if (pointerState.mode === 'cluster') {
      if (pointerState.moved) {
        const worldDeltaX = (point.x - pointerState.startX) / view.scale;
        const worldDeltaY = (point.y - pointerState.startY) / view.scale;
        for (const clusterNode of pointerState.clusterNodes) {
          clusterNode.x = pointerState.nodeStartX + worldDeltaX;
          clusterNode.y = pointerState.nodeStartY + worldDeltaY;
          clusterNode.vx = 0;
          clusterNode.vy = 0;
          containNode(clusterNode);
        }
      }
      if (pointerState.node === graph.spaceNode) {
        graph.centreX = pointerState.node.x;
        graph.centreY = pointerState.node.y;
      }
    } else if ((pointerState.mode === 'node' || pointerState.mode === 'control') && pointerState.node) {
      const world = screenToWorld(point);
      pointerState.node.x = world.x;
      pointerState.node.y = world.y;
      pointerState.node.vx = 0;
      pointerState.node.vy = 0;
      containNode(pointerState.node);
    } else if (pointerState.mode === 'pan' || pointerState.mode === 'home') {
      view.x += deltaX;
      view.y += deltaY;
      if (pointerState.mode === 'home' && activeControlParentId) {
        const worldDeltaX = deltaX / view.scale;
        const worldDeltaY = deltaY / view.scale;
        for (const node of presentationControlNodes.values()) {
          node.x -= worldDeltaX;
          node.y -= worldDeltaY;
        }
      }
    }

    pointerState.lastX = point.x;
    pointerState.lastY = point.y;
    drawGraph();
    event.preventDefault();
  }

  function handlePointerUp(event) {
    if (!pointerState || pointerState.pointerId !== event.pointerId) return;

    const mode = pointerState.mode;
    const selectedNode = pointerState.node;
    const shouldOpen = Boolean(selectedNode && !pointerState.moved && (
      mode === 'cluster' || mode === 'node' || mode === 'inspect' || mode === 'control' || mode === 'control-inspect'
    ));

    if (mode === 'rotate') {
      rotationApi()?.end?.();
      simulationFrames = 0;
      startSimulation();
    } else if (mode === 'cluster' && selectedNode) {
      for (const clusterNode of pointerState.clusterNodes) {
        clusterNode.dragging = false;
        clusterNode.vx = 0;
        clusterNode.vy = 0;
      }
      if (pointerState.moved) {
        simulationFrames = 0;
        startSimulation();
      }
    } else if ((mode === 'node' || mode === 'control') && selectedNode) {
      selectedNode.dragging = false;
      selectedNode.vx = 0;
      selectedNode.vy = 0;
      simulationFrames = 0;
      startSimulation();
    } else if (mode === 'home' && pointerState.resumeSimulation) {
      startSimulation();
    }

    if (mode === 'home' && !pointerState.moved) {
      collapsePresentationControls();
      if (document.body.classList.contains('molecular-view-active')) focusHome({ animate: true });
      else focusSpace({ animate: true });
      surface?.dispatchEvent(new CustomEvent('memory-graph-home'));
    }

    if (mode === 'cluster' && !pointerState.moved && selectedNode?.kind === 'space') {
      collapsePresentationControls();
      if (document.body.classList.contains('molecular-view-active')) focusHome({ animate: true });
      else focusSpace({ animate: true });
      surface?.dispatchEvent(new CustomEvent('memory-graph-home'));
    }

    if (shouldOpen && selectedNode.kind === 'control') activatePresentationControl(selectedNode);
    else if (shouldOpen && selectedNode.kind !== 'space') {
      collapsePresentationControls();
      openExistingInspector(selectedNode.id);
    }

    if (pointerState.moved && mode === 'cluster' && selectedNode === graph?.spaceNode) {
      persistGraphState(false, true);
    } else if (pointerState.moved && (mode === 'pan' || mode === 'inspect' || mode === 'home')) {
      persistGraphState(true);
    } else if (pointerState.moved && mode === 'node') {
      persistGraphState(false);
    }

    pointerState = null;
    canvas?.removeAttribute('data-interacting');
    try {
      canvas?.releasePointerCapture?.(event.pointerId);
    } catch {}
    syncRotationState();
    drawGraph();
  }

  function handleGraphDoubleClick(event) {
    if (!graph || event.button !== 0) return;
    const world = screenToWorld(pointerPoint(event));
    const root = findNodeAt(world.x, world.y);
    if (!root?.appRoot) return;
    if (root.appId) collapseAppHierarchy(root.appId);
    if (root.kind === 'space') handleGraphKeyDown({ key: 'Escape' });
    event.preventDefault();
  }

  function openExistingInspector(memoryId) {
    const memoryGrid = document.getElementById('memoryGrid');
    if (!memoryGrid || !memoryId) return false;

    inspectorBridgeActive = true;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.hidden = true;
    trigger.dataset.memoryId = String(memoryId);
    memoryGrid.appendChild(trigger);
    trigger.click();
    trigger.remove();
    requestAnimationFrame(() => { inspectorBridgeActive = false; });
    return true;
  }

  function handleWheel(event) {
    homePresentation = false;
    if (!graph || !canvas) return;
    stopViewTransition();

    const point = pointerPoint(event);
    const worldBefore = screenToWorld(point);
    const zoomFactor = Math.exp(-event.deltaY * 0.0012);
    const nextScale = clamp(view.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
    if (nextScale === view.scale) {
      event.preventDefault();
      return;
    }

    view.scale = nextScale;
    view.x = point.x - worldBefore.x * view.scale;
    view.y = point.y - worldBefore.y * view.scale;
    drawGraph();
    schedulePersistGraphState(true, 180);
    event.preventDefault();
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function screenToWorld(point) {
    return {
      x: (point.x - view.x) / view.scale,
      y: (point.y - view.y) / view.scale
    };
  }

  function findNodeAt(x, y) {
    if (!graph) return null;

    const drawableNodes = graph.nodes.filter((node) => !node.fixed && !node.hidden);
    const candidates = rotationActive()
      ? drawableNodes.sort((a, b) => projectedNode(b).depth - projectedNode(a).depth)
      : drawableNodes.reverse();

    for (const node of candidates) {
      const projected = projectedNode(node);
      if (Math.hypot(x - projected.x, y - projected.y) <= projected.radius + 5) return node;
    }

    const space = graph.spaceNode;
    if (space) {
      const projected = projectedNode(space);
      if (Math.hypot(x - projected.x, y - projected.y) <= projected.radius + 5) return space;
    }
    return null;
  }

  function clusterNodesFor(root) {
    if (!graph || !root) return [];

    const clusterNodes = [];
    const pending = [root];
    const visited = new Set();

    while (pending.length) {
      const parent = pending.shift();
      if (!parent || visited.has(parent.id)) continue;

      visited.add(parent.id);
      clusterNodes.push(parent);

      for (const node of graph.nodes) {
        if (node.parentId && String(node.parentId) === String(parent.id)) pending.push(node);
      }
    }

    return clusterNodes;
  }

  function frameUniverse(options = {}) {
    if (!graph) return false;
    const area = homeComposition();
    const nodes = graph.nodes.filter(node => !node.hidden && Number.isFinite(node.x) && Number.isFinite(node.y));
    if (!nodes.length) return false;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const node of nodes) {
      const p = projectedNode(node);
      const labelHalfWidth = Math.min(90, String(node.label || '').length * 3.4);
      const halfWidth = Math.max(p.radius + 8, labelHalfWidth);
      left = Math.min(left, p.x - halfWidth);
      right = Math.max(right, p.x + halfWidth);
      top = Math.min(top, p.y - p.radius - 8);
      bottom = Math.max(bottom, p.y + p.radius + 28);
    }
    const width = Math.max(160, area.graphRight - area.left - 16);
    const height = Math.max(160, area.bottom - area.top);
    const scale = clamp(Math.min(width / Math.max(1, right - left),
      height / Math.max(1, bottom - top)), MIN_SCALE, area.desktop ? MAX_SCALE : 1.3);
    const target = {
      scale,
      x: (area.left + area.graphRight) / 2 - (left + right) / 2 * scale,
      y: (area.top + area.bottom) / 2 - (top + bottom) / 2 * scale
    };
    homePresentation = true;
    if (options.animate && !orbMotion.matches) transitionView(target, true, options.duration);
    else { stopViewTransition(); Object.assign(view, target); }
    return true;
  }

  function focusHome(options = {}) {
    if (!graph) return false;
    cancelOrbGuide();
    rotationApi()?.reset?.();
    syncRotationState();
    frameUniverse(options);
    drawGraph();
    return true;
  }

  function restoreSavedView(savedView, width, height) {
    if (!savedView) return false;

    const scale = Number(savedView.scale);
    const centreX = Number(savedView.centreX);
    const centreY = Number(savedView.centreY);
    if (!Number.isFinite(scale) || !Number.isFinite(centreX) || !Number.isFinite(centreY)) return false;

    view.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    view.x = width / 2 - centreX * view.scale;
    view.y = height / 2 - centreY * view.scale;
    return true;
  }

  function serialiseView() {
    if (!graph) return null;
    const centre = screenToWorld({ x: graph.width / 2, y: graph.height / 2 });
    return {
      scale: view.scale,
      centreX: centre.x,
      centreY: centre.y
    };
  }

  function serialiseNodes() {
    if (!graph) return {};
    const width = Math.max(1, graph.width);
    const height = Math.max(1, graph.height);
    const nodes = {};

    for (const node of graph.memoryNodes) {
      nodes[node.id] = {
        offsetX: (node.x - graph.centreX) / width,
        offsetY: (node.y - graph.centreY) / height
      };
    }

    return nodes;
  }

  function serialiseMemoryRoot() {
    if (!graph?.spaceNode) return null;
    const width = Math.max(1, graph.width);
    const height = Math.max(1, graph.height);
    return {
      xRatio: graph.spaceNode.x / width,
      yRatio: graph.spaceNode.y / height
    };
  }

  function persistGraphState(includeView = true, includeMemoryRoot = false) {
    if (!graph?.spaceNode?.id) return false;

    const store = loadGraphState();
    const spaceId = String(graph.spaceNode.id);
    const current = store.spaces?.[spaceId] && typeof store.spaces[spaceId] === 'object'
      ? store.spaces[spaceId]
      : {};

    const next = {
      ...current,
      nodes: serialiseNodes(),
      updatedAt: new Date().toISOString()
    };

    if (includeMemoryRoot) {
      next.memoryRoot = serialiseMemoryRoot();
    }

    if (includeView) {
      next.view = serialiseView();
    }

    store.spaces[spaceId] = next;

    try {
      localStorage.setItem(GRAPH_STATE_KEY, JSON.stringify(store));
      return true;
    } catch {
      return false;
    }
  }

  function schedulePersistGraphState(includeView = true, delay = 150) {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persistGraphState(includeView);
    }, delay);
  }

  function stopViewTransition() {
    if (viewTransitionFrame) cancelAnimationFrame(viewTransitionFrame);
    viewTransitionFrame = 0;
  }

  function transitionView(target, redraw = true, duration = 320) {
    stopViewTransition();
    const start = { x: view.x, y: view.y, scale: view.scale };
    const startedAt = performance.now();
    const animate = (timestamp) => {
      const progress = Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      view.x = start.x + (target.x - start.x) * eased;
      view.y = start.y + (target.y - start.y) * eased;
      view.scale = start.scale + (target.scale - start.scale) * eased;
      if (redraw) drawGraph();
      if (progress < 1) viewTransitionFrame = requestAnimationFrame(animate);
      else viewTransitionFrame = 0;
    };
    viewTransitionFrame = requestAnimationFrame(animate);
  }

  function focusMemory(memoryId, redraw = true, options = {}) {
    if (!graph || !memoryId) return false;
    const node = graph.memoryNodes.find((item) => String(item.id) === String(memoryId));
    if (!node) return false;

    const projected = projectedNode(node);
    homePresentation = false;
    focusedNodeId = node.id;
    const scale = clamp(Math.max(view.scale, 1.15), MIN_SCALE, MAX_SCALE);
    const target = {
      scale,
      x: graph.width / 2 - projected.x * scale,
      y: graph.height / 2 - projected.y * scale
    };
    if (options.animate) transitionView(target, redraw);
    else {
      stopViewTransition();
      Object.assign(view, target);
      if (redraw) drawGraph();
    }

    return true;
  }

  function focusSpace(options = {}) {
    if (!graph) return false;
    homePresentation = false;
    focusedNodeId = null;
    const scale = clamp(Number(options.scale) || 1, MIN_SCALE, MAX_SCALE);
    const target = {
      scale,
      x: graph.width / 2 - graph.centreX * scale,
      y: graph.height / 2 - graph.centreY * scale
    };
    if (options.animate) transitionView(target, true);
    else {
      stopViewTransition();
      Object.assign(view, target);
      drawGraph();
    }
    return true;
  }

  function projectPresentationNode(node) {
    if (!graph || !node) return null;
    const projected = projectedNode({
      id: String(node.id || 'presentation-node'),
      kind: node.kind || 'memory',
      parentId: node.parentId,
      appRoot: node.appRoot,
      x: Number(node.x || graph.centreX),
      y: Number(node.y || graph.centreY),
      radius: Number(node.radius || 16)
    });
    return {
      ...projected,
      screenX: view.x + projected.x * view.scale,
      screenY: view.y + projected.y * view.scale,
      screenRadius: projected.radius * view.scale
    };
  }

  function registerPresentationControls(definitions = []) {
    presentationControlSpecs.clear();
    activeControlParentId = null;
    for (const definition of definitions) {
      if (!definition?.id) continue;
      presentationControlSpecs.set(String(definition.id), {
        id: String(definition.id),
        label: String(definition.label || 'Control'),
        sectorAngle: Number(definition.sectorAngle) || 0,
        radius: Number(definition.radius) || 18,
        parentId: definition.parentId ? String(definition.parentId) : null,
        action: String(definition.action || ''),
        expandable: Boolean(definition.expandable)
      });
    }
    if (!graph) return true;
    buildPresentationControlNodes(graph.width, graph.height, graph.centreX, graph.centreY, graph.orbitRadius);
    syncCanonicalGraphCollections();
    for (const node of visibleControlNodes()) containNode(node);
    simulationFrames = 0;
    drawGraph();
    if (visibleControlNodes().length) startSimulation();
    return true;
  }

  function presentationControlNode(id) {
    return graph ? presentationControlNodes.get(String(id)) || null : null;
  }

  function projectPresentationControl(id) {
    const node = presentationControlNode(id);
    return node ? projectPresentationNode(node) : null;
  }

  function presentationControlState(id) {
    const node = presentationControlNode(id);
    return node ? {
      id: node.id,
      kind: node.kind,
      x: node.x,
      y: node.y,
      radius: node.radius,
      dragging: node.dragging,
      hidden: Boolean(node.hidden),
      parentId: node.parentId || null
    } : null;
  }

  function setActiveControlParent(parentId = null, options = {}) {
    activeControlParentId = parentId && presentationControlNode(parentId) ? String(parentId) : null;
    for (const node of presentationControlNodes.values()) {
      if (!node.parentId) continue;
      node.hidden = !presentationControlVisible(node);
      node.dragging = false;
      if (node.hidden) {
        node.vx = 0;
        node.vy = 0;
      }
    }
    const anchorRoot = options.anchorRoot?.clusterRoot && (activeControlParentId || animationFrame)
      ? options.anchorRoot
      : null;
    if (anchorRoot) {
      anchorRoot.vx = 0;
      anchorRoot.vy = 0;
      expansionAnchoredRootIds.add(String(anchorRoot.id));
    } else if (!activeControlParentId) {
      releaseExpansionAnchors();
    }
    syncCanonicalGraphCollections();
    simulationFrames = 0;
    drawGraph();
    if (activeControlParentId) startSimulation();
    return true;
  }

  function collapsePresentationControls() {
    if (!graph || !activeControlParentId) return false;
    return setActiveControlParent(null);
  }

  function activatePresentationControl(node) {
    if (!node || node.hidden) return false;
    if (node.expandable) {
      if (node.appId) {
        const expanding = toggleAppNodeExpansion(node);
        if (expanding && node.action) {
          globalThis.UniversalAppAdapters?.dispatchAppAction?.(node.appId, node.action, {
            nodeId: node.nodeId,
            view: node.view,
            state: node.state
          });
        }
        return true;
      }
      const nextParentId = String(node.id) === 'settings'
        ? (activeControlParentId ? null : 'settings')
        : (activeControlParentId === node.id ? node.parentId : node.id);
      focusedNodeId = nextParentId || null;
      setActiveControlParent(nextParentId, { anchorRoot: node });
      return true;
    }
    if (!node.action) return false;
    if (node.appId) {
      globalThis.UniversalAppAdapters?.dispatchAppAction?.(node.appId, node.action, {
        nodeId: node.nodeId,
        view: node.view,
        state: node.state
      });
      return true;
    }
    surface?.dispatchEvent(new CustomEvent('memory-graph-control-action', {
      detail: { id: node.id, action: node.action, parentId: node.parentId || null }
    }));
    return true;
  }

  function focusPresentationControl(id, options = {}) {
    const node = presentationControlNode(id);
    return node ? focusPresentationNode(node, options) : false;
  }

  function updateAppNodes(updates) {
    if (!graph || !Array.isArray(updates)) return false;
    let changed = false;
    for (const update of updates) {
      const node = graph.appNodes?.find((candidate) => String(candidate.id) === String(update?.id || ''));
      if (!node) continue;
      if (Object.hasOwn(update, 'label')) node.label = String(update.label || '');
      if (Object.hasOwn(update, 'state')) node.state = update.state || null;
      changed = true;
    }
    if (changed) drawGraph();
    return changed;
  }

  function appNodeVisible(node) {
    if (!graph || !node?.parentId) return true;
    const parent = graph.appNodes?.find((candidate) => String(candidate.id) === String(node.parentId));
    if (!parent || parent.appRoot) return true;
    return expandedAppNodeIds.has(parent.id) && appNodeVisible(parent);
  }

  function syncAppNodeVisibility(appId) {
    if (!graph) return false;
    for (const node of graph.appNodes || []) {
      if (String(node.appId) !== String(appId) || node.appRoot) continue;
      node.hidden = !appNodeVisible(node);
      node.dragging = false;
      if (node.hidden) {
        node.vx = 0;
        node.vy = 0;
      }
    }
    return true;
  }

  function collapseExpandedAppDescendants(parentId) {
    if (!graph) return;
    const pending = [String(parentId)];
    while (pending.length) {
      const currentId = pending.shift();
      expandedAppNodeIds.delete(currentId);
      for (const node of graph.appNodes || []) {
        if (String(node.parentId || '') === currentId) pending.push(String(node.id));
      }
    }
  }

  function toggleAppNodeExpansion(node) {
    if (!graph || !node?.appId || !node.expandable) return false;
    const expanding = !expandedAppNodeIds.has(node.id);
    if (expanding) expandedAppNodeIds.add(node.id);
    else collapseExpandedAppDescendants(node.id);
    syncAppNodeVisibility(node.appId);
    simulationFrames = 0;
    drawGraph();
    if (expanding) startSimulation();
    return expanding;
  }

  function collapseAppHierarchy(appId) {
    if (!graph || !appId) return false;
    let changed = false;
    for (const node of graph.appNodes || []) {
      if (String(node.appId) !== String(appId) || !expandedAppNodeIds.has(node.id)) continue;
      expandedAppNodeIds.delete(node.id);
      changed = true;
    }
    if (!changed) return false;
    syncAppNodeVisibility(appId);
    simulationFrames = 0;
    drawGraph();
    startSimulation();
    return true;
  }

  function replaceAppNodeChildren(appId, parentId, children) {
    if (!graph || !Array.isArray(children)) return false;
    const parent = graph.appNodes?.find((node) => String(node.id) === String(parentId) && String(node.appId) === String(appId));
    const appRoot = graph.appNodes?.find((node) => node.appRoot && String(node.appId) === String(appId));
    if (!parent || !appRoot) return false;

    const removeIds = new Set();
    const pending = [String(parent.id)];
    while (pending.length) {
      const currentId = pending.shift();
      for (const node of graph.appNodes || []) {
        if (String(node.parentId || '') !== currentId || removeIds.has(node.id)) continue;
        removeIds.add(node.id);
        pending.push(String(node.id));
      }
    }
    for (const id of removeIds) expandedAppNodeIds.delete(id);
    graph.appNodes = (graph.appNodes || []).filter((node) => !removeIds.has(node.id));

    const stateUpdates = new Map(
      (globalThis.UniversalAppAdapters?.getAppNodeUpdates?.(appId) || [])
        .map((update) => [String(update.id), update])
    );
    const appOrbit = appRoot.targetOrbit || graph.orbitRadius * 1.08;
    const initialAngle = Math.atan2(parent.y - appRoot.y, parent.x - appRoot.x);
    const appendChildren = (definitions, localParent, depth, parentAngle) => {
      definitions.forEach((definition, index, siblings) => {
        const angle = parentAngle + (index / Math.max(1, siblings.length)) * Math.PI * 2;
        const spawnOrbit = depth === 1 ? directAppChildOrbit(index) : 54 + index * 7;
        const current = stateUpdates.get(String(definition.id));
        const node = {
          id: definition.id,
          appId: String(appId),
          nodeId: definition.nodeId,
          kind: 'control',
          label: current?.label || definition.label,
          state: current?.state || definition.state || null,
          x: localParent.x + Math.cos(angle) * spawnOrbit,
          y: localParent.y + Math.sin(angle) * spawnOrbit,
          vx: 0,
          vy: 0,
          radius: appControlRadius(depth),
          targetOrbit: appOrbit,
          localOrbit: spawnOrbit,
          gravityWeight: 0.92,
          parentId: localParent.id,
          action: String(definition.action || ''),
          view: definition.view || null,
          expandable: Boolean(definition.expandable),
          controlDepth: depth,
          recencyLevel: 0.72,
          fixed: false,
          dragging: false,
          hidden: true
        };
        graph.appNodes.push(node);
        appendChildren(definition.children || [], node, depth + 1, angle);
      });
    };
    appendChildren(children, parent, Number(parent.controlDepth || 0) + 1, initialAngle);
    parent.expandable = true;
    graph.appEdges = (graph.appNodes || []).flatMap((node) => {
      if (!node.parentId) return [];
      const source = graph.appNodes.find((candidate) => String(candidate.id) === String(node.parentId));
      return source ? [{ source, target: node, kind: 'space' }] : [];
    });
    syncAppNodeVisibility(appId);
    syncCanonicalGraphCollections();
    for (const node of graph.appNodes || []) {
      if (!node.hidden) containNode(node);
    }
    simulationFrames = 0;
    drawGraph();
    startSimulation();
    return true;
  }

  function bindAppAdapters() {
    const registry = globalThis.UniversalAppAdapters;
    if (appAdaptersBound || !registry?.stateEvent) return;
    appAdaptersBound = true;
    document.addEventListener(registry.stateEvent, (event) => {
      updateAppNodes(event.detail?.updates || []);
    });
    if (registry.hierarchyEvent) {
      document.addEventListener(registry.hierarchyEvent, (event) => {
        replaceAppNodeChildren(event.detail?.appId, event.detail?.parentId, event.detail?.children || []);
      });
    }
  }

  function beginPresentationControlDrag(id) {
    const node = presentationControlNode(id);
    if (!node || rotationActive()) return false;
    stopViewTransition();
    stopSimulation();
    node.dragging = true;
    node.vx = 0;
    node.vy = 0;
    return true;
  }

  function movePresentationControlDrag(id, clientX, clientY) {
    const node = presentationControlNode(id);
    if (!node?.dragging || !canvas) return false;
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld({ x: clientX - rect.left, y: clientY - rect.top });
    node.x = world.x;
    node.y = world.y;
    node.vx = 0;
    node.vy = 0;
    containNode(node);
    drawGraph();
    return true;
  }

  function endPresentationControlDrag(id) {
    const node = presentationControlNode(id);
    if (!node?.dragging) return false;
    node.dragging = false;
    node.vx = 0;
    node.vy = 0;
    simulationFrames = 0;
    startSimulation();
    return true;
  }

  function presentationState() {
    if (!graph) return null;
    return {
      width: graph.width,
      height: graph.height,
      centreX: graph.centreX,
      centreY: graph.centreY,
      view: { ...view }
    };
  }

  function focusPresentationNode(node, options = {}) {
    if (!graph || !node) return false;
    homePresentation = false;
    const projected = options.projected || projectPresentationNode(node);
    if (!projected) return false;
    const scale = options.exactScale ?? clamp(Math.max(view.scale, Number(options.scale) || 1.08), MIN_SCALE, MAX_SCALE);
    const target = {
      scale,
      x: (options.screenX ?? graph.width / 2) - projected.x * scale,
      y: (options.screenY ?? graph.height / 2) - projected.y * scale
    };
    if (options.animate) transitionView(target, true);
    else {
      stopViewTransition();
      if (options.from) {
        const progress = clamp(options.progress, 0, 1);
        for (const key of ['x', 'y', 'scale']) view[key] = options.from[key] + (target[key] - options.from[key]) * progress;
      } else Object.assign(view, target);
      if (options.redraw !== false) drawGraph();
    }
    return true;
  }

  function focusSearchTerm(value, redraw = true) {
    const query = String(value || '').trim().toLowerCase();
    if (!query) {
      focusedNodeId = null;
      if (redraw) drawGraph();
      return false;
    }

    const data = activeGraphData();
    if (!data || !graph) return false;

    const match = data.memories
      .map((memory) => ({ memory, rank: searchRank(memory, query) }))
      .filter((item) => Number.isFinite(item.rank))
      .sort((a, b) => a.rank - b.rank)[0]?.memory;

    if (!match) {
      focusedNodeId = null;
      if (redraw) drawGraph();
      return false;
    }

    return focusMemory(match.id, redraw);
  }

  function searchRank(memory, query) {
    const title = String(memory.title || '').toLowerCase();
    if (title === query) return 0;
    if (title.startsWith(query)) return 1;
    if (title.includes(query)) return 2;

    const searchable = [
      memory.content,
      memory.source,
      memory.type,
      memory.importance,
      memory.project,
      memory.priority
    ].some((value) => String(value || '').toLowerCase().includes(query));

    return searchable ? 3 : Number.POSITIVE_INFINITY;
  }

  function resetView() {
    stopViewTransition();
    view.x = 0;
    view.y = 0;
    view.scale = 1;
    focusedNodeId = null;
    rotationApi()?.reset?.();
    syncRotationState();
    frameUniverse();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function refresh() {
    if (!surface || !canvas) return;
    resizeCanvas();
  }

  function observeWorkspaceUi() {
    const memoryGrid = document.getElementById('memoryGrid');
    const spaceTitle = document.getElementById('spaceTitle');
    if (!memoryGrid && !spaceTitle) return;

    workspaceObserver = new MutationObserver(() => {
      if (inspectorBridgeActive) {
        simulationFrames = 0;
        startSimulation();
        return;
      }
      refresh();
    });
    if (memoryGrid) workspaceObserver.observe(memoryGrid, { childList: true });
    if (spaceTitle) workspaceObserver.observe(spaceTitle, { childList: true, characterData: true, subtree: true });
  }

  function mount() {
    const section = document.getElementById('memoryGraphSection');
    surface = document.getElementById('memoryGraphSurface');
    if (!section || !surface || !ensureCanvas()) return false;

    surface.dataset.memoryGraphReady = 'true';
    section.dataset.memoryGraphVersion = String(VERSION);
    syncRotationState();

    bindSearch();
    bindAppAdapters();

    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(resizeCanvas);
    resizeObserver.observe(surface);

    workspaceObserver?.disconnect();
    observeWorkspaceUi();
    resizeCanvas();
    mountOrb();
    return true;
  }

  globalThis.MemoryGraph = Object.freeze({
    version: VERSION,
    setOrbState,
    setOrbAmplitude,
    orbSearch,
    askOrb,
    guideOrbTo,
    orbGuidanceState: () => ({ state: orb.state, targetId: orbGuide.id, position: orbGuide.position && { ...orbGuide.position } }),
    mount,
    refresh,
    redraw: drawGraph,
    wakeSimulation() {
      simulationFrames = 0;
      startSimulation();
    },
    focusMemory,
    focusHome,
    focusSpace,
    projectPresentationNode,
    focusPresentationNode,
    presentationState,
    registerPresentationControls,
    collapsePresentationControls,
    projectPresentationControl,
    presentationControlState,
    focusPresentationControl,
    updateAppNodes,
    beginPresentationControlDrag,
    movePresentationControlDrag,
    endPresentationControlDrag,
    focusSearchTerm,
    resetRotation() {
      rotationApi()?.reset?.();
      syncRotationState();
      drawGraph();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
