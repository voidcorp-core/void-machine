import { expect, it } from 'vitest';

it('resolves npm beside Windows Node without requiring that directory on PATH', async () => {
  const { packageManagerCommand } = await import('./package-manager.js');
  expect(packageManagerCommand('npm', { platform: 'win32', nodeExecutable: 'C:\\node\\node.exe',
    environment: { PATH: 'C:\\Windows' }, isFile: path => path === 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js',
  })).toEqual({ executable: 'C:\\node\\node.exe', prefixArguments: ['C:\\node\\node_modules\\npm\\bin\\npm-cli.js'] });
});

it('refuses a Windows shell shim when no npm JavaScript entrypoint is found', async () => {
  const { packageManagerCommand } = await import('./package-manager.js');
  expect(() => packageManagerCommand('npm', { platform: 'win32', nodeExecutable: 'C:\\node\\node.exe',
    environment: {}, isFile: () => false })).toThrow(/JavaScript entrypoint/);
});
