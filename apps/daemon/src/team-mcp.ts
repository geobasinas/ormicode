const string = { type: 'string' };
const session = { session: string };
const props: Record<string, { method: string; required?: string[]; properties: Record<string, unknown> }> = {
  team_approve: { method: 'team.approve', required: ['session', 'request', 'option', 'reason'], properties: { ...session, request: string, option: string, reason: string } },
  team_spawn: { method: 'team.spawn', required: ['task'], properties: { task: string, vendor: string, transport: string, model: string, effort: string, mode: string, toolAllowlist: { type: 'array', items: string } } },
  team_roster: { method: 'team.tree', properties: {} },
  team_status: { method: 'team.status', required: ['session'], properties: session },
  team_wait: { method: 'team.status', required: ['session'], properties: { ...session, until: { type: 'string', enum: ['idle', 'done', 'approval'] }, timeoutMs: { type: 'number' } } },
  team_send: { method: 'team.message', required: ['to', 'text'], properties: { to: string, text: string, urgent: { type: 'boolean' } } },
  team_reply: { method: 'team.message', required: ['replyTo', 'text'], properties: { replyTo: string, text: string, urgent: { type: 'boolean' } } },
  team_inbox: { method: 'team.inbox', properties: {} },
  team_cancel: { method: 'team.cancel', required: ['session'], properties: session },
  team_reassign: { method: 'team.reassign', required: ['session', 'task'], properties: { ...session, task: string } },
  team_close: { method: 'team.close', required: ['session'], properties: session },
  team_diff: { method: 'team.diff', required: ['session'], properties: session },
  team_report: { method: 'team.report', required: ['session'], properties: session },
  team_board_read: { method: 'team.board', properties: {} },
  team_board_write: { method: 'team.board', required: ['text'], properties: { text: string, action: { type: 'string', enum: ['append', 'setState'] } } },
};
export const TEAM_TOOLS = Object.entries(props).map(([name, spec]) => ({
  name, description: `${name.replaceAll('_', ' ')} in this session's team`,
  inputSchema: { type: 'object', properties: spec.properties, ...(spec.required ? { required: spec.required } : {}) },
}));
export async function callTeamTool(
  name: string, args: Record<string, unknown>, actor: string,
  req: (method: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>,
  wait: (session: string, until: string, timeout: number) => Promise<string>,
): Promise<string> {
  const spec = props[name];
  if (!spec) throw new Error(`unknown tool ${name}`);
  const body = Object.fromEntries(Object.keys(spec.properties).filter(key => args[key] !== undefined).map(key => [key, args[key]]));
  if (name === 'team_board_read') body.action = 'read';
  if (name === 'team_board_write') body.action = args.action ?? 'append';
  const result = await req(spec.method, { ...body, actor });
  if (name === 'team_wait') {
    const until = String(args.until ?? 'idle');
    if ((until !== 'approval' && ['idle', 'done', 'failed', 'archived', 'interrupted'].includes(String(result.state)))
      || (until === 'approval' && ['awaiting_approval', 'awaiting_input'].includes(String(result.state)))) return JSON.stringify(result);
    return wait(String(args.session), until, Number(args.timeoutMs ?? 120_000));
  }
  return JSON.stringify(result);
}
