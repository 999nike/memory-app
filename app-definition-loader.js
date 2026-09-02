(() => {
  'use strict';

  const SCHEMA_VERSION = 1;
  const MAX_NODES = 200;
  const MAX_DEPTH = 8;
  const MAX_DEFINITION_CHARS = 100000;
  const MAX_ID_LENGTH = 96;
  const MAX_LABEL_LENGTH = 160;
  const APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
  const ACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
  const DEFINITION_KEYS = new Set(['schemaVersion', 'id', 'name', 'nodes']);
  const NODE_KEYS = new Set([
    'id', 'label', 'children', 'expandable', 'action', 'view', 'state',
    'stateKey', 'stateLabel', 'stateInLabel'
  ]);

  class AppDefinitionError extends Error {
    constructor(code, path, message) {
      super(`${path}: ${message}`);
      this.name = 'AppDefinitionError';
      this.code = code;
      this.path = path;
    }
  }

  function fail(code, path, message) {
    throw new AppDefinitionError(code, path, message);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertKnownKeys(value, allowedKeys, path) {
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) fail('unknown_field', `${path}.${key}`, 'is not supported by schema version 1');
    }
  }

  function requiredString(value, path, maxLength, pattern = null) {
    if (typeof value !== 'string' || !value.trim()) fail('invalid_string', path, 'must be a non-empty string');
    const result = value.trim();
    if (result.length > maxLength) fail('value_too_long', path, `must be at most ${maxLength} characters`);
    if (pattern && !pattern.test(result)) fail('invalid_format', path, 'contains unsupported characters');
    return result;
  }

  function optionalString(value, path, maxLength, pattern = null) {
    if (value === undefined) return null;
    return requiredString(value, path, maxLength, pattern);
  }

  function cloneJsonValue(value, path, depth = 0) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('invalid_state', path, 'must contain only finite JSON numbers');
      return value;
    }
    if (depth >= MAX_DEPTH) fail('state_too_deep', path, `must not exceed ${MAX_DEPTH} nested levels`);
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`, depth + 1)));
    }
    if (!isPlainObject(value)) fail('invalid_state', path, 'must contain only JSON-compatible data');
    const clone = {};
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneJsonValue(item, `${path}.${key}`, depth + 1);
    }
    return Object.freeze(clone);
  }

  function localNodeId(appId, value) {
    return value.startsWith(`${appId}:`) ? value.slice(appId.length + 1) : value;
  }

  function addDefinitionIds(ids, definition) {
    ids.add(String(definition.id));
    const visit = (nodes) => {
      for (const node of nodes || []) {
        ids.add(String(node.id));
        visit(node.children);
      }
    };
    visit(definition.nodes);
  }

  function occupiedGraphIds() {
    const ids = new Set(['settings']);
    const registry = globalThis.UniversalAppAdapters;
    for (const definition of registry?.getAppDefinitions?.() || []) addDefinitionIds(ids, definition);
    for (const id of globalThis.MemoryApp?.graphNodeIds?.() || []) ids.add(String(id));
    return ids;
  }

  function validateDefinition(value) {
    if (!isPlainObject(value)) fail('invalid_definition', 'definition', 'must be a plain object');
    assertKnownKeys(value, DEFINITION_KEYS, 'definition');
    if (value.schemaVersion !== SCHEMA_VERSION) {
      fail('unsupported_version', 'definition.schemaVersion', `must equal ${SCHEMA_VERSION}`);
    }

    const appId = requiredString(value.id, 'definition.id', 64, APP_ID_PATTERN);
    const name = requiredString(value.name, 'definition.name', MAX_LABEL_LENGTH);
    if (!Array.isArray(value.nodes)) fail('invalid_nodes', 'definition.nodes', 'must be an array');
    if (!value.nodes.length) fail('invalid_nodes', 'definition.nodes', 'must contain at least one node');

    const occupiedIds = occupiedGraphIds();
    if (occupiedIds.has(appId)) fail('id_collision', 'definition.id', `collides with existing graph id ${appId}`);

    let nodeCount = 0;
    const normalizedIds = new Set();
    const actions = new Set();
    const views = new Set();

    const validateNode = (node, path, depth) => {
      if (depth > MAX_DEPTH) fail('definition_too_deep', path, `exceeds the ${MAX_DEPTH}-level limit`);
      if (!isPlainObject(node)) fail('invalid_node', path, 'must be a plain object');
      assertKnownKeys(node, NODE_KEYS, path);
      nodeCount += 1;
      if (nodeCount > MAX_NODES) fail('definition_too_large', 'definition.nodes', `exceeds the ${MAX_NODES}-node limit`);

      const suppliedId = requiredString(node.id, `${path}.id`, MAX_ID_LENGTH, NODE_ID_PATTERN);
      const localId = localNodeId(appId, suppliedId);
      if (!localId) fail('invalid_node_id', `${path}.id`, 'must identify a node below the app root');
      const normalizedId = `${appId}:${localId}`;
      if (normalizedIds.has(normalizedId)) fail('duplicate_node_id', `${path}.id`, `duplicates normalized id ${normalizedId}`);
      if (occupiedIds.has(normalizedId)) fail('id_collision', `${path}.id`, `collides with existing graph id ${normalizedId}`);
      normalizedIds.add(normalizedId);

      const label = requiredString(node.label, `${path}.label`, MAX_LABEL_LENGTH);
      const action = optionalString(node.action, `${path}.action`, MAX_ID_LENGTH, ACTION_ID_PATTERN);
      const view = optionalString(node.view, `${path}.view`, MAX_ID_LENGTH, ACTION_ID_PATTERN);
      const stateKey = optionalString(node.stateKey, `${path}.stateKey`, MAX_ID_LENGTH, ACTION_ID_PATTERN);
      if (view && !action) fail('unbound_view', `${path}.view`, 'requires an action binding');
      if (action) actions.add(action);
      if (view) views.add(view);

      for (const booleanKey of ['expandable', 'stateLabel', 'stateInLabel']) {
        if (node[booleanKey] !== undefined && typeof node[booleanKey] !== 'boolean') {
          fail('invalid_boolean', `${path}.${booleanKey}`, 'must be a boolean');
        }
      }
      if (node.state !== undefined && !isPlainObject(node.state)) {
        fail('invalid_state', `${path}.state`, 'must be a JSON-compatible object');
      }
      if (node.children !== undefined && !Array.isArray(node.children)) {
        fail('invalid_children', `${path}.children`, 'must be an array');
      }

      const children = Object.freeze((node.children || []).map((child, index) =>
        validateNode(child, `${path}.children[${index}]`, depth + 1)
      ));
      return Object.freeze({
        id: localId,
        label,
        ...(stateKey ? { stateKey } : {}),
        ...(node.stateLabel !== undefined ? { stateLabel: node.stateLabel } : {}),
        ...(node.stateInLabel !== undefined ? { stateInLabel: node.stateInLabel } : {}),
        ...(node.state !== undefined ? { state: cloneJsonValue(node.state, `${path}.state`) } : {}),
        ...(action ? { action } : {}),
        ...(view ? { view } : {}),
        ...(node.expandable !== undefined ? { expandable: node.expandable } : {}),
        ...(children.length ? { children } : {})
      });
    };

    const nodes = Object.freeze(value.nodes.map((node, index) => validateNode(node, `definition.nodes[${index}]`, 1)));
    const validated = Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      id: appId,
      name,
      nodes,
      actions: Object.freeze([...actions]),
      views: Object.freeze([...views])
    });
    if (JSON.stringify(validated).length > MAX_DEFINITION_CHARS) {
      fail('definition_too_large', 'definition', `exceeds the ${MAX_DEFINITION_CHARS}-character limit`);
    }
    return validated;
  }

  function createAdapter(definition, capabilityMap) {
    const validated = validateDefinition(definition);
    if (!isPlainObject(capabilityMap)) fail('invalid_capabilities', 'capabilityMap', 'must be a plain object');

    const handlers = Object.create(null);
    for (const actionId of validated.actions) {
      if (!Object.hasOwn(capabilityMap, actionId) || typeof capabilityMap[actionId] !== 'function') {
        fail('missing_capability', `capabilityMap.${actionId}`, 'must provide a handler function');
      }
      handlers[actionId] = capabilityMap[actionId];
    }

    return Object.freeze({
      id: validated.id,
      definition: validated,
      handleAction(actionId, context = {}) {
        const handler = handlers[String(actionId || '')];
        return typeof handler === 'function' ? handler(context) : false;
      }
    });
  }

  function loadDefinition(definition, capabilityMap) {
    const registry = globalThis.UniversalAppAdapters;
    if (!registry?.registerAppAdapter) fail('registry_unavailable', 'UniversalAppAdapters', 'is not ready');
    const adapter = createAdapter(definition, capabilityMap);
    registry.registerAppAdapter(adapter);
    return adapter;
  }

  function showDemoCapability(titleText, message) {
    const shell = document.querySelector('.app-shell');
    const title = document.getElementById('detailTitle');
    const detail = document.getElementById('detailContent');
    if (!shell || !title || !detail) return false;
    const block = document.createElement('div');
    const label = document.createElement('label');
    const paragraph = document.createElement('p');
    block.className = 'detail-block';
    label.textContent = 'Demonstration capability';
    paragraph.textContent = message;
    block.append(label, paragraph);
    title.textContent = titleText;
    detail.replaceChildren(block);
    shell.classList.remove('detail-overlay');
    shell.classList.add('detail-open');
    return true;
  }

  const DEMO_DEFINITION = Object.freeze({
    schemaVersion: 1,
    id: 'example-settings',
    name: 'SETTINGS DEMO',
    nodes: Object.freeze([
      Object.freeze({
        id: 'system',
        label: 'System',
        children: Object.freeze([
          Object.freeze({ id: 'system:display', label: 'Display', action: 'display.open', view: 'settings' }),
          Object.freeze({ id: 'system:sound', label: 'Sound', action: 'sound.open', view: 'settings' })
        ])
      }),
      Object.freeze({
        id: 'network',
        label: 'Network',
        children: Object.freeze([
          Object.freeze({ id: 'network:wifi', label: 'Wi-Fi', action: 'wifi.open', view: 'settings' })
        ])
      })
    ])
  });

  const DEMO_CAPABILITIES = Object.freeze({
    'display.open': () => showDemoCapability('Display (Demo)', 'Demonstration only. Operating-system display settings are not connected.'),
    'sound.open': () => showDemoCapability('Sound (Demo)', 'Demonstration only. Operating-system sound settings are not connected.'),
    'wifi.open': () => showDemoCapability('Wi-Fi (Demo)', 'Demonstration only. Network settings and credentials are not connected.')
  });

  const OFFICE_ORIGIN = 'http://127.0.0.1:4176';
  const OFFICE_BRIDGE_PROTOCOL = 'office-universal-space-v1';
  const OFFICE_BRIDGE_MAX_ITEMS = 10;
  let officeBridgeFrame = null;
  let officeBridgeReady = false;
  let officeBridgeReadyPromise = null;
  let officeBridgeReadyResolve = null;
  let officeRequestNumber = 0;
  const officePendingRequests = new Map();

  function officeInspector(titleText, children) {
    const shell = document.querySelector('.app-shell');
    const title = document.getElementById('detailTitle');
    const detail = document.getElementById('detailContent');
    if (!shell || !title || !detail) return null;
    title.textContent = titleText;
    detail.replaceChildren(...children);
    shell.classList.remove('detail-overlay');
    shell.classList.add('detail-open');
    return detail;
  }

  function officeBlock(labelText, valueText) {
    const block = document.createElement('div');
    const label = document.createElement('label');
    const value = document.createElement('p');
    block.className = 'detail-block';
    label.textContent = labelText;
    value.textContent = valueText;
    block.append(label, value);
    return block;
  }

  function officeLoading(titleText) {
    officeInspector(titleText, [officeBlock('Office', 'Loading local Office data…')]);
  }

  function ensureOfficeBridge() {
    if (officeBridgeReady) return Promise.resolve();
    if (!officeBridgeFrame) {
      officeBridgeFrame = document.createElement('iframe');
      officeBridgeFrame.hidden = true;
      officeBridgeFrame.setAttribute('aria-hidden', 'true');
      officeBridgeFrame.src = `${OFFICE_ORIGIN}/?bridge=universal-space-v1`;
      document.body.append(officeBridgeFrame);
    }
    if (!officeBridgeReadyPromise) {
      officeBridgeReadyPromise = new Promise((resolve, reject) => {
        officeBridgeReadyResolve = resolve;
        window.setTimeout(() => {
          if (!officeBridgeReady) {
            officeBridgeFrame?.remove();
            officeBridgeFrame = null;
            officeBridgeReadyPromise = null;
            officeBridgeReadyResolve = null;
            reject(new Error('Office bridge did not become ready.'));
          }
        }, 4000);
      });
    }
    return officeBridgeReadyPromise;
  }

  function requestOffice(resource, filter = null, recordId = null) {
    return ensureOfficeBridge().then(() => new Promise((resolve, reject) => {
      const requestId = `office_${Date.now()}_${++officeRequestNumber}`;
      const timer = window.setTimeout(() => {
        officePendingRequests.delete(requestId);
        reject(new Error('Office bridge request timed out.'));
      }, 4000);
      officePendingRequests.set(requestId, { resolve, reject, timer });
      officeBridgeFrame.contentWindow.postMessage({
        protocol: OFFICE_BRIDGE_PROTOCOL,
        type: 'office-bridge-read',
        requestId,
        resource,
        limit: OFFICE_BRIDGE_MAX_ITEMS,
        ...(filter ? { filter } : {}),
        ...(recordId ? { recordId } : {})
      }, OFFICE_ORIGIN);
    }));
  }

  function requestOfficeCommand(command) {
    return ensureOfficeBridge().then(() => new Promise((resolve, reject) => {
      const requestId = `office_${Date.now()}_${++officeRequestNumber}`;
      const timer = window.setTimeout(() => {
        officePendingRequests.delete(requestId);
        reject(new Error('Office bridge command timed out.'));
      }, 12000);
      officePendingRequests.set(requestId, { resolve, reject, timer });
      officeBridgeFrame.contentWindow.postMessage({
        protocol: OFFICE_BRIDGE_PROTOCOL,
        type: 'office-bridge-command',
        requestId,
        command
      }, OFFICE_ORIGIN);
    }));
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== OFFICE_ORIGIN || event.source !== officeBridgeFrame?.contentWindow) return;
    const message = event.data;
    if (!message || message.protocol !== OFFICE_BRIDGE_PROTOCOL) return;
    if (message.type === 'office-bridge-ready') {
      officeBridgeReady = true;
      officeBridgeReadyResolve?.();
      return;
    }
    if (message.type !== 'office-bridge-response' || typeof message.requestId !== 'string') return;
    const pending = officePendingRequests.get(message.requestId);
    if (!pending) return;
    officePendingRequests.delete(message.requestId);
    window.clearTimeout(pending.timer);
    if (message.ok === true) pending.resolve(message);
    else pending.reject(new Error('Office bridge rejected the request.'));
  });

  function officeRow(item) {
    const row = document.createElement(item.recordType && item.id ? 'button' : 'div');
    row.className = 'detail-block';
    if (row instanceof HTMLButtonElement) {
      row.type = 'button';
      row.dataset.officeRecordType = item.recordType;
      row.dataset.officeRecordId = item.id;
    }
    const title = item.title || item.name || item.jobTitle || 'Office record';
    const detail = [item.status || item.packageStatus || item.type, item.priority || item.role || item.project || item.detail, item.updatedAt]
      .filter(Boolean).join(' · ');
    row.append(officeBlock(title, detail));
    return row;
  }

  function renderOfficeList(titleText, response, leading = []) {
    const items = Array.isArray(response.items) ? response.items : [];
    const children = [...leading, ...(items.length ? items.map(officeRow) : [officeBlock('Office', 'No matching local records.')])];
    if (response.truncated) children.push(officeBlock('Limit', 'Showing the first 10 local records.'));
    officeInspector(titleText, children);
  }

  function renderOfficeDashboard(response) {
    const summary = response.summary || {};
    officeInspector('Office Dashboard', [
      officeBlock('Jobs', String(summary.jobs || 0)),
      officeBlock('Needs attention', `${summary.blocked || 0} blocked · ${summary.review || 0} review`),
      officeBlock('Workers', `${summary.availableWorkers || 0}/${summary.workers || 0} available`),
      officeBlock('Dispatch', `${summary.dispatchReady || 0} ready`)
    ]);
  }

  function renderOfficeRecord(recordType, response) {
    const record = response.record;
    if (!record) return officeInspector('Office record', [officeBlock('Office', 'This local record is no longer available.')]);
    const title = record.title || record.name || record.jobTitle || 'Office record';
    const fields = recordType === 'job'
      ? [['Status', record.status], ['Priority', record.priority], ['Project', record.project], ['Worker', record.worker], ['Description', record.description], ['Result / handoff', record.result], ['Last updated', record.updatedAt]]
      : recordType === 'worker'
        ? [['Role', record.role], ['Status', record.status], ['Description', record.description], ['Last updated', record.updatedAt]]
        : [['Status', record.packageStatus], ['Job', record.jobTitle], ['Worker', record.workerName], ['Priority', record.priority], ['Project', record.project], ['Instructions', record.instructions], ['Last updated', record.updatedAt]];
    officeInspector(title, fields.filter(([, value]) => value).map(([label, value]) => officeBlock(label, value)));
  }

  async function openOfficeData(titleText, resource, filter = null) {
    officeLoading(titleText);
    try {
      const response = await requestOffice(resource, filter);
      if (resource === 'dashboard') renderOfficeDashboard(response);
      else renderOfficeList(titleText, response);
      return true;
    } catch (error) {
      officeInspector(titleText, [officeBlock('Office bridge unavailable', 'Start Office locally on http://127.0.0.1:4176 and try again.')]);
      return false;
    }
  }

  function memoryCollectionSummary(collection) {
    if (collection?.status === 'completed') {
      return `Discovered ${collection.discovered}; imported ${collection.imported}; acknowledged ${collection.acknowledged}; failed ${collection.failed}.`;
    }
    if (collection?.status === 'already-running') return 'The Office Memory collector is already running.';
    if (collection?.status === 'project-catalog-unavailable') return 'The Office Memory collector is waiting for the Code Space project catalog.';
    if (collection?.status === 'collector-failed') return `Office collector failed: ${String(collection.reason || 'Memory collector failed.').slice(0, 240)}`;
    return 'The Office Memory collector returned an unknown status.';
  }

  async function collectOfficeMemoryJobs() {
    const titleText = 'Office Memory Jobs';
    officeLoading(titleText);
    try {
      const commandResponse = await requestOfficeCommand('memoryJobs.collect');
      const jobsResponse = await requestOffice('memory-jobs');
      renderOfficeList(titleText, jobsResponse, [officeBlock('Collection', memoryCollectionSummary(commandResponse.collection))]);
      return true;
    } catch (error) {
      officeInspector(titleText, [officeBlock('Office bridge unavailable', 'The Office Memory collector could not be reached.')]);
      return false;
    }
  }

  async function openOfficeRecord(recordType, recordId) {
    officeLoading('Office record');
    try {
      const response = await requestOffice(recordType === 'dispatch' ? 'dispatch' : `${recordType}s`, null, recordId);
      renderOfficeRecord(recordType, response);
    } catch (error) {
      officeInspector('Office record', [officeBlock('Office bridge unavailable', 'The selected local Office record could not be read.')]);
    }
  }

  document.getElementById('detailContent')?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-office-record-id][data-office-record-type]');
    if (!row) return;
    openOfficeRecord(row.dataset.officeRecordType, row.dataset.officeRecordId);
  });

  function openOfficeWindow(path = '/') {
    return typeof window.open === 'function' && window.open(`${OFFICE_ORIGIN}${path}`, 'office-v1') !== null;
  }

  const OFFICE_DEFINITION = Object.freeze({
    schemaVersion: 1,
    id: 'office',
    name: 'OFFICE',
    nodes: Object.freeze([
      Object.freeze({ id: 'dashboard', label: 'Dashboard', action: 'office.dashboard.open', view: 'office' }),
      Object.freeze({ id: 'jobs', label: 'Jobs', expandable: true, action: 'office.jobs.all.open', view: 'office', children: Object.freeze([
        Object.freeze({ id: 'jobs:inbox', label: 'Inbox', action: 'office.jobs.inbox.open', view: 'office' }),
        Object.freeze({ id: 'jobs:ready', label: 'Ready', action: 'office.jobs.ready.open', view: 'office' }),
        Object.freeze({ id: 'jobs:in-progress', label: 'In Progress', action: 'office.jobs.in-progress.open', view: 'office' }),
        Object.freeze({ id: 'jobs:review', label: 'Review', action: 'office.jobs.review.open', view: 'office' }),
        Object.freeze({ id: 'jobs:complete', label: 'Complete', action: 'office.jobs.complete.open', view: 'office' }),
        Object.freeze({ id: 'jobs:blocked', label: 'Blocked', action: 'office.jobs.blocked.open', view: 'office' })
      ]) }),
      Object.freeze({ id: 'important', label: 'Important', expandable: true, action: 'office.important.open', view: 'office', children: Object.freeze([
        Object.freeze({ id: 'important:urgent', label: 'Urgent', action: 'office.important.urgent.open', view: 'office' }),
        Object.freeze({ id: 'important:blocked', label: 'Blocked', action: 'office.important.blocked.open', view: 'office' }),
        Object.freeze({ id: 'important:review', label: 'Review', action: 'office.important.review.open', view: 'office' }),
        Object.freeze({ id: 'important:high', label: 'High', action: 'office.important.high.open', view: 'office' })
      ]) }),
      Object.freeze({ id: 'new-job', label: 'New Job', action: 'office.new-job.open', view: 'office' }),
      Object.freeze({ id: 'workers', label: 'Workers', expandable: true, action: 'office.workers.all.open', view: 'office', children: Object.freeze([
        Object.freeze({ id: 'workers:available', label: 'Available', action: 'office.workers.available.open', view: 'office' }),
        Object.freeze({ id: 'workers:busy', label: 'Busy', action: 'office.workers.busy.open', view: 'office' })
      ]) }),
      Object.freeze({ id: 'dispatch', label: 'Dispatch', expandable: true, action: 'office.dispatch.all.open', view: 'office', children: Object.freeze([
        Object.freeze({ id: 'dispatch:ready', label: 'Ready', action: 'office.dispatch.ready.open', view: 'office' }),
        Object.freeze({ id: 'dispatch:draft', label: 'Draft', action: 'office.dispatch.draft.open', view: 'office' }),
        Object.freeze({ id: 'dispatch:cancelled', label: 'Cancelled', action: 'office.dispatch.cancelled.open', view: 'office' })
      ]) }),
      Object.freeze({ id: 'projects', label: 'Projects', action: 'office.projects.open', view: 'office' }),
      Object.freeze({ id: 'memory-jobs', label: 'Memory Jobs', action: 'office.memory-jobs.open', view: 'office' }),
      Object.freeze({ id: 'ledger', label: 'Ledger', action: 'office.ledger.open', view: 'office' }),
      Object.freeze({ id: 'open-office', label: 'Open Office', action: 'office.open', view: 'office' })
    ])
  });

  const OFFICE_CAPABILITIES = Object.freeze({
    'office.dashboard.open': () => openOfficeData('Office Dashboard', 'dashboard'),
    'office.jobs.all.open': () => openOfficeData('Office Jobs', 'jobs'),
    'office.jobs.inbox.open': () => openOfficeData('Office Jobs · Inbox', 'jobs', { status: 'Inbox' }),
    'office.jobs.ready.open': () => openOfficeData('Office Jobs · Ready', 'jobs', { status: 'Ready' }),
    'office.jobs.in-progress.open': () => openOfficeData('Office Jobs · In Progress', 'jobs', { status: 'In Progress' }),
    'office.jobs.review.open': () => openOfficeData('Office Jobs · Review', 'jobs', { status: 'Review' }),
    'office.jobs.complete.open': () => openOfficeData('Office Jobs · Complete', 'jobs', { status: 'Complete' }),
    'office.jobs.blocked.open': () => openOfficeData('Office Jobs · Blocked', 'jobs', { status: 'Blocked' }),
    'office.important.open': () => openOfficeData('Office Important', 'important'),
    'office.important.urgent.open': () => openOfficeData('Office Important · Urgent', 'jobs', { priority: 'Urgent' }),
    'office.important.blocked.open': () => openOfficeData('Office Important · Blocked', 'jobs', { status: 'Blocked' }),
    'office.important.review.open': () => openOfficeData('Office Important · Review', 'jobs', { status: 'Review' }),
    'office.important.high.open': () => openOfficeData('Office Important · High', 'jobs', { priority: 'High' }),
    'office.new-job.open': () => openOfficeWindow('/#/jobs/new'),
    'office.workers.all.open': () => openOfficeData('Office Workers', 'workers'),
    'office.workers.available.open': () => openOfficeData('Office Workers · Available', 'workers', { status: 'Available' }),
    'office.workers.busy.open': () => openOfficeData('Office Workers · Busy', 'workers', { status: 'Busy' }),
    'office.dispatch.all.open': () => openOfficeData('Office Dispatch', 'dispatch'),
    'office.dispatch.ready.open': () => openOfficeData('Office Dispatch · Ready', 'dispatch', { packageStatus: 'Ready' }),
    'office.dispatch.draft.open': () => openOfficeData('Office Dispatch · Draft', 'dispatch', { packageStatus: 'Draft' }),
    'office.dispatch.cancelled.open': () => openOfficeData('Office Dispatch · Cancelled', 'dispatch', { packageStatus: 'Cancelled' }),
    'office.projects.open': () => openOfficeData('Office Projects', 'projects'),
    'office.memory-jobs.open': () => collectOfficeMemoryJobs(),
    'office.ledger.open': () => openOfficeData('Office Ledger', 'ledger'),
    'office.open': () => openOfficeWindow('/')
  });

  globalThis.AppDefinitionLoader = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    limits: Object.freeze({ maxNodes: MAX_NODES, maxDepth: MAX_DEPTH, maxDefinitionChars: MAX_DEFINITION_CHARS }),
    AppDefinitionError,
    validateDefinition,
    createAdapter,
    loadDefinition
  });

  try {
    loadDefinition(DEMO_DEFINITION, DEMO_CAPABILITIES);
  } catch (error) {
    console.error('Could not load the demonstration app definition:', error);
  }

  try {
    loadDefinition(OFFICE_DEFINITION, OFFICE_CAPABILITIES);
  } catch (error) {
    console.error('Could not load the Office app definition:', error);
  }
})();
