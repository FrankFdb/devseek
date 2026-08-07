import * as fs from 'fs';
import * as nodePath from 'path';
import type * as vscode from 'vscode';
import type { AgentTask } from '../agent-task-decomposer';
import type { TaskSemanticContract } from '../task-semantic-contract';
import { resolveTaskSemanticContract } from '../intent/task-semantic-contract-service';
import type { ChatMessage } from '../llm/types';
import { roughLineDiff } from '../utils';
import {
  WorkspaceEditService,
  type WorkspaceTextFileBaseline,
} from '../workspace/edit-service';
import { VsCodeWorkspaceMutationAdapter } from '../workspace/coding-workspace-mutation-adapter';
import { isCanonicalPathInsideRoot } from '../workspace/path-containment';
import { isAgentFileWriteConstraintSatisfied } from '../app/agent-file-write-policy';
import {
  isMarkdownDocumentDeliverableRequest,
  isMarkdownDocumentWriteTask,
} from './deliverable-document';
import { stripToolCallBlocks } from './fake-tool-parser';
import type { AgentLoopCallbacks } from './loop-types';
import {
  hasAcceptableMarkdownDocumentShape,
  hasProviderCopyControlArtifact,
  normalizeProviderMarkdownDocumentText,
} from './markdown-document-quality';
import { assessFormalProjectDocumentQuality } from './formal-project-document-quality';
import {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
  type ProviderOutputIntegrityKind,
} from './provider-output-integrity';
import type { TaskExecutionResult } from './task-execution-result';
import type { WrittenFileEvidence } from './completion-evidence';
import {
  EvidenceStore,
  deriveArtifactClaimSpecs,
  formatArtifactClaimSpecsForPrompt,
  formatClaimVerificationFeedback,
  verifyArtifactClaims,
  type ArtifactClaimSpec,
  type EvidenceRef,
  type VerificationResult,
} from './evidence-grounding';
import {
  authorizeMarkdownArtifactWrite,
  extractCurrentUserRequest,
  getSourceClaimArtifactContractIssue,
  hasQualityObligation,
  resolveTaskContractSourcePaths,
  type TaskContract,
} from './task-contract';
import { materializeExactGroundedMarkdown } from './exact-grounded-markdown';

export type MarkdownDeliverableChat = (messages: ChatMessage[]) => Promise<string>;

export interface MarkdownDeliverableTaskInput {
  task: AgentTask;
  taskIndex: number;
  taskTotal: number;
  userPrompt: string;
  workspaceRoot: vscode.Uri;
  effectiveAbsPath?: string;
  callbacks: AgentLoopCallbacks;
  semanticContract?: TaskSemanticContract;
  chat: MarkdownDeliverableChat;
}

interface EvidenceFile {
  absPath: string;
  relPath: string;
  kind: 'requirement' | 'claim-source' | 'supporting-source';
  content: string;
  truncated: boolean;
  evidenceRef: EvidenceRef;
}

interface EvidenceBundle {
  files: EvidenceFile[];
  sourceDirs: string[];
  providerFallbackReason?: string;
}

interface ProviderMarkdownResult {
  markdown?: string;
  reason?: string;
  responseChars?: number;
  integrityKind?: ProviderOutputIntegrityKind;
  aborted?: boolean;
}

interface MarkdownStatusOptions {
  title?: string;
  detail: string;
  diff?: { added: number; removed: number };
}

