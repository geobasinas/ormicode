/**
 * `ormi attach <session>` / `ormi run <agent>`: bind this terminal to a
 * daemon session. Prints the event stream, turns typed lines into prompts,
 * answers approvals by number, and detaches on Ctrl+] (the session keeps
 * running — reattach with `ormi attach`).
 */
import type { Frame } from '@ormicode/protocol';

interface Link {
  request(method: string, body: Record<string, unknown>, timeoutMs?: number): Promise<Frame>;
  send(frame: Record<string, unknown>): void;
  onFrame: ((frame: Frame) => void) | undefined;
  onClose?: (() => void) | undefined;
}

interface Pending {
  kind: 'approval' | 'question';
  request: string;
  options?: { id: string; label: string }[];
  questions?: { question: string; header: string; options: { label: string; description: string }[]; multiSelect: boolean }[];
}

const render = (body: Record<string, unknown>): string | undefined => {
  switch (body.kind) {
    case 'text': return String(body.text ?? '');
    case 'thinking': return `~ ${String(body.text ?? '')}`;
    case 'tool_call': return `▸ ${String(body.name ?? 'tool')}${body.input ? ` ${JSON.stringify(body.input).slice(0, 120)}` : ''}`;
    case 'tool_result': return `◂ ${String(body.name ?? 'tool')}: ${String(body.output ?? body.text ?? '').slice(0, 200)}`;
    case 'turn_start': return '— turn —';
    case 'turn_end': return '— done —';
    case 'error': return `✗ ${String(body.message ?? body.code ?? 'error')}`;
    case 'handoff_brief': return `⇢ handoff:\n${String(body.brief ?? '').slice(0, 400)}`;
    case 'resumed': return `↻ resumed`;
    case 'approval_request': case 'question_request': return undefined; // interactive
    default: return undefined;
  }
};

/** Attach to a session until Ctrl+] or the socket closes. */
export async function attachSession(link: Link, session: string): Promise<number> {
  const res = await link.request('session.subscribe', { session });
  if (res.type === 'err') { console.error(`${res.code}: ${res.message}`); return 1; }
  let pending: Pending | undefined;
  let buf = '';

  const stdin = process.stdin;
  const interactive = stdin.isTTY;
  if (interactive) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  const prompt = () => { if (interactive) process.stdout.write(buf ? '' : '> '); };

  const finish = (code: number) => {
    link.onFrame = undefined;
    try { void link.request('session.unsubscribe', { session }); } catch { /* best effort */ }
    if (interactive) stdin.setRawMode(false);
    stdin.pause();
    return code;
  };

  const answer = (line: string) => {
    if (!pending) { void link.request('session.prompt', { session, text: line }); return; }
    if (pending.kind === 'approval') {
      const n = Number(line.trim());
      const opt = pending.options?.[n - 1];
      if (!opt) { console.error(`pick 1-${pending.options?.length ?? 0}`); return; }
      void link.request('session.decide', { session, request: pending!.request, option: opt.id });
      pending = undefined;
    } else {
      const answers: Record<string, string> = {};
      for (const q of pending.questions ?? []) answers[q.question] = line;
      void link.request('session.answer', { session, request: pending!.request, answers });
      pending = undefined;
    }
  };

  const done = new Promise<number>(resolve => {
    stdin.on('data', chunk => {
      for (const ch of String(chunk)) {
        if (ch === '\x1d') { console.log(`\ndetached — session keeps running; reattach with \`ormi attach ${session}\``); resolve(finish(0)); return; }
        if (ch === '\x03') { resolve(finish(0)); return; }
        if (ch === '\r' || ch === '\n') { const line = buf; buf = ''; process.stdout.write('\n'); if (line.trim()) answer(line); prompt(); }
        else if (ch === '\x7f') { if (buf.length) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); } }
        else { buf += ch; process.stdout.write(ch); }
      }
    });
    stdin.on('end', () => { if (!interactive) resolve(finish(0)); });
    link.onClose = () => resolve(finish(1));
    link.onFrame = frame => {
      if (frame.type !== 'evt') return;
      if ('seq' in frame && typeof frame.seq === 'number')
        link.send({ v: 1, type: 'ack', session: frame.session, seq: frame.seq });
      const body = frame.body as Record<string, unknown>;
      if (body.kind === 'approval_request') {
        const options = (body.options as { id: string; label: string }[]) ?? [];
        pending = { kind: 'approval', request: String(body.request), options };
        console.log(`\napproval${body.destructive ? ' (DESTRUCTIVE)' : ''}${body.rule ? ` [${body.rule}]` : ''}:`);
        options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label}`));
        process.stdout.write('> ');
      } else if (body.kind === 'question_request') {
        const questions = (body.questions as Pending['questions']) ?? [];
        pending = { kind: 'question', request: String(body.request), questions };
        for (const q of questions) {
          console.log(`\n${q.header}: ${q.question}`);
          q.options.forEach((o, i) => console.log(`  ${i + 1}) ${o.label} — ${o.description}`));
        }
        process.stdout.write('> ');
      } else {
        const line = render(body);
        if (line) console.log(`${buf ? `\r${' '.repeat(buf.length + 2)}\r` : ''}${line}`);
        prompt();
      }
    };
  });
  prompt();
  return done;
}
