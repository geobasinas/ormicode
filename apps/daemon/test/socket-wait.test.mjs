import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Link } from '../src/socket.ts';

test('interactive socket requests can wait for the user and reject on disconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = new EventEmitter();
  let sent;
  socket.setEncoding = () => {};
  socket.write = value => { sent = JSON.parse(value); };
  const link = new Link(socket);
  let answered = false;
  const pending = link.request('session.askUser', {}, 0).then(frame => { answered = true; return frame; });
  t.mock.timers.tick(120_001);
  await Promise.resolve(); assert.equal(answered, false);
  const response = { v: 1, type: 'res', id: sent.id, ok: true, body: { answer: 'yes' } };
  socket.emit('data', JSON.stringify(response) + '\n');
  assert.equal((await pending).body.answer, 'yes');
  const lost = link.request('session.askUser', {}, 0);
  const rejected = assert.rejects(lost, /connection closed/);
  socket.emit('close'); await rejected;
  await assert.rejects(link.request('session.askUser', {}), /connection closed/);
});