const workspaceEditService = new WorkspaceEditService();
const workspaceMutation = new VsCodeWorkspaceMutationAdapter(workspaceEditService);
let markdownMutationSequence = 0;
const MAX_EVIDENCE_FILES = 12;
const MAX_REQUIREMENT_FILES = 3;
const MAX_FILE_CHARS = 6_000;
const MAX_TOTAL_EVIDENCE_CHARS = 30_000;
const SOURCE_DIR_DEPTH = 2;
const REPORT_MIN_CHARS = 240;
const POSIX_ABSOLUTE_PATH_RE = /\/(?:[A-Za-z0-9._@%+=-]+\/)*[A-Za-z0-9._@%+=-]+/g;
const SOURCE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx',
  '.h', '.hh', '.hpp', '.hxx',
  '.md', '.txt',
]);
const EXCLUDED_DIR_NAMES = new Set([
  '.git', '.devseek', '.vscode', '.claude', '.cursor', '.github', '.codebuddy',
  'node_modules', 'backups', 'dist', 'build', 'cmake-build-debug', 'cmake-build-release',
  'Debug', 'Release', 'logs', 'log', 'cache', '.cache',
]);
const BAD_PROVIDER_REPORT_RE = /(?:\[TOOL:|\[工具执行结果\]|Calling\s*:\s*(?:read_file|list_dir|file_search)|调用\s*(?:read_file|list_dir|file_search))/i;
const COMMUNICATION_SOURCE_FILE_RE = /(?:uart\d+_(?:tx|rx)_main|(?:^|[_-])tunnel|tunnel[_-]?transport|mavlink|publisher|subscriber|license).*\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;

export async function tryExecuteMarkdownDeliverableTask(
  input: MarkdownDeliverableTaskInput,
): Promise<TaskExecutionResult | undefined> {
  const { task, callbacks } = input;
  if (!shouldExecuteMarkdownDeliverableTask(input)) {
    return undefined;
  }

  const absPath = resolveTargetAbsPath(input);
  const basename = nodePath.basename(absPath || task.file || task.visibleTarget || 'Markdown 文档');
  if (!absPath) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: 'Markdown 目标路径缺失',
      detail: '缺少可写入的 Markdown 目标路径。',
    });
    return { applied: false, failedReason: 'Markdown deliverable target path is missing' };
  }
  if (!isCanonicalPathInsideRoot(absPath, input.workspaceRoot.fsPath)) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: 'Markdown 目标路径越界',
      detail: '目标路径经符号链接解析后不在当前 workspace 内。',
    });
    return { applied: false, path: absPath, failedReason: 'Markdown deliverable target escapes workspace' };
  }
  const relPath = displayPath(input.workspaceRoot.fsPath, absPath, task.file || basename);
  const targetAuthorization = authorizeMarkdownArtifactWrite({
    promptText: extractCurrentUserRequest(input.userPrompt),
    targetPath: absPath,
    workspaceRoot: input.workspaceRoot.fsPath,
    allowImplicitPrimaryArtifact: true,
  });
  if (!targetAuthorization.allowed) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: 'Markdown 目标未获当前请求授权',
      detail: `${relPath} · ${targetAuthorization.reason}`,
    });
    return {
      applied: false,
      path: absPath,
      failedReason: targetAuthorization.reason,
    };
  }
  const initialTargetSnapshot = tryCaptureTextFileBaseline(absPath, input.workspaceRoot.fsPath);
  if (!initialTargetSnapshot || !isCanonicalPathInsideRoot(absPath, input.workspaceRoot.fsPath)) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: 'Markdown 目标路径身份无效',
      detail: `${relPath} · 无法在任务开始边界固定目标文件及其最近既有父目录身份。`,
    });
    return {
      applied: false,
      path: absPath,
      failedReason: 'Markdown deliverable target identity could not be captured safely',
    };
  }
  const evidenceStore = new EvidenceStore(input.workspaceRoot.fsPath, `markdown-${task.id || input.taskIndex}`);
  const markdownPromptText = combineUniquePromptParts(input.userPrompt, input.task.desc);
  const baseTaskContract = input.semanticContract?.taskContract
    ?? resolveTaskSemanticContract(markdownPromptText).taskContract;

  const contractIssue = getSourceClaimArtifactContractIssue(baseTaskContract);
  if (contractIssue) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: '源码事实报告契约不完整',
      detail: `${relPath} · ${contractIssue}`,
    });
    return {
      applied: false,
      path: absPath,
      failedReason: contractIssue,
      evidenceRefs: evidenceStore.all(),
    };
  }

  await postMarkdownStatus(input, 'started', basename, {
    title: '收集 Markdown 交付证据',
    detail: [
      `目标：${relPath}`,
      '正在读取必需源码、需求文档和补充证据；本阶段只读文件，不修改源码。',
    ].join('\n'),
  });
  const evidence = collectMarkdownEvidence(
    markdownPromptText,
    baseTaskContract,
    input.workspaceRoot.fsPath,
    absPath,
    evidenceStore,
  );
  if (evidence.sourceDirs.length > 0) {
    callbacks.onToolActivity?.('list', summarizeActivityPaths(evidence.sourceDirs, input.workspaceRoot.fsPath));
  }
  if (evidence.files.length > 0) {
    callbacks.onToolActivity?.('read', `${evidence.files.length} 个 Markdown 交付证据文件`);
  }

  const taskContract = resolveTaskContractSourcePaths(
    baseTaskContract,
    evidence.files.map(file => file.absPath),
    input.workspaceRoot.fsPath,
  );
  let claimSpecs: ArtifactClaimSpec[];
  try {
    claimSpecs = deriveArtifactClaimSpecs(
      taskContract.evidenceRequirements,
      evidence.files.map(file => file.evidenceRef),
    );
  } catch (error) {
    const reason = (error as Error).message;
    await postMarkdownStatus(input, 'failed', basename, {
      title: '缺少可验证的源码事实证据',
      detail: `${relPath} · ${reason}`,
    });
    return {
      applied: false,
      path: absPath,
      failedReason: reason,
      evidenceRefs: evidenceStore.all(),
    };
  }

  await postMarkdownStatus(
    input,
    'started',
    basename,
    {
      title: evidence.files.length > 0 ? `已收集 ${evidence.files.length} 个证据文件` : '未找到本地证据文件',
      detail: evidence.files.length > 0
        ? `${describeEvidenceSummary(evidence)}\n下一步${taskContract.verificationContract.exactArtifact ? '由宿主按逐字契约物化报告' : '请求 DeepSeek 生成完整 Markdown 报告'}。`
        : '未找到可读取证据文件；下一步将请求 DeepSeek 生成带风险提示的 Markdown 报告。',
    },
  );

  const exactMaterialization = materializeExactGroundedMarkdown(taskContract.verificationContract, claimSpecs);
  let provider: ProviderMarkdownResult | undefined;
  let markdown: string;
  let providerOwned = true;
  if (exactMaterialization) {
    providerOwned = false;
    if (!exactMaterialization.markdown) {
      const reason = exactMaterialization.reason || 'exact-artifact: 宿主无法安全物化逐字报告';
      await postMarkdownStatus(input, 'failed', basename, {
        title: '逐字 Markdown 契约无法安全物化',
        detail: `${relPath} · ${reason}`,
      });
      return { applied: false, path: absPath, failedReason: reason, evidenceRefs: evidenceStore.all() };
    }
    markdown = exactMaterialization.markdown;
    await postMarkdownStatus(input, 'started', basename, {
      title: '宿主已按源码证据物化逐字报告',
      detail: `${relPath} · Provider 调用已跳过；标题、源码路径、claim 顺序、initializer 表示和代码块均由可执行契约拥有。`,
    });
  } else {
    callbacks.onToolActivity?.('web', 'DeepSeek 生成 Markdown 报告');
    await postMarkdownStatus(input, 'started', basename, {
      title: '请求 DeepSeek 生成 Markdown 报告',
      detail: [
        `目标：${relPath}`,
        `上下文：${evidence.files.length} 个本地证据文件，已整理为受控提示词。`,
        '正在等待 DeepSeek 返回完整 Markdown 正文。',
      ].join('\n'),
    });
    provider = await generateProviderMarkdown(input, evidence, absPath, taskContract, claimSpecs);
    if (provider.aborted) {
      await postMarkdownStatus(input, 'failed', basename, {
        title: 'Markdown 生成已中止',
        detail: `目标：${relPath}\n用户已中止任务，未写入交付物。`,
      });
      return { applied: false, path: absPath, failedReason: 'Markdown deliverable aborted before write', evidenceRefs: evidenceStore.all() };
    }
    await postMarkdownStatus(input, 'started', basename, {
      title: provider.markdown ? 'DeepSeek 报告已返回' : 'DeepSeek 返回不可直接采用',
      detail: provider.markdown
        ? `DeepSeek 返回 ${provider.responseChars ?? 0} 字符，完整性检查通过（${provider.integrityKind || 'complete'}）；下一步执行写前验证。`
        : `DeepSeek 输出未通过交付门禁（${provider.reason || 'Provider 未返回可用的完整 Markdown 报告。'}）；将使用本地证据生成兜底 Markdown 并执行写前验证。`,
    });
    const baseMarkdown = provider.markdown || buildFallbackMarkdown({
      userPrompt: input.userPrompt,
      targetRelPath: relPath,
      deliveryObjective: input.task.desc,
      evidence,
      reason: provider.reason || 'Provider 未返回可用的完整 Markdown 报告。',
    });
    markdown = ensureFormalInterfaceExamples(baseMarkdown, markdownPromptText, input.semanticContract) || baseMarkdown;
  }

  if (callbacks.signal?.aborted) {
    return { applied: false, path: absPath, failedReason: 'Markdown deliverable aborted before write', evidenceRefs: evidenceStore.all() };
  }

  await postMarkdownStatus(input, 'started', basename, {
    title: '准备写入 Markdown 文档',
    detail: `目标：${relPath}\n正在通过写入权限和保护规则检查。`,
  });
  const verificationResults: VerificationResult[] = [];
  let latestArtifactClaims: VerificationResult['claims'] | undefined;
  let changeReceipt: NonNullable<TaskExecutionResult['changeReceipts']>[number] | undefined;
  try {
    let finalContent = '';
    let candidateReady = false;
    let verifiedCandidateEvidence: EvidenceRef | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (callbacks.signal?.aborted) {
        return { applied: false, path: absPath, failedReason: 'Markdown deliverable aborted before write', evidenceRefs: evidenceStore.all(), verificationResults };
      }
      if (!isCanonicalPathInsideRoot(absPath, input.workspaceRoot.fsPath)) {
        return { applied: false, path: absPath, failedReason: 'Markdown deliverable target escapes workspace', evidenceRefs: evidenceStore.all(), verificationResults };
      }
      finalContent = ensureFinalNewline(markdown);
      const candidateFormalQuality = taskContract.verificationContract.exactArtifact
        ? { ok: true, reasons: [] as string[] }
        : assessFormalProjectDocumentQuality(finalContent, markdownPromptText, input.semanticContract);
      if (!candidateFormalQuality.ok) {
        const reason = `formal-project-quality: ${candidateFormalQuality.reasons.join(', ')}`;
        await postMarkdownStatus(input, 'failed', basename, {
          title: 'Markdown 候选质量门禁未通过',
          detail: `${relPath} · 写盘前已阻止：${candidateFormalQuality.reasons.join('、')}。`,
        });
        return { applied: false, path: absPath, failedReason: reason, evidenceRefs: evidenceStore.all(), verificationResults };
      }

      const candidateEvidence = claimSpecs.length > 0
        ? evidenceStore.recordFileRead({
          path: absPath,
          content: finalContent,
          kind: 'artifact-candidate',
          operationId: `artifact-candidate-${attempt + 1}`,
        })
        : undefined;
      const candidateSourceReadbacks = candidateEvidence
        ? [...new Set(claimSpecs.map(spec => spec.sourcePath))].map((sourcePath, index) => evidenceStore.recordFileRead({
          path: sourcePath,
          content: fs.readFileSync(sourcePath, 'utf8'),
          operationId: `source-precommit-readback-${attempt + 1}-${index + 1}`,
        }))
        : [];
      const candidateGrounding = candidateEvidence
        ? verifyArtifactClaims(
          claimSpecs,
          candidateEvidence,
          candidateSourceReadbacks,
          { ...taskContract.verificationContract, requireArtifactReadback: false },
        )
        : undefined;
      if (candidateGrounding) latestArtifactClaims = candidateGrounding.claims;
      if (candidateGrounding && !candidateGrounding.ok) {
        verificationResults.push(candidateGrounding);
        const feedback = formatClaimVerificationFeedback(candidateGrounding);
        const sourceEvidenceStable = candidateGrounding.claims.every(claim => (
          claim.status !== 'source-drift' && claim.status !== 'missing-source-readback'
        ));
        if (providerOwned && sourceEvidenceStable && attempt === 0) {
          await postMarkdownStatus(input, 'started', basename, {
            title: '源码事实候选未通过，执行一次写前有界修复',
            detail: `${relPath}\n${feedback}\n目标尚未发生任何物理写入。`,
          });
          const repaired = await generateProviderMarkdown(input, evidence, absPath, taskContract, claimSpecs, feedback);
          if (repaired.aborted) {
            return { applied: false, path: absPath, failedReason: 'Markdown deliverable repair aborted before write', evidenceRefs: evidenceStore.all(), verificationResults };
          }
          if (repaired.markdown) {
            markdown = ensureFormalInterfaceExamples(
              repaired.markdown,
              markdownPromptText,
              input.semanticContract,
            ) || repaired.markdown;
            continue;
          }
        }
        const reason = `artifact-grounding: ${candidateGrounding.differences.join('; ')}`;
        await postMarkdownStatus(input, 'failed', basename, {
          title: 'Markdown 源码事实候选验证失败',
          detail: `${relPath} · 写盘前已阻止：${candidateGrounding.differences.join('；')}`,
        });
        return {
          applied: false,
          path: absPath,
          failedReason: reason,
          evidenceRefs: evidenceStore.all(),
          artifactClaims: candidateGrounding.claims,
          verificationResults,
        };
      }
      verifiedCandidateEvidence = candidateEvidence;
      candidateReady = true;
      break;
    }
    if (!candidateReady) {
      return { applied: false, path: absPath, failedReason: 'artifact-grounding: bounded pre-write repair exhausted', evidenceRefs: evidenceStore.all(), verificationResults };
    }
    if (callbacks.signal?.aborted) {
      return { applied: false, path: absPath, failedReason: 'Markdown deliverable aborted before write', evidenceRefs: evidenceStore.all(), verificationResults };
    }
    if (!isCanonicalPathInsideRoot(absPath, input.workspaceRoot.fsPath)) {
      return { applied: false, path: absPath, failedReason: 'Markdown deliverable target escapes workspace', evidenceRefs: evidenceStore.all(), verificationResults };
    }
    if (!workspaceEditService.isTextFileBaselineCurrent(initialTargetSnapshot)) {
      return {
        applied: false,
        path: absPath,
        failedReason: 'Markdown deliverable target changed after task authorization',
        evidenceRefs: evidenceStore.all(),
        verificationResults,
      };
    }
    callbacks.onToolActivity?.('write', relPath);
    await postMarkdownStatus(input, 'started', basename, {
      title: '提交已验证的 Markdown 候选',
      detail: `正在对 ${relPath} 重新授权并执行唯一一次物理写入，随后读回并独立复核源码。`,
    });
    const resolveConstraint = callbacks.onResolveFileWriteConstraint;
    const fileWriteConstraint = resolveConstraint
      ? await resolveConstraint(absPath, {
          purpose: 'markdown-deliverable',
          userRequested: true,
          taskAction: task.action,
          displayName: relPath,
          requestPrompt: input.userPrompt,
        })
      : undefined;
    if (!fileWriteConstraint || !isAgentFileWriteConstraintSatisfied(fileWriteConstraint)) {
      await postMarkdownStatus(input, 'failed', basename, {
        title: 'Markdown 写入被阻止',
        detail: `目标：${relPath}\n写入被当前权限或保护规则阻止；已验证候选未落盘。`,
      });
      return {
        applied: false,
        path: absPath,
        failedReason: 'Markdown deliverable write blocked by guard',
        evidenceRefs: evidenceStore.all(),
        verificationResults,
      };
    }

    if (!isCanonicalPathInsideRoot(absPath, input.workspaceRoot.fsPath)) {
      return {
        applied: false,
        path: absPath,
        failedReason: 'Markdown deliverable target escapes workspace at commit boundary',
        evidenceRefs: evidenceStore.all(),
        verificationResults,
      };
    }
    if (!workspaceEditService.isTextFileBaselineCurrent(initialTargetSnapshot)) {
      return {
        applied: false,
        path: absPath,
        failedReason: 'Markdown deliverable target changed while write authority was pending',
        evidenceRefs: evidenceStore.all(),
        verificationResults,
      };
    }
    if (verifiedCandidateEvidence) {
      const commitSourceReadbacks = [...new Set(claimSpecs.map(spec => spec.sourcePath))].map((sourcePath, index) => evidenceStore.recordFileRead({
        path: sourcePath,
        content: fs.readFileSync(sourcePath, 'utf8'),
        operationId: `source-commit-boundary-readback-${index + 1}`,
      }));
      const commitBoundaryGrounding = verifyArtifactClaims(
        claimSpecs,
        verifiedCandidateEvidence,
        commitSourceReadbacks,
        { ...taskContract.verificationContract, requireArtifactReadback: false },
      );
      if (!commitBoundaryGrounding.ok) {
        verificationResults.push(commitBoundaryGrounding);
        latestArtifactClaims = commitBoundaryGrounding.claims;
        return {
          applied: false,
          path: absPath,
          failedReason: `artifact-grounding: ${commitBoundaryGrounding.differences.join('; ')}`,
          evidenceRefs: evidenceStore.all(),
          artifactClaims: commitBoundaryGrounding.claims,
          verificationResults,
        };
      }
    }

    markdownMutationSequence += 1;
    const mutationSequence = markdownMutationSequence;
    let committedGrounding: VerificationResult | undefined;
    let readbackFailureReason: string | undefined;
    const mutation = await workspaceMutation.executeTextFileWrite({
      runId: callbacks.traceRunId?.trim() || `vscode-markdown-invocation-${mutationSequence}`,
      sequence: mutationSequence,
      actionId: `markdown-deliverable-${task.id || input.taskIndex}-${mutationSequence}`,
      absPath,
      workspaceRoot: input.workspaceRoot.fsPath,
      content: finalContent,
      baseline: initialTargetSnapshot,
      applyOptions: { validateSourceSanity: true, repairSourceTransportEscapes: true },
      evidenceRefs: [`markdown-deliverable:${task.id || input.taskIndex}:authorized`],
      verifyReadback: async ({ content: freshContent, committed }) => {
        if (freshContent !== finalContent) {
          readbackFailureReason = 'Markdown deliverable verification failed after write';
          return {
            matches: false,
            evidenceRefs: [`markdown-readback:${task.id || input.taskIndex}:content-mismatch`],
          };
        }
        const artifactEvidence = evidenceStore.recordFileRead({
          path: absPath,
          content: freshContent,
          kind: 'artifact-readback',
          operationId: 'artifact-readback-commit',
        });
        const finalFormalQuality = taskContract.verificationContract.exactArtifact
          ? { ok: true, reasons: [] as string[] }
          : assessFormalProjectDocumentQuality(freshContent, markdownPromptText, input.semanticContract);
        const sourceReadbacks = claimSpecs.length > 0
          ? [...new Set(claimSpecs.map(spec => spec.sourcePath))].map((sourcePath, index) => evidenceStore.recordFileRead({
            path: sourcePath,
            content: fs.readFileSync(sourcePath, 'utf8'),
            operationId: `source-readback-commit-${index + 1}`,
          }))
          : [];
        committedGrounding = claimSpecs.length > 0
          ? verifyArtifactClaims(claimSpecs, artifactEvidence, sourceReadbacks, taskContract.verificationContract)
          : undefined;
        if (committedGrounding) {
          verificationResults.push(committedGrounding);
          latestArtifactClaims = committedGrounding.claims;
        }
        if (!finalFormalQuality.ok || (committedGrounding && !committedGrounding.ok)) {
          const differences = committedGrounding && !committedGrounding.ok
            ? committedGrounding.differences
            : finalFormalQuality.reasons;
          readbackFailureReason = committedGrounding && !committedGrounding.ok
            ? `artifact-grounding: ${differences.join('; ')}`
            : `formal-project-quality: ${differences.join(', ')}`;
          return {
            matches: false,
            evidenceRefs: [`markdown-readback:${task.id || input.taskIndex}:quality-failed`],
          };
        }
        try {
          await callbacks.onAppliedChange({ path: relPath, ...committed.result });
        } catch (error) {
          readbackFailureReason = error instanceof Error ? error.message : String(error);
          throw error;
        }
        if (!workspaceEditService.isTextFileBaselineCurrent(committed.commitToken.after)) {
          readbackFailureReason = 'Markdown deliverable target changed during final delivery callback';
          return {
            matches: false,
            evidenceRefs: [`markdown-readback:${task.id || input.taskIndex}:delivery-drift`],
          };
        }
        return {
          matches: true,
          evidenceRefs: [`markdown-readback:${task.id || input.taskIndex}:quality-passed`],
        };
      },
    });
    changeReceipt = mutation.receipt;
    const committedEdit = mutation.receipt.status === 'committed'
      ? mutation.receipt.result
      : undefined;
    if (!committedEdit) {
      const diff = roughLineDiff(initialTargetSnapshot.snapshot.content, finalContent);
      const terminalFailure = mutation.receipt.status === 'indeterminate'
        ? `rollback-aborted: ${mutation.receipt.errorCode ?? 'mutation state is indeterminate'}`
        : `Markdown mutation ${mutation.receipt.status}: ${mutation.receipt.errorCode ?? 'unknown'}`;
      const failedReason = [readbackFailureReason, terminalFailure].filter(Boolean).join('; ');
      await postMarkdownStatus(input, 'failed', basename, {
        title: mutation.receipt.status === 'rolled-back'
          ? 'Markdown 提交后复核失败，已回滚'
          : 'Markdown 写入未提交',
        detail: `${relPath} · ${failedReason}`,
        diff,
      });
      return {
        applied: false,
        path: absPath,
        failedReason,
        evidenceRefs: evidenceStore.all(),
        artifactClaims: committedGrounding?.claims ?? latestArtifactClaims,
        verificationResults,
        changeReceipts: [mutation.receipt],
      };
    }
    const writeResult = committedEdit.result;
    const diff = roughLineDiff(writeResult.oldContent, writeResult.newContent);
    const grounding = committedGrounding;

    const action = writeResult.existed ? 'modify' : 'create';
    const verb = writeResult.existed ? '已更新' : '已创建';
    const writtenFiles = [buildWrittenFileEvidence(absPath, action, diff.added, diff.removed)];
    const providerNote = providerOwned
      ? (provider?.markdown ? 'Provider 候选已通过写前门禁' : 'Provider 输出不可用，已验证本地证据兜底正文')
      : '逐字正文由宿主根据源码证据确定性物化';
    await postMarkdownStatus(input, 'started', basename, {
      title: 'Markdown 文档已通过执行器验证，等待中央结算',
      detail: `${relPath} · 写前验证、唯一写入、读回和独立源码复核均通过；${claimSpecs.length} 项源码事实 claim 全部通过；${providerNote}；尚未发布完成态。`,
      diff,
    });
    if (!workspaceEditService.isTextFileBaselineCurrent(committedEdit.commitToken.after)) {
      throw new Error('Markdown deliverable target changed during final status delivery');
    }
    return {
      applied: true,
      path: absPath,
      raw: `${verb} Markdown 文档：${relPath}\n本地证据文件：${evidence.files.length} 个\n源码事实 claim：${claimSpecs.length} 项全部通过。`,
      taskComplete: true,
      linesAdded: diff.added,
      linesRemoved: diff.removed,
      writtenFiles,
      evidenceRefs: evidenceStore.all(),
      artifactClaims: grounding?.claims,
      verificationResults,
      changeReceipts: [mutation.receipt],
    };
  } catch (error) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: changeReceipt?.status === 'committed'
        ? 'Markdown 文档已写入，但交付结算失败'
        : 'Markdown 文档写入失败',
      detail: `${relPath}\n${(error as Error).message}`,
    });
    return {
      applied: false,
      path: absPath,
      failedReason: (error as Error).message,
      evidenceRefs: evidenceStore.all(),
      artifactClaims: latestArtifactClaims,
      verificationResults,
      ...(changeReceipt ? { changeReceipts: [changeReceipt] } : {}),
    };
  }
}

