// tdd-cover: e2e packages/cli/src/lib/candidate-process.test.ts
import { writeCandidatePlan } from '../dist/main.js';

try {
  const [request, response, extra] = process.argv.slice(2);
  if (!request || !response || extra) throw new Error('expected request and response paths');
  await writeCandidatePlan(request, response);
} catch (error) {
  process.stderr.write(`Candidate protocol: ${error instanceof Error ? error.message : 'preparation failed'}\n`);
  process.exitCode = 1;
}
