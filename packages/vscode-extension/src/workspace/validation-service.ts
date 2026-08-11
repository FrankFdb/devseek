import * as crypto from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';
import type {
  CodingBuildExecutionHostPort,
  CodingBuildOrchestrationReceipt,
  CodingBuildStepObservation,
  CodingVerifierCandidate,
  CodingVerifierSelectionDecision,
  CodingVerifierSelectionStep,
} from '@devseek-netai/shared';
import {
  VerificationPlanner,
  type VerificationPlannerFs,
} from '../app/verification-planner';
import { assessValidationOutputDiagnostics } from './validation-output-diagnostics';

export type ValidationMode = 'project' | 'syntax' | 'typecheck' | 'compile-only' | 'build' | 'test' | 'readback';

export interface ValidationCommandResult {
  ran: boolean;
  ok: boolean;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  output: string;
  cwd: string;
}

export interface AutoValidationResult extends ValidationCommandResult {
  status: 'passed' | 'failed' | 'blocked';
  mode?: ValidationMode;
  reason?: string;
  risks: string[];
  alternativeChecks: string[];
}

export interface ValidationCommandInvocation {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export type ValidationCommandRunner = (invocation: ValidationCommandInvocation) => Promise<ValidationCommandResult>;

export interface ValidationHostCheckResult {
  readonly status: CodingBuildStepObservation['status'];
  readonly summary: string;
  readonly evidenceRefs: readonly string[];
}

export interface ValidationServiceOptions {
  commandRunner?: ValidationCommandRunner;
  verificationPlanner?: Pick<VerificationPlanner, 'discoverCandidates'>;
  plannerFs?: VerificationPlannerFs;
  hostChecks?: Readonly<Record<string, () => Promise<ValidationHostCheckResult> | ValidationHostCheckResult>>;
}

export interface DiscoverWorkspaceVerificationInput {
  readonly rootFsPath: string;
  readonly changedPaths: readonly string[];
}

/** Trusted VS Code host adapter. Shared services own selection and settlement. */
export class ValidationService implements CodingBuildExecutionHostPort {
  private readonly commandRunner: ValidationCommandRunner;
  private readonly verificationPlanner: Pick<VerificationPlanner, 'discoverCandidates'>;
  private readonly plannerFs?: VerificationPlannerFs;
  private readonly hostChecks: ValidationServiceOptions['hostChecks'];

  constructor(options: ValidationServiceOptions = {}) {
    this.commandRunner = options.commandRunner ?? rejectMissingCommandAuthority;
    this.verificationPlanner = options.verificationPlanner ?? new VerificationPlanner();
    this.plannerFs = options.plannerFs;
    this.hostChecks = options.hostChecks;
  }

  discover(input: DiscoverWorkspaceVerificationInput): readonly CodingVerifierCandidate[] {
    return this.verificationPlanner.discoverCandidates({
      rootFsPath: input.rootFsPath,
      changedPaths: input.changedPaths,
      ...(this.plannerFs ? { fsNode: this.plannerFs } : {}),
    });
  }

