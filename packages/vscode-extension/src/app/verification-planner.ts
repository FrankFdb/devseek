import * as fs from 'fs';
import * as nodePath from 'path';
import type {
  CodingVerifierCandidate,
  CodingVerifierCandidateStep,
  CodingVerifierRole,
  CodingVerifierStrength,
} from '@devseek-netai/shared';

export const FILE_CHECK_VALIDATION_TIMEOUT_MS = 10_000;
export const PROCESS_VALIDATION_TIMEOUT_MS = 120_000;

const CONFIG_COMMANDS = new Set([
  'bash',
  'cmake',
  'ctest',
  'g++',
  'node',
  'npm',
  'npx',
  'python',
  'python3',
]);
const TEXT_FILE_RE = /\.(?:csv|html|ini|jsonc?|md|markdown|toml|tsv|txt|xml|ya?ml)$/iu;

export interface VerificationPlannerFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
}

export interface VerificationCapabilityDiscoveryInput {
  readonly rootFsPath: string;
  readonly changedPaths: readonly string[];
  readonly fsNode?: VerificationPlannerFs;
}

/** Discovers factual project verifier capabilities. It never interprets user prose. */
export class VerificationPlanner {
  private readonly defaultFsNode: VerificationPlannerFs = {
    existsSync: fs.existsSync,
    readFileSync: (path, encoding) => fs.readFileSync(path, encoding as BufferEncoding),
  };

  discoverCandidates(input: VerificationCapabilityDiscoveryInput): readonly CodingVerifierCandidate[] {
    const rootFsPath = nodePath.resolve(input.rootFsPath);
    const changedPaths = normalizeChangedPaths(input.changedPaths);
    if (changedPaths.length === 0) return [];
    const fsNode = input.fsNode ?? this.defaultFsNode;

    const configured = discoverConfiguredCandidate(rootFsPath, changedPaths, fsNode);
    if (configured) return [configured];

    const devseek = discoverDevSeekCandidate(rootFsPath, changedPaths, fsNode);
    if (devseek) return [devseek];

    const packageCandidate = discoverPackageCandidate(rootFsPath, changedPaths, fsNode);
    if (packageCandidate) return [packageCandidate];

    const cmakeCandidate = discoverCmakeCandidate(rootFsPath, changedPaths, fsNode);
    if (cmakeCandidate) return [cmakeCandidate];

    const languageCandidate = discoverLanguageCandidate(rootFsPath, changedPaths, fsNode);
    return languageCandidate ? [languageCandidate] : [];
  }
}

function discoverCmakeCandidate(
  root: string,
  changedPaths: readonly string[],
  fsNode: VerificationPlannerFs,
): CodingVerifierCandidate | undefined {
  if (!changedPaths.some(path => /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/iu.test(path))) return undefined;
  const cmakePath = nodePath.join(root, 'CMakeLists.txt');
  if (!fsNode.existsSync(cmakePath)) return undefined;

  const scriptPath = nodePath.join(root, 'test.sh');
  if (fsNode.existsSync(scriptPath)) {
    return candidate({
      id: 'vscode-cmake-project-test',
      source: 'CMakeLists.txt+test.sh',
      strength: 'test',
      priority: 12,
      scopePaths: changedPaths,
      steps: [processStep({
        id: 'vscode-cmake-test-script',
        role: 'test',
        cwd: root,
        command: './test.sh',
        args: [],
        timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
        evidenceRefs: ['config:CMakeLists.txt', 'script:test.sh'],
      })],
      evidenceRefs: ['config:CMakeLists.txt', 'script:test.sh'],
    });
  }

  const cmakeText = fsNode.readFileSync(cmakePath, 'utf8');
  const steps = [
    processStep({
      id: 'vscode-cmake-configure',
      role: 'build',
      cwd: root,
      command: 'cmake',
      args: ['-S', '.', '-B', 'build'],
      timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
      evidenceRefs: ['config:CMakeLists.txt'],
    }),
    processStep({
      id: 'vscode-cmake-build',
      role: 'build',
      cwd: root,
      command: 'cmake',
      args: ['--build', 'build'],
      timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
      evidenceRefs: ['config:CMakeLists.txt'],
    }),
  ];
  const hasCtest = /\b(?:enable_testing|add_test|include\s*\(\s*CTest\b)/iu.test(cmakeText);
  if (hasCtest) {
    steps.push(processStep({
      id: 'vscode-cmake-ctest',
      role: 'test',
      cwd: root,
      command: 'ctest',
      args: ['--test-dir', 'build', '--output-on-failure'],
      timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
      evidenceRefs: ['config:CMakeLists.txt#ctest'],
    }));
  }
  return candidate({
    id: 'vscode-cmake-project',
    source: 'CMakeLists.txt',
    strength: hasCtest ? 'test' : 'build',
    priority: 13,
    scopePaths: changedPaths,
    steps,
    evidenceRefs: ['config:CMakeLists.txt'],
  });
}

function discoverConfiguredCandidate(
  root: string,
  changedPaths: readonly string[],
  fsNode: VerificationPlannerFs,
): CodingVerifierCandidate | undefined {
  const configPath = nodePath.join(root, 'devseek.verify.json');
  if (!fsNode.existsSync(configPath)) return undefined;
  let document: unknown;
  try {
    document = JSON.parse(fsNode.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`devseek.verify.json is not valid JSON: ${errorMessage(error)}`);
  }
  if (!document || typeof document !== 'object') {
    throw new Error('devseek.verify.json must contain an object.');
  }
  const commands = (document as { commands?: unknown }).commands;
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('devseek.verify.json must include a non-empty commands array.');
  }
  const steps = commands.map((entry, index) => configuredStep(root, entry, index));
  return candidate({
    id: 'vscode-project-config',
    source: 'devseek.verify.json',
    strength: 'project-config',
    priority: 0,
    scopePaths: changedPaths,
    steps,
    evidenceRefs: ['config:devseek.verify.json'],
  });
}

