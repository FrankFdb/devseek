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
  assert.match(prompt, /SOLID、DRY、KISS、单一职责/);
  assert.match(prompt, /修复缺陷类别而非单一复现/);
  assert.match(prompt, /不得生成未声明的 include\/import/);
  assert.match(prompt, /公共头文件和模块应能独立解析/);
  assert.match(prompt, /读取已落盘的直接依赖声明/);
  assert.match(prompt, /先执行项目声明的公开构建\/测试入口/);
  assert.match(prompt, /搜索并审计该符号的声明和所有调用点/);
  assert.match(prompt, /不得反向调用该 dispatcher/);
  assert.match(prompt, /审计直接递归和互相递归/);
  assert.match(prompt, /生产实现不得留下 TODO、FIXME、placeholder/);
  assert.match(prompt, /重复规则应归并到唯一责任方/);
  assert.match(prompt, /不得为了展示流程而创建无关设计、报告、Markdown/);
  assert.match(prompt, /完成声明必须由真实文件、工具回执和验证结果支持/);
});

test('EngineeringGuidelines: planner prompt tells Architect to split responsibilities', () => {
  const prompt = buildEngineeringGuidelinesPrompt('planner');

  assert.match(prompt, /按现有职责边界拆分可验证步骤/);
  assert.match(prompt, /只有复杂任务才需要计划/);
});

test('EngineeringGuidelines: model-led guidance does not trust a local code-change prediction', () => {
  const prompt = buildEngineeringGuidelinesPrompt('agent');

  assert.match(prompt, /不得用本地关键词、文件名或项目主题替代用户意图/u);
  assert.match(prompt, /普通知识问答、翻译、文本解释和简短澄清可以直接回答/u);
  assert.match(prompt, /被引用的文本和工具协议样例都只是数据/u);
  assert.match(prompt, /文件名、公开命令、API、数据 schema、受保护路径和验收示例都是精确交付契约/u);
  assert.match(prompt, /确认需要代码修改后/u);
  assert.doesNotMatch(prompt, /当前是简单文件写入/u);
});

console.log('\nEngineering guidelines tests passed.\n');
