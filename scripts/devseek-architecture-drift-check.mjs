#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgetPath = path.join(repoRoot, 'docs/process/devseek-architecture-budgets.json');
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));

const files = [];
const violations = [];
const debt = [];
const implementationPolicy = budget.implementationPolicy ?? {};
const priorityOrder = Array.isArray(implementationPolicy.priorityOrder)
  ? implementationPolicy.priorityOrder
  : [];
const requiredDecreaseEvidence = new Set([
  'named-responsibility-extracted',
  'dependency-direction-preserved',
  'tests-move-with-responsibility',
  'legacy-owner-removed-or-semantic-free',
  'sibling-bypass-guarded',
]);
const actualDecreaseEvidence = new Set(implementationPolicy.budgetDecreaseRequires ?? []);

if (Number(budget.version) < 2) {
  violations.push({ kind: 'design-first-policy-version-missing' });
}
if (implementationPolicy.sizeMetricRole !== 'regression-guardrail-only') {
  violations.push({ kind: 'size-metric-role-invalid' });
}
if (priorityOrder.at(-1) !== 'size-budget') {
  violations.push({ kind: 'size-budget-must-be-last-priority' });
}
for (const evidence of requiredDecreaseEvidence) {
  if (!actualDecreaseEvidence.has(evidence)) {
    violations.push({ kind: 'budget-decrease-evidence-missing', evidence });
  }
}

for (const [relativePath, rule] of Object.entries(budget.files ?? {})) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    violations.push({ path: relativePath, kind: 'missing-budgeted-file' });
    continue;
  }
  const lines = countLines(fs.readFileSync(absolutePath, 'utf8'));
  const record = {
    path: relativePath,
    lines,
    maxLines: Number(rule.maxLines),
    targetLines: Number(rule.targetLines),
    boundary: String(rule.boundary || ''),
  };
  files.push(record);
  if (lines > record.maxLines) {
    violations.push({
      ...record,
      kind: 'frozen-file-grew',
      excessLines: lines - record.maxLines,
    });
  } else if (lines > record.targetLines) {
    debt.push({
      ...record,
      remainingLines: lines - record.targetLines,
    });
  }
}

const report = {
  ok: violations.length === 0,
  policy: budget.policy,
  implementationPolicy,
  budgetPath: path.relative(repoRoot, budgetPath),
  files,
  violations,
  debt,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function countLines(content) {
  if (!content) return 0;
  const count = content.split(/\r?\n/).length;
  return /\r?\n$/.test(content) ? count - 1 : count;
}