function tryCaptureTextFileBaseline(
  absPath: string,
  workspaceRoot: string,
): WorkspaceTextFileBaseline | undefined {
  try {
    return workspaceEditService.captureTextFileBaseline(absPath, workspaceRoot);
  } catch {
    return undefined;
  }
}

function shouldExecuteMarkdownDeliverableTask(input: MarkdownDeliverableTaskInput): boolean {
  const { task } = input;
  if (!isMarkdownDocumentWriteTask(task)) return false;

  const taskIntentText = [
    task.desc,
    task.visibleTarget,
    task.file,
  ].filter(Boolean).join('\n');
  if (isMarkdownDocumentDeliverableRequest(taskIntentText)) return true;

  return isMarkdownDocumentDeliverableRequest(extractCurrentUserRequest(input.userPrompt));
}

async function generateProviderMarkdown(
  input: MarkdownDeliverableTaskInput,
  evidence: EvidenceBundle,
  absPath: string,
  taskContract: TaskContract,
  claimSpecs: ArtifactClaimSpec[],
  verificationFeedback?: string,
): Promise<ProviderMarkdownResult> {
  try {
    const response = await input.chat([{
      role: 'user',
      content: buildProviderPrompt(input, evidence, absPath, taskContract, claimSpecs, verificationFeedback),
    }]);
    const integrity = classifyProviderOutputIntegrity(response);
    const promptText = combineUniquePromptParts(input.userPrompt, input.task.desc);
    const normalized = ensureFormalInterfaceExamples(
      normalizeProviderMarkdown(response, taskContract),
      promptText,
      input.semanticContract,
    );
    if (normalized) {
      const formalQuality = assessFormalProjectDocumentQuality(
        normalized,
        promptText,
        input.semanticContract,
      );
      if (!formalQuality.ok) {
        return {
          reason: `formal-project-quality: ${formalQuality.reasons.join(', ')}`,
          responseChars: response.length,
          integrityKind: integrity.kind,
        };
      }
      return {
        markdown: normalized,
        responseChars: response.length,
        integrityKind: integrity.kind,
      };
    }
    return {
      reason: describeProviderMarkdownRejection(response, integrity.kind, taskContract),
      responseChars: response.length,
      integrityKind: integrity.kind,
    };
  } catch (error) {
    if (input.callbacks.signal?.aborted || (error as Error).name === 'AbortError') {
      return { reason: 'Provider call aborted', aborted: true };
    }
    return { reason: `Provider 调用失败：${(error as Error).message}` };
  }
}

