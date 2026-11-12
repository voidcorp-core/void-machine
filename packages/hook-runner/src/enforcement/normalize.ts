import { shellWriteTargets } from './shell-writes.js';
import { isShellTool, type ReadTargets, shellReadTargets } from './shell-reads.js';
import { resolve } from 'node:path';
import type {
  NormalizedEdit,
  NormalizedToolCall,
} from './types.js';

const MAX_FIELD_BYTES = 1024 * 1024;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeString(value: unknown, label: string, limit = MAX_FIELD_BYTES): string {
  if (typeof value !== 'string') return '';
  if (value.includes('\u0000') || Buffer.byteLength(value) > limit) {
    throw new Error(`unsafe hook input: ${label}`);
  }
  return value;
}

function commandText(value: unknown): string {
  if (Array.isArray(value)) return value.map((part) => safeString(part, 'command')).join(' ');
  return safeString(value, 'command');
}

function patchText(input: Record<string, unknown>): string {
  const candidates = [
    input['patch'],
    input['input'],
    input['content'],
    input['command'],
  ];
  return candidates
    .map((value) => commandText(value))
    .filter((value) => value.includes('*** Begin Patch'))
    .join('\n');
}

export function parsePatchEdits(patch: string): NormalizedEdit[] {
  const edits: NormalizedEdit[] = [];
  let path = '';
  let added = '';
  let deleting = false;
  const emit = (): void => {
    if (path !== '') edits.push({
      path,
      addedContent: added,
      ...(deleting ? { operation: 'delete' as const } : {}),
    });
  };
  for (const line of patch.split(/\r?\n/)) {
    const section = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (section !== null) {
      emit();
      path = safeString(section[2] ?? '', 'patch path');
      added = '';
      deleting = section[1] === 'Delete';
      continue;
    }
    if (
      path !== ''
      && line.startsWith('+')
      && !line.startsWith('+++')
    ) {
      added += `${line.slice(1)}\n`;
    }
  }
  emit();
  return edits;
}

export function normalizeToolCall(value: unknown, contentLimit = MAX_FIELD_BYTES): NormalizedToolCall {
  const raw = record(value);
  if (raw === undefined) throw new Error('invalid hook input: expected object');
  const input = record(raw['tool_input']) ?? {};
  const tool = safeString(raw['tool_name'], 'tool_name');
  const command = commandText(input['command'] ?? input['cmd']);
  const file = safeString(input['file_path'] ?? input['path'], 'file_path');
  let edits: NormalizedEdit[];
  if (file !== '') {
    edits = [{
      path: file,
      addedContent: safeString(input['content'] ?? input['new_string'], 'edit content', contentLimit),
    }];
  } else {
    edits = parsePatchEdits(patchText(input));
  }
  // A shell redirection carries its target inside the command, so without this
  // the rules received an empty edit list and `cat > .env` was never examined.
  // The content is empty because a redirection says where it writes, not what:
  // the path rules apply, the content rules have nothing to read.
  const shellTargets = shellWriteTargets(command)
    .filter((path) => !edits.some((edit) => edit.path === path))
    .map((path) => ({ path, addedContent: '' }));
  return { tool, command, edits: [...edits, ...shellTargets] };
}

/** Read intent is separate from edits, including native Grep's scope, not its pattern. */
export function normalizeReadCall(value: unknown, root: string): ReadTargets & { readonly cwd: string } {
  const raw = record(value) ?? {};
  const input = record(raw['tool_input']) ?? {};
  const tool = safeString(raw['tool_name'], 'tool_name');
  const cwd = resolve(root, safeString(raw['cwd'], 'cwd') || root,
    safeString(input['workdir'] ?? input['cwd'], 'workdir') || '.');
  if (isShellTool(tool)) {
    return { ...shellReadTargets(commandText(input['command'] ?? input['cmd'])), cwd };
  }
  const paths: string[] = [];
  let unsafeSearch = false;
  if (['Read', 'read_file', 'Grep'].includes(tool)) {
    const path = safeString(input['file_path'] ?? input['path'], 'read path');
    if (path !== '') paths.push(path);
    if (tool === 'Grep') {
      const glob = safeString(input['glob'], 'read glob');
      if (glob !== '' && !glob.startsWith('!')) { paths.push(glob); unsafeSearch = true; }
    }
  }
  return { paths, unsafeSearch, searchPaths: unsafeSearch ? [paths[0] ?? '.'] : [], cwd };
}
