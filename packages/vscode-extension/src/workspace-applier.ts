import * as vscode from 'vscode';
import * as nodePath from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ChangeAction, createChangeAction, ResolvedGeneratedArtifact } from './change-plan';
import { GeneratedArtifact, GeneratedFile, looksLikeRawToolCallText, parseGeneratedArtifacts } from './generated-file-parser';
import type { CppValidationPolicy } from './validation-planner';
import { getWorkspaceRootUri } from './workspace-roots';
import { isFileProtected } from './protected-files';
import {
  WorkspacePathContext,
  alignRelPathToScope,
  buildWorkspacePathContext,
  detectWriteDriftForRelPaths,
  normalizeWorkspaceTargetPath,
  resolveArtifactPathInWorkspace,
  resolveGeneratedArtifactPathForPrompt as resolveGeneratedArtifactPathInWorkspaceForPrompt,
  isGeneratedArtifactAllowedForPrompt,
} from './workspace/path-resolver';
import { createChangeSet } from './workspace/change-set';
import {
  WorkspaceEditService,
  type WorkspaceTextFileBaseline,
  type WorkspaceTextFileCommitToken,
} from './workspace/edit-service';
import { ReviewLedger, type ReviewLedgerSnapshot } from './workspace/review-ledger';
import {
  ValidationService,
  type AutoValidationResult,
  type ValidationCommandRunner,
} from './workspace/validation-service';
import { QualityGateService, type QualityGateDecision } from './app/quality-gate-service';
import { shouldBlockProjectInstructionFileWrite } from './workspace/instruction-file-safety';
import { findGeneratedSourceSanityIssue, repairGeneratedSourceTransportEscapes } from './workspace/source-sanity';
import { createWorkspaceFilePathTokenRegExp } from './workspace/path-patterns';

interface ApplyWorkflowStatusBase {
  state: 'started' | 'completed' | 'skipped' | 'passed' | 'failed';
  title: string;
  detail?: string;
}

export type ApplyWorkflowStatus =
  | (ApplyWorkflowStatusBase & { phase: 'apply' | 'repair'; operationId?: never })
  | (ApplyWorkflowStatusBase & {
      phase: 'validate' | 'quality';
      /** One correlation id for exactly one verification + quality-gate pair. */
      operationId: string;
    });

export interface ApplyWorkflowResult {
  applied: boolean;
  changeCount: number;
  changedPaths: string[];
  failureReason?: 'no-artifacts' | 'user-cancelled' | 'path-drift' | 'protected-file' | 'truncating-overwrite' | 'source-sanity' | 'write-conflict';
  failureDetail?: string;
  blockedChangePaths?: string[];
  validation?: AutoValidationResult;
  qualityGate?: QualityGateDecision;
  rolledBack?: boolean;
  review?: ReviewLedgerSnapshot;
}

export interface AppliedChangeRecord {
  path: string;
  existed: boolean;
  oldContent: string;
  newContent: string;
}

type ApplyWorkflowReporter = (status: ApplyWorkflowStatus) => void | Thenable<void>;
type AppliedChangeReporter = (change: AppliedChangeRecord) => void | Thenable<void>;

export interface ApplyGeneratedArtifactsOptions {
  /**
   * Defaults to false. Validation failures should preserve edits for user
   * review/repair; callers must opt in when rollback is truly desired.
   */
  rollbackOnValidationFailure?: boolean;
  /** Product callers inject the terminal side-effect authority here. */
  validationCommandRunner?: ValidationCommandRunner;
}

interface PreparedChange {
  action: ChangeAction;
  targetUri: vscode.Uri;
  relPath: string;
  exists: boolean;
  oldContent: string;
  newContent: string;
  baseline: WorkspaceTextFileBaseline;
}

export async function previewGeneratedArtifactsWithPrompt(raw: string, requestPrompt?: string): Promise<void> {
  const prepared = await prepareChanges(raw, requestPrompt);
  if (prepared.length === 0) {
    vscode.window.showInformationMessage('DeepSeek: 未检测到可应用的文件或 diff。');
    return;
  }

  await previewPreparedChanges(prepared, 'DeepSeek: 选择要预览的文件');
}

export async function previewGeneratedArtifactPathWithPrompt(raw: string, targetPath: string, requestPrompt?: string): Promise<void> {
  const prepared = await prepareChanges(raw, requestPrompt);
  const selected = selectPreparedChangesByPath(prepared, targetPath);
  if (selected.length === 0) {
    vscode.window.showInformationMessage(`DeepSeek: 未找到目标文件变更：${targetPath}`);
    return;
  }

  await previewPreparedChanges(selected, `DeepSeek: 目标匹配到 ${selected.length} 个变更，选择要预览的文件`);
}

export async function applyGeneratedArtifactsWithPrompt(
  raw: string,
  requestPrompt?: string,
  reporter?: ApplyWorkflowReporter,
  autoApply = false,
  onAppliedChange?: AppliedChangeReporter,
  preferredAbsolutePaths?: string[],
  options?: ApplyGeneratedArtifactsOptions,
): Promise<ApplyWorkflowResult> {
  const prepared = await prepareChanges(raw, requestPrompt, preferredAbsolutePaths);
  return applyPreparedChanges(prepared, reporter, autoApply, undefined, requestPrompt, onAppliedChange, preferredAbsolutePaths, options);
}

export async function applyGeneratedArtifactPathWithPrompt(
  raw: string,
  targetPath: string,
  requestPrompt?: string,
  reporter?: ApplyWorkflowReporter,
  autoApply = false,
  onAppliedChange?: AppliedChangeReporter,
  preferredAbsolutePaths?: string[],
  options?: ApplyGeneratedArtifactsOptions,
): Promise<ApplyWorkflowResult> {
  const prepared = await prepareChanges(raw, requestPrompt, preferredAbsolutePaths);
  let selected = selectPreparedChangesByPath(prepared, targetPath);
  if (selected.length === 0) {
    selected = await prepareTargetScopedFallbackChanges(raw, targetPath, requestPrompt, preferredAbsolutePaths);
  }
  const candidatePaths = selected.length === 0 ? prepared.map((change) => change.relPath) : [];
  return applyPreparedChanges(
    selected,
    reporter,
    autoApply,
    targetPath,
    requestPrompt,
    onAppliedChange,
    preferredAbsolutePaths,
    options,
    candidatePaths,
  );
}

export function looksLikeTargetScopedSourceResponse(
  raw: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): boolean {
  const root = getWorkspaceRoot(requestPrompt, preferredAbsolutePaths);
  if (!root || !preferredAbsolutePaths || preferredAbsolutePaths.length === 0) return false;

  const pathContext = buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths);
  return selectPreferredTargetScopedFallbackPaths(raw, pathContext).length === 1;
}

