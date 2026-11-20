import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpPermissionBroker } from '../src/permissions.ts';

test('ACP cancellation journals each pending permission closure once, including an empty broker', async () => {
  const events = [], broker = new AcpPermissionBroker(event => events.push(event));
  broker.expireAll('cancelled'); assert.deepEqual(events, []);
  const input = { sessionId: 's', title: 'Run?', options: [{ optionId: 'allow', name: 'Allow' }] };
  const pending = [broker.request(input, 's'), broker.request(input, 's')];
  const requests = events.map(e => e.request);
  broker.expireAll('cancelled'); broker.expireAll('cancelled');
  assert.deepEqual(events.slice(2), requests.map(request => ({ kind: 'interaction_expired', request, reason: 'cancelled' })));
  assert.deepEqual(await Promise.all(pending), pending.map(() => ({ outcome: { outcome: 'cancelled' } })));
  for (const request of requests) assert.throws(() => broker.decide(request, 'allow'), /Unknown/);
});
