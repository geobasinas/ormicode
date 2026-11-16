import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodePermissionBroker } from '../src/permissions.ts';
const input = { sessionId: 's1', toolCall: { toolCallId: 't1', title: 'Edit file' }, options: [{ optionId: 'yes', name: 'Allow once', kind: 'allow_once' }, { optionId: 'no', name: 'Deny', kind: 'reject_once' }] };
test('permission broker forwards the exact selected option', async () => {
 const events = []; const broker = new OpenCodePermissionBroker(event => events.push(event));
 const decision = broker.request(input, 's1');
 assert.equal(events[0].kind, 'approval_request');
 assert.throws(() => broker.decide(events[0].request, 'bad'), /Unknown/);
 broker.decide(events[0].request, 'no');
 assert.deepEqual(await decision, { outcome: { outcome: 'selected', optionId: 'no' } });
 assert.equal(events[1].kind, 'approval_decision');
});
test('permission broker cancels pending or invalid requests', async () => {
 const events = []; const broker = new OpenCodePermissionBroker(event => events.push(event));
 assert.deepEqual(await broker.request(input, 'wrong'), { outcome: { outcome: 'cancelled' } });
 const pending = broker.request(input, 's1'); broker.expireAll('disposed');
 assert.deepEqual(await pending, { outcome: { outcome: 'cancelled' } });
 assert.equal(events[1].kind, 'interaction_expired');
});
