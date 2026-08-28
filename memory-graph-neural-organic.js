(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_CORE_SPROUTS = 4;
  const MAX_GROUP_SPROUTS = 3;
  let svg = null;
  let observer = null;
  let decorating = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashUnit(seed, salt = 0) {
    const value = Math.sin((Number(seed) || 0) * 9187.133 + salt * 73.731) * 43758.5453;
    return value - Math.floor(value);
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function pathLength(path) {
    try { return path.getTotalLength(); } catch { return 0; }
  }

  function pointAt(path, distance) {
    try { return path.getPointAtLength(distance); } catch { return null; }
  }

  function tangentAt(path, distance) {
    const total = pathLength(path);
    if (!total) return null;
    const delta = Math.max(1.5, Math.min(5, total * 0.025));
    const a = pointAt(path, clamp(distance - delta, 0, total));
    const b = pointAt(path, clamp(distance + delta, 0, total));
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    return { tx: dx / length, ty: dy / length, px: -dy / length, py: dx / length };
  }

  function el(name, attrs = {}) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  function branchPath(origin, tangent, seed, direction, reach, curl = 1) {
    const side = direction >= 0 ? 1 : -1;
    const lateral = reach * (0.64 + hashUnit(seed, 2) * 0.34) * side;
    const forward = reach * (0.30 + hashUnit(seed, 3) * 0.42);
    const end = {
      x: origin.x + tangent.px * lateral + tangent.tx * forward,
      y: origin.y + tangent.py * lateral + tangent.ty * forward
    };
    const c1 = {
      x: origin.x + tangent.tx * reach * 0.18 + tangent.px * lateral * 0.34,
      y: origin.y + tangent.ty * reach * 0.18 + tangent.py * lateral * 0.34
    };
    const c2 = {
      x: end.x - tangent.tx * reach * 0.22 + tangent.px * lateral * 0.10 * curl,
      y: end.y - tangent.ty * reach * 0.22 + tangent.py * lateral * 0.10 * curl
    };
    return {
      d: `M ${origin.x.toFixed(2)} ${origin.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(2)}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`,
      end
    };
  }

  function addHotspot(group, point, strength = 0.34, warm = false) {
    const outer = el('circle', {
      cx: point.x.toFixed(2), cy: point.y.toFixed(2), r: warm ? 5.8 : 4.6,
      fill: warm ? `rgba(255,179,86,${(0.07 * strength).toFixed(3)})` : `rgba(61,173,242,${(0.08 * strength).toFixed(3)})`
    });
    const inner = el('circle', {
      cx: point.x.toFixed(2), cy: point.y.toFixed(2), r: warm ? 1.45 : 1.15,
      fill: warm ? `rgba(255,224,173,${(0.72 * strength).toFixed(3)})` : `rgba(225,248,255,${(0.62 * strength).toFixed(3)})`
    });
    group.append(outer, inner);
  }

  function addSprout(group, sourcePath, seed, index, count, strength = 1, allowFork = true) {
    const total = pathLength(sourcePath);
    if (total < 70) return;
    const t = 0.18 + ((index + 0.5) / count) * 0.66;
    const distance = total * t;
    const origin = pointAt(sourcePath, distance);
    const tangent = tangentAt(sourcePath, distance);
    if (!origin || !tangent) return;

    const direction = (index + Math.floor(seed * 17)) % 2 === 0 ? 1 : -1;
    const reach = clamp(total * (0.065 + hashUnit(seed, index + 10) * 0.055), 10, 32) * strength;
    const branch = branchPath(origin, tangent, seed + index * 0.193, direction, reach);

    group.appendChild(el('path', {
      d: branch.d,
      fill: 'none',
      stroke: 'rgba(91,192,236,0.20)',
      'stroke-width': Math.max(0.42, 0.76 * strength).toFixed(2),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));
    group.appendChild(el('path', {
      d: branch.d,
      fill: 'none',
      stroke: 'rgba(215,246,255,0.22)',
      'stroke-width': Math.max(0.22, 0.34 * strength).toFixed(2),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'stroke-dasharray': '7 22'
    }));

    const warm = hashUnit(seed, index + 23) > 0.76;
    addHotspot(group, branch.end, 0.62 * strength, warm);

    if (!allowFork || reach < 14 || hashUnit(seed, index + 31) < 0.42) return;
    const forkDirection = direction * -1;
    const fakeTangent = {
      tx: tangent.tx * 0.58 + tangent.px * direction * 0.42,
      ty: tangent.ty * 0.58 + tangent.py * direction * 0.42,
      px: -tangent.ty,
      py: tangent.tx
    };
    const fork = branchPath(branch.end, fakeTangent, seed + index * 0.277 + 0.41, forkDirection, reach * 0.48, 0.6);
    group.appendChild(el('path', {
      d: fork.d,
      fill: 'none',
      stroke: 'rgba(80,175,226,0.13)',
      'stroke-width': Math.max(0.24, 0.42 * strength).toFixed(2),
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    }));
    if (warm) addHotspot(group, fork.end, 0.38 * strength, false);
  }

  function decoratePath(path, index, group, isStrong) {
    const total = pathLength(path);
    if (total < 72) return;
    const width = number(path.getAttribute('stroke-width'), 1);
    const opacityMatch = String(path.getAttribute('stroke') || '').match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/i);
    const opacity = opacityMatch ? number(opacityMatch[1], 0) : 0;
    if (opacity < 0.12 || width < 0.7) return;

    const seed = (index + 1) * 0.173 + total * 0.0091 + width * 0.37;
    const count = isStrong
      ? clamp(Math.round(total / 115), 2, MAX_GROUP_SPROUTS)
      : clamp(Math.round(total / 145), 1, MAX_CORE_SPROUTS);
    for (let branchIndex = 0; branchIndex < count; branchIndex += 1) {
      addSprout(group, path, seed, branchIndex, count, isStrong ? 1.12 : 0.88, isStrong || branchIndex === 0);
    }
  }

  function addLocalWeb(paths, group) {
    const endpoints = [];
    for (const path of paths) {
      const total = pathLength(path);
      if (total < 18) continue;
      const point = pointAt(path, total);
      if (point) endpoints.push(point);
    }
    if (endpoints.length < 4) return;

    const candidates = [];
    for (let i = 0; i < endpoints.length; i += 1) {
      for (let j = i + 1; j < endpoints.length; j += 1) {
        const a = endpoints[i];
        const b = endpoints[j];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance > 28 && distance < 118) candidates.push({ a, b, distance, seed: (i + 1) * 31 + (j + 1) * 17 });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const used = new Set();
    let drawn = 0;
    for (const link of candidates) {
      if (drawn >= 7) break;
      const keyA = `${Math.round(link.a.x / 5)}:${Math.round(link.a.y / 5)}`;
      const keyB = `${Math.round(link.b.x / 5)}:${Math.round(link.b.y / 5)}`;
      if (used.has(keyA) && used.has(keyB)) continue;
      const dx = link.b.x - link.a.x;
      const dy = link.b.y - link.a.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const px = -dy / length;
      const py = dx / length;
      const bend = (hashUnit(link.seed, 7) * 2 - 1) * Math.min(18, length * 0.16);
      const d = `M ${link.a.x.toFixed(2)} ${link.a.y.toFixed(2)} Q ${((link.a.x + link.b.x) * 0.5 + px * bend).toFixed(2)} ${((link.a.y + link.b.y) * 0.5 + py * bend).toFixed(2)} ${link.b.x.toFixed(2)} ${link.b.y.toFixed(2)}`;
      group.appendChild(el('path', {
        d,
        fill: 'none',
        stroke: 'rgba(72,155,207,0.095)',
        'stroke-width': '0.42',
        'stroke-linecap': 'round'
      }));
      used.add(keyA);
      used.add(keyB);
      drawn += 1;
    }
  }

  function decorate() {
    if (decorating) return;
    svg = document.querySelector('.memory-graph-neural-svg');
    if (!svg) return;
    decorating = true;
    try {
      svg.querySelector('[data-neural-organic]')?.remove();
      const layer = el('g', { 'data-neural-organic': 'true' });
      const paths = [...svg.querySelectorAll(':scope > path')];
      const strong = paths.filter((path) => number(path.getAttribute('stroke-width'), 0) >= 1.7);
      const core = paths.filter((path) => {
        const width = number(path.getAttribute('stroke-width'), 0);
        return width >= 0.8 && width < 1.7;
      });

      strong.forEach((path, index) => decoratePath(path, index, layer, true));
      core.forEach((path, index) => decoratePath(path, index + strong.length, layer, false));
      addLocalWeb(core.slice(-28), layer);
      svg.appendChild(layer);
    } finally {
      decorating = false;
    }
  }

  function mount() {
    svg = document.querySelector('.memory-graph-neural-svg');
    if (!svg) {
      requestAnimationFrame(mount);
      return;
    }
    decorate();
    observer = new MutationObserver(() => {
      if (decorating) return;
      requestAnimationFrame(decorate);
    });
    observer.observe(svg, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }
})();