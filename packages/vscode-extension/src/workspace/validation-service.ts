import * as fs from 'fs';
import { exec, type ExecException } from 'child_process';
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
}

export class ValidationService {
  private readonly commandRunner: ValidationCommandRunner;
  private readonly verificationPlanner: Pick<VerificationPlanner, 'planWorkspaceChanges'>;
  private readonly fsNode: NonNullable<ValidationServiceOptions['fsNode']>;

  constructor(options: ValidationServiceOptions = {}) {
    this.commandRunner = options.commandRunner ?? runShell;
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

async function runShell(invocation: ValidationCommandInvocation): Promise<ValidationCommandResult> {
  return new Promise((resolve) => {
    exec(invocation.command, { cwd: invocation.cwd, timeout: invocation.timeoutMs, encoding: 'utf8' }, (
      error: ExecException | null,
      stdout: string,
      stderr: string,
    ) => {
      const timedOut = !!error && (error.killed || /timed out|timeout/i.test(error.message || ''));
      const exitCode = !error ? 0 : timedOut ? 124 : (typeof error.code === 'number' ? error.code : null);
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      resolve({
        ran: true,
        ok: !error,
        command: invocation.command,
        exitCode,
        output: timedOut
          ? [output, `[DevSeek] 命令超时，已终止（timeout ${invocation.timeoutMs}ms）。这通常表示程序仍在运行、等待输入或构建卡住；自动验证按失败处理。`].filter(Boolean).join('\n')
          : output,
        cwd: invocation.cwd,
      });
    });
  });
}
