import crypto from 'node:crypto';

export const MCP_VERSION = '2026-07-28';

const MCP_TOOLS = [
  { name: 'list_spaces', description: 'List the Memory Spaces the user explicitly shared with this external AI connection.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'search_memory', description: 'Search current confirmed memory in the explicitly shared Memory Space.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1 } }, required: ['query'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'get_current_space_context', description: 'Return the focused current confirmed context for the explicitly shared Memory Space.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'read_memory', description: 'Read one current confirmed memory by id, including its provenance fields.', inputSchema: { type: 'object', properties: { memory_id: { type: 'string', minLength: 1 } }, required: ['memory_id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'get_current_decisions', description: 'Return current confirmed decision memories in the explicitly shared Memory Space.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'inspect_provenance', description: 'Inspect the recorded source/provenance for one current confirmed memory.', inputSchema: { type: 'object', properties: { memory_id: { type: 'string', minLength: 1 } }, required: ['memory_id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  {
    name: 'propose_memory',
    description: 'Leave a proposed memory for the user to review in Memory Space. This does not approve or permanently save it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100 },
        content: { type: 'string', minLength: 1, maxLength: 2000 },
        type: { type: 'string', enum: ['decision', 'fact', 'goal', 'question', 'note', 'job'] },
        importance: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
        project: { type: 'string', maxLength: 100 },
        priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
        reason: { type: 'string', maxLength: 500 }
      },
      required: ['title', 'content'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  },
  {
    name: 'propose_memory_bundle',
    description: 'Propose a titled visual memory group containing several normal memories. Nothing is saved or grouped until the user approves the bundle in Memory Space.',
    inputSchema: {
      type: 'object',
      properties: {
        group_title: { type: 'string', minLength: 1, maxLength: 48 },
        reason: { type: 'string', maxLength: 500 },
        memories: {
          type: 'array',
          minItems: 1,
          maxItems: 24,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1, maxLength: 100 },
              content: { type: 'string', minLength: 1, maxLength: 2000 },
              type: { type: 'string', enum: ['decision', 'fact', 'goal', 'question', 'note', 'job'] },
              importance: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
              project: { type: 'string', maxLength: 100 },
              priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
              reason: { type: 'string', maxLength: 500 }
            },
            required: ['title', 'content'],
            additionalProperties: false
          }
        }
      },
      required: ['group_title', 'memories'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }
];

function validateWorkspace(body) {
  const workspace = body?.workspace;
  if (!workspace || !Array.isArray(workspace.spaces) || !Array.isArray(workspace.memories)) throw new Error('workspace with spaces and memories is required');
  if (workspace.spaces.length !== 1) throw new Error('This proof only accepts one explicitly shared active space');
  const space = workspace.spaces[0];
  if (!space?.id || !space?.name) throw new Error('Shared space id and name are required');
  if (workspace.activeSpaceId !== space.id) throw new Error('activeSpaceId must match the shared space');

  const memories = workspace.memories.map((memory) => ({
    id: String(memory?.id || ''),
    spaceId: String(memory?.spaceId || ''),
    title: String(memory?.title || ''),
    content: String(memory?.content || memory?.details || ''),
    details: String(memory?.details || memory?.content || ''),
    type: String(memory?.type || 'note'),
    importance: String(memory?.importance || 'normal'),
    project: String(memory?.project || ''),
    priority: String(memory?.priority || 'normal'),
    createdBy: String(memory?.createdBy || 'user'),
    officeCollectedAt: memory?.officeCollectedAt || null,
    officeJobId: memory?.officeJobId == null ? null : String(memory.officeJobId),
    source: String(memory?.source || ''),
    locked: Boolean(memory?.locked),
    status: String(memory?.status || 'confirmed'),
    createdAt: memory?.createdAt || null,
    updatedAt: memory?.updatedAt || null
  }));
  for (const memory of memories) {
    if (!memory.id || !memory.title || !memory.content) throw new Error('Every shared memory needs id, title, and content');
    if (memory.spaceId !== space.id) throw new Error('Shared memories must belong to the shared space');
    const confirmedMemory = memory.status === 'confirmed' && memory.type !== 'job';
    const sourceJob = memory.status === 'ready' && memory.type === 'job';
    if (!confirmedMemory && !sourceJob) throw new Error('Only current confirmed memories and ready jobs may be published');
    if (sourceJob && !memory.project) throw new Error('Every ready job needs a project');
  }
  return {
    version: Number(workspace.version || 1),
    activeSpaceId: String(space.id),
    spaces: [{ id: String(space.id), name: String(space.name), description: String(space.description || ''), createdAt: space.createdAt || null, updatedAt: space.updatedAt || null }],
    memories
  };
}

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: typeof value === 'string' ? undefined : value };
}

