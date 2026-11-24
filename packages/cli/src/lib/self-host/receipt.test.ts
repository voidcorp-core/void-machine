import { describe, expect, it } from 'vitest';
import {
  buildSelfHostReceipt,
  encodeSelfHostReceipt,
  parseSelfHostReceipt,
} from './receipt.js';

describe('self-host receipt', () => {
  it('round-trips a deterministic owned-file contract', () => {
    const receipt = buildSelfHostReceipt({
      sourceHash: 'a'.repeat(64),
      files: [{
        path: '.void/hooks/_void-hook.mjs',
        content: Buffer.from('runner'),
        mode: 0o644,
      }],
    });

    expect(parseSelfHostReceipt(encodeSelfHostReceipt(receipt))).toEqual(receipt);
    expect(receipt).not.toHaveProperty('mode');
    expect(receipt.runtimes).toEqual(['claude', 'codex']);
  });

  it.each(['shadow', 'warn', 'enforce', 'release-gate'])(
    'reads legacy %s receipts without carrying rollout authority', (mode) => {
      const receipt = buildSelfHostReceipt({ sourceHash: 'a'.repeat(64), files: [] });
      expect(parseSelfHostReceipt(JSON.stringify({ ...receipt, mode }))).toEqual(receipt);
    },
  );

  it('rejects unsafe owned paths and unknown modes', () => {
    const unsafe = JSON.stringify({
      schemaVersion: 1,
      sourceHash: 'a'.repeat(64),
      mode: 'fast',
      runtimes: ['claude', 'codex'],
      files: [{ path: '../escape', sha256: 'b'.repeat(64), mode: 420 }],
    });
    expect(parseSelfHostReceipt(unsafe)).toBeUndefined();
  });
});
