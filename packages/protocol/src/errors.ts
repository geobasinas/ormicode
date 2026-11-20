export const errorCodes = [
  'mcp.unauthorized', 'mcp.forbidden',
  'session.busy', 'session.already_decided', 'session.not_found', 'session.not_running',
  'session.resync_required', 'agent.unauthorized', 'agent.binary_missing', 'agent.rate_limited',
  'agent.plan_limit', 'agent.failed', 'agent.unsupported', 'machine.unreachable',
  'git.dirty_worktree', 'git.failed', 'git.worktree_in_use', 'git.nothing_to_commit', 'git.confirm_required',
  'checkpoint.busy', 'terminal.bad_request', 'relay.rate_limited',
  'prompt.invalid',
  'team.closed', 'team.forbidden', 'team.limit', 'team.failed', 'team.not_found', 'team.not_member', 'team.invalid', 'team.delivery_failed',
  'handoff.confirm_required', 'handoff.declined', 'handoff.failed',
  'workspace.not_found',
  'fs.invalid_path', 'fs.not_found', 'fs.not_directory', 'fs.denied',
  'service.not_found', 'service.not_running', 'service.failed', 'config.error', 'preview.port_denied',
  'browser.unavailable', 'browser.not_allowed', 'browser.action_failed', 'browser.not_found',
  'session.not_scratch', 'copy_out.invalid_project', 'copy_out.invalid_path', 'copy_out.conflict', 'copy_out.failed',
  'pairing.expired', 'acp.unsupported_version', 'lease.held', 'protocol.unknown_method',
  'protocol.unsupported_version', 'protocol.invalid_frame', 'protocol.unknown_event',
] as const;
export type ErrorCode = (typeof errorCodes)[number];
