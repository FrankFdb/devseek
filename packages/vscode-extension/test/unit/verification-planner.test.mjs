/**
 * Unit tests for app/verification-planner.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/verification-planner.bundle.cjs');

execSync(
  `npx esbuild src/app/verification-planner.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
  VerificationPlanner,
  shouldValidateNonCodeFiles,
} = req(bundlePath);

test('VerificationPlanner: extension TypeScript entry changes plan semantic check plus compile', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['packages/vscode-extension/src/extension.ts'],
  });

  assert.equal(plan.kind, 'command');
  assert.match(plan.command, /npx tsc --noEmit/);
  assert.match(plan.command, /src\/extension\.ts/);
  assert.match(plan.command, /&& npm run compile/);
  assert.equal(plan.cwd, path.join('/repo', 'packages', 'vscode-extension'));
  assert.equal(plan.timeoutMs, PROJECT_BUILD_VALIDATION_TIMEOUT_MS);
  assert.equal(plan.reason, 'extension-ts-semantic-check');
});

test('VerificationPlanner: extension TypeScript files get targeted semantic check before bundle compile', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts'],
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.cwd, path.join('/repo', 'packages', 'vscode-extension'));
  assert.equal(plan.reason, 'extension-ts-semantic-check');
  assert.match(plan.command, /npx tsc --noEmit/);
  assert.match(plan.command, /src\/workspace\/manual-phase6-quality-gate\.ts/);
  assert.match(plan.command, /&& npm run compile/);
});

test('VerificationPlanner: requested markdown validation uses file checks, not compilers', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['docs/manual-phase6-quality.md'],
    requestPrompt: '创建 docs/manual-phase6-quality.md，内容为 smoke，然后验证文件创建成功。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'non-code-file-validation');
  assert.match(plan.command, /test -f/);
  assert.match(plan.command, /manual-phase6-quality\.md/);
  assert.doesNotMatch(plan.command, /\bgcc\b|\bg\+\+\b|\bclang\b|\bnode\b|\bnpm\b/);
});

test('VerificationPlanner: explicit unknown text file writes use file checks, not blocked QualityGate', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['assets/manual-phase6.unknown'],
    requestPrompt: '创建 assets/manual-phase6.unknown，内容为：phase6 unknown validation target，并验证文件创建成功。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'non-code-file-validation');
  assert.match(plan.command, /test -f/);
  assert.match(plan.command, /manual-phase6\.unknown/);
  assert.doesNotMatch(plan.command, /\bgcc\b|\bg\+\+\b|\bclang\b|\bnode\b|\bnpm\b/);
});

test('VerificationPlanner: scoped other-file no-touch artifact request still uses file check', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['controlled-sim.txt'],
    requestPrompt: '请在当前工作区创建 controlled-sim.txt，文件内容必须精确包含一行 CONTROLLED_SIM_OK。完成写入和读回验证后结束任务，不要修改其他用户文件。',
  });

  assert.equal(shouldValidateNonCodeFiles('请在当前工作区创建 controlled-sim.txt，文件内容必须精确包含一行 CONTROLLED_SIM_OK。完成写入和读回验证后结束任务，不要修改其他用户文件。'), true);
  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'non-code-file-validation');
  assert.match(plan.command, /controlled-sim\.txt/);
});

test('VerificationPlanner: explicit content file checks include exact-line oracle', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['controlled-sim.txt'],
    requestPrompt: '请在当前工作区创建 controlled-sim.txt，文件内容必须精确包含一行 CONTROLLED_SIM_OK。完成写入和读回验证后结束任务。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'non-code-file-validation');
  assert.match(plan.command, /grep -Fx -- 'CONTROLLED_SIM_OK' 'controlled-sim\.txt'/);
  assert.doesNotMatch(plan.command, />|tee|cat\s+>|sed\s+-i/);
});

test('VerificationPlanner: mixed file facts and unplanned code targets stay blocked', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['docs/readme.md', 'scripts/tool.py'],
    requestPrompt: '更新 docs/readme.md 和 scripts/tool.py，并验证文件创建成功。',
  });

  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.reason, 'no-auto-validation-target');
});

test('VerificationPlanner: JavaScript probe writes get syntax validation without treating negative run constraints as runtime requests', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['.devseek-close02-probe/CLOSE02-20260713-manual-probe/probe.js'],
    requestPrompt: [
      '创建 .devseek-close02-probe/CLOSE02-20260713-manual-probe/probe.js 文件。',
      '最后一行打印：CLOSE02-20260713-manual-probe: 2+3=5。',
      '不运行网络，不安装依赖，不修改 git。',
    ].join(' '),
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'javascript-syntax-check');
  assert.match(plan.command, /node --check '\/repo\/\.devseek-close02-probe\/CLOSE02-20260713-manual-probe\/probe\.js'/);
  assert.doesNotMatch(plan.command, /&& node '\/repo\/\.devseek-close02-probe\/CLOSE02-20260713-manual-probe\/probe\.js'/);
});

test('VerificationPlanner: explicit isolated JavaScript probe run checks syntax before executing', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['.devseek-close02-probe/CLOSE02-20260713-manual-probe/probe.js'],
    requestPrompt: '创建隔离 probe.js 后运行本地 probe 看输出。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-run');
  assert.equal(plan.reason, 'javascript-syntax-and-run-validation');
  assert.match(plan.command, /node --check '\/repo\/\.devseek-close02-probe\/CLOSE02-20260713-manual-probe\/probe\.js' && node '\/repo\/\.devseek-close02-probe\/CLOSE02-20260713-manual-probe\/probe\.js'/);
});

test('VerificationPlanner: ordinary JavaScript artifacts stay syntax-only even when prompt mentions running unrelated network constraints', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['src/app.js'],
    requestPrompt: '创建 src/app.js，不运行网络，不安装依赖。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'javascript-syntax-check');
  assert.match(plan.command, /node --check '\/repo\/src\/app\.js'/);
  assert.doesNotMatch(plan.command, /&& node '\/repo\/src\/app\.js'/);
});

test('VerificationPlanner: CMakeLists-only C++ project changes still plan CMake validation', () => {
  const files = new Set([
    path.join('/repo', 'code', 'shape_manager'),
    path.join('/repo', 'code', 'shape_manager', 'CMakeLists.txt'),
  ]);
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['code/shape_manager/CMakeLists.txt'],
    requestPrompt: '更新 CMakeLists.txt，编译运行验证三维图形展示效果。',
    fsNode: {
      existsSync: (p) => files.has(p),
      readdirSync: () => ['CMakeLists.txt', 'main.cpp'],
      readFileSync: () => 'add_executable(shape_manager main.cpp)\n',
    },
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'cmake');
  assert.equal(plan.reason, 'cmake-build-and-run-requested');
  assert.match(plan.command, /cmake -S/);
  assert.match(plan.command, /code\/shape_manager\/build/);
  assert.match(plan.command, /build\/bin\/shape_manager/);
  assert.match(plan.command, /shape_manager/);
  assert.doesNotMatch(plan.command, /\.devseek-build/);
});

test('VerificationPlanner: C++ compile-only artifacts use stable project build directory', () => {
  const projectDir = path.join('/repo', 'code', 'library');
  const files = new Set([
    projectDir,
    path.join(projectDir, 'util.cpp'),
    path.join(projectDir, 'helper.cpp'),
  ]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: () => ['util.cpp', 'helper.cpp'],
    readFileSync: () => 'int util() { return 1; }\n',
  };

  const first = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['code/library/util.cpp'],
    fsNode,
  });
  const second = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['code/library/util.cpp'],
    fsNode,
  });

  assert.equal(first.kind, 'command');
  assert.equal(first.mode, 'compile-only');
  assert.match(first.command, /code\/library\/build\/devseek\/compile-only/);
  assert.doesNotMatch(first.command, /\/tmp\/deepseek_obj_/);
  assert.equal(first.command, second.command);
});

test('VerificationPlanner: standalone C++ print program plans compile-run evidence', () => {
  const projectDir = path.join('/repo', 'code');
  const source = path.join(projectDir, 'hello.cpp');
  const files = new Set(['/repo', projectDir, source]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: (p) => p === projectDir ? ['hello.cpp'] : [],
    readFileSync: (p) => p === source
      ? '#include <iostream>\nint main(){ std::cout << "下午好" << std::endl; return 0; }\n'
      : '',
  };

  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['code/hello.cpp'],
    requestPrompt: '编写一个C++程序，打印下午好',
    fsNode,
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-run');
  assert.equal(plan.reason, 'single-main-run-requested');
  assert.match(plan.command, /g\+\+/);
  assert.match(plan.command, /hello\.cpp/);
  assert.match(plan.command, /deepseek_auto_exec/);
});

test('VerificationPlanner: standalone C++ task respects explicit no-run constraint', () => {
  const projectDir = path.join('/repo', 'code');
  const source = path.join(projectDir, 'hello.cpp');
  const files = new Set(['/repo', projectDir, source]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: (p) => p === projectDir ? ['hello.cpp'] : [],
    readFileSync: (p) => p === source
      ? '#include <iostream>\nint main(){ std::cout << "下午好" << std::endl; return 0; }\n'
      : '',
  };

  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['code/hello.cpp'],
    requestPrompt: '编写一个C++程序，打印下午好，但不要运行。',
    fsNode,
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-only');
  assert.doesNotMatch(plan.command, /deepseek_auto_exec/);
});

test('VerificationPlanner: standalone Python CLI with stdin oracle plans syntax and runtime validation', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['tools/log_summary.py'],
    requestPrompt: '我在真实项目里需要一个小 Python 命令行工具 tools/log_summary.py。要求从 stdin 读取日志，统计 ERROR/WARN 数量并输出 ERROR=1 WARN=1；请实现并自测。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-run');
  assert.equal(plan.reason, 'python-syntax-and-run-validation');
  assert.match(plan.command, /PYTHONDONTWRITEBYTECODE=1 python3 -c/);
  assert.match(plan.command, /tools\/log_summary\.py/);
  assert.match(plan.command, /printf '%s\\n' 'INFO start' 'WARN slow' 'ERROR fail'/);
  assert.match(plan.command, /grep -q 'ERROR=1 WARN=1'/);
});

test('VerificationPlanner: standalone Python print program plans runtime validation', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['hello.py'],
    requestPrompt: '写一个 Python 程序，打印 hello everyday',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-run');
  assert.equal(plan.reason, 'python-syntax-and-run-validation');
  assert.match(plan.command, /hello\.py/);
  assert.match(plan.command, /PYTHONDONTWRITEBYTECODE=1 python3 '\/repo\/hello\.py' < \/dev\/null/);
});

test('VerificationPlanner: standalone Python task respects explicit no-run constraint', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['hello.py'],
    requestPrompt: '写一个 Python 程序，打印 hello everyday，但不要运行。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'python-syntax-check');
  assert.match(plan.command, /PYTHONDONTWRITEBYTECODE=1 python3 -c/);
  assert.doesNotMatch(plan.command, /< \/dev\/null/);
});

test('VerificationPlanner: blocks C++ validation when generated local include closure is incomplete', () => {
  const projectDir = path.join('/repo', 'generated', 'warranty');
  const files = new Set([
    projectDir,
    path.join(projectDir, 'worker.cpp'),
  ]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: () => ['worker.cpp'],
    readFileSync: (p) => p.endsWith('worker.cpp')
      ? '#include "warranty_data_collector.hpp"\nint worker() { return 0; }\n'
      : '',
  };

  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['generated/warranty/worker.cpp'],
    fsNode,
  });

  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.reason, 'cpp-dependency-closure-incomplete');
  assert.ok(plan.risks.some((risk) => /warranty_data_collector\.hpp/.test(risk)));
  assert.ok(plan.alternativeChecks.some((check) => /一次性补齐/.test(check)));
});

test('VerificationPlanner: project include roots are shared by dependency closure and compiler command', () => {
  const projectDir = path.join('/repo', 'src', 'oam', 'generated');
  const source = path.join(projectDir, 'warranty_worker.cpp');
  const sharedHeader = path.join('/repo', 'src', 'common', 'hdros2manger.h');
  const files = new Set([
    '/repo',
    path.join('/repo', 'src'),
    path.join('/repo', 'src', 'oam'),
    projectDir,
    source,
    sharedHeader,
  ]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: (p) => p === projectDir ? ['warranty_worker.cpp'] : [],
    readFileSync: (p) => p === source
      ? '#include "common/hdros2manger.h"\nint worker() { return 0; }\n'
      : '',
  };

  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['src/oam/generated/warranty_worker.cpp'],
    fsNode,
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-only');
  assert.match(plan.command, /-I '\/repo\/src'/);
  assert.match(plan.command, /warranty_worker\.cpp/);
});

test('VerificationPlanner: isolated formal project C++ artifacts get static audit when no build entry exists', () => {
  const artifactDir = path.join('/repo', 'src/oam/src/lifting/zc_maintenance/202607110150/src');
  const header = path.join(artifactDir, 'warranty_types.hpp');
  const files = new Set([
    '/repo',
    path.join('/repo', 'src'),
    path.join('/repo', 'src/oam'),
    path.join('/repo', 'src/oam/src'),
    path.join('/repo', 'src/oam/src/lifting'),
    path.join('/repo', 'src/oam/src/lifting/zc_maintenance'),
    path.join('/repo', 'src/oam/src/lifting/zc_maintenance/202607110150'),
    artifactDir,
    header,
  ]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: (p) => p === artifactDir ? ['warranty_types.hpp'] : [],
    readFileSync: (p) => p === header
      ? '#pragma once\nnamespace warranty { struct WarrantyStatus { int level; }; }\n'
      : '',
  };

  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['src/oam/src/lifting/zc_maintenance/202607110150/src/warranty_types.hpp'],
    requestPrompt: '正式项目内实现维保功能，产物隔离到时间戳目录 docs 和 src，不要修改正式源码，并完成自闭环验证。',
    fsNode,
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'cpp-static-artifact-audit');
  assert.match(plan.command, /grep -nE/);
  assert.match(plan.command, /warranty_types\.hpp/);
  assert.ok(plan.risks.some((risk) => /静态审计/.test(risk)));
});

test('VerificationPlanner: shell validation scripts run before isolated C++ artifact audit', () => {
  const artifactDir = path.join('/repo', 'src/oam/src/lifting/zc_maintenance/202607110235/src');
  const header = path.join(artifactDir, 'warranty_types.hpp');
  const script = path.join(artifactDir, 'test_warranty_integration.sh');
  const files = new Set([
    '/repo',
    path.join('/repo', 'src'),
    path.join('/repo', 'src/oam'),
    path.join('/repo', 'src/oam/src'),
    path.join('/repo', 'src/oam/src/lifting'),
    path.join('/repo', 'src/oam/src/lifting/zc_maintenance'),
    path.join('/repo', 'src/oam/src/lifting/zc_maintenance/202607110235'),
    artifactDir,
    header,
    script,
  ]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: (p) => p === artifactDir ? ['warranty_types.hpp', 'test_warranty_integration.sh'] : [],
    readFileSync: (p) => p === header
      ? '#pragma once\nnamespace warranty { struct WarrantyStatus { int level; }; }\n'
      : '#!/bin/bash\nset -euo pipefail\ng++ -fsyntax-only warranty_worker.cpp\n',
  };

  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: [
      'src/oam/src/lifting/zc_maintenance/202607110235/src/warranty_types.hpp',
      'src/oam/src/lifting/zc_maintenance/202607110235/src/test_warranty_integration.sh',
    ],
    requestPrompt: '正式项目内实现维保功能，产物隔离到时间戳目录 docs 和 src，不要修改正式源码，并完成自闭环验证。',
    fsNode,
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-run');
  assert.equal(plan.reason, 'validation-script-and-cpp-static-artifact-audit');
  assert.match(plan.command, /bash -n '\/repo\/src\/oam\/src\/lifting\/zc_maintenance\/202607110235\/src\/test_warranty_integration\.sh'/);
  assert.match(plan.command, /bash '\/repo\/src\/oam\/src\/lifting\/zc_maintenance\/202607110235\/src\/test_warranty_integration\.sh'/);
  assert.match(plan.command, /grep -nE/);
  assert.ok(plan.command.indexOf('bash -n') < plan.command.indexOf('grep -nE'));
  assert.ok(plan.command.indexOf("bash '/repo") < plan.command.indexOf('grep -nE'));
});

test('VerificationPlanner: shell-only validation artifacts execute after syntax checks', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['scripts/verify_warranty.sh'],
    requestPrompt: '创建验证脚本并运行自闭环验证。',
    fsNode: {
      existsSync: () => true,
      readdirSync: () => [],
      readFileSync: () => '#!/bin/bash\nset -euo pipefail\nnpm test\n',
    },
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'compile-run');
  assert.equal(plan.reason, 'shell-validation-script-run');
  assert.match(plan.command, /test -s '\/repo\/scripts\/verify_warranty\.sh' && bash -n '\/repo\/scripts\/verify_warranty\.sh'/);
  assert.match(plan.command, /bash '\/repo\/scripts\/verify_warranty\.sh'/);
});

test('VerificationPlanner: placeholder validation scripts cannot claim runtime evidence', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['scripts/test_warranty_placeholder.sh'],
    requestPrompt: '创建验证脚本并运行自闭环验证。',
    fsNode: {
      existsSync: () => true,
      readdirSync: () => [],
      readFileSync: () => '#!/bin/bash\nset -e\necho "TODO: add tests"\n',
    },
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'shell-script-syntax-check');
  assert.match(plan.command, /bash -n/);
  assert.doesNotMatch(plan.command, /&& bash '\/repo\/scripts\/test_warranty_placeholder\.sh'/);
});

test('VerificationPlanner: non-validation shell artifacts remain syntax-only', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['scripts/setup_environment.sh'],
    requestPrompt: '创建部署环境脚本，但不要执行，只检查语法。',
  });

  assert.equal(plan.kind, 'command');
  assert.equal(plan.mode, 'file-check');
  assert.equal(plan.reason, 'shell-script-syntax-check');
  assert.match(plan.command, /bash -n '\/repo\/scripts\/setup_environment\.sh'/);
  assert.doesNotMatch(plan.command, /&& bash '\/repo\/scripts\/setup_environment\.sh'/);
});

test('VerificationPlanner: blocks C++ validation when common std include is missing', () => {
  const projectDir = path.join('/repo', 'generated', 'warranty');
  const files = new Set([
    projectDir,
    path.join(projectDir, 'state.cpp'),
    path.join(projectDir, 'state.hpp'),
  ]);
  const fsNode = {
    existsSync: (p) => files.has(p),
    readdirSync: () => ['state.cpp', 'state.hpp'],
    readFileSync: (p) => p.endsWith('state.hpp')
      ? 'class Store; class State { std::unique_ptr<Store> store_; };\n'
      : '#include "state.hpp"\nint state() { return 0; }\n',
  };

  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['generated/warranty/state.cpp'],
    fsNode,
  });

  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.reason, 'cpp-dependency-closure-incomplete');
  assert.ok(plan.risks.some((risk) => /<memory>/.test(risk)));
});

test('VerificationPlanner: unknown targets without file-fact intent produce blocked plan with alternatives', () => {
  const plan = new VerificationPlanner().planWorkspaceChanges({
    rootFsPath: '/repo',
    changedPaths: ['docs/readme.md'],
  });

  assert.equal(plan.kind, 'blocked');
  assert.equal(plan.reason, 'no-auto-validation-target');
  assert.ok(plan.risks.some((risk) => /无法证明/.test(risk)));
  assert.ok(plan.alternativeChecks.some((check) => /人工/.test(check)));
});

console.log('\nVerification planner tests passed.\n');
