import * as nodePath from 'path';
import * as fs from 'fs';
import {
  inspectCppDependencyClosure,
  planCppValidation,
  type CppDependencyClosureIssue,
  type CppValidationPolicy,
} from '../validation-planner';
import {
  routeTaskIntent,
  shouldRequireRuntimeValidationForRoute,
  shouldValidateNonCodeFilesForRoute,
} from '../task-intent-router';

export type ValidationMode = 'compile-only' | 'compile-link' | 'compile-run' | 'cmake' | 'file-check' | 'not-available';
export type VerificationBuildPlanStage =
  | 'focused'
  | 'affected-package'
  | 'architecture'
  | 'generated-artifacts'
  | 'full'
  | 'release'
  | 'runtime';
export type VerificationBuildPlanRole =
  | 'typecheck'
  | 'compile'
  | 'lint'
  | 'unit'
  | 'file-check'
  | 'architecture'
  | 'generated-artifacts'
  | 'package'
  | 'runtime'
  | 'e2e';
export type VerificationBuildPlanStepStatus = 'available' | 'missing';

export interface VerificationBuildPlanStep {
  id: string;
  stage: VerificationBuildPlanStage;
  role: VerificationBuildPlanRole;
  status: VerificationBuildPlanStepStatus;
  command: string;
  cwd: string;
  required: boolean;
  autoRun: boolean;
  reason: string;
}

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
  runCpp?: boolean;
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
  buildPlan: VerificationBuildPlanStep[];
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
  buildPlan: VerificationBuildPlanStep[];
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

