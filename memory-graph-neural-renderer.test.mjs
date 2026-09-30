import assert from 'node:assert/strict';
import test from 'node:test';

test('cached neural routes and capped pulse API', async () => {
  const listeners = new Map();
  const on = (type, handler) => {
    const handlers = listeners.get(type) || [];
    handlers.push(handler);
    listeners.set(type, handlers);
  };
  const emit = (event) => {
    for (const handler of listeners.get(event.type) || []) handler(event);
  };

  class MockGradient {
    addColorStop() {}
  }

  class MockContext {
    constructor(canvas) {
      this.canvas = canvas;
      this.lineWidth = 1;
      this.strokeStyle = '';
      this.fillStyle = '';
    }
    beginPath() {}
    moveTo() {}
    lineTo() {}
    clearRect() {}
    stroke() {}
    fill() {}
    arc() {}
    quadraticCurveTo() {}
    bezierCurveTo() {}
    save() {}
    restore() {}
    setTransform() {}
    createLinearGradient() { return new MockGradient(); }
    createRadialGradient() { return new MockGradient(); }
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; }
  }

  class MockCanvas {
    constructor(className = '') {
      this.className = className;
      this.classList = { contains: (name) => this.className.split(' ').includes(name) };
      this.clientWidth = 1000;
      this.clientHeight = 600;
      this.width = 1000;
      this.height = 600;
      this.style = {};
      this.dataset = {};
      this.isConnected = true;
      this.context = new MockContext(this);
    }
    getContext() { return this.context; }
    remove() { this.isConnected = false; }
    setAttribute() {}
  }

  class MockSurface {
    constructor() {
      this.children = [];
    }
    appendChild(child) {
      child.parentElement = this;
      child.isConnected = true;
      this.children.push(child);
    }
    addEventListener(type, handler) { on(`surface:${type}`, handler); }
    removeEventListener() {}
    dispatch(type) { emit({ type: `surface:${type}` }); }
  }

  const surface = new MockSurface();
  const graphCanvas = new MockCanvas('memory-graph-canvas');
  graphCanvas.parentElement = surface;
  surface.children.push(graphCanvas);

  globalThis.CanvasRenderingContext2D = MockContext;
  globalThis.devicePixelRatio = 3;
  globalThis.CustomEvent = class {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };
  globalThis.window = globalThis;
  globalThis.addEventListener = on;
  globalThis.removeEventListener = () => {};
  globalThis.dispatchEvent = emit;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.document = {
    hidden: false,
    head: { appendChild() {} },
    createElement(tag) { return tag === 'canvas' ? new MockCanvas() : { id: '', style: {}, textContent: '' }; },
    getElementById() { return null; },
    querySelector(selector) { return selector === '.memory-graph-canvas' ? graphCanvas : null; },
    addEventListener: on
  };

  await import(`./memory-graph-neural-scaffold.js?test=${Date.now()}`);
  const context = graphCanvas.context;
  const targets = [
    ['child-a', 500, 270],
    ['child-b', 520, 300],
    ['child-c', 510, 330],
    ['child-d', 490, 360]
  ];
  const drawNetwork = () => {
    context.clearRect(0, 0, 1000, 600);
    for (const [targetId, x, y] of targets) {
      context.__memoryNeuralEdge = {
        id: `hub->${targetId}:space`,
        sourceId: 'hub',
        targetId,
        sourceHub: true,
        targetHub: false,
        kind: 'space'
      };
      context.beginPath();
      context.moveTo(100, 200);
      context.lineTo(x, y);
      context.lineWidth = 1.05;
      context.strokeStyle = 'rgba(120, 184, 255, 0.23)';
      context.stroke();
    }
    surface.dispatch('memory-graph-drawn');
  };

  drawNetwork();
  assert.equal(globalThis.MemoryGraphNeuralScaffold.routes().length, 4);
  assert.equal(globalThis.MemoryGraphNeuralScaffold.routeRevision(), 1);
  const approvedRoutes = globalThis.MemoryGraphNeuralScaffold.routes();
  assert.ok(approvedRoutes.every((route) => route.points.length >= 37));
  assert.ok(approvedRoutes.every((route) => route.curves.length >= 2));
  assert.ok(approvedRoutes.every((route) => route.boundaries.length === route.curves.length - 1));
  assert.ok(approvedRoutes.some((route) => route.curves.length === 3));
  const sharedJunction = approvedRoutes[0].curves[0].p3;
  assert.ok(approvedRoutes.every((route) =>
    route.curves[0].p3.x === sharedJunction.x && route.curves[0].p3.y === sharedJunction.y));
  assert.ok(Math.hypot(sharedJunction.x - 100, sharedJunction.y - 200) > 40);
  assert.equal(surface.children.find((child) => child.className === 'memory-graph-neural-scaffold-canvas').width, 1750);
  const firstRoutes = structuredClone(approvedRoutes);

  drawNetwork();
  assert.equal(globalThis.MemoryGraphNeuralScaffold.routeRevision(), 1);
  assert.deepEqual(globalThis.MemoryGraphNeuralScaffold.routes(), firstRoutes);

  await import(`./memory-graph-neural-flow.js?test=${Date.now()}`);
  assert.equal(typeof globalThis.fireSynapse, 'function');
  assert.ok(globalThis.fireSynapse('hub', 'child-a'));
  for (let index = 0; index < 20; index += 1) {
    globalThis.fireSynapse('hub', 'child-a');
  }
  assert.equal(globalThis.MemoryGraphNeuralFlow.pulseLimit, 10);
  assert.equal(globalThis.MemoryGraphNeuralFlow.activePulseCount(), 10);
});