async function applyPreparedChanges(
  preparedInput: PreparedChange[],
  reporter?: ApplyWorkflowReporter,
  autoApply = false,
  targetPathForMsg?: string,
  requestPrompt?: string,
  onAppliedChange?: AppliedChangeReporter,
  preferredAbsolutePaths?: string[],
  options?: ApplyGeneratedArtifactsOptions,
  nonTargetCandidatePaths: string[] = [],
): Promise<ApplyWorkflowResult> {
  const prepared = normalizePreparedSourceTransportEscapes(preparedInput);
  const root = getWorkspaceRoot(requestPrompt, preferredAbsolutePaths);
  const pathContext = root ? buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths) : undefined;
  const rollbackOnValidationFailure = options?.rollbackOnValidationFailure === true;
  if (prepared.length === 0) {
    const candidateDetail = nonTargetCandidatePaths.length > 0
      ? `；检测到非目标候选：${nonTargetCandidatePaths.slice(0, 6).join('、')}`
      : '';
    if (targetPathForMsg) {
      vscode.window.showInformationMessage(`DeepSeek: 未检测到可应用的目标文件变更：${targetPathForMsg}${candidateDetail}`);
    } else {
      vscode.window.showInformationMessage('DeepSeek: 未检测到可应用的文件或 diff。');
    }
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
      failureReason: 'no-artifacts',
      failureDetail: targetPathForMsg
        ? `未检测到可应用的目标文件变更：${targetPathForMsg}${candidateDetail}`
        : '未检测到可应用的文件或 diff。',
      ...(nonTargetCandidatePaths.length > 0 ? { blockedChangePaths: nonTargetCandidatePaths } : {}),
    };
  }

  const changeSet = createChangeSetFromPrepared(prepared);
  const ledger = new ReviewLedger();
  const workspaceEditService = new WorkspaceEditService();
  const qualityGateService = new QualityGateService();
  ledger.recordChangeSet(changeSet);
  const summary = changeSet.summary();
  if (!autoApply) {
    const choice = await vscode.window.showWarningMessage(
      `DeepSeek 将应用 ${prepared.length} 个文件变更（新建 ${summary.creates}，覆盖 ${summary.overwrites}，局部补丁 ${summary.patches}）。是否继续？`,
      { modal: false },
      '预览第一个',
      '应用全部',
      '取消',
    );

    if (choice === '预览第一个') {
      await openPreview(prepared[0]);
      const applyAfterPreview = await vscode.window.showInformationMessage('是否应用全部 DeepSeek 文件变更？', '应用全部', '取消');
      if (applyAfterPreview !== '应用全部') {
        ledger.addUnfinishedItem('用户取消应用文件变更');
        return {
          applied: false,
          changeCount: 0,
          changedPaths: [],
          failureReason: 'user-cancelled',
          failureDetail: '用户预览后取消应用文件变更。',
          blockedChangePaths: changeSet.changedPaths,
          review: ledger.snapshot(),
        };
      }
    } else if (choice !== '应用全部') {
      ledger.addUnfinishedItem('用户取消应用文件变更');
      return {
        applied: false,
        changeCount: 0,
        changedPaths: [],
        failureReason: 'user-cancelled',
        failureDetail: '用户取消应用文件变更。',
        blockedChangePaths: changeSet.changedPaths,
        review: ledger.snapshot(),
      };
    }
  }

  // Detect drift BEFORE writing — if any file would land in the wrong place, abort cleanly
  // without touching the workspace at all.
  const drift = detectWriteDrift(prepared, root, pathContext);
  if (drift) {
    await reportWorkflow(reporter, {
      phase: 'apply',
      state: 'failed',
      title: '已阻止写入（路径漂移）',
      detail: drift,
    });
    vscode.window.showErrorMessage('DeepSeek: 检测到路径漂移，本轮变更已阻止，工作区未作任何修改。');
    ledger.addUnfinishedItem('路径漂移阻止写入，需要重新确认目标文件路径');
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
      failureReason: 'path-drift',
      failureDetail: drift,
      blockedChangePaths: changeSet.changedPaths,
      review: ledger.snapshot(),
    };
  }

  const protectedChange = prepared.find((change) => isFileProtected(change.targetUri.fsPath, root?.fsPath ?? ''));
  if (protectedChange) {
    const rel = protectedChange.relPath || nodePath.basename(protectedChange.targetUri.fsPath);
    await reportWorkflow(reporter, {
      phase: 'apply',
      state: 'failed',
      title: '已阻止写入（受保护文件）',
      detail: `${rel} 匹配 devseek.protectedFiles 规则`,
    });
    vscode.window.showErrorMessage(`DeepSeek: 已阻止写入受保护文件 ${rel}。`);
    ledger.addUnfinishedItem(`受保护文件阻止写入: ${rel}`);
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
      failureReason: 'protected-file',
      failureDetail: `${rel} 匹配 devseek.protectedFiles 规则`,
      blockedChangePaths: changeSet.changedPaths,
      review: ledger.snapshot(),
    };
  }

  const truncatingOverwrite = prepared.find((change) => isSuspiciousTruncatingOverwrite(change, requestPrompt));
  if (truncatingOverwrite) {
    const detail = buildTruncatingOverwriteDetail(truncatingOverwrite);
    await reportWorkflow(reporter, {
      phase: 'apply',
      state: 'failed',
      title: '已阻止写入（疑似截断覆盖）',
      detail,
    });
    vscode.window.showErrorMessage(`DeepSeek: 已阻止 ${truncatingOverwrite.relPath} 的疑似截断覆盖，本轮未写入文件。`);
    ledger.addUnfinishedItem(`疑似截断覆盖阻止写入: ${truncatingOverwrite.relPath}`);
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
      failureReason: 'truncating-overwrite',
      failureDetail: detail,
      blockedChangePaths: changeSet.changedPaths,
      review: ledger.snapshot(),
    };
  }

  const sourceSanityFailure = findSourceSanityFailure(prepared);
  if (sourceSanityFailure) {
    await reportWorkflow(reporter, {
      phase: 'apply',
      state: 'failed',
      title: '已阻止写入（源码语法护栏）',
      detail: sourceSanityFailure.detail,
    });
    vscode.window.showErrorMessage(`DeepSeek: 已阻止 ${sourceSanityFailure.relPath} 的高风险源码写入。`);
    ledger.addUnfinishedItem(`源码语法护栏阻止写入: ${sourceSanityFailure.relPath}`);
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
      failureReason: 'source-sanity',
      failureDetail: sourceSanityFailure.detail,
      blockedChangePaths: [sourceSanityFailure.relPath],
      review: ledger.snapshot(),
    };
  }

  await reportWorkflow(reporter, {
    phase: 'apply',
    state: 'started',
    title: '正在应用文件变更',
    detail: `共 ${prepared.length} 个变更，新建 ${summary.creates}，覆盖 ${summary.overwrites}，补丁 ${summary.patches}${targetPathForMsg ? `\n目标: ${targetPathForMsg}` : ''}`,
  });

  const createdDirs = new Set<string>();
  const commitTokens: WorkspaceTextFileCommitToken[] = [];
  let applyFailure: string | undefined;
  let applyRollbackComplete = true;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'DeepSeek: 正在应用文件变更...', cancellable: false },
    async () => {
      try {
        for (const change of prepared) {
          const parentFsPath = nodePath.dirname(change.targetUri.fsPath);
          for (const dir of collectMissingParentDirs(parentFsPath, root?.fsPath)) {
            createdDirs.add(dir);
          }
          const proposal = workspaceEditService.proposeTextFileWrite(change.targetUri.fsPath, change.newContent);
          const committed = workspaceEditService.commitTextFileProposal(proposal, change.baseline, {
            validateSourceSanity: true,
            repairSourceTransportEscapes: true,
          });
          commitTokens.push(committed.commitToken);
        }
      } catch (error) {
        const rollbackFailure = await rollbackCommittedChanges(commitTokens, createdDirs, workspaceEditService);
        applyRollbackComplete = !rollbackFailure;
        applyFailure = [
          error instanceof Error ? error.message : String(error),
          rollbackFailure ? `rollback: ${rollbackFailure}` : '',
        ].filter(Boolean).join('\n');
      }
    },
  );

  if (applyFailure) {
    await reportWorkflow(reporter, {
      phase: 'apply',
      state: 'failed',
      title: '文件应用失败（写入冲突）',
      detail: applyFailure,
    });
    ledger.addUnfinishedItem(`文件应用失败: ${applyFailure}`);
    vscode.window.showErrorMessage('DeepSeek: 文件在确认后发生变化，本轮写入已阻止。');
    return {
      applied: !applyRollbackComplete,
      changeCount: applyRollbackComplete ? 0 : commitTokens.length,
      changedPaths: applyRollbackComplete ? [] : changeSet.changedPaths,
      failureReason: 'write-conflict',
      failureDetail: applyFailure,
      blockedChangePaths: changeSet.changedPaths,
      rolledBack: applyRollbackComplete,
      review: ledger.snapshot(),
    };
  }

  vscode.window.showInformationMessage(`DeepSeek: 已应用 ${prepared.length} 个文件变更`);
  await vscode.window.showTextDocument(prepared[0].targetUri, { preview: false });

  await reportWorkflow(reporter, {
    phase: 'apply',
    state: 'completed',
    title: '文件应用完成',
    detail: prepared.slice(0, 6).map((change) => change.relPath).join('\n'),
  });

  const validationOperationId = `vscode-workspace-validation-${crypto.randomUUID()}`;
  await reportWorkflow(reporter, {
    phase: 'validate',
    operationId: validationOperationId,
    state: 'started',
    title: '正在执行自动编译/验证',
    detail: '根据变更路径自动选择构建命令',
  });

  const validation = await runAutoValidation(
    prepared.map((p) => p.relPath),
    root,
    requestPrompt,
    options?.validationCommandRunner,
  );
  if (!validation || validation.status === 'blocked' || validation.ran === false) {
    if (validation) {
      ledger.recordValidation(validation);
    } else {
      ledger.recordValidationSkipped('no-auto-validation-target');
    }
    const qualityGate = qualityGateService.evaluate({
      changedPaths: changeSet.changedPaths,
      validation: validation ?? null,
    });
    ledger.recordQualityGate(qualityGate);
    ledger.addUnfinishedItem('QualityGate 阻塞：缺少自动验证证据');
    await reportWorkflow(reporter, {
      phase: 'validate',
      operationId: validationOperationId,
      state: 'skipped',
      title: '自动验证阻塞',
      detail: validation
        ? `原因: ${validation.reason || 'no-auto-validation-target'}\n${validation.output.trim().slice(0, 1200)}`
        : '未识别到可自动验证的目标（bridge / extension / C++ 目录项目）。',
    });
    await reportWorkflow(reporter, {
      phase: 'quality',
      operationId: validationOperationId,
      state: 'failed',
      title: 'QualityGate 阻塞',
      detail: renderQualityGateDetail(qualityGate),
    });
    await reportAppliedChanges(prepared, onAppliedChange);
    return {
      applied: true,
      changeCount: summary.total,
      changedPaths: changeSet.changedPaths,
      ...(validation ? { validation } : {}),
      qualityGate,
      review: ledger.snapshot(),
    };
  }

  ledger.recordValidation(validation);
  await reportWorkflow(reporter, {
    phase: 'validate',
    operationId: validationOperationId,
    state: validation.ok ? 'passed' : 'failed',
    title: validation.ok ? '自动验证通过' : '自动验证失败',
    detail: `模式: ${validation.mode || 'unknown'}\n原因: ${validation.reason || 'n/a'}\n命令: ${validation.command}\nexitCode: ${validation.exitCode ?? 'null'}\n${validation.output.trim().slice(0, 1200)}`,
  });

  const qualityGate = qualityGateService.evaluate({
    changedPaths: changeSet.changedPaths,
    validation,
  });
  ledger.recordQualityGate(qualityGate);
  await reportWorkflow(reporter, {
    phase: 'quality',
    operationId: validationOperationId,
    state: qualityGate.status === 'pass' ? 'passed' : 'failed',
    title: qualityGate.status === 'pass'
      ? 'QualityGate 通过'
      : qualityGate.status === 'fail'
        ? 'QualityGate 未通过'
        : 'QualityGate 阻塞',
    detail: renderQualityGateDetail(qualityGate),
  });

  if (!validation.ok && autoApply && rollbackOnValidationFailure) {
    const rollbackFailure = await rollbackCommittedChanges(commitTokens, createdDirs, workspaceEditService);
    if (rollbackFailure) {
      ledger.addUnfinishedItem(`自动验证失败且安全回滚未完成: ${rollbackFailure}`);
      await reportWorkflow(reporter, {
        phase: 'apply',
        state: 'failed',
        title: '自动验证失败，安全回滚未完成',
        detail: rollbackFailure,
      });
      vscode.window.showErrorMessage('DeepSeek: 自动验证失败，且工作区在回滚前又发生变化；已停止继续覆盖。');
      return {
        applied: true,
        changeCount: summary.total,
        changedPaths: changeSet.changedPaths,
        validation,
        qualityGate,
        rolledBack: false,
        review: ledger.snapshot(),
      };
    }
    ledger.addUnfinishedItem('自动验证失败，文件变更已回滚');
    await reportWorkflow(reporter, {
      phase: 'apply',
      state: 'completed',
      title: '自动验证失败，已回滚文件变更',
      detail: prepared.slice(0, 6).map((change) => change.relPath).join('\n'),
    });
    vscode.window.showErrorMessage('DeepSeek: 自动验证失败，本轮自动应用的文件变更已回滚。');
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
      validation,
      qualityGate,
      rolledBack: true,
      review: ledger.snapshot(),
    };
  }

  if (qualityGate.status === 'fail') {
    ledger.addUnfinishedItem('自动验证失败，需要根据验证输出继续修复');
  } else if (qualityGate.status === 'blocked') {
    ledger.addUnfinishedItem('QualityGate 阻塞：需要补充验证或用户确认风险');
  }
  await reportAppliedChanges(prepared, onAppliedChange);

  return {
    applied: true,
    changeCount: summary.total,
    changedPaths: changeSet.changedPaths,
    validation,
    qualityGate,
    review: ledger.snapshot(),
  };
}