function configuredStep(root: string, entry: unknown, index: number): CodingVerifierCandidateStep {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`devseek.verify.json command ${index + 1} must be an object.`);
  }
  const value = entry as {
    cmd?: unknown;
    args?: unknown;
    stdin?: unknown;
    expectStdoutIncludes?: unknown;
  };
  if (typeof value.cmd !== 'string' || !CONFIG_COMMANDS.has(value.cmd.trim())) {
    throw new Error(`devseek.verify.json command is not allowed: ${String(value.cmd ?? '')}`);
  }
  const args = stringArray(value.args, `command ${index + 1} args`);
  const expected = value.expectStdoutIncludes === undefined
    ? undefined
    : stringArray(
        Array.isArray(value.expectStdoutIncludes)
          ? value.expectStdoutIncludes
          : [value.expectStdoutIncludes],
        `command ${index + 1} expectStdoutIncludes`,
      );
  return processStep({
    id: `vscode-config-${index + 1}`,
    role: 'test',
    cwd: root,
    command: value.cmd.trim(),
    args,
    timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
    ...(typeof value.stdin === 'string' ? { stdin: value.stdin } : {}),
    ...(expected ? { expectedStdoutIncludes: expected } : {}),
    evidenceRefs: [`config:devseek.verify.json#command-${index + 1}`],
  });
}

function discoverDevSeekCandidate(
  root: string,
  changedPaths: readonly string[],
  fsNode: VerificationPlannerFs,
): CodingVerifierCandidate | undefined {
  const manifest = readJsonFile<{ name?: unknown }>(nodePath.join(root, 'package.json'), fsNode);
  if (manifest?.name !== 'devseek-netai') return undefined;
  const steps: CodingVerifierCandidateStep[] = [];
  const add = (id: string, role: CodingVerifierRole, args: readonly string[], timeoutMs = PROCESS_VALIDATION_TIMEOUT_MS) => {
    if (steps.some(step => step.id === id)) return;
    steps.push(processStep({
      id,
      role,
      cwd: root,
      command: 'npm',
      args,
      timeoutMs,
      evidenceRefs: [`manifest:package.json#scripts.${args[1] ?? args[0]}`],
    }));
  };
  if (changedPaths.some(path => path.startsWith('packages/shared/'))) {
    add('vscode-devseek-shared-build', 'build', ['run', 'shared:build']);
    add('vscode-devseek-shared-test', 'test', ['run', 'shared:test']);
  }
  if (changedPaths.some(path => path.startsWith('packages/bridge/'))) {
    add('vscode-devseek-bridge-build', 'build', ['run', 'bridge:build']);
    add('vscode-devseek-bridge-test', 'test', ['test', '--workspace=packages/bridge']);
  }
  if (changedPaths.some(path => path.startsWith('packages/cli/'))) {
    add('vscode-devseek-cli-typecheck', 'typecheck', ['run', 'cli:typecheck']);
    add('vscode-devseek-cli-test', 'test', ['run', 'cli:test']);
  }
  if (changedPaths.some(path => path.startsWith('packages/headless/'))) {
    add('vscode-devseek-headless-typecheck', 'typecheck', ['run', 'headless:typecheck']);
    add('vscode-devseek-headless-test', 'test', ['run', 'headless:test']);
  }
  if (changedPaths.some(path => path.startsWith('packages/vscode-extension/'))) {
    add('vscode-devseek-extension-compile', 'build', ['run', 'compile', '--workspace=packages/vscode-extension']);
    add('vscode-devseek-extension-test', 'test', ['test', '--workspace=packages/vscode-extension'], 180_000);
  }
  if (changedPaths.some(path => path.startsWith('scripts/'))) {
    add('vscode-devseek-architecture', 'test', ['run', 'verify:architecture-drift'], 180_000);
  }
  if (steps.length === 0) return undefined;
  return candidate({
    id: 'vscode-devseek-affected-project',
    source: 'package.json#devseek-affected-scripts',
    strength: 'test',
    priority: 5,
    scopePaths: ['workspace'],
    steps,
    evidenceRefs: ['config:package.json', 'project:devseek-netai'],
  });
}