const CODE_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.go', '.rs', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.scala',
  '.vue', '.svelte', '.sh', '.bash', '.zsh',
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

    const devSeekPlan = buildDevSeekPackageVerificationPlan(changedPaths, rootFsPath);
    if (devSeekPlan) return devSeekPlan;

    const shellScripts = changedPaths.filter(isShellScriptValidationPath);
    const cppRelated = changedPaths.filter(isCppRelatedValidationPath);
    if (cppRelated.length > 0) {
      const runCpp = input.runCpp ?? shouldRunCppValidation(input.requestPrompt || '');
      const closure = inspectCppDependencyClosure(
        cppRelated,
        rootFsPath,
        input.fsNode ?? this.defaultFsNode,
      );
      if (!closure.ok) {
        return blockedPlan(
          'cpp-dependency-closure-incomplete',
          closure.targetDir || rootFsPath,
          [
            'C/C++ 本地依赖闭包未满足，直接编译会进入逐个缺文件/缺头文件的反复修复循环。',
            ...formatCppDependencyClosureIssues(closure.issues),
          ],
          [
            '一次性补齐上述本地 include 文件或标准库 #include 后，再运行编译验证。',
            '如果这些 include 属于主项目既有目录，先读取并复用既有头文件路径，不要在测试目录里臆造替代接口。',
          ],
        );
      }

      const cppPlan = planCppValidation(
        cppRelated,
        rootFsPath,
        input.fsNode ?? this.defaultFsNode,
        input.cppValidationPolicy ?? 'conservative',
        { run: runCpp },
      );
      if (!cppPlan) {
        if (shouldRunIsolatedCppArtifactStaticAudit(cppRelated, input.requestPrompt || '')) {
          const shellValidation = buildShellScriptValidationCommand(
            shellScripts,
            rootFsPath,
            input.requestPrompt || '',
            input.fsNode ?? this.defaultFsNode,
          );
          return commandPlan({
            command: joinValidationCommands([
              shellValidation.command,
              buildCppStaticArtifactAuditCommand(cppRelated),
            ]),
            cwd: rootFsPath,
            timeoutMs: shellValidation.runsScript ? CPP_RUN_VALIDATION_TIMEOUT_MS : FILE_CHECK_VALIDATION_TIMEOUT_MS,
            mode: shellValidation.runsScript ? 'compile-run' : 'file-check',
            reason: shellValidation.runsScript
              ? 'validation-script-and-cpp-static-artifact-audit'
              : shellValidation.command
                ? 'shell-syntax-and-cpp-static-artifact-audit'
                : 'cpp-static-artifact-audit',
            risks: [
              '未识别到可执行的项目级 C/C++ 构建入口；本次仅对隔离交付目录中的源码草案做静态审计。',
              '静态审计不能证明正式主控工程的链接、运行时行为或硬件通讯链路正确。',
            ],
            alternativeChecks: [
              '在正式工程中接入 CMake/Make/构建脚本后重新运行项目级编译或单元测试。',
              '人工复核新增源码是否已在设计文档中映射到既有主入口、调度、通讯和接口边界。',
            ],
          });
        }
        return blockedPlan('cpp-validation-plan-unavailable', rootFsPath, [
          '未能识别可执行的 C/C++ 构建或编译入口。',
        ]);
      }

      const shellValidation = buildShellScriptValidationCommand(
        shellScripts,
        rootFsPath,
        input.requestPrompt || '',
        input.fsNode ?? this.defaultFsNode,
      );
      return commandPlan({
        command: joinValidationCommands([shellValidation.command, cppPlan.command]),
        cwd: cppPlan.cwd,
        timeoutMs: shellValidation.runsScript
          ? Math.max(CPP_RUN_VALIDATION_TIMEOUT_MS, timeoutForCppPlan(cppPlan.mode, runCpp))
          : timeoutForCppPlan(cppPlan.mode, runCpp),
        mode: shellValidation.runsScript ? 'compile-run' : cppPlan.mode,
        reason: shellValidation.runsScript
          ? `validation-script-and-${cppPlan.reason}`
          : shellValidation.command
            ? `shell-syntax-and-${cppPlan.reason}`
            : cppPlan.reason,
      });
    }

    if (shellScripts.length > 0) {
      const shellValidation = buildShellScriptValidationCommand(
        shellScripts,
        rootFsPath,
        input.requestPrompt || '',
        input.fsNode ?? this.defaultFsNode,
      );
      return commandPlan({
        command: shellValidation.command,
        cwd: rootFsPath,
        timeoutMs: shellValidation.runsScript ? CPP_RUN_VALIDATION_TIMEOUT_MS : FILE_CHECK_VALIDATION_TIMEOUT_MS,
        mode: shellValidation.runsScript ? 'compile-run' : 'file-check',
        reason: shellValidation.runsScript ? 'shell-validation-script-run' : 'shell-script-syntax-check',
      });
    }

    const pythonFiles = changedPaths.filter(isPythonValidationPath);
    if (pythonFiles.length > 0 && pythonFiles.length === changedPaths.length) {
      const runPython = shouldRunStandalonePythonValidation(pythonFiles, input.requestPrompt || '');
      return commandPlan({
        command: buildPythonValidationCommand(pythonFiles, rootFsPath, runPython, input.requestPrompt || ''),
        cwd: rootFsPath,
        timeoutMs: runPython ? CPP_RUN_VALIDATION_TIMEOUT_MS : FILE_CHECK_VALIDATION_TIMEOUT_MS,
        mode: runPython ? 'compile-run' : 'file-check',
        reason: runPython ? 'python-syntax-and-run-validation' : 'python-syntax-check',
        risks: runPython
          ? ['仅对隔离 Python CLI/工具执行本地语法与运行验证；不代表项目级集成测试已覆盖。']
          : ['Python 语法检查只验证文件可编译，不执行运行时逻辑。'],
        alternativeChecks: runPython
          ? []
          : ['如果需要证明运行时输出，请在请求中明确指定运行/自测方式，或补充项目级测试命令。'],
      });
    }

    const javaScriptFiles = changedPaths.filter(isJavaScriptValidationPath);
    if (javaScriptFiles.length > 0 && javaScriptFiles.length === changedPaths.length) {
      const runJavaScript = shouldRunStandaloneJavaScriptValidation(javaScriptFiles, input.requestPrompt || '');
      return commandPlan({
        command: buildJavaScriptValidationCommand(javaScriptFiles, rootFsPath, runJavaScript),
        cwd: rootFsPath,
        timeoutMs: runJavaScript ? CPP_RUN_VALIDATION_TIMEOUT_MS : FILE_CHECK_VALIDATION_TIMEOUT_MS,
        mode: runJavaScript ? 'compile-run' : 'file-check',
        reason: runJavaScript ? 'javascript-syntax-and-run-validation' : 'javascript-syntax-check',
        risks: runJavaScript
          ? ['仅对隔离 JavaScript probe 执行本地 Node 运行验证；不代表项目级集成测试已覆盖。']
          : ['node --check 只验证 JavaScript 语法，不执行运行时逻辑。'],
        alternativeChecks: runJavaScript
          ? []
          : ['如果需要证明运行时输出，请在隔离 probe/验证脚本中明确请求运行，或补充项目级测试命令。'],
      });
    }

    const requestPrompt = input.requestPrompt || '';
    const fileCheckPaths = changedPaths.filter((path) => isFileFactValidationPath(path, requestPrompt));
    if (fileCheckPaths.length > 0 && fileCheckPaths.length === changedPaths.length && shouldValidateNonCodeFiles(requestPrompt)) {
      return commandPlan({
        command: buildNonCodeFileCheckCommand(fileCheckPaths, requestPrompt),
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
  return shouldRequireRuntimeValidationForRoute(routeTaskIntent(prompt));
}

export function shouldValidateNonCodeFiles(prompt: string): boolean {
  const route = routeTaskIntent(prompt);
  return shouldValidateNonCodeFilesForRoute(route)
    || route.family === 'simple-file';
}

export function hasExplicitFileContentPrompt(prompt: string): boolean {
  return routeTaskIntent(prompt).simpleFile !== undefined;
}

export function buildNonCodeFileCheckCommand(changedPaths: string[], prompt = ''): string {
  const contentOracle = extractRequiredNonCodeContentOracle(prompt);
  return changedPaths
    .slice(0, 8)
    .map((relPath) => {
      const quoted = shellQuote(relPath);
      const checks = [
        `test -f ${quoted}`,
        `wc -c ${quoted}`,
        `sed -n '1,80p' ${quoted}`,
      ];
      if (contentOracle.lines.length > 0 && contentOracle.path === normalizeValidationPath(relPath)) {
        checks.push(...contentOracle.lines.map((line) => `grep -Fx -- ${shellQuote(line)} ${quoted}`));
      }
      return joinValidationCommands(checks);
    })
    .join(' && ');
}

function extractRequiredNonCodeContentOracle(prompt: string): { path: string; lines: string[] } {
  const route = routeTaskIntent(prompt);
  const simpleFile = route.simpleFile;
  if (!simpleFile) {
    return { path: '', lines: [] };
  }
  const lines = [...new Set(
    simpleFile.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length <= 200 && !line.includes('\0')),
  )].slice(0, 3);
  return {
    path: normalizeValidationPath(simpleFile.path),
    lines,
  };
}

function normalizeValidationPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

export function buildExtensionTypeCheckCommand(packageRelativePaths: string[]): string {
  const targets = [...new Set(packageRelativePaths)]
    .filter(Boolean)
    .slice(0, 12)
    .map((relPath) => shellQuote(relPath))
    .join(' ');
  return `npx tsc ${EXTENSION_TS_TYPECHECK_FLAGS} ${targets}`.trim();
}

interface DevSeekPackageChange {
  id: 'shared' | 'bridge' | 'cli' | 'vscode-extension';
  relRoot: string;
  cwd: string;
  changedPaths: string[];
}

const DEVSEEK_PACKAGE_ORDER: Array<Omit<DevSeekPackageChange, 'cwd' | 'changedPaths'>> = [
  { id: 'shared', relRoot: 'packages/shared' },
  { id: 'bridge', relRoot: 'packages/bridge' },
  { id: 'cli', relRoot: 'packages/cli' },
  { id: 'vscode-extension', relRoot: 'packages/vscode-extension' },
];

function buildDevSeekPackageVerificationPlan(
  changedPaths: string[],
  rootFsPath: string,
): VerificationPlan | undefined {
  const packageChanges = collectDevSeekPackageChanges(changedPaths, rootFsPath);
  if (packageChanges.length === 0) return undefined;

  const buildPlan: VerificationBuildPlanStep[] = [];
  for (const packageChange of packageChanges) {
    buildPlan.push(...buildDevSeekPackageAutoRunSteps(packageChange));
  }
  buildPlan.push(...buildDevSeekRepositoryFollowUpSteps(rootFsPath));

  const autoRunSteps = buildPlan.filter((step) => step.status === 'available' && step.autoRun && step.command);
  if (autoRunSteps.length === 0) {
    return blockedPlan('devseek-package-verification-command-missing', rootFsPath, [
      'DevSeek package 变更没有可执行的 build/test 命令，不能证明源码变更。',
    ]);
  }
  const cwd = commonStepCwd(autoRunSteps) ?? rootFsPath;
  return commandPlan({
    command: buildAutoRunCommand(autoRunSteps, cwd),
    cwd,
    timeoutMs: timeoutForBuildPlan(autoRunSteps),
    mode: autoRunSteps.some((step) => step.role === 'unit' || step.role === 'e2e' || step.role === 'runtime')
      ? 'compile-run'
      : 'compile-only',
    reason: reasonForDevSeekPackagePlan(packageChanges),
    risks: risksForBuildPlan(buildPlan),
    alternativeChecks: alternativesForBuildPlan(buildPlan),
    buildPlan,
  });
}

function collectDevSeekPackageChanges(changedPaths: string[], rootFsPath: string): DevSeekPackageChange[] {
  return DEVSEEK_PACKAGE_ORDER
    .map((entry) => {
      const prefix = `${entry.relRoot}/`;
      const packagePaths = changedPaths.filter((path) => normalizeValidationPath(path).startsWith(prefix));
      if (packagePaths.length === 0) return undefined;
      return {
        ...entry,
        cwd: nodePath.join(rootFsPath, ...entry.relRoot.split('/')),
        changedPaths: packagePaths,
      };
    })
    .filter((entry): entry is DevSeekPackageChange => entry !== undefined);
}

function buildDevSeekPackageAutoRunSteps(packageChange: DevSeekPackageChange): VerificationBuildPlanStep[] {
  if (packageChange.id === 'shared') {
    return [
      availableBuildStep('shared-build', 'focused', 'compile', 'npm run build', packageChange.cwd, true, 'shared-build'),
      availableBuildStep('shared-unit', 'affected-package', 'unit', 'npm test', packageChange.cwd, true, 'shared-unit'),
    ];
  }
  if (packageChange.id === 'bridge') {
    return [
      availableBuildStep('bridge-build', 'focused', 'compile', 'npm run build', packageChange.cwd, true, 'bridge-build'),
      availableBuildStep('bridge-unit', 'affected-package', 'unit', 'npm test', packageChange.cwd, true, 'bridge-unit'),
    ];
  }
  if (packageChange.id === 'cli') {
    return [
      availableBuildStep('cli-typecheck', 'focused', 'typecheck', 'npm run typecheck', packageChange.cwd, true, 'cli-typecheck'),
      availableBuildStep('cli-build', 'focused', 'compile', 'npm run build', packageChange.cwd, true, 'cli-build'),
      availableBuildStep('cli-unit', 'affected-package', 'unit', 'npm test', packageChange.cwd, true, 'cli-unit'),
    ];
  }

  const packageRelativePaths = packageChange.changedPaths
    .map((path) => normalizeValidationPath(path).slice(`${packageChange.relRoot}/`.length))
    .filter((path) => /\.(ts|tsx)$/i.test(path));
  const steps: VerificationBuildPlanStep[] = [];
  if (packageRelativePaths.length > 0) {
    steps.push(availableBuildStep(
      'vscode-extension-typecheck',
      'focused',
      'typecheck',
      buildExtensionTypeCheckCommand(packageRelativePaths),
      packageChange.cwd,
      true,
      'extension-ts-semantic-check',
    ));
  }
  steps.push(
    availableBuildStep(
      'vscode-extension-compile',
      'focused',
      'compile',
      'npm run compile',
      packageChange.cwd,
      true,
      'extension-compile',
    ),
    availableBuildStep(
      'vscode-extension-unit',
      'affected-package',
      'unit',
      'npm test',
      packageChange.cwd,
      true,
      'extension-unit',
    ),
  );
  return steps;
}

function buildDevSeekRepositoryFollowUpSteps(rootFsPath: string): VerificationBuildPlanStep[] {
  return [
    missingBuildStep('devseek-lint', 'focused', 'lint', rootFsPath, false, 'no-lint-script-registered'),
    availableBuildStep(
      'architecture-drift',
      'architecture',
      'architecture',
      'npm run verify:architecture-drift',
      rootFsPath,
      false,
      'architecture-drift',
    ),
    availableBuildStep(
      'generated-artifacts',
      'generated-artifacts',
      'generated-artifacts',
      'npm run verify:artifacts',
      rootFsPath,
      false,
      'generated-artifacts',
    ),
    availableBuildStep('phase12', 'full', 'unit', 'npm run verify:phase12', rootFsPath, false, 'phase12'),
    availableBuildStep(
      'debug-vsix-package',
      'release',
      'package',
      'npm run extension:package:debug',
      rootFsPath,
      false,
      'debug-vsix-package',
    ),
    availableBuildStep(
      'packaged-bridge',
      'release',
      'runtime',
      'npm run verify:packaged-bridge',
      rootFsPath,
      false,
      'packaged-bridge',
    ),
    availableBuildStep(
      'controlled-vsix-realistic-product',
      'runtime',
      'e2e',
      'npm run test:controlled-vsix --workspace=packages/vscode-extension -- --suite realistic-product --keep --keep-window --timeout-ms 240000',
      rootFsPath,
      false,
      'controlled-vsix-realistic-product',
    ),
  ];
}

function availableBuildStep(
  id: string,
  stage: VerificationBuildPlanStage,
  role: VerificationBuildPlanRole,
  command: string,
  cwd: string,
  autoRun: boolean,
  reason: string,
): VerificationBuildPlanStep {
  return {
    id,
    stage,
    role,
    status: 'available',
    command,
    cwd,
    required: true,
    autoRun,
    reason,
  };
}

function missingBuildStep(
  id: string,
  stage: VerificationBuildPlanStage,
  role: VerificationBuildPlanRole,
  cwd: string,
  required: boolean,
  reason: string,
): VerificationBuildPlanStep {
  return {
    id,
    stage,
    role,
    status: 'missing',
    command: '',
    cwd,
    required,
    autoRun: false,
    reason,
  };
}

function commonStepCwd(steps: VerificationBuildPlanStep[]): string | undefined {
  const first = steps[0]?.cwd;
  if (!first) return undefined;
  return steps.every((step) => step.cwd === first) ? first : undefined;
}

function buildAutoRunCommand(autoRunSteps: VerificationBuildPlanStep[], cwd: string): string {
  return joinValidationCommands(autoRunSteps.map((step) => {
    if (step.cwd === cwd) return step.command;
    return `(cd ${shellQuote(step.cwd)} && ${step.command})`;
  }));
}

function timeoutForBuildPlan(autoRunSteps: VerificationBuildPlanStep[]): number {
  return Math.max(PROJECT_BUILD_VALIDATION_TIMEOUT_MS, autoRunSteps.length * 30_000);
}

function reasonForDevSeekPackagePlan(packageChanges: DevSeekPackageChange[]): string {
  if (packageChanges.length > 1) return 'devseek-multi-package-build-plan';
  const only = packageChanges[0];
  if (only.id === 'bridge') return 'bridge-build-and-unit';
  if (only.id === 'shared') return 'shared-build-and-unit';
  if (only.id === 'cli') return 'cli-typecheck-build-and-unit';
  const hasTypeScript = only.changedPaths.some((path) => /\.(ts|tsx)$/i.test(path));
  return hasTypeScript ? 'extension-ts-semantic-check' : 'extension-build-and-unit';
}

function risksForBuildPlan(buildPlan: VerificationBuildPlanStep[]): string[] {
  const risks = buildPlan
    .filter((step) => step.status === 'missing' && step.required)
    .map((step) => `缺少必需验证命令 ${step.role}: ${step.reason}`);
  if (buildPlan.some((step) => step.status === 'missing' && !step.required)) {
    risks.push('当前仓库没有注册 lint 命令；不能把 lint 覆盖外推为已验证。');
  }
  if (buildPlan.some((step) => step.required && !step.autoRun)) {
    risks.push('自动验证只运行 focused/affected package steps；release、runtime 或 exact-VSIX 结论需要执行 buildPlan 中的非自动步骤。');
  }
  return risks;
}

function alternativesForBuildPlan(buildPlan: VerificationBuildPlanStep[]): string[] {
  return buildPlan
    .filter((step) => step.required && !step.autoRun && step.status === 'available')
    .map((step) => `需要发布或 runtime 结论时执行：${step.command}`);
}

function commandPlan(
  input: Omit<VerificationCommandPlan, 'kind' | 'risks' | 'alternativeChecks' | 'buildPlan'>
    & Partial<Pick<VerificationCommandPlan, 'risks' | 'alternativeChecks' | 'buildPlan'>>,
): VerificationCommandPlan {
  return {
    kind: 'command',
    risks: input.risks ?? [],
    alternativeChecks: input.alternativeChecks ?? [],
    buildPlan: input.buildPlan ?? [availableBuildStep(
      `primary-${input.reason}`,
      'focused',
      roleForValidationMode(input.mode),
      input.command,
      input.cwd,
      true,
      input.reason,
    )],
    ...input,
  };
}

function blockedPlan(reason: string, cwd: string, risks: string[], alternativeChecks: string[] = []): VerificationBlockedPlan {
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
      ...alternativeChecks,
      '人工检查变更文件内容是否符合用户请求。',
      '在项目规则中补充可自动运行的 build/test/lint 命令后重试。',
    ],
    buildPlan: [],
  };
}