function resolveTargetAbsPath(input: MarkdownDeliverableTaskInput): string | undefined {
  const candidates = [input.effectiveAbsPath, input.task.absPath].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (nodePath.isAbsolute(candidate)) return candidate;
  }
  const file = input.task.file || '';
  if (!file) return undefined;
  if (nodePath.isAbsolute(file)) return file;
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return nodePath.join(input.workspaceRoot.fsPath, ...normalized.split('/').filter(Boolean));
}

function collectMarkdownEvidence(
  userPrompt: string,
  contract: TaskContract,
  workspaceRoot: string,
  targetAbsPath: string,
  evidenceStore: EvidenceStore,
): EvidenceBundle {
  const paths = uniquePaths([
    ...extractExistingAbsolutePaths(userPrompt),
    ...resolveContractExistingPaths(contract, workspaceRoot, targetAbsPath),
  ]);
  const claimSourceFiles = resolveContractClaimSourcePaths(contract, workspaceRoot, targetAbsPath);
  const targetDir = nodePath.dirname(targetAbsPath);
  const requirementFiles = paths
    .filter(absPath => isFile(absPath) && isMarkdownPath(absPath))
    .slice(0, MAX_REQUIREMENT_FILES);
  const explicitSourceFiles = paths
    .filter(absPath => isFile(absPath) && shouldReadSourceFile(absPath) && !isMarkdownPath(absPath))
    .filter(absPath => nodePath.normalize(absPath) !== nodePath.normalize(targetAbsPath));
  const sourceDirs = paths
    .filter(absPath => isDirectory(absPath))
    .filter(absPath => nodePath.normalize(absPath) !== nodePath.normalize(targetDir))
    .filter(absPath => !isExcludedPath(absPath))
    .slice(0, 4);
  const communicationEvidence = shouldCollectProjectCommunicationEvidence(contract)
    ? collectProjectCommunicationEvidence(paths, workspaceRoot, targetAbsPath)
    : { files: [] as string[], roots: [] as string[] };

  const files: EvidenceFile[] = [];
  let remainingChars = MAX_TOTAL_EVIDENCE_CHARS;
  let optionalFileCount = 0;
  // Claude Code and Codex both read an explicitly named fact source before
  // exploring sibling implementations. Contract-owned claim sources are
  // always captured in full by EvidenceStore and projected as compact host-
  // derived facts. File-count and character budgets apply only to supporting
  // evidence.
  for (const absPath of claimSourceFiles) {
    const loaded = readEvidenceFile(
      absPath,
      workspaceRoot,
      'claim-source',
      0,
      evidenceStore,
      true,
    );
    if (!loaded) continue;
    files.push(loaded);
  }
  for (const absPath of requirementFiles) {
    if (optionalFileCount >= MAX_EVIDENCE_FILES || remainingChars <= 0) break;
    const loaded = readEvidenceFile(absPath, workspaceRoot, 'requirement', remainingChars, evidenceStore);
    if (!loaded) continue;
    files.push(loaded);
    optionalFileCount += 1;
    remainingChars -= loaded.content.length;
  }

  const sourceFiles = uniquePaths(
    [
      ...explicitSourceFiles,
      ...communicationEvidence.files,
      ...sourceDirs.flatMap(dir => collectSourceFiles(dir, SOURCE_DIR_DEPTH, MAX_EVIDENCE_FILES)),
    ],
  )
    .filter(absPath => !claimSourceFiles.includes(absPath) && !requirementFiles.includes(absPath))
    .slice(0, Math.max(0, MAX_EVIDENCE_FILES - optionalFileCount));

  for (const absPath of sourceFiles) {
    const loaded = readEvidenceFile(absPath, workspaceRoot, 'supporting-source', remainingChars, evidenceStore);
    if (!loaded) continue;
    files.push(loaded);
    optionalFileCount += 1;
    remainingChars -= loaded.content.length;
    if (remainingChars <= 0) break;
  }

  return { files, sourceDirs: uniquePaths([...sourceDirs, ...communicationEvidence.roots]) };
}

function resolveContractExistingPaths(
  contract: TaskContract,
  workspaceRoot: string,
  targetAbsPath: string,
): string[] {
  const result: string[] = [];
  for (const inputPath of contract.inputs) {
    const resolved = resolveExistingContractPath(inputPath, workspaceRoot, targetAbsPath);
    if (resolved) result.push(resolved);
  }
  return uniquePaths(result);
}

