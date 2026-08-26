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
  detectShellFileMutationCommand,
  detectShellFileWriteCommand,
  getTerminalRecoveryProtocol,
  makeTerminalCmdSignature,
  shouldBlockUnverifiedSourceOverwrite,
} = req(bundlePath);

test('AgentLoop terminal guard keeps identity beyond a long shared workdir prefix', () => {
  const prefix = `cd /workspace/${'deeply-nested-project/'.repeat(8)} && ./build/math_visual_lab`;
  const help = makeTerminalCmdSignature(`${prefix} --help`);
  const acceptance = makeTerminalCmdSignature(
    `${prefix} --script assets/actions.txt --snapshot output.ppm --state output.json`,
  );

  assert.ok(prefix.length > 120);
  assert.notEqual(help, acceptance);
  assert.equal(makeTerminalCmdSignature(`  ${prefix}   --help  `), help);
});

test('AgentLoop terminal recovery distinguishes a passing command from fresh artifact progress', () => {
  const feedback = getTerminalRecoveryProtocol(
    './math_visual --script assets/actions.txt --snapshot output.ppm --state output.json',
    2,
  );

  assert.match(feedback, /验收条件、输出路径和产物新鲜度/u);
  assert.match(feedback, /已有文件优先使用 replace_in_file 精确修改/u);
  assert.doesNotMatch(feedback, /直接调用 create_file 写入目标文件的完整内容/u);
});

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
  assert.equal(detectShellFileWriteCommand('echo x > report.markdown'), 'report.markdown');
  assert.equal(detectShellFileWriteCommand('echo x > notes.yaml'), 'notes.yaml');
  assert.equal(detectShellFileWriteCommand('printf x > BUILDSTAMP'), 'BUILDSTAMP');
  assert.equal(
    detectShellFileWriteCommand(`python3 -c "open('notes.log','w').write('x')"`),
    'notes.log',
  );
});

test('AgentLoop write guard: detects Python open/write shell write targets', () => {
  assert.equal(
    detectShellFileWriteCommand('python3 -c "with open(\'/workspace/docs/manual-phase5-smoke.md\', \'w\') as f: f.write(\'# Phase 5 smoke\\n\')"'),
    '/workspace/docs/manual-phase5-smoke.md',
  );
  assert.equal(
    detectShellFileWriteCommand('python -c "from pathlib import Path; Path(\'docs/plan.md\').write_text(\'notes\')"'),
    'docs/plan.md',
  );
});

test('AgentLoop write guard: detects in-place shell editors as file writes', () => {
  assert.equal(
    detectShellFileWriteCommand("sed -i 's/x/y/g' src/test_warranty_protocol.py"),
    'src/test_warranty_protocol.py',
  );
  assert.equal(
    detectShellFileWriteCommand("cd src && sed -i.bak 's/x/y/g' test_warranty_protocol.py && python3 test_warranty_protocol.py"),
    'test_warranty_protocol.py',
  );
  assert.equal(
    detectShellFileWriteCommand("perl -pi -e 's/x/y/g' docs/plan.md"),
    'docs/plan.md',
  );
});

test('AgentLoop write guard: detects terminal commands that bypass structured file mutations', () => {
  assert.equal(
    detectShellFileMutationCommand('rm -f src/maintenance_validation.hpp'),
    'rm src/maintenance_validation.hpp',
  );
  assert.equal(
    detectShellFileMutationCommand('cd src && mv old.hpp new.hpp'),
    'mv new.hpp',
  );
  assert.equal(
    detectShellFileMutationCommand("find generated -name '*.tmp' -delete"),
    'find -delete',
  );
  assert.equal(detectShellFileMutationCommand('g++ -fsyntax-only src/types.hpp'), undefined);
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