function roleForValidationMode(mode: Exclude<ValidationMode, 'not-available'>): VerificationBuildPlanRole {
  if (mode === 'file-check') return 'file-check';
  if (mode === 'compile-run') return 'runtime';
  return 'compile';
}

function formatCppDependencyClosureIssues(issues: CppDependencyClosureIssue[]): string[] {
  return issues.slice(0, 12).map((issue) => {
    const file = issue.file.replace(/\\/g, '/');
    if (issue.reason === 'missing-local-include') {
      return `${file} 引用了 ${issue.include}，但未找到对应本地文件${issue.expectedPath ? `（期望：${issue.expectedPath.replace(/\\/g, '/')}）` : ''}。`;
    }
    return `${file} 使用了需要 ${issue.include} 的 std 类型/函数，但文件没有显式包含该标准库头文件。`;
  });
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

function isFileFactValidationPath(relPath: string, prompt: string): boolean {
  if (isNonCodeValidationPath(relPath)) return true;
  return hasExplicitFileContentPrompt(prompt)
    && !shouldRunCppValidation(prompt)
    && !isCodeValidationPath(relPath);
}

function isCodeValidationPath(relPath: string): boolean {
  return CODE_FILE_EXTENSIONS.has(nodePath.extname(relPath).toLowerCase())
    || nodePath.posix.basename(relPath.replace(/\\/g, '/')) === 'CMakeLists.txt';
}

function isShellScriptValidationPath(relPath: string): boolean {
  return /\.(?:sh|bash)$/i.test(relPath.replace(/\\/g, '/'));
}

function isJavaScriptValidationPath(relPath: string): boolean {
  return /\.(?:js|mjs|cjs)$/i.test(relPath.replace(/\\/g, '/'));
}

function isPythonValidationPath(relPath: string): boolean {
  return /\.py$/i.test(relPath.replace(/\\/g, '/'));
}

function isCppRelatedValidationPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return /\.(cpp|cc|cxx|c|h|hpp)$/i.test(normalized)
    || nodePath.posix.basename(normalized) === 'CMakeLists.txt';
}

