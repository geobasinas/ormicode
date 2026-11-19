import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { PreviewProxy, previewLabel } from '../src/preview-proxy.ts';

const request = (port, host, path, options = {}) => new Promise((resolve, reject) => {
  const req = httpRequest({
    hostname: '127.0.0.1', port, path, method: options.method ?? 'GET',
    headers: { ...options.headers, host },
  }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  });
  req.once('error', reject);
  if (options.body) req.write(options.body);
  req.end();
});

async function listenInBlock(server, base, exclude) {
  for (let offset = 0; offset < 10; offset += 1) {
    const port = base + offset;
    if (port === exclude) continue;
    const listened = await new Promise(resolve => {
      const onError = () => { server.off('listening', onListening); resolve(false); };
      const onListening = () => { server.off('error', onError); resolve(true); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    if (listened) return port;
  }
  throw new Error(`no free WebSocket port in ${base}-${base + 9}`);
}

test('preview proxy authenticates, strips its cookie, forwards HTTP and WebSocket, and rotates tokens', async () => {
  const upstream = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://localhost:${upstream.address().port}/next` }).end();
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => res.end(JSON.stringify({
      method: req.method, body: Buffer.concat(chunks).toString(),
      cookie: req.headers.cookie ?? '', host: req.headers.host, origin: req.headers.origin ?? '',
    })));
  });
  const wsUpstream = createNetServer(socket => {
    let buffered = Buffer.alloc(0);
    let handshaken = false;
    socket.on('data', chunk => {
      if (handshaken) { socket.write(chunk); return; }
      buffered = Buffer.concat([buffered, chunk]);
      const boundary = buffered.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const headers = buffered.subarray(0, boundary).toString();
      const key = headers.match(/^sec-websocket-key:\s*(.+)$/im)?.[1];
      assert.ok(key);
      const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      handshaken = true;
      const remainder = buffered.subarray(boundary + 4);
      if (remainder.length) socket.write(remainder);
    });
  });
  let proxy;
  let ws;
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const base = Math.floor(upstreamPort / 10) * 10;
  let wsPort;
  const session = 's_proxy_test';
  const label = previewLabel(session, upstreamPort);
  try {
    wsPort = await listenInBlock(wsUpstream, base, upstreamPort);
    proxy = new PreviewProxy();
    await proxy.listen();
    proxy.register(session, base, upstreamPort);
    proxy.register(session, base, wsPort);
    const host = `${label}.localhost:${proxy.port}`;
    const noCookie = await request(proxy.port, host, '/');
    assert.equal(noCookie.status, 403);
    const auth = new URL(proxy.url(session, base, upstreamPort, '/redirect'));
    const authorized = await request(proxy.port, host, `${auth.pathname}${auth.search}`);
    assert.equal(authorized.status, 302);
    assert.equal(authorized.headers.location, '/redirect');
    const cookie = authorized.headers['set-cookie'][0].split(';')[0];
    const echo = await request(proxy.port, host, '/echo', {
      method: 'POST', headers: { cookie: `${cookie}; session=ok`, origin: 'http://preview.localhost' }, body: 'request-body',
    });
    const echoed = JSON.parse(echo.body);
    assert.equal(echo.status, 200);
    assert.equal(echoed.body, 'request-body');
    assert.equal(echoed.cookie, 'session=ok');
    assert.equal(echoed.host, `127.0.0.1:${upstreamPort}`);
    assert.equal(echoed.origin, `http://127.0.0.1:${upstreamPort}`);
    const redirect = await request(proxy.port, host, '/redirect', { headers: { cookie } });
    assert.equal(redirect.headers.location, `http://${host}/next`);
    assert.equal((await request(proxy.port, 'unknown.localhost', '/')).status, 404);
    proxy.rotate(session, base, upstreamPort);
    assert.equal((await request(proxy.port, host, '/', { headers: { cookie } })).status, 403);

    const wsHost = `${previewLabel(session, wsPort)}.localhost:${proxy.port}`;
    const fresh = new URL(proxy.url(session, base, wsPort, '/'));
    const freshAuth = await request(proxy.port, wsHost, `${fresh.pathname}${fresh.search}`);
    const freshCookie = freshAuth.headers['set-cookie'][0].split(';')[0];
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    const payload = Buffer.from('hello');
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
    ws = connect(proxy.port, '127.0.0.1');
    const websocket = await new Promise((resolve, reject) => {
      let handshakeSent = false;
      let received = Buffer.alloc(0);
      const timer = setTimeout(() => reject(new Error(`websocket echo timed out: ${received.toString('latin1')}`)), 3000);
      ws.on('error', reject);
      ws.on('connect', () => ws.write([
        'GET /socket HTTP/1.1', `Host: ${wsHost}`, 'Connection: Upgrade', 'Upgrade: websocket',
        'Sec-WebSocket-Version: 13', `Sec-WebSocket-Key: ${key}`, `Cookie: ${freshCookie}`, '',
        '',
      ].join('\r\n')));
      ws.on('data', chunk => {
        received = Buffer.concat([received, chunk]);
        if (!handshakeSent && received.includes(Buffer.from('\r\n\r\n'))) { handshakeSent = true; ws.write(frame); }
        if (handshakeSent && received.indexOf(frame) >= 0) { clearTimeout(timer); resolve(received); }
      });
    });
    assert.ok(websocket.includes(Buffer.from('101 Switching Protocols')));
    assert.ok(websocket.indexOf(frame) >= 0);
  } finally {
    ws?.destroy();
    if (proxy) await proxy.close();
    await new Promise(resolve => upstream.close(resolve));
    if (wsUpstream.listening) await new Promise(resolve => wsUpstream.close(resolve));
  }
});
