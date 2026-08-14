import assert from 'node:assert/strict';
import { createWorkspaceRuntime } from './workspace-runtime.mjs';

function snapshot(owner, memories) {
  const spaceId = `space_${owner}`;
  return {
    workspace: {
      version: 1,
      activeSpaceId: spaceId,
      spaces: [{ id: spaceId, name: `${owner} Space` }],
      memories: memories.map((memory) => ({ spaceId, ...memory }))
    }
  };
}

function job(id, overrides = {}) {
  return {
    id,
    title: 'Fix mobile boss HUD',
    content: 'Investigate the overlap and patch the affected layout.',
    details: 'Investigate the overlap and patch the affected layout.',
    type: 'job',
    importance: 'normal',
    project: 'space-junkz',
    priority: 'normal',
    createdBy: 'user',
    status: 'ready',
    officeCollectedAt: null,
    officeJobId: null,
    ...overrides
  };
}

const runtime = createWorkspaceRuntime();
runtime.publishWorkspace('customer-a', snapshot('a', [
  job('ready-a'),
  { id: 'memory-a', title: 'Private fact', content: 'Not a job', type: 'fact', importance: 'normal', status: 'confirmed' }
]));
runtime.publishWorkspace('customer-b', snapshot('b', [job('ready-b')]));

assert.deepEqual(runtime.readyJobs('customer-a').map((item) => item.id), ['ready-a']);
assert.deepEqual(runtime.readyJobs('customer-b').map((item) => item.id), ['ready-b']);
assert.equal(runtime.readyJobs('customer-a')[0].details, 'Investigate the overlap and patch the affected layout.');
assert.equal(Object.hasOwn(runtime.readyJobs('customer-a')[0], 'content'), false, 'job feed must not expose unrelated Memory fields');

const acknowledgement = runtime.acknowledgeJob('customer-a', 'ready-a', 'office-1', new Date('2026-08-14T12:00:00.000Z'));
assert.equal(acknowledgement.officeJobId, 'office-1');
assert.equal(runtime.readyJobs('customer-a').length, 0);
assert.equal(runtime.readyJobs('customer-b').length, 1, 'collection must remain isolated by customer connection');
assert.deepEqual(runtime.acknowledgeJob('customer-a', 'ready-a', 'office-1'), acknowledgement, 'same acknowledgement must be idempotent');
assert.throws(() => runtime.acknowledgeJob('customer-a', 'ready-a', 'office-2'), /different Office job/i);

const republished = runtime.publishWorkspace('customer-a', snapshot('a', [job('ready-a')]));
assert.deepEqual(republished.jobAcknowledgements, [acknowledgement]);
assert.equal(runtime.readyJobs('customer-a').length, 0, 'a stale browser snapshot must not reopen an acknowledged job');

const proposed = runtime.handleMcp('customer-b', {
  id: 'proposal-call',
  method: 'tools/call',
  params: { name: 'propose_memory', arguments: {
    title: 'AI proposed job',
    content: 'Do not execute before approval.',
    type: 'job',
    project: 'space-junkz'
  } }
});
assert.equal(proposed.result.structuredContent.acceptedAsProposal, true);
assert.deepEqual(runtime.readyJobs('customer-b').map((item) => item.id), ['ready-b'], 'AI proposals must not enter the executable feed');

console.log('Memory Office job-feed runtime checks passed.');