function shouldRunStandaloneJavaScriptValidation(changedPaths: string[], prompt: string): boolean {
  const intentText = commandEvidenceIntentText(prompt);
  if (!/(?:运行|执行|启动|run|execute|看结果|输出效果|运行效果)/i.test(intentText)) return false;
  return changedPaths.length > 0 && changedPaths.every(isIsolatedJavaScriptRuntimePath);
}

function isIsolatedJavaScriptRuntimePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return normalized.startsWith('.devseek-')
    || /(?:^|\/)(?:probe|verify|validation|validate|test|check)[A-Za-z0-9_.-]*\.(?:js|mjs|cjs)$/i.test(normalized);
}

function buildJavaScriptValidationCommand(changedPaths: string[], rootFsPath: string, runJavaScript: boolean): string {
  return [...new Set(changedPaths.filter(isJavaScriptValidationPath))]
    .slice(0, 8)
    .map((relPath) => {
      const scriptPath = nodePath.isAbsolute(relPath) ? relPath : nodePath.join(rootFsPath, relPath);
      const quoted = shellQuote(scriptPath);
      return runJavaScript
        ? `test -s ${quoted} && node --check ${quoted} && node ${quoted}`
        : `test -s ${quoted} && node --check ${quoted}`;
    })
    .join(' && ');
}

