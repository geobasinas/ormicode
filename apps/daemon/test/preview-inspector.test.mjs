import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { parseWireFrame } from '@ormicode/protocol';
import { onClientFrame } from '../src/dispatch.ts';
import { PreviewProxy, previewLabel } from '../src/preview-proxy.ts';
import { isInspectorHttpFailure, serializeInspectorValue, trimInspectorStack } from '../src/preview-inspector-helpers.ts';
import { PreviewInspector, buildElementSelector, parseReactDebugStack, previewInspectorScript, truncateInspectorText } from '../src/preview-inspector.ts';

const request = (port, host, path, options = {}) => new Promise((resolve, reject) => {
  const req = httpRequest({ hostname: '127.0.0.1', port, path, method: options.method ?? 'GET',
    headers: { host, ...options.headers } }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.once('error', reject);
  req.end(options.body);
});

test('preview console clear frames parse and dispatch', async () => {
  const session = 's_00000000000000000000000000';
  const id = 'req_00000000000000000000000000';
  const frame = JSON.stringify({
    v: 1, type: 'req', id, method: 'preview.consoleClear', body: { session }, ts: Date.now(),
  });
  const parsed = parseWireFrame(frame);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  let cleared;
  let reply;
  await onClientFrame({ db: {}, services: { clearPreviewConsole: value => { cleared = value; } } },
    { link: { reply: (requestId, body) => { reply = { requestId, body }; }, replyError: (_requestId, code, message) => { throw new Error(`${code}: ${message}`); } }, subscriptions: new Set(), device: 'test' },
    parsed.data);
  assert.equal(cleared, session);
  assert.deepEqual(reply, { requestId: id, body: { cleared: true } });
});

test('inspector helper truncation and React dev-stack parsing are bounded', () => {
  assert.equal(truncateInspectorText('short', 10), 'short');
  assert.equal(truncateInspectorText('01234567890123456789', 18), '0123[truncated]');
  assert.equal(parseReactDebugStack('Error\n    at PreviewCard (http://localhost:5173/src/Card.jsx?t=abc:12:7)'), 'http://localhost:5173/src/Card.jsx:12:7');
  assert.equal(parseReactDebugStack('Error\n at render (node_modules/react-dom/client.js:4:2)'), undefined);
  const target = { nodeType: 1, tagName: 'BUTTON', id: '', parentElement: null, children: [], getAttribute: name => name === 'data-testid' ? 'save' : null };
  assert.equal(buildElementSelector(target, selector => selector === '[data-testid="save"]'), '[data-testid="save"]');
  const siblings = ['first', 'second'].map(() => ({ nodeType: 1, tagName: 'DIV', id: '', parentElement: null, children: [], getAttribute: () => null }));
  const parent = { nodeType: 1, tagName: 'MAIN', id: '', parentElement: null, children: siblings, getAttribute: () => null };
  siblings.forEach(child => { child.parentElement = parent; });
  assert.equal(buildElementSelector(siblings[1], selector => selector === 'div:nth-of-type(2)'), 'div:nth-of-type(2)');
  assert.match(previewInspectorScript, /__ormiPreview/);
  assert.match(previewInspectorScript, /window\.onerror/);
  assert.match(previewInspectorScript, /buildSelector/);
  assert.match(previewInspectorScript, /unhandledrejection/);
  assert.match(previewInspectorScript, /stack: trimStack\(error && error\.stack \|\| new Error\(\)\.stack/);
  assert.match(previewInspectorScript, /if \(failedStatus\(response\.status\)\) add/);
  assert.match(previewInspectorScript, /if \(failedStatus\(this\.status\)\)/);
  assert.match(previewInspectorScript, /args\.find\(value => value instanceof Error\)/);
  assert.match(previewInspectorScript, /new Error\(\)\.stack/);
  assert.match(previewInspectorScript, /addEventListener\('error', \(\) => record/);
});

test('inspector captures HTTP failures and serializes errors and circular values safely', () => {
  const error = new Error('fixture failed');
  assert.equal(serializeInspectorValue(error, 2048), 'Error: fixture failed');
  assert.match(previewInspectorScript, /stack: trimStack\(error && error\.stack/);
  assert.doesNotMatch(serializeInspectorValue(error, 2048), /preview-inspector\.test\.mjs/);
  const circular = { ok: true }; circular.self = circular;
  assert.match(serializeInspectorValue(circular, 2048), /"\[Circular\]"/);
  assert.ok(serializeInspectorValue({ value: 'x'.repeat(100) }, 32).length <= 32);
  assert.equal(isInspectorHttpFailure(200), false);
  assert.equal(isInspectorHttpFailure(404), true);
  assert.equal(isInspectorHttpFailure(500), true);
  const stack = trimInspectorStack('Error: failed\n at report (http://site/__ormi/inspect.js:1:2)\n at click (http://site/src/main.jsx:8:4)');
  assert.doesNotMatch(stack, /__ormi\/inspect\.js/);
  assert.match(stack, /src\/main\.jsx:8:4/);
  assert.match(previewInspectorScript, /failedStatus\(response\.status\)/);
  assert.match(previewInspectorScript, /xhrSend\.apply/);
});

test('console ring enforces target rate, caps at 500, pages by cursor, and clears', () => {
  const inspector = new PreviewInspector();
  const batch = () => Array.from({ length: 50 }, (_, index) => ({ kind: 'error', level: 'error', message: `error-${index}` }));
  for (let index = 0; index < 5; index += 1) inspector.report('s_ring', 41000, { path: '/', entries: batch() }, 1000);
  for (let index = 0; index < 4; index += 1) inspector.report('s_ring', 41000, { path: '/', entries: batch() }, 2000);
  for (let index = 0; index < 4; index += 1) inspector.report('s_ring', 41000, { path: '/', entries: batch() }, 3000);
  const page = inspector.list('s_ring', undefined, 500);
  assert.equal(page.entries.length, 500);
  assert.equal(page.entries[0].seq, 101);
  assert.equal(page.next, 600);
  assert.equal(page.dropped, 50);
  assert.equal(inspector.list('s_ring', 590).entries.length, 10);
  assert.deepEqual(inspector.forPrompt('s_ring', []).map(entry => entry.seq), Array.from({ length: 10 }, (_, index) => 591 + index));
  inspector.clear('s_ring');
  assert.deepEqual(inspector.list('s_ring'), { entries: [], next: 0, dropped: 0 });
  inspector.report('s_other', 41000, { entries: [{ kind: 'error', message: 'other session' }] }, 4000);
  assert.equal(inspector.list('s_other').entries[0].message, 'other session');
  inspector.report('s_ring', 41000, { entries: batch().slice(0, 1) }, 4000);
  assert.equal(inspector.list('s_ring').entries[0].seq, 601);
});

test('proxy injects authenticated inspector script into bounded HTML and accepts bounded reports', async () => {
  const identity = [];
  const large = Buffer.concat([Buffer.from('<html><head></head>'), Buffer.alloc(5 * 1024 * 1024 + 1, 97)]);
  const upstream = createServer((req, res) => {
    identity.push(req.headers['accept-encoding']);
    if (req.url === '/head') return res.writeHead(200, { 'content-type': 'text/html', etag: '"head"' }).end('<html><head id="x"></head><body>ok</body></html>');
    if (req.url === '/app') return res.writeHead(200, { 'content-type': 'text/html' }).end('<html><head></head><script type="module" src="/src/app.js"></script></html>');
    if (req.url === '/nohead') return res.writeHead(200, { 'content-type': 'text/html' }).end('<main>ok</main>');
    if (req.url === '/json') return res.writeHead(200, { 'content-type': 'application/json' }).end('{"markup":"<head>"}');
    if (req.url === '/large') return res.writeHead(200, { 'content-type': 'text/html', 'content-length': large.length, etag: '"large"' }).end(large);
    return res.end('ok');
  });
  let proxy;
  try {
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const port = upstream.address().port;
    const session = 's_inspector';
    const base = Math.floor(port / 10) * 10;
    proxy = new PreviewProxy();
    await proxy.listen();
    proxy.register(session, base, port);
    const host = `${previewLabel(session, port)}.localhost:${proxy.port}`;
    const authUrl = new URL(proxy.url(session, base, port, '/'));
    const auth = await request(proxy.port, host, `${authUrl.pathname}${authUrl.search}`);
    const cookie = auth.headers['set-cookie'][0].split(';')[0];
    const denied = await request(proxy.port, host, '/__ormi/inspect.js');
    assert.equal(denied.status, 403);
    const script = await request(proxy.port, host, '/__ormi/inspect.js', { headers: { cookie } });
    assert.equal(script.status, 200);
    assert.equal(script.headers['cache-control'], 'no-store');
    assert.match(script.body.toString(), /__ormiPreview/);

    const head = await request(proxy.port, host, '/head', { headers: { cookie, accept: 'text/html' } });
    assert.match(head.body.toString(), /<head id="x"><script src="\/__ormi\/inspect.js"><\/script>/);
    assert.doesNotMatch(head.body.toString(), /<script[^>]+(?:async|defer)/i);
    const app = await request(proxy.port, host, '/app', { headers: { cookie, accept: 'text/html' } });
    assert.ok(app.body.toString().indexOf('/__ormi/inspect.js') < app.body.toString().indexOf('/src/app.js'));
    assert.equal(head.headers['content-length'], undefined);
    assert.equal(head.headers.etag, undefined);
    const noHead = await request(proxy.port, host, '/nohead', { headers: { cookie, accept: 'text/html' } });
    assert.ok(noHead.body.toString().startsWith('<script src="/__ormi/inspect.js"></script>'));
    const json = await request(proxy.port, host, '/json', { headers: { cookie, accept: 'text/html' } });
    assert.equal(json.body.toString(), '{"markup":"<head>"}');
    assert.equal(identity[0], 'identity');
    assert.equal(identity[1], 'identity');
    const passthrough = await request(proxy.port, host, '/large', { headers: { cookie, accept: 'text/html' } });
    assert.equal(passthrough.body.length, large.length);
    assert.equal(passthrough.body[0], large[0]);
    assert.equal(passthrough.headers['content-length'], String(large.length));
    assert.equal(passthrough.headers.etag, '"large"');

    assert.equal((await request(proxy.port, host, '/__ormi/report', { method: 'POST', body: '{"entries":[]}' })).status, 403);
    assert.equal((await request(proxy.port, host, '/__ormi/report', { headers: { cookie } })).status, 405);
    const entry = { kind: 'network', level: 'error', message: 'HTTP 500', method: 'GET', url: '/broken', status: 500 };
    const report = await request(proxy.port, host, '/__ormi/report', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ path: '/page', entries: [entry] }),
    });
    assert.equal(report.status, 204);
    assert.equal(proxy.console(session).entries[0].url, '/broken');
    proxy.clearConsole(session);
    assert.deepEqual(proxy.console(session).entries, []);
    const tooMany = JSON.stringify({ entries: Array.from({ length: 51 }, () => entry) });
    assert.equal((await request(proxy.port, host, '/__ormi/report', { method: 'POST', headers: { cookie }, body: tooMany })).status, 400);
    assert.equal((await request(proxy.port, host, '/__ormi/report', { method: 'POST', headers: { cookie }, body: 'x'.repeat(65_537) })).status, 413);
  } finally {
    if (proxy) await proxy.close();
    await new Promise(resolve => upstream.close(resolve));
  }
});
