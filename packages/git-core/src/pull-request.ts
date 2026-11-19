import { CommandError, currentBranch, run } from './commands.ts';

type Json = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value : '';
const date = (value: unknown) => typeof value === 'string' ? Date.parse(value) || 0 : 0;

function unavailable(error: unknown): Error {
  const message = error instanceof CommandError ? error.message : error instanceof Error ? error.message : String(error);
  return new Error(`PRs are unavailable: ${message}`);
}

function noPullRequest(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no pull requests? found|could not find any pull requests/i.test(message);
}

function json(cwd: string, args: string[]): Json {
  const gh = process.env.ORMICODE_GH ?? 'gh';
  return JSON.parse(run(gh, cwd, args)) as Json;
}

function checks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((entry: Json) => {
    const stateText = text(entry.conclusion || entry.state || entry.status).toUpperCase();
    const state = stateText === 'SUCCESS' || stateText === 'PASSED'
      ? 'pass'
      : ['FAILURE', 'FAILED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(stateText)
        ? 'fail'
        : ['SKIPPED', 'CANCELLED', 'NEUTRAL', 'ABORTED'].includes(stateText) ? 'skipped' : 'pending';
    const start = date(entry.startedAt); const finish = date(entry.completedAt);
    return { name: text(entry.name || entry.context), state, durationMs: start && finish ? Math.max(0, finish - start) : null };
  });
}

function reviewers(reviews: unknown, requests: unknown) {
  const states = new Map<string, 'approved' | 'changes_requested' | 'commented' | 'requested'>();
  if (Array.isArray(reviews)) for (const review of reviews as Json[]) {
    const login = text((review.author as Json | undefined)?.login);
    if (!login) continue;
    const raw = text(review.state).toUpperCase();
    if (raw === 'APPROVED') states.set(login, 'approved');
    else if (raw === 'CHANGES_REQUESTED') states.set(login, 'changes_requested');
    else if (raw === 'COMMENTED' || raw === 'DISMISSED') states.set(login, 'commented');
  }
  if (Array.isArray(requests)) for (const request of requests as Json[]) {
    const user = (request.requestedReviewer ?? request) as Json;
    const login = text(user.login || user.slug);
    if (login && !states.has(login)) states.set(login, 'requested');
  }
  return [...states].map(([login, state]) => ({ login, state }));
}

function convert(pr: Json) {
  const rawState = text(pr.state).toUpperCase();
  const state = pr.isDraft === true ? 'draft' : rawState === 'MERGED' ? 'merged' : rawState === 'CLOSED' ? 'closed' : 'open';
  return {
    number: Number(pr.number), title: text(pr.title), body: text(pr.body), state, url: text(pr.url),
    head: text(pr.headRefName), base: text(pr.baseRefName), author: text((pr.author as Json | undefined)?.login),
    createdAt: date(pr.createdAt), checks: checks(pr.statusCheckRollup), reviewers: reviewers(pr.reviews, pr.reviewRequests),
    additions: Number(pr.additions ?? 0), deletions: Number(pr.deletions ?? 0), changedFiles: Number(pr.changedFiles ?? 0),
  };
}

const VIEW_FIELDS = 'number,title,body,state,isDraft,url,headRefName,baseRefName,author,createdAt,statusCheckRollup,reviews,reviewRequests,additions,deletions,changedFiles';

export function prStatus(cwd: string) {
  try { return { pr: convert(json(cwd, ['pr', 'view', '--json', VIEW_FIELDS])) }; }
  catch (error) {
    if (noPullRequest(error)) return { pr: null };
    throw unavailable(error);
  }
}

export function createPr(cwd: string, base: string | null, title: string, body: string, draft = false, approved?: { branch: string; repo: string }) {
  if (!base) throw new Error('session has no recorded base branch');
  const branch = approved?.branch ?? currentBranch(cwd);
  if (!branch) throw new Error('cannot create a PR from detached HEAD');
  try {
    const url = run(process.env.ORMICODE_GH ?? 'gh', cwd, ['pr', 'create', '--base', base, '--head', branch, '--title', title, '--body', body, ...(draft ? ['--draft'] : []), ...(approved ? ['--repo', approved.repo] : [])]).trim();
    const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
    if (!number) throw new Error(`gh returned an unexpected PR URL: ${url}`);
    return { number, url };
  } catch (error) { throw unavailable(error); }
}

export function mergePr(cwd: string, method: 'squash' | 'merge' | 'rebase') {
  try { run(process.env.ORMICODE_GH ?? 'gh', cwd, ['pr', 'merge', `--${method}`]); }
  catch (error) { throw unavailable(error); }
}
