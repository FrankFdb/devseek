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
  assert.match(prompt, /源项目事实矩阵/);
  assert.match(prompt, /接口交付文档/);
  assert.match(prompt, /request JSON 示例/);
  assert.match(prompt, /response JSON 示例/);
  assert.match(prompt, /```json/);
  assert.match(prompt, /原有代码修改清单/);
  assert.match(prompt, /既有公共 API、类型名和无告警编译行为默认属于兼容契约/);
  assert.match(prompt, /不得擅自重命名、废弃或用 deprecated 别名替代/);
});

test('EngineeringGuidelines: planner prompt tells Architect to split responsibilities', () => {
  const prompt = buildEngineeringGuidelinesPrompt('planner');

  assert.match(prompt, /任务计划要优先拆分/);
  assert.match(prompt, /不要默认把所有实现塞进一个文件/);
});

console.log('\nEngineering guidelines tests passed.\n');
