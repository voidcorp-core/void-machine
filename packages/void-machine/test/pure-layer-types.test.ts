import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import { expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');
const fixturePath = join(packageRoot, 'test', 'fixtures', 'pure-layer-escape.ts');

function pureConfig(): ts.ParsedCommandLine {
  const path = join(packageRoot, 'tsconfig.pure.json');
  const read = ts.readConfigFile(path, (file) => readFileSync(file, 'utf8'));
  if (read.error !== undefined) throw new Error('tsconfig.pure.json is unreadable');
  return ts.parseJsonConfigFileContent(read.config, ts.sys, packageRoot, undefined, path);
}

// Each line of the fixture reaches the host without an import; each must stay an error.
const escapes = ['process', 'fetch', 'Buffer', 'require', 'url', 'setTimeout', 'structuredClone'];

it('types the pure layers without any host global', () => {
  const config = pureConfig();
  expect(config.errors).toEqual([]);
  expect(config.options.types).toEqual([]);
  expect(config.options.lib).toEqual(['lib.es2022.d.ts']);
  expect(config.fileNames.map((file) => file.slice(packageRoot.length + 1)))
    .toEqual(expect.arrayContaining(['src/core/mission.ts', 'src/runtime/mission.ts',
      'src/verticals/sourced-note/note.ts']));
  // Besides the pure layers, only the reviewed allowlist of pure host globals is typed.
  expect(config.fileNames.filter((file) => !/\/src\/(core|runtime|verticals)\//.test(file))
    .map((file) => file.slice(packageRoot.length + 1))).toEqual(['types/pure-globals.d.ts']);
});

it('refuses every host global in a pure-layer source', () => {
  const program = ts.createProgram([fixturePath], pureConfig().options);
  const messages = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fixturePath)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  for (const name of escapes) {
    expect(messages.some((message) => message.includes(`'${name}'`)), name).toBe(true);
  }
});
