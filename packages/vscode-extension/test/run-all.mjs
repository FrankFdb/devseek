#!/usr/bin/env node
/**
 * Run all unit tests and exit 0 if all pass, 1 if any fail.
 * Usage: node test/run-all.mjs
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');

const unitDir = path.join(rootDir, 'test/unit');
const suites = fs.readdirSync(unitDir)
  .filter(file => file.endsWith('.test.mjs'))
  .sort()
  .map(file => `test/unit/${file}`);

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