  async execute(step: CodingVerifierSelectionStep): Promise<CodingBuildStepObservation> {
    if (step.invocation.kind === 'file-readback') return executeReadback(step);
    if (step.invocation.kind === 'host-check') return this.executeHostCheck(step);

    const before = snapshotProtectedPaths(step.cwd, step.scopePaths);
    const command = renderCommand(step.invocation.command, step.invocation.args);
    const result = await this.commandRunner({ command, cwd: step.cwd, timeoutMs: step.timeoutMs });
    const mutationPaths = changedProtectedPaths(before, snapshotProtectedPaths(step.cwd, step.scopePaths));
    const evidenceRefs = [
      ...step.evidenceRefs,
      `command:${command}:${result.ran ? `exit-${result.exitCode ?? 'unknown'}` : 'not-run'}`,
      ...(summarize(result.output) ? [`command-output:${summarize(result.output)}`] : []),
    ];
    if (!result.ran) {
      return observation(step, 'unavailable', result.output || 'Validation command was not executed.', {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        mutationPaths,
        evidenceRefs,
      });
    }
    if (result.exitCode === null) {
      return observation(step, 'indeterminate', result.output || 'Validation command returned no exit status.', {
        exitCode: null,
        stdout: result.stdout,
        stderr: result.stderr,
        mutationPaths,
        evidenceRefs,
      });
    }
    if (!result.ok || result.exitCode !== 0) {
      return observation(step, 'failed', summarize(result.output) || `${command} failed.`, {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        mutationPaths,
        evidenceRefs,
      });
    }
    const missing = (step.invocation.expectedStdoutIncludes ?? [])
      .filter(expected => !result.stdout.includes(expected));
    if (missing.length > 0) {
      return observation(step, 'failed', `${command} stdout missed ${missing.map(value => JSON.stringify(value)).join(', ')}.`, {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        mutationPaths,
        evidenceRefs,
      });
    }
    const outputDiagnostics = assessValidationOutputDiagnostics({
      cwd: step.cwd,
      scopePaths: step.scopePaths,
      output: [result.stdout, result.stderr, result.output].filter(Boolean).join('\n'),
    });
    if (outputDiagnostics.warnings.length > 0) {
      return observation(step, 'failed', outputDiagnostics.summary ?? `${command} emitted compiler warnings.`, {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        mutationPaths,
        evidenceRefs: [...evidenceRefs, ...outputDiagnostics.evidenceRefs],
      });
    }
    return observation(step, 'passed', summarize(result.output) || `${command} passed.`, {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      mutationPaths,
      evidenceRefs,
    });
  }

  private async executeHostCheck(step: CodingVerifierSelectionStep): Promise<CodingBuildStepObservation> {
    if (step.invocation.kind !== 'host-check') throw new Error('Expected a VS Code host check.');
    const check = this.hostChecks?.[step.invocation.checkId];
    if (!check) {
      return observation(step, 'unavailable', `Host check is unavailable: ${step.invocation.checkId}`, {
        mutationPaths: [],
        evidenceRefs: [`host-check:${step.invocation.checkId}:unavailable`],
      });
    }
    const result = await check();
    return observation(step, result.status, result.summary, {
      mutationPaths: [],
      evidenceRefs: result.evidenceRefs,
    });
  }
}

export function projectAutoValidationResult(
  selection: CodingVerifierSelectionDecision,
  receipt: CodingBuildOrchestrationReceipt,
): AutoValidationResult | null {
  if (selection.status === 'unavailable') return null;
  const processSteps = selection.steps.filter(step => step.invocation.kind === 'process');
  const observations = receipt.observations;
  const command = processSteps.map(step => renderCommand(
    step.invocation.kind === 'process' ? step.invocation.command : '',
    step.invocation.kind === 'process' ? step.invocation.args : [],
  )).filter(Boolean).join(' && ');
  const output = observations
    .map(item => [item.stdout, item.stderr, item.summary].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n');
  const status = receipt.status === 'passed'
    ? 'passed' as const
    : receipt.status === 'failed'
      ? 'failed' as const
      : 'blocked' as const;
  return {
    ran: observations.length > 0,
    ok: receipt.status === 'passed',
    status,
    command,
    exitCode: observations.at(-1)?.exitCode ?? null,
    stdout: observations.map(item => item.stdout ?? '').filter(Boolean).join('\n'),
    stderr: observations.map(item => item.stderr ?? '').filter(Boolean).join('\n'),
    output,
    cwd: selection.steps[0]?.cwd ?? selection.workspaceRoot,
    mode: validationMode(selection),
    reason: receipt.errorCode ?? `canonical-build-orchestration:${receipt.status}`,
    risks: receipt.status === 'passed'
      ? []
      : ['Canonical verification did not establish a passing result.'],
    alternativeChecks: receipt.status === 'unavailable'
      ? ['Configure devseek.verify.json or a project test script.']
      : [],
  };
}

function executeReadback(step: CodingVerifierSelectionStep): CodingBuildStepObservation {
  if (step.invocation.kind !== 'file-readback') throw new Error('Expected file readback.');
  const evidenceRefs: string[] = [];
  for (const relativePath of step.invocation.paths) {
    const absolutePath = resolveWorkspacePath(step.cwd, relativePath);
    try {
      const content = fs.readFileSync(absolutePath);
      evidenceRefs.push(`file:${relativePath}:sha256:${crypto.createHash('sha256').update(content).digest('hex')}`);
    } catch (error) {
      return observation(step, 'failed', `${relativePath} could not be read: ${errorMessage(error)}`, {
        mutationPaths: [],
        evidenceRefs: [`file:${relativePath}:unavailable`],
      });
    }
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
    summary: summary || `${step.id}: ${status}`,
    ...(detail.exitCode === undefined ? {} : { exitCode: detail.exitCode }),
    ...(detail.stdout === undefined ? {} : { stdout: detail.stdout }),
    ...(detail.stderr === undefined ? {} : { stderr: detail.stderr }),
    workspaceMutationPaths: detail.mutationPaths,
    evidenceRefs: detail.evidenceRefs,
  };
}

function snapshotProtectedPaths(root: string, paths: readonly string[]): ReadonlyMap<string, string> {
  const snapshot = new Map<string, string>();
  for (const relativePath of paths) {
    if (relativePath === 'workspace') continue;
    const absolutePath = resolveWorkspacePath(root, relativePath);
    try {
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) continue;
      const identity = stat.size > 1024 * 1024
        ? `${stat.size}:${stat.mtimeMs}`
        : crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
      snapshot.set(relativePath, identity);
    } catch {
      snapshot.set(relativePath, 'missing');
    }
  }
  return snapshot;
}

function changedProtectedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(path => before.get(path) !== after.get(path))
    .sort();
}

