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
