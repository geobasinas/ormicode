import type { PromptContext } from '@ormicode/protocol';

const uiFileExtension = /\.(?:tsx|jsx|vue|svelte|astro|html|css|scss|sass|less|mdx)$/i;

export interface UiCheckEntry {
  level: 'error' | 'warn';
  kind: 'console' | 'error' | 'rejection' | 'network';
  message: string;
  request?: string;
  status?: number;
  frames: string[];
}

export interface UiCheckResult {
  errors: number;
  warnings: number;
  path: string;
  checkpoint: string;
  artifact: string;
  url: string;
  consoleIds: string[];
  entries: UiCheckEntry[];
}

export function uiCheckFollowupText(result: Pick<UiCheckResult, 'errors' | 'path'>): string {
  return `The UI check after your last turn found ${result.errors} error${result.errors === 1 ? '' : 's'} on ${result.path}. Fix them, then verify with ormi_browser_logs and ormi_browser_screenshot.`;
}

export function recordUiCheckResult(
  session: string,
  result: UiCheckResult,
  guard: UiCheckFollowupGuard,
  enqueue: (session: string, text: string, context: PromptContext[]) => void,
  record: (session: string, kind: string, payload: Record<string, unknown>) => void,
  allowFollowup = true,
): boolean {
  const followup = allowFollowup && result.errors > 0 && guard.canQueue(session);
  record(session, 'ui_check', {
    checkpoint: result.checkpoint, artifact: result.artifact, url: result.url,
    errors: result.errors, warnings: result.warnings, entries: result.entries, actor: 'auto', followup,
  });
  if (followup) {
    guard.queued(session);
    const context = result.consoleIds.length ? [{ kind: 'console', console: { ids: result.consoleIds } } as PromptContext] : [];
    enqueue(session, uiCheckFollowupText(result), context);
  }
  return followup;
}

export function isUiFileChange(path: string): boolean {
  return uiFileExtension.test(path.replace(/\\/g, '/'));
}

export function hasUiFileChanges(paths: string[]): boolean {
  return paths.some(isUiFileChange);
}

export function shouldRunUiCheck(input: {
  enabled: boolean; serviceRunning: boolean; browserAvailable: boolean; files: string[];
}): boolean {
  return input.enabled && input.serviceRunning && input.browserAvailable && hasUiFileChanges(input.files);
}

export function shouldResetUiCheckFollowups(device: string): boolean {
  return device !== 'mcp';
}

export class UiCheckFollowupGuard {
  private readonly counts = new Map<string, number>();

  canQueue(session: string): boolean { return (this.counts.get(session) ?? 0) < 2; }
  queued(session: string): void { this.counts.set(session, (this.counts.get(session) ?? 0) + 1); }
  reset(session: string): void { this.counts.delete(session); }
  count(session: string): number { return this.counts.get(session) ?? 0; }
}