function normalizePreparedSourceTransportEscapes(prepared: PreparedChange[]): PreparedChange[] {
  return prepared.map((change) => {
    const repaired = repairGeneratedSourceTransportEscapes(change.relPath, change.newContent);
    if (!repaired.repaired) return change;
    return {
      ...change,
      newContent: repaired.content,
    };
  });
}

function createChangeSetFromPrepared(prepared: PreparedChange[]) {
  return createChangeSet(prepared.map(change => ({
    path: change.relPath,
    existed: change.exists,
    oldContent: change.oldContent,
    newContent: change.newContent,
    actionType: change.action.type,
  })));
}

async function reportAppliedChanges(
  prepared: PreparedChange[],
  onAppliedChange?: AppliedChangeReporter,
): Promise<void> {
  if (!onAppliedChange) return;
  for (const change of prepared) {
    await onAppliedChange({
      path: change.relPath,
      existed: change.exists,
      oldContent: change.oldContent,
      newContent: change.newContent,
    });
  }
}

function selectPreparedChangesByPath(prepared: PreparedChange[], targetPath: string): PreparedChange[] {
  const wanted = normalizeTargetPath(targetPath);
  if (!wanted) return [];

  const exact = prepared.filter((change) => normalizeTargetPath(change.relPath) === wanted);
  if (exact.length > 0) return exact;

  const fileName = nodePath.posix.basename(wanted);
  if (!fileName) return [];
  return prepared.filter((change) => nodePath.posix.basename(normalizeTargetPath(change.relPath) || '') === fileName);
}

