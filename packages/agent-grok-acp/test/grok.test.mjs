import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startGrokAcp } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));

test('Grok launcher uses stdio and does not enable automatic approval', async () => {
 let args;
 const connection = await startGrokAcp({ spawn: (_command, received, options) => { args = received; return spawn(process.execPath, [fixture], options); } });
 try { assert.deepEqual(args, ['--no-auto-update', 'agent', 'stdio']); }
 finally { connection.close(); }
});
