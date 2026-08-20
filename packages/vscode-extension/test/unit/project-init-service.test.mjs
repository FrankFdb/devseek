/**
 * Unit tests for the explicit /init protocol boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/project-init-service.bundle.cjs');

execSync(
  `npx esbuild src/app/project-init-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  PROJECT_INIT_AGENT_PROMPT,
  isProjectInitCommand,
  resolveProjectInitPrompt,
} = req(bundlePath);

test('exact /init is translated into a model-led repository task', () => {
  assert.equal(isProjectInitCommand('/init'), true);
  assert.equal(isProjectInitCommand('  /init\n'), true);
  assert.equal(resolveProjectInitPrompt('/init', '/init'), PROJECT_INIT_AGENT_PROMPT);
  assert.match(PROJECT_INIT_AGENT_PROMPT, /\.devseek\/rules\.md/);
  assert.match(PROJECT_INIT_AGENT_PROMPT, /inspect the repository/i);
  assert.match(PROJECT_INIT_AGENT_PROMPT, /Do not overwrite/i);
  assert.match(PROJECT_INIT_AGENT_PROMPT, /read the final file back/i);
});

test('ordinary language and slash-like text remain raw model input', () => {
  const ordinaryInputs = [
    '/init 请生成项目规则',
    '/initialize',
    '请初始化这个项目',
    '帮我生成 DevSeek 规则',
    '初始化可能会破坏现有配置吗？',
    'init project',
  ];

  for (const input of ordinaryInputs) {
    assert.equal(isProjectInitCommand(input), false, input);
    assert.equal(resolveProjectInitPrompt(input, input), undefined, input);
  }
});

test('display command may translate a transport-decorated prompt without changing display text', () => {
  assert.equal(
    resolveProjectInitPrompt('/init', '[workspace context]\n/init'),
    PROJECT_INIT_AGENT_PROMPT,
  );
});

console.log('\nProject init service tests passed.\n');