function normalizeTargetPath(path: string): string {
  return normalizeWorkspaceTargetPath(path);
}

async function prepareChanges(raw: string, requestPrompt?: string, preferredAbsolutePaths?: string[]): Promise<PreparedChange[]> {
  const root = getWorkspaceRoot(requestPrompt, preferredAbsolutePaths);
  if (!root) throw new Error('DeepSeek: 当前没有打开工作区，无法写入文件。');
  const pathContext = buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths);

  let artifacts = parseGeneratedArtifacts(raw);
  if (artifacts.length === 0) {
    const targetScoped = await preparePreferredTargetScopedFallbackChanges(raw, requestPrompt, preferredAbsolutePaths);
    if (targetScoped.length > 0) return targetScoped;
  }

  const fallbackArtifacts = inferFallbackArtifacts(raw, requestPrompt, root);
  if (artifacts.length === 0) {
    artifacts = fallbackArtifacts;
  } else {
    const uniquePaths = new Set(artifacts.map((a) => a.path)).size;
    if (looksLikeBrokenSingleFileParse(artifacts) && fallbackArtifacts.length > 0) {
      artifacts = fallbackArtifacts;
    } else if (uniquePaths <= 1 && fallbackArtifacts.length > uniquePaths) {
      artifacts = fallbackArtifacts;
    }
  }
  if (artifacts.length === 0) return [];

  const changes: PreparedChange[] = [];
  for (const artifact of artifacts) {
    const resolvedPath = resolveArtifactPathInWorkspace(artifact.path, root, pathContext);
    if (!resolvedPath) continue;
    const relPath = alignRelPathToScope(resolvedPath, root, pathContext);
    if (!isGeneratedArtifactAllowedForPrompt(relPath, requestPrompt, preferredAbsolutePaths)) continue;

    const resolved: ResolvedGeneratedArtifact = {
      ...(artifact as GeneratedArtifact),
      resolvedPath: relPath,
      confidence: relPath.includes('/') ? 'high' : 'medium',
      reason: 'response-explicit-path',
    } as ResolvedGeneratedArtifact;

    const targetUri = vscode.Uri.joinPath(root, ...relPath.split('/'));
    const baseline = new WorkspaceEditService().captureTextFileBaseline(targetUri.fsPath, root.fsPath);
    const exists = baseline.snapshot.existed;
    const action = createChangeAction(resolved, exists);
    const oldContent = baseline.snapshot.content;
    const newContent = action.type === 'patch-file'
      ? applyUnifiedDiff(oldContent, action.diff, relPath)
      : ensureFinalNewline(action.content);
    if (looksLikeRawToolCallText(newContent)) continue;
    if (shouldBlockProjectInstructionFileWrite({ filePath: relPath, content: newContent, requestPrompt })) continue;

    changes.push({ action, targetUri, relPath, exists, oldContent, newContent, baseline });
  }

  const deduped = dedupeChanges(changes);
  if (deduped.length > 0) return deduped;

  return preparePreferredTargetScopedFallbackChanges(raw, requestPrompt, preferredAbsolutePaths);
}

async function preparePreferredTargetScopedFallbackChanges(
  raw: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): Promise<PreparedChange[]> {
  const root = getWorkspaceRoot(requestPrompt, preferredAbsolutePaths);
  if (!root || !preferredAbsolutePaths || preferredAbsolutePaths.length === 0) return [];

  const pathContext = buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths);
  const candidates = selectPreferredTargetScopedFallbackPaths(raw, pathContext);
  if (candidates.length !== 1) return [];

  return prepareTargetScopedFallbackChanges(raw, candidates[0], requestPrompt, preferredAbsolutePaths);
}

async function prepareTargetScopedFallbackChanges(
  raw: string,
  targetPath: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): Promise<PreparedChange[]> {
  const root = getWorkspaceRoot(requestPrompt, preferredAbsolutePaths);
  if (!root) return [];
  const pathContext = buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths);
  const resolvedPath = resolveArtifactPathInWorkspace(targetPath, root, pathContext);
  if (!resolvedPath) return [];
  const relPath = alignRelPathToScope(resolvedPath, root, pathContext);
  if (!isGeneratedArtifactAllowedForPrompt(relPath, requestPrompt, preferredAbsolutePaths)) return [];

  const targetUri = vscode.Uri.joinPath(root, ...relPath.split('/'));
  const baseline = new WorkspaceEditService().captureTextFileBaseline(targetUri.fsPath, root.fsPath);
  const exists = baseline.snapshot.existed;
  const oldContent = baseline.snapshot.content;
  const content = selectTargetScopedFallbackContent(raw, relPath, oldContent, requestPrompt);
  if (!content) return [];
  if (looksLikeRawToolCallText(content)) return [];
  if (shouldBlockProjectInstructionFileWrite({ filePath: relPath, content, requestPrompt })) return [];

  const resolved: ResolvedGeneratedArtifact = {
    type: 'file',
    path: relPath,
    language: guessLanguage(relPath),
    content,
    resolvedPath: relPath,
    confidence: 'medium',
    reason: 'target-scoped-fallback',
  };
  const action = createChangeAction(resolved, exists);
  const newContent = action.type === 'patch-file'
    ? applyUnifiedDiff(oldContent, action.diff, relPath)
    : ensureFinalNewline(action.content);
  return [{ action, targetUri, relPath, exists, oldContent, newContent, baseline }];
}

