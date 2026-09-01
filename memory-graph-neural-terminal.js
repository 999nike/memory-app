(() => {
  'use strict';

  const VERSION = 3;
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralTerminalInstalled) return;
  Object.defineProperty(proto, '__memoryGraphNeuralTerminalInstalled', { value: true });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousQuadraticCurveTo = proto.quadraticCurveTo;
  const previousClearRect = proto.clearRect;
  const previousStroke = proto.stroke;

  const pathState = new WeakMap();
  let captured = [];
  let layer = null;
  let layerContext = null;
  let sourceCanvas = null;
  let frame = 0;
  let lastPaint = 0;

  const FRAME_MS = 76;
  const INTERACTING_FRAME_MS = 180;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const hash = (seed, a = 0, b = 0) => {
    const value = Math.sin(seed * 7907.713 + a * 97.137 + b * 251.843) * 43758.5453;
    return value - Math.floor(value);
  };

  function isArmsCanvas(ctx) {
    return ctx?.canvas?.classList?.contains('memory-graph-neural-arms-canvas') === true;
  }

  function isMediumBranchSpine(ctx) {
    return isArmsCanvas(ctx) && String(ctx.strokeStyle || '').includes('207,240,255');
  }

  function ensureLayer() {
    const graph = document.querySelector('.memory-graph-canvas');
    if (!graph?.parentElement) return false;
    if (!layer || sourceCanvas !== graph || !layer.isConnected) {
      layer?.remove();
      layer = document.createElement('canvas');
      layer.className = 'memory-graph-neural-terminal-canvas';
      layer.setAttribute('aria-hidden', 'true');
      graph.parentElement.appendChild(layer);
      layerContext = layer.getContext('2d');
      sourceCanvas = graph;
    }
    if (!layerContext) return false;

    const rect = graph.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, graph.width / Math.max(1, width));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (layer.width !== pixelWidth || layer.height !== pixelHeight) {
      layer.width = pixelWidth;
      layer.height = pixelHeight;
      layerContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    layer.style.width = `${width}px`;
    layer.style.height = `${height}px`;
    if (!frame) frame = requestAnimationFrame(drawFrame);
    return true;
  }

  function recordPoint(ctx, x, y) {
    if (!isArmsCanvas(ctx)) return;
    const state = pathState.get(ctx) || [];
    state.push({ x: Number(x), y: Number(y) });
    pathState.set(ctx, state);
  }

  function captureMediumBranch(ctx) {
    if (!isMediumBranchSpine(ctx)) return;
    const points = pathState.get(ctx);
    if (!Array.isArray(points) || points.length < 5) return;

    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    if (length < 12) return;

    const first = points[0];
    const last = points[points.length - 1];
    const seed = Math.abs(Math.sin(first.x * 0.017 + first.y * 0.023 + last.x * 0.031 + last.y * 0.013));
    captured.push({
      points: points.map((point) => ({ ...point })),
      length,
      width: clamp(length * 0.028, 2.2, 5.2),
      seed
    });
    ensureLayer();
  }

  function tangent(points, index) {
    const a = points[Math.max(0, index - 1)];
    const b = points[Math.min(points.length - 1, index + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return { x: dx / length, y: dy / length };
  }

  function traceSmooth(ctx, points, close = false) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    const limit = close ? points.length + 1 : points.length;
    for (let index = 1; index < limit; index += 1) {
      const current = points[index % points.length];
      const next = points[(index + 1) % points.length];
      if (!close && index === points.length - 1) {
        ctx.lineTo(current.x, current.y);
        break;
      }
      ctx.quadraticCurveTo(current.x, current.y, (current.x + next.x) * 0.5, (current.y + next.y) * 0.5);
    }
    if (close) ctx.closePath();
  }

  function buildTail(branch) {
    const source = branch.points;
    const startIndex = Math.max(1, Math.floor((source.length - 1) * 0.66));
    const centre = source.slice(startIndex).map((point) => ({ ...point }));
    const oldEnd = centre[centre.length - 1];
    const endTangent = tangent(source, source.length - 1);
    const nx = -endTangent.y;
    const ny = endTangent.x;
    const side = hash(branch.seed, 1, 2) > 0.5 ? 1 : -1;
    const extension = branch.width * (3.4 + hash(branch.seed, 3, 4) * 2.8);
    const steps = 9;

    for (let index = 1; index <= steps; index += 1) {
      const u = index / steps;
      const bend = Math.sin(Math.PI * u) * extension * (0.055 + hash(branch.seed, 5, 6) * 0.055) * side;
      centre.push({
        x: oldEnd.x + endTangent.x * extension * u + nx * bend,
        y: oldEnd.y + endTangent.y * extension * u + ny * bend
      });
    }

    const left = [];
    const right = [];
    const sourceCount = source.length - startIndex;
    for (let index = 0; index < centre.length; index += 1) {
      const t = tangent(centre, index);
      const px = -t.y;
      const py = t.x;
      let half;
      if (index < sourceCount) {
        const u = index / Math.max(1, sourceCount - 1);
        half = branch.width * (0.58 - u * 0.35);
      } else {
        const u = (index - sourceCount + 1) / Math.max(1, centre.length - sourceCount);
        half = branch.width * (0.23 * Math.pow(1 - u, 0.76) + 0.008);
      }
      const ripple = 1 + Math.sin((index / Math.max(1, centre.length - 1)) * Math.PI * 4.2 + branch.seed * 8.7) * 0.06;
      half *= ripple;
      left.push({ x: centre[index].x + px * half, y: centre[index].y + py * half });
      right.push({ x: centre[index].x - px * half, y: centre[index].y - py * half });
    }
    return { centre, left, right, width: branch.width, seed: branch.seed, sourceCount };
  }

  function drawTail(ctx, branch) {
    const tail = buildTail(branch);
    const body = [...tail.left, ...tail.right.slice().reverse()];
    const sourceEndIndex = Math.max(1, tail.sourceCount - 1);
    const coverPoints = tail.centre.slice(0, sourceEndIndex + 1);
    const first = tail.centre[0];
    const last = tail.centre[tail.centre.length - 1];

    // Exact-path cover: hide the old purple blunt terminal before laying the taper over it.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, coverPoints);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2.0, tail.width * 1.28);
    ctx.strokeStyle = 'rgba(8,27,76,.68)';
    previousStroke.call(ctx);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    traceSmooth(ctx, body, true);
    ctx.fillStyle = 'rgba(11,36,99,.38)';
    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(56,96,244,.20)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    traceSmooth(ctx, body, true);
    const tissue = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
    tissue.addColorStop(0, 'rgba(100,96,250,.36)');
    tissue.addColorStop(0.42, 'rgba(67,132,248,.31)');
    tissue.addColorStop(0.78, 'rgba(54,170,246,.22)');
    tissue.addColorStop(1, 'rgba(52,160,232,.02)');
    ctx.fillStyle = tissue;
    ctx.fill();

    traceSmooth(ctx, tail.centre);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.20, tail.width * 0.052);
    ctx.strokeStyle = 'rgba(224,249,255,.62)';
    previousStroke.call(ctx);

    const forkBaseIndex = Math.max(1, tail.centre.length - 4);
    const forkBase = tail.centre[forkBaseIndex];
    const t = tangent(tail.centre, forkBaseIndex);
    const nx = -t.y;
    const ny = t.x;
    for (const side of [-1, 1]) {
      const reach = tail.width * (1.45 + hash(tail.seed, side, 8) * 1.35);
      const end = {
        x: forkBase.x + t.x * reach * 0.70 + nx * side * reach * 0.56,
        y: forkBase.y + t.y * reach * 0.70 + ny * side * reach * 0.56
      };
      ctx.beginPath();
      ctx.moveTo(forkBase.x, forkBase.y);
      ctx.quadraticCurveTo(
        forkBase.x + t.x * reach * 0.34 + nx * side * reach * 0.17,
        forkBase.y + t.y * reach * 0.34 + ny * side * reach * 0.17,
        end.x,
        end.y
      );
      ctx.lineWidth = 0.20;
      ctx.strokeStyle = 'rgba(132,207,255,.21)';
      previousStroke.call(ctx);
    }
    ctx.restore();
  }

  function drawFrame(timestamp) {
    frame = requestAnimationFrame(drawFrame);
    if (!layerContext || !layer || !sourceCanvas?.isConnected || document.hidden) return;
    const interacting = sourceCanvas.dataset.interacting === 'true';
    const frameMs = interacting ? INTERACTING_FRAME_MS : FRAME_MS;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;
    const rect = sourceCanvas.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;
    layerContext.clearRect(0, 0, rect.width, rect.height);
    if (interacting) return;
    for (const branch of captured) drawTail(layerContext, branch);
  }

  proto.beginPath = function neuralTerminalBeginPath(...args) {
    if (isArmsCanvas(this)) pathState.set(this, []);
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function neuralTerminalMoveTo(x, y, ...rest) {
    recordPoint(this, x, y);
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function neuralTerminalLineTo(x, y, ...rest) {
    recordPoint(this, x, y);
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.quadraticCurveTo = function neuralTerminalQuadraticCurveTo(cpx, cpy, x, y, ...rest) {
    recordPoint(this, x, y);
    return previousQuadraticCurveTo.call(this, cpx, cpy, x, y, ...rest);
  };

  proto.clearRect = function neuralTerminalClearRect(...args) {
    if (isArmsCanvas(this)) captured = [];
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function neuralTerminalStroke(...args) {
    captureMediumBranch(this);
    return previousStroke.apply(this, args);
  };

  if (!document.getElementById('memoryGraphNeuralTerminalStyles')) {
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralTerminalStyles';
    style.textContent = `
      .memory-graph-neural-terminal-canvas {
        position:absolute;
        inset:0;
        z-index:3;
        display:block;
        width:100%;
        height:100%;
        pointer-events:none;
        mix-blend-mode:screen;
        opacity:.94;
      }
    `;
    document.head.appendChild(style);
  }

  ensureLayer();
  globalThis.MemoryGraphNeuralTerminal = Object.freeze({ version: VERSION, redraw() { lastPaint = 0; } });
  globalThis.MemoryGraph?.redraw?.();
})();