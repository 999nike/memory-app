(() => {
  'use strict';

  const VERSION = 1;
  const MIN_DESKTOP_WIDTH = 1051;
  const IDLE_FRAME_MS = 88;
  const ROTATING_FRAME_MS = 46;
  const SPRITE_SIZE = 360;
  const SPRITE_QUALITY = 1.5;

  const CLOUDS = [
    { x: 0.23, y: 0.30, scale: 1.05, alpha: 0.23, phase: 0.4, palette: 'blue' },
    { x: 0.72, y: 0.27, scale: 0.92, alpha: 0.18, phase: 1.8, palette: 'green' },
    { x: 0.67, y: 0.72, scale: 1.18, alpha: 0.20, phase: 3.1, palette: 'blue' },
    { x: 0.31, y: 0.73, scale: 0.84, alpha: 0.16, phase: 4.4, palette: 'green' },
    { x: 0.49, y: 0.48, scale: 1.30, alpha: 0.12, phase: 5.7, palette: 'blue' }
  ];

  const runtimeClouds = CLOUDS.map((cloud) => ({
    ...cloud,
    currentX: null,
    currentY: null,
    currentScale: cloud.scale,
    currentAlpha: cloud.alpha
  }));

  let surface = null;
  let sourceCanvas = null;
  let nebulaCanvas = null;
  let context = null;
  let resizeObserver = null;
  let mutationObserver = null;
  let animationFrame = 0;
  let lastPaint = 0;
  let dissolve = 0;
  let sprites = null;
  let dust = [];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(a, b, amount) {
    return a + (b - a) * amount;
  }

  function hashUnit(seed) {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function supported() {
    return window.innerWidth >= MIN_DESKTOP_WIDTH;
  }

  function rotationSnapshot() {
    try {
      return globalThis.MemoryGraphRotation?.snapshot?.() || {
        yaw: 0,
        pitch: 0,
        active: false,
        rotating: false
      };
    } catch {
      return { yaw: 0, pitch: 0, active: false, rotating: false };
    }
  }

  function createSprite(palette) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(SPRITE_SIZE * SPRITE_QUALITY);
    canvas.height = Math.round(SPRITE_SIZE * SPRITE_QUALITY);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(SPRITE_QUALITY, 0, 0, SPRITE_QUALITY, 0, 0);

    const c = SPRITE_SIZE / 2;
    const blue = palette === 'blue';
    const lobes = 9;

    for (let index = 0; index < lobes; index += 1) {
      const angle = (index / lobes) * Math.PI * 2 + hashUnit(index + (blue ? 3 : 17)) * 0.8;
      const distance = 20 + hashUnit(index * 2.7 + 9) * 70;
      const x = c + Math.cos(angle) * distance;
      const y = c + Math.sin(angle) * distance * 0.64;
      const radius = 56 + hashUnit(index * 4.1 + 2) * 74;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);

      if (blue) {
        gradient.addColorStop(0, 'rgba(89, 160, 255, 0.34)');
        gradient.addColorStop(0.32, 'rgba(43, 101, 211, 0.20)');
        gradient.addColorStop(0.68, 'rgba(24, 62, 138, 0.08)');
        gradient.addColorStop(1, 'rgba(18, 45, 110, 0)');
      } else {
        gradient.addColorStop(0, 'rgba(199, 255, 86, 0.26)');
        gradient.addColorStop(0.32, 'rgba(111, 185, 55, 0.15)');
        gradient.addColorStop(0.68, 'rgba(54, 112, 34, 0.06)');
        gradient.addColorStop(1, 'rgba(45, 92, 29, 0)');
      }

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    const core = ctx.createRadialGradient(c, c, 0, c, c, 135);
    if (blue) {
      core.addColorStop(0, 'rgba(120, 184, 255, 0.16)');
      core.addColorStop(0.55, 'rgba(48, 96, 188, 0.07)');
      core.addColorStop(1, 'rgba(28, 60, 138, 0)');
    } else {
      core.addColorStop(0, 'rgba(199, 255, 86, 0.12)');
      core.addColorStop(0.55, 'rgba(101, 161, 51, 0.05)');
      core.addColorStop(1, 'rgba(61, 105, 36, 0)');
    }
    ctx.beginPath();
    ctx.arc(c, c, 135, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    return canvas;
  }

  function ensureSprites() {
    if (sprites) return sprites;
    sprites = {
      blue: createSprite('blue'),
      green: createSprite('green')
    };
    return sprites;
  }

  function buildDust() {
    dust = Array.from({ length: 46 }, (_, index) => ({
      x: 0.08 + hashUnit(index * 1.91 + 4) * 0.84,
      y: 0.08 + hashUnit(index * 2.73 + 11) * 0.84,
      size: 0.45 + hashUnit(index * 5.17 + 23) * 1.25,
      alpha: 0.06 + hashUnit(index * 7.31 + 31) * 0.18,
      phase: hashUnit(index * 3.79 + 13) * Math.PI * 2,
      green: hashUnit(index * 9.13 + 7) > 0.72
    }));
  }

  function ensureLayer() {
    surface = document.getElementById('memoryGraphSurface');
    sourceCanvas = surface?.querySelector('.memory-graph-canvas') || null;
    if (!surface || !sourceCanvas || !supported()) return false;

    if (!nebulaCanvas || !nebulaCanvas.isConnected) {
      nebulaCanvas = document.createElement('canvas');
      nebulaCanvas.className = 'memory-graph-nebula-canvas';
      nebulaCanvas.setAttribute('aria-hidden', 'true');
      nebulaCanvas.style.position = 'absolute';
      nebulaCanvas.style.inset = '0';
      nebulaCanvas.style.zIndex = '0';
      nebulaCanvas.style.width = '100%';
      nebulaCanvas.style.height = '100%';
      nebulaCanvas.style.pointerEvents = 'none';
      surface.insertBefore(nebulaCanvas, sourceCanvas);
      context = nebulaCanvas.getContext('2d');
      surface.dataset.memoryGraphNebula = 'true';
    }

    ensureSprites();
    if (!dust.length) buildDust();
    resize();
    return Boolean(context);
  }

  function resize() {
    if (!surface || !nebulaCanvas || !context) return;
    const rect = surface.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (nebulaCanvas.width !== pixelWidth || nebulaCanvas.height !== pixelHeight) {
      nebulaCanvas.width = pixelWidth;
      nebulaCanvas.height = pixelHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const cloud of runtimeClouds) {
        cloud.currentX = null;
        cloud.currentY = null;
      }
    }
  }

  function targetCloud(cloud, width, height, rotation, timestamp) {
    const yaw = Number(rotation.yaw || 0);
    const pitch = Number(rotation.pitch || 0);
    const active = Boolean(rotation.active);
    const drift = timestamp * 0.00008;
    const orbitX = active ? Math.sin(yaw + cloud.phase) * width * 0.075 : 0;
    const orbitY = active ? Math.sin(pitch + cloud.phase * 0.72) * height * 0.070 : 0;
    const crossX = active ? Math.sin(pitch * 0.7 + cloud.phase) * width * 0.025 : 0;
    const crossY = active ? Math.cos(yaw * 0.65 + cloud.phase) * height * 0.020 : 0;
    const idleX = Math.sin(drift + cloud.phase) * 7;
    const idleY = Math.cos(drift * 0.82 + cloud.phase) * 5;
    const depth = active ? Math.sin(yaw + cloud.phase * 1.23) * Math.cos(pitch * 0.7) : 0;

    return {
      x: cloud.x * width + orbitX + crossX + idleX,
      y: cloud.y * height + orbitY + crossY + idleY,
      scale: cloud.scale * (1 + depth * 0.08 + dissolve * 0.16),
      alpha: cloud.alpha * (1 - dissolve * 0.58) * (0.92 + depth * 0.08)
    };
  }

  function drawClouds(width, height, timestamp, rotation) {
    const spriteSet = ensureSprites();
    const response = rotation.rotating ? 0.18 : 0.055;

    for (const cloud of runtimeClouds) {
      const target = targetCloud(cloud, width, height, rotation, timestamp);
      if (!Number.isFinite(cloud.currentX)) cloud.currentX = target.x;
      if (!Number.isFinite(cloud.currentY)) cloud.currentY = target.y;

      cloud.currentX = lerp(cloud.currentX, target.x, response);
      cloud.currentY = lerp(cloud.currentY, target.y, response);
      cloud.currentScale = lerp(cloud.currentScale, target.scale, response);
      cloud.currentAlpha = lerp(cloud.currentAlpha, target.alpha, response);

      const logicalSize = SPRITE_SIZE * cloud.currentScale;
      context.save();
      context.globalAlpha = clamp(cloud.currentAlpha, 0, 0.32);
      context.drawImage(
        spriteSet[cloud.palette],
        cloud.currentX - logicalSize / 2,
        cloud.currentY - logicalSize / 2,
        logicalSize,
        logicalSize
      );
      context.restore();
    }
  }

  function drawDust(width, height, timestamp, rotation) {
    const yaw = Number(rotation.yaw || 0);
    const pitch = Number(rotation.pitch || 0);
    const active = Boolean(rotation.active);
    const fade = 1 - dissolve * 0.45;

    for (const particle of dust) {
      const drift = timestamp * 0.00010 + particle.phase;
      const x = particle.x * width
        + Math.sin(drift) * 5
        + (active ? Math.sin(yaw + particle.phase) * width * 0.026 : 0);
      const y = particle.y * height
        + Math.cos(drift * 0.86) * 4
        + (active ? Math.sin(pitch + particle.phase) * height * 0.022 : 0);

      context.beginPath();
      context.arc(x, y, particle.size, 0, Math.PI * 2);
      context.fillStyle = particle.green
        ? `rgba(199, 255, 86, ${(particle.alpha * fade).toFixed(3)})`
        : `rgba(120, 184, 255, ${(particle.alpha * fade).toFixed(3)})`;
      context.fill();
    }
  }

  function paint(timestamp) {
    animationFrame = requestAnimationFrame(paint);
    if (!context || !nebulaCanvas || !surface?.isConnected || !supported()) return;

    const rotation = rotationSnapshot();
    const frameMs = rotation.rotating ? ROTATING_FRAME_MS : IDLE_FRAME_MS;
    if (timestamp - lastPaint < frameMs) return;
    lastPaint = timestamp;

    const rect = surface.getBoundingClientRect();
    if (document.hidden || rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return;

    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    dissolve = rotation.rotating
      ? clamp(dissolve + 0.105, 0, 1)
      : clamp(dissolve - 0.050, 0, 1);

    context.clearRect(0, 0, width, height);
    drawClouds(width, height, timestamp, rotation);
    drawDust(width, height, timestamp, rotation);
  }

  function start() {
    if (animationFrame) return;
    animationFrame = requestAnimationFrame(paint);
  }

  function stop() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function mount() {
    if (!supported()) return false;
    if (!ensureLayer()) {
      mutationObserver?.disconnect();
      mutationObserver = new MutationObserver(() => {
        if (!ensureLayer()) return;
        mutationObserver?.disconnect();
        mutationObserver = null;
        start();
      });
      const target = document.getElementById('memoryGraphSurface');
      if (target) mutationObserver.observe(target, { childList: true });
      return false;
    }

    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(surface);
    start();
    return true;
  }

  function refresh() {
    if (!supported()) {
      stop();
      nebulaCanvas?.remove();
      nebulaCanvas = null;
      context = null;
      surface?.removeAttribute('data-memory-graph-nebula');
      return false;
    }

    if (!ensureLayer()) return false;
    resize();
    start();
    return true;
  }

  window.addEventListener('resize', refresh, { passive: true });

  globalThis.MemoryGraphNebula = Object.freeze({
    version: VERSION,
    mount,
    refresh,
    supported
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
