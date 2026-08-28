(() => {
  'use strict';

  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__memoryGraphNeuralLinksInstalled) return;

  Object.defineProperty(proto, '__memoryGraphNeuralLinksInstalled', {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const previousBeginPath = proto.beginPath;
  const previousMoveTo = proto.moveTo;
  const previousLineTo = proto.lineTo;
  const previousArc = proto.arc;
  const previousFill = proto.fill;
  const previousStroke = proto.stroke;
  const previousClearRect = proto.clearRect;

  const VERSION = 5;
  const POINT_EPSILON = 6;
  const MAX_TOP_BRANCHES = 6;
  const MAX_GROUP_BRANCHES = 6;
  const AMBIENT_POINT_COUNT = 34;

  let surface = null;
  let graphCanvas = null;
  let canvas = null;
  let gl = null;
  let program = null;
  let positionBuffer = null;
  let colourBuffer = null;
  let positionLocation = -1;
  let colourLocation = -1;
  let resolutionLocation = null;
  let renderFrame = 0;
  let lastSignature = '';
  let lastWidth = 0;
  let lastHeight = 0;
  let supported = false;

  let coreSegments = [];
  let manualSegments = [];
  let coreCircles = [];
  let manualCircles = [];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(seed, a = 0, b = 0) {
    const value = Math.sin((Number(seed) || 0) * 9187.133 + a * 73.731 + b * 193.771) * 43758.5453;
    return value - Math.floor(value);
  }

  function segmentSeed(from, to, salt = 0) {
    const raw = Number(from?.x || 0) * 0.013 + Number(from?.y || 0) * 0.017
      + Number(to?.x || 0) * 0.019 + Number(to?.y || 0) * 0.023 + salt * 0.071;
    return Math.abs(Math.sin(raw * 13.731));
  }

  function isCoreGraph(context) {
    return context?.canvas?.classList?.contains('memory-graph-canvas') === true;
  }

  function isManualGravity(context) {
    return context?.canvas?.classList?.contains('memory-graph-manual-gravity-canvas') === true;
  }

  function styleAlpha(style, fallback = 1) {
    const match = String(style || '').match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/i);
    if (!match) return fallback;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : fallback;
  }

  function isCoreConnector(context) {
    if (!isCoreGraph(context) || !context.__brainPathStart || !context.__brainPathEnd || context.__brainLastArc) return false;
    const style = String(context.strokeStyle || '');
    const width = Math.max(0, Number(context.lineWidth) || 0);
    return width <= 1.6 && style.includes('120, 184, 255');
  }

  function manualTracePass(context) {
    if (!isManualGravity(context) || !context.__brainPathStart || !context.__brainPathEnd || context.__brainLastArc) return '';
    const style = String(context.strokeStyle || '');
    const alpha = styleAlpha(style);
    if (style.includes('55, 139, 255') && alpha <= 0.14) return 'capture';
    if (style.includes('120, 184, 255') && alpha >= 0.36 && alpha <= 0.44) return 'suppress';
    if (style.includes('241, 251, 255') && alpha >= 0.82) return 'suppress';
    return '';
  }

  function normalisedTransform(context) {
    const target = context?.canvas;
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    const dpr = Math.max(1, target.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    return { matrix, dpr };
  }

  function screenPoint(context, point) {
    const transform = normalisedTransform(context);
    if (!transform || !point) return null;
    const { matrix, dpr } = transform;
    return {
      x: (matrix.a * point.x + matrix.c * point.y + matrix.e) / dpr,
      y: (matrix.b * point.x + matrix.d * point.y + matrix.f) / dpr
    };
  }

  function screenRadius(context, radius) {
    const transform = normalisedTransform(context);
    if (!transform) return Math.max(1, Number(radius) || 1);
    const { matrix, dpr } = transform;
    const scaleX = Math.hypot(matrix.a, matrix.b) / dpr;
    const scaleY = Math.hypot(matrix.c, matrix.d) / dpr;
    return Math.max(1, Number(radius || 1) * ((scaleX + scaleY) * 0.5));
  }

  function near(a, b, epsilon = POINT_EPSILON) {
    return Boolean(a && b && Math.hypot(a.x - b.x, a.y - b.y) <= epsilon);
  }

  function captureSegment(context, target, reverse = false, widthScale = 1) {
    const start = screenPoint(context, context.__brainPathStart);
    const end = screenPoint(context, context.__brainPathEnd);
    if (!start || !end) return;
    const from = reverse ? end : start;
    const to = reverse ? start : end;
    if (Math.hypot(to.x - from.x, to.y - from.y) < 8) return;
    target.push({
      from,
      to,
      seed: segmentSeed(from, to, target.length + widthScale),
      widthScale: clamp(Number(widthScale) || 1, 0.45, 1.5)
    });
    scheduleRender();
  }

  function captureCircle(context, target) {
    const arc = context.__brainLastArc;
    if (!arc) return;
    const point = screenPoint(context, arc);
    if (!point) return;
    const radius = screenRadius(context, arc.radius);
    if (!Number.isFinite(radius) || radius < 2) return;
    target.push({
      x: point.x,
      y: point.y,
      radius,
      seed: Math.abs(Math.sin(point.x * 0.019 + point.y * 0.027 + radius * 0.071))
    });
    scheduleRender();
  }

  function installStyles() {
    if (document.getElementById('memoryGraphWebGLBrainStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphWebGLBrainStyles';
    style.textContent = `
      .memory-graph-spark-canvas,
      .memory-graph-neural-canvas,
      .memory-graph-dendrite-canvas,
      .memory-graph-neural-svg { display:none !important; }
      .memory-graph-webgl-brain-canvas {
        position:absolute;
        inset:0;
        z-index:1;
        width:100%;
        height:100%;
        display:block;
        pointer-events:none;
      }
      .memory-graph-manual-gravity-canvas { z-index:2 !important; }
      .memory-graph-canvas { z-index:3 !important; }
    `;
    document.head.appendChild(style);
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'Shader compile failed';
      gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  function createProgram() {
    const vertex = compileShader(gl.VERTEX_SHADER, `#version 300 es
      in vec2 a_position;
      in vec4 a_colour;
      uniform vec2 u_resolution;
      out vec4 v_colour;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clip = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
        v_colour = a_colour;
      }
    `);
    const fragment = compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision mediump float;
      in vec4 v_colour;
      out vec4 outColour;
      void main() {
        outColour = v_colour;
      }
    `);
    const nextProgram = gl.createProgram();
    gl.attachShader(nextProgram, vertex);
    gl.attachShader(nextProgram, fragment);
    gl.linkProgram(nextProgram);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(nextProgram, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(nextProgram) || 'Program link failed';
      gl.deleteProgram(nextProgram);
      throw new Error(info);
    }
    return nextProgram;
  }

  function ensureLayer() {
    surface = surface || document.getElementById('memoryGraphSurface');
    graphCanvas = graphCanvas || document.querySelector('.memory-graph-canvas');
    if (!surface) return false;

    if (!canvas || !canvas.isConnected) {
      canvas = document.createElement('canvas');
      canvas.className = 'memory-graph-webgl-brain-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      const manualOverlay = surface.querySelector('.memory-graph-manual-gravity-canvas');
      if (manualOverlay) surface.insertBefore(canvas, manualOverlay);
      else if (graphCanvas) surface.insertBefore(canvas, graphCanvas);
      else surface.appendChild(canvas);
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance'
      });
      supported = Boolean(gl);
      if (!gl) return false;
      try {
        program = createProgram();
      } catch (error) {
        console.warn('[MemoryGraphWebGL] renderer unavailable', error);
        supported = false;
        return false;
      }
      positionBuffer = gl.createBuffer();
      colourBuffer = gl.createBuffer();
      positionLocation = gl.getAttribLocation(program, 'a_position');
      colourLocation = gl.getAttribLocation(program, 'a_colour');
      resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
    }

    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      lastSignature = '';
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    lastWidth = width;
    lastHeight = height;
    return true;
  }

  function deriveClusters() {
    const trunks = [];
    for (let index = 0; index < manualSegments.length; index += 1) {
      const candidate = manualSegments[index];
      const hasChildren = manualSegments.some((other, otherIndex) => otherIndex !== index && near(candidate.to, other.from));
      if (!hasChildren) continue;
      if (trunks.some((item) => near(item.to, candidate.to) && near(item.from, candidate.from))) continue;
      trunks.push(candidate);
    }
    return trunks.map((trunk, trunkIndex) => ({
      trunk,
      centre: trunk.to,
      seed: trunk.seed + trunkIndex * 0.173,
      children: manualSegments.filter((segment) => segment !== trunk && near(segment.from, trunk.to))
    }));
  }

  function groupedChildPoints(clusters) {
    return clusters.flatMap((cluster) => cluster.children.map((child) => child.to));
  }

  function isGroupedCoreSegment(segment, childPoints) {
    return childPoints.some((point) => near(segment.from, point, 8) || near(segment.to, point, 8));
  }

  function bodyCircles() {
    const deduped = [];
    for (const circle of coreCircles) {
      const existing = deduped.find((item) => near(item, circle, 2.5) && Math.abs(item.radius - circle.radius) < 1.5);
      if (!existing) deduped.push(circle);
    }
    return deduped;
  }

  function groupBodyCircle(cluster) {
    const candidates = manualCircles
      .filter((circle) => near(circle, cluster.centre, 4))
      .sort((a, b) => a.radius - b.radius);
    if (!candidates.length) {
      const count = Math.max(1, cluster.children.length);
      return { ...cluster.centre, radius: 34 + Math.min(20, Math.sqrt(count) * 6.6), seed: cluster.seed };
    }
    if (candidates.length === 1) return candidates[0];
    return candidates[0].radius > candidates[candidates.length - 1].radius * 0.82
      ? candidates[0]
      : candidates[candidates.length - 2] || candidates[0];
  }

  function hubPoint(visibleCore, clusters, circles) {
    if (visibleCore.length) return visibleCore[0].to;
    if (clusters.length) return clusters[0].trunk.from;
    return circles.slice().sort((a, b) => b.radius - a.radius)[0] || { x: lastWidth * 0.5, y: lastHeight * 0.5 };
  }

  function bezierPoints(from, to, seed, bendScale = 1, count = 13) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const bend = (hashUnit(seed, 2, 7) * 2 - 1) * clamp(length * 0.16, 8, 58) * bendScale;
    const skew = (hashUnit(seed, 8, 3) * 2 - 1) * clamp(length * 0.05, 2, 16);
    const c1 = {
      x: from.x + dx * 0.29 + px * (bend + skew),
      y: from.y + dy * 0.29 + py * (bend + skew)
    };
    const c2 = {
      x: from.x + dx * 0.71 - px * (bend * 0.68 - skew * 0.30),
      y: from.y + dy * 0.71 - py * (bend * 0.68 - skew * 0.30)
    };
    const points = [];
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      const mt = 1 - t;
      const baseX = mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x;
      const baseY = mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y;
      const organic = (Math.sin(t * Math.PI * (1.6 + hashUnit(seed, 4, 5) * 1.5) + seed * 21.7)
        + Math.sin(t * Math.PI * (4.1 + hashUnit(seed, 9, 2) * 2.2) + seed * 9.4) * 0.32)
        * Math.sin(Math.PI * t) * clamp(length * 0.006, 0.4, 2.8);
      points.push({ x: baseX + px * organic, y: baseY + py * organic });
    }
    return points;
  }

  function colour(r, g, b, a) {
    return [r / 255, g / 255, b / 255, clamp(a, 0, 1)];
  }

  function pushVertex(positions, colours, point, rgba) {
    positions.push(point.x, point.y);
    colours.push(rgba[0], rgba[1], rgba[2], rgba[3]);
  }

  function appendTube(positions, colours, points, startWidth, endWidth, rgba, seed = 0) {
    if (!points || points.length < 2) return;
    const left = [];
    const right = [];
    const count = points.length - 1;
    for (let index = 0; index < points.length; index += 1) {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const dx = after.x - before.x;
      const dy = after.y - before.y;
      const length = Math.max(0.001, Math.hypot(dx, dy));
      const px = -dy / length;
      const py = dx / length;
      const t = index / Math.max(1, count);
      const taper = startWidth + (endWidth - startWidth) * t;
      const wobble = 0.88 + hashUnit(seed, index, 17) * 0.24;
      const half = Math.max(0.18, taper * wobble * 0.5);
      left.push({ x: points[index].x + px * half, y: points[index].y + py * half });
      right.push({ x: points[index].x - px * half, y: points[index].y - py * half });
    }
    for (let index = 0; index < count; index += 1) {
      pushVertex(positions, colours, left[index], rgba);
      pushVertex(positions, colours, right[index], rgba);
      pushVertex(positions, colours, left[index + 1], rgba);
      pushVertex(positions, colours, right[index], rgba);
      pushVertex(positions, colours, right[index + 1], rgba);
      pushVertex(positions, colours, left[index + 1], rgba);
    }
  }

  function appendGlowDisc(positions, colours, point, radius, inner, outer, segments = 24, irregularSeed = 0) {
    const centre = { x: point.x, y: point.y };
    for (let index = 0; index < segments; index += 1) {
      const a0 = (index / segments) * Math.PI * 2;
      const a1 = ((index + 1) / segments) * Math.PI * 2;
      const r0 = radius * (0.93 + hashUnit(irregularSeed, index, 3) * 0.14);
      const r1 = radius * (0.93 + hashUnit(irregularSeed, index + 1, 3) * 0.14);
      pushVertex(positions, colours, centre, inner);
      pushVertex(positions, colours, { x: point.x + Math.cos(a0) * r0, y: point.y + Math.sin(a0) * r0 }, outer);
      pushVertex(positions, colours, { x: point.x + Math.cos(a1) * r1, y: point.y + Math.sin(a1) * r1 }, outer);
    }
  }

  function appendSoma(positions, colours, point, radius, seed, role = 'memory') {
    const hub = role === 'hub';
    const group = role === 'group';
    const glowRadius = radius * (hub ? 1.65 : group ? 1.48 : 1.55);
    appendGlowDisc(
      positions,
      colours,
      point,
      glowRadius,
      hub ? colour(68, 162, 255, 0.18) : colour(142, 223, 92, 0.12),
      colour(20, 65, 106, 0),
      28,
      seed
    );

    const bodyRadius = radius * (hub ? 1.02 : group ? 0.98 : 0.78);
    appendGlowDisc(
      positions,
      colours,
      point,
      bodyRadius,
      hub ? colour(48, 116, 198, 0.92) : colour(42, 112, 88, 0.82),
      hub ? colour(28, 74, 138, 0.56) : colour(50, 105, 60, 0.42),
      30,
      seed + 0.31
    );

    appendGlowDisc(
      positions,
      colours,
      { x: point.x - radius * 0.13, y: point.y - radius * 0.12 },
      radius * (hub ? 0.54 : group ? 0.48 : 0.34),
      hub ? colour(224, 250, 255, 0.86) : colour(200, 255, 126, 0.68),
      hub ? colour(78, 182, 255, 0.10) : colour(93, 201, 157, 0.08),
      24,
      seed + 0.77
    );

    if (hub || group) {
      appendGlowDisc(
        positions,
        colours,
        point,
        radius * 0.18,
        group ? colour(255, 211, 102, 0.66) : colour(239, 253, 255, 0.82),
        colour(92, 192, 255, 0),
        20,
        seed + 1.17
      );
    }
  }

  function addSynapse(positions, colours, point, seed, warmChance = 0.15, scale = 1) {
    const warm = hashUnit(seed, 14, 7) < warmChance;
    const radius = (warm ? 4.8 : 3.6) * scale;
    appendGlowDisc(
      positions,
      colours,
      point,
      radius * 2.2,
      warm ? colour(255, 176, 76, 0.15) : colour(83, 192, 255, 0.12),
      colour(20, 60, 100, 0),
      18,
      seed
    );
    appendGlowDisc(
      positions,
      colours,
      point,
      radius,
      warm ? colour(255, 235, 180, 0.88) : colour(220, 251, 255, 0.74),
      warm ? colour(255, 162, 52, 0.05) : colour(79, 177, 243, 0.05),
      16,
      seed + 0.2
    );
  }

  function addDendrite(positions, colours, from, to, seed, widths, options = {}) {
    const points = bezierPoints(from, to, seed, Number(options.bendScale) || 1, options.count || 13);
    const body = options.body || colour(76, 179, 232, 0.58);
    appendTube(positions, colours, points, widths[0] * 2.8, widths[1] * 2.8, colour(38, 119, 221, 0.055), seed + 0.13);
    appendTube(positions, colours, points, widths[0], widths[1], body, seed + 0.29);

    const start = Math.max(1, Math.floor(points.length * 0.20));
    const end = Math.min(points.length - 1, Math.ceil(points.length * 0.48));
    const corePoints = points.slice(start, end + 1);
    if (corePoints.length > 1) {
      appendTube(positions, colours, corePoints, widths[0] * 0.19, widths[1] * 0.15, colour(223, 248, 255, 0.54), seed + 0.47);
    }
    if (points.length > 8 && hashUnit(seed, 5, 11) > 0.48) {
      const secondStart = Math.floor(points.length * 0.70);
      const secondEnd = Math.min(points.length - 1, secondStart + Math.max(2, Math.floor(points.length * 0.14)));
      const second = points.slice(secondStart, secondEnd + 1);
      if (second.length > 1) appendTube(positions, colours, second, widths[0] * 0.12, widths[1] * 0.10, colour(230, 249, 255, 0.34), seed + 0.66);
    }

    if (options.synapse) addSynapse(positions, colours, to, seed + 0.81, Number(options.warmChance) || 0.12, Number(options.synapseScale) || 1);
    return points;
  }

  function averageTarget(origin, targets) {
    let vx = 0;
    let vy = 0;
    let distance = 0;
    for (const target of targets) {
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      vx += dx / len;
      vy += dy / len;
      distance += len;
    }
    const norm = Math.max(0.001, Math.hypot(vx, vy));
    return { ux: vx / norm, uy: vy / norm, distance: distance / Math.max(1, targets.length) };
  }

  function angleGroups(origin, targets, maxBranches) {
    if (!targets.length) return [];
    const sorted = targets.slice().sort((a, b) => Math.atan2(a.y - origin.y, a.x - origin.x) - Math.atan2(b.y - origin.y, b.x - origin.x));
    const count = sorted.length === 1 ? 1 : clamp(Math.round(Math.sqrt(sorted.length) + 0.8), 2, maxBranches);
    const groups = Array.from({ length: count }, () => []);
    for (let index = 0; index < sorted.length; index += 1) {
      groups[Math.min(count - 1, Math.floor(index * count / sorted.length))].push(sorted[index]);
    }
    return groups.filter((items) => items.length);
  }

  function addBranchTree(positions, colours, origin, targets, seed, options = {}) {
    if (!targets.length) return;
    const groups = angleGroups(origin, targets, Number(options.maxBranches) || 5);
    const rootWidth = Number(options.rootWidth) || 8;
    const terminalWidth = Number(options.terminalWidth) || 1.2;
    const body = options.body || colour(72, 173, 230, 0.58);

    groups.forEach((items, branchIndex) => {
      const average = averageTarget(origin, items);
      const perpendicular = { x: -average.uy, y: average.ux };
      const reach = clamp(average.distance * (items.length > 2 ? 0.36 : 0.44), 34, options.groupTree ? 88 : 132);
      const skew = (hashUnit(seed, branchIndex, 9) * 2 - 1) * clamp(reach * 0.18, 4, 18);
      const junction = {
        x: origin.x + average.ux * reach + perpendicular.x * skew,
        y: origin.y + average.uy * reach + perpendicular.y * skew
      };
      const branchSeed = seed + 0.31 + branchIndex * 0.271;
      const rootEndWidth = rootWidth * (items.length > 2 ? 0.54 : 0.42);
      addDendrite(positions, colours, origin, junction, branchSeed, [rootWidth, rootEndWidth], {
        bendScale: 1.08,
        body,
        synapse: true,
        warmChance: 0.08,
        synapseScale: 0.75
      });

      if (items.length <= 2) {
        items.forEach((target, index) => {
          addDendrite(positions, colours, junction, target, branchSeed + 0.17 + index * 0.149, [rootEndWidth, terminalWidth], {
            bendScale: 0.74,
            body,
            synapse: true,
            warmChance: 0.20,
            synapseScale: 0.82
          });
        });
        return;
      }

      const splitCount = Math.min(2, Math.ceil(items.length / 3));
      const splitGroups = Array.from({ length: splitCount }, () => []);
      items.forEach((target, index) => splitGroups[Math.min(splitCount - 1, Math.floor(index * splitCount / items.length))].push(target));
      splitGroups.forEach((splitItems, splitIndex) => {
        const splitAverage = averageTarget(junction, splitItems);
        const splitPerp = { x: -splitAverage.uy, y: splitAverage.ux };
        const splitReach = clamp(splitAverage.distance * 0.48, 24, options.groupTree ? 64 : 86);
        const splitSkew = (hashUnit(branchSeed, splitIndex, 13) * 2 - 1) * clamp(splitReach * 0.16, 3, 12);
        const split = {
          x: junction.x + splitAverage.ux * splitReach + splitPerp.x * splitSkew,
          y: junction.y + splitAverage.uy * splitReach + splitPerp.y * splitSkew
        };
        const splitSeed = branchSeed + 0.63 + splitIndex * 0.233;
        const splitEndWidth = Math.max(2.0, rootEndWidth * 0.58);
        addDendrite(positions, colours, junction, split, splitSeed, [rootEndWidth, splitEndWidth], {
          bendScale: 0.86,
          body,
          synapse: true,
          warmChance: 0.10,
          synapseScale: 0.70
        });
        splitItems.forEach((target, terminalIndex) => {
          addDendrite(positions, colours, split, target, splitSeed + 0.21 + terminalIndex * 0.137, [splitEndWidth, terminalWidth], {
            bendScale: 0.66,
            body,
            synapse: true,
            warmChance: 0.22,
            synapseScale: 0.80
          });
        });
      });
    });
  }

  function ambientNetwork(positions, colours, width, height) {
    const points = Array.from({ length: AMBIENT_POINT_COUNT }, (_, index) => ({
      x: width * (0.035 + hashUnit(index + 1, 2, 4) * 0.93),
      y: height * (0.055 + hashUnit(index + 1, 7, 11) * 0.89),
      seed: index * 0.193 + 0.41
    }));

    const links = [];
    for (let i = 0; i < points.length; i += 1) {
      const neighbours = [];
      for (let j = 0; j < points.length; j += 1) {
        if (i === j) continue;
        const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
        if (distance > 55 && distance < Math.min(310, width * 0.28)) neighbours.push({ point: points[j], distance, index: j });
      }
      neighbours.sort((a, b) => a.distance - b.distance);
      for (const neighbour of neighbours.slice(0, 2)) {
        const a = Math.min(i, neighbour.index);
        const b = Math.max(i, neighbour.index);
        const key = `${a}:${b}`;
        if (links.some((link) => link.key === key)) continue;
        links.push({ key, from: points[i], to: neighbour.point, seed: points[i].seed + neighbour.index * 0.071 });
      }
    }

    for (const link of links) {
      const lineWidth = 0.75 + hashUnit(link.seed, 3, 8) * 1.15;
      addDendrite(positions, colours, link.from, link.to, link.seed, [lineWidth, Math.max(0.25, lineWidth * 0.42)], {
        bendScale: 1.15,
        body: colour(69, 139, 199, 0.085),
        synapse: hashUnit(link.seed, 9, 4) > 0.88,
        warmChance: 0.12,
        synapseScale: 0.48
      });
    }

    for (let index = 0; index < points.length; index += 3) {
      const point = points[index];
      appendSoma(positions, colours, point, 5.2 + hashUnit(point.seed, 5, 7) * 4.2, point.seed, 'memory');
    }
  }

  function sceneSignature() {
    const q = (value) => Math.round(Number(value || 0) * 2) / 2;
    const segment = (item) => `${q(item.from.x)},${q(item.from.y)},${q(item.to.x)},${q(item.to.y)}`;
    const circle = (item) => `${q(item.x)},${q(item.y)},${q(item.radius)}`;
    return `${lastWidth}x${lastHeight}|${coreSegments.map(segment).join('|')}::${manualSegments.map(segment).join('|')}::${coreCircles.map(circle).join('|')}::${manualCircles.map(circle).join('|')}`;
  }

  function renderScene() {
    renderFrame = 0;
    if (!ensureLayer() || !supported || !gl || !program) return;
    const signature = sceneSignature();
    if (signature === lastSignature) return;
    lastSignature = signature;

    const clusters = deriveClusters();
    const childPoints = groupedChildPoints(clusters);
    const visibleCore = coreSegments.filter((segment) => !isGroupedCoreSegment(segment, childPoints));
    const circles = bodyCircles();
    const hub = hubPoint(visibleCore, clusters, circles);
    const hubCircle = circles.slice().sort((a, b) => b.radius - a.radius)[0] || { ...hub, radius: 40, seed: 0.91 };

    const positions = [];
    const colours = [];
    ambientNetwork(positions, colours, lastWidth, lastHeight);

    const topTargets = [];
    visibleCore.forEach((segment, index) => {
      if (Math.hypot(segment.from.x - hub.x, segment.from.y - hub.y) < 18) return;
      topTargets.push({ x: segment.from.x, y: segment.from.y, seed: segment.seed + index * 0.17, kind: 'memory' });
    });
    clusters.forEach((cluster, index) => {
      topTargets.push({ x: cluster.centre.x, y: cluster.centre.y, seed: cluster.seed + index * 0.23, kind: 'group' });
    });

    addBranchTree(positions, colours, hub, topTargets, 0.731, {
      maxBranches: MAX_TOP_BRANCHES,
      rootWidth: clamp(hubCircle.radius * 0.21, 7.2, 11.5),
      terminalWidth: 1.15,
      body: colour(74, 174, 232, 0.62)
    });

    appendSoma(positions, colours, hub, clamp(hubCircle.radius, 30, 52), hubCircle.seed + 0.8, 'hub');

    const groupedEndpointSet = new Set();
    for (const cluster of clusters) {
      const groupCircle = groupBodyCircle(cluster);
      appendSoma(positions, colours, cluster.centre, clamp(groupCircle.radius, 30, 66), cluster.seed, 'group');
      const targets = cluster.children.map((child, index) => {
        groupedEndpointSet.add(`${Math.round(child.to.x)}:${Math.round(child.to.y)}`);
        return { x: child.to.x, y: child.to.y, seed: child.seed + index * 0.11, kind: 'child' };
      });
      addBranchTree(positions, colours, cluster.centre, targets, cluster.seed + 0.49, {
        maxBranches: MAX_GROUP_BRANCHES,
        rootWidth: clamp(groupCircle.radius * 0.17, 5.6, 9.4),
        terminalWidth: 0.82,
        body: colour(79, 184, 226, 0.57),
        groupTree: true
      });
    }

    for (const circle of circles) {
      if (near(circle, hub, Math.max(10, circle.radius * 0.35))) continue;
      const groupMatch = clusters.some((cluster) => near(circle, cluster.centre, Math.max(10, circle.radius * 0.35)));
      if (groupMatch) continue;
      const groupedKey = `${Math.round(circle.x)}:${Math.round(circle.y)}`;
      const grouped = groupedEndpointSet.has(groupedKey) || childPoints.some((point) => near(circle, point, 7));
      appendSoma(positions, colours, circle, clamp(circle.radius, grouped ? 5 : 8, grouped ? 10 : 20), circle.seed, 'memory');
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(resolutionLocation, lastWidth, lastHeight);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, colourBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colours), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(colourLocation);
    gl.vertexAttribPointer(colourLocation, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, positions.length / 2);
  }

  function scheduleRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(renderScene);
  }

  proto.beginPath = function memoryGraphBrainBeginPath(...args) {
    this.__brainPathStart = null;
    this.__brainPathEnd = null;
    this.__brainLastArc = null;
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function memoryGraphBrainMoveTo(x, y, ...rest) {
    this.__brainPathStart = { x: Number(x), y: Number(y) };
    this.__brainPathEnd = null;
    this.__brainLastArc = null;
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function memoryGraphBrainLineTo(x, y, ...rest) {
    if (this.__brainPathStart) this.__brainPathEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.arc = function memoryGraphBrainArc(x, y, radius, ...rest) {
    this.__brainLastArc = { x: Number(x), y: Number(y), radius: Number(radius) };
    return previousArc.call(this, x, y, radius, ...rest);
  };

  proto.fill = function memoryGraphBrainFill(...args) {
    if (this.__brainLastArc && isCoreGraph(this)) {
      captureCircle(this, coreCircles);
      return undefined;
    }
    if (this.__brainLastArc && isManualGravity(this)) {
      captureCircle(this, manualCircles);
      return undefined;
    }
    return previousFill.apply(this, args);
  };

  proto.clearRect = function memoryGraphBrainClearRect(...args) {
    if (isCoreGraph(this)) {
      coreSegments = [];
      coreCircles = [];
      scheduleRender();
    } else if (isManualGravity(this)) {
      manualSegments = [];
      manualCircles = [];
      scheduleRender();
    }
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function memoryGraphBrainStroke(...args) {
    if (isCoreConnector(this)) {
      captureSegment(this, coreSegments, true, 1);
      return undefined;
    }

    const manualPass = manualTracePass(this);
    if (manualPass) {
      if (manualPass === 'capture') {
        const sourceWidth = Math.max(0.5, Number(this.lineWidth) || 1);
        captureSegment(this, manualSegments, false, clamp(sourceWidth / 4, 0.62, 1.15));
      }
      return undefined;
    }

    if (this.__brainLastArc && (isCoreGraph(this) || isManualGravity(this))) return undefined;
    return previousStroke.apply(this, args);
  };

  function mount() {
    installStyles();
    surface = document.getElementById('memoryGraphSurface');
    graphCanvas = document.querySelector('.memory-graph-canvas');
    surface?.querySelectorAll('.memory-graph-neural-svg, .memory-graph-neural-canvas, .memory-graph-dendrite-canvas').forEach((item) => item.remove());
    if (!ensureLayer()) return false;
    scheduleRender();
    return true;
  }

  globalThis.MemoryGraphWebGL = Object.freeze({
    version: VERSION,
    active: () => supported && Boolean(gl),
    redraw: scheduleRender,
    snapshot() {
      const clusters = deriveClusters();
      return {
        version: VERSION,
        renderer: 'native-webgl2-dendrite-mesh',
        coreConnections: coreSegments.length,
        groupedClusters: clusters.length,
        groupedChildren: groupedChildPoints(clusters).length,
        coreBodies: coreCircles.length,
        supported
      };
    }
  });
  globalThis.MemoryGraphNeuralLinks = globalThis.MemoryGraphWebGL;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }
})();