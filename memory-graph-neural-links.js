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
  const previousStroke = proto.stroke;
  const previousClearRect = proto.clearRect;

  const VERSION = 3;
  const POINT_EPSILON = 5;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let surface = null;
  let graphCanvas = null;
  let svg = null;
  let renderTimer = 0;
  let lastSignature = '';
  let coreSegments = [];
  let manualSegments = [];

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
    if (!isCoreGraph(context) || !context.__neuralSvgPathStart || !context.__neuralSvgPathEnd) return false;
    const style = String(context.strokeStyle || '');
    const width = Math.max(0, Number(context.lineWidth) || 0);
    return width <= 1.6 && style.includes('120, 184, 255');
  }

  function manualTracePass(context) {
    if (!isManualGravity(context) || !context.__neuralSvgPathStart || !context.__neuralSvgPathEnd) return '';
    const style = String(context.strokeStyle || '');
    const alpha = styleAlpha(style);
    if (style.includes('55, 139, 255') && alpha <= 0.14) return 'capture';
    if (style.includes('120, 184, 255') && alpha >= 0.36 && alpha <= 0.44) return 'suppress';
    if (style.includes('241, 251, 255') && alpha >= 0.82) return 'suppress';
    return '';
  }

  function screenPoint(context, point) {
    const canvas = context?.canvas;
    if (!canvas || !point) return null;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, canvas.width / Math.max(1, rect.width));
    const matrix = context.getTransform();
    return {
      x: (matrix.a * point.x + matrix.c * point.y + matrix.e) / dpr,
      y: (matrix.b * point.x + matrix.d * point.y + matrix.f) / dpr
    };
  }

  function captureSegment(context, target, reverse = false, widthScale = 1) {
    const start = screenPoint(context, context.__neuralSvgPathStart);
    const end = screenPoint(context, context.__neuralSvgPathEnd);
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

  function near(a, b, epsilon = POINT_EPSILON) {
    return Boolean(a && b && Math.hypot(a.x - b.x, a.y - b.y) <= epsilon);
  }

  function installStyles() {
    if (document.getElementById('memoryGraphNeuralSvgStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralSvgStyles';
    style.textContent = `
      .memory-graph-spark-canvas,
      .memory-graph-neural-canvas,
      .memory-graph-dendrite-canvas { display:none !important; }
      .memory-graph-neural-svg {
        position:absolute;
        inset:0;
        z-index:1;
        width:100%;
        height:100%;
        overflow:visible;
        pointer-events:none;
      }
      .memory-graph-manual-gravity-canvas { z-index:2 !important; }
      .memory-graph-canvas { z-index:3 !important; }
    `;
    document.head.appendChild(style);
  }

  function ensureSvg() {
    surface = surface || document.getElementById('memoryGraphSurface');
    graphCanvas = graphCanvas || document.querySelector('.memory-graph-canvas');
    if (!surface) return false;

    if (!svg || !svg.isConnected) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.classList.add('memory-graph-neural-svg');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('preserveAspectRatio', 'none');
      const manualOverlay = surface.querySelector('.memory-graph-manual-gravity-canvas');
      if (manualOverlay) surface.insertBefore(svg, manualOverlay);
      else surface.appendChild(svg);
    }

    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return true;
  }

  function curveSpec(from, to, seed, bendScale = 1, offset = 0) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / length;
    const py = dx / length;
    const bend = (hashUnit(seed, 2, 7) * 2 - 1) * clamp(length * 0.115, 5, 44) * bendScale + offset;
    const skew = (hashUnit(seed, 8, 3) * 2 - 1) * clamp(length * 0.028, 1.5, 10);
    return {
      length,
      d: `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} C `
        + `${(from.x + dx * 0.32 + px * (bend + skew)).toFixed(2)} ${(from.y + dy * 0.32 + py * (bend + skew)).toFixed(2)}, `
        + `${(from.x + dx * 0.68 - px * (bend * 0.58 - skew * 0.35)).toFixed(2)} ${(from.y + dy * 0.68 - py * (bend * 0.58 - skew * 0.35)).toFixed(2)}, `
        + `${to.x.toFixed(2)} ${to.y.toFixed(2)}`
    };
  }

  function pathMarkup(d, width, opacity, colour = '111,205,244', dash = '') {
    return `<path d="${d}" fill="none" stroke="rgba(${colour},${opacity})" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  }

  function hotspotMarkup(point, strength = 0.4, radius = 3.2) {
    const outer = radius * 2.35;
    return `<g>
      <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${outer.toFixed(2)}" fill="rgba(58,164,235,${(strength * 0.12).toFixed(3)})"/>
      <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="rgba(132,224,255,${(strength * 0.42).toFixed(3)})"/>
      <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${Math.max(0.7, radius * 0.28).toFixed(2)}" fill="rgba(244,252,255,${(strength * 0.72).toFixed(3)})"/>
    </g>`;
  }

  function pulseMarkup(d, seed, strong = false) {
    const duration = 7.5 + hashUnit(seed, 3, 7) * 5.5;
    const begin = -(hashUnit(seed, 11, 9) * duration);
    const radius = strong ? 2.2 : 1.55;
    const opacity = strong ? 0.72 : 0.48;
    return `<circle r="${radius}" fill="rgba(239,251,255,${opacity})">
      <animateMotion dur="${duration.toFixed(2)}s" begin="${begin.toFixed(2)}s" repeatCount="indefinite" path="${d}"/>
    </circle>`;
  }

  function connectionMarkup(from, to, seed, options = {}) {
    const width = clamp(Number(options.widthScale) || 1, 0.32, 1.8);
    const intensity = clamp(Number(options.intensity) || 1, 0.2, 1.2);
    const spec = curveSpec(from, to, seed, Number(options.bendScale) || 1);
    if (spec.length < 8) return '';

    let out = '';
    if (options.glow !== false) {
      out += pathMarkup(spec.d, Math.max(3.1, 6.4 * width), (0.032 * intensity).toFixed(3), '34,120,218');
    }
    out += pathMarkup(spec.d, Math.max(0.9, 2.05 * width), (0.30 * intensity).toFixed(3), '78,177,232');
    out += pathMarkup(spec.d, Math.max(0.28, 0.52 * width), (0.28 * intensity).toFixed(3), '206,241,255', '18 52');

    if (options.support !== false && spec.length > 95) {
      const support = curveSpec(from, to, seed + 0.317, 0.68, (hashUnit(seed, 4, 6) * 2 - 1) * 4.5);
      out += pathMarkup(support.d, Math.max(0.24, 0.38 * width), (0.12 * intensity).toFixed(3), '91,188,231');
    }

    if (options.pulse) out += pulseMarkup(spec.d, seed, Boolean(options.strongPulse));
    return out;
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

  function branchArms(cluster) {
    const children = cluster.children.slice();
    if (!children.length) return [];
    const centre = cluster.centre;
    children.sort((a, b) => Math.atan2(a.to.y - centre.y, a.to.x - centre.x) - Math.atan2(b.to.y - centre.y, b.to.x - centre.x));
    const armCount = children.length === 1 ? 1 : clamp(Math.ceil(children.length / 4), 2, 5);
    const arms = Array.from({ length: armCount }, () => []);
    for (let index = 0; index < children.length; index += 1) {
      const armIndex = Math.min(armCount - 1, Math.floor(index * armCount / children.length));
      arms[armIndex].push(children[index]);
    }
    return arms.filter((items) => items.length);
  }

  function junctionFor(centre, children, seed) {
    let vx = 0;
    let vy = 0;
    let distance = 0;
    for (const child of children) {
      const dx = child.to.x - centre.x;
      const dy = child.to.y - centre.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      vx += dx / length;
      vy += dy / length;
      distance += length;
    }
    const norm = Math.max(1e-6, Math.hypot(vx, vy));
    const ux = vx / norm;
    const uy = vy / norm;
    const px = -uy;
    const py = ux;
    const reach = clamp((distance / Math.max(1, children.length)) * 0.44, 17, 46);
    const skew = (hashUnit(seed, 4, 8) * 2 - 1) * clamp(reach * 0.24, 2, 8);
    return { x: centre.x + ux * reach + px * skew, y: centre.y + uy * reach + py * skew };
  }

  function meshMarkup(cluster) {
    if (cluster.children.length < 3) return '';
    const links = [];
    for (let i = 0; i < cluster.children.length; i += 1) {
      for (let j = i + 1; j < cluster.children.length; j += 1) {
        const a = cluster.children[i].to;
        const b = cluster.children[j].to;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance <= 92) links.push({ a, b, distance, seed: segmentSeed(a, b, i * 19 + j * 31) });
      }
    }
    links.sort((a, b) => a.distance - b.distance);
    let out = '';
    for (const link of links.slice(0, Math.min(4, Math.ceil(cluster.children.length / 5)))) {
      const spec = curveSpec(link.a, link.b, link.seed, 0.34);
      out += pathMarkup(spec.d, 0.34, 0.07, '71,151,205');
    }
    return out;
  }

  function clusterMarkup(cluster, mobile) {
    let out = connectionMarkup(cluster.trunk.from, cluster.trunk.to, cluster.seed, {
      widthScale: mobile ? 0.96 : 1.12,
      intensity: 0.9,
      pulse: true,
      strongPulse: true,
      support: !mobile
    });
    out += hotspotMarkup(cluster.centre, 0.58, mobile ? 3.8 : 4.5);

    const arms = branchArms(cluster);
    for (let armIndex = 0; armIndex < arms.length; armIndex += 1) {
      const children = arms[armIndex];
      const seed = cluster.seed + 0.43 + armIndex * 0.291;
      const junction = junctionFor(cluster.centre, children, seed);
      out += connectionMarkup(cluster.centre, junction, seed, {
        widthScale: 0.66,
        intensity: 0.62,
        pulse: false,
        support: false,
        bendScale: 0.72
      });
      out += hotspotMarkup(junction, 0.36, 2.9);

      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const child = children[childIndex];
        out += connectionMarkup(junction, child.to, seed + 0.17 + childIndex * 0.149, {
          widthScale: 0.40 + (childIndex % 3) * 0.045,
          intensity: 0.50,
          pulse: false,
          support: false,
          glow: false,
          bendScale: 0.58
        });
        if (childIndex % 2 === 0) out += hotspotMarkup(child.to, 0.25, 2.1);
      }
    }

    out += meshMarkup(cluster);
    return out;
  }

  function segmentSignature(segment) {
    const q = (value) => Math.round(Number(value || 0) * 2) / 2;
    return `${q(segment.from.x)},${q(segment.from.y)},${q(segment.to.x)},${q(segment.to.y)}`;
  }

  function renderSignature() {
    return `${coreSegments.map(segmentSignature).join('|')}::${manualSegments.map(segmentSignature).join('|')}`;
  }

  function renderSvg() {
    if (!ensureSvg() || !svg) return;
    const signature = renderSignature();
    if (signature === lastSignature) return;
    lastSignature = signature;

    const clusters = deriveClusters();
    const childPoints = groupedChildPoints(clusters);
    const visibleCore = coreSegments.filter((segment) => !isGroupedCoreSegment(segment, childPoints));
    const mobile = window.matchMedia?.('(max-width: 800px)')?.matches === true;

    let markup = '';
    let pulseCount = 0;
    for (let index = 0; index < visibleCore.length; index += 1) {
      const segment = visibleCore[index];
      const allowPulse = pulseCount < 4 && index % 3 === 0;
      if (allowPulse) pulseCount += 1;
      markup += connectionMarkup(segment.from, segment.to, segment.seed, {
        widthScale: 0.82,
        intensity: 0.66,
        pulse: allowPulse,
        support: !mobile
      });
    }

    for (const cluster of clusters) markup += clusterMarkup(cluster, mobile);
    svg.innerHTML = markup;
  }

  function scheduleRender() {
    if (renderTimer) return;
    const interacting = graphCanvas?.dataset.interacting === 'true';
    renderTimer = window.setTimeout(() => {
      renderTimer = 0;
      requestAnimationFrame(renderSvg);
    }, interacting ? 28 : 72);
  }

  proto.beginPath = function memoryGraphNeuralSvgBeginPath(...args) {
    this.__neuralSvgPathStart = null;
    this.__neuralSvgPathEnd = null;
    return previousBeginPath.apply(this, args);
  };

  proto.moveTo = function memoryGraphNeuralSvgMoveTo(x, y, ...rest) {
    this.__neuralSvgPathStart = { x: Number(x), y: Number(y) };
    this.__neuralSvgPathEnd = null;
    return previousMoveTo.call(this, x, y, ...rest);
  };

  proto.lineTo = function memoryGraphNeuralSvgLineTo(x, y, ...rest) {
    if (this.__neuralSvgPathStart) this.__neuralSvgPathEnd = { x: Number(x), y: Number(y) };
    return previousLineTo.call(this, x, y, ...rest);
  };

  proto.clearRect = function memoryGraphNeuralSvgClearRect(...args) {
    if (isCoreGraph(this)) {
      coreSegments = [];
      scheduleRender();
    } else if (isManualGravity(this)) {
      manualSegments = [];
      scheduleRender();
    }
    return previousClearRect.apply(this, args);
  };

  proto.stroke = function memoryGraphNeuralSvgStroke(...args) {
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

    return previousStroke.apply(this, args);
  };

  function mount() {
    installStyles();
    surface = document.getElementById('memoryGraphSurface');
    graphCanvas = document.querySelector('.memory-graph-canvas');
    ensureSvg();
    scheduleRender();
  }

  globalThis.MemoryGraphNeuralLinks = Object.freeze({
    version: VERSION,
    snapshot() {
      const clusters = deriveClusters();
      return {
        version: VERSION,
        coreConnections: coreSegments.length,
        groupedClusters: clusters.length,
        groupedChildren: groupedChildPoints(clusters).length,
        renderer: 'svg-static-dendrite'
      };
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }
})();