function resolveContractClaimSourcePaths(
  contract: TaskContract,
  workspaceRoot: string,
  targetAbsPath: string,
): string[] {
  return uniquePaths(contract.evidenceRequirements
    .map(requirement => requirement.sourcePath)
    .filter((sourcePath): sourcePath is string => Boolean(sourcePath))
    .map(sourcePath => resolveExistingContractPath(sourcePath, workspaceRoot, targetAbsPath))
    .filter((sourcePath): sourcePath is string => Boolean(sourcePath)));
}

function resolveExistingContractPath(
  inputPath: string,
  workspaceRoot: string,
  targetAbsPath: string,
): string | undefined {
  const absolute = nodePath.isAbsolute(inputPath)
    ? nodePath.resolve(inputPath)
    : nodePath.resolve(workspaceRoot, inputPath.replace(/^\.\//, ''));
  if (nodePath.normalize(absolute) === nodePath.normalize(targetAbsPath)) return undefined;
  if (fs.existsSync(absolute)) return absolute;
  if (nodePath.isAbsolute(inputPath)) return undefined;
  const uniqueMatch = findUniqueWorkspaceInputPath(workspaceRoot, inputPath);
  if (!uniqueMatch || nodePath.normalize(uniqueMatch) === nodePath.normalize(targetAbsPath)) return undefined;
  return uniqueMatch;
}

function findUniqueWorkspaceInputPath(workspaceRoot: string, requestedPath: string): string | undefined {
  const requested = requestedPath.replace(/^\.\//, '').replace(/\\/g, '/');
  const requestedBasename = nodePath.basename(requested);
  const matches: string[] = [];
  let visitedDirectories = 0;
  const visit = (current: string, depth: number): void => {
    if (matches.length > 1 || depth < 0 || visitedDirectories >= 2_000 || isExcludedPath(current)) return;
    visitedDirectories += 1;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (matches.length > 1) return;
      const absolute = nodePath.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absolute, depth - 1);
        continue;
      }
      if (!entry.isFile() || entry.name !== requestedBasename) continue;
      const relative = nodePath.relative(workspaceRoot, absolute).replace(/\\/g, '/');
      if (requested.includes('/') && relative !== requested && !relative.endsWith(`/${requested}`)) continue;
      matches.push(absolute);
    }
  };
  visit(workspaceRoot, 8);
  return matches.length === 1 ? matches[0] : undefined;
}

function extractExistingAbsolutePaths(text: string): string[] {
  const result: string[] = [];
  let match: RegExpExecArray | null;
  POSIX_ABSOLUTE_PATH_RE.lastIndex = 0;
  while ((match = POSIX_ABSOLUTE_PATH_RE.exec(text)) !== null) {
    const normalized = normalizeCandidatePath(match[0]);
    if (!normalized || !fs.existsSync(normalized)) continue;
    result.push(normalized);
  }
  return uniquePaths(result);
}

function normalizeCandidatePath(value: string): string {
  return value
    .replace(/[)\]}>，。；;：:,.]+$/g, '')
    .replace(/\/+$/g, '')
    .trim();
}

function collectSourceFiles(dir: string, maxDepth: number, maxFiles: number): string[] {
  const result: string[] = [];
  const visit = (current: string, depth: number) => {
    if (result.length >= maxFiles || depth < 0 || isExcludedPath(current)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.length >= maxFiles) break;
      const absPath = nodePath.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absPath, depth - 1);
      } else if (entry.isFile() && shouldReadSourceFile(absPath)) {
        result.push(absPath);
      }
    }
  };
  visit(dir, maxDepth);
  return result;
}

function shouldCollectProjectCommunicationEvidence(contract: TaskContract): boolean {
  return hasQualityObligation(contract, 'project-communication-chain');
}

function collectProjectCommunicationEvidence(
  explicitPaths: string[],
  workspaceRoot: string,
  targetAbsPath: string,
): { files: string[]; roots: string[] } {
  const roots = inferProjectCommunicationRoots(explicitPaths, workspaceRoot, targetAbsPath);
  const files = uniquePaths(
    roots.flatMap(root => collectCommunicationSourceFiles(root, 4, 10)),
  ).slice(0, Math.max(0, MAX_EVIDENCE_FILES));
  return { files, roots };
}

function inferProjectCommunicationRoots(
  explicitPaths: string[],
  workspaceRoot: string,
  targetAbsPath: string,
): string[] {
  const roots: string[] = [];
  for (const absPath of [...explicitPaths, targetAbsPath, workspaceRoot]) {
    for (const candidate of projectSourceRootCandidates(absPath)) {
      if (!candidate || !isDirectory(candidate) || isExcludedPath(candidate)) continue;
      roots.push(candidate);
    }
  }
  return uniquePaths(roots).slice(0, 4);
}

function projectSourceRootCandidates(absPath: string): string[] {
  const normalized = nodePath.normalize(absPath || '');
  if (!normalized) return [];
  const asDir = isDirectory(normalized) ? normalized : nodePath.dirname(normalized);
  const candidates = [asDir];
  const posix = normalized.replace(/\\/g, '/');
  const oamSrc = posix.match(/^(.*\/src\/oam\/src)(?:\/|$)/);
  if (oamSrc?.[1]) candidates.push(oamSrc[1]);
  const srcRoot = posix.match(/^(.*\/src)(?:\/|$)/);
  if (srcRoot?.[1]) candidates.push(srcRoot[1]);
  return uniquePaths(candidates.map(value => nodePath.normalize(value)));
}

function collectCommunicationSourceFiles(root: string, maxDepth: number, maxFiles: number): string[] {
  const result: string[] = [];
  const scanLimit = Math.max(maxFiles * 4, maxFiles);
  const visit = (current: string, depth: number) => {
    if (depth < 0 || result.length >= scanLimit || isExcludedPath(current)) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (result.length >= scanLimit) break;
      const absPath = nodePath.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(absPath, depth - 1);
      } else if (entry.isFile() && shouldReadCommunicationSourceFile(absPath)) {
        result.push(absPath);
      }
    }
  };
  visit(root, maxDepth);
  return result
    .sort((a, b) => communicationFilePriority(a) - communicationFilePriority(b) || a.localeCompare(b))
    .slice(0, maxFiles);
}

function shouldReadCommunicationSourceFile(absPath: string): boolean {
  return shouldReadSourceFile(absPath) && COMMUNICATION_SOURCE_FILE_RE.test(nodePath.basename(absPath));
}

function communicationFilePriority(absPath: string): number {
  const base = nodePath.basename(absPath).toLowerCase();
  if (/uart\d+_(?:tx|rx)_main/.test(base)) return 0;
  if (/tunnel/.test(base)) return 1;
  if (/mavlink/.test(base)) return 2;
  if (/publisher|subscriber/.test(base)) return 3;
  if (/license/.test(base)) return 4;
  return 9;
}

function readEvidenceFile(
  absPath: string,
  workspaceRoot: string,
  kind: EvidenceFile['kind'],
  remainingChars: number,
  evidenceStore: EvidenceStore,
  captureWithoutProjection = false,
): EvidenceFile | undefined {
  if (remainingChars <= 0 && !captureWithoutProjection) return undefined;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const limit = Math.max(0, Math.min(MAX_FILE_CHARS, remainingChars));
    const content = limit === 0
      ? ''
      : raw.length > limit
        ? `${raw.slice(0, limit)}\n\n[DevSeek: 文件内容超过本次证据预算，已截断]`
        : raw;
    return {
      absPath,
      relPath: displayPath(workspaceRoot, absPath, absPath),
      kind,
      content,
      truncated: raw.length > limit,
      evidenceRef: evidenceStore.recordFileRead({ path: absPath, content: raw }),
    };
  } catch {
    return undefined;
  }
}