function discoverPackageCandidate(
  root: string,
  changedPaths: readonly string[],
  fsNode: VerificationPlannerFs,
): CodingVerifierCandidate | undefined {
  if (!changedPaths.some(isJavaScriptFamily)) return undefined;
  const manifestPath = nodePath.join(root, 'package.json');
  const manifest = readJsonFile<{ scripts?: Record<string, unknown> }>(manifestPath, fsNode);
  if (!manifest) return undefined;
  const steps: CodingVerifierCandidateStep[] = [];
  if (typeof manifest.scripts?.build === 'string' && manifest.scripts.build.trim()) {
    steps.push(processStep({
      id: 'vscode-package-build',
      role: 'build',
      cwd: root,
      command: 'npm',
      args: ['run', 'build', '--silent'],
      timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
      evidenceRefs: ['manifest:package.json#scripts.build'],
    }));
  }
  if (typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim()) {
    steps.push(processStep({
      id: 'vscode-package-test',
      role: 'test',
      cwd: root,
      command: 'npm',
      args: ['test', '--silent'],
      timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
      evidenceRefs: ['manifest:package.json#scripts.test'],
    }));
  }
  if (steps.length === 0) return undefined;
  return candidate({
    id: 'vscode-package-verifier',
    source: 'package.json#scripts',
    strength: 'test',
    priority: 10,
    scopePaths: ['workspace'],
    steps,
    evidenceRefs: ['config:package.json'],
  });
}

function discoverLanguageCandidate(
  root: string,
  changedPaths: readonly string[],
  fsNode: VerificationPlannerFs,
): CodingVerifierCandidate | undefined {
  const steps: CodingVerifierCandidateStep[] = [];
  const languageGroups = {
    javascript: changedPaths.filter(path => /\.(?:cjs|js|mjs)$/iu.test(path)),
    typescript: changedPaths.filter(path => /\.(?:cts|mts|ts|tsx)$/iu.test(path)),
    python: changedPaths.filter(path => /\.py$/iu.test(path)),
    cpp: changedPaths.filter(path => /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/iu.test(path)),
    shell: changedPaths.filter(path => /\.(?:bash|sh)$/iu.test(path)),
  };
  const languagePaths = new Set(Object.values(languageGroups).flat());
  const groups = {
    ...languageGroups,
    text: changedPaths.filter(path => (
      TEXT_FILE_RE.test(path)
      || (!languagePaths.has(path) && isReadableTextFile(root, path, fsNode))
    )),
  };
  const recognized = Object.values(groups).flat();
  if (new Set(recognized).size !== changedPaths.length) return undefined;

  for (const [index, path] of groups.javascript.entries()) {
    steps.push(processStep({
      id: `vscode-javascript-syntax-${index + 1}`,
      role: 'syntax',
      cwd: root,
      command: 'node',
      args: ['--check', path],
      timeoutMs: FILE_CHECK_VALIDATION_TIMEOUT_MS,
      evidenceRefs: [`language:javascript:${path}`],
    }));
  }
  if (groups.typescript.length > 0) {
    steps.push(processStep({
      id: 'vscode-typescript-typecheck',
      role: 'typecheck',
      cwd: root,
      command: 'npx',
      args: ['--no-install', 'tsc', '--noEmit', '--pretty', 'false'],
      timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
      evidenceRefs: ['language:typescript', 'config:tsconfig'],
    }));
  }
  for (const [index, path] of groups.python.entries()) {
    steps.push(processStep({
      id: `vscode-python-syntax-${index + 1}`,
      role: 'syntax',
      cwd: root,
      command: 'python3',
      args: [
        '-c',
        'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
        path,
      ],
      timeoutMs: FILE_CHECK_VALIDATION_TIMEOUT_MS,
      evidenceRefs: [`language:python:${path}`],
    }));
  }
  if (groups.cpp.length > 0) {
    steps.push(processStep({
      id: 'vscode-cpp-syntax',
      role: 'build',
      cwd: root,
      command: 'g++',
      args: ['-std=c++17', '-fsyntax-only', ...groups.cpp],
      timeoutMs: PROCESS_VALIDATION_TIMEOUT_MS,
      evidenceRefs: ['language:cpp'],
    }));
  }
  for (const [index, path] of groups.shell.entries()) {
    steps.push(processStep({
      id: `vscode-shell-syntax-${index + 1}`,
      role: 'syntax',
      cwd: root,
      command: 'bash',
      args: ['-n', path],
      timeoutMs: FILE_CHECK_VALIDATION_TIMEOUT_MS,
      evidenceRefs: [`language:shell:${path}`],
    }));
  }
  const readbackPaths = groups.text.filter(path => !groups.javascript.includes(path));
  if (readbackPaths.length > 0) {
    steps.push({
      id: 'vscode-file-readback',
      role: 'file-readback',
      invocation: { kind: 'file-readback', paths: readbackPaths },
      cwd: root,
      timeoutMs: FILE_CHECK_VALIDATION_TIMEOUT_MS,
      outputPolicy: 'none',
      evidenceRefs: readbackPaths.map(path => `file:${path}`),
    });
  }
  if (steps.length === 0) return undefined;
  const strength: CodingVerifierStrength = steps.some(step => step.role === 'build' || step.role === 'typecheck')
    ? 'static'
    : steps.every(step => step.role === 'file-readback')
      ? 'readback'
      : 'static';
  return candidate({
    id: 'vscode-language-verifier',
    source: 'workspace-language-facts',
    strength,
    priority: 20,
    scopePaths: changedPaths,
    steps,
    evidenceRefs: ['verifier:language-facts'],
  });
}

