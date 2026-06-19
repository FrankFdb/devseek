/**
 * Unit tests for agent-loop write safety guards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-loop-write-guard.bundle.cjs');

execSync(
  `npx esbuild src/agent/write-guard.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  detectNestedFilePayloadDrift,
  detectShellFileWriteCommand,
  shouldBlockUnverifiedSourceOverwrite,
} = req(bundlePath);

test('AgentLoop write guard: blocks existing source overwrite without read evidence', () => {
  const decision = shouldBlockUnverifiedSourceOverwrite({
    absPath: '/workspace/packages/vscode-extension/src/app/workflow-service.ts',
    existed: true,
    readEvidencePaths: [],
  });

  assert.equal(decision.block, true);
  assert.match(decision.reason, /read_file/);
});

test('AgentLoop write guard: allows existing source overwrite after successful read evidence', () => {
  const decision = shouldBlockUnverifiedSourceOverwrite({
    absPath: '/workspace/packages/vscode-extension/src/app/workflow-service.ts',
    existed: true,
    readEvidencePaths: ['/workspace/packages/vscode-extension/src/app/workflow-service.ts'],
  });

  assert.equal(decision.block, false);
});

test('AgentLoop write guard: allows new source file creation without read evidence', () => {
  const decision = shouldBlockUnverifiedSourceOverwrite({
    absPath: '/workspace/code/main.cpp',
    existed: false,
    readEvidencePaths: [],
  });

  assert.equal(decision.block, false);
});

test('AgentLoop write guard: still detects config/doc shell write targets', () => {
  assert.equal(
    detectShellFileWriteCommand('printf "%s\\n" "{\\"name\\":\\"devseek\\"}" > package.json'),
    'package.json',
  );
  assert.equal(
    detectShellFileWriteCommand('echo "notes" >> docs/plan.md'),
    'docs/plan.md',
  );
});

test('AgentLoop write guard: blocks nested file payload drift into an unrelated target path', () => {
  const decision = detectNestedFilePayloadDrift({
    targetAbsPath: '/workspace/packages/vscode-extension/src/app/AGENTS.md',
    workspaceRoot: '/workspace',
    defaultWorkdir: '/workspace/packages/vscode-extension/src/app',
    content: JSON.stringify({
      path: '/workspace/packages/vscode-extension/src/app/workflow-service.ts',
      content: 'export const fixed = true;\n',
    }),
  });

  assert.equal(decision.block, true);
  assert.match(decision.reason, /workflow-service\.ts/);
  assert.match(decision.reason, /AGENTS\.md/);
});

test('AgentLoop write guard: allows JSON data files with path/content fields', () => {
  const decision = detectNestedFilePayloadDrift({
    targetAbsPath: '/workspace/test/fixtures/tool-payload.json',
    workspaceRoot: '/workspace',
    defaultWorkdir: '/workspace/test/fixtures',
    content: JSON.stringify({
      path: 'workflow-service.ts',
      content: 'export const fixed = true;\n',
    }),
  });

  assert.equal(decision.block, false);
});

console.log('\nAgent loop write guard tests passed.\n');
