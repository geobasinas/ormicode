import { createServer } from 'node:http';
const expected = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString('base64')}`;
const server = createServer((req, res) => {
 if (req.headers.authorization !== expected) { res.writeHead(401).end(); return; }
 res.setHeader('content-type', 'application/json');
 if (req.url === '/api/info') return res.end(JSON.stringify({ version: process.env.ORMICODE_FIXTURE_VERSION ?? '2.2.5' }));
 if (req.url === '/api/session' && req.method === 'POST') return res.end(JSON.stringify({ data: { id: 'ses_fake' } }));
 if (req.url === '/api/session/ses_fake' && req.method === 'GET') return res.end(JSON.stringify({ data: { id: 'ses_fake' } }));
 res.writeHead(404).end('{}');
});
server.listen(0, '127.0.0.1', () => console.log(`server listening on http://127.0.0.1:${server.address().port}`));

