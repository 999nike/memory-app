(() => {
  'use strict';
  const WORKSPACE_KEY = 'memory-space-v1';
  const GRAPH_STATE_KEY = 'memory-graph-layout-v1';
  const mode = new URLSearchParams(location.search).get('molecularEngine') === '1';
  if (!mode) return;

  let engine = null;
  let observer = null;
  const getWorkspace = () => { try { const state = JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null'); return state?.spaces && state?.memories ? state : null; } catch { return null; } };
  const getGraphState = () => { try { return JSON.parse(localStorage.getItem(GRAPH_STATE_KEY) || 'null'); } catch { return null; } };
  const click = (selector) => document.querySelector(selector)?.click() || false;
  function openProposals() {
    const panel = document.getElementById('phase2ChatPanel');
    if (!panel) return false;
    panel.classList.add('molecular-tool-open');
    panel.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return true;
  }
  const action = (name) => ({ 'add-memory': () => click('#newMemoryButton'), 'ai-access': () => click('.ai-access-launch'), context: () => click('#contextButton'), proposals: openProposals, workspace: () => globalThis.MolecularEngineAdapter?.deactivate() }[name]?.());

  const CONTROL_TREE = [
    { id: 'shared-memory', label: 'Shared Memory', kind: 'control', parentId: 'root', angle: -2.62, expandable: true, open: true },
    { id: 'add-memory', label: 'Add Memory', kind: 'action', parentId: 'shared-memory', angle: -3.24, orbit: 112, action: 'add-memory' },
    { id: 'search', label: 'Search', kind: 'action', parentId: 'shared-memory', angle: -3.02, orbit: 138 },
    { id: 'filters', label: 'Filters', kind: 'action', parentId: 'shared-memory', angle: -2.77, orbit: 104 },
    { id: 'notes', label: 'Notes', kind: 'action', parentId: 'shared-memory', angle: -2.48, orbit: 146 },
    { id: 'facts', label: 'Facts', kind: 'action', parentId: 'shared-memory', angle: -2.24, orbit: 98 },
    { id: 'decisions', label: 'Decisions', kind: 'action', parentId: 'shared-memory', angle: -2.02, orbit: 132 },
    { id: 'goals', label: 'Goals', kind: 'action', parentId: 'shared-memory', angle: -1.81, orbit: 106 },
    { id: 'inspector', label: 'Inspector', kind: 'action', parentId: 'shared-memory', angle: 2.86, orbit: 118 },
    { id: 'settings', label: 'Settings', kind: 'control', parentId: 'root', angle: .05, expandable: true },
    { id: 'ai-access', label: 'AI Access', kind: 'control-child', parentId: 'settings', angle: -.86, orbit: 164, expandable: true },
    { id: 'local-model', label: 'Local Model', kind: 'control-child', parentId: 'settings', angle: -.42, orbit: 132, expandable: true },
    { id: 'memory-bridge', label: 'Memory Bridge', kind: 'control-child', parentId: 'settings', angle: -.08, orbit: 172, expandable: true },
    { id: 'context-policy', label: 'Context Policy', kind: 'control-child', parentId: 'settings', angle: .25, orbit: 138, expandable: true, action: 'context' },
    { id: 'lifecycle', label: 'Lifecycle', kind: 'control-child', parentId: 'settings', angle: .57, orbit: 166, expandable: true },
    { id: 'ai-inbox', label: 'AI Inbox', kind: 'control-child', parentId: 'settings', angle: .89, orbit: 126, expandable: true, action: 'proposals' },
    ...['AI in this app', 'External AI apps', 'On-device AI', 'Connect AI', 'Advanced'].map((label, index) => ({ id: `ai-${index}`, label, kind: 'action', parentId: 'ai-access', angle: [-1.20, -.96, -.70, -.43, -.18][index], orbit: [88, 112, 94, 120, 101][index], action: index === 0 ? 'ai-access' : null })),
    ...['Ollama', 'LM Studio', 'OpenAI-compatible'].map((label, index) => ({ id: `local-${index}`, label, kind: 'action', parentId: 'local-model', angle: [-.72, -.38, -.05][index], orbit: [96, 118, 101][index] })),
    ...['Pair Bridge', 'Test', 'Share', 'Pull', 'MCP'].map((label, index) => ({ id: `bridge-${index}`, label, kind: 'action', parentId: 'memory-bridge', angle: [-.42, -.20, .04, .29, .51][index], orbit: [94, 121, 99, 126, 106][index] })),
    ...['Current confirmed', 'Approval required', 'Exclude archived'].map((label, index) => ({ id: `policy-${index}`, label, kind: 'action', parentId: 'context-policy', angle: [.03, .34, .62][index], orbit: [98, 122, 104][index] })),
    ...['Active', 'Locked', 'Critical', 'History', 'Archive'].map((label, index) => ({ id: `life-${index}`, label, kind: 'action', parentId: 'lifecycle', angle: [.24, .46, .70, .92, 1.13][index], orbit: [91, 118, 99, 125, 106][index] })),
    ...['Suggestions', 'Requires approval', 'Review'].map((label, index) => ({ id: `inbox-${index}`, label, kind: 'action', parentId: 'ai-inbox', angle: [.52, .82, 1.10][index], orbit: [96, 121, 103][index], action: index === 2 ? 'proposals' : null }))
  ];

  function model() {
    const workspace = getWorkspace();
    if (!workspace) return { nodes: [], edges: [] };
    const space = workspace.spaces.find((item) => item.id === workspace.activeSpaceId) || workspace.spaces[0];
    if (!space) return { nodes: [], edges: [], autoFrame: false };
    const allMemories = workspace.memories.filter((memory) => memory.spaceId === space.id);
    const memories = allMemories.filter((memory) => String(memory.status || 'confirmed') === 'confirmed');
    const width = Math.max(1, engine?.width || 1), height = Math.max(1, engine?.height || 1);
    const centreX = width / 2, centreY = height / 2, ring = Math.max(90, Math.min(width, height) * .32);
    const savedNodes = getGraphState()?.spaces?.[space.id]?.nodes || {};
    const root = { id: `space:${space.id}`, label: space.name || 'Memory Space', kind: 'core', fixed: true, x: centreX, y: centreY, radius: 40, payload: { durable: true, spaceId: space.id } };
    const memoryNodes = memories.map((memory, index) => {
      const relationshipCount = countRelationships(memory, allMemories);
      const importance = String(memory.importance || 'normal').toLowerCase();
      const savedX = Number(savedNodes[memory.id]?.offsetX), savedY = Number(savedNodes[memory.id]?.offsetY);
      const angle = -Math.PI / 2 + index / Math.max(1, memories.length) * Math.PI * 2;
      return {
        id: `memory:${memory.id}`, label: memory.title || 'Untitled memory', kind: 'memory', parentId: root.id,
        x: Number.isFinite(savedX) ? centreX + savedX * width : centreX + Math.cos(angle) * ring,
        y: Number.isFinite(savedY) ? centreY + savedY * height : centreY + Math.sin(angle) * ring,
        radius: ({ critical: 23, high: 19, normal: 15, low: 12 }[importance] || 15) + Math.min(3, Math.max(0, relationshipCount - 1)),
        orbit: Math.max(62, Math.min(width, height) * .27), recencyLevel: recencyScore(memory.updatedAt || memory.createdAt), importance,
        supersedesId: memory.supersedesId ? `memory:${memory.supersedesId}` : null,
        supersededById: memory.supersededById ? `memory:${memory.supersededById}` : null,
        locked: Boolean(memory.locked), payload: { durable: true, memoryId: memory.id }
      };
    });
    const edges = memoryNodes.map((node) => ({ source: root.id, target: node.id, kind: 'space' }));
    const byId = new Map(memoryNodes.map((node) => [node.id, node]));
    const revisions = new Set();
    for (const node of memoryNodes) for (const relatedId of [node.supersedesId, node.supersededById]) {
      if (!relatedId || !byId.has(relatedId) || relatedId === node.id) continue;
      const key = [node.id, relatedId].sort().join('::');
      if (revisions.has(key)) continue;
      revisions.add(key); edges.push({ source: node.id, target: relatedId, kind: 'revision' });
    }
    return { nodes: [root, ...memoryNodes], edges, autoFrame: false };
  }

  function countRelationships(memory, memories) {
    const related = new Set([memory.supersedesId, memory.supersededById].filter(Boolean).map(String));
    for (const other of memories) if (other?.id !== memory.id && (other.supersedesId === memory.id || other.supersededById === memory.id)) related.add(String(other.id));
    return 1 + related.size;
  }

  function recencyScore(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return .25;
    const age = Math.max(0, (Date.now() - timestamp) / 86400000);
    if (age <= 7) return 1;
    if (age <= 30) return .76;
    if (age <= 90) return .48;
    if (age <= 365) return .24;
    return .08;
  }
  function onNode(node) {
    if (node.payload?.memoryId) return click(`#memoryGrid .memory-card[data-memory-id="${CSS.escape(node.payload.memoryId)}"]`);
    if (node.action) action(node.action);
  }
  function activate() { document.body.classList.add('molecular-view-active', 'molecular-engine-active'); engine?.start(); }
  function deactivate() { document.body.classList.remove('molecular-engine-active'); engine?.stop(); }
  function mount() {
    const surface = document.getElementById('memoryGraphSurface'); if (!surface || !globalThis.MolecularEngine) return;
    engine = new globalThis.MolecularEngine({ surface, onNodeAction: onNode }); engine.setGraph(model()); activate();
    globalThis.MemoryGraphRotation = Object.freeze({
      snapshot: () => ({ yaw: engine.rotation.x, pitch: engine.rotation.y, active: Math.abs(engine.rotation.x) > .001 || Math.abs(engine.rotation.y) > .001, rotating: engine.pointer?.rotate === true })
    });
    observer = new MutationObserver(() => engine?.setGraph(model())); observer.observe(document.getElementById('memoryGrid') || document.body, { childList: true, subtree: true });
    globalThis.MolecularEngineAdapter = Object.freeze({
      engine,
      activate,
      deactivate,
      refresh: () => engine.setGraph(model()),
      projectedScene: () => engine.projectedScene()
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})();