function resolveWorkspacePath(root: string, relativePath: string): string {
  const workspace = nodePath.resolve(root);
  const target = nodePath.resolve(workspace, relativePath);
  if (target !== workspace && !target.startsWith(`${workspace}${nodePath.sep}`)) {
    throw new Error(`Validation path escapes workspace: ${relativePath}`);
  }
  return target;
}

function validationMode(selection: CodingVerifierSelectionDecision): ValidationMode {
  const roles = selection.steps.map(step => step.role);
  if (roles.includes('test') || roles.includes('runtime')) return 'test';
  const compileOnlySteps = selection.steps.filter(isCompileOnlyStep);
  if (compileOnlySteps.length > 0
    && selection.steps.every(step => isCompileOnlyStep(step) || step.role === 'file-readback')) {
    return 'compile-only';
  }
  if (roles.includes('build')) return 'build';
  if (roles.includes('typecheck')) return 'typecheck';
  if (roles.includes('syntax') || roles.includes('lint')) return 'syntax';
  if (roles.every(role => role === 'file-readback')) return 'readback';
  return 'project';
}

function isCompileOnlyStep(step: CodingVerifierSelectionStep): boolean {
  return step.invocation.kind === 'process'
    && step.invocation.command === 'g++'
    && step.invocation.args.includes('-fsyntax-only');
}

function renderCommand(command: string, args: readonly string[]): string {
  return [command, ...args].map(renderCommandPart).join(' ');
}

function renderCommandPart(value: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/u.test(value)
    ? value
    : `'${value.replace(/'/gu, `'\\''`)}'`;
}

function summarize(value: string): string {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, 500);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function rejectMissingCommandAuthority(
  invocation: ValidationCommandInvocation,
): Promise<ValidationCommandResult> {
  const detail = 'Validation command authority is unavailable; command was not executed.';
  return {
    ran: false,
    ok: false,
    command: invocation.command,
    exitCode: null,
    stdout: '',
    stderr: detail,
    output: detail,
    cwd: invocation.cwd,
  };
}
