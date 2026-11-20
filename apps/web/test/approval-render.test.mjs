import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('approval rows display parent escalation reasons, including handoffs and optional reasons', async () => {
  const server = await createServer({
    root: fileURLToPath(new URL('../../..', import.meta.url)), configFile: false,
    plugins: [react()], appType: 'custom',
    server: { middlewareMode: true, ws: false, watch: null },
  });
  try {
    const { Approvals } = await server.ssrLoadModule('/packages/client-ui/src/features/session/Approvals.tsx');
    const { PlatformContext } = await server.ssrLoadModule('/packages/client-ui/src/lib/platform.ts');
    const render = body => {
      const request = { kind: 'approval_request', seq: 1, body: { request: 'req_test', options: [{ id: 'allow', label: 'Allow once' }], ...body } };
      return renderToStaticMarkup(createElement(PlatformContext.Provider, { value: { transport: {} } },
        createElement(Approvals, { session: 'child', pending: [request], events: [request] })));
    };
    for (const approvalKind of [undefined, 'handoff']) {
      const body = { approvalKind, escalatedBy: 'parent', description: 'Original permission details' };
      assert.match(render({ ...body, escalationReason: 'Major security design decision' }), /Escalated by parent: Major security design decision/);
      assert.match(render({ ...body, escalationReason: 'Major security design decision' }), /Original permission details/);
      for (const escalationReason of [undefined, '', '   ']) {
        const html = render({ ...body, escalationReason });
        assert.match(html, /Escalated by parent/);
        assert.doesNotMatch(html, /Escalated by parent:/);
      }
    }
    assert.doesNotMatch(render({ escalationReason: 'Not escalated' }), /Escalated by parent/);
    assert.doesNotMatch(render({}), /Escalated by parent/);
    const escaped = render({ escalatedBy: 'parent', escalationReason: '<script>unsafe()</script>' });
    assert.match(escaped, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(escaped, /<script>/);
  } finally { await server.close(); }
});
