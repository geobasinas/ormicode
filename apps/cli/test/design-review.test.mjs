import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { newId } from '@ormicode/protocol';
import { serve } from '../../daemon/src/socket.ts';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../src/ormi.ts', import.meta.url));

test('design CLI forwards versions and mentionable requests and reports errors', async () => {
  const requests = [];
  const links = [];
  const session = newId('s');
  const server = await serve('127.0.0.1:0', link => {
    links.push(link);
    link.onFrame = frame => {
      if (frame.type !== 'req') return;
      requests.push({ method: frame.method, body: frame.body });
      if (frame.body.slug === 'missing') link.replyError(frame.id, 'design.not_found', 'Missing board');
      else link.reply(frame.id, frame.method === 'design.frameVersions' ? { versions: [] } : { sessions: [{ id: session, vendor: 'fake' }] });
    };
  });
  const env = { ...process.env, ORMICODE_REMOTE: '0', ORMICODE_SOCKET: `127.0.0.1:${server.address().port}` };
  try {
    const versions = await run(process.execPath, [cli, 'design', 'versions', session, 'home', 'frame1'], { env });
    assert.deepEqual(JSON.parse(versions.stdout), { versions: [] });
    const mentionable = await run(process.execPath, [cli, 'design', 'mentionable', session], { env });
    assert.deepEqual(JSON.parse(mentionable.stdout), { sessions: [{ id: session, vendor: 'fake' }] });
    assert.deepEqual(requests, [
      { method: 'design.frameVersions', body: { session, slug: 'home', frameId: 'frame1' } },
      { method: 'design.mentionable', body: { session } },
    ]);
    await assert.rejects(run(process.execPath, [cli, 'design', 'versions', session, 'missing', 'frame1'], { env }), error => error.code === 1 && /design.not_found: Missing board/.test(error.stderr));
    await assert.rejects(run(process.execPath, [cli, 'design', 'versions'], { env }), error => error.code === 2 && /versions <session> <slug> <frame-id>/.test(error.stderr));
    await assert.rejects(run(process.execPath, [cli, 'design', 'mentionable'], { env }), error => error.code === 2 && /mentionable <session>/.test(error.stderr));
  } finally {
    for (const link of links) link.close();
    await new Promise(resolve => server.close(resolve));
  }
});
