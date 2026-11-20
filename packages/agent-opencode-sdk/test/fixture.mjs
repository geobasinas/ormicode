import { createServer } from 'node:http';
const expected = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
const version = process.env.ORMICODE_FIXTURE_VERSION ?? '2.2.5';
const banner = process.env.ORMICODE_FIXTURE_BANNER ?? 'server listening';
const healthOnly = process.env.ORMICODE_FIXTURE_HEALTH === '1';
const events = [];
const pending = [];
let seq = 0;
const send = (type, data) => {
  const frame = `data: ${JSON.stringify({ id: `evt_${++seq}`, created: seq, type, data })}\n\n`;
  if (!events.length) { pending.push(frame); return; }
  for (const res of events) res.write(frame);
};
const read = req => new Promise(resolve => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => resolve(body ? JSON.parse(body) : {})); });
const server = createServer(async (req, res) => {
  if (req.headers.authorization !== expected) { res.writeHead(401).end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/event' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ id: 'evt_0', created: 0, type: 'server.connected', data: {} })}\n\n`);
    events.push(res); req.on('close', () => events.splice(events.indexOf(res), 1));
    while (pending.length) res.write(pending.shift()); return;
  }
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/api/info') {
    if (healthOnly) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html>'); }
    return res.end(JSON.stringify({ version }));
  }
  if (url.pathname === '/global/health' || url.pathname === '/api/health') return res.end(JSON.stringify({ healthy: true, version }));
  if (url.pathname === '/api/model' && req.method === 'GET') return res.end(JSON.stringify({ location: {}, data: [{ id: 'm1', modelID: 'model-1', providerID: 'prov', name: 'Model One', variants: [{ id: 'low' }, { id: 'high' }] }] }));
  if (url.pathname === '/api/session' && req.method === 'POST') return res.end(JSON.stringify({ data: { id: 'ses_fake' } }));
  const session = /^\/api\/session\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (session && session[2] === undefined && req.method === 'GET') return res.end(JSON.stringify({ data: { id: session[1] } }));
  if (session && session[2] === '/prompt' && req.method === 'POST') {
    const body = await read(req);
    const sid = session[1];
    res.end(JSON.stringify({ data: { id: 'msg_1', sessionID: sid, time: { created: 0 }, type: 'user', payload: { type: 'text', text: body.text }, delivery: { state: 'queued' } } }));
    if (body.text === 'approval') {
      send('permission.asked', { id: 'per_1', sessionID: sid, action: 'bash', resources: ['*'] });
    } else if (body.text === 'fail') {
      send('session.execution.failed', { sessionID: sid, error: { type: 'boom', message: 'the turn exploded' } });
    } else if (body.text === 'wait') {
      // Stays running until /interrupt arrives.
    } else {
      send('session.text.delta', { sessionID: sid, assistantMessageID: 'msg_2', ordinal: 0, delta: 'hello' });
      send('session.text.ended', { sessionID: sid, assistantMessageID: 'msg_2', ordinal: 0, text: 'hello' });
      send('session.usage.updated', { sessionID: sid, cost: 0.01, tokens: { input: 10, output: 4, reasoning: 0, cache: { read: 2, write: 0 } } });
      send('session.execution.succeeded', { sessionID: sid });
    }
    return;
  }
  if (session && /^\/permission\/[^/]+\/reply$/.test(session[2] ?? '') && req.method === 'POST') {
    const body = await read(req);
    res.writeHead(204).end();
    send('session.text.delta', { sessionID: session[1], assistantMessageID: 'msg_2', ordinal: 0, delta: `decided ${body.decision}` });
    send('session.text.ended', { sessionID: session[1], assistantMessageID: 'msg_2', ordinal: 0, text: `decided ${body.decision}` });
    send('session.execution.succeeded', { sessionID: session[1] });
    return;
  }
  if (session && session[2] === '/interrupt' && req.method === 'POST') {
    res.end(JSON.stringify({ interrupted: true }));
    send('session.execution.interrupted', { sessionID: session[1], reason: 'user' });
    return;
  }
  if (session && (session[2] === '/model' || session[2] === '/agent') && req.method === 'POST') { await read(req); return res.writeHead(204).end(); }
  res.writeHead(404).end('{}');
});
server.listen(0, '127.0.0.1', () => console.log(`${banner} on http://127.0.0.1:${server.address().port}`));
