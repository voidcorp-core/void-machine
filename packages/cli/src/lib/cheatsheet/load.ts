import { lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { COMMAND_CATALOG } from '../command-catalog.js';
import { findCoreSource } from '../paths.js';
import { loadSpecialists, MAX_SPECIALIST_FILE_BYTES } from '../specialists/load.js';
import { projectCatalog, type CatalogEntry, type HookWiring } from './catalog.js';
import { requireData } from './read.js';
import { PRODUCT_COMMAND } from '@voidcorp/hook-runner';

const manifestSchema = z.object({ hooks: z.record(z.string().max(100), z.array(z.object({
  matcher: z.string().max(500).optional(),
  hooks: z.array(z.object({ type: z.string(), command: z.string().max(2000) })).max(100),
})).max(100)) });

/** The same wrapper command owns catalogue wiring and emitted hook subject aliases. */
export function hookRunnerCommand(wrapper: string): string | undefined {
  return /^\s*(?:exec "\$NODE_BIN"|node) "(?:\$HOOK_DIR\/_void-hook\.mjs|\$RUNNER)" ((?:enforce|lifecycle) [a-z-]+|activation|outcome)(?:\s|$)/m.exec(wrapper)?.[1];
}

/** Read wiring declarations as data. Never execute a hook to discover its trigger. */
export function hookWiring(name: string, wrapper: string, manifests: readonly { runtime: 'claude' | 'codex'; value: unknown }[]): HookWiring[] {
  const runner = hookRunnerCommand(wrapper);
  return manifests.flatMap(({ runtime, value }) => Object.entries(manifestSchema.parse(value).hooks)
    .flatMap(([event, groups]) => groups.filter(group => group.hooks.some(hook => {
      if (hook.type !== 'command') return false;
      const nodeCall = /^node "\$\{(?:CLAUDE_PLUGIN_ROOT|VOID_HOOKS_DIR)\}\/(?:hooks\/)?_void-hook\.mjs" ([a-z-]+(?: [a-z-]+)*)$/.exec(hook.command)?.[1];
      const shellCall = /^(?:bash|sh) "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([a-zA-Z0-9-]+)\.sh"$/.exec(hook.command)?.[1];
      return shellCall === name || (runner !== undefined && nodeCall === `${runner} ${runtime}`);
    }))
      .map(group => ({ name, runtime, trigger: `${event} (${group.matcher ?? '*'})` }))));
}

export async function loadCatalog(sourceRoot?: string): Promise<readonly CatalogEntry[]> {
  const core = sourceRoot ?? await findCoreSource();
  const input: unknown = JSON.parse(await requireData(core, 'data/model.json', 4 * 1024 * 1024));
  const specialistDirectory = await lstat(join(core, 'specialists'));
  if (!specialistDirectory.isDirectory() || specialistDirectory.isSymbolicLink()) throw new Error('SPECIALIST_SOURCE_INVALID');
  const specialists = await loadSpecialists(core, path => requireData(core, relative(core, path), MAX_SPECIALIST_FILE_BYTES));
  if (specialists.length === 0) throw new Error('SPECIALIST_SOURCE_EMPTY');
  const commands: CatalogEntry[] = Object.entries(COMMAND_CATALOG).map(([name, command]) => ({
    id: `command:${name}`, name, type: 'command', pack: 'core', runtimes: ['cli'],
    description: command.help.map(row => row.description).join(' '),
    invocations: command.help.map(row => ({ runtime: 'cli', text: `${PRODUCT_COMMAND} ${row.signature}` })),
    triggers: ['Explicit CLI invocation.'], relatedIds: [],
  }));
  const initial = projectCatalog(input, specialists, [], commands);
  const manifests = [
    { runtime: 'claude' as const, value: JSON.parse(await requireData(core, '.claude-plugin/plugin.json', 128 * 1024)) },
    { runtime: 'codex' as const, value: JSON.parse(await requireData(core, 'codex/hooks.json', 128 * 1024)) },
  ];
  const wiring: HookWiring[] = [];
  for (const entry of initial.filter(item => item.type === 'hook')) {
    wiring.push(...hookWiring(entry.name, await requireData(core, `hooks/${entry.name}.sh`, 64 * 1024), manifests));
  }
  return projectCatalog(input, specialists, wiring, commands);
}
