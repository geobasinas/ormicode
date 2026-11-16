import { parseEventBody } from '@ormicode/protocol';

/** Validate a completed recorded turn without running an agent or accessing the network. */
export function validateTurn(events: readonly unknown[]): string[] {
  const errors: string[] = [];
  const calls = new Set<string>();
  const seenCalls = new Set<string>();
  const approvals = new Map<string, Set<string>>();
  const questions = new Map<string, Set<string>>();
  let started = false;
  let ended = false;
  for (const [index, input] of events.entries()) {
    const result = parseEventBody(input);
    if (!result.success) { errors.push(`event ${index}: ${result.error}`); continue; }
    const event = result.data;
    if (event.kind === 'turn_start') {
      if (started) errors.push(`event ${index}: duplicate turn_start`);
      if (ended) errors.push(`event ${index}: turn_start after turn_end`);
      started = true;
      continue;
    }
    if (!started) errors.push(`event ${index}: event before turn_start`);
    if (ended) errors.push(`event ${index}: event after turn_end`);
    if (event.kind === 'turn_end') { ended = true; continue; }
    if (event.kind === 'tool_call') {
      if (seenCalls.has(event.callId)) errors.push(`event ${index}: duplicate tool call`);
      seenCalls.add(event.callId);
      calls.add(event.callId);
    }
    if (event.kind === 'tool_result') {
      if (!calls.delete(event.callId)) errors.push(`event ${index}: unknown tool call`);
    }
    if (event.kind === 'approval_request') {
      if (approvals.has(event.request)) errors.push(`event ${index}: duplicate approval request`);
      const ids = event.options.map((option) => option.id);
      if (ids.length === 0 || new Set(ids).size !== ids.length) errors.push(`event ${index}: invalid approval options`);
      approvals.set(event.request, new Set(ids));
    }
    if (event.kind === 'approval_decision') {
      const options = approvals.get(event.request);
      if (!options?.has(event.option)) errors.push(`event ${index}: unknown approval or option`);
      else approvals.delete(event.request);
    }
    if (event.kind === 'question_request') {
      const names = event.questions.map((question) => question.question);
      if (questions.has(event.request) || names.length === 0 || new Set(names).size !== names.length) errors.push(`event ${index}: invalid question request`);
      questions.set(event.request, new Set(names));
    }
    if (event.kind === 'question_answer') {
      const expected = questions.get(event.request);
      const names = Object.keys(event.answers);
      if (!expected || names.length !== expected.size || names.some((name) => !expected.has(name) || !event.answers[name]?.trim())) errors.push(`event ${index}: invalid question answers`);
      else questions.delete(event.request);
    }
    if (event.kind === 'interaction_expired') {
      if (!approvals.delete(event.request) && !questions.delete(event.request)) errors.push(`event ${index}: unknown interaction`);
    }
  }
  if (!started) errors.push('missing turn_start');
  if (!ended) errors.push('missing turn_end');
  if (calls.size) errors.push('unfinished tool calls');
  if (approvals.size) errors.push('unfinished approvals');
  if (questions.size) errors.push('unfinished questions');
  return errors;
}
