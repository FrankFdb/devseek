import cp from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  type CodingBuildStepObservation,
  type CodingVerifierCandidate,
  type CodingVerifierCandidateStep,
  type CodingVerifierSelectionStep,
} from '@devseek-netai/shared';
import { resolveCliWorkspacePath } from './cli-workspace-path';

export interface CliValidationResult {
  passed: boolean;
  status?: 'passed' | 'failed' | 'unverified' | 'indeterminate';
  evidenceRefs: string[];
  summary: string;
}

const CONFIG_COMMANDS = new Set(['g++', 'node', 'npm', 'python', 'python3']);
const HOST_COMMANDS = new Set([...CONFIG_COMMANDS, 'bash']);
const LOCAL_VERIFIER_DIRECTORY = '.devseek/bin';
const SNAPSHOT_EXCLUDES = new Set([
  '.devseek',
  '.git',
  'build',
  'coverage',
  'dist',
  'node_modules',
  '__pycache__',
]);
const MAX_SNAPSHOT_FILES = 5_000;

/** Discovers verifier capabilities and executes selected steps; it never chooses acceptance coverage. */
export class CliVerificationHostAdapter {
  async discover(cwd: string, files: readonly string[]): Promise<readonly CodingVerifierCandidate[]> {
    const explicit = await discoverConfiguredVerifier(cwd);
    if (explicit) return [explicit];

    const packageVerifier = await discoverPackageVerifier(cwd, files);
    if (packageVerifier) return [packageVerifier];

    return discoverLanguageVerifier(cwd, files);
  }

  async execute(step: CodingVerifierSelectionStep): Promise<CodingBuildStepObservation> {
    if (step.invocation.kind === 'file-readback') return executeReadbackStep(step);
    if (step.invocation.kind === 'host-check') {
      throw new Error(`CLI verifier does not provide host check: ${step.invocation.checkId}`);
    }
    if (step.candidateId === 'cli-devseek-config') {
      ensureLocalVerifierDirectory(step.cwd);
    }
    const executable = resolveHostVerifierCommand(step.cwd, step.invocation.command);
    if (!executable) {
      throw new Error(`CLI verifier command is not allowed: ${step.invocation.command}`);
    }

    const before = snapshotWorkspace(step.cwd);
    const outputRoot = step.outputPolicy === 'ephemeral'
      ? await mkdtemp(path.join(os.tmpdir(), 'devseek-verification-'))
      : undefined;
    try {
      const result = cp.spawnSync(executable, [...step.invocation.args], {
        cwd: step.cwd,
        encoding: 'utf8',
        input: step.invocation.stdin ?? '',
        timeout: step.timeoutMs,
        env: {
          ...process.env,
          ...(outputRoot ? { DEVSEEK_VERIFICATION_OUTPUT_DIR: outputRoot } : {}),
        },
      });
      const stdout = result.stdout ?? '';
      const stderr = result.stderr ?? '';
      const mutationPaths = changedWorkspacePaths(before, snapshotWorkspace(step.cwd));
      const display = renderCommand(step.invocation.command, step.invocation.args);
      if (result.error || result.status === null) {
        return observation(step, 'indeterminate', result.error?.message ?? `${display} did not return an exit status`, {
          exitCode: result.status,
          stdout,
          stderr,
          mutationPaths,
          evidenceRefs: [processEvidenceRef(display, 'indeterminate', stdout || stderr, step.invocation.stdin)],
        });
      }
      if (result.status !== 0) {
        return observation(step, 'failed', summarizeProcessText(stderr || stdout) || `${display} exited ${result.status}`, {
          exitCode: result.status,
          stdout,
          stderr,
          mutationPaths,
          evidenceRefs: [processEvidenceRef(display, `exit-${result.status}`, stdout || stderr, step.invocation.stdin)],
        });
      }
      const missing = (step.invocation.expectedStdoutIncludes ?? []).filter(expected => !stdout.includes(expected));
      if (missing.length > 0) {
        return observation(step, 'failed', `${display} stdout missed ${missing.map(value => JSON.stringify(value)).join(', ')}`, {
          exitCode: 0,
          stdout,
          stderr,
          mutationPaths,
          evidenceRefs: [processEvidenceRef(display, 'stdout', stdout, step.invocation.stdin)],
        });
      }
      return observation(step, 'passed', `${display} passed.`, {
        exitCode: 0,
        stdout,
        stderr,
        mutationPaths,
        evidenceRefs: [processEvidenceRef(display, 'exit-0', stdout, step.invocation.stdin)],
      });
    } finally {
      if (outputRoot) await rm(outputRoot, { recursive: true, force: true });
    }
  }
}

