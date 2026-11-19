import { getSession, type Store } from '@ormicode/session-store';
import { replay } from '@ormicode/journal';

type Event = { kind: string; payload: string; seq: number };
type Body = Record<string, unknown>;
type ToolCall = { name: string; command?: string; callId: string };
const SECTION_CAPS = { goal: 520, done: 1500, files: 1200, decisions: 560, questions: 600, commands: 1050, diff: 800, next: 520 };
const BRIEF_CAP = 8000;

function clip(value: string, limit: number): string {
  const text = value.trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…` : text;
}

function body(event: Event): Body {
  try {
    const value: unknown = JSON.parse(event.payload);
    return value && typeof value === 'object' ? value as Body : {};
  } catch { return {}; }
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function compactLines(values: string[], cap: number): string {
  const picked: string[] = [];
  let size = 0;
  for (const value of values) {
    const line = `- ${value}`;
    if (size + line.length + 1 > cap) break;
    picked.push(line); size += line.length + 1;
  }
  return picked.join('\n');
}

function commandOf(call: Body): string | undefined {
  const input = call.input && typeof call.input === 'object' ? call.input as Body : {};
  const name = String(call.name ?? '');
  const command = text(input.command ?? input.cmd);
  return command && /bash|shell|terminal|command|exec/i.test(name) ? command : undefined;
}

function toolCalls(events: Event[]): Map<string, ToolCall> {
  const result = new Map<string, ToolCall>();
  for (const event of events) {
    if (event.kind !== 'tool_call') continue;
    const call = body(event);
    const callId = text(call.callId);
    if (!callId) continue;
    result.set(callId, { name: text(call.name) || 'tool', command: commandOf(call), callId });
  }
  return result;
}

function answerIds(events: Event[]): Set<string> {
  return new Set(events.filter(event => event.kind === 'question_answer').map(event => text(body(event).request)));
}

function section(title: string, value: string): string { return `${title}: ${value}`; }

/**
 * A bounded, user-facing task recap. Technical lifecycle and usage events are
 * intentionally ignored; only durable work and agent/user-facing outcomes
 * contribute to the summary.
 */
export function handoffBrief(db: Store, session: string, tail = 12, uptoSeq?: number): string {
  const events = replay(db, session).filter(event => uptoSeq === undefined || event.seq <= uptoSeq);
  const records = events as Event[];
  const bodies = records.map(event => ({ event, body: body(event) }));
  const prompts = bodies.filter(item => item.event.kind === 'prompt').map(item => text(item.body.text));
  const goal = clip(prompts[0] ?? 'Continue the current session task.', SECTION_CAPS.goal) || 'Continue the current session task.';

  const agentText = bodies.filter(item => item.event.kind === 'text')
    .map(item => text(item.body.text)).filter(Boolean).slice(-Math.max(1, tail)).map(value => clip(value, 340));
  const calls = toolCalls(records);
  const completedTools = bodies.filter(item => item.event.kind === 'tool_result')
    .slice(-Math.max(1, tail)).map(({ body: result }) => {
      const call = calls.get(text(result.callId));
      if (!call) return '';
      const status = text(result.status);
      const output = clip(text(result.output), 180);
      return `${call.name}: ${status || 'completed'}${output ? ` — ${output}` : ''}`;
    }).filter(Boolean);
  const done = compactLines(unique([...agentText, ...completedTools]).slice(-8), SECTION_CAPS.done);

  const files = unique(bodies.filter(item => item.event.kind === 'file_edit')
    .map(item => text(item.body.path))).slice(-30);
  const fileSection = compactLines(files.map(path => `${path} — edited`), SECTION_CAPS.files);

  const decisions = bodies.filter(item => ['model_changed', 'effort_changed', 'mode_changed', 'config_option'].includes(item.event.kind))
    .map(({ event, body: value }) => `${event.kind.replace('_changed', '')}: ${text(value.model ?? value.effort ?? value.mode ?? value.id)}${value.value !== undefined ? ` = ${text(value.value)}` : ''}`);
  const decisionSection = compactLines(unique(decisions).slice(-8), SECTION_CAPS.decisions);

  const answered = answerIds(records);
  const openQuestions = bodies.filter(item => item.event.kind === 'question_request')
    .filter(item => !answered.has(text(item.body.request)))
    .flatMap(item => Array.isArray(item.body.questions) ? (item.body.questions as Body[]).map(question => text(question.question)) : []);
  const questionSection = compactLines(unique(openQuestions).slice(-8), SECTION_CAPS.questions);

  const commands = bodies.filter(item => item.event.kind === 'tool_call')
    .flatMap(item => {
      const callId = text(item.body.callId);
      const call = calls.get(callId);
      if (!call?.command) return [];
      const result = bodies.find(candidate => candidate.event.kind === 'tool_result' && text(candidate.body.callId) === callId)?.body;
      return [`${call.command} → ${text(result?.status) || 'started'}${result?.output ? `: ${clip(text(result.output), 190)}` : ''}`];
    });
  const commandSection = compactLines(unique(commands).slice(-6), SECTION_CAPS.commands);

  const plan = bodies.filter(item => item.event.kind === 'plan').map(item => text(item.body.text)).filter(Boolean).at(-1);
  const nextStep = clip(plan ? plan.split('\n').filter(Boolean).at(-1) ?? plan : 'Continue from the last prompt.', SECTION_CAPS.next);
  const diff = files.length
    ? `${files.length} edited path${files.length === 1 ? '' : 's'} recorded: ${files.slice(-12).join(', ')}`
    : '';

  const sections = [section('Goal', goal)];
  if (done) sections.push(section('Done so far', done));
  if (fileSection) sections.push(section('Files changed', fileSection));
  if (decisionSection) sections.push(section('Decisions', decisionSection));
  if (questionSection) sections.push(section('Open questions', questionSection));
  if (commandSection) sections.push(section('Commands run', commandSection));
  if (diff) sections.push(section('Current diff', clip(diff, SECTION_CAPS.diff)));
  sections.push(section('Next step', nextStep));
  let brief = sections.join('\n\n');
  if (brief.length > BRIEF_CAP) brief = `${brief.slice(0, BRIEF_CAP - 1).trimEnd()}…`;
  return brief;
}
