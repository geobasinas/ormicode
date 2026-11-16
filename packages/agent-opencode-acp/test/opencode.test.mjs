import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startOpenCodeAcp } from '../src/index.ts';
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));

test('OpenCode launcher uses the acp subcommand', async () => {
 let args;
 const connection = await startOpenCodeAcp({ spawn: (_command, received, options) => { args = received; return spawn(process.execPath, [fixture], options); } });
 try { assert.deepEqual(args, ['acp']); }
 finally { connection.close(); }
});
