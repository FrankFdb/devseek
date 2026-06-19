import * as nodePath from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { planCppValidation, type CppValidationPolicy } from '../validation-planner';

export type ValidationMode = 'compile-only' | 'compile-link' | 'compile-run' | 'cmake';

export interface AutoValidationResult {
  ran: boolean;
  ok: boolean;
  command: string;
  exitCode: number | null;
  output: string;
  cwd: string;
  mode?: ValidationMode;
  reason?: string;
}

export interface ValidationCommandInvocation {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export type ValidationCommandRunner = (invocation: ValidationCommandInvocation) => Promise<AutoValidationResult>;

export interface ValidationServiceOptions {
  commandRunner?: ValidationCommandRunner;
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

export const CPP_COMPILE_VALIDATION_TIMEOUT_MS = 15_000;
export const CPP_RUN_VALIDATION_TIMEOUT_MS = 30_000;
export const PROJECT_BUILD_VALIDATION_TIMEOUT_MS = 120_000;
export const CMAKE_RUN_VALIDATION_TIMEOUT_MS = 30_000;

export class ValidationService {
  private readonly commandRunner: ValidationCommandRunner;
  private readonly fsNode: NonNullable<ValidationServiceOptions['fsNode']>;

  constructor(options: ValidationServiceOptions = {}) {
    this.commandRunner = options.commandRunner ?? runShell;
    this.fsNode = options.fsNode ?? fs;
  }

  async validateWorkspaceChanges(input: ValidateWorkspaceChangesInput): Promise<AutoValidationResult | null> {
    const rootFsPath = input.rootFsPath;
    if (!rootFsPath) return null;

    const changedPaths = input.changedPaths;
    const hasBridge = changedPaths.some((path) => path.startsWith('packages/bridge/'));
    const hasExtension = changedPaths.some((path) => path.startsWith('packages/vscode-extension/'));
    const cppRelated = changedPaths.filter((path) => /\.(cpp|cc|cxx|c|h|hpp)$/i.test(path));

    if (hasBridge) {
      return this.runCommand({
        command: 'npm run build',
        cwd: nodePath.join(rootFsPath, 'packages', 'bridge'),
        timeoutMs: PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
      });
    }
    if (hasExtension) {
      return this.runCommand({
        command: 'npm run compile',
        cwd: nodePath.join(rootFsPath, 'packages', 'vscode-extension'),
        timeoutMs: PROJECT_BUILD_VALIDATION_TIMEOUT_MS,
      });
    }
    if (cppRelated.length > 0) {
      return this.validateCppChanges(
        rootFsPath,
        cppRelated,
        input.cppValidationPolicy ?? 'conservative',
        shouldRunCppValidation(input.requestPrompt || ''),
      );
    }

    return null;
  }

  private async validateCppChanges(
    rootFsPath: string,
    cppRelated: string[],
    cppPolicy: CppValidationPolicy,
    shouldRun: boolean,
  ): Promise<AutoValidationResult | null> {
    const plan = planCppValidation(cppRelated, rootFsPath, this.fsNode, cppPolicy, { run: shouldRun });
    if (!plan) return null;

    const timeoutMs = plan.mode === 'compile-run'
      ? CPP_RUN_VALIDATION_TIMEOUT_MS
      : plan.mode === 'cmake' && shouldRun
        ? CMAKE_RUN_VALIDATION_TIMEOUT_MS
        : plan.mode === 'cmake'
          ? PROJECT_BUILD_VALIDATION_TIMEOUT_MS
          : CPP_COMPILE_VALIDATION_TIMEOUT_MS;

    const result = await this.runCommand({ command: plan.command, cwd: plan.cwd, timeoutMs });
    return {
      ...result,
      mode: plan.mode,
      reason: plan.reason,
    };
  }

  private async runCommand(invocation: ValidationCommandInvocation): Promise<AutoValidationResult> {
    return this.commandRunner(invocation);
  }
}

export function shouldRunCppValidation(prompt: string): boolean {
  return /(?:运行|执行|启动|测试|test|run|execute|看结果|输出效果|运行效果)/i.test(prompt || '');
}

async function runShell(invocation: ValidationCommandInvocation): Promise<AutoValidationResult> {
  return new Promise((resolve) => {
    exec(invocation.command, { cwd: invocation.cwd, timeout: invocation.timeoutMs }, (
      error: Error & { code?: number; killed?: boolean; signal?: string },
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