function shouldRunStandalonePythonValidation(changedPaths: string[], prompt: string): boolean {
  if (hasExplicitNoRuntimeValidationConstraint(prompt)) return false;
  const intentText = commandEvidenceIntentText(prompt);
  if (!/(?:自测|测试|验证|运行|执行|启动|打印|输出|run|execute|test|verify|cli|命令行)/i.test(intentText)) {
    return false;
  }
  return changedPaths.length > 0 && changedPaths.every((relPath) =>
    isIsolatedPythonRuntimePath(relPath) || isPromptedStandalonePythonPath(relPath, intentText));
}

function hasExplicitNoRuntimeValidationConstraint(prompt: string): boolean {
  return /(?:不(?:要|用|需|需要|必|得|准|能)?|禁止|别|勿|请勿|未)\s*[^，,。；;\n]*(?:运行|执行|启动|测试|验证|自测|调试)[^，,。；;\n]*/i.test(prompt)
    || /(?:do\s+not|don't|never|no\s+need\s+to|without)\s+[^,.;\n]*(?:run|execute|start|test|verify|debug)[^,.;\n]*/i.test(prompt);
}

function isIsolatedPythonRuntimePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const basename = nodePath.posix.basename(normalized);
  return normalized.startsWith('.devseek-')
    || /^(?:tools|scripts|bin|cli)\//i.test(normalized)
    || /(?:^|[_-])(?:probe|verify|verification|validation|validate|test|check|cli|tool|script)(?:[_-]|\.)/i.test(basename);
}

