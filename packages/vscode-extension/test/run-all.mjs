#!/usr/bin/env node
/**
 * Run all unit tests and exit 0 if all pass, 1 if any fail.
 * Usage: node test/run-all.mjs
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');

const suites = [
  'test/unit/agent-display-regression.test.mjs',
  'test/unit/webview-logic.test.mjs',
  'test/unit/intent-router.test.mjs',
  'test/unit/generated-file-parser.test.mjs',
  'test/unit/llm-agent-loop.test.mjs',
  'test/unit/pending-edit-workflow.test.mjs',
  'test/unit/workflow-compliance.test.mjs',
];

let passed = 0;
let failed = 0;

for (const suite of suites) {
  process.stdout.write(`\n▶  ${suite}\n`);
  try {
    execSync(`node --test ${suite}`, { cwd: rootDir, stdio: 'inherit' });
    passed++;
  } catch {
    failed++;
  }
}

const total = passed + failed;
const status = failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`;
console.log(`\n────────────────────────────────────────`);
console.log(`Suites: ${total}  ✔ ${passed} passed  ✖ ${failed} failed`);
console.log(status);
console.log(`────────────────────────────────────────\n`);

process.exit(failed > 0 ? 1 : 0);
