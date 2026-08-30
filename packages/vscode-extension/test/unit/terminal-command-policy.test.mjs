/**
 * Unit tests for terminal command risk classification.
 *
 * Claude Code/Codex-style contract: low-risk workspace inspection should stay
 * low-friction, while writes and arbitrary execution keep an explicit boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/terminal-command-policy.bundle.cjs');

execSync(
  `npx esbuild ../shared/src/coding-terminal-command-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { decideTerminalCommandPermission } = req(bundlePath);

const workspaceRoot = '/workspace/devseek';

test('TerminalCommandPolicy: allows workspace read-only ls/test/head commands without confirmation', () => {
  assert.deepEqual(
    decideTerminalCommandPermission({
      command: 'ls -la /workspace/devseek/docs/manual-phase5-smoke.md 2>&1 || echo "文件不存在"',
      workspaceRoot,
    }),
    { risk: 'read-only', requiresConfirmation: false, canRememberDecision: true, reason: 'read-only-workspace-inspection' },
  );
  assert.equal(
    decideTerminalCommandPermission({
      command: 'test -f /workspace/devseek/docs/manual-phase5-smoke.md && echo "文件存在" && cat /workspace/devseek/docs/manual-phase5-smoke.md',
      workspaceRoot,
    }).requiresConfirmation,
    false,
  );
  assert.equal(
    decideTerminalCommandPermission({
      command: 'ls -la /workspace/devseek/docs 2>&1 | head -20',
      workspaceRoot,
    }).requiresConfirmation,
    false,
  );
});

test('TerminalCommandPolicy: confirms read-only commands outside the workspace', () => {
  const decision = decideTerminalCommandPermission({
    command: 'ls -la /etc',
    workspaceRoot,
  });

  assert.equal(decision.requiresConfirmation, true);
  assert.equal(decision.risk, 'unknown');
  assert.match(decision.reason, /outside-workspace/);
});

test('TerminalCommandPolicy: confirms validation commands but allows remembering that class', () => {
  const decision = decideTerminalCommandPermission({
    command: 'npx tsc --noEmit packages/vscode-extension/src/workspace/manual-phase5-smoke.ts',
    workspaceRoot,
  });

  assert.equal(decision.risk, 'validation');
  assert.equal(decision.requiresConfirmation, true);
  assert.equal(decision.canRememberDecision, true);
});

test('TerminalCommandPolicy: confirms shell writes and destructive commands', () => {
  assert.equal(
    decideTerminalCommandPermission({
      command: 'python3 -c "with open(\'/workspace/devseek/docs/manual-phase5-smoke.md\', \'w\') as f: f.write(\'x\')"',
      workspaceRoot,
    }).risk,
    'mutating',
  );
  assert.equal(
    decideTerminalCommandPermission({
      command: 'rm -rf /workspace/devseek/docs',
      workspaceRoot,
    }).risk,
    'destructive',
  );
});

test('TerminalCommandPolicy: classifies in-place editors as mutating commands', () => {
  assert.equal(
    decideTerminalCommandPermission({
      command: "sed -i 's/x/y/g' /workspace/devseek/src/test_warranty_protocol.py",
      workspaceRoot,
    }).risk,
    'mutating',
  );
  assert.equal(
    decideTerminalCommandPermission({
      command: "perl -pi -e 's/x/y/g' /workspace/devseek/docs/plan.md",
      workspaceRoot,
    }).risk,
    'mutating',
  );
});

test('TerminalCommandPolicy: read-only allowlist rejects embedded output primitives', () => {
  const commands = [
    'sed -n "w out.txt" input.txt',
    'git diff --output=out.patch',
    'find . -fprint out.txt',
    "find . -fprintf out.txt '%p\\n'",
    'find . -fls out.txt',
    String.raw`find . -execdir touch marker.txt \;`,
    'sort input.txt -o out.txt',
    'sort --output=out.txt input.txt',
    `awk '{print > "out.txt"}' input.txt`,
    `awk '{print>"out.txt"}' input.txt`,
    'echo x>out.txt',
  ];

  for (const command of commands) {
    const decision = decideTerminalCommandPermission({ command, workspaceRoot });
    assert.equal(decision.risk, 'mutating', command);
    assert.equal(decision.requiresConfirmation, true, command);
  }
});

test('TerminalCommandPolicy: normal inspection and validation commands remain classified', () => {
  for (const command of [
    'cat package.json',
    'rg -n TODO src',
    'git diff -- src/app.ts',
  ]) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'read-only', command);
  }
  assert.equal(decideTerminalCommandPermission({ command: 'npm test', workspaceRoot }).risk, 'validation');
});

test('TerminalCommandPolicy: Python syntax and workspace script runs are validation commands', () => {
  const command = [
    "test -s '/workspace/devseek/tools/log_summary.py'",
    "PYTHONDONTWRITEBYTECODE=1 python3 -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding=\"utf-8\"), sys.argv[1], \"exec\")' '/workspace/devseek/tools/log_summary.py'",
    "printf '%s\\n' 'INFO start' 'WARN slow' 'ERROR fail' | PYTHONDONTWRITEBYTECODE=1 python3 '/workspace/devseek/tools/log_summary.py' | grep -Fx -- 'ERROR=1 WARN=1'",
  ].join(' && ');
  const decision = decideTerminalCommandPermission({ command, workspaceRoot });

  assert.equal(decision.risk, 'validation');
  assert.equal(decision.reason, 'validation-command');
});

test('TerminalCommandPolicy: assertion-only Node inline checks are validation commands', () => {
  const command = `node -e "const { add } = require('./src/math.js'); if (add(2, 3) !== 5) process.exit(1); console.log('ADD_OK')"`;
  const decision = decideTerminalCommandPermission({ command, workspaceRoot });

  assert.equal(decision.risk, 'validation');
  assert.equal(decision.reason, 'validation-command');
});

test('TerminalCommandPolicy: named Node verification scripts inside the workspace are validation commands', () => {
  for (const command of [
    'node tools/verify-ppm.mjs verification.ppm',
    'cd /workspace/devseek && node tools/check-layout.cjs fixture.json 2>&1',
    'node ./test-render.js',
  ]) {
    const decision = decideTerminalCommandPermission({ command, workspaceRoot });
    assert.equal(decision.risk, 'validation', command);
    assert.equal(decision.reason, 'validation-command', command);
  }
  for (const command of [
    'node tools/render-ppm.mjs verification.ppm',
    'node tools/verify-ppm.mjs --write verification.ppm',
  ]) {
    assert.notEqual(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'validation', command);
  }
});

test('TerminalCommandPolicy: Node inline snippets retain a narrow side-effect boundary', () => {
  const counterexamples = [
    `node -e "console.log('no assertion')"`,
    `node -e "require('fs').writeFileSync('result.txt', 'bad'); process.exit(1)"`,
    `node -e "require('child_process').execSync('touch result.txt'); process.exit(1)"`,
    `node -e "require('https').get('https://example.com'); process.exit(1)"`,
    `node -e "eval('console.log(1)'); process.exit(1)"`,
  ];

  assert.equal(
    decideTerminalCommandPermission({ command: counterexamples[0], workspaceRoot }).risk,
    'unknown',
  );
  for (const command of counterexamples.slice(1)) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'mutating', command);
  }
});

test('TerminalCommandPolicy: arbitrary Python snippets remain outside validation', () => {
  const decision = decideTerminalCommandPermission({
    command: "python3 -c 'import os; os.system(\"echo hi\")'",
    workspaceRoot,
  });

  assert.equal(decision.risk, 'unknown');
  assert.equal(decision.requiresConfirmation, true);
});

test('TerminalCommandPolicy: git branch only allows explicit inspection forms', () => {
  for (const command of [
    'git branch',
    'git branch --list',
    "git branch --list 'feature/*'",
    'git branch --show-current',
    'git branch -a -v',
  ]) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'read-only', command);
  }

  for (const command of [
    'git branch feature/new',
    'git branch feature/new HEAD',
    'git branch -d feature/old',
    'git branch -D feature/old',
    'git branch -m old new',
    'git branch -M old new',
    'git branch -c old copy',
    'git branch -C old copy',
    'git branch -f feature/reset HEAD~1',
    'git branch --set-upstream-to=origin/main feature/current',
    'git branch --unset-upstream feature/current',
    'git branch --edit-description feature/current',
  ]) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'mutating', command);
  }
});

test('TerminalCommandPolicy: awk command pipes and validation write flags are mutating', () => {
  for (const command of [
    `awk 'BEGIN { "touch marker.txt" | getline }'`,
    `awk 'BEGIN { "touch marker.txt"|getline }'`,
    'npx eslint . --fix',
    'npx eslint . --cache',
    'npx eslint . -o eslint-report.txt',
    'npx eslint . -oeslint-report.txt',
    'npx jest -u',
    'npx jest -u=true',
    'npx jest --updateSnapshot',
    'npx jest --coverage',
    'npx jest --coverageDirectory=coverage',
    'npx jest --cacheDirectory=.jest-cache',
    'npm run lint -- --fix',
    'npm test -- -u',
    'npx tsc',
    'tsc',
    'npx tsc --noEmit=false',
    'npx tsc --noEmit --incremental',
  ]) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'mutating', command);
  }
});

test('TerminalCommandPolicy: non-writing validation counterexamples remain validation', () => {
  for (const command of [
    'npx eslint .',
    'npx eslint . --fix-dry-run',
    'npx jest --runInBand',
    'npm test',
    'npm run lint',
    'npx tsc --noEmit',
    'npx tsc --noEmit=true',
    'tsc --noEmit',
  ]) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'validation', command);
  }
});

test('TerminalCommandPolicy: C++ compile-run inside workspace is validation evidence', () => {
  for (const command of [
    'cd /workspace/devseek && g++ hello.cpp -o hello && ./hello',
    "g++ -std=c++17 '/workspace/devseek/hello.cpp' -o '/workspace/devseek/hello' && '/workspace/devseek/hello'",
  ]) {
    const decision = decideTerminalCommandPermission({ command, workspaceRoot });
    assert.equal(decision.risk, 'validation', command);
    assert.equal(decision.requiresConfirmation, true, command);
    assert.equal(decision.canRememberDecision, true, command);
  }
});

test('TerminalCommandPolicy: project scripts and bounded CMake builds remain validation with fd merging', () => {
  for (const command of [
    'cd /workspace/devseek && ./test.sh 2>&1',
    'cd /workspace/devseek && bash test.sh',
    'cd /workspace/devseek && bash test.sh 2>&1',
    'cd /workspace/devseek && sh ./verify-project.sh 2>/dev/null',
    'cd /workspace/devseek && sh ./verify-project.sh',
    'cd /workspace/devseek && cmake -S . -B build 2>&1 && cmake --build build -j2 2>&1 && ctest --test-dir build --output-on-failure',
  ]) {
    const decision = decideTerminalCommandPermission({ command, workspaceRoot });
    assert.equal(decision.risk, 'validation', command);
    assert.equal(decision.canRememberDecision, true, command);
  }
  assert.equal(
    decideTerminalCommandPermission({ command: 'cmake --install build', workspaceRoot }).risk,
    'unknown',
  );
  assert.equal(
    decideTerminalCommandPermission({ command: './test.sh > validation.log', workspaceRoot }).risk,
    'mutating',
  );
  assert.equal(
    decideTerminalCommandPermission({ command: 'bash test.sh 2> validation.log', workspaceRoot }).risk,
    'mutating',
  );
  for (const command of ['bash release.sh', "bash -c './test.sh'", 'sh arbitrary.sh']) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'unknown', command);
  }
});

test('TerminalCommandPolicy: bounded Make builds are validation but lifecycle targets remain unclassified', () => {
  for (const command of [
    'cd /workspace/devseek/build && make -j4 2>&1',
    'make -j 4',
    'make all',
    'make build check',
  ]) {
    const decision = decideTerminalCommandPermission({ command, workspaceRoot });
    assert.equal(decision.risk, 'validation', command);
    assert.equal(decision.requiresConfirmation, true, command);
  }
  for (const command of [
    'make install',
    'make package',
    'make clean',
    'make deploy',
    'make -j install',
    'make OUTPUT=release all',
  ]) {
    assert.equal(decideTerminalCommandPermission({ command, workspaceRoot }).risk, 'unknown', command);
  }
  assert.equal(
    decideTerminalCommandPermission({ command: "make --eval='all:; touch pwned'", workspaceRoot }).risk,
    'mutating',
  );
});

test('TerminalCommandPolicy: canonical workspace paths reject symlink escapes for reads and workdirs', t => {
  const actualWorkspace = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-policy-workspace-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'devseek-terminal-policy-outside-'));
  t.after(() => {
    rmSync(actualWorkspace, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  });
  mkdirSync(path.join(actualWorkspace, 'safe'));
  writeFileSync(path.join(actualWorkspace, 'safe', 'status.txt'), 'SAFE\n');
  writeFileSync(path.join(outsideRoot, 'secret.txt'), 'SECRET\n');
  symlinkSync(outsideRoot, path.join(actualWorkspace, 'linked'), 'dir');

  assert.equal(decideTerminalCommandPermission({
    command: 'cat safe/status.txt',
    workspaceRoot: actualWorkspace,
  }).risk, 'read-only');

  const linkedRead = decideTerminalCommandPermission({
    command: 'cat linked/secret.txt',
    workspaceRoot: actualWorkspace,
  });
  assert.equal(linkedRead.risk, 'unknown');
  assert.equal(linkedRead.reason, 'command-path-resolves-outside-workspace');

  const linkedWorkdir = decideTerminalCommandPermission({
    command: 'npm test',
    workspaceRoot: actualWorkspace,
    workdir: path.join(actualWorkspace, 'linked'),
  });
  assert.equal(linkedWorkdir.risk, 'unknown');
  assert.equal(linkedWorkdir.reason, 'command-workdir-resolves-outside-workspace');
});

test('TerminalCommandPolicy: unresolved shell path execution stays outside unattended authority', () => {
  assert.deepEqual(
    decideTerminalCommandPermission({ command: 'cat "$HOME/.ssh/config"', workspaceRoot }),
    { risk: 'unknown', requiresConfirmation: true, canRememberDecision: false, reason: 'dynamic-path-expansion' },
  );
  assert.deepEqual(
    decideTerminalCommandPermission({ command: 'cat "$TARGET_FILE"', workspaceRoot }),
    { risk: 'unknown', requiresConfirmation: true, canRememberDecision: false, reason: 'dynamic-path-expansion' },
  );
  assert.deepEqual(
    decideTerminalCommandPermission({ command: 'cat <(printf secret)', workspaceRoot }),
    { risk: 'unknown', requiresConfirmation: true, canRememberDecision: false, reason: 'process-substitution' },
  );
  assert.equal(
    decideTerminalCommandPermission({ command: 'echo "$CI"', workspaceRoot }).risk,
    'read-only',
  );
});

console.log('\nTerminal command policy tests passed.\n');
