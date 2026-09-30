(() => {
  'use strict';

  const VERSION = 2;
  const VIDEO_URL = null;

  let surface = null;
  let video = null;

  function setState(state) {
    if (surface) surface.dataset.backgroundVideo = state;
  }

  function stopFailedVideo() {
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    setState('failed');
  }

  function playWhenVisible() {
    if (!VIDEO_URL || !video || document.hidden || video.dataset.failed === 'true') return;
    if (!video.src) video.src = VIDEO_URL;
    video.play().catch(() => setState('paused'));
  }

  function handleVisibility() {
    if (!video) return;
    if (document.hidden) {
      video.pause();
      setState('paused');
      return;
    }
    playWhenVisible();
  }

  function mount() {
    surface = document.getElementById('memoryGraphSurface');
    const graphCanvas = surface?.querySelector('.memory-graph-canvas');
    if (!surface || !graphCanvas) return false;

    if (!VIDEO_URL) {
      const existing = surface.querySelector('.memory-graph-background-video');
      existing?.pause?.();
      existing?.remove?.();
      video = null;
      setState('disabled');
      return true;
    }

    video = surface.querySelector('.memory-graph-background-video');
    if (!video) {
      video = document.createElement('video');
      video.className = 'memory-graph-background-video';
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.setAttribute('aria-hidden', 'true');
      video.setAttribute('disablepictureinpicture', '');
      video.addEventListener('playing', () => setState('playing'));
      video.addEventListener('error', () => {
        video.dataset.failed = 'true';
        stopFailedVideo();
      }, { once: true });
      surface.insertBefore(video, graphCanvas);
    }

    setState('loading');
    playWhenVisible();
    return true;
  }

  document.addEventListener('visibilitychange', handleVisibility);

  globalThis.MemoryGraphNebula = Object.freeze({
    version: VERSION,
    mount,
    refresh: mount,
    supported: () => true
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
