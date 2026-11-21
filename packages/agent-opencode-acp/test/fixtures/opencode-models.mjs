// Fake `opencode` for models(): `serve` answers info/health/model list, `models` prints ids.
import { createServer } from 'node:http';
const [command] = process.argv.slice(2);
if (command === 'models') {
  console.log('prov/model-1\nprov/model-2\nnot-a-model');
  process.exit(0);
}
if (command !== 'serve' || process.env.ORMICODE_FAKE_SERVE === 'fail') process.exit(1);
const expected = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
const server = createServer((req, res) => {
  if (req.headers.authorization !== expected) { res.writeHead(401).end(); return; }
  const { pathname } = new URL(req.url, 'http://localhost');
  res.setHeader('content-type', 'application/json');
  if (pathname === '/api/info') return res.end(JSON.stringify({ version: '2.2.5' }));
  if (pathname === '/api/health' || pathname === '/global/health') return res.end(JSON.stringify({ healthy: true }));
  if (pathname === '/api/model' && req.method === 'GET') return res.end(JSON.stringify({ location: {}, data: [
    { id: 'm1', modelID: 'model-1', providerID: 'prov', name: 'Model One', variants: [{ id: 'low' }, { id: 'high' }] },
    { id: 'model-2', providerID: 'prov' },
  ] }));
  res.writeHead(404).end('{}');
});
server.listen(0, '127.0.0.1', () => console.log(`opencode server listening on http://127.0.0.1:${server.address().port}`));
