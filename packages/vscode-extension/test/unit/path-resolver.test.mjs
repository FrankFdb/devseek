/**
 * Unit tests for the shared workspace path resolver.
 *
 * Run: node --test test/unit/path-resolver.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/path-resolver.bundle.cjs');

execSync(
  `npx esbuild src/workspace/path-resolver.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

class Uri {
  constructor(fsPath) {
    this.fsPath = path.resolve(fsPath);
  }
  static file(fsPath) {
    return new Uri(fsPath);
  }
  static joinPath(base, ...segments) {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

const fakeWorkspace = {
  workspaceFolders: [],
  getWorkspaceFolder(uri) {
    return this.workspaceFolders.find((folder) => {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    });
  },
};

const fakeVscode = {
  Uri,
  workspace: fakeWorkspace,
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const {
  detectWorkspacePathScope,
  isGeneratedArtifactAllowedForPrompt,
  resolveGeneratedArtifactPathForPrompt,
  resolveWorkspaceWritePath,
} = req(bundlePath);

function createWorkspaceWithDuplicateShapeManager() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-path-resolver-'));
  const projectDir = path.join(root, 'code', 'shape_manager');
  const wrongDir = path.join(root, 'shape_manager');
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(wrongDir, { recursive: true });
  writeFileSync(path.join(projectDir, 'main.cpp'), 'int main() { return 0; }\n');
  writeFileSync(path.join(wrongDir, 'main.cpp'), 'int main() { return 99; }\n');
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];
  return { root, projectDir, wrongDir };
}

test('path-resolver: explicit code subdirectory beats same-name root directory for artifacts and tool writes', () => {
  const { root, projectDir, wrongDir } = createWorkspaceWithDuplicateShapeManager();
  try {
    const prompt = `请分析：${projectDir}中现代码，然后添加图形显示功能，输出信息同时，希望也画出图形的形状`;

    assert.equal(
      resolveGeneratedArtifactPathForPrompt('shape_manager/main.cpp', prompt),
      'code/shape_manager/main.cpp',
    );
    assert.equal(
      resolveGeneratedArtifactPathForPrompt('shape_manager/main.cpp', '请按既有代码修改', [projectDir]),
      'code/shape_manager/main.cpp',
    );

    const scopedWrite = resolveWorkspaceWritePath('shape_manager/main.cpp', {
      requestPrompt: prompt,
      content: '#include <iostream>\nint main() { return 0; }\n',
      workspaceRootFsPath: root,
      defaultWorkdir: wrongDir,
    });
    assert.equal(scopedWrite.relPath, 'code/shape_manager/main.cpp');
    assert.equal(scopedWrite.absPath, path.join(projectDir, 'main.cpp'));

    const bareWrite = resolveWorkspaceWritePath('main.cpp', {
      requestPrompt: prompt,
      content: '#include <iostream>\nint main() { return 0; }\n',
      workspaceRootFsPath: root,
      defaultWorkdir: wrongDir,
    });
    assert.equal(bareWrite.relPath, 'code/shape_manager/main.cpp');
    assert.equal(bareWrite.absPath, path.join(projectDir, 'main.cpp'));

    const scope = detectWorkspacePathScope(prompt);
    assert.equal(scope.promptDir, projectDir);
    assert.equal(scope.promptDirIsExplicit, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('path-resolver: continuation path hints anchor bare source filenames to prior project files', () => {
  const { root, projectDir } = createWorkspaceWithDuplicateShapeManager();
  try {
    const prompt = '可以通过鼠标动作，天空背景也添加了，天空背景能用夜晚色吗，同时所有图形能同时显示吗';

    const bareWrite = resolveWorkspaceWritePath('main.cpp', {
      requestPrompt: prompt,
      content: '#include <iostream>\nint main() { return 0; }\n',
      workspaceRootFsPath: root,
      defaultWorkdir: root,
      preferredAbsolutePaths: [path.join(projectDir, 'main.cpp')],
    });

    assert.equal(bareWrite.relPath, 'code/shape_manager/main.cpp');
    assert.equal(bareWrite.absPath, path.join(projectDir, 'main.cpp'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('path-resolver: build output cwd falls back to source project directory for source writes', () => {
  const { root, projectDir } = createWorkspaceWithDuplicateShapeManager();
  try {
    const buildBinDir = path.join(projectDir, 'build', 'bin');
    mkdirSync(buildBinDir, { recursive: true });

    const bareHeader = resolveWorkspaceWritePath('Cylinder.h', {
      requestPrompt: '请编译，执行，如果有编译错误，请修正',
      content: '#pragma once\nclass Cylinder {};\n',
      workspaceRootFsPath: root,
      defaultWorkdir: buildBinDir,
    });

    assert.equal(bareHeader.relPath, 'code/shape_manager/Cylinder.h');
    assert.equal(bareHeader.absPath, path.join(projectDir, 'Cylinder.h'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('path-resolver: source files cannot be explicitly written into build artifact directories', () => {
  const { root } = createWorkspaceWithDuplicateShapeManager();
  try {
    const drift = resolveWorkspaceWritePath('code/shape_manager/build/bin/Cylinder.h', {
      requestPrompt: '创建 Cylinder 头文件',
      content: '#pragma once\nclass Cylinder {};\n',
      workspaceRootFsPath: root,
    });

    assert.equal(drift, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('path-resolver: internal DevSeek logs are not used as active editor project anchors', () => {
  const { root } = createWorkspaceWithDuplicateShapeManager();
  try {
    const runLog = path.join(root, '.devseek', 'runs', '20260702-134456.log');
    mkdirSync(path.dirname(runLog), { recursive: true });
    writeFileSync(runLog, '{}\n');

    const scope = detectWorkspacePathScope('title乱码问题好像修正了，请重新编译执行确认', [], runLog);

    assert.equal(scope.promptDir, undefined);
    assert.equal(scope.promptDirIsExplicit, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('path-resolver: external active editor with project marker becomes task project root', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-open-workspace-'));
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'huida-uav-'));
  try {
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot), name: 'devseek', index: 0 }];
    mkdirSync(path.join(externalRoot, '.devseek'), { recursive: true });
    const activeDoc = path.join(
      externalRoot,
      'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
    );
    mkdirSync(path.dirname(activeDoc), { recursive: true });
    writeFileSync(activeDoc, '# warranty plan\n');

    const scope = detectWorkspacePathScope('基于当前需求文档为正式项目添加维保提醒功能', [], activeDoc);
    assert.equal(scope.promptDir, externalRoot);
    assert.equal(scope.promptDirIsExplicit, false);

    const write = resolveWorkspaceWritePath('src/oam/src/lifting/maintenance/maintenance_types.hpp', {
      requestPrompt: '基于当前需求文档为正式项目添加维保提醒功能',
      content: '#pragma once\nstruct SMaintenanceStat {};\n',
      preferredAbsolutePaths: [activeDoc],
    });
    assert.equal(write.relPath, 'src/oam/src/lifting/maintenance/maintenance_types.hpp');
    assert.equal(write.absPath, path.join(externalRoot, 'src/oam/src/lifting/maintenance/maintenance_types.hpp'));
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('path-resolver: absolute workspace write path is not re-anchored into docs scope', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-open-workspace-'));
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'huida-uav-'));
  try {
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot), name: 'devseek', index: 0 }];
    mkdirSync(path.join(externalRoot, '.devseek'), { recursive: true });
    const docsDir = path.join(externalRoot, 'src/oam/src/lifting/zc_maintenance/docs');
    const codeDir = path.join(externalRoot, 'src/oam/src/lifting/zc_maintenance');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(codeDir, { recursive: true });
    const requirementDoc = path.join(docsDir, 'uav-warranty-reminder-plan_v1.7.md');
    writeFileSync(requirementDoc, '# warranty plan\n');

    const prompt = [
      `基于需求文档：${requirementDoc}`,
      `并把代码实现创建于：${codeDir}目录下`,
      '先分析既有项目原来代码逻辑，再根据需求进行设计，最后实现代码。',
    ].join('\n');
    const absoluteTarget = path.join(codeDir, 'warranty_types.hpp');

    assert.equal(
      resolveGeneratedArtifactPathForPrompt(absoluteTarget, prompt, [requirementDoc]),
      'src/oam/src/lifting/zc_maintenance/warranty_types.hpp',
    );

    const write = resolveWorkspaceWritePath(absoluteTarget, {
      requestPrompt: prompt,
      content: '#pragma once\nstruct WarrantyStatus {};\n',
      workspaceRootFsPath: externalRoot,
      defaultWorkdir: docsDir,
      preferredAbsolutePaths: [requirementDoc],
    });

    assert.equal(write.relPath, 'src/oam/src/lifting/zc_maintenance/warranty_types.hpp');
    assert.equal(write.absPath, absoluteTarget);
    assert.equal(write.note, undefined);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('path-resolver: formal project advisory prompt uses project root instead of requirement doc directory', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-open-workspace-'));
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'huida-uav-'));
  try {
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot), name: 'devseek', index: 0 }];
    mkdirSync(path.join(externalRoot, '.devseek'), { recursive: true });
    const oldImplDir = path.join(externalRoot, 'src/oam/src/lifting/maintenance');
    const activeDoc = path.join(
      externalRoot,
      'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
    );
    mkdirSync(oldImplDir, { recursive: true });
    mkdirSync(path.dirname(activeDoc), { recursive: true });
    writeFileSync(activeDoc, '# warranty plan\n');

    const prompt = `原来实现的吊运维保功能：设计文档+代码等${oldImplDir} 下面是最新的维保提醒的需求： ${activeDoc} 请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议`;
    const scope = detectWorkspacePathScope(prompt, [], activeDoc);

    assert.equal(scope.promptDir, externalRoot);
    assert.equal(scope.promptDirIsExplicit, false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('path-resolver: formal advisory prompt stays at project root without active editor context', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-open-workspace-'));
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'huida-uav-'));
  try {
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot), name: 'devseek', index: 0 }];
    mkdirSync(path.join(externalRoot, '.devseek'), { recursive: true });
    const oldImplDir = path.join(externalRoot, 'src/oam/src/lifting/maintenance');
    const newRequirementDoc = path.join(
      externalRoot,
      'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
    );
    mkdirSync(oldImplDir, { recursive: true });
    mkdirSync(path.dirname(newRequirementDoc), { recursive: true });
    writeFileSync(newRequirementDoc, '# warranty plan\n');

    const prompt = `原来实现的吊运维保功能：设计文档+代码等${oldImplDir} 下面是最新的维保提醒的需求： ${newRequirementDoc} 请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议`;
    const scope = detectWorkspacePathScope(prompt, [], undefined);

    assert.equal(scope.promptDir, externalRoot);
    assert.equal(scope.promptDirIsExplicit, false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('path-resolver: advisory prompt infers external formal project root without markers', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-open-workspace-'));
  const externalRoot = mkdtempSync(path.join(tmpdir(), 'huida-uav-'));
  try {
    fakeWorkspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot), name: 'devseek', index: 0 }];
    const oldImplDir = path.join(externalRoot, 'src/oam/src/lifting/maintenance');
    const activeDoc = path.join(
      externalRoot,
      'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md',
    );
    mkdirSync(oldImplDir, { recursive: true });
    mkdirSync(path.dirname(activeDoc), { recursive: true });
    writeFileSync(activeDoc, '# warranty plan\n');

    const prompt = `原来实现的吊运维保功能：设计文档+代码等${oldImplDir} 下面是最新的维保提醒的需求： ${activeDoc} 请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议`;
    const scope = detectWorkspacePathScope(prompt, [], activeDoc);

    assert.equal(scope.promptDir, externalRoot);
    assert.equal(scope.promptDirIsExplicit, false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test('path-resolver: session scoped writes do not drift to code parent directory', () => {
  const { root, projectDir } = createWorkspaceWithDuplicateShapeManager();
  try {
    const prompt = `继续在 ${projectDir} 目录中修改，并编译运行看结果`;

    const parentCodeWrite = resolveWorkspaceWritePath('code/Circle.cpp', {
      requestPrompt: prompt,
      content: '#include "Circle.h"\n',
      workspaceRootFsPath: root,
      defaultWorkdir: root,
    });
    assert.equal(parentCodeWrite.relPath, 'code/shape_manager/Circle.cpp');
    assert.equal(parentCodeWrite.absPath, path.join(projectDir, 'Circle.cpp'));

    const noisyLabelWrite = resolveWorkspaceWritePath('code）：/Circle.h', {
      requestPrompt: prompt,
      content: '#ifndef CIRCLE_H\n#define CIRCLE_H\n#endif\n',
      workspaceRootFsPath: root,
      defaultWorkdir: root,
    });
    assert.equal(noisyLabelWrite.relPath, 'code/shape_manager/Circle.h');
    assert.equal(noisyLabelWrite.absPath, path.join(projectDir, 'Circle.h'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('path-resolver: current single-file prompt rejects stale history artifact names', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-path-single-target-'));
  const appDir = path.join(root, 'packages', 'vscode-extension', 'src', 'app');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(path.join(appDir, 'workflow-service.ts'), 'export const ok = true;\n');
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

  try {
    const prompt = '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题';
    assert.equal(
      resolveGeneratedArtifactPathForPrompt('workflow-service.ts', prompt),
      'packages/vscode-extension/src/app/workflow-service.ts',
    );
    assert.equal(
      isGeneratedArtifactAllowedForPrompt('packages/vscode-extension/src/app/workflow-service.ts', prompt),
      true,
    );
    assert.equal(
      isGeneratedArtifactAllowedForPrompt('packages/vscode-extension/src/app/Rectangle.cpp', prompt),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nShared path resolver tests passed.\n');