export function resolveGeneratedArtifactPathForPrompt(
  rawPath: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): string {
  return resolveGeneratedArtifactPathInWorkspaceForPrompt(rawPath, requestPrompt, preferredAbsolutePaths);
}

function detectWriteDrift(
  prepared: PreparedChange[],
  root: vscode.Uri | undefined,
  ctx: WorkspacePathContext | undefined,
): string | undefined {
  void root;
  return detectWriteDriftForRelPaths(prepared.map((change) => change.relPath), ctx);
}

function isSuspiciousTruncatingOverwrite(change: PreparedChange, requestPrompt?: string): boolean {
  if (change.action.type !== 'overwrite-file' || !change.exists) return false;
  if (allowsLargeRewrite(requestPrompt)) return false;

  const oldContent = change.oldContent.trim();
  const newContent = change.newContent.trim();
  if (oldContent.length < 400) return false;
  if (!newContent) return true;

  const oldLines = countMeaningfulLines(oldContent);
  const newLines = countMeaningfulLines(newContent);
  const shortByBytes = newContent.length < Math.max(120, oldContent.length * 0.25);
  const shortByLines = oldLines >= 40 && newLines < Math.max(8, oldLines * 0.35);
  return shortByBytes || shortByLines;
}

function findSourceSanityFailure(prepared: PreparedChange[]): { relPath: string; detail: string } | undefined {
  for (const change of prepared) {
    const issue = findGeneratedSourceSanityIssue(change.relPath, change.newContent);
    if (!issue) continue;
    return {
      relPath: change.relPath,
      detail: `${change.relPath}: ${issue.detail}`,
    };
  }
  return undefined;
}

function allowsLargeRewrite(requestPrompt?: string): boolean {
  const text = String(requestPrompt || '');
  if (/(重写|重新实现|从零|全量覆盖|替换整个|rewrite|reimplement|from\s+scratch|replace\s+(?:the\s+)?entire)/i.test(text)) {
    return true;
  }
  return /(清空|删除|移除|clear|delete|remove)/i.test(text)
    && /(文件|整个|全部|全量|file|\.[A-Za-z0-9]+(?:\s|$|[，。,.]))/i.test(text);
}

function countMeaningfulLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function buildTruncatingOverwriteDetail(change: PreparedChange): string {
  const oldLines = countMeaningfulLines(change.oldContent);
  const newLines = countMeaningfulLines(change.newContent);
  return [
    `${change.relPath} 原文件约 ${oldLines} 行，新候选约 ${newLines} 行。`,
    '当前请求不是明确的整文件重写/删除，已按安全策略阻止写入。',
    '请让模型输出局部 diff，或明确说明要整文件重写后再执行。',
  ].join('\n');
}

async function rollbackCommittedChanges(
  commitTokens: WorkspaceTextFileCommitToken[],
  createdDirs?: Set<string>,
  workspaceEditService = new WorkspaceEditService(),
): Promise<string | undefined> {
  const failures: string[] = [];
  for (const token of [...commitTokens].reverse()) {
    const result = workspaceEditService.rollbackTextFileCommit(token);
    if (!result.rolledBack) {
      failures.push(`${nodePath.basename(token.absPath)}: ${result.reason ?? 'unknown rollback failure'}`);
    }
  }

  await cleanupCreatedEmptyDirs(createdDirs);
  return failures.length > 0 ? failures.join('; ') : undefined;
}

function collectMissingParentDirs(parentFsPath: string, rootFsPath?: string): string[] {
  if (!rootFsPath) return [];
  const root = nodePath.resolve(rootFsPath);
  let current = nodePath.resolve(parentFsPath);
  const dirs: string[] = [];

  while (current && current !== root && current.startsWith(root + nodePath.sep)) {
    if (!fs.existsSync(current)) {
      dirs.push(current);
    }
    const next = nodePath.dirname(current);
    if (next === current) break;
    current = next;
  }

  return dirs.reverse();
}

async function cleanupCreatedEmptyDirs(createdDirs?: Set<string>): Promise<void> {
  if (!createdDirs || createdDirs.size === 0) return;
  const dirs = [...createdDirs].sort((a, b) => b.length - a.length);
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
      if (entries.length > 0) continue;
      await vscode.workspace.fs.delete(vscode.Uri.file(dir), { useTrash: false });
    } catch {
      // Best-effort cleanup: rollback correctness is about file contents first.
    }
  }
}

function inferFallbackArtifacts(raw: string, requestPrompt: string | undefined, root: vscode.Uri): GeneratedArtifact[] {
  const sectionArtifacts = inferNumberedSectionArtifacts(raw, requestPrompt, root);
  if (sectionArtifacts.length > 0) return sectionArtifacts;

  const blocks = extractCodeBlocks(raw).filter((b) => {
    if (!b.content.trim()) return false;
    if (/^diff|patch$/i.test(b.language || '')) return false;
    if (looksLikeFileTreeBlock(b.content) || looksLikeClassDiagramBlock(b.content)) return false;
    return true;
  });
  if (blocks.length === 0) return [];

  const explicitPath = inferPathFromText(`${requestPrompt || ''}\n${raw}`);
  const filePath = explicitPath || inferDefaultPathFromLanguage(blocks[0].language, root);
  if (!filePath) return [];

  const artifact: GeneratedFile = {
    type: 'file',
    path: filePath,
    language: blocks[0].language,
    content: blocks[0].content,
  };
  return [artifact];
}

function inferNumberedSectionArtifacts(raw: string, requestPrompt: string | undefined, root: vscode.Uri): GeneratedArtifact[] {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const sectionRe = new RegExp(`^\\s*\\d+[.)]\\s+${createWorkspaceFilePathTokenRegExp('').source}(?:\\s*[-—–:：].*)?\\s*$`, 'i');
  const headingIndexes: Array<{ idx: number; path: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(sectionRe);
    if (m) headingIndexes.push({ idx: i, path: m[1] });
  }
  if (headingIndexes.length < 2) return [];

  const projectRootFromTree = inferProjectTreeRoot(lines);
  const topicDir = inferTopicDirectoryName(requestPrompt || raw, root);
  const baseDir = projectRootFromTree || topicDir;
  const artifacts: GeneratedArtifact[] = [];

  for (let i = 0; i < headingIndexes.length; i++) {
    const start = headingIndexes[i].idx + 1;
    const end = i + 1 < headingIndexes.length ? headingIndexes[i + 1].idx : lines.length;
    const rawContent = lines.slice(start, end).join('\n');
    const content = cleanNarrativeSectionContent(rawContent);
    if (!content) continue;
    if (looksLikeFileTreeBlock(content) || looksLikeClassDiagramBlock(content)) continue;

    const path = headingIndexes[i].path.includes('/')
      ? headingIndexes[i].path
      : joinPath(baseDir, headingIndexes[i].path);
    if (!isLikelySourceForPath(content, path)) continue;

    artifacts.push({
      type: 'file',
      path,
      language: guessLanguage(path),
      content,
    });
  }

  return dedupeArtifactsByPath(artifacts);
}

