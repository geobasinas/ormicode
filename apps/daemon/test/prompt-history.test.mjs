import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore, createSession } from '../../../packages/session-store/src/index.ts';
import { append } from '../../../packages/journal/src/index.ts';
import { promptHistory } from '../src/prompt-history.ts';

test('history reads only recent prompts, not full journals, with bounded distinct results', () => {
  const db = openStore(':memory:');
  try {
    for (const [id, project] of [['s_a', '/a'], ['s_b', '/b']]) createSession(db, { id, machine: 'm', project, vendor: 'fake', transport: 'cli', cwd: project });
    db.transaction(() => {
      for (let i = 0; i < 1010; i++) {
        append(db, 's_a', { kind: 'prompt', ts: i, payload: { text: `prompt ${i}` } });
        append(db, 's_a', { kind: 'tool_result', ts: i, payload: { output: 'x'.repeat(2000) } });
      }
      append(db, 's_b', { kind: 'prompt', ts: 2000, payload: { text: 'other project' } });
      append(db, 's_a', { kind: 'prompt', ts: 2001, payload: { text: ' prompt 1009 ' } });
      append(db, 's_a', { kind: 'prompt', ts: 2002, payload: { text: '   ' } });
    })();
    assert.equal(promptHistory(db, { project: '/a', limit: 2 }).length, 2);
    assert.deepEqual(promptHistory(db, { project: '/a', limit: 2 }).map(item => item.text), ['prompt 1009', 'prompt 1008']);
    assert.deepEqual(promptHistory(db, { project: '/a', query: 'PROMPT 1009' }).map(item => item.text), ['prompt 1009']);
    assert.deepEqual(promptHistory(db, { project: '/a', query: 'prompt 0' }), []);
    assert.deepEqual(promptHistory(db, { project: '/missing' }), []);
    assert.deepEqual(promptHistory(db, { project: '/b' }).map(item => item.text), ['other project']);
    assert.equal(promptHistory(db, { limit: 1000 }).length, 100);
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT payload FROM events WHERE kind = 'prompt' ORDER BY ts DESC, seq DESC, session LIMIT 1000").all();
    assert.ok(plan.some(row => row.detail.includes('events_prompt_history')));
    assert.ok(!plan.some(row => row.detail.includes('TEMP B-TREE')));
  } finally { db.close(); }
});

test('empty, archived, and malformed prompt histories are handled safely', () => {
  const db = openStore(':memory:');
  try {
    assert.deepEqual(promptHistory(db, {}), []);
    createSession(db, { id: 's_a', machine: 'm', project: '/a', vendor: 'fake', transport: 'cli', cwd: '/a' });
    db.prepare('UPDATE sessions SET archived = 1 WHERE id = ?').run('s_a');
    append(db, 's_a', { kind: 'prompt', payload: { text: 'archived prompt' } });
    append(db, 's_a', { kind: 'prompt', payload: { text: 42 } });
    db.prepare("UPDATE events SET payload = '{' WHERE seq = 2").run();
    assert.deepEqual(promptHistory(db, {}).map(item => item.text), ['archived prompt']);
  } finally { db.close(); }
});
