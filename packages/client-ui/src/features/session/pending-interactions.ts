type Interaction = { kind: string; body: Record<string, unknown> };

export function pendingInteractions<T extends Interaction>(pending: T[], event: T): T[] {
  if (['approval_decision', 'question_answer', 'interaction_expired'].includes(event.kind))
    return pending.filter(p => p.body.request !== event.body.request
      || event.kind === 'interaction_expired' && event.body.answerable === true && p.kind === 'question_request');
  if (event.kind === 'approval_request' || event.kind === 'question_request')
    return [...pending.filter(p => p.body.request !== event.body.request), event];
  return pending;
}
