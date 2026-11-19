#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { withDaemon } from './daemon.ts';

const USAGE = 'usage: ormi design list <session> | get <session> <slug> | create <session> <slug> <name> | update <session> <slug> <expected-revision> <operations.json|-> | history <session> <slug> | versions <session> <slug> <frame-id> | mentionable <session> | restore <session> <slug> <expected-revision> <target-revision>';

function operationsFrom(path: string): unknown[] {
  const input = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  if (Buffer.byteLength(input, 'utf8') > 192 * 1024) throw new Error('design request exceeds 192 KiB');
  const parsed: unknown = JSON.parse(input);
  const operations = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && 'operations' in parsed ? (parsed as { operations: unknown }).operations : undefined;
  if (!Array.isArray(operations)) throw new Error('input must be an operation array or {"operations": [...]}');
  return operations;
}

export async function designCommand(verb: string | undefined, args: string[]): Promise<number> {
  let method: string;
  let body: Record<string, unknown>;
  try {
    if (verb === 'list' && args.length === 1) { method = 'design.list'; body = { session: args[0] }; }
    else if (verb === 'mentionable' && args.length === 1) { method = 'design.mentionable'; body = { session: args[0] }; }
    else if (verb === 'versions' && args.length === 3) { method = 'design.frameVersions'; body = { session: args[0], slug: args[1], frameId: args[2] }; }
    else if (verb === 'get' && args.length === 2) { method = 'design.get'; body = { session: args[0], slug: args[1] }; }
    else if (verb === 'create' && args.length === 3) { method = 'design.create'; body = { session: args[0], slug: args[1], name: args[2] }; }
    else if (verb === 'history' && args.length === 2) { method = 'design.history'; body = { session: args[0], slug: args[1] }; }
    else if (verb === 'update' && args.length === 4) {
      const expectedRevision = Number(args[2]);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('expected revision must be a positive integer');
      method = 'design.update'; body = { session: args[0], slug: args[1], expectedRevision, operations: operationsFrom(args[3]) };
    } else if (verb === 'restore' && args.length === 4) {
      const expectedRevision = Number(args[2]); const targetRevision = Number(args[3]);
      if (![expectedRevision, targetRevision].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('revisions must be positive integers');
      method = 'design.restore'; body = { session: args[0], slug: args[1], expectedRevision, targetRevision };
    } else { console.error(USAGE); return 2; }
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 2; }
  return withDaemon(async link => {
    const response = await link.request(method, body);
    if (response.type === 'err') { console.error(`${response.code}: ${response.message}`); return 1; }
    console.log(JSON.stringify(response.body, null, 2));
    return 0;
  });
}
