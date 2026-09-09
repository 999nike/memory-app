(() => {
  'use strict';

  const VERSION = 12;
  const GROUP_KEY = 'memory-graph-folders-v1';
  const GROUP_PREFIX = 'manual-group:';
  const PERSIST_DELAY_MS = 420;
  const GROUP_DRAG_THRESHOLD = 6;

  const baseRotation = globalThis.MemoryGraphRotation || null;
  if (!baseRotation || baseRotation.__manualGravityPhysicsWrapped) return;

  let lastGraph = null;
  let surface = null;
  let canvas = null;
  let persistTimer = 0;
  let lastScheduledSignature = '';
  let memoryPointer = null;
  let groupPointer = null;
  const pendingReleaseIds = new Set();

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function groupsApi() {
    return globalThis.MemoryGraphManualGroups || null;
  }

  function groupsForSpace() {
    return groupsApi()?.groups?.() || [];
  }

  function groupForMemory(memoryId) {
    return groupsApi()?.groupForMemory?.(memoryId) || null;
  }

  function canonicalGroupId(groupId) {
    return `${GROUP_PREFIX}${String(groupId || '')}`;
  }

  function groupRadius(group) {
    const count = Array.isArray(group?.members) ? group.members.length : 0;
    return 35 + Math.min(21, Math.sqrt(count) * 7.2);
  }

  function groupOrbit(graph) {
    const parityOrbit = Number(graph?.memoryGroupOrbit);
    if (Number.isFinite(parityOrbit)) return parityOrbit;
    const minSide = Math.max(1, Math.min(Number(graph?.width || 1), Number(graph?.height || 1)));
    return Math.max(72, minSide * 0.20);
  }

  function groupStart(group, graph) {
    const width = Math.max(1, Number(graph?.width || 1));
    const height = Math.max(1, Number(graph?.height || 1));
    const savedX = Number(group?.physicsOffsetX);
    const savedY = Number(group?.physicsOffsetY);
    if (Number.isFinite(savedX) && Number.isFinite(savedY)) {
      return {
        x: Number(graph.centreX || 0) + savedX * width,
        y: Number(graph.centreY || 0) + savedY * height
      };
    }
    const angle = Number.isFinite(Number(group?.angle)) ? Number(group.angle) : 0;
    const orbit = groupOrbit(graph);
    return {
      x: Number(graph.centreX || 0) + Math.cos(angle) * orbit,
      y: Number(graph.centreY || 0) + Math.sin(angle) * orbit
    };
  }

  function memberLayout(group, node, index) {
    const members = Array.isArray(group?.members) ? group.members.map(String) : [];
    const count = Math.max(1, members.length);
    const slotsPerRing = 8;
    const ring = Math.floor(index / slotsPerRing);
    const slot = index % slotsPerRing;
    const slotsOnRing = Math.min(slotsPerRing, Math.max(1, count - ring * slotsPerRing));
    const phase = Number(group?.phase || 0);
    const angle = phase + (slot / slotsOnRing) * Math.PI * 2 + ring * 0.36;
    const orbit = groupRadius(group) + 20 + ring * 21;
    return {
      angle,
      orbit,
      radius: Math.max(7, Number(node?.__manualGroupOriginalRadius || node?.radius || 12) * 0.60)
    };
  }

  function restoreUngroupedNode(node) {
    if (!node?.__manualGroupId) return false;
    node.parentId = node.__manualGroupOriginalParentId || lastGraph?.spaceNode?.id || node.parentId;
    node.localOrbit = Number(node.__manualGroupOriginalLocalOrbit || node.localOrbit || 72);
    node.targetOrbit = Number(node.__manualGroupOriginalTargetOrbit || node.targetOrbit || node.localOrbit || 72);
    node.radius = Number(node.__manualGroupOriginalRadius || node.radius || 12);
    node.vx = 0;
    node.vy = 0;
    delete node.__manualGroupId;
    delete node.__manualGroupOriginalParentId;
    delete node.__manualGroupOriginalLocalOrbit;
    delete node.__manualGroupOriginalTargetOrbit;
    delete node.__manualGroupOriginalRadius;
    return true;
  }

  function groupPositionSignature(graph, groups) {
    if (!graph) return '';
    return groups.map((group) => {
      const node = graph.nodes?.find((item) => item?.__manualGroupCanonical && item.manualGroupId === String(group.id));
      return node ? `${group.id}:${node.x.toFixed(3)},${node.y.toFixed(3)}` : `${group.id}:missing`;
    }).join('|');
  }

  function schedulePersist(graph, groups) {
    const signature = groupPositionSignature(graph, groups);
    if (!signature || signature === lastScheduledSignature) return;
    lastScheduledSignature = signature;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = 0;
      persistGroupPositions();
    }, PERSIST_DELAY_MS);
  }

  function persistGroupPositions() {
    const graph = lastGraph;
    const api = groupsApi();
    if (!graph || !api?.replaceGroups) return false;
    const width = Math.max(1, Number(graph.width || 1));
    const height = Math.max(1, Number(graph.height || 1));
    const centreX = Number(graph.centreX || 0);
    const centreY = Number(graph.centreY || 0);
    const groups = groupsForSpace();
    let changed = false;
    const next = groups.map((group) => {
      const node = graph.nodes?.find((item) => item?.__manualGroupCanonical && item.manualGroupId === String(group.id));
      if (!node) return group;
      const physicsOffsetX = (Number(node.x) - centreX) / width;
      const physicsOffsetY = (Number(node.y) - centreY) / height;
      const angle = Math.atan2(Number(node.y) - centreY, Number(node.x) - centreX);
      if (Math.abs(Number(group.physicsOffsetX) - physicsOffsetX) > 1e-6 ||
          Math.abs(Number(group.physicsOffsetY) - physicsOffsetY) > 1e-6 ||
          Math.abs(Number(group.angle) - angle) > 1e-6) changed = true;
      return { ...group, physicsOffsetX, physicsOffsetY, angle };
    });
    if (changed) api.replaceGroups(next);
    lastScheduledSignature = groupPositionSignature(graph, next);
    return changed;
  }

  function ensureCanonicalGroups(graph) {
    if (!graph?.spaceNode || !Array.isArray(graph.nodes) || !Array.isArray(graph.memoryNodes)) return false;
    lastGraph = graph;

    const groups = groupsForSpace();
    const memberToGroup = new Map();
    for (const group of groups) {
      for (const memberId of group.members || []) {
        const id = String(memberId);
        if (!pendingReleaseIds.has(id)) memberToGroup.set(id, group);
      }
    }

    for (const id of [...pendingReleaseIds]) {
      if (!groupForMemory(id)) pendingReleaseIds.delete(id);
    }

    const existingGroups = new Map(
      (graph.nodes || [])
        .filter((node) => node?.__manualGroupCanonical)
        .map((node) => [String(node.manualGroupId || ''), node])
    );
    const canonicalGroups = [];
    const orbit = groupOrbit(graph);

    for (const group of groups) {
      const id = String(group.id);
      let node = existingGroups.get(id);
      if (!node) {
        const start = groupStart(group, graph);
        node = {
          id: canonicalGroupId(id),
          manualGroupId: id,
          kind: 'control',
          label: String(group.title || 'Group'),
          x: start.x,
          y: start.y,
          vx: 0,
          vy: 0,
          radius: groupRadius(group),
          targetOrbit: orbit,
          localOrbit: orbit,
          gravityWeight: 1,
          parentId: graph.spaceNode.id,
          clusterRoot: false,
          action: '',
          expandable: false,
          controlDepth: 0,
          recencyLevel: 0.86,
          fixed: false,
          dragging: false,
          hidden: false,
          __manualGroupCanonical: true,
          groupMemberCount: Array.isArray(group.members) ? group.members.length : 0
        };
      }
      node.label = String(group.title || 'Group');
      node.radius = groupRadius(group);
      node.targetOrbit = orbit;
      node.localOrbit = orbit;
      node.parentId = graph.spaceNode.id;
      node.groupMemberCount = Array.isArray(group.members) ? group.members.length : 0;
      node.hidden = false;
      canonicalGroups.push(node);
    }

    const canonicalByGroupId = new Map(canonicalGroups.map((node) => [String(node.manualGroupId), node]));
    for (const node of graph.memoryNodes) {
      const memoryId = String(node.id);
      const group = memberToGroup.get(memoryId);
      if (!group) {
        restoreUngroupedNode(node);
        continue;
      }
      const groupNode = canonicalByGroupId.get(String(group.id));
      if (!groupNode) continue;
      const members = (group.members || []).map(String);
      const index = Math.max(0, members.indexOf(memoryId));
      const layout = memberLayout(group, node, index);
      const joining = String(node.__manualGroupId || '') !== String(group.id);

      if (!node.__manualGroupId) {
        node.__manualGroupOriginalParentId = node.parentId;
        node.__manualGroupOriginalLocalOrbit = node.localOrbit;
        node.__manualGroupOriginalTargetOrbit = node.targetOrbit;
        node.__manualGroupOriginalRadius = node.radius;
      }
      node.__manualGroupId = String(group.id);
      node.parentId = groupNode.id;
      node.localOrbit = layout.orbit;
      node.targetOrbit = layout.orbit;
      node.radius = layout.radius;
      if (joining) {
        node.x = groupNode.x + Math.cos(layout.angle) * layout.orbit;
        node.y = groupNode.y + Math.sin(layout.angle) * layout.orbit;
        node.vx = 0;
        node.vy = 0;
      }
    }

    const nonGroupNodes = graph.nodes.filter((node) => !node?.__manualGroupCanonical);
    graph.nodes = [...nonGroupNodes, ...canonicalGroups];

    const groupedIds = new Set(memberToGroup.keys());
    const baseEdges = (graph.edges || []).filter((edge) => {
      if (edge?.source?.__manualGroupCanonical || edge?.target?.__manualGroupCanonical) return false;
      if (edge?.kind === 'space' && edge?.source === graph.spaceNode && groupedIds.has(String(edge?.target?.id || ''))) return false;
      return true;
    });
    const groupEdges = [];
    for (const group of groups) {
      const groupNode = canonicalByGroupId.get(String(group.id));
      if (!groupNode) continue;
      groupEdges.push({ source: graph.spaceNode, target: groupNode, kind: 'space' });
      for (const memberId of group.members || []) {
        if (pendingReleaseIds.has(String(memberId))) continue;
        const memory = graph.memoryNodes.find((item) => String(item.id) === String(memberId));
        if (memory) groupEdges.push({ source: groupNode, target: memory, kind: 'space' });
      }
    }
    graph.edges = [...baseEdges, ...groupEdges];

    schedulePersist(graph, groups);
    return true;
  }

  function project(node, graph) {
    ensureCanonicalGroups(graph);
    const projected = baseRotation.project?.(node, graph);
    if (projected && Number.isFinite(projected.x) && Number.isFinite(projected.y)) return projected;
    return {
      x: Number(node?.x || 0),
      y: Number(node?.y || 0),
      radius: Number(node?.radius || 1),
      depth: 0,
      alpha: 1,
      scale: 1
    };
  }

  function prepareGroupedMemoryRelease(memoryId) {
    const id = String(memoryId || '');
    const node = lastGraph?.memoryNodes?.find((item) => String(item.id) === id);
    if (!id || !node || !groupForMemory(id)) return false;
    pendingReleaseIds.add(id);
    restoreUngroupedNode(node);
    node.vx = 0;
    node.vy = 0;
    return true;
  }

  function redrawGraph(wake = false) {
    if (lastGraph) ensureCanonicalGroups(lastGraph);
    if (wake) globalThis.MemoryGraph?.wakeSimulation?.();
    globalThis.MemoryGraph?.redraw?.();
    globalThis.MemoryGraphNeuralScaffold?.redraw?.();
    globalThis.MemoryGraphNeuralFlow?.redraw?.();
    return true;
  }

  function canvasPoint(event) {
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect) return null;
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function presentationState() {
    return globalThis.MemoryGraph?.presentationState?.() || null;
  }

  function screenPosition(node) {
    const state = presentationState();
    if (!state || !lastGraph || !node) return null;
    const projected = baseRotation.project?.(node, lastGraph) || node;
    return {
      x: Number(state.view?.x || 0) + Number(projected.x || 0) * Number(state.view?.scale || 1),
      y: Number(state.view?.y || 0) + Number(projected.y || 0) * Number(state.view?.scale || 1),
      radius: Number(projected.radius || node.radius || 1) * Number(state.view?.scale || 1)
    };
  }

  function hitNode(point, predicate) {
    if (!point || !lastGraph || baseRotation.isActive?.()) return null;
    const candidates = [...(lastGraph.nodes || [])].filter(predicate).reverse();
    for (const node of candidates) {
      const screen = screenPosition(node);
      if (!screen) continue;
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= screen.radius + 10) return node;
    }
    return null;
  }

  function groupNodeAt(point) {
    return hitNode(point, (node) => node?.__manualGroupCanonical === true);
  }

  function memoryNodeAt(point) {
    return hitNode(point, (node) => node?.kind === 'memory' && !node.hidden);
  }

  function refreshAfterMembershipChange() {
    ensureCanonicalGroups(lastGraph);
    globalThis.MemoryGraph?.wakeSimulation?.();
    globalThis.MemoryGraph?.redraw?.();
    return true;
  }

  function installPointerHooks() {
    if (!surface || !canvas || surface.__canonicalManualGroupPointerHooks) return;
    surface.__canonicalManualGroupPointerHooks = true;

    surface.addEventListener('pointerdown', (event) => {
      if (event.target !== canvas || event.button !== 0 || baseRotation.isActive?.()) return;
      const point = canvasPoint(event);
      const groupNode = groupNodeAt(point);
      groupPointer = groupNode ? {
        pointerId: event.pointerId,
        groupId: String(groupNode.manualGroupId),
        startX: point.x,
        startY: point.y,
        moved: false
      } : null;
      if (groupNode) {
        memoryPointer = null;
        return;
      }
      const memory = memoryNodeAt(point);
      memoryPointer = memory ? {
        pointerId: event.pointerId,
        memoryId: String(memory.id),
        startGroupId: String(memory.__manualGroupId || ''),
        startX: point.x,
        startY: point.y,
        moved: false
      } : null;
    });

    surface.addEventListener('pointermove', (event) => {
      const point = canvasPoint(event);
      if (!point) return;
      if (groupPointer?.pointerId === event.pointerId &&
          Math.hypot(point.x - groupPointer.startX, point.y - groupPointer.startY) > GROUP_DRAG_THRESHOLD) {
        groupPointer.moved = true;
      }
      if (memoryPointer?.pointerId === event.pointerId &&
          Math.hypot(point.x - memoryPointer.startX, point.y - memoryPointer.startY) > GROUP_DRAG_THRESHOLD) {
        memoryPointer.moved = true;
      }
    });

    surface.addEventListener('pointerup', (event) => {
      const point = canvasPoint(event);
      if (!point) return;

      if (groupPointer?.pointerId === event.pointerId) {
        const active = groupPointer;
        groupPointer = null;
        const hit = groupNodeAt(point);
        if (!active.moved && hit && String(hit.manualGroupId) === active.groupId) {
          groupsApi()?.openGroup?.(active.groupId);
        } else if (active.moved) {
          schedulePersist(lastGraph, groupsForSpace());
        }
      }

      if (memoryPointer?.pointerId === event.pointerId) {
        const active = memoryPointer;
        memoryPointer = null;
        if (!active.moved) return;
        const target = groupNodeAt(point);
        const targetId = String(target?.manualGroupId || '');
        if (targetId && targetId !== active.startGroupId) {
          if (groupsApi()?.addMemoryToGroup?.(active.memoryId, targetId)) refreshAfterMembershipChange();
          return;
        }
        if (!targetId && active.startGroupId) {
          if (prepareGroupedMemoryRelease(active.memoryId) && groupsApi()?.detachMemory?.(active.memoryId)) {
            refreshAfterMembershipChange();
          }
        }
      }
    });

    surface.addEventListener('pointercancel', (event) => {
      if (groupPointer?.pointerId === event.pointerId) groupPointer = null;
      if (memoryPointer?.pointerId === event.pointerId) memoryPointer = null;
    });
  }

  function installCanvasLabelHook() {
    const proto = globalThis.CanvasRenderingContext2D?.prototype;
    if (!proto || proto.__canonicalManualGroupLabelHook) return;
    Object.defineProperty(proto, '__canonicalManualGroupLabelHook', { value: true });
    const previousFillText = proto.fillText;

    proto.fillText = function canonicalManualGroupFillText(text, x, y, ...rest) {
      const node = this?.__memoryGraphLabelNode;
      if (!this?.canvas?.classList?.contains('memory-graph-canvas') || !node?.__manualGroupCanonical) {
        return previousFillText.call(this, text, x, y, ...rest);
      }
      const projected = lastGraph ? (baseRotation.project?.(node, lastGraph) || node) : node;
      const px = Number(projected.x || node.x || x);
      const py = Number(projected.y || node.y || y);
      const radius = Number(projected.radius || node.radius || 35);
      this.save();
      try {
        this.globalAlpha = Number(projected.alpha || 1);
        this.textAlign = 'center';
        this.textBaseline = 'middle';
        this.fillStyle = 'rgba(242, 244, 247, 0.96)';
        this.font = `800 ${clamp(radius * 0.28, 11, 15)}px Inter, system-ui, sans-serif`;
        const title = String(node.label || 'Group');
        previousFillText.call(this, title.length > 15 ? `${title.slice(0, 14).trim()}…` : title, px, py - 3);
        this.fillStyle = 'rgba(199, 255, 86, 0.86)';
        this.font = '750 10px Inter, system-ui, sans-serif';
        const count = Number(node.groupMemberCount || 0);
        previousFillText.call(this, `${count} ${count === 1 ? 'memory' : 'memories'}`, px, py + Math.min(17, radius * 0.36));
        return undefined;
      } finally {
        this.restore();
      }
    };
  }

  const wrappedRotation = Object.freeze({
    ...baseRotation,
    __manualGravityPhysicsWrapped: true,
    version: `${baseRotation.version || 1}+canonical-groups${VERSION}`,
    project,
    snapshot() {
      return {
        ...(baseRotation.snapshot?.() || {}),
        canonicalManualGroupsVersion: VERSION,
        canonicalManualGroups: groupsForSpace().length
      };
    }
  });
  globalThis.MemoryGraphRotation = wrappedRotation;

  function mount() {
    surface = document.getElementById('memoryGraphSurface');
    canvas = surface?.querySelector('.memory-graph-canvas') || null;
    if (!surface || !canvas) return false;
    surface.querySelectorAll('.memory-graph-manual-gravity-canvas,.memory-graph-manual-gravity-body-canvas,.memory-graph-manual-group-canvas')
      .forEach((element) => element.remove());
    installPointerHooks();
    globalThis.MemoryGraph?.redraw?.();
    return true;
  }

  installCanvasLabelHook();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(mount), { once: true });
  } else {
    requestAnimationFrame(mount);
  }

  window.addEventListener('storage', (event) => {
    if (event.key !== GROUP_KEY) return;
    lastScheduledSignature = '';
    redrawGraph(true);
  });

  globalThis.MemoryGraphManualGravity = Object.freeze({
    version: VERSION,
    bodyCount: () => groupsForSpace().length,
    isGroupedMemory: (memoryId) => Boolean(groupForMemory(memoryId)),
    prepareGroupedMemoryRelease,
    persist: persistGroupPositions,
    redraw: () => redrawGraph(true),
    redrawOnly: () => redrawGraph(false),
    wake: () => redrawGraph(true)
  });
})();
