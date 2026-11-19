import assert from 'node:assert/strict';
import test from 'node:test';
import { callBrowserTool, formatBrowserLogs, TOOLS } from '../src/mcp.ts';

test('MCP lists the scoped browser tools', () => {
  const names = TOOLS.map(tool => tool.name);
  for (const name of ['ormi_browser_open', 'ormi_browser_click', 'ormi_browser_type', 'ormi_browser_snapshot', 'ormi_browser_screenshot', 'ormi_browser_logs']) {
    assert.ok(names.includes(name), `${name} listed`);
  }
});

test('browser log formatting includes request, response and five stack frames within the cap', () => {
  const formatted = formatBrowserLogs([{
    kind: 'network', level: 'error', message: 'request failed', method: 'GET', url: '/broken', status: 500,
    requestBody: 'payload', responseBody: 'failure', stack: Array.from({ length: 8 }, (_, i) => `frame ${i}`).join('\n'),
  }]);
  assert.match(formatted, /Request: GET \/broken/);
  assert.match(formatted, /Response: failure/);
  assert.match(formatted, /frame 4/);
  assert.doesNotMatch(formatted, /frame 5/);
  assert.ok(Buffer.byteLength(formatBrowserLogs([{ message: 'x'.repeat(40_000) }])) <= 16 * 1024);
});

test('browser MCP calls map to their scoped daemon methods', async () => {
  const calls = [];
  const req = async (method, body) => {
    calls.push([method, body]);
    if (method === 'browser.screenshot') return { artifact: 'bl_00000000000000000000000000', jpeg: 'AA==' };
    if (method === 'browser.artifact') return { mime: 'image/png', data: 'AA==' };
    if (method === 'browser.snapshot') return { snapshot: 'page' };
    return {};
  };
  await callBrowserTool('ormi_browser_open', { port: 41001 }, 's_self', req);
  await callBrowserTool('ormi_browser_click', { selector: 'role=button[name="Save"]' }, 's_self', req);
  await callBrowserTool('ormi_browser_type', { selector: '#name', text: 'x' }, 's_self', req);
  await callBrowserTool('ormi_browser_snapshot', {}, 's_self', req);
  const image = await callBrowserTool('ormi_browser_screenshot', {}, 's_self', req);
  await callBrowserTool('ormi_browser_logs', { kind: 'network', after: 2 }, 's_self', req);
  assert.deepEqual(calls.map(([method]) => method), [
    'browser.open', 'browser.click', 'browser.type', 'browser.snapshot', 'browser.screenshot', 'browser.artifact', 'preview.console',
  ]);
  assert.equal(calls[0][1].session, 's_self');
  assert.equal(calls[1][1].selector, 'role=button[name="Save"]');
  assert.equal(image.content[1].type, 'image');
  assert.equal(image.content[1].mimeType, 'image/jpeg');
});
