// Validates the source harness.yaml contracts used by the installer.
import { parseDocument } from 'yaml';
import * as z from 'zod';
import { ALL_RUNTIMES } from './runtime.js';

const ENFORCEMENT_TIERS = {
  pretooluse: 'pretooluse',
  active: 'active',
  'ci-only': 'ci-only',
  'n/a': 'n/a',
} as const;
export type EnforcementTier = typeof ENFORCEMENT_TIERS[keyof typeof ENFORCEMENT_TIERS];

// A runtime that inherits only the CI floor: every manifest declares its tier,
// but it has no install adapter, which is why it is not a `Runtime`. Adding it
// there would open the installer to a runtime nothing can wire.
const CI_FLOOR_ONLY_RUNTIMES = ['hermes'] as const;

const tier = z.enum(ENFORCEMENT_TIERS);
const stringList = z.array(z.string());
const evalTarget = z.string().regex(/^[^/\s]+\/[^/\s]+\/[^/\s]+$/, 'expected a runtime/provider/tier slug');

const harnessManifestSchema = z.strictObject({
  kind: z.enum(['action', 'standard']),
  owner: z.string().min(1),
  runtimes: z.array(z.enum(ALL_RUNTIMES)).min(1),
  enforcement: z.strictObject({
    floor: z.literal('ci'),
    inline: z.partialRecord(z.enum([...ALL_RUNTIMES, ...CI_FLOOR_ONLY_RUNTIMES]), tier).optional(),
  }),
  eval_targets: z.array(evalTarget),
  activation: z.enum(['always', 'on-demand']).optional(),
  triggers: z
    .strictObject({ globs: stringList.optional(), extensions: stringList.optional(), tools: stringList.optional() })
    .optional(),
  success_signal: z.string().optional(),
});

export type HarnessManifest = z.infer<typeof harnessManifestSchema>;

export type HarnessManifestVerdict =
  | { readonly ok: true; readonly manifest: HarnessManifest }
  | { readonly ok: false; readonly problems: readonly string[] };

const formatPath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '(root)' : path.map(String).join('.');

function valueAt(data: unknown, path: readonly PropertyKey[]): unknown {
  let current = data;
  for (const segment of path) {
    if (typeof current !== 'object' || !current) return undefined;
    current = Reflect.get(current, segment);
  }
  return current;
}

/** One line per problem, each prefixed by the dotted path of the key it concerns. */
function describeIssue(issue: z.core.$ZodIssue, data: unknown): string[] {
  const where = formatPath(issue.path);
  if (issue.code === 'unrecognized_keys') return issue.keys.map((key) => `${where}: unrecognized key "${key}"`);
  if (issue.code === 'invalid_key') {
    const key = String(issue.path[issue.path.length - 1]);
    return [`${formatPath(issue.path.slice(0, -1))}: unrecognized key "${key}"`];
  }
  if (issue.code === 'invalid_type' && issue.path.length === 0) return ['(root): expected a mapping'];
  // A missing key surfaces as whatever its schema checks first (a type, an
  // enum option), so absence is read from the data, not from the issue code.
  if (valueAt(data, issue.path) === undefined) return [`${where}: required`];
  return [`${where}: ${issue.message}`];
}

/**
 * Parse and validate one manifest. YAML is parsed with the library defaults,
 * which reject a duplicated key (`uniqueKeys: true`); every parser error is
 * returned rather than caught, so a manifest that cannot be read is a failure,
 * never an empty manifest.
 */
export function validateHarnessManifest(text: string): HarnessManifestVerdict {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    return { ok: false, problems: document.errors.map((error) => `yaml: ${error.message.split('\n')[0] ?? ''}`) };
  }
  const data: unknown = document.toJS();
  const result = harnessManifestSchema.safeParse(data);
  if (result.success) return { ok: true, manifest: result.data };
  return { ok: false, problems: result.error.issues.flatMap((issue) => describeIssue(issue, data)) };
}