interface DevseekVerifierConfig {
  commands?: DevseekVerifierCommand[];
  tests?: DevseekVerifierTest[];
}

interface DevseekVerifierCommand {
  cmd?: unknown;
  args?: unknown;
  stdin?: unknown;
  expectStdoutIncludes?: unknown;
}

interface DevseekVerifierTest {
  command?: unknown;
  stdin?: unknown;
  assert?: { stdout_contains?: unknown; stdoutContains?: unknown };
  expectStdoutIncludes?: unknown;
}

async function discoverConfiguredVerifier(cwd: string): Promise<CodingVerifierCandidate | undefined> {
  let raw: string;
  try {
    raw = await readFile(path.resolve(cwd, 'devseek.verify.json'), 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }

  let config: DevseekVerifierConfig;
  try {
    config = JSON.parse(raw) as DevseekVerifierConfig;
  } catch (error) {
    throw new Error(`devseek.verify.json is not valid JSON: ${errorMessage(error)}`);
  }
  const commands = normalizeVerifierConfig(config);
  if (commands.length === 0) {
    throw new Error('devseek.verify.json must include a non-empty commands array or compatible tests array.');
  }
  const steps = commands.map((command, index) => configuredStep(cwd, command, index));
  return verifierCandidate({
    id: 'cli-devseek-config',
    source: 'devseek.verify.json',
    strength: 'project-config',
    priority: 0,
    scopePaths: ['workspace'],
    steps,
    evidenceRefs: ['config:devseek.verify.json'],
  });
}

async function discoverPackageVerifier(
  cwd: string,
  files: readonly string[],
): Promise<CodingVerifierCandidate | undefined> {
  if (!files.some(file => /\.(?:cjs|js|jsx|json|mjs|ts|tsx)$/iu.test(file))) return undefined;
  let packageJson: { scripts?: Record<string, unknown> };
  try {
    packageJson = JSON.parse(await readFile(path.resolve(cwd, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw new Error(`package.json is not valid JSON: ${errorMessage(error)}`);
  }
  if (typeof packageJson.scripts?.test !== 'string' || !packageJson.scripts.test.trim()) return undefined;
  const steps: CodingVerifierCandidateStep[] = [];
  if (typeof packageJson.scripts.build === 'string' && packageJson.scripts.build.trim()) {
    steps.push(processStep('cli-package-build', 'build', cwd, 'npm', ['run', 'build', '--silent'], 120_000));
  }
  steps.push(processStep('cli-package-test', 'test', cwd, 'npm', ['test', '--silent'], 120_000));
  return verifierCandidate({
    id: 'cli-package-verifier',
    source: 'package.json#scripts.test',
    strength: 'test',
    priority: 10,
    scopePaths: ['workspace'],
    steps,
    evidenceRefs: ['config:package.json', 'script:test'],
  });
}

function discoverLanguageVerifier(cwd: string, files: readonly string[]): readonly CodingVerifierCandidate[] {
  const uniqueFiles = [...new Set(files.map(normalizeRelativePath).filter(Boolean))];
  if (uniqueFiles.length === 0) return [];
  if (uniqueFiles.every(file => /\.(?:js|mjs|cjs)$/iu.test(file))) {
    return [verifierCandidate({
      id: 'cli-javascript-syntax',
      source: 'language-runtime:javascript',
      strength: 'static',
      priority: 20,
      scopePaths: uniqueFiles,
      steps: uniqueFiles.map((file, index) => processStep(
        `cli-javascript-syntax-${index + 1}`,
        'syntax', cwd, 'node', ['--check', file], 30_000,
      )),
      evidenceRefs: ['language:javascript'],
    })];
  }
  if (uniqueFiles.every(file => /\.py$/iu.test(file))) {
    return [verifierCandidate({
      id: 'cli-python-syntax',
      source: 'language-runtime:python',
      strength: 'static',
      priority: 20,
      scopePaths: uniqueFiles,
      steps: uniqueFiles.map((file, index) => processStep(
        `cli-python-syntax-${index + 1}`,
        'syntax', cwd, 'python3', [
          '-c',
          'import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
          file,
        ], 30_000,
      )),
      evidenceRefs: ['language:python'],
    })];
  }
  if (uniqueFiles.every(file => /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/iu.test(file))) {
    return [verifierCandidate({
      id: 'cli-cpp-compile',
      source: 'language-runtime:cpp',
      strength: 'build',
      priority: 20,
      scopePaths: uniqueFiles,
      steps: [processStep(
        'cli-cpp-compile',
        'build', cwd, 'g++', ['-std=c++17', '-fsyntax-only', ...uniqueFiles], 60_000,
      )],
      evidenceRefs: ['language:cpp'],
    })];
  }
  if (uniqueFiles.every(file => /\.(?:bash|sh)$/iu.test(file))) {
    return [verifierCandidate({
      id: 'cli-shell-syntax',
      source: 'language-runtime:shell',
      strength: 'static',
      priority: 20,
      scopePaths: uniqueFiles,
      steps: uniqueFiles.map((file, index) => processStep(
        `cli-shell-syntax-${index + 1}`,
        'syntax', cwd, 'bash', ['-n', file], 30_000,
      )),
      evidenceRefs: ['language:shell'],
    })];
  }
  if (uniqueFiles.every(file => /\.(?:csv|html|ini|json|jsonc|md|markdown|toml|tsv|txt|xml|yaml|yml)$/iu.test(file))) {
    return [verifierCandidate({
      id: 'cli-file-readback',
      source: 'workspace-readback',
      strength: 'readback',
      priority: 30,
      scopePaths: uniqueFiles,
      steps: [{
        id: 'cli-file-readback',
        role: 'file-readback',
        invocation: { kind: 'file-readback', paths: uniqueFiles },
        cwd,
        timeoutMs: 10_000,
        outputPolicy: 'none',
        evidenceRefs: uniqueFiles.map(file => `file:${file}`),
      }],
      evidenceRefs: ['verifier:file-readback'],
    })];
  }
  return [];
}

function configuredStep(cwd: string, command: DevseekVerifierCommand, index: number): CodingVerifierCandidateStep {
  if (typeof command.cmd !== 'string' || !command.cmd.trim()) {
    throw new Error(`devseek.verify.json command ${index} must include cmd.`);
  }
  const executable = command.cmd.trim();
  if (!CONFIG_COMMANDS.has(executable) && !resolveLocalVerifierReference(cwd, executable)) {
    throw new Error(`devseek.verify.json command is not allowed: ${executable}`);
  }
  const args = arrayOfStrings(command.args, `devseek.verify.json command ${index} args`);
  const expected = command.expectStdoutIncludes === undefined
    ? undefined
    : arrayOfStrings(
        Array.isArray(command.expectStdoutIncludes)
          ? command.expectStdoutIncludes
          : [command.expectStdoutIncludes],
        `devseek.verify.json command ${index} expectStdoutIncludes`,
      );
  return {
    ...processStep(`cli-config-${index + 1}`, 'test', cwd, executable, args, 30_000),
    invocation: {
      kind: 'process',
      command: executable,
      args,
      ...(typeof command.stdin === 'string' ? { stdin: command.stdin } : {}),
      ...(expected ? { expectedStdoutIncludes: expected } : {}),
    },
    evidenceRefs: [`config:devseek.verify.json#command-${index + 1}`],
  };
}

function normalizeVerifierConfig(config: DevseekVerifierConfig): DevseekVerifierCommand[] {
  if (Array.isArray(config.commands) && config.commands.length > 0) return config.commands;
  if (!Array.isArray(config.tests)) return [];
  return config.tests.flatMap((test): DevseekVerifierCommand[] => {
    if (typeof test.command !== 'string' || !test.command.trim()) return [];
    const [cmd, ...args] = splitCommandLine(test.command);
    if (!cmd) return [];
    return [{
      cmd,
      args,
      stdin: test.stdin,
      expectStdoutIncludes: test.assert?.stdout_contains
        ?? test.assert?.stdoutContains
        ?? test.expectStdoutIncludes,
    }];
  });
}

function processStep(
  id: string,
  role: CodingVerifierCandidateStep['role'],
  cwd: string,
  command: string,
  args: readonly string[],
  timeoutMs: number,
): CodingVerifierCandidateStep {
  return {
    id,
    role,
    invocation: { kind: 'process', command, args },
    cwd: path.resolve(cwd),
    timeoutMs,
    outputPolicy: 'ephemeral',
    evidenceRefs: [`verifier-command:${renderCommand(command, args)}`],
  };
}

function verifierCandidate(
  input: Omit<CodingVerifierCandidate, 'verifierIds' | 'workspaceAccess'>,
): CodingVerifierCandidate {
  return {
    ...input,
    verifierIds: ['project-verification'],
    workspaceAccess: 'read-only',
  };
}

async function executeReadbackStep(step: CodingVerifierSelectionStep): Promise<CodingBuildStepObservation> {
  if (step.invocation.kind !== 'file-readback') throw new Error('CLI verifier expected file readback');
  const evidenceRefs: string[] = [];
  for (const relativePath of step.invocation.paths) {
    const target = resolveCliWorkspacePath(step.cwd, relativePath);
    let content: Buffer;
    try {
      content = await readFile(target);
    } catch (error) {
      return observation(step, 'failed', `${relativePath} could not be read: ${errorMessage(error)}`, {
        mutationPaths: [],
        evidenceRefs: [`file:${relativePath}:unavailable`],
      });
    }
    evidenceRefs.push(`file:${relativePath}:sha256:${crypto.createHash('sha256').update(content).digest('hex')}`);
  }
  return observation(step, 'passed', `${step.invocation.paths.length} file(s) read back.`, {
    mutationPaths: [],
    evidenceRefs,
  });
}

function observation(
  step: CodingVerifierSelectionStep,
  status: CodingBuildStepObservation['status'],
  summary: string,
  detail: {
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    mutationPaths: readonly string[];
    evidenceRefs: readonly string[];
  },
): CodingBuildStepObservation {
  return {
    stepId: step.id,
    status,
    summary,
    ...(detail.exitCode === undefined ? {} : { exitCode: detail.exitCode }),
    ...(detail.stdout === undefined ? {} : { stdout: detail.stdout }),
    ...(detail.stderr === undefined ? {} : { stderr: detail.stderr }),
    workspaceMutationPaths: detail.mutationPaths,
    evidenceRefs: detail.evidenceRefs,
  };
}

function snapshotWorkspace(root: string): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  const visit = (dir: string): void => {
    if (snapshot.size >= MAX_SNAPSHOT_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') && entry.name !== '.github') continue;
      if (SNAPSHOT_EXCLUDES.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) snapshot.set(relative, fileIdentity(absolute));
      if (snapshot.size >= MAX_SNAPSHOT_FILES) return;
    }
  };
  try {
    visit(path.resolve(root));
  } catch {
    return snapshot;
  }
  return snapshot;
}

function fileIdentity(filePath: string): string {
  const stat = fs.statSync(filePath);
  if (stat.size > 1024 * 1024) return `${stat.size}:${stat.mtimeMs}`;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function changedWorkspacePaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(file => before.get(file) !== after.get(file))
    .sort();
}

function arrayOfStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    if (value === undefined) return [];
    throw new Error(`${label} must be strings.`);
  }
  return value.map(item => {
    if (typeof item !== 'string') throw new Error(`${label} must be strings.`);
    return item;
  });
}

function splitCommandLine(commandLine: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of commandLine.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/u.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function normalizeRelativePath(value: string): string {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function renderCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(value => /^[A-Za-z0-9_./:=@+-]+$/u.test(value)
    ? value
    : JSON.stringify(value)).join(' ');
}

function resolveHostVerifierCommand(cwd: string, command: string): string | undefined {
  if (HOST_COMMANDS.has(command)) return command;
  const local = resolveLocalVerifierReference(cwd, command);
  if (!local) return undefined;
  try {
    const stat = fs.lstatSync(local);
    if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
    if (process.platform !== 'win32' && (stat.mode & 0o111) === 0) return undefined;
    return local;
  } catch {
    return undefined;
  }
}

function resolveLocalVerifierReference(cwd: string, command: string): string | undefined {
  const normalized = command.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!normalized.startsWith(`${LOCAL_VERIFIER_DIRECTORY}/`)) return undefined;
  try {
    const root = path.resolve(cwd, LOCAL_VERIFIER_DIRECTORY);
    const target = resolveCliWorkspacePath(cwd, normalized);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    if (managedVerifierPathContainsSymlink(cwd, target)) return undefined;
    return target;
  } catch {
    return undefined;
  }
}

function ensureLocalVerifierDirectory(cwd: string): void {
  const workspace = path.resolve(cwd);
  let current = workspace;
  for (const segment of LOCAL_VERIFIER_DIRECTORY.split('/')) {
    current = path.join(current, segment);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(`managed verifier directory is not a real directory: ${current}`);
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      fs.mkdirSync(current);
    }
  }

  const realWorkspace = fs.realpathSync(workspace);
  const realDirectory = fs.realpathSync(current);
  const relative = path.relative(realWorkspace, realDirectory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('managed verifier directory escaped the workspace');
  }
}

function managedVerifierPathContainsSymlink(cwd: string, target: string): boolean {
  const workspace = path.resolve(cwd);
  const relative = path.relative(workspace, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return true;

  let current = workspace;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      return true;
    }
  }
  return false;
}

function processEvidenceRef(
  display: string,
  outcome: string,
  output: string,
  stdin: string | undefined,
): string {
  const input = stdin === undefined
    ? ''
    : `:stdin-sha256:${crypto.createHash('sha256').update(stdin).digest('hex')}`;
  return `command:${display}${input}:${outcome}:${summarizeProcessText(output)}`;
}

function summarizeProcessText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
