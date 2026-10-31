import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('type-checks the documented webhook wrapper options against the shipped contract', () => {
  const root = resolve(import.meta.dirname, '../..');
  const document = readFileSync(resolve(root, 'packages/core/skills/void-async-safety/SKILL.md'), 'utf8');
  const example = document.match(/```typescript\n([\s\S]*?)\n```/)?.[1];
  expect(example).toBeDefined();
  const wrapper = resolve(root, 'packages/packs/pack-nextjs/src/async/withWebhookSafety.ts');
  const filename = resolve(root, 'packages/packs/pack-nextjs/src/async/documented-example.ts');
  const code = (example ?? '').replace(/from '[^']+'/, `from '${wrapper}'`);
  const source = `
    import type { IdempotencyStore, HandlerError, VerifyError } from '${wrapper}';
    import type { Result } from '@voidcorp/pack-monorepo/result';
    declare const env: { STRIPE_WEBHOOK_SECRET: string };
    declare const deps: object;
    declare const stripeIdempotencyStore: IdempotencyStore;
    declare function verifyStripeSignature(req: Request, secret: string): Promise<Result<{ id: string }, VerifyError>>;
    declare function handleStripeEvent(deps: object, event: { id: string }): Promise<Result<void, HandlerError>>;
    ${code}
  `;
  const options: ts.CompilerOptions = {
    strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (path, language, onError, create) => path === filename
    ? ts.createSourceFile(filename, source, language)
    : original(path, language, onError, create);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
  expect(diagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
});
