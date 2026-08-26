import * as fs from 'fs';
import * as nodePath from 'path';
import {
  codingSemanticDigest,
  codingToolExecutionFailureReason,
  type CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import { looksLikeRawToolCallText } from '../generated-file-parser';
import { resolveWorkspaceWritePath } from '../workspace/path-resolver';
import {
  WorkspaceEditService,
  type WorkspaceCommittedEdit,
} from '../workspace/edit-service';
import { VsCodeWorkspaceMutationAdapter } from '../workspace/coding-workspace-mutation-adapter';
import { decideProjectInstructionFileWrite } from '../workspace/instruction-file-safety';
import {
  detectNestedFilePayloadDrift,
  shouldBlockUnverifiedSourceOverwrite,
} from './write-guard';
import { isCodeArtifactPathValue } from '../artifact-path-kind';
import type { AgentLoopCallbacks } from './loop-types';
import type { AgentToolExecutionPlan, EvidenceRef } from './tool-executor';
import type { ToolReadEvidenceRecorder } from './tool-read-evidence';
import {
  ToolLoopCanonicalSession,
  type CanonicalToolContext,
} from './tool-loop-canonical-session';

export interface ToolLoopWrittenFile {
  readonly path: string;
  readonly basename: string;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  readonly action: string;
}

export interface ToolLoopFileWriteReporter {
  feedback(message: string): void;
  failure(toolName: string, rawPath: string | undefined, reason: string, strategyFingerprint?: string): void;
  cancellation(toolName: string, rawPath: string): void;
  written(file: ToolLoopWrittenFile): void;
  evidence(ref: EvidenceRef): void;
  change(receipt: CodingWorkspaceMutationReceipt<unknown>): void;
}

export interface ToolLoopFileWriterOptions {
  readonly callbacks: AgentLoopCallbacks;
  readonly workspaceRoot: string;
  readonly defaultWorkdir?: string;
  readonly requireReadBeforeOverwrite?: boolean;
  readonly readEvidencePaths: ReadonlySet<string>;
  readonly targetedReadEvidencePaths: ReadonlySet<string>;
  readonly readEvidenceRecorder: ToolReadEvidenceRecorder;
  readonly canonical: ToolLoopCanonicalSession;
  readonly reporter: ToolLoopFileWriteReporter;
}

const workspaceEditService = new WorkspaceEditService();
const workspaceMutation = new VsCodeWorkspaceMutationAdapter(workspaceEditService);

/** Owns guarded file-write preparation, canonical mutation, and independent readback. */
export class ToolLoopFileWriter {
  private readonly failureCounts = new Map<string, number>();

  constructor(private readonly options: ToolLoopFileWriterOptions) {}

  async apply(
    toolPlan: AgentToolExecutionPlan,
    canonicalContext: CanonicalToolContext,
    toolName: string,
    rawPath: string,
    content: string,
  ): Promise<boolean> {
    const { callbacks, canonical, reporter } = this.options;
    const strategyFingerprint = codingSemanticDigest({ tool: toolName, path: rawPath, content });
    let canonicalSettled = false;
    const failBeforeEffect = async (errorCode: string, reason: string): Promise<boolean> => {
      await canonical.fail(toolPlan, canonicalContext, errorCode);
      canonicalSettled = true;
      reporter.failure(toolName, rawPath || undefined, reason, strategyFingerprint);
      reporter.feedback(`[${toolName}${rawPath ? `: ${rawPath}` : ''}] 错误: ${reason}`);
      return false;
    };
    if (this.cancellationRequested()) {
      await canonical.fail(toolPlan, canonicalContext, 'tool-cancelled-before-effect');
      canonicalSettled = true;
      reporter.cancellation(toolName, rawPath);
      return false;
    }
    if (!callbacks.onAppliedChange) {
      return failBeforeEffect('missing-file-write-projection-host', '当前运行环境没有注册文件写入执行器，未写入任何文件。');
    }
    if (!rawPath) {
      return failBeforeEffect('missing-file-write-path', '缺少 path/filePath，未写入任何文件。请提供目标文件路径和完整 content。');
    }
    callbacks.onToolActivity?.('write', rawPath);
    try {
      const normalized = normalizeFileWritePath(
        rawPath,
        this.options.workspaceRoot,
        this.options.defaultWorkdir,
      );
      if (!normalized) {
        return failBeforeEffect(
          'file-write-path-unresolved',
          '目标路径无法在当前工作区和工作目录中确定，未写入任何文件。请提供明确的文件路径。',
        );
      }
      if (normalized.note) reporter.feedback(`[${toolName}: ${rawPath}] 诊断: ${normalized.note}`);
      if (!content && isCodeArtifactPathValue(normalized.path)) {
        return failBeforeEffect('empty-source-artifact-content', 'content 为空，不能创建空源码文件。请提供完整文件内容。');
      }
      if (looksLikeRawToolCallText(content)) {
        return failBeforeEffect('tool-protocol-in-file-content', 'content 是工具调用文本，不是文件内容，已阻止写入。请只把目标文件源码放入 content。');
      }
      const absPath = normalized.absPath;
      if (!absPath) {
        return failBeforeEffect('file-write-path-outside-workspace', '无法解析为工作区内文件路径，已阻止写入。');
      }
      const instructionDecision = decideProjectInstructionFileWrite({
        filePath: normalized.path,
        content,
        source: 'model-tool-action',
      });
      if (!instructionDecision.allowed) {
        return failBeforeEffect('project-instruction-write-denied', instructionDecision.reason ?? '项目指令文件写入未被允许');
      }
      const payloadDrift = detectNestedFilePayloadDrift({
        targetAbsPath: absPath,
        content,
        workspaceRoot: this.options.workspaceRoot,
        defaultWorkdir: this.options.defaultWorkdir,
      });
      if (payloadDrift.block) {
        return failBeforeEffect('nested-file-payload-drift', payloadDrift.reason ?? '文件内容疑似包含嵌套路径载荷，已阻止写入。');
      }
      let baseline;
      try {
        baseline = workspaceEditService.captureTextFileBaseline(absPath, this.options.workspaceRoot);
      } catch (error) {
        return failBeforeEffect(
          'workspace-write-baseline-failed',
          `工作区写入边界阻止写入：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (this.options.requireReadBeforeOverwrite) {
        const guard = shouldBlockUnverifiedSourceOverwrite({
          absPath,
          existed: baseline.snapshot.existed,
          readEvidencePaths: toolName === 'replace_in_file'
            ? this.options.targetedReadEvidencePaths
            : this.options.readEvidencePaths,
        });
        if (guard.block) {
          return failBeforeEffect('source-overwrite-without-read-evidence', guard.reason ?? '覆盖现有源码前缺少读取证据，已阻止写入。');
        }
      }
      if (!callbacks.onResolveFileWriteConstraint) {
        const reason = `缺少写入授权边界：${absPath}`;
        await canonical.deny(toolPlan, canonicalContext, reason);
        canonicalSettled = true;
        reporter.failure(toolName, rawPath, reason, strategyFingerprint);
        reporter.feedback(`[${toolName}: ${rawPath}] 跳过（缺少写入授权边界）`);
        return false;
      }
      const fileWriteConstraint = await callbacks.onResolveFileWriteConstraint(absPath, {
        purpose: 'tool-write',
        taskAction: toolName,
        toolRisk: toolPlan.risk,
        displayName: rawPath,
      });
      if (this.cancellationRequested()) {
        await canonical.fail(toolPlan, canonicalContext, 'tool-cancelled-before-effect');
        canonicalSettled = true;
        reporter.cancellation(toolName, rawPath);
        return false;
      }

      let mutationReceipt: CodingWorkspaceMutationReceipt<WorkspaceCommittedEdit> | undefined;
      const toolOutcome = await canonical.settle(toolPlan, canonicalContext, {
        execute: async (_plan, authority) => {
          try {
            const mutationOutcome = await workspaceMutation.executeTextFileWrite({
              transaction: canonical.workspaceMutations,
              runId: canonicalContext.runId,
              sequence: canonicalContext.sequence,
              actionId: canonicalContext.actionId,
              absPath,
              workspaceRoot: this.options.workspaceRoot,
              content,
              baseline,
              applyOptions: { validateSourceSanity: true, repairSourceTransportEscapes: true },
              evidenceRefs: authority.evidenceRefs,
            });
            mutationReceipt = mutationOutcome.receipt;
            reporter.change(mutationOutcome.receipt);
            return {
              status: mutationOutcome.receipt.status === 'committed'
                ? 'completed' as const
                : mutationOutcome.receipt.status === 'indeterminate'
                  ? 'indeterminate' as const
                  : 'failed' as const,
              result: mutationOutcome.receipt,
              ...(mutationOutcome.receipt.errorCode ? { errorCode: mutationOutcome.receipt.errorCode } : {}),
              evidenceRefs: mutationOutcome.receipt.evidenceRefs,
            };
          } catch {
            return {
              status: 'failed' as const,
              errorCode: 'workspace-write-host-failed',
              evidenceRefs: [`vscode-workspace-write:${canonicalContext.actionId}:failed`],
            };
          }
        },
      }, fileWriteConstraint);
      canonicalSettled = true;
      const committedEdit = mutationReceipt?.result;
      if (toolOutcome.receipt.status !== 'completed' || mutationReceipt?.status !== 'committed' || !committedEdit) {
        const terminalReason = mutationReceipt?.errorCode
          ?? codingToolExecutionFailureReason(toolOutcome.receipt);
        const reason = mutationReceipt?.errorCode === 'workspace-proposal-invalid'
          ? `源码语法护栏阻止写入：${mutationReceipt.errorDetail ?? terminalReason}`
          : `工作区写入事务未提交：${terminalReason}`;
        reporter.failure(toolName, rawPath, reason, strategyFingerprint);
        reporter.feedback(`[${toolName}: ${rawPath}] 错误: ${reason}`);
        return false;
      }
      const writeResult = committedEdit.result;
      const persistedContent = fs.readFileSync(absPath, 'utf8');
      if (persistedContent !== writeResult.newContent) {
        const reason = `写入后读回内容不一致：${absPath}`;
        reporter.failure(toolName, rawPath, reason, strategyFingerprint);
        reporter.feedback(`[${toolName}: ${rawPath}] 错误: ${reason}`);
        return false;
      }
      const stat = fs.statSync(absPath);
      if (!stat.isFile() || stat.size === 0) {
        const reason = `写入后校验失败（不是有效文件或文件为空）：${absPath}`;
        reporter.failure(toolName, rawPath, reason, strategyFingerprint);
        reporter.feedback(this.repeatedFailureMessage(toolName, rawPath, reason, false));
        return false;
      }
      if (writeResult.normalization) {
        reporter.feedback(`[${toolName}: ${rawPath}] 诊断: 已修复 ${writeResult.normalization.repairCount} 处源码工具协议转义污染。`);
      }
      if (writeResult.existed && writeResult.oldContent === writeResult.newContent) {
        const reason = `未发生内容变化：${normalized.path}`;
        reporter.failure(toolName, rawPath, reason, strategyFingerprint);
        reporter.feedback(`[${toolName}: ${rawPath}] 未发生内容变化，未计入本轮修改证据：${normalized.path}`);
        return false;
      }
      await callbacks.onAppliedChange({
        path: absPath,
        ...writeResult,
        commitToken: committedEdit.commitToken,
      });
      const newLines = writeResult.newContent.split('\n').length;
      const oldLines = writeResult.oldContent ? writeResult.oldContent.split('\n').length : 0;
      reporter.written({
        path: absPath,
        basename: nodePath.basename(absPath),
        linesAdded: newLines,
        linesRemoved: oldLines,
        action: writeResult.existed ? 'modify' : 'create',
      });
      reporter.evidence(this.options.readEvidenceRecorder.recordArtifactReadback(absPath, persistedContent));
      reporter.feedback(`[${toolName}: ${rawPath}] 已写入 ${normalized.path} (${newLines} 行)`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!canonicalSettled) {
        await canonical.fail(toolPlan, canonicalContext, 'file-write-preflight-or-projection-failed');
      }
      reporter.failure(toolName, rawPath, message, strategyFingerprint);
      reporter.feedback(this.repeatedFailureMessage(toolName, rawPath, message, true));
      return false;
    }
  }

  private cancellationRequested(): boolean {
    return this.options.callbacks.signal?.aborted === true;
  }

  private repeatedFailureMessage(
    toolName: string,
    rawPath: string,
    reason: string,
    mentionReplace: boolean,
  ): string {
    const count = (this.failureCounts.get(rawPath) ?? 0) + 1;
    this.failureCounts.set(rawPath, count);
    let message = `[${toolName}: ${rawPath}] 错误: ${reason}`;
    if (count >= 2) {
      message += mentionReplace
        ? '\n请不要改用 run_terminal 写文件；继续使用 create_file/write_file/replace_in_file，并检查 path、content/old_str/new_str 和目标目录。'
        : '\n请不要改用 run_terminal 写文件；继续使用 create_file/write_file/replace_in_file，并检查 path 与内容参数是否正确。';
    }
    return message;
  }
}

function normalizeFileWritePath(
  rawPath: string,
  workspaceRootFsPath?: string,
  defaultWorkdir?: string,
): { path: string; absPath: string; note?: string } | undefined {
  const resolved = resolveWorkspaceWritePath(rawPath, {
    workspaceRootFsPath,
    defaultWorkdir,
  });
  if (!resolved) return undefined;
  return {
    path: resolved.relPath,
    absPath: resolved.absPath,
    ...(resolved.note ? { note: resolved.note } : {}),
  };
}
