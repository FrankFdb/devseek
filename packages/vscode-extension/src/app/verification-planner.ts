import * as nodePath from 'path';
import * as fs from 'fs';
import { planCppValidation, type CppValidationPolicy } from '../validation-planner';

export type ValidationMode = 'compile-only' | 'compile-link' | 'compile-run' | 'cmake' | 'file-check' | 'not-available';

export interface VerificationPlannerFs {
  existsSync: (path: string) => boolean;
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: string) => string;
}

export interface VerificationPlannerInput {
  changedPaths: string[];
  rootFsPath?: string;
  requestPrompt?: string;
  cppValidationPolicy?: CppValidationPolicy;
  fsNode?: VerificationPlannerFs;
}

export interface VerificationCommandPlan {
  kind: 'command';
  mode: Exclude<ValidationMode, 'not-available'>;
  reason: string;
  command: string;
  cwd: string;
  timeoutMs: number;
  risks: string[];
  alternativeChecks: string[];
}

export interface VerificationBlockedPlan {
  kind: 'blocked';
  mode: 'not-available';
  reason: string;
  command: '';
  cwd: string;
  timeoutMs: 0;
  risks: string[];
  alternativeChecks: string[];
}

export type VerificationPlan = VerificationCommandPlan | VerificationBlockedPlan;

export const CPP_COMPILE_VALIDATION_TIMEOUT_MS = 15_000;
export const CPP_RUN_VALIDATION_TIMEOUT_MS = 30_000;
export const PROJECT_BUILD_VALIDATION_TIMEOUT_MS = 120_000;
export const CMAKE_RUN_VALIDATION_TIMEOUT_MS = 30_000;
export const FILE_CHECK_VALIDATION_TIMEOUT_MS = 10_000;
const EXTENSION_TS_TYPECHECK_FLAGS = [
  '--noEmit',
  '--pretty false',
  '--target ES2020',
  '--module commonjs',
  '--lib ES2020',
  '--strict',
  '--esModuleInterop',
  '--skipLibCheck',
].join(' ');

const NON_CODE_FILE_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini',
  '.csv', '.tsv', '.log', '.xml', '.html', '.css',
]);

export class VerificationPlanner {
  private readonly defaultFsNode: VerificationPlannerFs = {
    existsSync: fs.existsSync,
    readdirSync: (path) => fs.readdirSync(path),
    readFileSync: (path, encoding) => fs.readFileSync(path, encoding as BufferEncoding),
  };

  planWorkspaceChanges(input: VerificationPlannerInput): VerificationPlan {
    const rootFsPath = input.rootFsPath || '';
    if (!rootFsPath) {
      return blockedPlan('no-workspace-root', '', [
        '没有工作区根目录，无法运行项目验证命令。',
      ]);
    }

    const changedPaths = [...new Set((input.changedPaths || []).filter(Boolean))];
    if (changedPaths.length === 0) {
      return blockedPlan('no-changed-paths', rootFsPath, [
        '没有可验证的变更路径，无法证明任务结果。',
      ]);
    }

    const hasBridge = changedPaths.some((path) => path.startsWith('packages/bridge/'));
    if (hasBridge) {
      return commandPlan({
        command: 'npm run build',
        cwd: nodePath.join(rootFsPath, 'packages', 'bridge'),
        timeoutMs: PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
        mode: 'compile-only',
        reason: 'bridge-change',
      });
    }

    const extensionPaths = changedPaths.filter((path) => path.startsWith('packages/vscode-extension/'));
    if (extensionPaths.length > 0) {
      const extensionTsPaths = extensionPaths
        .map((path) => path.slice('packages/vscode-extension/'.length))
        .filter((path) => /\.(ts|tsx)$/i.test(path));
      if (extensionTsPaths.length > 0) {
        return commandPlan({
          command: `${buildExtensionTypeCheckCommand(extensionTsPaths)} && npm run compile`,
          cwd: nodePath.join(rootFsPath, 'packages', 'vscode-extension'),
          timeoutMs: PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
          mode: 'compile-only',
          reason: 'extension-ts-semantic-check',
        });
      }
      return commandPlan({
        command: 'npm run compile',
        cwd: nodePath.join(rootFsPath, 'packages', 'vscode-extension'),
        timeoutMs: PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
        mode: 'compile-only',
        reason: 'extension-change',
      });
    }

    const cppRelated = changedPaths.filter((path) => /\.(cpp|cc|cxx|c|h|hpp)$/i.test(path));
    if (cppRelated.length > 0) {
      const cppPlan = planCppValidation(
        cppRelated,
        rootFsPath,
        input.fsNode ?? this.defaultFsNode,
        input.cppValidationPolicy ?? 'conservative',
        { run: shouldRunCppValidation(input.requestPrompt || '') },
      );
      if (!cppPlan) {
        return blockedPlan('cpp-validation-plan-unavailable', rootFsPath, [
          '未能识别可执行的 C/C++ 构建或编译入口。',
        ]);
      }

      return commandPlan({
        command: cppPlan.command,
        cwd: cppPlan.cwd,
        timeoutMs: timeoutForCppPlan(cppPlan.mode, shouldRunCppValidation(input.requestPrompt || '')),
        mode: cppPlan.mode,
        reason: cppPlan.reason,
      });
    }

    const fileCheckPaths = changedPaths.filter((path) => isNonCodeValidationPath(path));
    if (fileCheckPaths.length > 0 && shouldValidateNonCodeFiles(input.requestPrompt || '')) {
      return commandPlan({
        command: buildNonCodeFileCheckCommand(fileCheckPaths),
        cwd: rootFsPath,
        timeoutMs: FILE_CHECK_VALIDATION_TIMEOUT_MS,
        mode: 'file-check',
        reason: 'non-code-file-validation',
      });
    }

    return blockedPlan('no-auto-validation-target', rootFsPath, [
      '未识别到可自动运行的编译、测试或文件检查目标。',
    ]);
  }
}

