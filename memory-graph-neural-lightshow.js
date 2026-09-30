(() => {
  'use strict';

  // Shader activation + bloom treatment adapted from VoXelo's public
  // "Neural Synapse Simulation" CodePen (MIT). See THIRD_PARTY_NOTICES.md.
  // This layer reuses Memory Space's approved Three.js root geometry exactly.
  const VERSION = 1;
  const THREE_MODULE = './vendor/three/three.module.min.js';
  const EFFECT_COMPOSER_MODULE = './vendor/three/addons/postprocessing/EffectComposer.js';
  const RENDER_PASS_MODULE = './vendor/three/addons/postprocessing/RenderPass.js';
  const BLOOM_PASS_MODULE = './vendor/three/addons/postprocessing/UnrealBloomPass.js';
  const MAX_DPR = 1.5;
  const MAX_PULSES = 10;
  const FRAME_MS = 1000 / 30;
  const params = new URLSearchParams(location.search);

  if (params.get('neuralRenderer') === 'canvas') return;

  let THREE = null;
  let EffectComposer = null;
  let RenderPass = null;
  let UnrealBloomPass = null;
  let sourceCanvas = null;
  let surface = null;
  let layer = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let composer = null;
  let bloomPass = null;
  let width = 1;
  let height = 1;
  let frame = 0;
  let lastFrameAt = 0;
  let hiddenAt = 0;
  let shaderTime = 0;
  let pulseSequence = 0;
  let ambientTimer = 0;
  let ambientCursor = 0;
  let lastError = null;
  const pulses = [];

  const palettes = Object.freeze({
    blue: 0x66e1ff,
    cyan: 0x5ff0ff,
    lime: 0xc1ff4f,
    violet: 0xe774ff,
    magenta: 0xff5cdb,
    yellow: 0xffe848,
    green: 0x94ff7d,
    purple: 0xe273ff,
    orange: 0xffbe4a
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const vertexShader = `
    attribute float aPathDistance;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vPathDistance;

    void main() {
      vec4 worldPos = modelMatrix * vec4(position, 1.0);
      vWorldPos = worldPos.xyz;
      vNormal = normalize(normalMatrix * normal);
      vPathDistance = aPathDistance;
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;

  // This keeps the reference Pen's noise, Fresnel edge energy, cosine palette,
  // white-hot wavefront and coloured residual trail, with distance coefficients
  // rescaled from its small world units to Memory Space's pixel-space roots.
  const fragmentShader = `
    uniform float uTime;
    uniform float uActivation;
    uniform float uEnvelope;
    uniform float uReverse;
    uniform float uTotalLength;
    uniform vec3 uSignalColor;
    uniform vec3 uCameraPos;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vPathDistance;

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + .1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
            mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
        mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
            mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z
      );
    }

    vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
      return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
      float pathDistance = mix(vPathDistance, uTotalLength - vPathDistance, step(0.5, uReverse));
      float distFromWave = pathDistance - uActivation;
      float waveFront = exp(-distFromWave * distFromWave * 0.030);
      float hotCore = exp(-distFromWave * distFromWave * 0.110);
      float passed = 1.0 - smoothstep(uActivation - 1.0, uActivation + 1.0, pathDistance);
      float trailStart = max(0.0, uActivation - 82.0);
      float trail = smoothstep(trailStart, max(trailStart + 0.001, uActivation), pathDistance);
      float residual = passed * (0.20 + trail * 1.35);
      float activity = (waveFront * 4.2 + residual) * (0.60 + 0.40 * noise(vWorldPos * 0.055 - uTime * 1.8));

      vec3 dir = normalize(vec3(vWorldPos.xy * 0.012, vWorldPos.z + 0.01));
      float angle = atan(dir.z, dir.x);
      vec3 rainbow = palette(
        angle * 0.15 + pathDistance * 0.018 - uTime * 0.50,
        vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.33, 0.67)
      );
      vec3 signalColour = mix(rainbow, uSignalColor, 0.34);
      vec3 colour = signalColour * activity * 1.55;
      colour += vec3(1.0, 0.92, 0.82) * hotCore * 4.0;

      vec3 viewDir = normalize(uCameraPos - vWorldPos);
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.2);
      colour += signalColour * fresnel * waveFront * 1.8;
      colour *= uEnvelope;

      float alpha = clamp((activity * 0.23 + hotCore * 0.90) * uEnvelope, 0.0, 1.0);
      if (alpha < 0.008) discard;
      gl_FragColor = vec4(colour, alpha);
    }
  `;

  const somaFragmentShader = `
    uniform float uTime;
    uniform float uEnvelope;
    uniform vec3 uSignalColor;
    uniform vec3 uCameraPos;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vPathDistance;

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + .1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    void main() {
      vec3 viewDir = normalize(uCameraPos - vWorldPos);
      float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.4);
      float n = 0.75 + 0.25 * hash(floor(vWorldPos * 0.12 + uTime * 4.0));
      vec3 whiteHot = vec3(1.0, 0.94, 0.86) * 3.5;
      vec3 colour = mix(uSignalColor * 2.2, whiteHot, 0.62 + fresnel * 0.25) * n * uEnvelope;
      float alpha = clamp((0.48 + fresnel * 0.52) * uEnvelope, 0.0, 1.0);
      if (alpha < 0.008) discard;
      gl_FragColor = vec4(colour, alpha);
    }
  `;

  function threeApi() {
    return globalThis.MemoryGraphNeuralThree || null;
  }

  function colourHex(name) {
    return palettes[String(name || 'cyan').toLowerCase()] || palettes.cyan;
  }

  function installStyles() {
    if (document.getElementById('memoryGraphNeuralLightshowStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralLightshowStyles';
    style.textContent = '.memory-graph-neural-lightshow-canvas{position:absolute;inset:0;z-index:3;display:block;width:100%;height:100%;pointer-events:none;mix-blend-mode:screen}';
    document.head.appendChild(style);
  }

  function ensureLayer() {
    const canvas = document.querySelector('.memory-graph-canvas');
    if (!THREE || !canvas?.parentElement) return false;
    if (layer && sourceCanvas === canvas && layer.isConnected) return true;

    layer?.remove();
    sourceCanvas = canvas;
    surface = canvas.parentElement;
    layer = document.createElement('canvas');
    layer.className = 'memory-graph-neural-lightshow-canvas';
    layer.setAttribute('aria-hidden', 'true');
    surface.appendChild(layer);

    renderer = new THREE.WebGLRenderer({
      canvas: layer,
      alpha: true,
      antialias: false,
      powerPreference: 'high-performance'
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, 1, 500);
    camera.position.set(0, 0, 220);

    setupComposer();

    installStyles();
    return resize();
  }

  function setupComposer() {
    if (!renderer || !scene || !camera || !EffectComposer || !RenderPass || !UnrealBloomPass) return false;
    composer?.dispose?.();
    const renderPass = new RenderPass(scene, camera);
    bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.max(1, width), Math.max(1, height)), 1.2, 0.8, 1.0);
    bloomPass.threshold = 1.0;
    bloomPass.strength = 1.2;
    bloomPass.radius = 0.8;
    composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    return true;
  }

  function resize() {
    if (!renderer || !sourceCanvas || !camera) return false;
    width = Math.max(1, Math.round(sourceCanvas.clientWidth));
    height = Math.max(1, Math.round(sourceCanvas.clientHeight));
    const dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DPR);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(dpr);
      composer.setSize(width, height);
    }
    layer.style.width = width + 'px';
    layer.style.height = height + 'px';
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.near = 1;
    camera.far = 500;
    camera.updateProjectionMatrix();
    return true;
  }

  function addDistanceAttribute(geometry, startDistance, length) {
    if (!geometry?.attributes?.uv || !geometry?.attributes?.position) return false;
    const existing = geometry.getAttribute('aPathDistance');
    const expectedEnd = startDistance + length;
    if (existing?.userData?.memoryStart === startDistance && existing?.userData?.memoryEnd === expectedEnd) return true;

    const uv = geometry.attributes.uv;
    const values = new Float32Array(geometry.attributes.position.count);
    for (let index = 0; index < values.length; index += 1) {
      values[index] = startDistance + clamp(uv.getX(index), 0, 1) * length;
    }
    const attribute = new THREE.BufferAttribute(values, 1);
    attribute.userData = { memoryStart: startDistance, memoryEnd: expectedEnd };
    geometry.setAttribute('aPathDistance', attribute);
    return true;
  }

  function makeMaterial(totalLength, palette) {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uTime: { value: shaderTime },
        uActivation: { value: 0 },
        uEnvelope: { value: 0 },
        uReverse: { value: 0 },
        uTotalLength: { value: Math.max(1, totalLength) },
        uSignalColor: { value: new THREE.Color(colourHex(palette)) },
        uCameraPos: { value: new THREE.Vector3(width * 0.5, height * 0.5, 220) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide
    });
  }

  function makeSomaMaterial(palette) {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: somaFragmentShader,
      uniforms: {
        uTime: { value: shaderTime },
        uEnvelope: { value: 0 },
        uSignalColor: { value: new THREE.Color(colourHex(palette)) },
        uCameraPos: { value: new THREE.Vector3(width * 0.5, height * 0.5, 220) }
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide
    });
  }

  function buildPulseMeshes(sourceNodeId, targetNodeId, palette) {
    const api = threeApi();
    const route = api?.routeSurface?.(sourceNodeId, targetNodeId);
    if (!route?.trunkGeometry || !route?.branchGeometry) return null;

    const trunkLength = Math.max(1, Number(route.trunkLength) || 1);
    const branchLength = Math.max(1, Number(route.branchLength) || 1);
    const totalLength = Math.max(1, Number(route.totalLength) || trunkLength + branchLength);
    addDistanceAttribute(route.trunkGeometry, 0, trunkLength);
    addDistanceAttribute(route.branchGeometry, trunkLength, branchLength);

    const material = makeMaterial(totalLength, palette);
    material.uniforms.uReverse.value = route.reverse ? 1 : 0;
    const trunk = new THREE.Mesh(route.trunkGeometry, material);
    const branch = new THREE.Mesh(route.branchGeometry, material);
    trunk.renderOrder = 10;
    branch.renderOrder = 10;
    scene.add(trunk, branch);

    let soma = null;
    let somaMaterial = null;
    const sourceSoma = api?.somaSurface?.(sourceNodeId);
    if (sourceSoma?.geometry) {
      if (!sourceSoma.geometry.getAttribute('aPathDistance')) {
        sourceSoma.geometry.setAttribute(
          'aPathDistance',
          new THREE.BufferAttribute(new Float32Array(sourceSoma.geometry.attributes.position.count), 1)
        );
      }
      somaMaterial = makeSomaMaterial(palette);
      soma = new THREE.Mesh(sourceSoma.geometry, somaMaterial);
      soma.position.copy(sourceSoma.position);
      soma.rotation.copy(sourceSoma.rotation);
      soma.renderOrder = 11;
      scene.add(soma);
    }

    return { route, totalLength, material, meshes: [trunk, branch], soma, somaMaterial };
  }

  function disposePulse(pulse) {
    for (const mesh of pulse.meshes || []) scene?.remove(mesh);
    if (pulse.soma) scene?.remove(pulse.soma);
    pulse.material?.dispose?.();
    pulse.somaMaterial?.dispose?.();
  }

  function fireSynapse(sourceNodeId, targetNodeId, options = {}) {
    if (!THREE || !ensureLayer()) return false;
    const palette = String(options.palette || 'cyan').toLowerCase();
    const visual = buildPulseMeshes(sourceNodeId, targetNodeId, palette);
    if (!visual) return false;

    if (pulses.length >= MAX_PULSES) {
      const ambientIndex = pulses.findIndex((pulse) => pulse.ambient);
      if (ambientIndex >= 0) disposePulse(pulses.splice(ambientIndex, 1)[0]);
      else {
        disposePulse(visual);
        return false;
      }
    }

    const pulse = {
      id: 'shader-synapse-' + (++pulseSequence),
      sourceNodeId: String(sourceNodeId || ''),
      targetNodeId: String(targetNodeId || ''),
      palette,
      intensity: clamp(Number(options.intensity) || 1, 0.45, 1.8),
      ambient: options.ambient === true,
      startedAt: performance.now() + clamp(Number(options.delay) || 0, 0, 900),
      duration: clamp(Number(options.duration) || 1750, 650, 4200),
      arrivalDetail: options.arrivalDetail || null,
      arrived: false,
      ...visual
    };
    pulses.push(pulse);
    startLoop();
    return pulse.id;
  }

  function updatePulse(pulse, timestamp) {
    const elapsed = timestamp - pulse.startedAt;
    if (elapsed < 0) {
      pulse.material.uniforms.uEnvelope.value = 0;
      if (pulse.somaMaterial) pulse.somaMaterial.uniforms.uEnvelope.value = 0;
      return true;
    }

    const progress = clamp(elapsed / pulse.duration, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    pulse.material.uniforms.uTime.value = shaderTime;
    pulse.material.uniforms.uActivation.value = eased * pulse.totalLength;
    pulse.material.uniforms.uEnvelope.value = pulse.intensity;
    pulse.material.uniforms.uSignalColor.value.setHex(colourHex(pulse.palette));
    pulse.material.uniforms.uCameraPos.value.set(width * 0.5, height * 0.5, 220);

    if (pulse.somaMaterial) {
      const launch = progress < 0.18 ? 1 - progress / 0.18 : 0;
      pulse.somaMaterial.uniforms.uTime.value = shaderTime;
      pulse.somaMaterial.uniforms.uEnvelope.value = launch * pulse.intensity * 1.28;
      pulse.somaMaterial.uniforms.uSignalColor.value.setHex(colourHex(pulse.palette));
      pulse.somaMaterial.uniforms.uCameraPos.value.set(width * 0.5, height * 0.5, 220);
    }

    if (progress >= 1 && !pulse.arrived) {
      pulse.arrived = true;
      pulse.arrivedAt = timestamp;
      if (pulse.arrivalDetail) {
        window.dispatchEvent(new CustomEvent('universal-route-pulse-arrived', { detail: pulse.arrivalDetail }));
      }
    }

    if (pulse.arrived) {
      const fade = clamp((timestamp - pulse.arrivedAt) / 620, 0, 1);
      pulse.material.uniforms.uEnvelope.value = pulse.intensity * (1 - fade);
      if (pulse.somaMaterial) pulse.somaMaterial.uniforms.uEnvelope.value = 0;
      if (fade >= 1) return false;
    }
    return true;
  }

  function renderFrame(timestamp) {
    frame = 0;
    if (document.hidden || !renderer || !scene || !camera) return;
    if (lastFrameAt && timestamp - lastFrameAt < FRAME_MS) {
      frame = requestAnimationFrame(renderFrame);
      return;
    }

    const delta = lastFrameAt ? Math.min(0.08, (timestamp - lastFrameAt) / 1000) : 0.033;
    lastFrameAt = timestamp;
    shaderTime += delta;

    for (let index = pulses.length - 1; index >= 0; index -= 1) {
      if (updatePulse(pulses[index], timestamp)) continue;
      disposePulse(pulses.splice(index, 1)[0]);
    }

    if (composer) composer.render();
    else renderer.render(scene, camera);
    if (pulses.length) frame = requestAnimationFrame(renderFrame);
    else {
      lastFrameAt = 0;
      renderer.clear();
    }
  }

  function startLoop() {
    if (!frame && !document.hidden && pulses.length) frame = requestAnimationFrame(renderFrame);
  }

  function scheduleAmbient() {
    if (ambientTimer) clearTimeout(ambientTimer);
    ambientTimer = 0;
    if (document.hidden) return;
    ambientTimer = window.setTimeout(() => {
      ambientTimer = 0;
      const scaffold = globalThis.MemoryGraphNeuralScaffold;
      const api = threeApi();
      const routes = (scaffold?.routes?.() || []).filter((route) =>
        route?.sourceId && route?.targetId && api?.routeSurface?.(route.sourceId, route.targetId)
      );
      if (routes.length && pulses.filter((pulse) => pulse.ambient).length < 6) {
        const seedRoute = routes[ambientCursor % routes.length];
        ambientCursor += 1;
        const sameHub = routes.filter((route) => route.sourceId === seedRoute.sourceId);
        const burst = (sameHub.length ? sameHub : [seedRoute]).slice(0, 4);
        burst.forEach((route, index) => {
          fireSynapse(route.sourceId, route.targetId, {
            ambient: true,
            palette: route.palette || ['cyan', 'lime', 'violet', 'magenta'][index % 4],
            intensity: 1.25 + index * 0.05,
            duration: 1850 + index * 120,
            delay: index * 110
          });
        });
      }
      scheduleAmbient();
    }, 650 + Math.random() * 350);
  }

  function clearPulses() {
    while (pulses.length) disposePulse(pulses.pop());
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrameAt = 0;
    renderer?.clear();
  }

  function handleVisibility() {
    if (document.hidden) {
      hiddenAt = performance.now();
      if (ambientTimer) clearTimeout(ambientTimer);
      ambientTimer = 0;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastFrameAt = 0;
      return;
    }
    if (hiddenAt) {
      const paused = performance.now() - hiddenAt;
      for (const pulse of pulses) pulse.startedAt += paused;
      hiddenAt = 0;
    }
    startLoop();
    scheduleAmbient();
  }

  function handleStructureChange() {
    clearPulses();
    if (THREE) {
      ensureLayer();
      resize();
      scheduleAmbient();
    }
  }

  window.addEventListener('resize', () => {
    if (THREE && ensureLayer()) resize();
  });
  window.addEventListener('memory-neural-routes-changed', handleStructureChange);
  window.addEventListener('memory-neural-three-rendered', handleStructureChange);
  document.addEventListener('visibilitychange', handleVisibility);

  const api = Object.freeze({
    version: VERSION,
    renderer: 'three-shader-bloom',
    sourceTechnique: 'VoXelo Neural Synapse Simulation (MIT)',
    ready: () => Boolean(THREE && renderer),
    fireSynapse,
    activePulseCount: () => pulses.length,
    status: () => ({
      ready: Boolean(THREE && renderer),
      bloom: Boolean(composer && bloomPass),
      pulses: pulses.length,
      lastError: lastError ? String(lastError.message || lastError) : null
    }),
    clear: clearPulses
  });
  globalThis.MemoryGraphNeuralLightshow = api;

  import(THREE_MODULE).then((threeModule) => {
    THREE = threeModule;
    ensureLayer();
    scheduleAmbient();
    return Promise.all([
      import(EFFECT_COMPOSER_MODULE),
      import(RENDER_PASS_MODULE),
      import(BLOOM_PASS_MODULE)
    ]);
  }).then(([composerModule, renderPassModule, bloomModule]) => {
    EffectComposer = composerModule.EffectComposer;
    RenderPass = renderPassModule.RenderPass;
    UnrealBloomPass = bloomModule.UnrealBloomPass;
    setupComposer();
    resize();
    scheduleAmbient();
  }).catch((error) => {
    lastError = error;
    console.error('Memory Space neural bloom modules failed; shader fallback stays active:', error);
    if (THREE) {
      ensureLayer();
      scheduleAmbient();
    }
  });
})();