(() => {
  'use strict';

  const records = new Map();
  const activities = new Map();
  const refreshControllers = new Map();
  const STATE_EVENT = 'universal-app-state-change';
  const HIERARCHY_EVENT = 'universal-app-hierarchy-change';
  const ACTIVITY_EVENT = 'universal-app-activity-change';

  function localNodeId(appId, value) {
    const id = String(value || '');
    return id.startsWith(`${appId}:`) ? id.slice(appId.length + 1) : id;
  }

  function normalizeNode(appId, value) {
    const nodeId = localNodeId(appId, value?.nodeId || value?.id);
    if (!nodeId) throw new Error(`App adapter ${appId} has a node without an id`);
    return Object.freeze({
      id: `${appId}:${nodeId}`,
      nodeId,
      label: String(value.label || nodeId),
      stateKey: value.stateKey ? String(value.stateKey) : null,
      stateLabel: Boolean(value.stateLabel),
      stateInLabel: value.stateInLabel !== false,
      state: value.state && typeof value.state === 'object' ? Object.freeze({ ...value.state }) : null,
      action: value.action ? String(value.action) : null,
      view: value.view ? String(value.view) : null,
      expandable: Boolean(value.expandable || value.children?.length),
      children: Object.freeze((value.children || []).map((child) => normalizeNode(appId, child)))
    });
  }

  function normalizeDefinition(adapter) {
    const value = typeof adapter.getDefinition === 'function' ? adapter.getDefinition() : adapter.definition;
    const appId = String(value?.id || adapter.id || '');
    if (!appId) throw new Error('App adapter requires an id');
    return Object.freeze({
      id: appId,
      name: String(value.name || value.label || appId),
      nodes: Object.freeze((value.nodes || value.children || []).map((node) => normalizeNode(appId, node))),
      actions: Object.freeze([...(value.actions || [])].map(String)),
      views: Object.freeze([...(value.views || [])].map(String))
    });
  }

  function nodeUpdates(definition, state) {
    const updates = [];
    const visit = (nodes) => {
      for (const node of nodes) {
        const hasValue = Boolean(node.stateKey && Object.hasOwn(state, node.stateKey));
        const value = hasValue ? state[node.stateKey] : null;
        const nodeState = { ...(node.state || {}) };
        if (hasValue) nodeState.value = value;
        updates.push({
          id: node.id,
          label: hasValue && node.stateInLabel ? (node.stateLabel ? String(value) : `${node.label}: ${value}`) : node.label,
          state: Object.keys(nodeState).length ? nodeState : null
        });
        visit(node.children);
      }
    };
    visit(definition.nodes);
    return updates;
  }

  function registerAppAdapter(adapter) {
    const definition = normalizeDefinition(adapter || {});
    records.set(definition.id, {
      adapter,
      definition,
      state: Object.freeze({})
    });
    return definition;
  }

  function getAppAdapter(appId) {
    return records.get(String(appId || ''))?.adapter || null;
  }

  function getAppDefinition(appId) {
    return records.get(String(appId || ''))?.definition || null;
  }

  function getAppDefinitions() {
    return [...records.values()].map((record) => record.definition);
  }

  function getAppState(appId) {
    return records.get(String(appId || ''))?.state || null;
  }

  function getAppNodeUpdates(appId) {
    const record = records.get(String(appId || ''));
    return record ? nodeUpdates(record.definition, record.state) : [];
  }

  function updateAppState(appId, state) {
    const record = records.get(String(appId || ''));
    if (!record) return false;
    const nextState = { ...(state || {}) };
    const previousKeys = Object.keys(record.state);
    const nextKeys = Object.keys(nextState);
    if (previousKeys.length === nextKeys.length && nextKeys.every((key) => Object.is(record.state[key], nextState[key]))) return true;
    record.state = Object.freeze(nextState);
    document.dispatchEvent(new CustomEvent(STATE_EVENT, {
      detail: { appId: record.definition.id, updates: nodeUpdates(record.definition, record.state) }
    }));
    return true;
  }

  function startAppRefresh(appId, options = {}) {
    const id = String(appId || '');
    const record = records.get(id);
    if (!record || typeof record.adapter?.refresh !== 'function') return null;
    if (refreshControllers.has(id)) return refreshControllers.get(id);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 15000);
    let timer = null;
    let inFlight = false;
    let stopped = false;
    const run = async () => {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      try { await record.adapter.refresh(); } catch { /* adapter owns error state */ }
      finally { inFlight = false; }
    };
    const schedule = () => {
      if (stopped || document.hidden) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => { await run(); schedule(); }, intervalMs);
    };
    const refreshNow = () => { run().then(schedule); };
    const onVisibility = () => { if (document.hidden) { if (timer) clearTimeout(timer); timer = null; } else refreshNow(); };
    const onFocus = () => refreshNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    const controller = Object.freeze({ stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      refreshControllers.delete(id);
    }});
    refreshControllers.set(id, controller);
    refreshNow();
    return controller;
  }

  function replaceNodeChildren(nodes, targetNodeId, children) {
    let found = false;
    const nextNodes = nodes.map((node) => {
      if (node.nodeId === targetNodeId) {
        found = true;
        return Object.freeze({ ...node, expandable: true, children });
      }
      const nested = replaceNodeChildren(node.children, targetNodeId, children);
      if (!nested.found) return node;
      found = true;
      return Object.freeze({ ...node, children: nested.nodes });
    });
    return { found, nodes: Object.freeze(nextNodes) };
  }

  function replaceAppNodeChildren(appId, parentNodeId, children = []) {
    const record = records.get(String(appId || ''));
    if (!record) return false;
    const targetNodeId = localNodeId(record.definition.id, parentNodeId);
    const normalizedChildren = Object.freeze(children.map((node) => normalizeNode(record.definition.id, node)));
    const replacement = replaceNodeChildren(record.definition.nodes, targetNodeId, normalizedChildren);
    if (!replacement.found) return false;
    record.definition = Object.freeze({ ...record.definition, nodes: replacement.nodes });
    document.dispatchEvent(new CustomEvent(HIERARCHY_EVENT, {
      detail: {
        appId: record.definition.id,
        parentId: `${record.definition.id}:${targetNodeId}`,
        children: normalizedChildren
      }
    }));
    return true;
  }

  function dispatchAppAction(appId, actionId, context = {}) {
    const record = records.get(String(appId || ''));
    if (!record || typeof record.adapter.handleAction !== 'function') return false;
    return record.adapter.handleAction(String(actionId || ''), {
      ...context,
      appId: record.definition.id,
      actionId: String(actionId || '')
    });
  }

  function activityKey(appId, nodeId) {
    return `${String(appId || '')}:${localNodeId(String(appId || ''), nodeId)}`;
  }

  function getAppActivity(appId, nodeId) {
    return activities.get(activityKey(appId, nodeId)) || null;
  }

  function getAppActivities(appId) {
    const id = String(appId || '');
    return [...activities.values()].filter((activity) => activity.appId === id);
  }

  function setAppActivity(appId, nodeId, activity = {}) {
    const id = String(appId || '');
    const localId = localNodeId(id, nodeId);
    if (!records.has(id) || !localId) return false;
    if (activity.pending !== true) return clearAppActivity(id, localId);

    const next = Object.freeze({
      appId: id,
      nodeId: localId,
      pending: true,
      count: Math.max(1, Number(activity.count) || 1)
    });
    const key = activityKey(id, localId);
    const current = activities.get(key);
    if (current?.pending === next.pending && current?.count === next.count) return true;
    activities.set(key, next);
    document.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: next }));
    return true;
  }

  function clearAppActivity(appId, nodeId) {
    const id = String(appId || '');
    const localId = localNodeId(id, nodeId);
    const key = activityKey(id, localId);
    if (!activities.delete(key)) return true;
    document.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, {
      detail: { appId: id, nodeId: localId, pending: false, count: 0 }
    }));
    return true;
  }

  globalThis.UniversalAppAdapters = Object.freeze({
    stateEvent: STATE_EVENT,
    hierarchyEvent: HIERARCHY_EVENT,
    activityEvent: ACTIVITY_EVENT,
    registerAppAdapter,
    getAppAdapter,
    getAppDefinition,
    getAppDefinitions,
    getAppState,
    getAppNodeUpdates,
    updateAppState,
    startAppRefresh,
    replaceAppNodeChildren,
    dispatchAppAction,
    getAppActivity,
    getAppActivities,
    setAppActivity,
    clearAppActivity
  });
})();
