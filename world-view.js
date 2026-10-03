(() => {
  'use strict';

  const THREE_MODULE = './vendor/three/three.module.min.js';
  const EFFECT_COMPOSER_MODULE = './vendor/three/addons/postprocessing/EffectComposer.js';
  const RENDER_PASS_MODULE = './vendor/three/addons/postprocessing/RenderPass.js';
  const BLOOM_PASS_MODULE = './vendor/three/addons/postprocessing/UnrealBloomPass.js';
  const GLTF_LOADER_MODULE = './vendor/three/addons/loaders/GLTFLoader.js';
  const MIN_ZOOM = .55;
  const MAX_ZOOM = 3;
  // Square-aligned orthographic camera: zero azimuth keeps the district axes,
  // GLB facades and screen axes parallel instead of presenting the world on a
  // diagonal/isometric corner.
  const DEFAULT_VIEW_ANGLE = 0;
  const DEFAULT_VIEW_PITCH = Math.atan(1 / Math.sqrt(2));
  const CAMERA_DISTANCE = Math.hypot(18, 13.65, 20);
  const CAMERA_TARGET_Y = 2.35;
  const WORLD_ASSETS = Object.freeze({
    office: Object.freeze({
      label: 'Office',
      url: './world-glbs/Meshy_AI_Neon_Helipad_Tower_1003004722_texture.glb',
      targetSize: Object.freeze([6.6, 10, 6.2]),
      rotationY: 0,
      maxTriangles: 1600000
    }),
    codeLab: Object.freeze({
      label: 'Code Space',
      url: './world-glbs/Meshy_AI_Neon_Nexus_Station_1003000450_texture.glb',
      targetSize: Object.freeze([7.56, 7, 5.88]),
      rotationY: 0,
      maxTriangles: 2500000
    }),
    memory: Object.freeze({
      label: 'Memory',
      url: './world-glbs/Meshy_AI_Memory_Vault_City_1003010357_texture.glb',
      targetSize: Object.freeze([7.4, 5.5, 5.2]),
      rotationY: 0,
      maxTriangles: 2400000
    })
  });
  const QUALITY_KEY = 'universal-world-quality-v1';
  const QUALITY = Object.freeze({
    low: Object.freeze({ dpr: 1, bloom: 0, shadows: false }),
    medium: Object.freeze({ dpr: 1.5, bloom: .10, shadows: true }),
    high: Object.freeze({ dpr: 2, bloom: .16, shadows: true })
  });
  const APPS = Object.freeze({
    office: {
      title: 'Office HQ', kicker: 'OPERATIONS / DISPATCH', accent: '#ff4ad8',
      copy: 'A compact command tower for jobs, workers and dispatch. The illuminated ground-floor workstation is the handoff point to Code Space.',
      status: ['Dispatch desk', 'Demo · active'], secondary: ['Queue', '03 packages'],
      actions: [
        ['Memory Jobs', 'office', 'office.memory-jobs.open', 'primary'],
        ['Dashboard', 'office', 'office.dashboard.open'], ['Jobs', 'office', 'office.jobs.all.open'],
        ['New Job', 'office', 'office.new-job.open'], ['Workers', 'office', 'office.workers.all.open'],
        ['Dispatch', 'office', 'office.dispatch.all.open'], ['Projects', 'office', 'office.projects.open'],
        ['Open Office', 'office', 'office.open']
      ]
    },
    code: {
      title: 'Code Space Lab', kicker: 'BUILD / EXECUTION', accent: '#4cecff',
      copy: 'An open industrial computer bay. The worker walk, sit and typing cycle is visual demo activity until execution telemetry is connected.',
      status: ['Workstation 01', 'Demo · typing'], secondary: ['Runtime', 'Not connected'],
      actions: [
        ['Open Code Space', 'code-space', 'code-space.open', 'primary'],
        ['Jobs', 'code-space', 'jobs.open'], ['Projects', 'code-space', 'projects.open'],
        ['Files', 'code-space', 'files.open'], ['Codex', 'code-space', 'codex.open'],
        ['Terminal', 'code-space', 'terminal.open'], ['Git', 'code-space', 'git.open'],
        ['Settings', 'code-space', 'settings.open']
      ]
    },
    memory: {
      title: 'Memory Space', kicker: 'ARCHIVE / CONTEXT', accent: '#5cff98',
      copy: 'A green-and-blue archive with a visible energy core. Storage and retrieval lights are decorative in this prototype, not live Memory events.',
      status: ['Archive banks', 'Demo · indexed'], secondary: ['Core', 'Local'],
      actions: [
        ['Open Memory App', 'memory', 'open', 'primary'], ['Neural View', 'view', 'neural'],
        ['Memories', 'memory', 'open'], ['New Memory', 'memory', 'new'],
        ['Groups', 'view', 'neural'], ['Search', 'memory', 'search'],
        ['Settings', 'memory', 'settings']
      ]
    }
  });

  let root;
  let canvasWrap;
  let panel;
  let panelActions;
  let switcher;
  let THREE;
  let renderer;
  let composer;
  let bloomPass;
  let scene;
  let camera;
  let world;
  let districtRoot;
  let districtAngle = 0;
  const buildingRoots = new Map();
  let animationFrame = 0;
  let resizeObserver;
  let raycaster;
  let pointer;
  let clock;
  let worker;
  let core;
  let selectionRing;
  let codeScreens = [];
  let signs = [];
  let pickables = [];
  let selectedId = null;
  let viewAngle = DEFAULT_VIEW_ANGLE;
  let viewPitch = DEFAULT_VIEW_PITCH;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let quality = 'medium';
  let drag = null;
  let codeActivity = Object.freeze({ source: 'demo', state: 'DEMO', startedAt: 0, dispatch: null });
  let assetLoadQueue = Promise.resolve();
  let initialized = false;
  let active = false;

  function createShell() {
    root = document.createElement('section');
    root.id = 'worldView';
    root.className = 'world-view';
    root.setAttribute('aria-label', 'Universal World cyberpunk city');
    root.innerHTML = `
      <div class="world-canvas-wrap" aria-label="Interactive square-aligned city. Drag to pan and scroll to zoom."></div>
      <div class="world-loading"><strong>ASSEMBLING DISTRICT 01</strong><span>Loading the local Three.js renderer…</span></div>
      <div class="world-fallback"><strong>WORLD VIEW UNAVAILABLE</strong><span>Use Neural or Classic to continue.</span></div>
      <header class="world-topbar">
        <div class="world-brand"><span class="world-brand-mark">W</span><span><strong>Universal World</strong><small>DISTRICT 01 / LOCAL</small></span></div>
        <div class="world-scene-meta"><strong>CYBERNETIC OPERATIONS BLOCK</strong><span>Square-aligned orthographic board · drag to pan · wheel zoom</span></div>
      </header>
      <aside class="world-panel" aria-live="polite" aria-label="Building details">
        <div class="world-panel-accent"></div>
        <div class="world-panel-head"><div><p class="world-kicker"></p><h2>Select a building</h2></div><button class="world-panel-close" type="button" aria-label="Close building details">×</button></div>
        <p class="world-panel-copy">Choose Office, Code Space or Memory to inspect its demo state and open the existing application controls.</p>
        <div class="world-status-row"></div><div class="world-panel-actions"></div>
      </aside>
      <aside class="world-activity" aria-label="Demo activity">
        <div class="world-activity-head"><strong>VISIBLE ACTIVITY</strong><span class="world-demo-pill" data-world-activity-mode>DEMO LOOP</span></div>
        <div class="world-event" data-world-event="code" style="--event-color:#4cecff"><i></i><span><b>Code Space</b> execution bay ready</span><time>DEMO</time></div>
        <div class="world-event" data-world-event="office" style="--event-color:#ff4ad8"><i></i><span><b>Office</b> dispatch queue illuminated</span><time>DEMO</time></div>
        <div class="world-event" data-world-event="memory" style="--event-color:#5cff98"><i></i><span><b>Memory</b> archive banks indexing</span><time>DEMO</time></div>
      </aside>
      <div class="world-building-dock" aria-label="Select a building">
        <button type="button" data-building="office" style="--dock-color:#ff4ad8"><i></i>OFFICE</button>
        <button type="button" data-building="code" style="--dock-color:#4cecff"><i></i>CODE SPACE</button>
        <button type="button" data-building="memory" style="--dock-color:#5cff98"><i></i>MEMORY</button>
      </div>
      <div class="world-controls"><button type="button" data-world-control="quality">QUALITY · MED</button><button type="button" data-world-control="zoom-out" aria-label="Zoom out">ZOOM −</button><input class="world-zoom-slider" data-world-control="zoom-slider" type="range" min="0.55" max="3" step="0.05" value="1" aria-label="World zoom"><button type="button" data-world-control="zoom-in" aria-label="Zoom in">ZOOM +</button><button type="button" data-world-control="reset">RESET VIEW</button><button type="button" data-world-control="motion">PAUSE</button></div>`;
    document.body.appendChild(root);
    canvasWrap = root.querySelector('.world-canvas-wrap');
    panel = root.querySelector('.world-panel');
    panelActions = root.querySelector('.world-panel-actions');

    switcher = document.createElement('nav');
    switcher.className = 'world-view-switcher';
    switcher.setAttribute('aria-label', 'Universal Space view');
    switcher.innerHTML = '<button type="button" data-view="world">World</button><button type="button" data-view="neural">Neural</button><button type="button" data-view="classic">Classic</button>';
    document.body.appendChild(switcher);

    switcher.addEventListener('click', event => {
      const view = event.target.closest('[data-view]')?.dataset.view;
      if (view) setView(view, true);
    });
    root.querySelector('.world-panel-close').addEventListener('click', closePanel);
    root.querySelectorAll('[data-building]').forEach(button => button.addEventListener('click', () => selectBuilding(button.dataset.building)));
    root.querySelector('[data-world-control="zoom-out"]').addEventListener('click', () => adjustZoom(1 / 1.25));
    root.querySelector('[data-world-control="zoom-in"]').addEventListener('click', () => adjustZoom(1.25));
    root.querySelector('[data-world-control="zoom-slider"]').addEventListener('input', event => {
      zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(event.currentTarget.value) || 1));
      resize();
    });
    root.querySelector('[data-world-control="reset"]').addEventListener('click', resetView);
    root.querySelector('[data-world-control="quality"]').addEventListener('click', cycleQuality);
    root.querySelector('[data-world-control="motion"]').addEventListener('click', event => {
      root.classList.toggle('motion-paused');
      event.currentTarget.textContent = root.classList.contains('motion-paused') ? 'RESUME' : 'PAUSE';
    });
    panelActions.addEventListener('click', event => {
      const button = event.target.closest('[data-app-kind]');
      if (button) runAction(button.dataset.appKind, button.dataset.appId, button.dataset.appAction);
    });
  }

  function setCurrentButton(view) {
    switcher?.querySelectorAll('[data-view]').forEach(button => {
      if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function placeSwitcher(view) {
    if (!switcher) return;
    const embedded = view !== 'world';
    switcher.classList.toggle('is-embedded', embedded);
    if (!embedded) {
      document.body.appendChild(switcher);
      return;
    }
    if (view === 'neural') {
      const header = document.querySelector('.universe-header');
      const resident = header?.querySelector('.universe-resident');
      if (header) header.insertBefore(switcher, resident || null);
      return;
    }
    const actions = document.querySelector('.topbar-actions');
    if (actions) actions.insertBefore(switcher, actions.firstChild);
  }

  function setView(view, updateUrl = false) {
    if (view === 'world') activate();
    else {
      deactivate();
      if (view === 'neural') globalThis.MolecularView?.activate?.();
      else globalThis.MolecularView?.deactivate?.();
      placeSwitcher(view);
      setCurrentButton(view);
    }
    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('view', view);
      history.replaceState({ view }, '', url);
    }
  }

  function runAction(kind, appId, actionId) {
    if (kind === 'view') return setView(actionId, true);
    if (kind === 'memory') {
      setView('classic', true);
      const target = actionId === 'new' ? '#newMemoryButton' : actionId === 'search' ? '#searchInput' : actionId === 'settings' ? '#contextButton' : null;
      window.setTimeout(() => {
        if (target === '#searchInput') document.querySelector(target)?.focus();
        else if (target) document.querySelector(target)?.click();
      }, 50);
      return;
    }
    if (appId === 'office' && actionId === 'office.open') {
      globalThis.UniversalAppAdapters?.dispatchAppAction?.(appId, actionId);
      return;
    }
    setView('neural', true);
    window.setTimeout(() => globalThis.UniversalAppAdapters?.dispatchAppAction?.(appId, actionId), 80);
  }

  function selectBuilding(id) {
    const app = APPS[id];
    if (!app) return;
    selectedId = id;
    panel.style.setProperty('--panel-accent', app.accent);
    panel.querySelector('.world-kicker').textContent = app.kicker;
    panel.querySelector('h2').textContent = app.title;
    panel.querySelector('.world-panel-copy').textContent = app.copy;
    const status = id === 'code' && codeActivity.source === 'live'
      ? ['Observed job state', codeActivity.state, 'Telemetry', 'Existing dispatch events']
      : [...app.status, ...app.secondary];
    panel.querySelector('.world-status-row').innerHTML = `<div class="world-status-card"><small>${status[0]}</small><strong>${status[1]}</strong></div><div class="world-status-card"><small>${status[2]}</small><strong>${status[3]}</strong></div>`;
    panelActions.innerHTML = app.actions.map(([label, kind, action, style = '']) => `<button type="button" class="${style}" data-app-kind="${kind}" data-app-id="${kind === 'view' || kind === 'memory' ? '' : kind}" data-app-action="${action}">${label}</button>`).join('');
    panel.classList.add('is-open');
    highlightSelection();
  }

  function closePanel() {
    selectedId = null;
    panel.classList.remove('is-open');
    highlightSelection();
  }

  function readQuality() {
    try {
      const stored = localStorage.getItem(QUALITY_KEY);
      return Object.hasOwn(QUALITY, stored) ? stored : 'medium';
    } catch {
      return 'medium';
    }
  }

  function applyQuality(nextQuality, persist = false) {
    quality = Object.hasOwn(QUALITY, nextQuality) ? nextQuality : 'medium';
    const settings = QUALITY[quality];
    if (renderer) {
      renderer.shadowMap.enabled = settings.shadows;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.dpr));
    }
    if (bloomPass) bloomPass.strength = settings.bloom;
    const button = root?.querySelector('[data-world-control="quality"]');
    if (button) button.textContent = `QUALITY · ${quality === 'medium' ? 'MED' : quality.toUpperCase()}`;
    if (persist) {
      try { localStorage.setItem(QUALITY_KEY, quality); } catch {}
    }
    resize();
  }

  function cycleQuality() {
    const order = ['low', 'medium', 'high'];
    applyQuality(order[(order.indexOf(quality) + 1) % order.length], true);
  }

  function setCodeActivity(state, dispatch = null) {
    const allowed = ['WAITING', 'WALKING', 'WORKING', 'COMPLETE', 'ERROR', 'UNKNOWN'];
    const next = allowed.includes(state) ? state : 'UNKNOWN';
    codeActivity = Object.freeze({ source: 'live', state: next, startedAt: performance.now(), dispatch });
    const messages = {
      WAITING: 'job waiting for authorisation',
      WALKING: 'authorised handoff observed',
      WORKING: 'execution reported running',
      COMPLETE: 'execution reported complete',
      ERROR: 'execution reported failed',
      UNKNOWN: 'telemetry state is unknown'
    };
    const mode = root?.querySelector('[data-world-activity-mode]');
    if (mode) {
      mode.textContent = 'LIVE + DEMO';
      mode.classList.add('is-live');
    }
    const event = root?.querySelector('[data-world-event="code"]');
    if (event) {
      event.querySelector('span').innerHTML = `<b>Code Space</b> ${messages[next]}`;
      event.querySelector('time').textContent = 'LIVE';
    }
    if (selectedId === 'code') selectBuilding('code');
  }

  function bindActivityEvents() {
    window.addEventListener('code-space-memory-dispatch-waiting', event => setCodeActivity('WAITING', event.detail));
    window.addEventListener('code-space-memory-dispatch-authorised', event => setCodeActivity('WALKING', event.detail));
    window.addEventListener('code-space-memory-dispatch-status', event => {
      const { dispatch, status } = event.detail || {};
      if (status === 'Running') setCodeActivity('WORKING', dispatch);
      else if (status === 'Completed') setCodeActivity('COMPLETE', dispatch);
      else if (status === 'Failed') setCodeActivity('ERROR', dispatch);
      else setCodeActivity('UNKNOWN', dispatch);
    });
    const waiting = globalThis.CodeSpaceAdapter?.getCurrentMemoryDispatchAcknowledgement?.();
    if (waiting) setCodeActivity('WAITING', waiting);
  }

  function highlightSelection() {
    pickables.forEach(mesh => {
      if (!mesh.material?.emissive || mesh.userData.baseEmissive == null) return;
      const selected = selectedId && mesh.userData.appId === selectedId;
      mesh.material.emissive.setHex(mesh.userData.baseEmissive);
      mesh.material.emissiveIntensity = selected ? Math.max(1.1, mesh.userData.baseIntensity || 0) : mesh.userData.baseIntensity || 0;
    });
    if (selectionRing) {
      const positions = {
        office: [0, .15, -5.4, 0xff4ad8],
        code: [6.15, .15, 2.7, 0x4cecff],
        memory: [-6.2, .15, 2.9, 0x5cff98]
      };
      const selected = positions[selectedId];
      selectionRing.visible = Boolean(selected);
      if (selected) {
        selectionRing.position.set(selected[0], .035, selected[2]);
        selectionRing.material.color.setHex(selected[3]);
      }
    }
  }

  function activate() {
    active = true;
    globalThis.MolecularView?.deactivate?.();
    document.body.classList.add('world-view-active');
    placeSwitcher('world');
    setCurrentButton('world');
    resize();
    startRendering();
  }

  function deactivate() {
    active = false;
    document.body.classList.remove('world-view-active');
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  function material(color, emissive = 0x000000, intensity = 0, extra = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .48, emissive, emissiveIntensity: intensity, ...extra });
  }

  function box(parent, size, position, mat, appId = null) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (appId) {
      mesh.userData.appId = appId;
      if (mat.emissive) {
        mesh.userData.baseEmissive = mat.emissive.getHex();
        mesh.userData.baseIntensity = mat.emissiveIntensity;
      }
      pickables.push(mesh);
    }
    parent.add(mesh);
    return mesh;
  }

  function cylinder(parent, radius, height, position, mat, segments = 16, appId = null) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), mat);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (appId) { mesh.userData.appId = appId; pickables.push(mesh); }
    parent.add(mesh);
    return mesh;
  }

  function signTexture(text, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = 'rgba(3,7,12,.88)';
    context.fillRect(8, 10, 496, 108);
    context.strokeStyle = color;
    context.lineWidth = 5;
    context.strokeRect(11, 13, 490, 102);
    context.shadowColor = color;
    context.shadowBlur = 22;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `800 ${text.length > 8 ? 49 : 58}px ui-monospace, monospace`;
    context.fillText(text, 256, 67);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function addSign(parent, text, color, position, scale, appId) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTexture(text, color), transparent: true, depthWrite: false }));
    sprite.position.set(...position);
    sprite.scale.set(scale, scale / 4, 1);
    sprite.userData.appId = appId;
    pickables.push(sprite);
    signs.push(sprite);
    parent.add(sprite);
    return sprite;
  }

  function addWindows(group, appId, floors, cols, start, spacing, color = 0xffad4f) {
    const glow = material(0x62472f, color, 1.65, { roughness: .42, metalness: .15 });
    for (let y = 0; y < floors; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if ((x + y * 2) % 5 === 0) continue;
        box(group, [.5, .32, .08], [start[0] + x * spacing[0], start[1] + y * spacing[1], start[2]], glow, appId);
      }
    }
  }

  function createOffice() {
    const g = new THREE.Group();
    g.position.set(0, 0, -5.4);
    g.userData.appId = 'office';
    buildingRoots.set('office', g);
    districtRoot.add(g);

    const fallback = new THREE.Group();
    fallback.name = 'office-empty-fallback';
    g.add(fallback);
    addSign(g, 'OFFICE', '#ff4ad8', [0, 10.7, 0], 3.15, 'office');
    queueBuildingAsset('office', 'office', g, fallback);
    return g;
  }

  function inspectLoadedModel(model) {
    let triangles = 0;
    let meshes = 0;
    model.traverse(object => {
      if (!object.isMesh || !object.geometry) return;
      meshes += 1;
      const geometry = object.geometry;
      const count = geometry.index?.count || geometry.attributes.position?.count || 0;
      triangles += Math.floor(count / 3);
    });
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    return { triangles, meshes, bounds, size };
  }

  async function loadBuildingAsset(assetKey, appId, parent, proceduralShell) {
    const asset = WORLD_ASSETS[assetKey];
    root.dataset[`${assetKey}Asset`] = 'loading';
    try {
      const { GLTFLoader } = await import(GLTF_LOADER_MODULE);
      const gltf = await new GLTFLoader().loadAsync(asset.url);
      const model = gltf.scene;
      const inspection = inspectLoadedModel(model);
      const finiteSize = inspection.size.toArray().every(value => Number.isFinite(value) && value > .05);
      if (!inspection.meshes || !finiteSize || inspection.triangles > asset.maxTriangles) {
        throw new Error(`Rejected ${asset.label} asset (${inspection.meshes} meshes, ${inspection.triangles} triangles).`);
      }

      const target = new THREE.Vector3(...asset.targetSize);
      const scale = Math.min(target.x / inspection.size.x, target.y / inspection.size.y, target.z / inspection.size.z);
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const center = scaledBounds.getCenter(new THREE.Vector3());
      model.position.set(-center.x, .12 - scaledBounds.min.y, -center.z);

      const assetRoot = new THREE.Group();
      assetRoot.name = `${appId}-meshy-shell`;
      assetRoot.rotation.y = asset.rotationY;
      assetRoot.add(model);
      model.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        object.userData.appId = appId;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.filter(Boolean).forEach(entry => {
          // Keep the authored Meshy PBR materials intact. Only improve texture
          // sampling so the embedded high-resolution maps stay crisp at oblique
          // angles instead of being smeared by low anisotropy.
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'].forEach(key => {
            const texture = entry[key];
            if (!texture) return;
            texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
            texture.needsUpdate = true;
          });
          if (entry.emissive) {
            object.userData.baseEmissive = entry.emissive.getHex();
            object.userData.baseIntensity = entry.emissiveIntensity || 0;
          }
        });
        pickables.push(object);
      });
      parent.add(assetRoot);
      proceduralShell.visible = false;
      root.dataset[`${assetKey}Asset`] = 'loaded';
      console.info(`Universal World loaded ${asset.label} shell: ${inspection.triangles} triangles.`);
    } catch (error) {
      root.dataset[`${assetKey}Asset`] = 'fallback';
      console.warn(`Universal World retained the procedural ${asset.label} shell.`, error);
    }
  }

  function queueBuildingAsset(assetKey, appId, parent, proceduralShell) {
    assetLoadQueue = assetLoadQueue.then(() => loadBuildingAsset(assetKey, appId, parent, proceduralShell));
  }

  function createCodeLab() {
    const g = new THREE.Group();
    g.position.set(6.15, 0, 2.7);
    g.userData.appId = 'code';
    buildingRoots.set('code', g);
    districtRoot.add(g);

    const fallback = new THREE.Group();
    fallback.name = 'code-space-empty-fallback';
    g.add(fallback);
    addSign(g, 'CODE SPACE', '#4cecff', [0, 7.7, 0], 3.75, 'code');
    queueBuildingAsset('codeLab', 'code', g, fallback);
    return g;
  }

  function createMemory() {
    const g = new THREE.Group();
    g.position.set(-6.2, 0, 2.9);
    g.userData.appId = 'memory';
    buildingRoots.set('memory', g);
    districtRoot.add(g);

    const fallback = new THREE.Group();
    fallback.name = 'memory-empty-fallback';
    g.add(fallback);
    addSign(g, 'MEMORY', '#5cff98', [0, 6.2, 0], 3.15, 'memory');
    queueBuildingAsset('memory', 'memory', g, fallback);
    return g;
  }

  function createPerson(parent, position, accent, scale = 1) {
    const g = new THREE.Group(); g.position.set(...position); g.scale.setScalar(scale); parent.add(g);
    const dark = material(0x1e2830);
    const glow = material(0x1d3d47, accent, 1.5);
    cylinder(g, .22, .76, [0, .84, 0], dark, 10);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.25, 12, 8), dark); head.position.y = 1.42; g.add(head);
    box(g, [.36, .18, .08], [0, 1.4, .22], glow);
    g.userData.leftArm = cylinder(g, .08, .62, [-.3, .85, 0], dark, 8);
    g.userData.rightArm = cylinder(g, .08, .62, [.3, .85, 0], dark, 8);
    g.userData.leftLeg = cylinder(g, .09, .68, [-.13, .25, 0], dark, 8);
    g.userData.rightLeg = cylinder(g, .09, .68, [.13, .25, 0], dark, 8);
    return g;
  }

  function createDistrict() {
    world = new THREE.Group();
    scene.add(world);

    districtRoot = new THREE.Group();
    districtRoot.name = 'universal-district-clean';
    world.add(districtRoot);

    // One single zero-thickness board. PlaneGeometry avoids the visible side
    // faces and overlapping slabs that made the previous world read as wedges.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      // Match the WebGL scene background exactly and ignore lighting so the
      // district has no visible board edge even when zoomed or panned.
      new THREE.MeshBasicMaterial({ color: 0x070b12 })
    );
    floor.name = 'district-square-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = false;
    districtRoot.add(floor);

    // GridHelper supplies one mathematically regular square grid: no staggered
    // tiles, perspective artwork, decorative road strips or layered foundations.
    const grid = new THREE.GridHelper(24, 12, 0x173944, 0x10242c);
    grid.name = 'district-square-grid';
    grid.position.y = .01;
    districtRoot.add(grid);

    selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(2.65, 2.78, 48),
      new THREE.MeshBasicMaterial({
        color: 0x4cecff,
        transparent: true,
        opacity: .7,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.y = .035;
    selectionRing.visible = false;
    districtRoot.add(selectionRing);

    createOffice();
    createCodeLab();
    createMemory();
    updateDistrictRotation();
  }

  async function initThree() {
    try {
      THREE = await import(THREE_MODULE);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, QUALITY[quality].dpr));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      // The standalone glTF viewer presents these assets with neutral/linear
      // lighting. ACES plus saturated world lights was crushing blacks and
      // making the same GLBs look muddy and lower-resolution.
      renderer.toneMapping = THREE.LinearToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = QUALITY[quality].shadows;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      canvasWrap.appendChild(renderer.domElement);
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x070b12);
      camera = new THREE.OrthographicCamera(-12, 12, 8, -8, .1, 100);
      updateCameraOrbit();
      // Neutral studio-style fill first, then very restrained coloured accent
      // lights. The old saturated lights were recolouring whole GLB facades.
      scene.add(new THREE.HemisphereLight(0xffffff, 0x29313a, 1.65));
      scene.add(new THREE.AmbientLight(0xffffff, .72));
      const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(8, 18, 10); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -16; key.shadow.camera.right = 16; key.shadow.camera.top = 16; key.shadow.camera.bottom = -16; scene.add(key);
      const fill = new THREE.DirectionalLight(0xcfe4ff, 1.1); fill.position.set(-10, 9, -8); scene.add(fill);
      const magenta = new THREE.PointLight(0xff34c8, 2.2, 13, 2); magenta.position.set(0, 5, -3); scene.add(magenta);
      const cyan = new THREE.PointLight(0x35dcff, 2.1, 12, 2); cyan.position.set(5, 3, 2); scene.add(cyan);
      const green = new THREE.PointLight(0x4fff8c, 1.8, 11, 2); green.position.set(-5, 3, 3); scene.add(green);
      raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2(); clock = new THREE.Clock();
      createDistrict(); bindCanvas(); resize();
      try {
        const [composerModule, renderPassModule, bloomModule] = await Promise.all([
          import(EFFECT_COMPOSER_MODULE), import(RENDER_PASS_MODULE), import(BLOOM_PASS_MODULE)
        ]);
        composer = new composerModule.EffectComposer(renderer);
        composer.addPass(new renderPassModule.RenderPass(scene, camera));
        bloomPass = new bloomModule.UnrealBloomPass(new THREE.Vector2(1, 1), QUALITY[quality].bloom, .58, 1.05);
        bloomPass.threshold = 1.05;
        bloomPass.strength = QUALITY[quality].bloom;
        bloomPass.radius = .58;
        composer.addPass(bloomPass);
        resize();
      } catch (error) {
        console.warn('Universal World bloom is unavailable; direct renderer remains active.', error);
        composer = null;
        bloomPass = null;
      }
      resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvasWrap);
      root.querySelector('.world-loading').remove();
      initialized = true;
      if (active) startRendering();
    } catch (error) {
      console.error('World view could not start:', error);
      root.classList.add('has-error');
    }
  }

  function bindCanvas() {
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Universal World city. Square-aligned orthographic view. Drag to pan, use the mouse wheel to zoom, or use arrow and plus/minus keys.');
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        angle: 0,
        mode: 'pan'
      };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      panX -= (event.clientX - drag.x) * ((camera.right - camera.left) / width);
      panY += (event.clientY - drag.y) * ((camera.top - camera.bottom) / height);
      drag.x = event.clientX;
      drag.y = event.clientY;
      resize();
    });
    canvas.addEventListener('pointerup', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      drag = null;
      if (moved < 7) pick(event);
    });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      adjustZoom(event.deltaY > 0 ? .9 : 1.1);
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const key = event.key;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_', 'r', 'R'].includes(key)) event.preventDefault();
      if (key === 'ArrowLeft') panX -= .6;
      else if (key === 'ArrowRight') panX += .6;
      else if (key === 'ArrowUp') panY += .6;
      else if (key === 'ArrowDown') panY -= .6;
      else if (key === '+' || key === '=') return adjustZoom(1.15);
      else if (key === '-' || key === '_') return adjustZoom(1 / 1.15);
      else if (key === 'r' || key === 'R') return resetView();
      else return;
      resize();
    });
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit?.object?.userData?.appId) selectBuilding(hit.object.userData.appId);
  }

  function resetView() {
    viewAngle = DEFAULT_VIEW_ANGLE;
    viewPitch = DEFAULT_VIEW_PITCH;
    districtAngle = 0;
    zoom = 1;
    const zoomSlider = root?.querySelector('[data-world-control="zoom-slider"]');
    if (zoomSlider) zoomSlider.value = String(zoom);
    panX = 0;
    panY = 0;
    updateCameraOrbit();
    updateDistrictRotation();
    resize();
  }

  function adjustZoom(factor) {
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    const zoomSlider = root?.querySelector('[data-world-control="zoom-slider"]');
    if (zoomSlider) zoomSlider.value = String(zoom);
    resize();
  }

  function updateCameraOrbit() {
    if (!camera) return;
    const pitch = DEFAULT_VIEW_PITCH;
    const angle = DEFAULT_VIEW_ANGLE;
    const horizontalDistance = CAMERA_DISTANCE * Math.cos(pitch);
    camera.position.set(
      Math.sin(angle) * horizontalDistance,
      CAMERA_TARGET_Y + Math.sin(pitch) * CAMERA_DISTANCE,
      Math.cos(angle) * horizontalDistance
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(0, CAMERA_TARGET_Y, 0);
  }

  function updateDistrictRotation() {
    if (!districtRoot) return;

    // Keep the board and every GLB locked to the same world axes. Rotation is
    // deliberately disabled so the district can never drift back into a
    // diagonal/diamond presentation.
    districtAngle = 0;
    districtRoot.rotation.y = 0;
    buildingRoots.forEach(rootGroup => {
      rootGroup.rotation.y = 0;
    });
  }

  function resize() {
    if (!renderer || !camera || !canvasWrap) return;
    const width = Math.max(1, canvasWrap.clientWidth);
    const height = Math.max(1, canvasWrap.clientHeight);
    const aspect = width / height;
    const span = (height < 650 ? 10.5 : 9.2) / zoom;
    camera.left = -span * aspect + panX; camera.right = span * aspect + panX;
    camera.top = span + panY; camera.bottom = -span + panY;
    camera.updateProjectionMatrix();
    const dpr = Math.min(devicePixelRatio || 1, QUALITY[quality].dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(dpr);
      composer.setSize(width, height);
    }
  }

  function animateWorker(time) {
    if (!worker || root.classList.contains('motion-paused') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const arms = [worker.userData.leftArm, worker.userData.rightArm];
    const legs = [worker.userData.leftLeg, worker.userData.rightLeg];
    const stand = () => {
      arms.forEach(arm => { arm.rotation.x = 0; });
      legs.forEach(leg => { leg.rotation.x = 0; });
      worker.position.copy(worker.userData.origin);
      worker.rotation.y = 0;
    };
    const typeAtDesk = () => {
      worker.position.copy(worker.userData.desk); worker.position.y = .48;
      worker.rotation.y = Math.PI;
      legs.forEach(leg => { leg.rotation.x = -1.15; });
      arms[0].rotation.x = -1.15 + Math.sin(time * 15) * .16;
      arms[1].rotation.x = -1.15 - Math.sin(time * 15) * .16;
    };
    if (codeActivity.source === 'live') {
      if (codeActivity.state === 'WORKING') return typeAtDesk();
      if (codeActivity.state === 'WALKING') {
        const progress = Math.min(1, (performance.now() - codeActivity.startedAt) / 5000);
        worker.position.lerpVectors(worker.userData.origin, worker.userData.desk, progress);
        worker.rotation.y = -.15;
        arms[0].rotation.x = Math.sin(time * 7) * .55; arms[1].rotation.x = -Math.sin(time * 7) * .55;
        legs[0].rotation.x = -Math.sin(time * 7) * .5; legs[1].rotation.x = Math.sin(time * 7) * .5;
        return;
      }
      stand();
      if (codeActivity.state === 'WAITING') worker.rotation.y = -.35 + Math.sin(time * .8) * .08;
      return;
    }
    const cycle = time % 16;
    if (cycle < 5.5) {
      const t = cycle / 5.5;
      worker.position.lerpVectors(worker.userData.origin, worker.userData.desk, t);
      worker.rotation.y = -.15;
      arms[0].rotation.x = Math.sin(time * 7) * .55; arms[1].rotation.x = -Math.sin(time * 7) * .55;
      legs[0].rotation.x = -Math.sin(time * 7) * .5; legs[1].rotation.x = Math.sin(time * 7) * .5;
    } else if (cycle < 13) {
      typeAtDesk();
    } else {
      const t = (cycle - 13) / 3;
      worker.position.lerpVectors(worker.userData.desk, worker.userData.origin, t);
      worker.rotation.y = Math.PI - t * Math.PI;
    }
  }

  function render() {
    animationFrame = 0;
    if (!active || !renderer || document.hidden) return;
    const time = clock.getElapsedTime();
    animateWorker(time);
    if (!root.classList.contains('motion-paused')) {
      if (core) { core.rotation.y += .009; core.material.emissiveIntensity = 1.2 + Math.sin(time * 2.4) * .18; }
      if (selectionRing?.visible) {
        selectionRing.rotation.z += .006;
        selectionRing.material.opacity = .62 + Math.sin(time * 3.2) * .22;
        const pulse = 1 + Math.sin(time * 2.4) * .025;
        selectionRing.scale.setScalar(pulse);
      }
      codeScreens.forEach((screen, index) => { screen.material.emissiveIntensity = 1.3 + Math.sin(time * 5 + index) * .22; });
      signs.forEach((sign, index) => { sign.material.opacity = .9 + Math.sin(time * 2.3 + index) * .08; });
    }
    if (composer && QUALITY[quality].bloom > 0) composer.render();
    else renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(render);
  }

  function startRendering() {
    if (!active || !initialized || animationFrame || document.hidden) return;
    clock.getDelta();
    animationFrame = requestAnimationFrame(render);
  }

  function mount() {
    createShell();
    quality = readQuality();
    applyQuality(quality);
    bindActivityEvents();
    document.addEventListener('visibilitychange', () => document.hidden ? deactivateRenderOnly() : startRendering());
    window.addEventListener('popstate', () => setView(new URL(location.href).searchParams.get('view') || 'world'));
    const initial = new URL(location.href).searchParams.get('view');
    setView(['world', 'neural', 'classic'].includes(initial) ? initial : 'world');
    initThree();
  }

  function deactivateRenderOnly() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  }

  globalThis.WorldView = Object.freeze({ activate, deactivate, selectBuilding });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
