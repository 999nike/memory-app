(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralMassInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralMassInstalled', { value: true });

  const prevBegin = proto.beginPath;
  const prevMove = proto.moveTo;
  const prevLine = proto.lineTo;
  const prevClear = proto.clearRect;
  const prevStroke = proto.stroke;
  const base = [];
  const manual = [];
  let layer = null;
  let ctx = null;
  let source = null;
  let frame = 0;
  let lastPaint = 0;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (s, a = 0, b = 0) => {
    const v = Math.sin(s * 8761.317 + a * 67.731 + b * 181.913) * 43758.5453;
    return v - Math.floor(v);
  };
  const mainCanvas = (c) => c?.canvas?.classList?.contains('memory-graph-canvas') === true;
  const groupCanvas = (c) => c?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  const blueLine = (c) => {
    if (!c?.__neuralMassStart || !c?.__neuralMassEnd) return false;
    const s = String(c.strokeStyle || '');
    return s.includes('120, 184, 255') || s.includes('55, 139, 255');
  };

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || source !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-mass-canvas';
      layer.setAttribute('aria-hidden', 'true');
      canvas.parentElement.appendChild(layer);
      ctx = layer.getContext('2d');
      source = canvas;
    }
    if (!ctx) return false;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, canvas.width / Math.max(1, w));
    if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) {
      layer.width = Math.round(w * dpr);
      layer.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
    if (!frame) frame = requestAnimationFrame(drawFrame);
    return true;
  }

  function endpoints(c) {
    const a = c.__neuralMassStart;
    const b = c.__neuralMassEnd;
    if (!a || !b) return null;
    const rect = c.canvas.getBoundingClientRect();
    const dpr = Math.max(1, c.canvas.width / Math.max(1, rect.width));
    const m = c.getTransform();
    const project = (p) => ({
      x: (m.a * p.x + m.c * p.y + m.e) / dpr,
      y: (m.b * p.x + m.d * p.y + m.f) / dpr
    });
    return { from: project(a), to: project(b) };
  }

  function capture(c, compact) {
    const canvas = source || document.querySelector('.memory-graph-canvas');
    if (!canvas || !ensureLayer(canvas)) return;
    const p = endpoints(c);
    if (!p) return;
    const length = Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y);
    if (length < 5) return;
    const seed = Math.abs(Math.sin(p.from.x * 0.0167 + p.from.y * 0.0221 + p.to.x * 0.0113 + p.to.y * 0.0279));
    (compact ? manual : base).push({ ...p, length, seed, compact });
  }

  function curve(c, from, to, seed, lane = 0, bendScale = 1) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / len;
    const py = dx / len;
    const side = hash(seed, lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(len * (0.07 + hash(seed, lane, 2) * 0.09), 7, 56) * bendScale;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.16;
    c.beginPath();
    c.moveTo(from.x, from.y);
    c.bezierCurveTo(
      from.x + dx * (0.28 + skew) + px * bend * 0.68,
      from.y + dy * (0.28 + skew) + py * bend * 0.68,
      from.x + dx * (0.67 - skew) + px * bend,
      from.y + dy * (0.67 - skew) + py * bend,
      to.x, to.y
    );
  }

  const between = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  function centrePoint() {
    if (!base.length) return null;
    let x = 0;
    let y = 0;
    for (const s of base) { x += s.from.x; y += s.from.y; }
    return { x: x / base.length, y: y / base.length };
  }

  function ambientSheath(s, t, interacting) {
    const mobile = source?.clientWidth < 700;
    const detail = interacting ? 0.42 : mobile ? 0.66 : 1;
    const width = clamp(s.length * 0.048, s.compact ? 7 : 12, s.compact ? 13 : 24);
    const lanes = interacting ? 1 : mobile ? 2 : s.compact ? 2 : 4;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < lanes; i += 1) {
      const seed = s.seed + i * 0.271 + Math.sin(t * 0.00023 + s.seed * 19.7) * 0.05;
      curve(ctx, s.from, s.to, seed, i, 1.05 + i * 0.07);
      ctx.lineWidth = width * (2.55 - i * 0.28);
      ctx.strokeStyle = `rgba(10,57,212,${(0.022 * detail).toFixed(3)})`;
      ctx.stroke();
      curve(ctx, s.from, s.to, seed + 0.37, i + 6, 0.94);
      ctx.lineWidth = width * (1.42 - i * 0.10);
      ctx.strokeStyle = `rgba(29,119,255,${(0.034 * detail).toFixed(3)})`;
      ctx.stroke();
    }
    ctx.restore();
  }

  function hubMass(centre, t, interacting) {
    const mobile = source?.clientWidth < 700;
    const radius = mobile ? 48 : 72;
    const pulse = 0.90 + Math.sin(t * 0.0016) * 0.08;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
    g.addColorStop(0, `rgba(230,252,255,${(interacting ? 0.05 : 0.08) * pulse})`);
    g.addColorStop(0.16, `rgba(78,187,255,${(interacting ? 0.07 : 0.11) * pulse})`);
    g.addColorStop(0.48, `rgba(28,102,255,${(interacting ? 0.05 : 0.085) * pulse})`);
    g.addColorStop(1, 'rgba(12,47,196,0)');
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    if (!interacting) {
      const count = mobile ? 10 : 18;
      for (let i = 0; i < count; i += 1) {
        const seed = i * 0.317 + 1.71;
        const a = (i / count) * Math.PI * 2 + (hash(seed, 1, 2) - 0.5) * 0.28;
        const len = radius * (0.42 + hash(seed, 3, 4) * 0.48);
        const end = { x: centre.x + Math.cos(a) * len, y: centre.y + Math.sin(a) * len };
        curve(ctx, centre, end, seed, i, 0.62);
        ctx.lineWidth = i % 3 === 0 ? 1.1 : 0.55;
        ctx.strokeStyle = i % 3 === 0 ? 'rgba(135,226,255,.24)' : 'rgba(92,188,255,.18)';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function sharedRoots(centre, t, interacting) {
    if (base.length < 2) return;
    const mobile = source?.clientWidth < 700;
    const sorted = [...base].sort((a, b) => Math.atan2(a.to.y - centre.y, a.to.x - centre.x) - Math.atan2(b.to.y - centre.y, b.to.x - centre.x));
    const maxGap = mobile ? 0.78 : 1.05;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      const aa = Math.atan2(a.to.y - centre.y, a.to.x - centre.x);
      let ba = Math.atan2(b.to.y - centre.y, b.to.x - centre.x);
      if (i === sorted.length - 1) ba += Math.PI * 2;
      if (Math.abs(ba - aa) > maxGap) continue;
      const seed = a.seed * 0.61 + b.seed * 0.39;
      const p1 = between(a.from, a.to, 0.10 + hash(seed, 1, 3) * 0.17);
      const p2 = between(b.from, b.to, 0.10 + hash(seed, 2, 4) * 0.17);
      curve(ctx, p1, p2, seed + t * 0.000001, 11, 0.84);
      ctx.lineWidth = interacting ? 2.4 : 5.2;
      ctx.strokeStyle = interacting ? 'rgba(44,132,255,.035)' : 'rgba(37,127,255,.075)';
      ctx.stroke();
      if (!interacting && !mobile) {
        curve(ctx, p1, p2, seed + 0.71, 17, 0.72);
        ctx.lineWidth = 0.55;
        ctx.strokeStyle = 'rgba(164,235,255,.27)';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function tendrils(s, t, interacting) {
    if (interacting) return;
    const mobile = source?.clientWidth < 700;
    const count = s.compact ? 2 : mobile ? 3 : 7;
    const dx = s.to.x - s.from.x;
    const dy = s.to.y - s.from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const tx = dx / len;
    const ty = dy / len;
    const px = -ty;
    const py = tx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i += 1) {
      const seed = s.seed + i * 0.419 + 3.1;
      const origin = between(s.from, s.to, 0.12 + hash(seed, 1, 2) * 0.76);
      const side = hash(seed, 3, 4) > 0.5 ? 1 : -1;
      const reach = (s.compact ? 12 : 24) + hash(seed, 5, 6) * (s.compact ? 20 : 72);
      const forward = (hash(seed, 7, 8) - 0.45) * reach * 0.72;
      const end = { x: origin.x + px * side * reach + tx * forward, y: origin.y + py * side * reach + ty * forward };
      const mid = { x: (origin.x + end.x) * 0.5 + px * side * reach * 0.16, y: (origin.y + end.y) * 0.5 + py * side * reach * 0.16 };
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = 'rgba(26,112,255,.05)';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.quadraticCurveTo(mid.x, mid.y, end.x, end.y);
      ctx.lineWidth = 0.38;
      ctx.strokeStyle = 'rgba(174,238,255,.30)';
      ctx.stroke();
      if (!s.compact && !mobile && hash(seed, 9, 10) > 0.46) {
        const fork = { x: mid.x - px * side * reach * 0.42 + tx * reach * 0.18, y: mid.y - py * side * reach * 0.42 + ty * reach * 0.18 };
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.quadraticCurveTo((mid.x + fork.x) * 0.5 - px * side * 6, (mid.y + fork.y) * 0.5 - py * side * 6, fork.x, fork.y);
        ctx.lineWidth = 0.30;
        ctx.strokeStyle = 'rgba(199,245,255,.24)';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function activity(s, t, interacting) {
    if (interacting) return;
    const mobile = source?.clientWidth < 700;
    const count = s.compact || mobile ? 1 : 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < count; i += 1) {
      const duration = 2300 + s.seed * 1700 + i * 430;
      const p = between(s.from, s.to, 0.04 + (((t + s.seed * 900 + i * duration * 0.47) % duration) / duration) * 0.92);
      const r = s.compact ? 1 : 1.2 + hash(s.seed, i, 14) * 1.1;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(74,183,255,.055)'; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(240,253,255,.70)'; ctx.fill();
    }
    ctx.restore();
  }

  function drawFrame(t) {
    frame = requestAnimationFrame(drawFrame);
    if (!ctx || !layer || !source?.isConnected || document.hidden) return;
    const interacting = source.dataset.interacting === 'true';
    const wait = interacting ? 86 : 46;
    if (t - lastPaint < wait) return;
    lastPaint = t;
    const rect = source.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
    ctx.clearRect(0, 0, rect.width, rect.height);
    const centre = centrePoint();
    if (centre) hubMass(centre, t, interacting);
    for (const s of base) { ambientSheath(s, t, interacting); tendrils(s, t, interacting); activity(s, t, interacting); }
    for (const s of manual) { ambientSheath(s, t, interacting); tendrils(s, t, interacting); activity(s, t, interacting); }
    if (centre) sharedRoots(centre, t, interacting);
  }

  proto.beginPath = function (...args) {
    if (mainCanvas(this) || groupCanvas(this)) { this.__neuralMassStart = null; this.__neuralMassEnd = null; }
    return prevBegin.apply(this, args);
  };
  proto.moveTo = function (x, y, ...rest) {
    if (mainCanvas(this) || groupCanvas(this)) { this.__neuralMassStart = { x: Number(x), y: Number(y) }; this.__neuralMassEnd = null; }
    return prevMove.call(this, x, y, ...rest);
  };
  proto.lineTo = function (x, y, ...rest) {
    if ((mainCanvas(this) || groupCanvas(this)) && this.__neuralMassStart) this.__neuralMassEnd = { x: Number(x), y: Number(y) };
    return prevLine.call(this, x, y, ...rest);
  };
  proto.clearRect = function (...args) {
    if (mainCanvas(this)) base.length = 0;
    if (groupCanvas(this)) manual.length = 0;
    return prevClear.apply(this, args);
  };
  proto.stroke = function (...args) {
    if (mainCanvas(this) && blueLine(this) && Number(this.lineWidth || 1) <= 1.6) capture(this, false);
    else if (groupCanvas(this) && blueLine(this) && String(this.strokeStyle || '').includes('55, 139, 255')) capture(this, true);
    return prevStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralMassStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralMassStyles';
    style.textContent = '.memory-graph-neural-mass-canvas{position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;opacity:.98}';
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralMass = Object.freeze({
    version: VERSION,
    baseSegmentCount: () => base.length,
    manualSegmentCount: () => manual.length,
    redraw() { lastPaint = 0; }
  });
})();