function extractCodeBlocks(text: string): Array<{ language?: string; content: string }> {
  const blocks: Array<{ language?: string; content: string }> = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const language = (m[1] || '').trim().split(/\s+/)[0] || undefined;
    const content = (m[2] || '').trim();
    if (!content) continue;
    if (/^(bash|shell|sh|zsh|console)$/i.test(language || '') && !content.includes('#include') && !content.includes('def ') && !content.includes('class ')) {
      continue;
    }
    blocks.push({ language, content });
  }
  return blocks;
}

function inferProjectTreeRoot(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^([A-Za-z0-9_.-]+)\/$/);
    if (!m) continue;
    const root = m[1];
    const nextChunk = lines.slice(i + 1, i + 8).join('\n');
    if (/[├└]──\s+/.test(nextChunk)) {
      return root.replace(/^\.?\/?/, '').replace(/\/$/, '');
    }
  }
  return undefined;
}

function inferTopicDirectoryName(text: string, root: vscode.Uri): string {
  const source = text.toLowerCase();
  const hasCodeDir = require('fs').existsSync(nodePath.join(root.fsPath, 'code'));
  const base = hasCodeDir ? 'code' : '';

  let topic = 'generated-snippet';
  if (/c\+\+|cpp|类|继承|多态|层次|shape|circle|rect/.test(source)) {
    topic = 'class-hierarchy';
  } else if (/python|py/.test(source)) {
    topic = 'python-demo';
  } else if (/react|tsx|jsx/.test(source)) {
    topic = 'frontend-demo';
  }
  return joinPath(base, topic);
}

