#!/usr/bin/env node
// Keep GitHub Actions as a projection of the executable gate catalogue.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATES } from './verify.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = resolve(ROOT, '.github', 'workflows', 'ci.yml');
const BEGIN = '      # verify-gates:begin';
const END = '      # verify-gates:end';

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   required: boolean,
 *   ciEnv?: Readonly<Record<string, string>>,
 * }} GateProjection
 */

/** @param {readonly GateProjection[]} gates */
export function renderGateBlock(gates) {
  const lines = [BEGIN];
  for (const gate of gates.filter((candidate) => candidate.required)) {
    lines.push(
      `      - name: ${JSON.stringify(`[${gate.id}] ${gate.label}`)}`,
      '        continue-on-error: true',
    );
    const environment = Object.entries(gate.ciEnv ?? {});
    if (environment.length > 0) {
      lines.push('        env:');
      for (const [name, value] of environment) lines.push(`          ${name}: ${value}`);
    }
    lines.push(
      '        run: >-',
      `          node scripts/verify.mjs --gate ${gate.id}`,
      '          --sha "$GATE_SHA"',
      `          --report ".void/machine/gate-reports/${gate.id}.json"`,
      '',
    );
  }
  lines.push(
    '      - name: Aggregate exact-SHA gate reports',
    "        if: ${{ !cancelled() && steps.admission.outcome == 'success' }}",
    '        run: >-',
    '          node scripts/verify.mjs --aggregate --sha "$GATE_SHA"',
    '          --reports ".void/machine/gate-reports"',
    `      # verify-gates:end`,
  );
  return lines.join('\n');
}

export function replaceGateBlock(workflow, block) {
  const start = workflow.indexOf(BEGIN);
  const finish = workflow.indexOf(END);
  if (start < 0 || finish < start) throw new Error('ci-gates: managed block is missing');
  if (
    workflow.indexOf(BEGIN, start + BEGIN.length) >= 0
    || workflow.indexOf(END, finish + END.length) >= 0
  ) {
    throw new Error('ci-gates: managed block must be unique');
  }
  return `${workflow.slice(0, start)}${block}${workflow.slice(finish + END.length)}`;
}

function main() {
  const check = process.argv.includes('--check');
  const current = readFileSync(WORKFLOW, 'utf8');
  const expected = replaceGateBlock(current, renderGateBlock(GATES));
  if (expected === current) {
    process.stdout.write('ci-gates: workflow projection is current.\n');
    return;
  }
  if (check) {
    process.stderr.write('ci-gates: workflow projection is stale; run `pnpm ci:gates:render`.\n');
    process.exitCode = 1;
    return;
  }
  writeFileSync(WORKFLOW, expected);
  process.stdout.write('ci-gates: regenerated the workflow projection.\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
