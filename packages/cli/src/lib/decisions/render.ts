import type { DecisionRecord, DecisionStatus } from './types.js';

function sorted(records: readonly DecisionRecord[]): readonly DecisionRecord[] {
  return [...records].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt < right.createdAt ? 1 : -1;
    }
    return left.file < right.file ? 1 : -1;
  });
}

function supersessionIndex(
  records: readonly DecisionRecord[],
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const record of records) {
    for (const target of record.supersedes) {
      const replacements = index.get(target) ?? [];
      replacements.push(record.id);
      replacements.sort();
      index.set(target, replacements);
    }
  }
  return index;
}

function effectiveStatus(
  record: DecisionRecord,
  supersededBy: readonly string[],
): DecisionStatus {
  return supersededBy.length === 0 ? record.status : 'superseded';
}

function metadata(
  record: DecisionRecord,
  supersededBy: readonly string[],
): Record<string, unknown> {
  return {
    id: record.id,
    title: record.title,
    createdAt: record.createdAt,
    status: effectiveStatus(record, supersededBy),
    declaredStatus: record.status,
    supersededBy,
    deciders: record.deciders,
    supersedes: record.supersedes,
    file: record.file,
    legacy: record.legacy,
  };
}

export function renderDecisionsJson(
  records: readonly DecisionRecord[],
): string {
  const index = supersessionIndex(records);
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      decisions: sorted(records).map((record) =>
        metadata(record, index.get(record.id) ?? [])
      ),
    },
    null,
    2,
  )}\n`;
}

export function renderDecisionsMarkdown(
  records: readonly DecisionRecord[],
): string {
  const index = supersessionIndex(records);
  const lines = [
    '# Decisions',
    '',
    '> Generated view only. Source of truth: one Markdown file per decision.',
    '',
  ];
  for (const record of sorted(records)) {
    const supersededBy = index.get(record.id) ?? [];
    const replacement = supersededBy.length === 0
      ? ''
      : ` (superseded by ${supersededBy.map((id) => `\`${id}\``).join(', ')})`;
    lines.push(
      `- [${record.title}](${record.file}) - ${effectiveStatus(record, supersededBy)} - ${record.createdAt} - \`${record.id}\`${replacement}`,
    );
  }
  return `${lines.join('\n')}\n`;
}
