import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Checkpoints } from '../src/index.ts';

const setup = (limits) => {
  const base = mkdtempSync(join(tmpdir(), 'ormi-cp-'));
  const wt = join(base, 'wt'); mkdirSync(wt);
  return { base, wt, cps: new Checkpoints(join(base, 'shadow'), limits) };
};

test('snapshot captures untracked files, skips no-change, honours .gitignore and the user repo', async () => {
  const { wt, cps } = setup();
  execFileSync('git', ['init', '-q', wt]);
  writeFileSync(join(wt, '.gitignore'), 'secret.txt\n');
  writeFileSync(join(wt, 'a.txt'), 'one\n');
  writeFileSync(join(wt, 'secret.txt'), 'x');
  const first = await cps.snapshot('s_1', wt, 3, 'Write');
  assert.ok(first.checkpoint);
  assert.equal((await cps.snapshot('s_1', wt, 4, 'Read')).checkpoint, null);
  writeFileSync(join(wt, 'a.txt'), 'two\n');
  const second = (await cps.snapshot('s_1', wt, 5, 'Edit')).checkpoint;
  const list = await cps.repo('s_1').list();
  assert.deepEqual(list.map(c => [c.seq, c.tool]), [[5, 'Edit'], [3, 'Write']]);
  const { patch } = await cps.repo('s_1').diff(list[0]);
  assert.match(patch, /-one\n\+two/);
  assert.doesNotMatch((await cps.repo("s_1").diff(list[1])).patch, /b\/secret\.txt/);
  // The user's own repo has no commits and an untouched index.
  assert.equal(execFileSync('git', ['-C', wt, 'status', '--porcelain']).toString().includes('?? a.txt'), true);
  assert.ok(second);
});

test('restore puts files back and deletes files the checkpoint lacks', async () => {
  const { wt, cps } = setup();
  writeFileSync(join(wt, 'a.txt'), 'one\n');
  const cp = (await cps.snapshot('s_2', wt, 1, 'Write')).checkpoint;
  writeFileSync(join(wt, 'a.txt'), 'broken\n');
  writeFileSync(join(wt, 'new.txt'), 'extra');
  await cps.snapshot('s_2', wt, 2, 'Bash');
  await cps.repo('s_2').restore(wt, cp);
  assert.equal(readFileSync(join(wt, 'a.txt'), 'utf8'), 'one\n');
  assert.equal(existsSync(join(wt, 'new.txt')), false);
  assert.equal(cps.repo('s_2').pinned(), cp.id);
  const other = join(wt, '..', 'fork'); mkdirSync(other);
  await cps.repo('s_2').writeTo(other, cp);
  assert.equal(readFileSync(join(other, 'a.txt'), 'utf8'), 'one\n');
});

test('max prunes oldest first but keeps the restored-to checkpoint', async () => {
  const { wt, cps } = setup({ max: 2, maxBytes: 1024 ** 3 });
  writeFileSync(join(wt, 'f'), '0');
  const keep = (await cps.snapshot('s_3', wt, 0, 't')).checkpoint;
  await cps.repo('s_3').restore(wt, keep);
  for (let i = 1; i <= 3; i++) { writeFileSync(join(wt, 'f'), String(i)); await cps.snapshot('s_3', wt, i, 't'); }
  assert.deepEqual((await cps.repo('s_3').list()).map(c => c.seq), [3, 0]);
});

test('a checkpoint alone over maxBytes is reported, and remove deletes the shadow repo', async () => {
  const { wt, cps } = setup({ max: 200, maxBytes: 1 });
  writeFileSync(join(wt, 'f'), 'data');
  const res = await cps.snapshot('s_4', wt, 1, 't');
  assert.ok(res.checkpoint); assert.ok(res.overCap > 1);
  await cps.remove('s_4');
  assert.equal(cps.repo('s_4').exists(), false);
});
