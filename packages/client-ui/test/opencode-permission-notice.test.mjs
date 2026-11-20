import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

test('OpenCode ACP policy warning is visible in the header and all agent-picker layouts', async () => {
 const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/components/ui/dropdown-menu.tsx')) return { shortCircuit: true, format: 'module', source: `
   import { createElement } from 'react';
   const Box = ({ children }) => createElement('div', null, children);
   export { Box as DropdownMenu, Box as DropdownMenuContent, Box as DropdownMenuItem, Box as DropdownMenuLabel,
    Box as DropdownMenuRadioGroup, Box as DropdownMenuRadioItem, Box as DropdownMenuCheckboxItem,
    Box as DropdownMenuSeparator, Box as DropdownMenuSub, Box as DropdownMenuSubContent, Box as DropdownMenuSubTrigger, Box as DropdownMenuTrigger };
  ` };
  if (!url.endsWith('.tsx')) return next(url, context);
  return { shortCircuit: true, format: 'module', source: transformSync(readFileSync(new URL(url), 'utf8'), { loader: 'tsx', jsx: 'automatic', format: 'esm' }).code };
 } });
 try {
  const { OpenCodePermissionNotice } = await import('../src/features/session/OpenCodePermissionNotice.tsx');
  const renderNotice = props => renderToStaticMarkup(createElement(OpenCodePermissionNotice, props));
  const full = renderNotice({ vendor: 'opencode', transport: 'acp' });
  assert.match(full, /runs with its own permission policy/);
  assert.match(full, /Edits and shell commands may run without an Ormicode approval card/);
  assert.match(full, /Deny blocks only a request OpenCode sends/);
  assert.match(full, /role="note"/);
  for (const props of [{}, { vendor: 'claude', transport: 'sdk' }, { vendor: 'opencode', transport: 'sdk' }, { vendor: 'opencode', transport: 'cli' }]) {
   assert.equal(renderNotice(props), '');
  }
  const { PlatformContext } = await import('../src/lib/platform.ts');
  const { SessionHeader } = await import('../src/features/session/SessionHeader.tsx');
  const platform = { transport: { request: async () => { throw new Error('Rendering a warning must not make an RPC request'); } } };
  const header = details => renderToStaticMarkup(createElement(PlatformContext.Provider, { value: platform }, createElement(SessionHeader, { session: 's1', details })));
  assert.match(header({ vendor: 'opencode', transport: 'acp', state: 'idle' }), />OpenCode may write without approval</);
  assert.doesNotMatch(header(undefined), /OpenCode ACP permission policy/);
  assert.doesNotMatch(header({ vendor: 'opencode', transport: 'sdk', state: 'failed' }), /OpenCode ACP permission policy/);
  const { AgentChip } = await import('../src/features/session/pickers.tsx');
  const base = { vendor: 'opencode', via: 'acp', model: 'default', effort: 'default', models: [], onPick() {}, onModel() {}, onEffort() {}, loading: false, refresh: async () => {} };
  for (const transports of [['acp'], ['cli', 'sdk', 'acp']]) {
   const html = renderToStaticMarkup(createElement(AgentChip, { ...base, agents: [{ vendor: 'opencode', transports }] }));
   assert.match(html, /Edits and shell commands may run without an Ormicode approval card/);
  }
  const withoutAcp = renderToStaticMarkup(createElement(AgentChip, { ...base, via: 'sdk', agents: [{ vendor: 'opencode', transports: ['sdk', 'cli'] }] }));
  assert.doesNotMatch(withoutAcp, /OpenCode ACP permission policy/);
 } finally { hook.deregister(); }
});
