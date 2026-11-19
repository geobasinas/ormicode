import assert from 'node:assert/strict';
import test from 'node:test';
import { pushToComposer, subscribeToComposer } from '../src/lib/composer-inbox.ts';

test('composer inbox publishes only to subscribers for the matching session', () => {
  const first = [];
  const second = [];
  const unsubscribe = subscribeToComposer('session-a', message => first.push(message));
  const unsubscribeOther = subscribeToComposer('session-b', message => second.push(message));
  try {
    const message = { text: 'Inspect this', context: [{ kind: 'element', element: { selector: '#card' } }], send: true };
    pushToComposer('session-a', message);
    assert.deepEqual(first, [message]);
    assert.deepEqual(second, []);
    unsubscribe();
    pushToComposer('session-a', { text: 'ignored' });
    assert.deepEqual(first, [message]);
  } finally {
    unsubscribe(); unsubscribeOther();
  }
});
