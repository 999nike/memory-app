(() => {
  'use strict';

  // Pulse routing follows the approved August renderer (blob
  // 6feadb2985a4179620fd55ae9b95c6afd12bb3fb) while retaining the current
  // pulse-only, capped and visibility-aware animation lifecycle.
  const VERSION = 13;
  const MAX_DPR = 1.75;
  const MAX_PULSES = 10;
  const FRAME_MS = 1000 / 30;
  const AMBIENT_MIN_MS = 550;
  const AMBIENT_MAX_MS = 900;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const palettes = {
    blue: ['255,255,255', '102,225,255', '37,126,255'],
    cyan: ['255,255,255', '95,240,255', '27,170,255'],
    lime: ['255,255,244', '193,255,79', '60,211,102'],
    violet: ['255,255,255', '231,116,255', '142,62,255'],
    magenta: ['255,255,255', '255,92,219', '213,44,180'],
    yellow: ['255,255,255', '255,232,72', '255,145,35'],
    green: ['255,255,255', '148,255,125', '37,190,98'],
    purple: ['255,255,255', '226,115,255', '150,54,255'],
    orange: ['255,255,255', '255,190,74', '255,87,25']
  };

  let sourceCanvas = null;
  let layer = null;
  let ctx = null;
  let width = 1;
  let height = 1;
  let frame = 0;
  let lastPaint = 0;
  let ambientTimer = 0;
  let hiddenAt = 0;
  let pulseSequence = 0;
  let lastActivitySync = 0;
  let ambientCursor = 0;
  const pulses = [];
  const blooms = [];
  const anchors = new Map();
  const activityKeys = new Map();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function scaffold() {
    return globalThis.MemoryGraphNeuralScaffold || null;
  }

  function ensureLayer(canvas = sourceCanvas || document.querySelector('.memory-graph-canvas')) {
    if (!canvas?.parentElement) return false;
    if (!layer || sourceCanvas !== canvas || !layer.isConnected) {
      layer?.remove();
      sourceCanvas = canvas;
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-flow-canvas';
      layer.setAttribute('aria-hidden', 'true');
      canvas.parentElement.appendChild(layer);
      ctx = layer.getContext('2d');
    }
    return Boolean(ctx);
  }

  function syncLayerSize() {
    if (!ensureLayer()) return false;
    width = Math.max(1, Math.round(sourceCanvas.clientWidth));
    height = Math.max(1, Math.round(sourceCanvas.clientHeight));
    const dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
      layer.width = pixelWidth;
      layer.height = pixelHeight;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    return true;
  }

  function captureAnchor(id, context, point) {
    const key = String(id || '');
    if (!key || !context?.canvas || !point || !ensureLayer(context.canvas)) return false;
    const canvasWidth = Math.max(1, context.canvas.clientWidth);
    const dpr = Math.max(1, context.canvas.width / canvasWidth);
    const matrix = context.getTransform();
    anchors.set(key, {
      x: (matrix.a * Number(point.x) + matrix.c * Number(point.y) + matrix.e) / dpr,
      y: (matrix.b * Number(point.x) + matrix.d * Number(point.y) + matrix.f) / dpr,
      radius: Math.max(1, Number(point.radius) || 1) * Math.max(.001, Math.hypot(matrix.a, matrix.b) / dpr)
    });
    return true;
  }

  function curvePoints(from, to, seed = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / distance;
    const ny = dx / distance;
    const bend = (seed % 2 ? 1 : -1) * clamp(distance * (.16 + (seed % 17) / 140), 10, 104);
    const p1 = { x: from.x + dx * .28 + nx * bend * .78, y: from.y + dy * .28 + ny * bend * .78 };
    const p2 = { x: from.x + dx * .72 - nx * bend * .86, y: from.y + dy * .72 - ny * bend * .86 };
    return Array.from({ length: 43 }, (_, index) => {
      const t = index / 42;
      const mt = 1 - t;
      return {
        x: from.x * mt * mt * mt + 3 * p1.x * mt * mt * t + 3 * p2.x * mt * t * t + to.x * t * t * t,
        y: from.y * mt * mt * mt + 3 * p1.y * mt * mt * t + 3 * p2.y * mt * t * t + to.y * t * t * t
      };
    });
  }

  function pathMetrics(points) {
    const lengths = [];
    const cumulative = [0];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      const length = Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
      lengths.push(length);
      total += length;
      cumulative.push(total);
    }
    return { lengths, cumulative, total: Math.max(1, total) };
  }

  function positionAt(pulse, progress) {
    const target = clamp(progress, 0, 1) * pulse.metrics.total;
    for (let index = 0; index < pulse.metrics.lengths.length; index += 1) {
      const travelled = pulse.metrics.cumulative[index];
      const next = pulse.metrics.cumulative[index + 1];
      if (target <= next || index === pulse.metrics.lengths.length - 1) {
        const local = clamp((target - travelled) / Math.max(.001, pulse.metrics.lengths[index]), 0, 1);
        const a = pulse.points[index];
        const b = pulse.points[index + 1];
        return { index, point: { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local } };
      }
    }
    return { index: pulse.points.length - 2, point: pulse.points[pulse.points.length - 1] };
  }

  function pointAt(pulse, progress) {
    return positionAt(pulse, progress).point;
  }

  function resolvePath(sourceId, targetId) {
    const direct = scaffold()?.routeBetween?.(sourceId, targetId);
    if (direct?.points?.length > 1) return direct;
    const from = anchors.get(String(sourceId || '')) || scaffold()?.nodePoint?.(sourceId);
    const to = anchors.get(String(targetId || '')) || scaffold()?.nodePoint?.(targetId);
    if (!from || !to) return null;
    return {
      points: curvePoints(from, to, String(sourceId).length * 31 + String(targetId).length * 17),
      boundaries: []
    };
  }

  function paletteName(value, fallback = 'blue') {
    const key = String(value || fallback).toLowerCase();
    return palettes[key] ? key : fallback;
  }

  function addBloom(point, palette, intensity = 1, radius = 10) {
    blooms.push({
      point: { ...point },
      palette,
      intensity,
      radius,
      startedAt: performance.now(),
      duration: 560
    });
    if (blooms.length > MAX_PULSES) blooms.splice(0, blooms.length - MAX_PULSES);
    startLoop();
  }

  function fireSynapse(sourceNodeId, targetNodeId, options = {}) {
    const route = resolvePath(sourceNodeId, targetNodeId);
    const points = route?.points;
    if (!points?.length || !ensureLayer()) return false;
    const palette = paletteName(options.palette || route.palette, 'cyan');
    const intensity = clamp(Number(options.intensity) || 1, .45, 1.8);
    const id = `synapse-${++pulseSequence}`;
    if (reducedMotion.matches) {
      addBloom(points[points.length - 1], palette, intensity, Number(options.destinationRadius) || 12);
      return id;
    }
    if (pulses.length >= MAX_PULSES) {
      const ambientIndex = pulses.findIndex((pulse) => pulse.ambient);
      if (ambientIndex >= 0) pulses.splice(ambientIndex, 1);
      else return false;
    }
    const metrics = pathMetrics(points);
    const pulse = {
      id,
      sourceNodeId: String(sourceNodeId || ''),
      targetNodeId: String(targetNodeId || ''),
      points,
      boundaries: Array.isArray(route.boundaries) ? route.boundaries : [],
      metrics,
      palette,
      intensity,
      ambient: options.ambient === true,
      startedAt: performance.now() + clamp(Number(options.delay) || 0, 0, 900),
      duration: clamp(Number(options.duration) || (1050 + Math.min(1000, metrics.total * 2.2)), 650, 4200),
      destinationRadius: clamp(Number(options.destinationRadius) || 16, 8, 42),
      arrivalDetail: options.arrivalDetail || null
    };
    pulses.push(pulse);
    startLoop();
    return id;
  }

  function easeElectrical(progress) {
    const smooth = progress * progress * (3 - 2 * progress);
    return clamp(smooth + Math.sin(progress * Math.PI * 8) * Math.sin(progress * Math.PI) * .012, 0, 1);
  }

  function glow(point, radius, alpha, palette) {
    const colours = palettes[palette] || palettes.blue;
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    gradient.addColorStop(0, `rgba(${colours[0]},${alpha})`);
    gradient.addColorStop(.24, `rgba(${colours[1]},${alpha * .92})`);
    gradient.addColorStop(.62, `rgba(${colours[2]},${alpha * .45})`);
    gradient.addColorStop(1, `rgba(${colours[2]},0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function traceTail(pulse, fromProgress, toProgress) {
    const start = positionAt(pulse, fromProgress);
    const end = positionAt(pulse, toProgress);
    ctx.beginPath();
    ctx.moveTo(start.point.x, start.point.y);
    for (let index = start.index + 1; index <= end.index; index += 1) {
      ctx.lineTo(pulse.points[index].x, pulse.points[index].y);
    }
    ctx.lineTo(end.point.x, end.point.y);
  }

  function drawPulse(pulse, progress) {
    const eased = easeElectrical(progress);
    const point = pointAt(pulse, eased);
    const source = pulse.points[0];
    const colours = palettes[pulse.palette] || palettes.cyan;

    if (progress < .16) {
      const launchEnergy = 1 - progress / .16;
      glow(source, (13 + 13 * launchEnergy) * pulse.intensity, .24 * launchEnergy, pulse.palette);
      glow(source, (5 + 6 * launchEnergy) * pulse.intensity, .58 * launchEnergy, pulse.palette);
    }

    // The reference reads as a wave energising the neuron behind it, not a
    // detached comet. Keep the travelled branch coloured, with the hottest
    // energy concentrated at the advancing front.
    const travelledGradient = ctx.createLinearGradient(source.x, source.y, point.x, point.y);
    travelledGradient.addColorStop(0, `rgba(${colours[2]},.18)`);
    travelledGradient.addColorStop(.44, `rgba(${colours[1]},.44)`);
    travelledGradient.addColorStop(.82, `rgba(${colours[1]},.78)`);
    travelledGradient.addColorStop(1, 'rgba(255,255,255,.98)');

    traceTail(pulse, 0, eased);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8.2 * pulse.intensity;
    ctx.strokeStyle = `rgba(${colours[2]},.11)`;
    ctx.stroke();

    traceTail(pulse, 0, eased);
    ctx.lineWidth = 3.2 * pulse.intensity;
    ctx.strokeStyle = travelledGradient;
    ctx.stroke();

    const hotStart = Math.max(0, eased - .075);
    traceTail(pulse, hotStart, eased);
    ctx.lineWidth = Math.max(.9, 1.30 * pulse.intensity);
    ctx.strokeStyle = 'rgba(255,255,255,.99)';
    ctx.stroke();

    glow(point, 14 * pulse.intensity, .50, pulse.palette);
    glow(point, 6.0 * pulse.intensity, .94, pulse.palette);
    ctx.fillStyle = 'rgba(255,255,255,.99)';
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(1.4, 2.1 * pulse.intensity), 0, Math.PI * 2);
    ctx.fill();

    for (const boundary of pulse.boundaries) {
      const distance = Math.abs(eased - boundary.progress);
      if (distance > .045) continue;
      const energy = 1 - distance / .045;
      glow(boundary.point, (6 + energy * 8) * pulse.intensity, energy * .48, pulse.palette);
    }
  }

  function drawBloom(bloom, timestamp) {
    const progress = clamp((timestamp - bloom.startedAt) / bloom.duration, 0, 1);
    const energy = Math.sin(progress * Math.PI);
    const radius = bloom.radius + progress * 24;
    glow(bloom.point, radius * 1.9, energy * .66 * bloom.intensity, bloom.palette);
    glow(bloom.point, radius * .72, energy * .92 * bloom.intensity, bloom.palette);
    ctx.beginPath();
    ctx.arc(bloom.point.x, bloom.point.y, radius, 0, Math.PI * 2);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = `rgba(${(palettes[bloom.palette] || palettes.blue)[1]},${energy * .72})`;
    ctx.stroke();
    if (progress < .48) {
      ctx.fillStyle = `rgba(255,255,255,${(1 - progress / .48) * .92})`;
      ctx.beginPath();
      ctx.arc(bloom.point.x, bloom.point.y, Math.max(1.5, bloom.radius * .18), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function completePulse(pulse) {
    const destination = pulse.points[pulse.points.length - 1];
    addBloom(destination, pulse.palette, pulse.intensity, pulse.destinationRadius);
    if (pulse.arrivalDetail) {
      window.dispatchEvent(new CustomEvent('universal-route-pulse-arrived', { detail: pulse.arrivalDetail }));
    }
  }

  function syncVisualActivities(timestamp) {
    if (timestamp - lastActivitySync < 750) return;
    lastActivitySync = timestamp;
    const registry = globalThis.UniversalAppAdapters;
    const activeKeys = new Set();
    for (const activity of registry?.getVisualActivities?.() || []) {
      if (!activity?.pending || (activity.expiresAt && timestamp >= activity.expiresAt)) continue;
      const key = `${activity.targetId || ''}:${activity.startedAt || 0}:${activity.from || ''}:${activity.to || ''}`;
      activeKeys.add(key);
      if (activityKeys.has(key) || !activity.from || !activity.to) continue;
      activityKeys.set(key, timestamp);
      fireSynapse(activity.from, activity.to, {
        palette: activity.palette || (activity.kind === 'job' ? 'orange' : 'violet'),
        intensity: activity.emphasis === 'strong' ? 1.35 : 1.08,
        duration: 1700,
        arrivalDetail: activity.oneShot ? {
          targetId: activity.targetId,
          jobId: activity.jobId,
          from: activity.from,
          to: activity.to
        } : null
      });
    }
    for (const [key, createdAt] of activityKeys) {
      if (!activeKeys.has(key) && timestamp - createdAt > 5000) activityKeys.delete(key);
    }

    for (const route of scaffold()?.routes?.() || []) {
      const target = route.activityTarget;
      if (!target?.appId || !target?.nodeId) continue;
      const activity = registry?.getAppActivity?.(target.appId, target.nodeId);
      if (!activity?.pending) continue;
      const key = `app:${target.appId}:${target.nodeId}`;
      const previous = activityKeys.get(key) || 0;
      if (timestamp - previous < 2400) continue;
      activityKeys.set(key, timestamp);
      fireSynapse(route.sourceId, route.targetId, {
        palette: activity.palette || (activity.kind === 'job' ? 'orange' : (target.appId === 'email' ? 'cyan' : 'violet')),
        intensity: activity.emphasis === 'strong' ? 1.3 : 1.08,
        duration: 1450
      });
    }
  }

  function drawFrame(timestamp) {
    frame = 0;
    if (document.hidden || !ctx || !layer?.isConnected) return;
    if (timestamp - lastPaint < FRAME_MS) {
      frame = requestAnimationFrame(drawFrame);
      return;
    }
    lastPaint = timestamp;
    syncVisualActivities(timestamp);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let index = pulses.length - 1; index >= 0; index -= 1) {
      const pulse = pulses[index];
      const progress = (timestamp - pulse.startedAt) / pulse.duration;
      if (progress >= 1) {
        pulses.splice(index, 1);
        completePulse(pulse);
        continue;
      }
      if (progress >= 0) drawPulse(pulse, progress);
    }

    for (let index = blooms.length - 1; index >= 0; index -= 1) {
      const bloom = blooms[index];
      if (timestamp - bloom.startedAt >= bloom.duration) {
        blooms.splice(index, 1);
        continue;
      }
      drawBloom(bloom, timestamp);
    }
    ctx.restore();

    if ((pulses.length || blooms.length) && !frame) frame = requestAnimationFrame(drawFrame);
  }

  function startLoop() {
    if (!frame && !document.hidden && (pulses.length || blooms.length)) {
      frame = requestAnimationFrame(drawFrame);
    }
  }

  function stopLoop(clear = false) {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastPaint = 0;
    if (clear && ctx) ctx.clearRect(0, 0, width, height);
  }

  function scheduleAmbient() {
    if (ambientTimer) clearTimeout(ambientTimer);
    ambientTimer = 0;
    if (document.hidden || reducedMotion.matches) return;
    const delay = AMBIENT_MIN_MS + Math.random() * (AMBIENT_MAX_MS - AMBIENT_MIN_MS);
    ambientTimer = window.setTimeout(() => {
      ambientTimer = 0;
      const routes = scaffold()?.routes?.() || [];
      const outward = routes.filter((route) => route.sourceHub);
      const available = outward.length ? outward : routes;
      const ambientCount = pulses.filter((pulse) => pulse.ambient).length;

      if (available.length && ambientCount < 4 && pulses.length < MAX_PULSES) {
        const seedRoute = available[ambientCursor % available.length];
        ambientCursor += 1;

        const sameCore = available.filter((route) => route.sourceId === seedRoute.sourceId);
        const burst = (sameCore.length ? sameCore : [seedRoute]).slice(0, Math.min(4, MAX_PULSES - pulses.length));

        burst.forEach((route, index) => {
          fireSynapse(
            route.sourceId,
            route.targetId,
            {
              ambient: true,
              palette: route.palette || 'cyan',
              intensity: 1.22 + Math.random() * .20,
              duration: 1750 + Math.random() * 550,
              delay: index * 110
            }
          );
        });
      }
      scheduleAmbient();
    }, delay);
  }

  function handleRouteChange() {
    pulses.length = 0;
    blooms.length = 0;
    syncLayerSize();
    stopLoop(true);
    scheduleAmbient();
  }

  function handleVisibility() {
    if (document.hidden) {
      hiddenAt = performance.now();
      if (ambientTimer) clearTimeout(ambientTimer);
      ambientTimer = 0;
      stopLoop(false);
      return;
    }
    if (hiddenAt) {
      const pause = performance.now() - hiddenAt;
      for (const pulse of pulses) pulse.startedAt += pause;
      for (const bloom of blooms) bloom.startedAt += pause;
      hiddenAt = 0;
    }
    startLoop();
    scheduleAmbient();
  }

  function handleReducedMotion() {
    if (reducedMotion.matches) {
      if (ambientTimer) clearTimeout(ambientTimer);
      ambientTimer = 0;
      for (let index = pulses.length - 1; index >= 0; index -= 1) {
        if (pulses[index].ambient) pulses.splice(index, 1);
      }
    } else {
      scheduleAmbient();
    }
  }

  function handleActivityChange() {
    lastActivitySync = 0;
    syncVisualActivities(performance.now());
    startLoop();
  }

  window.addEventListener('memory-neural-routes-changed', handleRouteChange);
  document.addEventListener('visibilitychange', handleVisibility);
  document.addEventListener('universal-app-activity-change', handleActivityChange);
  reducedMotion.addEventListener?.('change', handleReducedMotion);

  if (!document.getElementById('memoryGraphNeuralFlowStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralFlowStyles';
    style.textContent = '.memory-graph-neural-flow-canvas{position:absolute;inset:0;z-index:3;display:block;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;opacity:1}';
    document.head.appendChild(style);
  }

  const api = Object.freeze({
    version: VERSION,
    captureAnchor,
    fireSynapse,
    activePulseCount: () => pulses.length,
    pulseLimit: MAX_PULSES,
    hubEnergy: () => 0,
    redraw() {
      syncLayerSize();
      startLoop();
    }
  });
  globalThis.MemoryGraphNeuralFlow = api;
  globalThis.fireSynapse = fireSynapse;

  // Start ambient firing even if the first route-change event already happened.
  syncLayerSize();
  scheduleAmbient();
})();
