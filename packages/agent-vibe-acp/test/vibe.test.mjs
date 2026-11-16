import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startVibeAcp } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));

test('Vibe launcher starts the vibe-acp server', async () => {
 let args;
 const connection = await startVibeAcp({ spawn: (_command, received, options) => { args = received; return spawn(process.execPath, [fixture], options); } });
 try { assert.deepEqual(args, []); }
 finally { connection.close(); }
});
