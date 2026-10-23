import { isMap, isScalar, parseDocument } from 'yaml';
import type { FileWriteMutation } from '../transaction.js';
import { MERGE_HOLD_PATH, mergeHoldRecord, parseMergeHold } from './merge-hold.js';
import { parseProgramDescriptor } from './program.js';

/** Equivalent changes only; token edits preserve unrelated YAML, comments and authored body. */
export function planProgramMigration(program: string, hold: string | undefined, since: string): FileWriteMutation[] {
  parseProgramDescriptor(program);
  const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(program);
  if (!frontmatter?.[1] || frontmatter[2] === undefined) throw new Error('Programme frontmatter is unreadable');
  const document = parseDocument(frontmatter[2]);
  if (document.errors.length > 0) throw new Error('Programme YAML is invalid');
  const autopilot = document.get('autopilot', true);
  if (autopilot === undefined) return [];
  if (!isMap(autopilot)) throw new Error('Programme autopilot must be a mapping');
  const schema = autopilot.get('schemaVersion', true);
  if (!isScalar(schema)) throw new Error('Programme autopilot schema is unreadable');
  if (schema.value === 2) return [];
  const gatePair = autopilot.items.find(pair => isScalar(pair.key) && pair.key.value === 'mergeGate');
  if (!gatePair || !isScalar(gatePair.key) || !isScalar(gatePair.value) || gatePair.value.value !== 'human') {
    throw new Error('Programme merge policy has no proven equivalent migration; choose a human hold or explicitly adopt the local review policy');
  }
  if (autopilot.flow || !schema.range || !gatePair.key.range || !gatePair.value.range) {
    throw new Error('Programme migration requires an explicit block mapping; preserve policy while rewriting this YAML form');
  }
  const mutations: FileWriteMutation[] = [];
  if (hold === undefined) mutations.push({ path: MERGE_HOLD_PATH, content: Buffer.from(mergeHoldRecord(since)), mode: 0o600 });
  else {
    const existing = parseMergeHold({ kind: 'text', text: hold });
    if (!existing.held || existing.detail.includes('unreadable')) throw new Error('Programme human hold is damaged; restore it before migration');
  }
  const offset = frontmatter[1].length;
  const changes = [
    { start: offset + schema.range[0], end: offset + schema.range[1], value: '2' },
    { start: offset + gatePair.key.range[0], end: offset + gatePair.value.range[1], value: '' },
  ].sort((a, b) => b.start - a.start);
  let migrated = program;
  for (const change of changes) migrated = migrated.slice(0, change.start) + change.value + migrated.slice(change.end);
  parseProgramDescriptor(migrated);
  mutations.push({ path: '.void/program.md', content: Buffer.from(migrated) });
  return mutations;
}