function toolError(message) {
  return { isError: true, content: [{ type: 'text', text: String(message) }] };
}

export function createWorkspaceRuntime() {
  const published = new Map();
  const proposals = new Map();
  const jobAcknowledgements = new Map();

  function acknowledgementQueue(connectionId) {
    if (!jobAcknowledgements.has(connectionId)) jobAcknowledgements.set(connectionId, new Map());
    return jobAcknowledgements.get(connectionId);
  }

  function proposalQueue(connectionId) {
    if (!proposals.has(connectionId)) proposals.set(connectionId, []);
    return proposals.get(connectionId);
  }

  function requireWorkspace(connectionId) {
    const entry = published.get(connectionId);
    if (!entry?.workspace) throw new Error('No Memory Space is currently shared with this external AI connection');
    return entry.workspace;
  }

  function activeSpace(connectionId) {
    const workspace = requireWorkspace(connectionId);
    return workspace.spaces.find((space) => space.id === workspace.activeSpaceId) || workspace.spaces[0];
  }

  function activeMemories(connectionId) {
    const workspace = requireWorkspace(connectionId);
    return workspace.memories.filter((memory) => memory.spaceId === workspace.activeSpaceId && memory.status === 'confirmed');
  }

  function readyJobs(connectionId) {
    const workspace = requireWorkspace(connectionId);
    return workspace.memories
      .filter((memory) => memory.spaceId === workspace.activeSpaceId
        && memory.type === 'job'
        && memory.status === 'ready'
        && !memory.officeCollectedAt
        && !memory.officeJobId)
      .map((memory) => ({
        id: memory.id,
        spaceId: memory.spaceId,
        type: 'job',
        title: memory.title,
        details: memory.details || memory.content,
        project: memory.project,
        status: 'ready',
        priority: memory.priority || 'normal',
        createdBy: memory.createdBy || 'user',
        createdAt: memory.createdAt || null,
        officeCollectedAt: null,
        officeJobId: null
      }));
  }

  function acknowledgeJob(connectionId, memoryJobId, officeJobId, collectedAt = new Date()) {
    const workspace = requireWorkspace(connectionId);
    const id = String(memoryJobId || '');
    const acceptedOfficeJobId = String(officeJobId || '').trim();
    if (!id || !acceptedOfficeJobId) throw new Error('Memory job id and Office job id are required');
    const job = workspace.memories.find((memory) => memory.id === id
      && memory.spaceId === workspace.activeSpaceId
      && memory.type === 'job'
      && memory.status === 'ready');
    if (!job) throw new Error('Ready Memory job not found in the authorised Space');
    if (job.officeJobId && job.officeJobId !== acceptedOfficeJobId) {
      throw new Error('Memory job was already collected into a different Office job');
    }
    const timestamp = job.officeCollectedAt || collectedAt.toISOString();
    job.officeCollectedAt = timestamp;
    job.officeJobId = acceptedOfficeJobId;
    const acknowledgement = { memoryJobId: id, officeJobId: acceptedOfficeJobId, officeCollectedAt: timestamp };
    acknowledgementQueue(connectionId).set(id, acknowledgement);
    return acknowledgement;
  }

  function listJobAcknowledgements(connectionId) {
    requireWorkspace(connectionId);
    return [...acknowledgementQueue(connectionId).values()];
  }

  function currentContext(connectionId) {
    const space = activeSpace(connectionId);
    const memories = activeMemories(connectionId);
    const lines = [`SPACE: ${space.name}`, `PURPOSE: ${space.description}`, '', 'CURRENT CONFIRMED MEMORY:'];
    if (!memories.length) lines.push('- None shared.');
    for (const memory of memories) {
      lines.push(`- [${memory.importance.toUpperCase()}] [${memory.type.toUpperCase()}] ${memory.title}`);
      lines.push(`  ${memory.content}`);
      if (memory.source) lines.push(`  Source: ${memory.source}`);
      if (memory.locked) lines.push('  Locked by user: yes');
    }
    return lines.join('\n');
  }

  function publishWorkspace(connectionId, body) {
    const workspace = validateWorkspace(body);
    const acknowledgements = acknowledgementQueue(connectionId);
    for (const memory of workspace.memories) {
      const acknowledgement = acknowledgements.get(memory.id);
      if (!acknowledgement || memory.type !== 'job') continue;
      if (memory.officeJobId && memory.officeJobId !== acknowledgement.officeJobId) {
        throw new Error('Published job acknowledgement conflicts with the Office job already recorded by Memory Space');
      }
      memory.officeCollectedAt = acknowledgement.officeCollectedAt;
      memory.officeJobId = acknowledgement.officeJobId;
    }
    const publishedAt = new Date().toISOString();
    published.set(connectionId, { workspace, publishedAt });
    proposals.set(connectionId, proposalQueue(connectionId).filter((proposal) => proposal.spaceId === workspace.activeSpaceId));
    return { workspace, publishedAt, jobAcknowledgements: [...acknowledgements.values()] };
  }

  function pullProposals(connectionId) {
    const items = proposalQueue(connectionId);
    proposals.set(connectionId, []);
    return items;
  }

  function status(connectionId) {
    return {
      workspacePublishedInMemory: published.has(connectionId),
      pendingProposals: proposalQueue(connectionId).length
    };
  }

  function clear(connectionId) {
    published.delete(connectionId);
    proposals.delete(connectionId);
    jobAcknowledgements.delete(connectionId);
  }

  function callTool(connectionId, name, args = {}) {
    const memories = () => activeMemories(connectionId);
    switch (name) {
      case 'list_spaces': {
        const entry = published.get(connectionId);
        const workspace = requireWorkspace(connectionId);
        return textResult({
          publishedAt: entry?.publishedAt || null,
          spaces: workspace.spaces.map((space) => ({
            id: space.id,
            name: space.name,
            description: space.description,
            active: space.id === workspace.activeSpaceId,
            memoryCount: workspace.memories.filter((memory) => memory.spaceId === space.id && memory.status === 'confirmed').length
          }))
        });
      }
      case 'search_memory': {
        const query = String(args.query || '').trim().toLowerCase();
        if (!query) return toolError('query is required');
        const results = memories().filter((memory) => [memory.title, memory.content, memory.source, memory.type, memory.importance].some((value) => String(value || '').toLowerCase().includes(query)));
        return textResult({ query, count: results.length, memories: results });
      }
      case 'get_current_space_context': return textResult(currentContext(connectionId));
      case 'read_memory': {
        const memory = memories().find((item) => item.id === String(args.memory_id || ''));
        return memory ? textResult(memory) : toolError('Memory not found in the currently shared space');
      }
      case 'get_current_decisions': {
        const decisions = memories().filter((memory) => memory.type === 'decision');
        return textResult({ count: decisions.length, decisions });
      }
      case 'inspect_provenance': {
        const memory = memories().find((item) => item.id === String(args.memory_id || ''));
        if (!memory) return toolError('Memory not found in the currently shared space');
        return textResult({ id: memory.id, title: memory.title, source: memory.source || null, createdAt: memory.createdAt, updatedAt: memory.updatedAt, locked: memory.locked, status: memory.status });
      }
      case 'propose_memory': {
        requireWorkspace(connectionId);
        const title = String(args.title || '').trim();
        const content = String(args.content || '').trim();
        if (!title || !content) return toolError('title and content are required');
        const proposal = {
          id: `external_${crypto.randomUUID()}`,
          spaceId: activeSpace(connectionId).id,
          title: title.slice(0, 100),
          content: content.slice(0, 2000),
          type: ['decision', 'fact', 'goal', 'question', 'note', 'job'].includes(args.type) ? args.type : 'note',
          importance: ['critical', 'high', 'normal', 'low'].includes(args.importance) ? args.importance : 'normal',
          project: String(args.project || '').trim().slice(0, 100),
          priority: ['low', 'normal', 'high', 'urgent'].includes(args.priority) ? args.priority : 'normal',
          reason: String(args.reason || 'External AI suggested this as durable context.').slice(0, 500),
          status: 'pending',
          sourceKind: 'external-mcp',
          createdAt: new Date().toISOString()
        };
        if (proposal.type === 'job' && !proposal.project) return toolError('project is required when proposing a job');
        proposalQueue(connectionId).push(proposal);
        return textResult({ acceptedAsProposal: true, proposalId: proposal.id, message: 'Proposal queued for human review. It is not confirmed memory.' });
      }
      case 'propose_memory_bundle': {
        requireWorkspace(connectionId);
        const groupTitle = String(args.group_title || '').trim().slice(0, 48);
        const inputMemories = Array.isArray(args.memories) ? args.memories : [];
        if (!groupTitle) return toolError('group_title is required');
        if (!inputMemories.length || inputMemories.length > 24) return toolError('memories must contain between 1 and 24 items');

        const bundleMemories = [];
        for (let index = 0; index < inputMemories.length; index += 1) {
          const item = inputMemories[index] || {};
          const title = String(item.title || '').trim();
          const content = String(item.content || '').trim();
          if (!title || !content) return toolError(`memory ${index + 1} requires title and content`);
          const type = ['decision', 'fact', 'goal', 'question', 'note', 'job'].includes(item.type) ? item.type : 'note';
          const project = String(item.project || '').trim().slice(0, 100);
          if (type === 'job' && !project) return toolError(`memory ${index + 1} requires project when type is job`);
          bundleMemories.push({
            title: title.slice(0, 100),
            content: content.slice(0, 2000),
            type,
            importance: ['critical', 'high', 'normal', 'low'].includes(item.importance) ? item.importance : 'normal',
            project,
            priority: ['low', 'normal', 'high', 'urgent'].includes(item.priority) ? item.priority : 'normal',
            reason: String(item.reason || '').trim().slice(0, 500)
          });
        }

        const proposal = {
          id: `external_bundle_${crypto.randomUUID()}`,
          spaceId: activeSpace(connectionId).id,
          title: groupTitle,
          content: `${bundleMemories.length} proposed memories will be created and visually grouped as “${groupTitle}” only if the user approves this bundle.`,
          type: 'note',
          importance: 'normal',
          project: '',
          priority: 'normal',
          reason: String(args.reason || 'External AI suggested these memories as one user-approved visual bundle.').slice(0, 500),
          status: 'pending',
          sourceKind: 'external-mcp',
          proposalKind: 'memory-bundle',
          groupTitle,
          memories: bundleMemories,
          createdAt: new Date().toISOString()
        };
        proposalQueue(connectionId).push(proposal);
        return textResult({
          acceptedAsProposal: true,
          proposalId: proposal.id,
          proposalKind: proposal.proposalKind,
          groupTitle,
          memoryCount: bundleMemories.length,
          message: 'Bundle queued for one human approval. No memory or visual group has been created yet.'
        });
      }
      default: return toolError(`Unknown tool: ${name}`);
    }
  }

  function handleMcp(connectionId, body) {
    const id = body?.id ?? null;
    const method = String(body?.method || '');
    const protocolVersion = body?.params?.protocolVersion || MCP_VERSION;
    if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'memory-space', version: '0.2.0' } } };
    if (method === 'notifications/initialized') return null;
    if (method === 'server/discover') return { jsonrpc: '2.0', id, result: { protocolVersion: MCP_VERSION, serverInfo: { name: 'memory-space', version: '0.2.0' }, capabilities: { tools: {} } } };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: MCP_TOOLS, ttlMs: 60_000, cacheScope: 'private' } };
    if (method === 'tools/call') {
      try { return { jsonrpc: '2.0', id, result: callTool(connectionId, String(body?.params?.name || ''), body?.params?.arguments || {}) }; }
      catch (error) { return { jsonrpc: '2.0', id, result: toolError(error?.message || 'Tool call failed') }; }
    }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }

  return Object.freeze({ publishWorkspace, pullProposals, status, clear, handleMcp, readyJobs, acknowledgeJob, listJobAcknowledgements });
}