function buildProviderPrompt(
  input: MarkdownDeliverableTaskInput,
  evidence: EvidenceBundle,
  absPath: string,
  contract: TaskContract,
  claimSpecs: ArtifactClaimSpec[],
  verificationFeedback?: string,
): string {
  const relTarget = displayPath(input.workspaceRoot.fsPath, absPath, input.task.file || nodePath.basename(absPath));
  const evidenceText = evidence.files.length > 0
    ? evidence.files.map(file => [
      `### ${evidenceKindHeading(file.kind)}: ${file.relPath}${evidenceProjectionSuffix(file)}`,
      '```text',
      file.content || '[DevSeek: 原文未投影；请以宿主派生的必需源码事实为准]',
      '```',
    ].join('\n')).join('\n\n')
    : '未读取到本地证据文件。';
  const groundedClaimFacts = formatGroundedClaimFacts(claimSpecs, input.workspaceRoot.fsPath);
  const qualityInstructions = [
    contract.evidenceRequirements.length > 0 && contract.verificationContract.exactClaimTable
      ? '这是精确事实报告：第一行必须严格为“# 源码事实报告”；只允许这一个标题；唯一表格表头必须严格为“| Symbol | Value |”；除请求的源码路径行、请求的表格行和请求的精确代码块外，不得加入任何说明或额外事实。'
      : '',
    hasQualityObligation(contract, 'source-evidence')
      ? '逐项引用用户要求的源码事实；常量、路径、数值和字段必须与本地证据原文完全一致，缺少证据时明确阻塞，不得猜测。'
      : '',
    hasQualityObligation(contract, 'protocol-facts')
      ? '协议字段、topic、命令号、分片大小、超时和版本必须引用本地源码证据。'
      : '',
    hasQualityObligation(contract, 'interface-contract')
      ? '按请求提供接口方向、承载通道、schema、错误处理和兼容规则；只有用户要求示例时才提供 request/response 示例。'
      : '',
    hasQualityObligation(contract, 'modification-plan')
      ? '提供既有代码修改清单，包含目标文件、函数/类、原因、风险和验证方式。'
      : '',
    hasQualityObligation(contract, 'project-communication-chain')
      ? '写清证据支持的项目级真实通讯链路和收发入口，不得只写“参考某模块”。'
      : '',
  ].filter(Boolean);
  return [
    '你是顶级编程智能体的文档交付模块。所有文件证据已经由本地运行时读取完毕。',
    '请只输出完整 Markdown 文档正文，不要请求工具，不要输出 [TOOL:...]、Calling、工具执行结果或代码块包裹整个文档。',
    '请使用真实 Markdown 排版：标题、元数据、列表、表格和代码块必须保留换行；不要输出网页复制控件文字，例如“复制”“下载”。',
    ...qualityInstructions,
    verificationFeedback ? '这是唯一一次有界修复。必须修正下面列出的每一项差异，其他已验证内容保持不变。' : '',
    verificationFeedback || '',
    `目标写入路径：${relTarget}`,
    '',
    '## 本文档交付目标',
    input.task.desc || '生成用户要求的 Markdown 建议文档。',
    '',
    '## 用户原始要求',
    input.userPrompt,
    '',
    ...(groundedClaimFacts ? [groundedClaimFacts, ''] : []),
    '## 本地证据',
    evidenceText,
  ].join('\n');
}

function evidenceKindHeading(kind: EvidenceFile['kind']): string {
  if (kind === 'requirement') return '需求文档';
  if (kind === 'claim-source') return '必需源码事实（最高优先级）';
  return '补充源码';
}

function evidenceProjectionSuffix(file: EvidenceFile): string {
  if (!file.content) return '（原文未投影）';
  return file.truncated ? '（已截断）' : '';
}

function formatGroundedClaimFacts(claimSpecs: ArtifactClaimSpec[], workspaceRoot: string): string {
  if (claimSpecs.length === 0) return '';
  return [
    '## 宿主派生的必需源码事实（最高优先级）',
    '以下值由本地运行时从完整源码 EvidenceRef 派生；补充源码或模型先验不得覆盖：',
    '```json',
    formatArtifactClaimSpecsForPrompt(claimSpecs.map(spec => ({
      ...spec,
      sourcePath: displayPath(workspaceRoot, spec.sourcePath, spec.sourcePath),
    }))),
    '```',
  ].join('\n');
}

function combineUniquePromptParts(...parts: Array<string | undefined>): string {
  return [...new Set(parts.map(part => String(part || '').trim()).filter(Boolean))].join('\n');
}

function normalizeProviderMarkdown(text: string, contract: TaskContract): string | undefined {
  const integrity = classifyProviderOutputIntegrity(text);
  if (!integrity.okForSettlement) return undefined;
  let trimmed = unwrapMarkdownFence(stripToolCallBlocks(text).trim());
  if (BAD_PROVIDER_REPORT_RE.test(trimmed)) return undefined;
  trimmed = normalizeProviderMarkdownDocumentText(trimmed);
  const strictFactReport = contract.verificationContract.requireSourceClaimGrounding
    && !!contract.verificationContract.exactClaimTable;
  if (trimmed.length < (strictFactReport ? 1 : REPORT_MIN_CHARS)) return undefined;
  if (!/(?:^|\n)#{1,3}\s+\S/.test(trimmed)) {
    trimmed = `# Markdown 建议文档\n\n${trimmed}`;
  }
  const minHeadingCount = contract.evidenceRequirements.length > 0 ? 1 : 2;
  if (!hasAcceptableMarkdownDocumentShape(trimmed, { minHeadingCount })) return undefined;
  return ensureFinalNewline(trimmed);
}

function ensureFormalInterfaceExamples(
  markdown: string | undefined,
  promptText: string,
  semanticContract?: TaskSemanticContract,
): string | undefined {
  if (!markdown) return undefined;
  const quality = assessFormalProjectDocumentQuality(markdown, promptText, semanticContract);
  if (!quality.required || !quality.requiresRemoteControllerInterface) return markdown;
  if (quality.hasInterfaceRequestExample && quality.hasInterfaceResponseExample && quality.hasInterfaceFencedJsonExample) return markdown;
  const requestJson = findInlineJsonExample(markdown, 'request')
    || '{"type":"platform_status","requestId":"r1","metrics":{"flightSorties":120},"version":1}';
  const responseJson = findInlineJsonExample(markdown, 'response')
    || '{"type":"warranty_status","requestId":"r1","level":"expiring_soon","errorCode":0,"version":1}';
  return ensureFinalNewline(`${markdown.trimEnd()}\n\n${buildInterfaceExampleBlock(requestJson, responseJson)}`);
}

function buildInterfaceExampleBlock(requestJson: string, responseJson: string): string {
  return ['### request JSON 示例', '', '```json', requestJson, '```', '', '### response JSON 示例', '', '```json', responseJson, '```'].join('\n');
}

function findInlineJsonExample(markdown: string, label: 'request' | 'response'): string | undefined {
  const match = new RegExp(`示例\\s*${label}\\s*[:：]`, 'i').exec(markdown);
  if (!match) return undefined;
  const tail = markdown.slice(match.index + match[0].length);
  const braceIndex = tail.indexOf('{');
  return braceIndex < 0 ? undefined : extractBalancedJsonObject(tail, braceIndex);
}

function extractBalancedJsonObject(text: string, startIndex: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(startIndex, index + 1).trim();
  }
  return undefined;
}

function describeProviderMarkdownRejection(
  text: string,
  integrityKind: ProviderOutputIntegrityKind,
  contract: TaskContract,
): string {
  const trimmed = normalizeProviderMarkdownDocumentText(unwrapMarkdownFence(stripToolCallBlocks(text).trim()));
  if (BAD_PROVIDER_REPORT_RE.test(trimmed)) {
    return `${integrityKind}: Provider 返回包含工具调用痕迹，不能作为最终 Markdown 文档。`;
  }
  if (hasProviderCopyControlArtifact(trimmed)) {
    return `${integrityKind}: Provider 返回包含网页复制控件残留，不能作为最终 Markdown 文档。`;
  }
  const strictFactReport = contract.verificationContract.requireSourceClaimGrounding
    && !!contract.verificationContract.exactClaimTable;
  if (trimmed.length < (strictFactReport ? 1 : REPORT_MIN_CHARS)) {
    return `${integrityKind}: Provider 返回正文过短（${trimmed.length} 字符），不能作为完整交付物。`;
  }
  if (!hasAcceptableMarkdownDocumentShape(trimmed)) {
    return `${integrityKind}: Provider 返回的 Markdown 结构异常，不能作为完整交付物。`;
  }
  return `${integrityKind}: ${describeProviderOutputIntegrity(integrityKind)}`;
}

function describeEvidenceSummary(evidence: EvidenceBundle): string {
  const requirementCount = evidence.files.filter(file => file.kind === 'requirement').length;
  const claimSourceCount = evidence.files.filter(file => file.kind === 'claim-source').length;
  const supportingSourceCount = evidence.files.filter(file => file.kind === 'supporting-source').length;
  const truncatedCount = evidence.files.filter(file => file.content && file.truncated).length;
  const omittedProjectionCount = evidence.files.filter(file => !file.content).length;
  const labels = evidence.files.slice(0, 6).map(file => {
    const prefix = file.kind === 'requirement'
      ? '需求'
      : file.kind === 'claim-source'
        ? '必需源码'
        : '补充源码';
    const suffix = !file.content ? '（原文未投影）' : file.truncated ? '（截断）' : '';
    return `${prefix}:${file.relPath}${suffix}`;
  });
  const omitted = evidence.files.length > labels.length
    ? `，另 ${evidence.files.length - labels.length} 个文件`
    : '';
  return [
    `证据：需求文档 ${requirementCount} 个，必需源码 ${claimSourceCount} 个，补充源码 ${supportingSourceCount} 个。`,
    labels.length > 0 ? `已读取：${labels.join('、')}${omitted}。` : '',
    evidence.sourceDirs.length > 0 ? `扫描目录：${evidence.sourceDirs.length} 个。` : '',
    truncatedCount > 0 ? `有 ${truncatedCount} 个文件按证据预算截断。` : '',
    omittedProjectionCount > 0 ? `有 ${omittedProjectionCount} 个必需源码仅以宿主派生事实投影，完整原文保留在 EvidenceStore。` : '',
  ].filter(Boolean).join('\n');
}

