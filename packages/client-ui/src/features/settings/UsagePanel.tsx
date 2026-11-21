/** Settings → Usage: tokens and cost over the last 7 or 30 days, by project and by day. */
import { useMemo, useState } from 'react';
import { compactTokens, formatUsd, projectName } from '../../lib/format.ts';
import { Group, Message, Page, Row, Segmented, Value, useHub } from './parts.tsx';

interface Bucket { tokens: number; usd: number | null; unpriced: number; estimate: boolean }
interface Totals { total: Bucket; projects: ({ project: string } & Bucket)[]; days: ({ date: string } & Bucket)[] }
const DAY = 24 * 60 * 60 * 1000;

const amount = (b: Bucket) => b.usd === null ? 'No price' : `${b.estimate ? '≈ ' : ''}${formatUsd(b.usd)}`;
const detail = (b: Bucket) => `${compactTokens(b.tokens)} tokens${b.unpriced ? ` · ${b.unpriced} unpriced ${b.unpriced === 1 ? 'turn' : 'turns'}` : ''}`;

function Bar({ share }: { share: number }) {
  return <span aria-hidden style={{ width: 90, height: 6, borderRadius: 99, background: 'var(--bg-inset)', overflow: 'hidden', flexShrink: 0 }}>
    <span style={{ display: 'block', height: '100%', width: `${Math.max(2, Math.round(share * 100))}%`, background: 'var(--text-secondary)', borderRadius: 99 }} />
  </span>;
}

export function UsagePanel({ connection }: { connection: string }) {
  const [range, setRange] = useState<'7' | '30'>('30');
  const since = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - (Number(range) - 1) * DAY; }, [range]);
  const totals = useHub<Totals>('cost.totals', { since }, connection === 'online');
  const t = totals.data;
  const projects = [...(t?.projects ?? [])].sort((a, b) => b.tokens - a.tokens);
  const days = [...(t?.days ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const maxP = Math.max(1, ...projects.map(p => p.tokens));
  const maxD = Math.max(1, ...days.map(d => d.tokens));
  const state = connection !== 'online' ? <Row title="Connect to the hub to see usage" />
    : totals.error ? <Message tone="error">{totals.error}</Message> : !t ? <Row title="Loading…" /> : null;
  return <Page title="Usage" subtitle="Tokens and cost across all sessions. ≈ marks estimates from public model prices.">
    <Group title="Total" action={<Segmented<'7' | '30'> label="Range" value={range} onChange={setRange} options={[['7', '7 days'], ['30', '30 days']]} />}>
      {state ?? <Row title={`Last ${range} days`} hint={detail(t!.total)}><Value>{amount(t!.total)}</Value></Row>}
    </Group>
    {t ? <>
      <Group title="By project">
        {projects.length ? projects.map(p => <Row key={p.project} title={p.project === 'scratch' ? 'No project' : projectName(p.project)} hint={detail(p)}>
          <Bar share={p.tokens / maxP} /><Value>{amount(p)}</Value>
        </Row>) : <Row title="No usage in this range" />}
      </Group>
      <Group title="By day">
        {days.length ? days.map(d => <Row key={d.date} title={new Date(`${d.date}T00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} hint={detail(d)}>
          <Bar share={d.tokens / maxD} /><Value>{amount(d)}</Value>
        </Row>) : <Row title="No usage in this range" />}
      </Group>
    </> : null}
  </Page>;
}
