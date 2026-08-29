(() => {
  'use strict';

  const ROLE = Object.freeze({
    core: { radius: 68, orbit: 0, mass: 5, color: 'blue', draggable: false },
    space: { radius: 42, orbit: 318, mass: 2.2, color: 'green' },
    group: { radius: 38, orbit: 318, mass: 2, color: 'green' },
    memory: { radius: 16, orbit: 120, mass: 1, color: 'green' },
    control: { radius: 45, orbit: 365, mass: 1.6, color: 'green' },
    'control-child': { radius: 25, orbit: 142, mass: .75, color: 'green' },
    action: { radius: 12, orbit: 84, mass: .6, color: 'green' }
  });
  const MIN_SCALE = .45;
  const MAX_SCALE = 2.8;

  class MolecularEngine {
    constructor({ surface, roleConfig, onNodeAction } = {}) {
      this.surface = surface;
      this.roles = { ...ROLE, ...(roleConfig || {}) };
      this.onNodeAction = onNodeAction || (() => {});
      this.nodes = new Map();
      this.edges = new Map();
      this.children = new Map();
      this.openBranches = new Set();
      this.view = { x: 0, y: 0, scale: 1 };
      this.rotation = { x: 0, y: 0 };
      this.selectedId = null;
      this.frame = 0;
      this.running = false;
      this.pointer = null;
      this.resizeObserver = null;
      this.canvas = null;
      this.context = null;
      this.width = 1;
      this.height = 1;
      this.init();
    }

    init() {
      if (!this.surface) return;
      this.surface.classList.remove('empty-state');
      this.surface.innerHTML = '';
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'memory-graph-canvas molecular-engine-canvas';
      this.canvas.setAttribute('aria-label', 'Molecular Memory Space graph');
      this.surface.appendChild(this.canvas);
      this.context = this.canvas.getContext('2d');
      this.bind();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.surface);
      this.resize();
    }

    destroy() {
      cancelAnimationFrame(this.frame);
      this.resizeObserver?.disconnect();
      this.canvas?.remove();
      this.nodes.clear(); this.edges.clear(); this.children.clear();
    }

    roleFor(node) { return { ...ROLE.memory, ...(this.roles[node.kind] || {}), ...(node.force || {}) }; }

    setGraph({ nodes = [], edges = [], autoFrame = true } = {}) {
      const previous = this.nodes;
      const wasEmpty = previous.size === 0;
      this.nodes = new Map(nodes.map((raw, index) => {
        const prior = previous.get(raw.id);
        const role = this.roleFor(raw);
        const angle = Number.isFinite(raw.angle) ? raw.angle : -Math.PI / 2 + index * .81;
        const orbit = raw.orbit || role.orbit || 120;
        const node = {
          ...raw, payload: raw.payload || {}, x: prior?.x ?? raw.x ?? this.width / 2 + Math.cos(angle) * orbit,
          y: prior?.y ?? raw.y ?? this.height / 2 + Math.sin(angle) * orbit,
          vx: prior?.vx ?? 0, vy: prior?.vy ?? 0, radius: raw.radius || role.radius,
          fixed: raw.fixed ?? raw.kind === 'core', dragging: false, open: Boolean(raw.open)
        };
        return [node.id, node];
      }));
      if (wasEmpty) for (const raw of nodes) if (raw.open) this.openBranches.add(raw.id);
      this.edges = new Map(edges.map((edge, index) => [edge.id || `${edge.source}:${edge.target}:${index}`, { ...edge }]));
      this.reindexChildren();
      this.seedBranchPositions(previous);
      this.syncBranchVisibility();
      if (wasEmpty && autoFrame) this.frameHome();
      else if (wasEmpty) this.view = { x: 0, y: 0, scale: 1 };
      this.start(); this.draw();
    }

    reindexChildren() {
      this.children.clear();
      for (const node of this.nodes.values()) {
        if (!node.parentId) continue;
        const group = this.children.get(node.parentId) || [];
        group.push(node.id); this.children.set(node.parentId, group);
      }
    }

    seedBranchPositions(previous) {
      const root = [...this.nodes.values()].find((node) => node.kind === 'core');
      if (!root) return;
      root.x = previous.get(root.id)?.x ?? root.x; root.y = previous.get(root.id)?.y ?? root.y;
      for (let pass = 0; pass < 5; pass += 1) {
        for (const node of this.nodes.values()) {
          if (previous.has(node.id) || !node.parentId) continue;
          const parent = this.nodes.get(node.parentId); if (!parent) continue;
          const siblings = this.children.get(parent.id) || [];
          const index = Math.max(0, siblings.indexOf(node.id));
          const parentDirection = parent.id === root.id
            ? (Number.isFinite(node.angle) ? node.angle : -Math.PI / 2)
            : Math.atan2(parent.y - root.y, parent.x - root.x);
          const spread = Math.min(1.45, Math.max(.34, siblings.length * .16));
          const angle = Number.isFinite(node.angle) ? node.angle : parentDirection + (index - (siblings.length - 1) / 2) * spread / Math.max(1, siblings.length - 1);
          const orbit = node.orbit || this.roleFor(node).orbit;
          node.x = parent.x + Math.cos(angle) * orbit;
          node.y = parent.y + Math.sin(angle) * orbit;
          this.contain(node);
        }
      }
    }

    syncBranchVisibility() {
      const visible = (node) => {
        if (node.payload?.durable || !node.parentId || node.parentId === 'root') return true;
        const parent = this.nodes.get(node.parentId);
        return Boolean(parent && this.openBranches.has(parent.id) && visible(parent));
      };
      for (const node of this.nodes.values()) node.hidden = !visible(node);
    }

    frameHome() {
      const root = [...this.nodes.values()].find((node) => node.kind === 'core');
      if (!root) return;
      let extentX = root.radius, extentY = root.radius;
      for (const node of this.nodes.values()) {
        if (node.hidden) continue;
        extentX = Math.max(extentX, Math.abs(node.x - root.x) + node.radius + 34);
        extentY = Math.max(extentY, Math.abs(node.y - root.y) + node.radius + 34);
      }
      const scaleX = this.width * .96 / Math.max(1, extentX * 2);
      const scaleY = this.height * .90 / Math.max(1, extentY * 2);
      this.view.scale = Math.max(.78, Math.min(1.34, Math.min(scaleX, scaleY)));
      this.view.x = this.width / 2 - root.x * this.view.scale;
      this.view.y = this.height / 2 - root.y * this.view.scale;
    }

    resize() {
      if (!this.context || !this.surface) return;
      const rect = this.surface.getBoundingClientRect();
      const oldW = this.width, oldH = this.height;
      this.width = Math.max(1, Math.round(rect.width)); this.height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, Math.max(1, devicePixelRatio || 1));
      this.canvas.width = this.width * dpr; this.canvas.height = this.height * dpr;
      this.canvas.style.width = `${this.width}px`; this.canvas.style.height = `${this.height}px`;
      this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ratioX = oldW ? this.width / oldW : 1, ratioY = oldH ? this.height / oldH : 1;
      for (const node of this.nodes.values()) { node.x *= ratioX; node.y *= ratioY; }
      this.draw();
    }

    project(node) {
      const cx = this.width / 2, cy = this.height / 2;
      const dx = node.x - cx, dy = node.y - cy;
      const depth = Math.sin(this.rotation.x) * dx * .28 + Math.sin(this.rotation.y) * dy * .28;
      const scale = Math.max(.72, Math.min(1.22, 1 + depth / 1600));
      return { x: node.x + dy * Math.sin(this.rotation.x) * .08, y: node.y - dx * Math.sin(this.rotation.y) * .08, radius: node.radius * scale, depth, scale, alpha: Math.max(.42, Math.min(1, .76 + depth / 900)) };
    }

    tick = () => {
      this.frame = 0;
      if (!this.running) return;
      this.simulate(); this.draw();
      if (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches) this.frame = requestAnimationFrame(this.tick);
    };
    start() { if (!this.running) { this.running = true; this.frame = requestAnimationFrame(this.tick); } }
    stop() { this.running = false; cancelAnimationFrame(this.frame); this.frame = 0; }

    simulate() {
      const all = [...this.nodes.values()].filter((node) => !node.hidden);
      const core = all.find((node) => node.kind === 'core');
      for (let i = 0; i < all.length; i += 1) {
        const node = all[i]; if (node.fixed || node.dragging) continue;
        const role = this.roleFor(node); let fx = 0, fy = 0;
        const parent = this.nodes.get(node.parentId) || core;
        if (parent) {
          const dx = node.x - parent.x, dy = node.y - parent.y, d = Math.max(1, Math.hypot(dx, dy));
          const target = node.orbit || role.orbit || 120;
          const pull = -(d - target) * (node.parentId ? .0039 : .0019);
          fx += dx / d * pull; fy += dy / d * pull;
        }
        for (let j = i + 1; j < all.length; j += 1) {
          const other = all[j]; if (other.fixed) continue;
          const dx = node.x - other.x, dy = node.y - other.y, d2 = Math.max(100, dx * dx + dy * dy), d = Math.sqrt(d2);
          const push = Math.min(.9, 900 / d2) / Math.max(.75, role.mass || 1);
          fx += dx / d * push; fy += dy / d * push;
          if (!other.dragging) { other.vx -= dx / d * push / Math.max(.75, this.roleFor(other).mass || 1); other.vy -= dy / d * push / Math.max(.75, this.roleFor(other).mass || 1); }
        }
        node.vx = (node.vx + fx) * .90; node.vy = (node.vy + fy) * .90;
        node.x += node.vx; node.y += node.vy; this.contain(node);
      }
    }

    contain(node) {
      const margin = node.radius + 26;
      node.x = Math.max(margin, Math.min(this.width - margin, node.x));
      node.y = Math.max(margin, Math.min(this.height - margin, node.y));
    }

    draw() {
      if (!this.context) return;
      const c = this.context; c.clearRect(0, 0, this.width, this.height);
      c.save(); c.translate(this.view.x, this.view.y); c.scale(this.view.scale, this.view.scale);
      for (const edge of this.edges.values()) this.drawEdge(edge);
      const visible = [...this.nodes.values()].filter((node) => !node.hidden);
      const core = visible.find((node) => node.kind === 'core');
      const leaves = visible.filter((node) => node !== core);
      if (Math.abs(this.rotation.x) > .001 || Math.abs(this.rotation.y) > .001) {
        leaves.sort((a, b) => this.project(a).depth - this.project(b).depth).forEach((node) => this.drawNode(node));
        if (core) this.drawNode(core);
      } else {
        if (core) this.drawNode(core);
        leaves.forEach((node) => this.drawNode(node));
      }
      c.restore(); this.surface.dispatchEvent(new CustomEvent('molecular-engine-drawn'));
    }

    drawEdge(edge) {
      const sourceNode = this.nodes.get(edge.source), targetNode = this.nodes.get(edge.target);
      if (!sourceNode || !targetNode || sourceNode.hidden || targetNode.hidden) return;
      const source = this.project(sourceNode), target = this.project(targetNode), revision = edge.kind === 'revision', c = this.context;
      c.save(); c.beginPath(); c.moveTo(source.x, source.y); c.lineTo(target.x, target.y);
      c.lineWidth = revision ? 1.35 : .85;
      c.strokeStyle = revision ? 'rgba(199, 255, 86, 0.34)' : 'rgba(120, 184, 255, 0.16)';
      if (revision) c.setLineDash([5, 4]);
      c.stroke(); c.restore();
    }

    drawNode(node) {
      const isSpace = node.kind === 'core' || node.kind === 'space';
      const recency = isSpace ? 1 : Number(node.recencyLevel || 0);
      const fillAlpha = isSpace ? .24 : .10 + recency * .16;
      const strokeAlpha = isSpace ? .95 : .56 + recency * .30;
      const glowAlpha = isSpace ? .55 : .18 + recency * .30;
      const projected = this.project(node), c = this.context, depthAlpha = isSpace ? 1 : Number(projected.alpha || 1);
      c.save(); c.globalAlpha = depthAlpha; c.beginPath(); c.arc(projected.x, projected.y, projected.radius, 0, Math.PI * 2);
      c.fillStyle = isSpace ? 'rgba(120, 184, 255, 0.24)' : `rgba(199, 255, 86, ${fillAlpha.toFixed(3)})`; c.fill();
      c.lineWidth = node.locked ? 3 : isSpace ? 2.5 : 1.5;
      c.strokeStyle = isSpace ? 'rgba(120, 184, 255, 0.95)' : `rgba(199, 255, 86, ${strokeAlpha.toFixed(3)})`; c.stroke();
      c.shadowBlur = isSpace ? 24 : 7 + recency * 13;
      c.shadowColor = isSpace ? 'rgba(120, 184, 255, 0.55)' : `rgba(199, 255, 86, ${glowAlpha.toFixed(3)})`; c.stroke(); c.restore();
      if (node.id === this.selectedId) {
        c.save(); c.beginPath(); c.arc(projected.x, projected.y, projected.radius + 8, 0, Math.PI * 2); c.lineWidth = 2.5; c.strokeStyle = 'rgba(120, 184, 255, 0.98)'; c.shadowBlur = 18; c.shadowColor = 'rgba(120, 184, 255, 0.72)'; c.stroke(); c.restore();
      }
      c.save(); c.globalAlpha = depthAlpha; c.fillStyle = isSpace ? 'rgba(242, 244, 247, 0.94)' : `rgba(242, 244, 247, ${(0.70 + recency * .24).toFixed(3)})`;
      c.font = isSpace ? '700 14px Inter, system-ui, sans-serif' : '600 11px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'top';
      c.fillText(this.shortLabel(node.label, isSpace ? 26 : 22), projected.x, projected.y + projected.radius + 8); c.restore();
    }

    projectedScene() {
      const nodes = [...this.nodes.values()].filter((node) => !node.hidden).map((node) => ({ id: node.id, kind: node.kind, payload: node.payload, ...this.project(node) }));
      const edges = [...this.edges.values()].map((edge) => ({ ...edge, sourcePoint: this.project(this.nodes.get(edge.source)), targetPoint: this.project(this.nodes.get(edge.target)) }));
      return { width: this.width, height: this.height, view: { ...this.view }, nodes, edges };
    }
    shortLabel(value, limit) { const text = String(value || '').trim(); return text.length <= limit ? text : `${text.slice(0, limit - 1).trim()}…`; }

    bind() {
      this.canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
      this.canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
      this.canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
      this.canvas.addEventListener('pointercancel', (event) => this.pointerUp(event));
      this.canvas.addEventListener('wheel', (event) => { event.preventDefault(); const factor = event.deltaY > 0 ? .9 : 1.1; this.view.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.view.scale * factor)); this.draw(); }, { passive: false });
      window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { this.rotation = { x: 0, y: 0 }; this.draw(); } });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.running && !this.frame) this.frame = requestAnimationFrame(this.tick);
      });
    }
    point(event) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
    screenToWorld(point) { return { x: (point.x - this.view.x) / this.view.scale, y: (point.y - this.view.y) / this.view.scale }; }
    hit(point) { const world = this.screenToWorld(point); return [...this.nodes.values()].filter((node) => !node.hidden).sort((a, b) => this.project(b).depth - this.project(a).depth).find((node) => { const p = this.project(node); return Math.hypot(p.x - world.x, p.y - world.y) <= p.radius + 8; }) || null; }
    pointerDown(event) { if (event.button !== 0) return; const point = this.point(event), node = this.hit(point); this.pointer = { id: event.pointerId, node, point, last: point, moved: false, rotate: event.altKey || event.shiftKey }; this.canvas.dataset.interacting = 'true'; if (node && !this.pointer.rotate && this.roleFor(node).draggable !== false) node.dragging = true; this.canvas.setPointerCapture(event.pointerId); }
    pointerMove(event) { if (!this.pointer || event.pointerId !== this.pointer.id) return; const point = this.point(event), dx = point.x - this.pointer.last.x, dy = point.y - this.pointer.last.y; this.pointer.moved ||= Math.hypot(point.x - this.pointer.point.x, point.y - this.pointer.point.y) > 4;
      if (this.pointer.rotate) { this.rotation.x += dx * .008; this.rotation.y += dy * .008; }
      else if (this.pointer.node?.dragging) { const world = this.screenToWorld(point); this.pointer.node.x = world.x; this.pointer.node.y = world.y; this.pointer.node.vx = 0; this.pointer.node.vy = 0; }
      else if (!this.pointer.node) { this.view.x += dx; this.view.y += dy; } this.pointer.last = point; this.draw(); }
    pointerUp(event) { if (!this.pointer || event.pointerId !== this.pointer.id) return; const state = this.pointer; if (state.node) { state.node.dragging = false; if (!state.moved) this.activateNode(state.node); } this.pointer = null; this.canvas.removeAttribute('data-interacting'); this.canvas.releasePointerCapture?.(event.pointerId); this.start(); }
    activateNode(node) {
      this.selectedId = node.id;
      if (node.kind === 'core') this.collapseBranches();
      else if (node.expandable) this.toggleBranch(node.id);
      this.onNodeAction(node); this.draw();
    }
    collapseBranches() {
      this.openBranches.clear();
      // Nodes marked open are the adapter's intentional Home baseline; this
      // keeps the Shared Memory cluster visible without retaining any deep tree.
      for (const node of this.nodes.values()) if (node.open) this.openBranches.add(node.id);
      this.syncBranchVisibility();
    }
    toggleBranch(id) {
      const node = this.nodes.get(id); if (!node) return;
      const wasOpen = this.openBranches.has(id);
      const ancestors = new Set(); let parent = this.nodes.get(node.parentId);
      while (parent && parent.id !== 'root') { ancestors.add(parent.id); parent = this.nodes.get(parent.parentId); }
      if (wasOpen) {
        const close = (target) => { this.openBranches.delete(target); for (const child of this.children.get(target) || []) close(child); };
        close(id);
      } else {
        // A top-level hub replaces a separate branch; nested nodes retain their
        // owned ancestral path so they can never migrate to the last selection.
        for (const openId of [...this.openBranches]) if (!ancestors.has(openId)) this.openBranches.delete(openId);
        ancestors.forEach((ancestor) => this.openBranches.add(ancestor)); this.openBranches.add(id);
      }
      this.syncBranchVisibility(); this.draw();
    }
  }
  globalThis.MolecularEngine = MolecularEngine;
})();
