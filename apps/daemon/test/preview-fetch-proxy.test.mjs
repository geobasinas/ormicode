import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { PreviewProxy } from '../src/preview-proxy.ts';

test('preview fetch adds proxy auth, injects inspection, strips hop headers and forwards POST data', async () => {
  let observed;
  const upstream = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      observed = { headers: req.headers, body: Buffer.concat(chunks).toString() };
      res.writeHead(200, {
        'content-type': 'text/html', 'set-cookie': ['app=ok; Path=/'],
        connection: 'x-private', 'x-private': 'response-secret', 'proxy-authenticate': 'response-secret',
      });
      res.end(req.method === 'GET' ? '<html><head></head><body>ok</body></html>' : 'ok');
    });
  });
  const proxy = new PreviewProxy();
  try {
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const port = upstream.address().port;
    await proxy.listen();
    proxy.register('s_preview_fetch', Math.floor(port / 10) * 10, port);
    const headers = {
      accept: 'text/html', cookie: 'app=1; __ormi_preview=spoofed', host: 'untrusted.invalid',
      connection: 'x-private', 'x-private': 'request-secret', 'proxy-authorization': 'request-secret',
    };
    const posted = await proxy.fetch('s_preview_fetch', port, 'POST', '/submit', headers, Buffer.from('post payload'));
    assert.equal(posted.status, 200);
    assert.equal(observed.body, 'post payload');
    assert.equal(observed.headers.host, `127.0.0.1:${port}`);
    assert.equal(observed.headers.cookie, 'app=1');
    assert.equal(observed.headers['x-private'], undefined);
    assert.equal(observed.headers['proxy-authorization'], undefined);
    const response = await proxy.fetch('s_preview_fetch', port, 'GET', '/', headers, Buffer.alloc(0));
    assert.match(response.body.toString(), /__ormi\/inspect\.js/);
    assert.ok(response.headers['set-cookie']);
    assert.equal(response.headers['x-private'], undefined);
    assert.equal(response.headers['proxy-authenticate'], undefined);
  } finally {
    await proxy.close();
    await new Promise(resolve => upstream.close(resolve));
  }
});
