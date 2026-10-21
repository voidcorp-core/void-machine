import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script, intentionally dependency-free
import { renderGateBlock } from '../../scripts/render-ci-gates.mjs';
// @ts-expect-error plain ESM script, intentionally dependency-free
import { GATES } from '../../scripts/verify.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const WORKFLOW = readFileSync(resolve(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const BEGIN = '      # verify-gates:begin';
const END = '      # verify-gates:end';

interface Gate {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
}

function managedBlock(workflow: string): string {
  const start = workflow.indexOf(BEGIN);
  const finish = workflow.indexOf(END);
  if (start < 0 || finish < start) return '';
  return workflow.slice(start, finish + END.length);
}

describe('generated CI gate projection', () => {
  const required = (GATES as readonly Gate[]).filter((gate) => gate.required);
  const rendered = renderGateBlock(GATES);

  it('runs every required gate once with independent failure evidence', () => {
    for (const gate of required) {
      expect(rendered.match(new RegExp(`--gate ${gate.id}\\b`, 'g')) ?? [], gate.id).toHaveLength(1);
      expect(rendered, gate.id).toContain(
        `--report ".void/machine/gate-reports/${gate.id}.json"`,
      );
    }
    expect(rendered.match(/continue-on-error: true/g) ?? []).toHaveLength(required.length);
  });

  it('aggregates exact-SHA reports after failures without running after cancellation', () => {
    expect(rendered).toMatch(/if: \$\{\{ !cancelled\(\) && steps\.admission\.outcome == 'success' \}\}/);
    expect(rendered).toContain('--aggregate --sha "$GATE_SHA"');
    expect(rendered).toContain('--reports ".void/machine/gate-reports"');
  });

  it('keeps the committed workflow byte-equal to the catalogue projection', () => {
    expect(managedBlock(WORKFLOW)).toBe(rendered);
  });
});