function buildFallbackMarkdown(input: {
  userPrompt: string;
  targetRelPath: string;
  deliveryObjective: string;
  evidence: EvidenceBundle;
  reason: string;
}): string {
  const requirementFiles = input.evidence.files.filter(file => file.kind === 'requirement');
  const sourceFiles = input.evidence.files
    .filter(file => file.kind !== 'requirement')
    .map(file => file.content
      ? file
      : { ...file, content: file.evidenceRef.content || '', truncated: false });
  const requirementDigest = requirementFiles
    .map(file => `### ${file.relPath}\n${extractImportantLines(file.content, 28)}`)
    .join('\n\n') || '- 未读取到需求文档正文，请检查用户提供路径是否有效。';
  const sourceDigest = sourceFiles
    .map(file => `### ${file.relPath}\n${extractSourceResponsibilities(file.content)}`)
    .join('\n\n') || '- 未读取到旧实现源码，请补充旧实现路径后复核。';
  const sourceFactMatrix = buildSourceFactMatrix(sourceFiles);
  const interfaceSection = buildRemoteControllerInterfaceFallback(input.deliveryObjective, input.userPrompt);
  const modificationPlan = buildExistingCodeModificationPlan(sourceFiles);
  const sourceList = sourceFiles.length > 0
    ? sourceFiles.map(file => `- ${file.relPath}${file.truncated ? '（已截断）' : ''}`).join('\n')
    : '- 无';

  return ensureFinalNewline([
    fallbackTitleForObjective(input.deliveryObjective),
    '',
    `> 生成说明：Provider 未返回可用的完整报告（${input.reason}）。DevSeek 已基于本地读取的证据生成本 Markdown 交付物，避免任务在无产物状态下结算。`,
    '',
    '## 本文档目标',
    '',
    input.deliveryObjective || '生成用户要求的 Markdown 建议文档。',
    '',
    '## 用户要求',
    '',
    input.userPrompt.trim() || '未提供用户要求。',
    '',
    '## 本地证据清单',
    '',
    `- 目标文档：${input.targetRelPath}`,
    `- 需求文档：${requirementFiles.length} 个`,
    `- 旧实现/参考文件：${sourceFiles.length} 个`,
    sourceList,
    '',
    '## 需求摘要',
    '',
    requirementDigest,
    '',
    '## 旧实现职责观察',
    '',
    sourceDigest,
    '',
    '## 源项目事实矩阵',
    '',
    sourceFactMatrix,
    '',
    '## 遥控器与主控接口文档',
    '',
    interfaceSection,
    '',
    '## 实现对策',
    '',
    fallbackFocusedDesignAdvice(input.deliveryObjective),
    '',
    '1. 先把新需求拆成状态、阈值、持久化、事件发布、复位/主控协同五类能力，避免把所有逻辑堆入单个管理类。',
    '2. 以现有旧实现文件为边界梳理职责：数据采集只产出事实，阈值引擎只判断触发条件，状态机只管理状态迁移，持久化只负责版本化读写。',
    '3. 主控逻辑只消费状态机输出的事件或快照，不直接重复计算阈值，防止多处判断不一致。',
    '4. JSON 或协议字段扩展必须显式版本化，并保持缺省值兼容，避免旧数据启动时触发异常状态。',
    '5. 每个新增状态迁移都要配套复位、重复触发抑制和日志证据，保证后续回放能解释为什么进入该状态。',
    '',
    '## 主控任务拆分',
    '',
    '- 对照需求文档确认新增字段、事件、状态和阈值命名。',
    '- 更新维保统计结构和序列化字段，补齐默认值与版本升级策略。',
    '- 重构阈值计算为独立服务，并提供可单测的输入输出。',
    '- 扩展状态机迁移表，覆盖正常、接近阈值、超阈值、已提醒、已复位等路径。',
    '- 接入事件发布或主控消费接口，避免主控直接读取内部临时状态。',
    '- 增加回放测试和异常恢复测试，覆盖旧数据、断电重启、重复提醒和手动复位。',
    '',
    '## 原有代码修改清单',
    '',
    modificationPlan,
    '',
    '## 风险与验证建议',
    '',
    '- 风险：模型正文生成失败时，文档内容可能只有本地证据级分析，需要人工复核需求细节。',
    '- 风险：如果旧实现目录未完整提供，职责观察只能覆盖已读取文件。',
    '- 验证：使用需求文档中的典型阈值构造单元测试，检查状态迁移和事件发布是否一一对应。',
    '- 验证：用旧版本持久化数据启动，确认默认值、版本迁移和复位逻辑可恢复。',
  ].join('\n'));
}

function fallbackTitleForObjective(objective: string): string {
  if (isRemoteControllerInterfaceObjective(objective)) {
    return '# 01 遥控器与主控交互接口设计';
  }
  if (isMainControlLogicObjective(objective)) {
    return '# 02 主控维保提醒逻辑实现设计';
  }
  return '# 维保提醒需求分析与实现建议';
}

function buildSourceFactMatrix(sourceFiles: EvidenceFile[]): string {
  const rows = sourceFiles.flatMap(file => extractSourceFactRows(file)).slice(0, 14);
  if (rows.length === 0) {
    return [
      '| 源文件 | 原项目事实 | 复用/约束方式 |',
      '|--------|------------|----------------|',
      '| 待补充 | 当前证据预算内未提取到常量、协议字段或关键函数 | 继续读取原项目代码后补齐，不能只写“参考某模块” |',
    ].join('\n');
  }
  return [
    '| 源文件 | 原项目事实 | 复用/约束方式 |',
    '|--------|------------|----------------|',
    ...rows.map(row => `| \`${row.ref}\` | ${escapeTableCell(row.fact)} | ${row.reuse} |`),
  ].join('\n');
}

function extractSourceFactRows(file: EvidenceFile): Array<{ ref: string; fact: string; reuse: string }> {
  const rows: Array<{ ref: string; fact: string; reuse: string }> = [];
  const lines = file.content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!isSourceFactLine(line)) continue;
    rows.push({
      ref: `${file.relPath}:${index + 1}`,
      fact: line.slice(0, 180),
      reuse: describeSourceFactReuse(line),
    });
    if (rows.length >= 4) break;
  }
  return rows;
}

