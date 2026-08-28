(() => {
  'use strict';

  const VERSION = 1;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralSynapseInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralSynapseInstalled', { value: true });

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
    const v = Math.sin(s * 8611.371 + a * 63.173 + b * 173.913) * 43758.5453;
    return v - Math.floor(v);
  };
  const isMain = (c) => c?.canvas?.classList?.contains('memory-graph-canvas') === true;
  const isManual = (c) => c?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  const isBlue = (c) => {
    if (!c?.__neuralSynapseStart || !c?.__neuralSynapseEnd) return false;
    const s = String(c.strokeStyle || '');
    return s.includes('120, 184, 255') || s.includes('55, 139, 255') || s.includes('241, 251, 255');
  };

  function ensureLayer(canvas) {
    if (!canvas?.parentElement) return false;
    if (!layer || source !== canvas || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-synapse-canvas';
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
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (layer.width !== pw || layer.height !== ph) {
      layer.width = pw;
      layer.height = ph;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layer.style.width = `${w}px`;
    layer.style.height = `${h}px`;
    if (!frame) frame = requestAnimationFrame(drawFrame);
    return true;
  }

  function projectPoints(c) {
    const a = c.__neuralSynapseStart;
    const b = c.__neuralSynapseEnd;
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

  function seedFor(a, b) {
    return Math.abs(Math.sin(a.x * 0.0137 + a.y * 0.0231 + b.x * 0.0103 + b.y * 0.0289));
  }

  function capture(c, compact) {
    const canvas = source || document.querySelector('.memory-graph-canvas');
    if (!canvas || !ensureLayer(canvas)) return;
    const pts = projectPoints(c);
    if (!pts) return;
    const length = Math.hypot(pts.to.x - pts.from.x, pts.to.y - pts.from.y);
    if (length < 5) return;
    const angle = Math.atan2(pts.to.y - pts.from.y, pts.to.x - pts.from.x);
    (compact ? manual : base).push({ ...pts, compact, length, angle, seed: seedFor(pts.from, pts.to) });
  }

  function centrePoint() {
    if (!base.length) return null;
    let x = 0;
    let y = 0;
    for (const s of base) { x += s.from.x; y += s.from.y; }
    return { x: x / base.length, y: y / base.length };
  }

  function curvePath(from, to, seed, lane = 0, bendScale = 1) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / len;
    const py = dx / len;
    const side = hash(seed, lane, 1) > 0.5 ? 1 : -1;
    const bend = side * clamp(len * (0.055 + hash(seed, lane, 2) * 0.08), 6, 54) * bendScale;
    const skew = (hash(seed, lane, 3) - 0.5) * 0.15;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(
      from.x + dx * (0.26 + skew) + px * bend * 0.70,
      from.y + dy * (0.26 + skew) + py * bend * 0.70,
      from.x + dx * (0.70 - skew) + px * bend,
      from.y + dy * (0.70 - skew) + py * bend,
      to.x,
      to.y
    );
  }

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  function glowBlob(point, radius, colorA, colorB, alpha, blurStretch = 1) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(point.x, point.y);
    ctx.scale(blurStretch, 1 / blurStretch);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    g.addColorStop(0, colorA.replace('ALPHA', (alpha).toFixed(3)));
    g.addColorStop(0.35, colorB.replace('ALPHA', (alpha * 0.68).toFixed(3)));
    g.addColorStop(1, 'rgba(14,62,196,0)');
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  function drawCentreFog(centre, t, interacting) {
    if (!centre) return;
    const mobile = source?.clientWidth < 700;
    const pulse = 0.92 + Math.sin(t * 0.0015) * 0.09;
    const radius = mobile ? 62 : 92;
    glowBlob(centre, radius, 'rgba(218,248,255,ALPHA)', 'rgba(60,166,255,ALPHA)', (interacting ? 0.035 : 0.07) * pulse, 1.15);
    if (!interacting) {
      glowBlob({ x: centre.x - radius * 0.30, y: centre.y + radius * 0.12 }, radius * 0.82, 'rgba(138,228,255,ALPHA)', 'rgba(44,120,255,ALPHA)', 0.040, 1.35);
      glowBlob({ x: centre.x + radius * 0.22, y: centre.y - radius * 0.18 }, radius * 0.72, 'rgba(154,231,255,ALPHA)', 'rgba(33,104,255,ALPHA)', 0.030, 1.22);
    }
  }

  function drawSegmentFog(segment, t, interacting) {
    const mobile = source?.clientWidth < 700;
    const hazeCount = interacting ? 1 : mobile ? 2 : 3;
    const stepBase = segment.compact ? 0.42 : 0.23;
    for (let i = 0; i < hazeCount; i += 1) {
      const seed = segment.seed + i * 0.371;
      const p = lerp(segment.from, segment.to, stepBase + i * 0.18 + hash(seed, 1, 2) * 0.06);
      const radius = clamp(segment.length * (segment.compact ? 0.08 : 0.12), segment.compact ? 10 : 18, segment.compact ? 20 : 36) * (1 + i * 0.20);
      glowBlob(p, radius, 'rgba(188,240,255,ALPHA)', 'rgba(43,128,255,ALPHA)', interacting ? 0.014 : 0.026, 1.25 + hash(seed, 3, 4) * 0.6);
    }
  }

  function drawSynapse(point, seed, t, scale = 1, warm = false) {
    const pulse = 0.78 + Math.sin(t * 0.0020 + seed * 19.0) * 0.18;
    const radius = (warm ? 10 : 13) * scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius);
    if (warm) {
      g.addColorStop(0, `rgba(255,248,236,${(0.28 * pulse).toFixed(3)})`);
      g.addColorStop(0.24, `rgba(255,170,110,${(0.16 * pulse).toFixed(3)})`);
      g.addColorStop(0.66, `rgba(96,195,255,${(0.10 * pulse).toFixed(3)})`);
      g.addColorStop(1, 'rgba(34,88,255,0)');
    } else {
      g.addColorStop(0, `rgba(240,252,255,${(0.24 * pulse).toFixed(3)})`);
      g.addColorStop(0.28, `rgba(131,223,255,${(0.15 * pulse).toFixed(3)})`);
      g.addColorStop(0.70, `rgba(48,126,255,${(0.10 * pulse).toFixed(3)})`);
      g.addColorStop(1, 'rgba(34,88,255,0)');
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(1.1, radius * 0.13), 0, Math.PI * 2);
    ctx.fillStyle = warm ? 'rgba(255,248,240,.85)' : 'rgba(248,253,255,.80)';
    ctx.fill();
    ctx.restore();
  }

  function drawSecondaryJunctions(segment, t, interacting) {
    if (interacting) return;
    const mobile = source?.clientWidth < 700;
    const count = segment.compact ? 1 : mobile ? 1 : 2;
    for (let i = 0; i < count; i += 1) {
      const seed = segment.seed + 4.1 + i * 0.61;
      const p = lerp(segment.from, segment.to, 0.18 + i * 0.22 + hash(seed, 1, 2) * 0.10);
      drawSynapse(p, seed, t, segment.compact ? 0.72 : 0.92 + i * 0.18, hash(seed, 3, 4) > 0.62);
    }
  }

  function drawCrossLinks(centre, t, interacting) {
    if (!centre || base.length < 2) return;
    const mobile = source?.clientWidth < 700;
    const maxGap = mobile ? 0.82 : 1.05;
    const sorted = [...base].sort((a, b) => a.angle - b.angle);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      let gap = b.angle - a.angle;
      if (i === sorted.length - 1) gap = (b.angle + Math.PI * 2) - a.angle;
      if (Math.abs(gap) > maxGap) continue;

      const seed = a.seed * 0.57 + b.seed * 0.43;
      const ap = lerp(a.from, a.to, 0.17 + hash(seed, 1, 5) * 0.18);
      const bp = lerp(b.from, b.to, 0.17 + hash(seed, 2, 6) * 0.18);
      curvePath(ap, bp, seed + 0.41, 7, 0.85);
      ctx.lineWidth = interacting ? 2.2 : 4.4;
      ctx.strokeStyle = interacting ? 'rgba(49,138,255,.025)' : 'rgba(52,141,255,.055)';
      ctx.stroke();
      if (!interacting) {
        curvePath(ap, bp, seed + 1.17, 13, 0.74);
        ctx.lineWidth = 0.45;
        ctx.strokeStyle = 'rgba(193,243,255,.20)';
        ctx.stroke();
      }

      const mid = lerp(ap, bp, 0.5);
      if (!interacting && hash(seed, 7, 8) > 0.45) drawSynapse(mid, seed + 3.7, t, 0.68, hash(seed, 9, 10) > 0.72);
    }

    if (!interacting && !mobile) {
      for (let i = 0; i < Math.min(3, sorted.length); i += 1) {
        const a = sorted[i];
        const b = sorted[(i + 2) % sorted.length];
        const seed = a.seed * 0.63 + b.seed * 0.37 + 7.7;
        const ap = lerp(a.from, a.to, 0.25 + hash(seed, 1, 1) * 0.12);
        const bp = lerp(b.from, b.to, 0.25 + hash(seed, 2, 2) * 0.12);
        curvePath(ap, bp, seed, 19, 0.62);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(37,126,255,.018)';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawMicroWeb(segment, t, interacting) {
    if (interacting) return;
    const mobile = source?.clientWidth < 700;
    if (segment.compact && mobile) return;
    const count = segment.compact ? 1 : mobile ? 2 : 4;
    const dx = segment.to.x - segment.from.x;
    const dy = segment.to.y - segment.from.y;
    const len = Math.max(1, Math.hypot(dx, dy));
    const tx = dx / len;
    const ty = dy / len;
    const px = -ty;
    const py = tx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i += 1) {
      const seed = segment.seed + 8.1 + i * 0.387;
      const origin = lerp(segment.from, segment.to, 0.24 + hash(seed, 1, 2) * 0.42);
      const side = hash(seed, 3, 4) > 0.5 ? 1 : -1;
      const reach = (segment.compact ? 10 : 16) + hash(seed, 5, 6) * (segment.compact ? 12 : 28);
      const drift = (hash(seed, 7, 8) - 0.5) * reach * 0.9;
      const end = { x: origin.x + px * side * reach + tx * drift, y: origin.y + py * side * reach + ty * drift };
      curvePath(origin, end, seed, 3, 0.42);
      ctx.lineWidth = 0.26;
      ctx.strokeStyle = 'rgba(194,243,255,.16)';
      ctx.stroke();
      if (!segment.compact && hash(seed, 9, 10) > 0.52) {
        const end2 = { x: end.x - px * side * reach * 0.48 + tx * reach * 0.10, y: end.y - py * side * reach * 0.48 + ty * reach * 0.10 };
        curvePath(end, end2, seed + 0.72, 5, 0.28);
        ctx.lineWidth = 0.18;
        ctx.strokeStyle = 'rgba(168,230,255,.12)';
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFrame(t) {
    frame = requestAnimationFrame(drawFrame);
    if (!ctx || !layer || !source?.isConnected || document.hidden) return;
    const interacting = source.dataset.interacting === 'true';
    const wait = interacting ? 96 : 52;
    if (t - lastPaint < wait) return;
    lastPaint = t;
    const rect = source.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
    ctx.clearRect(0, 0, rect.width, rect.height);

    const centre = centrePoint();
    drawCentreFog(centre, t, interacting);
    for (const s of base) {
      drawSegmentFog(s, t, interacting);
      drawSecondaryJunctions(s, t, interacting);
      drawMicroWeb(s, t, interacting);
    }
    for (const s of manual) {
      drawSegmentFog(s, t, interacting);
      drawSecondaryJunctions(s, t, interacting);
      drawMicroWeb(s, t, interacting);
    }
    drawCrossLinks(centre, t, interacting);
  }

  proto.beginPath = function (...args) {
    if (isMain(this) || isManual(this)) { this.__neuralSynapseStart = null; this.__neuralSynapseEnd = null; }
    return prevBegin.apply(this, args);
  };
  proto.moveTo = function (x, y, ...rest) {
    if (isMain(this) || isManual(this)) { this.__neuralSynapseStart = { x: Number(x), y: Number(y) }; this.__neuralSynapseEnd = null; }
    return prevMove.call(this, x, y, ...rest);
  };
  proto.lineTo = function (x, y, ...rest) {
    if ((isMain(this) || isManual(this)) && this.__neuralSynapseStart) this.__neuralSynapseEnd = { x: Number(x), y: Number(y) };
    return prevLine.call(this, x, y, ...rest);
  };
  proto.clearRect = function (...args) {
    if (isMain(this)) base.length = 0;
    if (isManual(this)) manual.length = 0;
    return prevClear.apply(this, args);
  };
  proto.stroke = function (...args) {
    if (isMain(this) && isBlue(this) && Number(this.lineWidth || 1) <= 1.6) capture(this, false);
    else if (isManual(this) && isBlue(this) && String(this.strokeStyle || '').includes('55, 139, 255')) capture(this, true);
    return prevStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralSynapseStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralSynapseStyles';
    style.textContent = '.memory-graph-neural-synapse-canvas{position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen;opacity:.92}';
    document.head.appendChild(style);
  }

  globalThis.MemoryGraphNeuralSynapse = Object.freeze({
    version: VERSION,
    baseSegmentCount: () => base.length,
    manualSegmentCount: () => manual.length,
    redraw() { lastPaint = 0; }
  });
})();
