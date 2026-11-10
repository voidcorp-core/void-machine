import { describe, expect, it } from 'vitest';
import { parseCLI } from 'vitest/node';
import { runNetworkLane } from '../../scripts/test-network.mjs';

describe('network lane admission', () => {
  it('refuses unavailable loopback before admitting tests', () => {
    const commands: string[][] = [];
    const result = runNetworkLane((_command: string, args: string[]) => {
      commands.push(args);
      return { status: 1, stderr: 'EPERM', stdout: '' };
    });
    expect(result).toEqual({ status: 'unknown', exitCode: 2, reason: 'loopback unavailable: EPERM' });
    expect(commands).toHaveLength(1);
  });

  it('keeps a failed test red without retry after a healthy probe', () => {
    let invocations = 0;
    const result = runNetworkLane(() => ({ status: ++invocations === 1 ? 0 : 1 }));
    expect(result).toEqual({ status: 'failed', exitCode: 1 });
    expect(invocations).toBe(2);
  });

  it('bounds both processes and admits only the network projects', () => {
    const calls: { args: string[]; options: { timeout: number; shell: boolean } }[] = [];
    const result = runNetworkLane((_command: string, args: string[], options: { timeout: number; shell: boolean }) => {
      calls.push({ args, options });
      return { status: 0 };
    });
    expect(result).toEqual({ status: 'passed', exitCode: 0 });
    expect(calls.map(({ options }) => options.timeout)).toEqual([2_000, 120_000]);
    expect(calls.every(({ options }) => options.shell === false)).toBe(true);
    expect(calls[1]?.args).toContain('--project=*:network-browser');
    expect(calls[1]?.args).toContain('--pool=threads');
  });

  it('delivers distinct campaign seeds to Vitest without changing lane budgets', () => {
    const observed = [20_401, 20_402].map((seed) => {
      const commands: string[][] = [];
      const result = runNetworkLane((_command: string, args: string[]) => {
        commands.push(args);
        return { status: 0 };
      }, ['--sequence.shuffle', `--sequence.seed=${seed}`]);
      expect(result).toEqual({ status: 'passed', exitCode: 0 });
      const parsed = parseCLI(['vitest', ...commands[1].slice(1)]);
      expect(parsed.options).toMatchObject({
        project: ['*:network-browser'], maxWorkers: 1, pool: 'threads',
        sequence: { shuffle: true, seed },
      });
      return parsed.options.sequence?.seed;
    });
    expect(observed).toEqual([20_401, 20_402]);
  });

  it.each([
    ['--project=*:cpu'], ['--pool=forks'], ['--maxWorkers=99'],
    ['--testTimeout=999999'], ['--sequence.seed=0'], ['--sequence.seed=2147483648'],
    ['--sequence.seed=nope'], ['--sequence.shuffle=false'], ['some.test.ts'],
    ['--sequence.seed=1', '--sequence.seed=2'], ['--', '--sequence.shuffle'],
  ])('refuses unsupported lane arguments %j before executing a process', (...args) => {
    const result = runNetworkLane(() => { throw new Error('must not execute'); }, args);
    expect(result).toEqual({ status: 'unknown', exitCode: 2, reason: 'unsupported network lane arguments' });
  });

  it('reports a killed lane as unknown rather than successful', () => {
    let invocations = 0;
    const result = runNetworkLane(() => ++invocations === 1
      ? { status: 0 }
      : { error: Object.assign(new Error('expired'), { code: 'ETIMEDOUT' }) });
    expect(result).toEqual({ status: 'unknown', exitCode: 2, reason: 'network test process unavailable: ETIMEDOUT' });
    expect(invocations).toBe(2);
  });
});
