import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/requirement-contract.bundle.cjs');

execSync(
  `npx esbuild src/agent/requirement-contract.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  buildRequirementContract,
  validateRequirementContract,
} = createRequire(import.meta.url)(bundlePath);

test('RequirementContract: separates objectives, deliverables, constraints and non-goals', () => {
  const contract = buildRequirementContract({
    promptText: [
      '请根据 docs/a.md 和 docs/b.md 输出到 risk-report.md 风险报告。',
      '不要修改源码；不需要固定三份文档。',
      '完成后读回 risk-report.md 验证。',
    ].join(' '),
  });

  assert.equal(contract.version, 'devseek.requirement-contract/v1');
  assert.equal(contract.authority, 'RequirementContract');
  assert.ok(contract.objectives.some((item) => item.includes('risk-report.md')));
  assert.deepEqual(contract.deliverables.map((item) => item.target), ['risk-report.md']);
  assert.equal(contract.deliverables[0].kind, 'report');
  assert.ok(contract.constraints.includes('no-source-change'));
  assert.ok(contract.nonGoals.includes('fixed-document-count'));
  assert.ok(contract.deliverables[0].acceptanceRefs.length > 0);

  const validation = validateRequirementContract(contract);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
});

test('RequirementContract: every deliverable must map to applicable acceptance and verifier evidence', () => {
  const contract = buildRequirementContract({
    promptText: '创建 acceptance-report.md，完成后用文件存在和读回内容验证。',
  });
  const acceptanceIds = new Set(contract.acceptanceCriteria.map((item) => item.id));

  for (const deliverable of contract.deliverables) {
    assert.ok(deliverable.acceptanceRefs.length > 0);
    assert.ok(deliverable.acceptanceRefs.every((id) => acceptanceIds.has(id)));
  }
  for (const acceptance of contract.acceptanceCriteria) {
    assert.equal(acceptance.status, 'executable');
    assert.equal(acceptance.applicability.status, 'applies');
    assert.ok(acceptance.verifier);
    assert.ok(acceptance.scope.length > 0);
    assert.ok(acceptance.evidenceRefs.length > 0);
  }

  const broken = {
    ...contract,
    acceptanceCriteria: [],
  };
  assert.deepEqual(validateRequirementContract(broken).errors, [
    'deliverable:acceptance-missing:deliverable-1',
  ]);
});

test('RequirementContract: weak acceptance or missing external attribution cannot settle complete', () => {
  const weak = buildRequirementContract({
    promptText: '生成一个看起来专业的报告。',
  });

  assert.equal(weak.acceptanceCriteria[0].status, 'weak-oracle');
  assert.ok(validateRequirementContract(weak).errors.includes(
    'acceptance:weak-oracle:acceptance-1',
  ));

  const external = buildRequirementContract({
    promptText: '按最新 OpenAI API 版本和 MIT license 写 deployment-plan.md 部署方案，数据来自外部接口。',
  });

  assert.ok(external.externalBoundaries.some((item) => item.kind === 'api-version'));
  assert.ok(external.externalBoundaries.some((item) => item.kind === 'license'));
  assert.ok(external.externalBoundaries.some((item) => item.kind === 'data-source'));
  assert.ok(validateRequirementContract(external).errors.some((item) => (
    item.startsWith('external_boundary:unknown-source:')
  )));

  const attributed = buildRequirementContract({
    promptText: '按最新 OpenAI API 版本写 deployment-plan.md 部署方案。',
    externalFacts: [{
      kind: 'api-version',
      name: 'OpenAI API',
      value: '2026-07-20',
      sourceRef: 'official-docs:openai-api:2026-07-20',
      accessedAt: '2026-07-20',
    }],
  });

  assert.deepEqual(
    validateRequirementContract(attributed).errors.filter((item) => (
      item.startsWith('external_boundary:unknown-source:')
    )),
    [],
  );
});
