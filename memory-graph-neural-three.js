(() => {
  'use strict';

  const VERSION = 3;
  const THREE_MODULE = './vendor/three/three.module.min.js';
  const MAX_DPR = 1.5;
  const params = new URLSearchParams(location.search);

  if (params.get('neuralRenderer') === 'canvas') return;

  let THREE = null;
  let sourceCanvas = null;
  let surface = null;
  let layer = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let structure = null;
  let rootMaterial = null;
  let rootHazeMaterial = null;
  let somaMaterial = null;
  let width = 1;
  let height = 1;
  let queued = false;
  let pendingRender = false;
  let activeHubIds = [];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const scaffold = () => globalThis.MemoryGraphNeuralScaffold || null;

  function hashText(value) {
    let result = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      result ^= text.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function seededRandom(seed) {
    let state = (Number(seed) >>> 0) || 0x9e3779b9;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function installStyles() {
    if (document.getElementById('memoryGraphNeuralThreeStyles')) return;
    const style = document.createElement('style');
    style.id = 'memoryGraphNeuralThreeStyles';
    style.textContent =
      '#memoryGraphSurface.memory-neural-three-active .memory-graph-neural-scaffold-canvas{opacity:0!important;visibility:hidden!important}' +
      '#memoryGraphSurface.memory-neural-three-active .memory-graph-neural-flow-canvas{display:none!important}' +
      '.memory-graph-neural-three-canvas{position:absolute;inset:0;z-index:1;display:block;width:100%;height:100%;pointer-events:none}';
    document.head.appendChild(style);
  }

  function disposeStructure() {
    if (!structure) return;
    structure.traverse((object) => object.geometry?.dispose?.());
    while (structure.children.length) structure.remove(structure.children[0]);
  }

  function ensureLayer() {
    const canvas = document.querySelector('.memory-graph-canvas');
    if (!canvas?.parentElement || !THREE) return false;
    if (layer && sourceCanvas === canvas && layer.isConnected) return true;

    layer?.remove();
    sourceCanvas = canvas;
    surface = canvas.parentElement;

    layer = document.createElement('canvas');
    layer.className = 'memory-graph-neural-three-canvas';
    layer.setAttribute('aria-hidden', 'true');
    surface.insertBefore(layer, canvas);

    renderer = new THREE.WebGLRenderer({
      canvas: layer,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(0, 1, 0, 1, 1, 500);
    camera.position.set(0, 0, 220);

    structure = new THREE.Group();
    scene.add(structure);

    rootMaterial = new THREE.MeshStandardMaterial({
      color: 0x31545d,
      roughness: 0.52,
      metalness: 0.02,
      emissive: 0x0b252b,
      emissiveIntensity: 0.72
    });
    rootHazeMaterial = new THREE.MeshBasicMaterial({
      color: 0x4ba1af,
      transparent: true,
      opacity: 0.10,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    somaMaterial = new THREE.MeshStandardMaterial({
      color: 0x29454d,
      roughness: 0.62,
      metalness: 0.02,
      emissive: 0x07171b,
      emissiveIntensity: 0.48
    });

    scene.add(new THREE.HemisphereLight(0x9fd9e7, 0x071014, 1.2));

    const key = new THREE.DirectionalLight(0xb9e9f2, 2.0);
    key.position.set(-180, -120, 240);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x315f6b, 1.1);
    rim.position.set(220, 180, 120);
    scene.add(rim);

    installStyles();
    surface.classList.add('memory-neural-three-active');
    return resize();
  }

  function resize() {
    if (!renderer || !sourceCanvas || !camera) return false;

    width = Math.max(1, Math.round(sourceCanvas.clientWidth));
    height = Math.max(1, Math.round(sourceCanvas.clientHeight));

    renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, MAX_DPR));
    renderer.setSize(width, height, false);
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

  function point3(point, z = 0) {
    return new THREE.Vector3(Number(point.x) || 0, Number(point.y) || 0, z);
  }

  function createWanderingPath(start, end, seed, jitterScale = 0.34) {
    const random = seededRandom(seed);
    const delta = end.clone().sub(start);
    const length = Math.max(1, delta.length());
    const segments = clamp(Math.round(length / 14), 9, 30);
    const step = length / segments;
    const direction = delta.clone().normalize();
    const points = [start.clone()];
    let current = start.clone();

    for (let index = 0; index < segments - 1; index += 1) {
      direction.x += (random() - 0.5) * jitterScale;
      direction.y += (random() - 0.5) * jitterScale;
      direction.z += (random() - 0.5) * jitterScale * 0.72;

      const targetDirection = end.clone().sub(current).normalize();
      direction.lerp(targetDirection, 0.12).normalize();

      current = current.clone().add(direction.clone().multiplyScalar(step));
      points.push(current);
    }

    const approachDistance = clamp(length * 0.055, 4, 11);
    const approach = end.clone().sub(delta.clone().normalize().multiplyScalar(approachDistance));
    approach.z += (random() - 0.5) * Math.min(13, length * 0.07);
    points[points.length - 1] = approach;
    points.push(end.clone());

    return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  }

  function taperTubeGeometry(geometry, startRadius, endRadius) {
    const positions = geometry.attributes.position;
    const normals = geometry.attributes.normal;
    const uv = geometry.attributes.uv;

    for (let index = 0; index < positions.count; index += 1) {
      const progress = clamp(uv.getX(index), 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      const radius = startRadius + (endRadius - startRadius) * eased;
      const shrink = startRadius - Math.max(0.12, radius);

      positions.setXYZ(
        index,
        positions.getX(index) - normals.getX(index) * shrink,
        positions.getY(index) - normals.getY(index) * shrink,
        positions.getZ(index) - normals.getZ(index) * shrink
      );
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  function addTube(curve, startRadius, endRadius, material = rootMaterial) {
    const tubularSegments = clamp(Math.round(curve.getLength() * 0.34), 18, 110);
    const geometry = new THREE.TubeGeometry(curve, tubularSegments, startRadius, 9, false);
    taperTubeGeometry(geometry, startRadius, endRadius);
    const mesh = new THREE.Mesh(geometry, material);
    structure.add(mesh);

    // Soft neutral tissue envelope. This is deliberately not bloom: it simply
    // gives the resting tubes a faint cloudy body against the star field.
    if (material === rootMaterial && rootHazeMaterial) {
      const hazeStart = startRadius * 1.42;
      const hazeEnd = Math.max(0.34, endRadius * 1.58);
      const hazeGeometry = new THREE.TubeGeometry(curve, tubularSegments, hazeStart, 7, false);
      taperTubeGeometry(hazeGeometry, hazeStart, hazeEnd);
      const haze = new THREE.Mesh(hazeGeometry, rootHazeMaterial);
      structure.add(haze);
    }

    return mesh;
  }

  function createSoma(center, radius, seed) {
    const geometry = new THREE.IcosahedronGeometry(radius, 2);
    const positions = geometry.attributes.position;
    const random = seededRandom(seed ^ 0x51f15e);

    for (let index = 0; index < positions.count; index += 1) {
      const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
      const scale = 0.88 + random() * 0.25;
      vertex.normalize().multiplyScalar(radius * scale);
      positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }

    positions.needsUpdate = true;
    geometry.computeVertexNormals();

    const soma = new THREE.Mesh(geometry, somaMaterial);
    soma.position.copy(center);
    soma.rotation.set(
      (random() - 0.5) * 0.6,
      (random() - 0.5) * 0.6,
      (random() - 0.5) * 0.45
    );
    structure.add(soma);
  }

  function addFreeTwigs(curve, baseRadius, seed, pathLength, density = 1) {
    const random = seededRandom(seed ^ 0xa53c91d7);
    const count = clamp(Math.round((pathLength / 95) * density + random() * 1.3), 0, 3);

    for (let index = 0; index < count; index += 1) {
      const t = 0.24 + random() * 0.58;
      const origin = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const side = new THREE.Vector3(
        -tangent.y,
        tangent.x,
        (random() - 0.5) * 0.9
      ).normalize();

      const sign = random() > 0.5 ? 1 : -1;
      const direction = tangent.clone().multiplyScalar(0.25 + random() * 0.25)
        .add(side.multiplyScalar(sign * (0.85 + random() * 0.55)))
        .normalize();

      const twigLength = clamp(pathLength * (0.13 + random() * 0.13), 12, 48);
      const end = origin.clone().add(direction.multiplyScalar(twigLength));
      const twig = createWanderingPath(
        origin,
        end,
        seed + index * 977 + 31,
        0.44 + random() * 0.18
      );

      addTube(twig, Math.max(0.55, baseRadius * (0.24 + random() * 0.09)), 0.22);
    }
  }

  function hubGroups(routes) {
    const groups = new Map();

    for (const route of routes) {
      if (!route.sourceHub || !route.from || !route.to) continue;
      const id = String(route.sourceId || 'hub');
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(route);
    }

    return [...groups.entries()]
      .map(([id, groupedRoutes]) => ({ id, routes: groupedRoutes }))
      .sort((a, b) => b.routes.length - a.routes.length);
  }

  function selectEvenly(routes, limit) {
    if (routes.length <= limit) return routes;
    const result = [];
    for (let index = 0; index < limit; index += 1) {
      result.push(routes[Math.floor(index * routes.length / limit)]);
    }
    return result;
  }

  function buildRootClusters(routes, center) {
    const sorted = [...routes].sort((a, b) => {
      const angleA = Math.atan2(a.to.y - center.y, a.to.x - center.x);
      const angleB = Math.atan2(b.to.y - center.y, b.to.x - center.x);
      return angleA - angleB;
    });

    const primaryCount = Math.min(
      sorted.length,
      Math.max(sorted.length < 5 ? 1 : 5, Math.min(8, Math.round(Math.sqrt(sorted.length) * 1.7)))
    );

    const clusters = Array.from({ length: primaryCount }, () => []);
    for (let index = 0; index < sorted.length; index += 1) {
      const clusterIndex = Math.min(
        primaryCount - 1,
        Math.floor(index * primaryCount / sorted.length)
      );
      clusters[clusterIndex].push(sorted[index]);
    }
    return clusters.filter((cluster) => cluster.length);
  }

  function buildOneNeuron(routes, hubId) {
    const usable = selectEvenly(routes, 26);
    if (!usable.length) return;

    const center2 = usable.reduce(
      (sum, route) => ({ x: sum.x + route.from.x, y: sum.y + route.from.y }),
      { x: 0, y: 0 }
    );
    center2.x /= usable.length;
    center2.y /= usable.length;

    const center = point3(center2, 0);
    const seed = hashText(hubId);
    const averageDistance = usable.reduce(
      (sum, route) => sum + Math.hypot(route.to.x - center2.x, route.to.y - center2.y),
      0
    ) / usable.length;

    const somaRadius = clamp(15 + Math.sqrt(usable.length) * 2.1, 18, 27);
    createSoma(center, somaRadius, seed);

    const clusters = buildRootClusters(usable, center2);

    clusters.forEach((cluster, clusterIndex) => {
      let targetX = 0;
      let targetY = 0;
      let averageRadius = 0;

      for (const route of cluster) {
        targetX += route.to.x;
        targetY += route.to.y;
        averageRadius += Math.hypot(route.to.x - center2.x, route.to.y - center2.y);
      }

      targetX /= cluster.length;
      targetY /= cluster.length;
      averageRadius /= cluster.length;

      const dx = targetX - center2.x;
      const dy = targetY - center2.y;
      const norm = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / norm;
      const uy = dy / norm;
      const px = -uy;
      const py = ux;
      const localSeed = seed + clusterIndex * 1193;
      const localRandom = seededRandom(localSeed);
      const junctionDistance = clamp(
        averageRadius * (0.30 + localRandom() * 0.10),
        somaRadius * 1.7,
        118
      );
      const lateral = (localRandom() - 0.5) * Math.min(28, averageRadius * 0.16);

      const junction = new THREE.Vector3(
        center.x + ux * junctionDistance + px * lateral,
        center.y + uy * junctionDistance + py * lateral,
        (localRandom() - 0.5) * 26
      );

      const trunkStart = center.clone().add(
        new THREE.Vector3(ux, uy, (localRandom() - 0.5) * 0.22)
          .normalize()
          .multiplyScalar(somaRadius * 0.42)
      );

      const trunk = createWanderingPath(
        trunkStart,
        junction,
        localSeed,
        0.26 + localRandom() * 0.12
      );

      const trunkStartRadius = clamp(
        somaRadius * (0.31 + localRandom() * 0.08),
        5.8,
        9.6
      );
      const trunkEndRadius = trunkStartRadius * (0.42 + localRandom() * 0.08);

      addTube(trunk, trunkStartRadius, trunkEndRadius);
      addFreeTwigs(trunk, trunkStartRadius, localSeed, trunk.getLength(), 0.95);

      cluster.forEach((route, branchIndex) => {
        const branchSeed = hashText(route.id || (hubId + ':' + branchIndex));
        const branchRandom = seededRandom(branchSeed);
        const target = point3(
          route.to,
          (branchRandom() - 0.5) * Math.min(15, averageDistance * 0.05)
        );
        const branchCurve = createWanderingPath(
          junction,
          target,
          branchSeed,
          0.34 + branchRandom() * 0.15
        );

        const branchStartRadius = Math.max(
          1.8,
          trunkEndRadius * (0.66 + branchRandom() * 0.18)
        );

        addTube(branchCurve, branchStartRadius, 0.55 + branchRandom() * 0.22);
        addFreeTwigs(
          branchCurve,
          branchStartRadius,
          branchSeed,
          branchCurve.getLength(),
          0.75
        );
      });
    });
  }

  function renderStructure() {
    const api = scaffold();
    if (!THREE || !api || !ensureLayer() || !resize()) return;

    const groups = hubGroups(api.routes());
    disposeStructure();

    if (!groups.length) {
      activeHubIds = [];
      renderer.render(scene, camera);
      return;
    }

    // The single-hub prototype passed human review. Render one compact neural
    // organism for every real app hub while preserving each hub's own topology.
    activeHubIds = groups.map((group) => group.id);
    for (const group of groups) {
      buildOneNeuron(group.routes, group.id);
    }
    renderer.render(scene, camera);
  }

  function queueRender() {
    if (!THREE) {
      pendingRender = true;
      return;
    }
    if (queued) return;

    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderStructure();
    });
  }

  window.addEventListener('memory-neural-routes-changed', queueRender);
  window.addEventListener('resize', queueRender);

  globalThis.MemoryGraphNeuralThree = Object.freeze({
    version: VERSION,
    renderer: 'three',
    structureOnly: true,
    activeHubs: () => [...activeHubIds],
    redraw: queueRender
  });

  import(THREE_MODULE).then((module) => {
    THREE = module;
    if (pendingRender || scaffold()?.routes?.().length) queueRender();
  }).catch((error) => {
    console.error('Memory Space Three.js neural renderer failed to load:', error);
  });
})();