function cleanNarrativeSectionContent(text: string): string {
  const cleaned = text
    .split('\n')
    .filter((line) => !/^\s*(插入|复制)\s*$/i.test(line.trim()))
    .join('\n')
    .trim();

  if (!cleaned) return '';
  const fenced = cleaned.match(/```[^\n`]*\n([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  return cleaned;
}

function looksLikeFileTreeBlock(content: string): boolean {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const treeLike = lines.filter((l) => /[├└]──|\|--|`--/.test(l) || /\w+\/$/.test(l));
  return treeLike.length >= Math.max(2, Math.floor(lines.length / 2));
}

function looksLikeClassDiagramBlock(content: string): boolean {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const boxChars = lines.filter((l) => /[┌┐└┘│─▼▲]/.test(l));
  return boxChars.length >= Math.max(3, Math.floor(lines.length / 2));
}

function isLikelySourceForPath(content: string, path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const c = content.trim();
  if (!c) return false;
  if (looksLikeFileTreeBlock(c) || looksLikeClassDiagramBlock(c)) return false;
  if (/^(?:g\+\+|gcc|clang\+\+|clang|cmake|make|npm|python)\b/im.test(c)) return false;

  if (['h', 'hpp', 'c', 'cc', 'cpp', 'cxx'].includes(ext)) {
    return /#include|#ifndef|#define|#pragma\s+once|class\s+\w+|int\s+main\s*\(|\{[\s\S]*\}/m.test(c);
  }
  if (ext === 'py') return /def\s+\w+\(|class\s+\w+|if\s+__name__\s*==\s*['"]__main__['"]/.test(c);
  if (ext === 'ts' || ext === 'js' || ext === 'tsx' || ext === 'jsx') {
    return /(?:export\s+|import\s+|function\s+|class\s+|const\s+\w+\s*=)/.test(c);
  }
  return c.length >= 20;
}

function dedupeArtifactsByPath(artifacts: GeneratedArtifact[]): GeneratedArtifact[] {
  const seen = new Set<string>();
  const result: GeneratedArtifact[] = [];
  for (const artifact of artifacts) {
    if (seen.has(artifact.path)) continue;
    seen.add(artifact.path);
    result.push(artifact);
  }
  return result;
}

function looksLikeBrokenSingleFileParse(artifacts: GeneratedArtifact[]): boolean {
  if (artifacts.length !== 1) return false;
  const first = artifacts[0];
  if (first.type !== 'file') return false;
  return looksLikeFileTreeBlock(first.content) || looksLikeClassDiagramBlock(first.content);
}

function selectPreferredTargetScopedFallbackPaths(raw: string, ctx: WorkspacePathContext): string[] {
  const blocks = extractTargetScopedCodeBlocks(raw);
  if (blocks.length !== 1) return [];

  const block = blocks[0];
  const hintedFiles = [...new Set(ctx.hintedFiles)]
    .filter((relPath) => isCodeLikeRelPath(relPath));
  if (hintedFiles.length === 0) return [];

  const semanticMatches = hintedFiles
    .filter((relPath) => languageMatchesRelPath(block.language, relPath, block.content))
    .filter((relPath) => contentTargetsRelPath(block.content, relPath));
  if (semanticMatches.length > 0) return semanticMatches;

  const languageMatches = hintedFiles
    .filter((relPath) => languageMatchesRelPath(block.language, relPath, block.content));
  if (languageMatches.length === 1) return languageMatches;

  return hintedFiles.length === 1 ? hintedFiles : [];
}

function extractTargetScopedCodeBlocks(raw: string): Array<{ language?: string; content: string }> {
  const fencedBlocks = extractCodeBlocks(raw).filter((block) => {
    if (/^diff|patch$/i.test(block.language || '')) return false;
    if (looksLikeFileTreeBlock(block.content) || looksLikeClassDiagramBlock(block.content)) return false;
    return true;
  });
  if (fencedBlocks.length > 0) return fencedBlocks;
  return extractPlainSourceBlocks(raw);
}

function selectTargetScopedFallbackContent(raw: string, relPath: string, oldContent: string, requestPrompt?: string): string | undefined {
  const blocks = extractTargetScopedCodeBlocks(raw);
  for (const block of blocks) {
    const content = block.content.trim();
    if (isSafeTargetScopedFullFile(content, relPath, oldContent, `${requestPrompt || ''}\n${raw}`)) return content;
  }
  return undefined;
}

function extractPlainSourceBlocks(raw: string): Array<{ language?: string; content: string }> {
  const normalized = (raw || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];

  const lines = normalized.split('\n');
  const start = findPlainSourceStartLine(lines);
  if (start < 0) return [];

  const content = trimPlainSourceCandidate(lines.slice(start).join('\n'));
  if (!content) return [];

  return [{ language: inferPlainSourceLanguage(content), content }];
}

function findPlainSourceStartLine(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (isStrongPlainSourceStartLine(lines[i])) return i;
  }
  return -1;
}

function trimPlainSourceCandidate(text: string): string {
  const lines = text.split('\n');
  const kept: string[] = [];
  let braceBalance = 0;
  let strongLines = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (kept.length > 0 && strongLines >= 4 && braceBalance <= 0 && isPlainSourceStopLine(trimmed)) {
      break;
    }

    kept.push(line);
    if (isPlainSourceLine(trimmed)) strongLines++;
    braceBalance += countChar(line, '{') - countChar(line, '}');
  }

  while (kept.length > 0) {
    const last = kept[kept.length - 1].trim();
    if (!last || isPlainSourceLine(last)) break;
    kept.pop();
  }

  const content = kept.join('\n').trim();
  return strongLines >= 3 ? content : '';
}

function isStrongPlainSourceStartLine(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:#\s*(?:include|pragma|ifndef|define)|using\s+namespace\s+|namespace\s+\w+\s*\{|template\s*<|class\s+\w+|struct\s+\w+|enum\s+\w+|\b(?:int|auto)\s+main\s*\()/i.test(trimmed);
}

function isPlainSourceLine(trimmed: string): boolean {
  if (!trimmed) return true;
  if (/^(?:\/\/|\/\*|\*\/|\*)/.test(trimmed)) return true;
  if (/^(?:#\s*(?:include|pragma|ifndef|define|endif)|using\s+namespace\s+|namespace\s+\w+|template\s*<|class\s+\w+|struct\s+\w+|enum\s+\w+)/i.test(trimmed)) return true;
  if (/^(?:public|private|protected)\s*:/.test(trimmed)) return true;
  if (/^[{});]+$/.test(trimmed)) return true;
  return /[;{}]/.test(trimmed)
    || /\b(?:if|for|while|switch|return|case|break|continue)\b/.test(trimmed)
    || /\b(?:int|void|float|double|bool|char|auto|const|static|std::|gl[A-Z]\w*|glut[A-Z]\w*)\b/.test(trimmed);
}

function isPlainSourceStopLine(trimmed: string): boolean {
  if (!trimmed) return false;
  if (isPlainSourceLine(trimmed)) return false;
  if (/^\|.*\|$/.test(trimmed)) return true;
  return /^(?:新增|控制|操作|按键|功能|说明|验证|编译|运行|完成|总结|使用方式|操作提示|每个|以上|这样|注意|下一步|New|Controls?|Usage|Notes?|Summary)\b/i.test(trimmed);
}

function inferPlainSourceLanguage(content: string): string | undefined {
  if (/#\s*include|std::|glut[A-Z]\w*|\bint\s+main\s*\(/.test(content)) return 'cpp';
  if (/\bdef\s+\w+\(|if\s+__name__\s*==/.test(content)) return 'python';
  if (/\b(?:export|import)\s+|function\s+\w+\(|const\s+\w+\s*=/.test(content)) return 'typescript';
  return undefined;
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const current of value) {
    if (current === char) count++;
  }
  return count;
}

function isSafeTargetScopedFullFile(content: string, relPath: string, oldContent: string, sourceText = ''): boolean {
  if (!isLikelySourceForPath(content, relPath)) return false;
  if (!oldContent.trim()) return true;

  const oldLines = countMeaningfulLines(oldContent);
  const newLines = countMeaningfulLines(content);
  if (oldLines >= 12 && newLines < Math.max(8, Math.floor(oldLines * 0.6))) return false;

  const anchor = firstMeaningfulSourceLine(oldContent);
  if (anchor && oldLines >= 8 && !content.includes(anchor) && !looksLikeFullFileRewrite(sourceText)) return false;
  return true;
}

function looksLikeFullFileRewrite(text: string): boolean {
  return /(完整文件|完整代码|完整内容|完整源码|完整源代码|完整版|修改后的完整|替换后的完整|最终文件|直接替换|直接复制|complete\s+file|full\s+file|entire\s+file)/i.test(text);
}

function isCodeLikeRelPath(relPath: string): boolean {
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)$/i.test(relPath)
    || /(?:^|\/)(?:CMakeLists\.txt|Makefile|Dockerfile)$/i.test(relPath);
}

function languageMatchesRelPath(language: string | undefined, relPath: string, content: string): boolean {
  const ext = nodePath.posix.extname(relPath).replace(/^\./, '').toLowerCase();
  const lang = (language || '').toLowerCase();
  if (!lang) return true;
  if (['cpp', 'c++', 'cc', 'cxx'].includes(lang)) return ['cpp', 'cc', 'cxx', 'h', 'hpp'].includes(ext);
  if (lang === 'c') return ['c', 'h'].includes(ext);
  if (lang === 'hpp' || lang === 'h') return ['h', 'hpp'].includes(ext);
  if (lang === 'typescript' || lang === 'ts') return ['ts', 'tsx'].includes(ext);
  if (lang === 'javascript' || lang === 'js') return ['js', 'jsx', 'mjs', 'cjs'].includes(ext);
  if (lang === 'python') return ext === 'py';
  if (lang === 'shell' || lang === 'bash' || lang === 'sh') return ext === 'sh';
  if (lang === 'cmake') return nodePath.posix.basename(relPath) === 'CMakeLists.txt';
  if (ext === lang) return true;
  return isLikelySourceForPath(content, relPath);
}

function contentTargetsRelPath(content: string, relPath: string): boolean {
  const base = nodePath.posix.basename(relPath);
  const stem = base.replace(/\.(?:cpp|cc|cxx|c|h|hpp|ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|sh|sql)$/i, '');
  const escapedStem = escapeRegExp(stem);
  const escapedBase = escapeRegExp(base);

  if (/^main\.(?:cpp|cc|cxx|c)$/i.test(base) && /\b(?:int|auto)?\s*main\s*\(/.test(content)) return true;
  if (new RegExp(`#include\\s+[<"]${escapedBase}[>"]`).test(content)) return true;
  if (new RegExp(`#include\\s+[<"]${escapedStem}\\.(?:h|hpp)[>"]`).test(content) && /\.(?:cpp|cc|cxx)$/i.test(base)) return true;
  if (new RegExp(`\\b(?:class|struct|enum)\\s+${escapedStem}\\b`).test(content)) return true;
  if (new RegExp(`\\b${escapedStem}::`).test(content)) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstMeaningfulSourceLine(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('//') && !line.startsWith('/*') && line !== '{' && line !== '}');
}

function inferPathFromText(text: string): string | undefined {
  const re = createWorkspaceFilePathTokenRegExp();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1].replace(/^\.\//, '').replace(/^\//, '');
    // Skip paths that contain git conflict/SEARCH/REPLACE segment names
    if (candidate.split('/').some((seg) => seg === 'SEARCH' || seg === 'REPLACE')) continue;
    return candidate;
  }
  return undefined;
}

function inferDefaultPathFromLanguage(language: string | undefined, root: vscode.Uri): string | undefined {
  const codeDirExists = nodePath.join(root.fsPath, 'code');
  const hasCodeDir = require('fs').existsSync(codeDirExists);
  const base = hasCodeDir ? 'code' : '';

  const lang = (language || '').toLowerCase();
  if (lang === 'cpp' || lang === 'c++' || lang === 'cc' || lang === 'cxx') return joinPath(base, 'main.cpp');
  if (lang === 'c') return joinPath(base, 'main.c');
  if (lang === 'python' || lang === 'py') return joinPath(base, 'main.py');
  if (lang === 'typescript' || lang === 'ts') return joinPath(base, 'main.ts');
  if (lang === 'tsx') return joinPath(base, 'main.tsx');
  if (lang === 'javascript' || lang === 'js') return joinPath(base, 'main.js');
  if (lang === 'jsx') return joinPath(base, 'main.jsx');
  if (lang === 'java') return joinPath(base, 'Main.java');
  if (lang === 'go') return joinPath(base, 'main.go');
  if (lang === 'rust' || lang === 'rs') return joinPath(base, 'main.rs');
  return joinPath(base, 'main.txt');
}

function joinPath(base: string, file: string): string {
  return base ? `${base}/${file}` : file;
}

async function reportWorkflow(reporter: ApplyWorkflowReporter | undefined, status: ApplyWorkflowStatus): Promise<void> {
  if (!reporter) return;
  await reporter(status);
}

function renderQualityGateDetail(qualityGate: QualityGateDecision): string {
  return [
    qualityGate.summary,
    qualityGate.evidenceRefs.length > 0 ? `证据: ${qualityGate.evidenceRefs.join(', ')}` : '',
    qualityGate.risks.length > 0 ? `风险:\n${qualityGate.risks.map((risk) => `- ${risk}`).join('\n')}` : '',
    qualityGate.alternativeChecks.length > 0 ? `替代检查:\n${qualityGate.alternativeChecks.map((check) => `- ${check}`).join('\n')}` : '',
    qualityGate.requiredActions.length > 0 ? `后续动作:\n${qualityGate.requiredActions.map((action) => `- ${action}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function getWorkspaceRoot(requestPrompt?: string, preferredAbsolutePaths?: string[]): vscode.Uri | undefined {
  return getWorkspaceRootUri(requestPrompt, preferredAbsolutePaths);
}

function ensureFinalNewline(text: string): string {
  return text.endsWith('\n') ? text : text + '\n';
}

function dedupeChanges(changes: PreparedChange[]): PreparedChange[] {
  const byPath = new Map<string, PreparedChange>();
  for (const change of changes) {
    if (!byPath.has(change.relPath)) byPath.set(change.relPath, change);
  }
  return [...byPath.values()];
}

async function openPreview(change: PreparedChange): Promise<void> {
  const language = guessLanguage(change.relPath);
  const doc = await vscode.workspace.openTextDocument({
    content: change.newContent,
    language,
  });

  if (change.exists) {
    await vscode.commands.executeCommand(
      'vscode.diff',
      change.targetUri,
      doc.uri,
      `DeepSeek 预览：${change.relPath}`,
      { preview: true },
    );
  } else {
    const emptyDoc = await vscode.workspace.openTextDocument({
      content: '',
      language,
    });
    await vscode.commands.executeCommand(
      'vscode.diff',
      emptyDoc.uri,
      doc.uri,
      `DeepSeek 新建预览：${change.relPath}`,
      { preview: true },
    );
  }
}

async function previewPreparedChanges(prepared: PreparedChange[], placeHolder: string): Promise<void> {
  if (prepared.length === 1) {
    await openPreview(prepared[0]);
    return;
  }

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: '$(files) 依次预览全部',
        description: `${prepared.length} 个文件`,
        detail: '按顺序打开每个文件的预览视图',
        index: -1,
      },
      ...prepared.map((change, index) => ({
        label: change.relPath,
        description: change.exists ? '修改' : '新建',
        detail: `第 ${index + 1} / ${prepared.length} 个变更`,
        index,
      })),
    ],
    {
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );

  if (!pick) return;

  if (pick.index === -1) {
    for (const change of prepared) {
      await openPreview(change);
    }
    return;
  }

  await openPreview(prepared[pick.index]);
}

function guessLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    py: 'python', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'html',
    yaml: 'yaml', yml: 'yaml', sh: 'shellscript', sql: 'sql', java: 'java', go: 'go', rs: 'rust',
  };
  return ext ? map[ext] : undefined;
}

