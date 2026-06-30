/**
 * Unit tests for agent/engineering-guidelines.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/engineering-guidelines.bundle.cjs');

execSync(
  `npx esbuild src/agent/engineering-guidelines.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildEngineeringGuidelinesPrompt,
  CODE_FILE_REVIEW_LINE_LIMIT,
  CODE_FILE_SPLIT_PLAN_LINE_LIMIT,
  FUNCTION_LINE_LIMIT,
  COMPLEX_FUNCTION_LINE_LIMIT,
} = req(bundlePath);

test('EngineeringGuidelines: agent prompt carries file and function size constraints', () => {
  const prompt = buildEngineeringGuidelinesPrompt('agent');

  assert.match(prompt, new RegExp(`${CODE_FILE_REVIEW_LINE_LIMIT} 行`));
  assert.match(prompt, new RegExp(`${CODE_FILE_SPLIT_PLAN_LINE_LIMIT} 行`));
  assert.match(prompt, new RegExp(`${FUNCTION_LINE_LIMIT} 行`));
  assert.match(prompt, new RegExp(`${COMPLEX_FUNCTION_LINE_LIMIT} 行`));
  assert.match(prompt, /相同逻辑原则上只能有一份/);
  assert.match(prompt, /除非用户明确要求单文件交付/);
});

test('EngineeringGuidelines: planner prompt tells Architect to split responsibilities', () => {
  const prompt = buildEngineeringGuidelinesPrompt('planner');

  assert.match(prompt, /任务计划要优先拆分/);
  assert.match(prompt, /不要默认把所有实现塞进一个文件/);
});

console.log('\nEngineering guidelines tests passed.\n');
