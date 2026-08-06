import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CONTEXT_PROVENANCE_VERSION,
  CODING_INSTRUCTION_PRECEDENCE_VERSION,
  CanonicalContextProvenanceService,
  CanonicalInstructionPrecedenceService,
} from '../dist/index.js';

test('context provenance seals source identity without retaining source content', () => {
  const records = new CanonicalContextProvenanceService().captureMany([
    { sourceId: 'workspace', kind: 'workspace-root', locator: '/repo' },
    {
      sourceId: 'source',
      kind: 'workspace-file',
      locator: 'src/value.ts',
      content: 'const secret = "hash-only";',
      parentSourceIds: ['workspace'],
    },
  ]);

  assert.equal(records[0].version, CODING_CONTEXT_PROVENANCE_VERSION);
  assert.equal(records[0].authority, 'workspace');
  assert.equal(records[1].trust, 'observed');
  assert.match(records[1].contentSha256, /^[a-f0-9]{64}$/u);
  assert.match(records[1].recordSha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(records).includes('hash-only'), false);
  assert.throws(() => records.push({}), TypeError);
});

test('instruction precedence resolves broad-to-specific and authority before numeric scope', () => {
  const decision = new CanonicalInstructionPrecedenceService().resolve({
    instructions: [
      {
        sourceId: 'workspace:root', authority: 'workspace', kind: 'agents', locator: 'AGENTS.md',
        content: 'Always run `npm test`.', scopeDepth: 0, sourcePriority: 10,
      },
      {
        sourceId: 'workspace:nested', authority: 'workspace', kind: 'agents', locator: 'pkg/AGENTS.md',
        content: 'Do not run `npm test`.', scopeDepth: 999_999, sourcePriority: 10,
      },
      {
        sourceId: 'user:current', authority: 'user', kind: 'user-request', locator: 'user-prompt',
        content: 'Run `npm test` before finishing.',
      },
      {
        sourceId: 'runtime:policy', authority: 'runtime', kind: 'runtime-policy', locator: 'runtime-policy',
        content: 'Do not run `npm test` in this sandbox.',
      },
    ],
  });

  assert.equal(decision.version, CODING_INSTRUCTION_PRECEDENCE_VERSION);
  assert.deepEqual(decision.instructions.map(item => item.sourceId), [
    'workspace:root', 'workspace:nested', 'user:current', 'runtime:policy',
  ]);
  assert.deepEqual(decision.instructions.map(item => item.precedenceRank), [1, 2, 3, 4]);
  assert.equal(decision.conflicts[0].winningSourceId, 'runtime:policy');
  assert.deepEqual(decision.conflicts[0].supersededSourceIds, [
    'workspace:root', 'workspace:nested', 'user:current',
  ]);
  assert.deepEqual(decision.provenance.map(item => item.authority), [
    'workspace', 'workspace', 'user', 'runtime',
  ]);
  assert.equal(JSON.stringify(decision.provenance).includes('npm test'), false);
});

test('context provenance and instruction precedence reject malformed authority chains', () => {
  const provenance = new CanonicalContextProvenanceService();
  assert.throws(
    () => provenance.captureMany([{ sourceId: 'child', kind: 'workspace-file', locator: 'a', parentSourceIds: ['missing'] }]),
    /coding-context-provenance:missing-parent-source:missing/u,
  );
  assert.throws(
    () => provenance.capture({ sourceId: 'same', kind: 'workspace-file', locator: 'a', parentSourceIds: ['same'] }),
    /coding-context-provenance:self-parent/u,
  );
  assert.throws(
    () => provenance.capture({ sourceId: 'source', kind: 'workspace-file', locator: 'a', content: 'a', contentSha256: '0'.repeat(64) }),
    /coding-context-provenance:content-sha256-mismatch/u,
  );
  assert.throws(
    () => new CanonicalInstructionPrecedenceService().resolve({ instructions: [{
      sourceId: 'invalid', authority: 'kernel', kind: 'other', locator: 'x', content: 'x',
    }] }),
    /coding-instruction-precedence:invalid-authority/u,
  );
  assert.throws(
    () => new CanonicalInstructionPrecedenceService().resolve({ instructions: [{
      sourceId: 'unsafe-depth', authority: 'workspace', kind: 'other', locator: 'x', content: 'x',
      scopeDepth: Number.MAX_SAFE_INTEGER + 1,
    }] }),
    /coding-instruction-precedence:invalid-scope-depth/u,
  );
});