function applyUnifiedDiff(original: string, diff: string, relPath: string): string {
  const originalLines = original.replace(/\r\n/g, '\n').split('\n');
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === '') originalLines.pop();
  const diffLines = diff.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];
  let oldIndex = 0;

  let i = 0;
  while (i < diffLines.length) {
    const line = diffLines[i];
    if (!line.startsWith('@@')) {
      i++;
      continue;
    }

    const m = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (!m) throw new Error(`DeepSeek: 无法解析 diff hunk（${relPath}）`);

    const oldStart = Number(m[1]);
    const copyUntil = Math.max(0, oldStart - 1);
    while (oldIndex < copyUntil && oldIndex < originalLines.length) {
      result.push(originalLines[oldIndex]);
      oldIndex++;
    }

    i++;
    while (i < diffLines.length && !diffLines[i].startsWith('@@')) {
      const hunkLine = diffLines[i];
      if (hunkLine.startsWith('+')) {
        result.push(hunkLine.slice(1));
      } else if (hunkLine.startsWith('-')) {
        oldIndex++;
      } else if (hunkLine.startsWith(' ')) {
        result.push(hunkLine.slice(1));
        oldIndex++;
      } else if (hunkLine.startsWith('\\ No newline at end of file')) {
        // ignore marker
      }
      i++;
    }
  }

  while (oldIndex < originalLines.length) {
    result.push(originalLines[oldIndex]);
    oldIndex++;
  }

  return ensureFinalNewline(result.join('\n'));
}

async function runAutoValidation(
  changedPaths: string[],
  root?: vscode.Uri,
  requestPrompt?: string,
  validationCommandRunner?: ValidationCommandRunner,
): Promise<AutoValidationResult | null> {
  if (!root) return null;
  const config = vscode.workspace.getConfiguration('devseek');
  const validationService = new ValidationService({ commandRunner: validationCommandRunner });
  return validationService.validateWorkspaceChanges({
    rootFsPath: root.fsPath,
    changedPaths,
    requestPrompt,
    cppValidationPolicy: config.get<CppValidationPolicy>('cppValidationPolicy', 'conservative'),
  });
}
