const URL = String(process.env.MEMORY_MCP_URL || 'http://127.0.0.1:8787/mcp').trim();
const TOKEN = String(process.env.MEMORY_BRIDGE_TOKEN || '').trim();
const VERSION = '2026-07-28';

if (!TOKEN) {
  console.error('MEMORY_BRIDGE_TOKEN is required.');
  process.exit(1);
}

async function rpc(id, method, params = {}) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${TOKEN}`,
    'MCP-Protocol-Version': VERSION,
    'Mcp-Method': method
  };
  if (method === 'tools/call' && params?.name) headers['Mcp-Name'] = String(params.name);

  const response = await fetch(URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: {
        ...params,
        _meta: {
          ...(params?._meta || {}),
          'io.modelcontextprotocol/clientInfo': {
            name: 'memory-space-mcp-smoke',
            version: '1.0.0'
          }
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  if (data?.error) throw new Error(data.error.message || 'MCP RPC failed');
  return data.result;
}

try {
  const discovery = await rpc(1, 'server/discover');
  console.log(`MCP server: ${discovery?.serverInfo?.name || 'unknown'} ${discovery?.serverInfo?.version || ''}`.trim());
  console.log(`Protocol: ${discovery?.protocolVersion || VERSION}`);

  const listed = await rpc(2, 'tools/list');
  const tools = Array.isArray(listed?.tools) ? listed.tools : [];
  console.log(`Tools (${tools.length}): ${tools.map((tool) => tool.name).join(', ')}`);

  const context = await rpc(3, 'tools/call', {
    name: 'get_current_space_context',
    arguments: {}
  });
  const text = context?.content?.find?.((item) => item?.type === 'text')?.text || '';
  if (!text.includes('SPACE:')) throw new Error('No shared Memory Space context returned');

  console.log('\nShared Memory Space context:\n');
  console.log(text);
  console.log('\nMCP smoke test PASSED');
} catch (error) {
  console.error(`MCP smoke test FAILED: ${error?.message || error}`);
  process.exit(1);
}