function candidate(
  input: Omit<CodingVerifierCandidate, 'verifierIds' | 'workspaceAccess'>,
): CodingVerifierCandidate {
  return {
    ...input,
    verifierIds: ['project-verification'],
    workspaceAccess: 'read-only',
  };
}

function processStep(input: {
  id: string;
  role: CodingVerifierRole;
  cwd: string;
  command: string;
  args: readonly string[];
  timeoutMs: number;
  stdin?: string;
  expectedStdoutIncludes?: readonly string[];
  evidenceRefs: readonly string[];
}): CodingVerifierCandidateStep {
  return {
    id: input.id,
    role: input.role,
    invocation: {
      kind: 'process',
      command: input.command,
      args: input.args,
      ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
      ...(input.expectedStdoutIncludes === undefined
        ? {}
        : { expectedStdoutIncludes: input.expectedStdoutIncludes }),
    },
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    outputPolicy: 'ephemeral',
    evidenceRefs: input.evidenceRefs,
  };
}

function normalizeChangedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths
    .map(path => String(path || '').replace(/\\/gu, '/').replace(/^\.\//u, ''))
    .filter(path => path && path !== '..' && !path.startsWith('../') && !nodePath.isAbsolute(path)))]
    .sort();
}

function readJsonFile<T>(path: string, fsNode: VerificationPlannerFs): T | undefined {
  if (!fsNode.existsSync(path)) return undefined;
  try {
    return JSON.parse(fsNode.readFileSync(path, 'utf8')) as T;
  } catch (error) {
    throw new Error(`${nodePath.basename(path)} is not valid JSON: ${errorMessage(error)}`);
  }
}

function isJavaScriptFamily(path: string): boolean {
  return /\.(?:cjs|cts|js|jsx|json|mjs|mts|ts|tsx)$/iu.test(path);
}

function isReadableTextFile(root: string, path: string, fsNode: VerificationPlannerFs): boolean {
  const workspace = nodePath.resolve(root);
  const target = nodePath.resolve(workspace, path);
  if (target !== workspace && !target.startsWith(`${workspace}${nodePath.sep}`)) return false;
  try {
    const content = fsNode.readFileSync(target, 'utf8');
    if (content.includes('\u0000') || content.includes('\uFFFD')) return false;
    const controls = [...content].filter(character => {
      const code = character.charCodeAt(0);
      return code < 32 && character !== '\n' && character !== '\r' && character !== '\t';
    }).length;
    return controls <= Math.max(1, Math.floor(content.length * 0.01));
  } catch {
    return false;
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`devseek.verify.json ${label} must be strings.`);
  }
  return [...value] as string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
