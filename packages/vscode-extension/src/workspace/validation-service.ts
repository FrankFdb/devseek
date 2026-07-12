import * as fs from 'fs';
import type { CppValidationPolicy } from '../validation-planner';
import {
  CPP_COMPILE_VALIDATION_TIMEOUT_MS,
  CPP_RUN_VALIDATION_TIMEOUT_MS,
  CMAKE_RUN_VALIDATION_TIMEOUT_MS,
  FILE_CHECK_VALIDATION_TIMEOUT_MS,
  PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
  VerificationPlanner,
  type ValidationMode,
  type VerificationPlan,
} from '../app/verification-planner';

export {
  CPP_COMPILE_VALIDATION_TIMEOUT_MS,
  CPP_RUN_VALIDATION_TIMEOUT_MS,
  CMAKE_RUN_VALIDATION_TIMEOUT_MS,
  FILE_CHECK_VALIDATION_TIMEOUT_MS,
  PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
  type ValidationMode,
};

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
  plan?: VerificationPlan;
  risks: string[];
  alternativeChecks: string[];
}

export interface ValidationCommandInvocation {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export type ValidationCommandRunner = (invocation: ValidationCommandInvocation) => Promise<ValidationCommandResult>;

export interface ValidationServiceOptions {
  commandRunner?: ValidationCommandRunner;
  verificationPlanner?: Pick<VerificationPlanner, 'planWorkspaceChanges'>;
  fsNode?: {
    existsSync: (path: string) => boolean;
    readdirSync: (path: string) => string[];
    readFileSync: (path: string, encoding: string) => string;
  };
}

export interface ValidateWorkspaceChangesInput {
  changedPaths: string[];
  rootFsPath?: string;
  requestPrompt?: string;
  cppValidationPolicy?: CppValidationPolicy;
  runCpp?: boolean;
}

export class ValidationService {
  private readonly commandRunner: ValidationCommandRunner;
  private readonly verificationPlanner: Pick<VerificationPlanner, 'planWorkspaceChanges'>;
  private readonly fsNode: NonNullable<ValidationServiceOptions['fsNode']>;

  constructor(options: ValidationServiceOptions = {}) {
    // ValidationService owns planning and result semantics, not process authority.
    // Product callers must inject the evidence-aware terminal boundary. Missing
    // authority fails closed so a new call site cannot silently bypass evidence.
    this.commandRunner = options.commandRunner ?? rejectMissingCommandAuthority;
    this.verificationPlanner = options.verificationPlanner ?? new VerificationPlanner();
    this.fsNode = options.fsNode ?? {
      existsSync: fs.existsSync,
      readdirSync: (path) => fs.readdirSync(path),
      readFileSync: (path, encoding) => fs.readFileSync(path, encoding as BufferEncoding),
    };
  }

  async validateWorkspaceChanges(input: ValidateWorkspaceChangesInput): Promise<AutoValidationResult | null> {
    const plan = this.verificationPlanner.planWorkspaceChanges({
      rootFsPath: input.rootFsPath,
      changedPaths: input.changedPaths,
      requestPrompt: input.requestPrompt,
      cppValidationPolicy: input.cppValidationPolicy,
      runCpp: input.runCpp,
      fsNode: this.fsNode,
    });
    if (plan.kind === 'blocked') return blockedValidationEvidence(plan);

    const result = await this.runCommand({
      command: plan.command,
      cwd: plan.cwd,
      timeoutMs: plan.timeoutMs,
    });
    return {
      ...result,
      status: result.ok ? 'passed' : 'failed',
      mode: plan.mode,
      reason: plan.reason,
      plan,
      risks: result.ok ? [] : ['自动验证命令失败，不能把 QualityGate 标记为通过。'],
      alternativeChecks: [],
    };
  }

  private async runCommand(invocation: ValidationCommandInvocation): Promise<ValidationCommandResult> {
    return this.commandRunner(invocation);
  }
}

function blockedValidationEvidence(plan: VerificationPlan): AutoValidationResult {
  return {
    ran: false,
    ok: false,
    status: 'blocked',
    command: '',
    exitCode: null,
    stdout: '',
    stderr: '',
    output: [
      `未执行自动验证: ${plan.reason}`,
      ...plan.risks,
      '替代检查:',
      ...plan.alternativeChecks.map((check) => `- ${check}`),
    ].join('\n'),
    cwd: plan.cwd,
    mode: plan.mode,
    reason: plan.reason,
    plan,
    risks: plan.risks,
    alternativeChecks: plan.alternativeChecks,
  };
}

async function rejectMissingCommandAuthority(
  invocation: ValidationCommandInvocation,
): Promise<ValidationCommandResult> {
  const detail = '未配置验证命令授权边界，命令未执行。';
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