export function shouldRunCppValidation(prompt: string): boolean {
  return /(?:运行|执行|启动|测试|test|run|execute|看结果|输出效果|运行效果)/i.test(prompt || '');
}

export function shouldValidateNonCodeFiles(prompt: string): boolean {
  return /(?:创建|新建|生成|写|写入|更新|添加|修改|验证|确认|检查|显示|读取|是否存在|内容|create|write|update|add|verify|check|show|read|display|exist)/i.test(prompt || '');
}

export function buildNonCodeFileCheckCommand(changedPaths: string[]): string {
  return changedPaths
    .slice(0, 8)
    .map((relPath) => {
      const quoted = shellQuote(relPath);
      return `test -f ${quoted} && wc -c ${quoted} && sed -n '1,80p' ${quoted}`;
    })
    .join(' && ');
}

export function buildExtensionTypeCheckCommand(packageRelativePaths: string[]): string {
  const targets = [...new Set(packageRelativePaths)]
    .filter(Boolean)
    .slice(0, 12)
    .map((relPath) => shellQuote(relPath))
    .join(' ');
  return `npx tsc ${EXTENSION_TS_TYPECHECK_FLAGS} ${targets}`.trim();
}

function commandPlan(input: Omit<VerificationCommandPlan, 'kind' | 'risks' | 'alternativeChecks'>): VerificationCommandPlan {
  return {
    kind: 'command',
    risks: [],
    alternativeChecks: [],
    ...input,
  };
}

function blockedPlan(reason: string, cwd: string, risks: string[]): VerificationBlockedPlan {
  return {
    kind: 'blocked',
    mode: 'not-available',
    reason,
    command: '',
    cwd,
    timeoutMs: 0,
    risks: [
      ...risks,
      '无法证明变更后的运行时行为正确，不能把 QualityGate 标记为通过。',
    ],
    alternativeChecks: [
      '人工检查变更文件内容是否符合用户请求。',
      '在项目规则中补充可自动运行的 build/test/lint 命令后重试。',
    ],
  };
}

function timeoutForCppPlan(mode: Exclude<ValidationMode, 'file-check' | 'not-available'>, shouldRun: boolean): number {
  if (mode === 'compile-run') return CPP_RUN_VALIDATION_TIMEOUT_MS;
  if (mode === 'cmake' && shouldRun) return CMAKE_RUN_VALIDATION_TIMEOUT_MS;
  if (mode === 'cmake') return PROJECT_BUILD_VALIDATION_TIMEOUT_MS;
  return CPP_COMPILE_VALIDATION_TIMEOUT_MS;
}

function isNonCodeValidationPath(relPath: string): boolean {
  return NON_CODE_FILE_EXTENSIONS.has(nodePath.extname(relPath).toLowerCase());
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