function isSourceFactLine(line: string): boolean {
  return /(?:constexpr|#define|enum class|struct|class|static const|const char\*|UAV_EVENT|COMMAND_LONG|MAVLINK|TUNNEL|Tunnel|topic|payload|sessionId|payloadLen|totalLen|crc32|seq|timeout|Timeout|Retry|retry|Publisher|publish|route|Route)/.test(line)
    && !/^\s*(?:\/\/|\*)/.test(line);
}

function describeSourceFactReuse(line: string): string {
  if (/(?:topic|Publisher|publish|\/uav\/)/i.test(line)) {
    return '通信 topic 和发布边界必须与原项目保持一致。';
  }
  if (/(?:Tunnel|MAVLINK|payload|sessionId|payloadLen|totalLen|crc32|seq)/.test(line)) {
    return '分片、会话、CRC 和 payload 字段需要沿用或明确隔离。';
  }
  if (/(?:constexpr|#define|enum|Timeout|timeout|Retry|retry)/.test(line)) {
    return '关键常量、枚举和超时策略需要写入接口约束。';
  }
  if (/(?:class|struct)/.test(line)) {
    return '类型职责和模块边界需要作为集成锚点。';
  }
  return '作为正式项目设计约束，不得泛化为口头参考。';
}

function buildRemoteControllerInterfaceFallback(objective: string, userPrompt: string): string {
  const requested = isRemoteControllerInterfaceObjective(`${objective}\n${userPrompt}`)
    || /(?:主控|平台|接口|通信|通讯|JSON|MAVLink|tunnel|license)/i.test(`${objective}\n${userPrompt}`);
  if (!requested) {
    return '- 当前任务未明确要求遥控器/主控接口；若后续接入通信链路，需要补充方向、承载、字段、错误码和示例。';
  }
  return [
    '| 方向 | 承载通道 | 消息类型 | request JSON/schema 字段 | response JSON/schema 字段 |',
    '|------|----------|----------|--------------------------|---------------------------|',
    '| 遥控器 -> 主控 | 参考原项目 tunnel/topic 证据确认 | `platform_status` / `maintenance_verified` | `requestId`、`deviceId`、`statisticsCutoffAt`、`metrics`、`thresholds`、`version` | `accepted`、`errorCode`、`errorMessage` |',
    '| 主控 -> 遥控器 | 参考主控发布器或 MAVLink tunnel | `warranty_status` / `compensation_report` | `requestId`、`status`、`level`、`triggerReason`、`updatedAtMs`、`version` | `ack`、`errorCode` |',
    '',
    '### request JSON 示例',
    '',
    '```json',
    '{"type":"platform_status","requestId":"r1","metrics":{"flightSorties":120},"version":1}',
    '```',
    '',
    '### response JSON 示例',
    '',
    '```json',
    '{"type":"warranty_status","requestId":"r1","level":"expiring_soon","errorCode":0,"version":1}',
    '```',
    '',
    '- 分片/超时/重试/幂等：必须从原项目 tunnel 常量和 session 规则取值；若证据不足，本节标记为待补证，不允许直接落正式协议。',
  ].join('\n');
}

function buildExistingCodeModificationPlan(sourceFiles: EvidenceFile[]): string {
  const candidates = sourceFiles
    .flatMap(file => extractModificationCandidates(file))
    .slice(0, 8);
  if (candidates.length === 0) {
    return [
      '| 目标文件 | 函数/类 | 改动内容 | 原因 | 风险 | 验证方式 |',
      '|----------|---------|----------|------|------|----------|',
      '| 待补充 | 待补充 | 继续读取主入口、调度和发布器代码后再确定 | 避免孤岛实现 | 接入点错误 | 源码审计 + 编译/单测 |',
    ].join('\n');
  }
  return [
    '| 目标文件 | 函数/类 | 改动内容 | 原因 | 风险 | 验证方式 |',
    '|----------|---------|----------|------|------|----------|',
    ...candidates.map(item => `| \`${item.ref}\` | ${escapeTableCell(item.symbol)} | ${item.change} | ${item.reason} | ${item.risk} | ${item.validation} |`),
  ].join('\n');
}

function extractModificationCandidates(file: EvidenceFile): Array<{
  ref: string;
  symbol: string;
  change: string;
  reason: string;
  risk: string;
  validation: string;
}> {
  const rows: Array<{
    ref: string;
    symbol: string;
    change: string;
    reason: string;
    risk: string;
    validation: string;
  }> = [];
  const lines = file.content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const match = line.match(/(?:class|struct)\s+([A-Za-z_]\w*)|(?:bool|void|int|double|float|std::string)\s+([A-Za-z_]\w*)\s*\(|([A-Za-z_]\w*)\s*=\s*.+createPubTopic/);
    if (!match) continue;
    const symbol = match[1] || match[2] || match[3] || '待确认';
    rows.push({
      ref: `${file.relPath}:${index + 1}`,
      symbol,
      change: '作为正式集成候选点，需要明确新增调用、注入或复用方式。',
      reason: '保持新功能嵌入既有主流程。',
      risk: '生命周期、线程安全或 topic/协议冲突。',
      validation: '编译、单测、运行日志和接口回放。',
    });
    if (rows.length >= 3) break;
  }
  return rows;
}

function escapeTableCell(value: string): string {
  return String(value || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function fallbackFocusedDesignAdvice(objective: string): string {
  if (isRemoteControllerInterfaceObjective(objective)) {
    return [
      '### 遥控器与主控交互接口',
      '',
      '- 遥控器职责：对接平台接口，接收平台 JSON 数据，完成基础校验、时间戳补齐和字段归一化。',
      '- 转发边界：遥控器只转发平台维保相关输入和主控输出结果，不在遥控器侧重复计算维保阈值。',
      '- 主控输入：主控接收平台维保参数、设备身份、累计统计基线和复位/确认命令。',
      '- 主控输出：主控返回是否需要维保提醒、提醒等级、触发维度、建议动作、更新时间和错误码。',
      '- 协议建议：接口文档应固定 request/response JSON schema、字段单位、枚举值、超时重试、幂等键和版本号。',
    ].join('\n');
  }
  if (isMainControlLogicObjective(objective)) {
    return [
      '### 主控逻辑实现',
      '',
      '- 线程模型：新增独立维保提醒线程，按固定 tick 周期读取遥控器转发数据和本地累计统计。',
      '- 统计职责：主控统一计算作业次数、飞行时长、日历周期、维保确认和复位后的累计状态。',
      '- 状态机：将 NORMAL/NOTICE/WARNING/OVERDUE/RESETTING 等状态集中结算，输出单一可信结果。',
      '- 持久化：统计基线、上次提醒、确认状态和版本号需要原子写入，并支持旧数据迁移。',
      '- 验证任务：覆盖首次启动、重启恢复、平台数据缺失、重复复位、阈值边界和遥控器通信异常。',
    ].join('\n');
  }
  return '';
}

function isRemoteControllerInterfaceObjective(objective: string): boolean {
  return /(?:遥控器|遥控).{0,80}(?:接口|交互|平台|json)|(?:接口|交互).{0,80}(?:遥控器|遥控)/i.test(objective);
}

function isMainControlLogicObjective(objective: string): boolean {
  return /(?:主控维保提醒逻辑实现设计|主控).{0,80}(?:逻辑实现|实现设计|独立线程|统计计算|状态机|持久化)|(?:逻辑实现|实现设计|独立线程|统计计算|状态机).{0,80}(?:主控)/i.test(objective);
}

function extractImportantLines(content: string, maxLines: number): string {
  const important = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => /^(?:#{1,6}\s+|[-*]\s+|\d+\.\s+)|(?:需求|目标|状态|阈值|维保|提醒|主控|协议|事件|JSON|UAV_EVENT|复位|持久化)/i.test(line))
    .slice(0, maxLines);
  const lines = important.length > 0
    ? important
    : content.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, maxLines);
  return lines.map(line => `- ${line.replace(/^[-*]\s+/, '')}`).join('\n') || '- 未提取到有效摘要。';
}

function extractSourceResponsibilities(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /(?:class|struct|enum|namespace|void|bool|int|double|float|Maintenance|maintenance|threshold|state|persist|publish|reset|collect)/.test(line))
    .slice(0, 16);
  if (!lines.length) return '- 未提取到明显的类型或函数声明，需人工复核文件正文。';
  return lines.map(line => `- ${line.slice(0, 180)}`).join('\n');
}

async function postMarkdownStatus(
  input: MarkdownDeliverableTaskInput,
  state: 'started' | 'completed' | 'failed',
  basename: string,
  detail: string | MarkdownStatusOptions,
  diff?: { added: number; removed: number },
): Promise<void> {
  const options: MarkdownStatusOptions = typeof detail === 'string'
    ? { detail, diff }
    : detail;
  try {
    await input.callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: input.task.id,
      taskFile: basename,
      taskAction: input.task.action,
      taskDesc: input.task.desc,
      taskIndex: input.taskIndex,
      taskTotal: input.taskTotal,
      state,
      title: options.title || input.task.desc || basename,
      detail: options.detail,
      ...(options.diff ? { linesAdded: options.diff.added, linesRemoved: options.diff.removed } : {}),
    });
  } catch {
    // UI/telemetry delivery is best-effort and must not rewrite filesystem truth.
  }
}

function buildWrittenFileEvidence(
  filePath: string,
  action: string,
  linesAdded = 0,
  linesRemoved = 0,
): WrittenFileEvidence {
  return {
    path: filePath,
    basename: nodePath.basename(filePath),
    linesAdded,
    linesRemoved,
    action,
  };
}

function displayPath(workspaceRoot: string, absPath: string, fallback: string): string {
  const rel = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return fallback;
  return rel;
}

function summarizeActivityPaths(paths: string[], workspaceRoot: string): string {
  const labels = paths.map(pathValue => displayPath(workspaceRoot, pathValue, pathValue));
  if (labels.length <= 2) return labels.join('、');
  return `${labels.slice(0, 2).join('、')} 等 ${labels.length} 个目录`;
}

function unwrapMarkdownFence(text: string): string {
  const match = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : text;
}

function ensureFinalNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function isMarkdownPath(absPath: string): boolean {
  return /\.(?:md|markdown)$/i.test(nodePath.basename(absPath));
}

function shouldReadSourceFile(absPath: string): boolean {
  return SOURCE_EXTENSIONS.has(nodePath.extname(absPath).toLowerCase()) && !isExcludedPath(absPath);
}

function isExcludedPath(absPath: string): boolean {
  return absPath.split(/[\\/]+/).some(part => EXCLUDED_DIR_NAMES.has(part));
}

function isFile(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(pathValue => nodePath.normalize(pathValue)))];
}