function isPromptedStandalonePythonPath(relPath: string, intentText: string): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return !normalized.includes('/')
    && /(?:程序|脚本|工具|命令行|cli|program|script|tool)/i.test(intentText);
}

function buildPythonValidationCommand(
  changedPaths: string[],
  rootFsPath: string,
  runPython: boolean,
  prompt: string,
): string {
  return [...new Set(changedPaths.filter(isPythonValidationPath))]
    .slice(0, 8)
    .map((relPath) => {
      const scriptPath = nodePath.isAbsolute(relPath) ? relPath : nodePath.join(rootFsPath, relPath);
      const quoted = shellQuote(scriptPath);
      const syntaxCheck = [
        `test -s ${quoted}`,
        `PYTHONDONTWRITEBYTECODE=1 python3 -c ${shellQuote('import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"), sys.argv[1], "exec")')} ${quoted}`,
      ].join(' && ');
      if (!runPython) return syntaxCheck;
      return joinValidationCommands([
        syntaxCheck,
        buildPythonRuntimeValidationCommand(quoted, prompt),
      ]);
    })
    .join(' && ');
}

function buildPythonRuntimeValidationCommand(quotedScriptPath: string, prompt: string): string {
  if (shouldUseLogSummaryJsonStdinOracle(prompt)) {
    const stdinLines = ['INFO start', 'WARN slow', 'ERROR fail', 'WARN retry']
      .map((line) => shellQuote(line))
      .join(' ');
    return buildObservableStdinOracleCommand(stdinLines, quotedScriptPath, '{"ERROR": 1, "WARN": 2}');
  }
  if (shouldUseLogSummaryStdinOracle(prompt)) {
    const stdinLines = ['INFO start', 'WARN slow', 'ERROR fail']
      .map((line) => shellQuote(line))
      .join(' ');
    return buildObservableStdinOracleCommand(stdinLines, quotedScriptPath, 'ERROR=1 WARN=1');
  }
  return `PYTHONDONTWRITEBYTECODE=1 python3 ${quotedScriptPath} < /dev/null`;
}

