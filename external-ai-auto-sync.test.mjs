import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const scriptUrl = new URL('./external-ai-auto-sync.js', import.meta.url);
const source = await readFile(scriptUrl, 'utf8');

class BrowserEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    }
  };
}

function createLocalStorage(initial) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('workspace mutations publish two consecutive jobs to the one Office-authorised bridge', async () => {
  const aiBridge = { id: 'ai-bridge', name: 'AI bridge' };
  const officeBridge = { id: 'office-bridge', name: 'Office bridge', officeJobFeedEnabled: true };
  const workspace = {
    version: 1,
    activeSpaceId: 'space-1',
    spaces: [{ id: 'space-1', name: 'Active Space' }],
    memories: []
  };
  const localStorage = createLocalStorage({
    'memory-ai-bridges-v1': JSON.stringify([aiBridge, officeBridge]),
    'memory-space-v1': JSON.stringify(workspace)
  });
  const published = [];
  const windowTarget = createEventTarget();
  const documentTarget = createEventTarget();
  const context = {
    ...windowTarget,
    console: { debug() {} },
    CustomEvent: BrowserEvent,
    Event: BrowserEvent,
    localStorage,
    document: {
      ...documentTarget,
      hidden: true,
      getElementById() {
        return null;
      }
    },
    MemoryAI: {
      getActiveProviderId() {
        return 'memory-bridge:ai-bridge';
      }
    },
    MemoryBridge: {
      async listExternalClients(bridge) {
        if (bridge.id === aiBridge.id) throw new Error('AI bridge unavailable');
        return [];
      },
      async publishWorkspace(bridge, snapshot) {
        published.push({ bridge, snapshot: structuredClone(snapshot) });
        return { memoryCount: snapshot.memories.length, jobAcknowledgements: [] };
      }
    },
    clearTimeout,
    setTimeout(callback, delay) {
      const timer = setTimeout(callback, Math.min(delay, 5));
      timer.unref();
      return timer;
    },
    setInterval() {
      return 0;
    }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: scriptUrl.pathname });
  await waitFor(() => published.length === 1, 'hidden startup did not publish the authorised Space');
  assert.equal(published[0].bridge.id, officeBridge.id);
  published.length = 0;

  async function createJob(id, title) {
    workspace.memories.push({
      id,
      spaceId: workspace.activeSpaceId,
      title,
      type: 'job',
      status: 'ready',
      project: 'universal-space'
    });
    localStorage.setItem('memory-space-v1', JSON.stringify(workspace));
    context.dispatchEvent(new BrowserEvent('memory-workspace-changed'));
    await waitFor(() => published.length === workspace.memories.length, `${title} was not automatically published`);
    const latest = published.at(-1);
    assert.equal(latest.bridge.id, officeBridge.id);
    assert.deepEqual(
      latest.snapshot.memories.map((memory) => memory.title),
      workspace.memories.map((memory) => memory.title)
    );
  }

  await createJob('job-1', 'automatic job one');
  await createJob('job-2', 'automatic job two');
  assert.equal(published.length, 2);
});
