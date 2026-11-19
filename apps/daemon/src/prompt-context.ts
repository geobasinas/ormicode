import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ATTACHMENT_MAX_BYTES, ATTACHMENTS_MAX_BYTES, newId } from '@ormicode/protocol';
import type { PromptAttachment, PromptContext } from '@ormicode/protocol';
import { resolvePath } from '@ormicode/files';
import { diffPatch, isGitRepo } from '@ormicode/git-core';
import { listNotes } from '@ormicode/session-store';

export interface PromptAttachmentInfo { name: string; mimeType: string; size: number; path: string }
export interface PromptAppendix {
  text: string;
  context?: PromptContext[];
  attachments?: PromptAttachment[];
}
export interface PromptRoot {
  cwd: string;
  session: string;
  baseCommit?: string | null;
  notesDir: string;
  terminalOutput: (session: string, terminal?: string) => { terminal: string; output: string } | undefined;
}

const DIFF_CAP = 64 * 1024;

export class PromptInvalidError extends Error {
  readonly code = 'prompt.invalid';
}

function attachmentBytes(attachments: PromptAttachment[]): Buffer[] {
  let total = 0;
  return attachments.map(attachment => {
    const encoded = attachment.data;
    if (encoded.length > Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4)
      throw new Error(`${attachment.name} exceeds 10 MB`);
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))
      throw new Error(`Invalid base64 attachment: ${attachment.name}`);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw new Error(`Invalid base64 attachment: ${attachment.name}`);
    if (bytes.length > ATTACHMENT_MAX_BYTES) throw new Error(`${attachment.name} exceeds 10 MB`);
    total += bytes.length;
    if (total > ATTACHMENTS_MAX_BYTES) throw new Error('Attachments exceed 25 MB total');
    return bytes;
  });
}

function capDiff(value: string): string {
  const bytes = Buffer.from(value);
  if (bytes.length <= DIFF_CAP) return value;
  const marker = Buffer.from('\n[diff truncated at 64 KB]');
  return `${bytes.subarray(0, DIFF_CAP - marker.length).toString('utf8')}${marker.toString()}`;
}

export function validatePrompt(cwd: string, prompt: PromptAppendix): void {
  for (const item of prompt.context ?? []) {
    if (item.kind !== 'file' && item.kind !== 'folder') continue;
    if (!item.path) throw new Error(`${item.kind} context needs a path`);
    const safe = resolvePath(cwd, item.path);
    statSync(safe.absolute);
  }
  const attachments = prompt.attachments ?? [];
  attachmentBytes(attachments);
  for (const attachment of attachments) {
    const name = basename(attachment.name.replace(/\\/g, '/')).replace(/[<>:"|?*\0-\x1f]/g, '_');
    if (!name || name === '.' || name === '..') throw new Error('Invalid attachment filename');
  }
}

function excludeOrmi(cwd: string): void {
  if (!isGitRepo(cwd)) return;
  let gitPath: string;
  try {
    gitPath = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return; }
  if (!gitPath) return;
  const excludePath = isAbsolute(gitPath) ? gitPath : resolve(cwd, gitPath);
  const contents = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
  if (contents.split(/\r?\n/).some(line => line.trim() === '/.ormi/')) return;
  mkdirSync(dirname(excludePath), { recursive: true });
  appendFileSync(excludePath, `${contents && !contents.endsWith('\n') ? '\n' : ''}/.ormi/\n`);
}

export function expandPrompt(root: PromptRoot, prompt: PromptAppendix): { text: string; attachments: PromptAttachmentInfo[] } {
  const sections: string[] = [];
  const paths: string[] = [];
  for (const item of prompt.context ?? []) {
    if (item.kind === 'file' || item.kind === 'folder') {
      if (!item.path) throw new Error(`${item.kind} context needs a path`);
      const safe = resolvePath(root.cwd, item.path);
      const kind = statSync(safe.absolute).isDirectory() ? 'folder' : 'file';
      paths.push(`${kind}: ${safe.path}`);
    } else if (item.kind === 'diff') {
      try {
        const patch = diffPatch(root.cwd, root.baseCommit ?? 'HEAD').patch;
        sections.push(`Uncommitted diff:\n\`\`\`diff\n${capDiff(patch)}\n\`\`\``);
      } catch { sections.push('Uncommitted diff: unavailable'); }
    } else if (item.kind === 'terminal') {
      const latest = root.terminalOutput(root.session, item.terminal);
      if (latest) sections.push(`Latest terminal output (${latest.terminal}):\n\`\`\`\n${latest.output.split(/\r?\n/).slice(-200).join('\n')}\n\`\`\``);
    } else if (item.kind === 'notes') {
      const notes = listNotes(root.notesDir, root.session);
      if (notes.length) sections.push(`Session notes:\n${notes.map(note => `## ${note.title}\n${note.body}`).join('\n\n')}`);
    }
  }
  if (paths.length) sections.unshift(`Referenced paths:\n${paths.map(path => `- ${path}`).join('\n')}`);

  const attachments = prompt.attachments ?? [];
  const bytes = attachmentBytes(attachments);
  const infos: PromptAttachmentInfo[] = [];
  if (attachments.length) {
    for (const attachment of attachments) {
      const name = basename(attachment.name.replace(/\\/g, '/')).replace(/[<>:"|?*\0-\x1f]/g, '_');
      if (!name || name === '.' || name === '..') throw new Error('Invalid attachment filename');
    }
    excludeOrmi(root.cwd);
    const directory = join(root.cwd, '.ormi', 'attachments', newId('a'));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      attachments.forEach((attachment, index) => {
        const name = basename(attachment.name.replace(/\\/g, '/')).replace(/[<>:"|?*\0-\x1f]/g, '_');
        if (!name || name === '.' || name === '..') throw new Error('Invalid attachment filename');
        const path = join(directory, `${index ? `${index + 1}-` : ''}${name}`);
        writeFileSync(path, bytes[index]!, { mode: 0o600, flag: 'wx' });
        infos.push({ name: attachment.name, mimeType: attachment.mimeType, size: bytes[index]!.length, path: relative(root.cwd, path).split(sep).join('/') });
      });
      sections.push(`Attached files:\n${infos.map(item => `- ${item.path} (${item.name})`).join('\n')}`);
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
  return {
    text: sections.length ? `${prompt.text}\n\n---\n${sections.join('\n\n')}` : prompt.text,
    attachments: infos,
  };
}