function buildObservableStdinOracleCommand(
  quotedStdinLines: string,
  quotedScriptPath: string,
  expectedOutputLine: string,
): string {
  return [
    `printf '%s\\n' ${quotedStdinLines}`,
    `PYTHONDONTWRITEBYTECODE=1 python3 ${quotedScriptPath}`,
    `grep -Fx -- ${shellQuote(expectedOutputLine)}`,
  ].join(' | ');
}

function shouldUseLogSummaryJsonStdinOracle(prompt: string): boolean {
  const text = commandEvidenceIntentText(prompt);
  return /(?:stdin|标准输入|日志|log)/i.test(text)
    && /(?:json|JSON|JSON\s*对象|JSON\s*输出|一行\s*JSON)/i.test(text);
}

function shouldUseLogSummaryStdinOracle(prompt: string): boolean {
  const text = commandEvidenceIntentText(prompt);
  return /(?:stdin|标准输入|日志|log)/i.test(text)
    && /ERROR\s*=?\s*1/i.test(text)
    && /WARN\s*=?\s*1/i.test(text);
}

function commandEvidenceIntentText(text: string): string {
  return String(text || '')
    .replace(/(?:不(?:要|用|需|需要|必|得|准|能)?|禁止|别|勿|请勿|未)\s*[^，,。；;\n]*(?:编译|运行|执行|启动|测试|验证|调试|安装|联网|网络)[^，,。；;\n]*/gi, ' ')
    .replace(/(?:do\s+not|don't|never|no\s+need\s+to|without)\s+[^,.;\n]*(?:compile|build|run|execute|start|test|verify|debug|install|network)[^,.;\n]*/gi, ' ');
}

function shouldRunIsolatedCppArtifactStaticAudit(changedPaths: string[], prompt: string): boolean {
  const text = String(prompt || '');
  if (!/(?:既有|现有|原项目|大项目|正式项目|主控|平台|遥控器|参考.+模块|\/src\/|工程)/i.test(text)) {
    return false;
  }
  if (!/(?:隔离|时间戳|仿真|测试输出|不要修改正式源码|docs\s*和\s*src|docs\/.*src\/|src\s*和\s*docs)/i.test(text)) {
    return false;
  }
  return changedPaths.length > 0 && changedPaths.every((relPath) => {
    const normalized = relPath.replace(/\\/g, '/');
    return /\/\d{10,14}\/src\//.test('/' + normalized);
  });
}

function buildShellScriptSyntaxCheckCommand(changedPaths: string[], rootFsPath: string): string {
  return [...new Set(changedPaths.filter(isShellScriptValidationPath))]
    .slice(0, 8)
    .map((relPath) => {
      const scriptPath = nodePath.isAbsolute(relPath) ? relPath : nodePath.join(rootFsPath, relPath);
      const quoted = shellQuote(scriptPath);
      return `test -s ${quoted} && bash -n ${quoted}`;
    })
    .join(' && ');
}

function buildShellScriptValidationCommand(
  changedPaths: string[],
  rootFsPath: string,
  requestPrompt: string,
  fsNode: VerificationPlannerFs,
): { command: string; runsScript: boolean } {
  const scripts = [...new Set(changedPaths.filter(isShellScriptValidationPath))].slice(0, 8);
  const syntaxCommand = buildShellScriptSyntaxCheckCommand(scripts, rootFsPath);
  const runnableScripts = shouldRunGeneratedValidationScripts(requestPrompt)
    ? scripts.filter((relPath) => {
      if (!isRunnableValidationScriptPath(relPath)) return false;
      const scriptPath = nodePath.isAbsolute(relPath) ? relPath : nodePath.join(rootFsPath, relPath);
      return isSubstantiveValidationScript(scriptPath, fsNode);
    }).slice(0, 4)
    : [];
  const runCommand = runnableScripts
    .map((relPath) => {
      const scriptPath = nodePath.isAbsolute(relPath) ? relPath : nodePath.join(rootFsPath, relPath);
      return `bash ${shellQuote(scriptPath)}`;
    })
    .join(' && ');
  return {
    command: joinValidationCommands([syntaxCommand, runCommand]),
    runsScript: runnableScripts.length > 0,
  };
}

function isSubstantiveValidationScript(scriptPath: string, fsNode: VerificationPlannerFs): boolean {
  let content = '';
  try {
    content = fsNode.readFileSync(scriptPath, 'utf8');
  } catch {
    return false;
  }
  const executableText = content
    .split(/\r?\n/)
    .map(line => line.replace(/\s+#.*$/, '').trim())
    .filter(line => line && !line.startsWith('#'))
    .join('\n');
  const propagatesFailure = /(?:^|\n)\s*set\s+-[^\n]*e|\bset\s+-o\s+errexit\b|\|\|\s*(?:exit|return)\s+[1-9]|\bexit\s+[1-9]\b/i.test(executableText);
  const runsVerification = /(?:^|[;&|\n]\s*)(?:cmake|ctest|make|ninja|meson|bazel|g\+\+|gcc|clang\+\+|clang|pytest|python\s+-m\s+(?:pytest|unittest)|npm\s+(?:test|run\s+test)|pnpm\s+(?:test|run\s+test)|yarn\s+test|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test|\.\/[A-Za-z0-9_./-]+)(?:\s|$)/im.test(executableText);
  return propagatesFailure && runsVerification;
}

function shouldRunGeneratedValidationScripts(prompt: string): boolean {
  return /(?:自闭环|运行.{0,12}(?:验证|测试|脚本)|执行.{0,12}(?:验证|测试|脚本)|run.{0,12}(?:verification|validation|tests?|script)|execute.{0,12}(?:verification|validation|tests?|script))/i.test(prompt || '');
}

function isRunnableValidationScriptPath(filePath: string): boolean {
  const basename = nodePath.posix.basename(filePath.replace(/\\/g, '/'));
  return /(?:^|[_-])(?:verify|verification|validate|validation|test|tests|check)(?:[_-]|\.)/i.test(basename)
    || /^(?:verify|validate|test|check)[A-Za-z0-9_-]*\.(?:sh|bash)$/i.test(basename);
}

function joinValidationCommands(commands: string[]): string {
  return commands.filter(Boolean).join(' && ');
}

function buildCppStaticArtifactAuditCommand(changedPaths: string[]): string {
  const files = [...new Set(changedPaths.filter(isCppRelatedValidationPath))]
    .slice(0, 12)
    .map((relPath) => shellQuote(relPath));
  const fileList = files.join(' ');
  const forbiddenPattern = shellQuote('\\b(int|auto)[[:space:]]+main[[:space:]]*\\(|TODO:[[:space:]]*implement|Calling:|<TOOL_|待确认|待分配|待定|TBD|FIXME');
  const structurePattern = shellQuote('#pragma once|#include|namespace[[:space:]]+[A-Za-z_]|class[[:space:]]+[A-Za-z_]|struct[[:space:]]+[A-Za-z_]|enum([[:space:]]+class)?[[:space:]]+[A-Za-z_]|static_assert|assert[[:space:]]*\\(');
  return [
    `for f in ${fileList}; do test -s "$f"; done`,
    `! grep -nE ${forbiddenPattern} -- ${fileList}`,
    `grep -nE ${structurePattern} -- ${fileList} | head -n 20`,
  ].join(' && ');
}

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
