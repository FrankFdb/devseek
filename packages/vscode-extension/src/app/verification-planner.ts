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

function commandPlan(
  input: Omit<VerificationCommandPlan, 'kind' | 'risks' | 'alternativeChecks'>
    & Partial<Pick<VerificationCommandPlan, 'risks' | 'alternativeChecks'>>,
): VerificationCommandPlan {
  return {
    kind: 'command',
    risks: input.risks ?? [],
    alternativeChecks: input.alternativeChecks ?? [],
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
  };
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
