import assert from 'node:assert/strict';
import { createWorkspaceRuntime } from './workspace-runtime.mjs';

const runtime = createWorkspaceRuntime();
const connectionId = 'bundle-test';

runtime.publishWorkspace(connectionId, {
  workspace: {
    version: 1,
    activeSpaceId: 'space-1',
    spaces: [{ id: 'space-1', name: 'Test Space', description: 'Bundle test space' }],
    memories: [{
      id: 'memory-existing',
      spaceId: 'space-1',
      title: 'Existing memory',
      content: 'Already approved memory',
      type: 'note',
      importance: 'normal',
      source: 'test',
      locked: false,
      status: 'confirmed'
    }]
  }
});

const listed = runtime.handleMcp(connectionId, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
const names = listed?.result?.tools?.map((tool) => tool.name) || [];
assert.ok(names.includes('propose_memory_bundle'), 'bundle tool should be advertised');

const invalid = runtime.handleMcp(connectionId, {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'propose_memory_bundle',
    arguments: {
      group_title: 'Bad bundle',
      memories: [{ title: 'Job without project', content: 'Must fail', type: 'job' }]
    }
  }
});
assert.equal(invalid?.result?.isError, true, 'job bundle item without project should be rejected');

const proposed = runtime.handleMcp(connectionId, {
  jsonrpc: '2.0',
  id: 3,
  method: 'tools/call',
  params: {
    name: 'propose_memory_bundle',
    arguments: {
      group_title: "Today's Jobs",
      reason: 'Collect today’s work into one user-approved visual group.',
      memories: [
        { title: 'Bundle note', content: 'A normal proposed memory.', type: 'note', importance: 'normal' },
        { title: 'Bundle job', content: 'A proposed job memory.', type: 'job', importance: 'high', project: 'memory-app', priority: 'high' }
      ]
    }
  }
});

assert.equal(proposed?.result?.isError, undefined);
assert.equal(proposed?.result?.structuredContent?.acceptedAsProposal, true);
assert.equal(proposed?.result?.structuredContent?.memoryCount, 2);
assert.equal(proposed?.result?.structuredContent?.groupTitle, "Today's Jobs");

const searchBeforeApproval = runtime.handleMcp(connectionId, {
  jsonrpc: '2.0',
  id: 4,
  method: 'tools/call',
  params: { name: 'search_memory', arguments: { query: 'Bundle note' } }
});
assert.equal(searchBeforeApproval?.result?.structuredContent?.count, 0, 'bundle proposal must not become confirmed memory');

const proposals = runtime.pullProposals(connectionId);
assert.equal(proposals.length, 1);
assert.equal(proposals[0].proposalKind, 'memory-bundle');
assert.equal(proposals[0].groupTitle, "Today's Jobs");
assert.equal(proposals[0].memories.length, 2);
assert.equal(proposals[0].status, 'pending');

console.log('MCP memory bundle test PASSED');
