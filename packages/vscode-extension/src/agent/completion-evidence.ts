import * as fs from 'fs';
import * as nodePath from 'path';
import type {
  CodingKernelTaskContract,
  CodingVerificationReceipt,
} from '@devseek-netai/shared';
import { isCodeArtifactPathValue } from '../artifact-path-kind';
import type { TaskSemanticContract } from '../task-semantic-contract';
import { hasTaskSemanticDoneCondition } from '../intent/task-semantic-obligations';
import { classifyShellCommandEvidence } from '../tools/shell-command-analysis';
import type { VerificationResult } from './evidence-grounding';
import { hasSourceClaimArtifactContract } from './task-contract';

export interface CompletionTodo {
  title: string;
}

export type WrittenFileEvidence = {
  path: string;
  basename: string;
  linesAdded: number;
  linesRemoved: number;
  action: string;
};

export type TerminalEvidenceKind = 'compile' | 'run' | 'test' | 'compile-run' | 'other';

export type TerminalEvidence = {
  command: string;
  workdir?: string;
  kind: TerminalEvidenceKind;
  ok: boolean;
  exitCode: number | null;
  canonicalAction?: {
    actionId: string;
    sequence: number;
    evidenceRefs: readonly string[];
  };
  outputPath?: string;
  detail?: string;
  reviewRequired?: boolean;
};

const READ_ONLY_TERMINAL_EVIDENCE_RE = /\b(?:cat|ls|test|grep|head|tail|sed|wc|stat|file|find|file-readback|workspace-readback|artifact-readback)\b/i;
const FILE_CONTENT_TERMINAL_EVIDENCE_RE = /\b(?:cat|grep|head|tail|sed)\b/i;

export function classifyTerminalEvidenceCommand(command: string): TerminalEvidenceKind {
  return classifyShellCommandEvidence(command) as TerminalEvidenceKind;
}

export function isCodeArtifactPath(filePath: string): boolean {
  return isCodeArtifactPathValue(filePath);
}

function resolveWrittenEvidencePath(filePath: string, workspaceRoot?: string): string {
  if (!filePath) return '';
  if (nodePath.isAbsolute(filePath)) return filePath;
  return workspaceRoot ? nodePath.resolve(workspaceRoot, filePath) : filePath;
}

function writtenEvidenceExists(file: WrittenFileEvidence, workspaceRoot?: string): boolean {
  const absPath = resolveWrittenEvidencePath(file.path, workspaceRoot);
  try {
    return Boolean(absPath && fs.existsSync(absPath));
  } catch {
    return false;
  }
}

function normalizeWrittenFileEvidenceKey(filePath: string, workspaceRoot?: string): string {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) return '';
  const normalizedPath = nodePath.normalize(rawPath).replace(/\\/g, '/');
  if (workspaceRoot) {
    try {
      const normalizedRoot = nodePath.resolve(workspaceRoot);
      const absolutePath = nodePath.isAbsolute(normalizedPath)
        ? normalizedPath
        : nodePath.resolve(normalizedRoot, normalizedPath);
      const relative = nodePath.relative(normalizedRoot, absolutePath).replace(/\\/g, '/');
      if (relative && !relative.startsWith('..') && !nodePath.isAbsolute(relative)) return relative;
    } catch {
      // Keep the normalized input when path projection is unavailable.
    }
  }
  return normalizedPath.replace(/^\.\//, '');
}

export function coalesceWrittenFileEvidence(
  files: readonly WrittenFileEvidence[],
  workspaceRoot?: string,
): WrittenFileEvidence[] {
  const byPath = new Map<string, WrittenFileEvidence>();
  for (const file of files) {
    const key = normalizeWrittenFileEvidenceKey(file.path, workspaceRoot);
    if (!key) continue;
    const previous = byPath.get(key);
    if (!previous) {
      byPath.set(key, { ...file });
      continue;
    }
    const wasCreatedInThisRun = previous.action === 'create';
    byPath.set(key, {
      ...file,
      action: wasCreatedInThisRun ? 'create' : file.action,
      linesAdded: file.linesAdded,
      linesRemoved: wasCreatedInThisRun ? 0 : file.linesRemoved,
    });
  }
  return [...byPath.values()];
}

export function hasReadOnlyAnswerEvidence(raw: string | undefined): boolean {
  return String(raw || '').trim().length > 0;
}

export function isReadOnlyTerminalEvidenceCommand(command: string): boolean {
  return READ_ONLY_TERMINAL_EVIDENCE_RE.test(command || '');
}

export function isFileContentTerminalEvidenceCommand(command: string): boolean {
  return FILE_CONTENT_TERMINAL_EVIDENCE_RE.test(command || '');
}

export function requiresFileChangeEvidence(contract: TaskSemanticContract): boolean {
  if (contract.mutation.prohibited) return false;
  return contract.mutation.requested
    || hasTaskSemanticDoneCondition(contract.completion, 'file-written')
    || hasTaskSemanticDoneCondition(contract.completion, 'code-written');
}

export function requiresCodeArtifactForEvidence(contract: TaskSemanticContract): boolean {
  if (contract.mutation.prohibited) return false;
  return contract.mutation.sourceChange
    || hasTaskSemanticDoneCondition(contract.completion, 'code-written');
}

export function requiresReadEvidence(contract: TaskSemanticContract): boolean {
  return contract.read.requested
    || hasTaskSemanticDoneCondition(contract.completion, 'read-evidence')
    || hasTaskSemanticDoneCondition(contract.completion, 'file-content-read');
}

export function requiresFileContentReadEvidence(contract: TaskSemanticContract): boolean {
  return contract.read.contentRequested
    || hasTaskSemanticDoneCondition(contract.completion, 'file-content-read');
}

export function requiresCommandEvidence(contract: TaskSemanticContract): boolean {
  return contract.validation.requested
    || hasTaskSemanticDoneCondition(contract.completion, 'code-validation-passed')
    || hasTaskSemanticDoneCondition(contract.completion, 'compile-passed')
    || hasTaskSemanticDoneCondition(contract.completion, 'run-passed')
    || hasTaskSemanticDoneCondition(contract.completion, 'test-passed')
    || hasTaskSemanticDoneCondition(contract.completion, 'file-check-passed');
}

function requiresRunEvidence(contract: TaskSemanticContract): boolean {
  return hasTaskSemanticDoneCondition(contract.completion, 'run-passed');
}

function requiresTestEvidence(contract: TaskSemanticContract): boolean {
  return hasTaskSemanticDoneCondition(contract.completion, 'test-passed');
}

export function requiresRuntimeValidation(contract: TaskSemanticContract): boolean {
  return requiresRunEvidence(contract) || requiresTestEvidence(contract);
}

export function requiresFileCheckEvidence(contract: TaskSemanticContract): boolean {
  return hasTaskSemanticDoneCondition(contract.completion, 'file-check-passed');
}

function lastUnclearedTerminalFailure(
  terminalEvidence: readonly TerminalEvidence[],
  failureKinds: ReadonlySet<TerminalEvidenceKind>,
  successKinds: ReadonlySet<TerminalEvidenceKind>,
): TerminalEvidence | undefined {
  let blockingFailure: TerminalEvidence | undefined;
  for (const evidence of terminalEvidence) {
    if (evidence.reviewRequired) {
      blockingFailure = undefined;
      continue;
    }
    if (evidence.ok
      && successKinds.has(evidence.kind)
      && blockingFailure
      && terminalSuccessClearsFailure(evidence, blockingFailure)) {
      blockingFailure = undefined;
      continue;
    }
    if (!evidence.ok && failureKinds.has(evidence.kind)) blockingFailure = evidence;
  }
  return blockingFailure;
}

export function isBlockingTerminalFailureEvidence(evidence: TerminalEvidence): boolean {
  if (evidence.reviewRequired || evidence.ok) return false;
  return evidence.kind !== 'other' || looksLikeValidationShellCommand(evidence.command);
}

export function findBlockingTerminalFailureEvidence(
  evidence: readonly TerminalEvidence[] | undefined,
): TerminalEvidence | undefined {
  if (!evidence?.length) return undefined;
  let blockingFailure: TerminalEvidence | undefined;
  for (const item of evidence) {
    if (item.reviewRequired) {
      blockingFailure = undefined;
      continue;
    }
    if (blockingFailure && terminalSuccessClearsFailure(item, blockingFailure)) {
      blockingFailure = undefined;
    }
    if (isBlockingTerminalFailureEvidence(item)) blockingFailure = item;
  }
  return blockingFailure;
}

function terminalSuccessClearsFailure(success: TerminalEvidence, failure: TerminalEvidence): boolean {
  if (!success.ok) return false;
  if (success.kind === 'compile-run') return isCommandTerminalEvidenceKind(failure.kind);
  if (success.kind === 'run' || success.kind === 'test') {
    return failure.kind === 'compile'
      || failure.kind === 'run'
      || failure.kind === 'test'
      || failure.kind === 'compile-run';
  }
  if (success.kind === 'compile') return failure.kind === 'compile';
  return success.kind === 'other'
    && failure.kind === 'other'
    && looksLikeValidationShellCommand(success.command);
}

function isCommandTerminalEvidenceKind(kind: TerminalEvidenceKind): boolean {
  return kind === 'compile' || kind === 'run' || kind === 'test' || kind === 'compile-run';
}

function looksLikeValidationShellCommand(command: string): boolean {
  const normalized = String(command || '').trim().toLowerCase();
  return /\b(?:test\s+-[efsdx]|wc\s+-c|stat|file|cmake|make|ninja|g\+\+|gcc|clang|ctest|npm\s+(?:test|run\s+(?:test|build|compile))|pnpm\s+(?:test|run\s+(?:test|build|compile))|yarn\s+(?:test|run\s+(?:test|build|compile))|bun\s+(?:test|run\s+(?:test|build|compile))|pytest|go\s+test|cargo\s+test|cargo\s+build|dotnet\s+(?:test|build))\b/.test(normalized);
}

export function getBlockingTerminalFailure(
  terminalEvidence: readonly TerminalEvidence[],
  semanticContract: TaskSemanticContract,
): TerminalEvidence | undefined {
  if (terminalEvidence.length === 0) return undefined;
  const runtimeKinds = new Set<TerminalEvidenceKind>(['run', 'test', 'compile-run']);
  const commandKinds = new Set<TerminalEvidenceKind>(['compile', 'run', 'test', 'compile-run']);

  if (requiresTestEvidence(semanticContract)) {
    return lastUnclearedTerminalFailure(terminalEvidence, runtimeKinds, runtimeKinds);
  }
  if (requiresRunEvidence(semanticContract)) {
    return lastUnclearedTerminalFailure(terminalEvidence, runtimeKinds, runtimeKinds);
  }
  if (requiresCommandEvidence(semanticContract)) {
    return lastUnclearedTerminalFailure(terminalEvidence, commandKinds, commandKinds);
  }
  return undefined;
}

export function describeBlockingTerminalFailure(failure: TerminalEvidence): string {
  const exitCode = failure.exitCode == null ? 'unknown' : String(failure.exitCode);
  const detail = String(failure.detail || '').trim().split(/\r?\n/)[0]?.trim();
  return [
    `验证命令未通过（${failure.kind}, exitCode=${exitCode}）`,
    failure.command ? `命令：${failure.command}` : '',
    detail ? `诊断：${detail}` : '',
  ].filter(Boolean).join('。');
}

export function buildTerminalFailureRepairFeedback(failure: TerminalEvidence, missing: readonly string[]): string {
  return [
    '【系统反馈】刚才的终端验证没有通过，不能结束任务。',
    missing.length > 0 ? `缺少: ${missing.join('、')}` : '',
    `失败命令: ${failure.command}`,
    `exitCode: ${failure.exitCode ?? 'unknown'}`,
    failure.detail ? `诊断: ${failure.detail}` : '',
    '',
    '请继续执行真实修复流程：read_file / grep_search / get_errors 定位根因，使用 create_file / write_file 或 SEARCH/REPLACE 修改文件，然后重新 run_terminal 编译/运行/测试。',
  ].filter(Boolean).join('\n');
}

export interface CompletionEvidenceAssessmentInput {
  writtenFiles: readonly WrittenFileEvidence[];
  terminalEvidence: readonly TerminalEvidence[];
  semanticContract: TaskSemanticContract;
  readEvidencePaths?: readonly string[];
  workspaceRoot?: string;
  verificationResults?: readonly VerificationResult[];
  verificationReceipts?: readonly CodingVerificationReceipt[];
  canonicalTaskContract?: CodingKernelTaskContract;
}

/** Completion is derived only from settled semantic state and concrete local evidence. */
export function assessMissingCompletionEvidence(input: CompletionEvidenceAssessmentInput): string[] {
  const {
    writtenFiles,
    terminalEvidence,
    semanticContract,
    readEvidencePaths = [],
    workspaceRoot,
    verificationResults = [],
    verificationReceipts = [],
    canonicalTaskContract,
  } = input;
  const existingWrittenFiles = coalesceWrittenFileEvidence(writtenFiles, workspaceRoot)
    .filter(file => writtenEvidenceExists(file, workspaceRoot));
  const existingCodeWrites = existingWrittenFiles.filter(file => isCodeArtifactPath(file.path));
  const successfulTerminalEvidence = terminalEvidence.filter(evidence => evidence.ok);
  const hasPassedVerificationReceipt = hasPassedCompletionVerification(verificationReceipts);
  const hasSuccessfulValidationEvidence = hasPassedVerificationReceipt
    || successfulTerminalEvidence.some(evidence => (
      isCommandTerminalEvidenceKind(evidence.kind)
        || (evidence.kind === 'other' && looksLikeValidationShellCommand(evidence.command))
    ));
  const missing: string[] = [];
  const taskContract = semanticContract.taskContract;

  if (hasSourceClaimArtifactContract(taskContract) && taskContract.evidenceRequirements.length === 0) {
    missing.push('未解析的交付物源码事实 claim 契约');
  } else if (hasSourceClaimArtifactContract(taskContract)) {
    const latest = verificationResults.at(-1);
    const expectedSymbols = new Set(taskContract.evidenceRequirements.map(requirement => requirement.symbol));
    const actualSymbols = new Set(latest?.claims.map(claim => claim.symbol) || []);
    if (!latest) {
      missing.push(`交付物源码事实逐项验证结果（${expectedSymbols.size} 项）`);
    } else if (!latest.ok
      || latest.claims.length !== expectedSymbols.size
      || actualSymbols.size !== expectedSymbols.size
      || [...expectedSymbols].some(symbol => !actualSymbols.has(symbol))) {
      missing.push(`未通过的交付物源码事实验证（${latest.differences.join('；') || 'claim 覆盖不完整'}）`);
    }
  }

  const needsFileChange = requiresFileChangeEvidence(semanticContract);
  const needsCodeArtifact = requiresCodeArtifactForEvidence(semanticContract);
  if (needsCodeArtifact && existingCodeWrites.length === 0) {
    missing.push('代码修改结果');
  } else if (needsFileChange && existingWrittenFiles.length === 0) {
    missing.push('文件修改结果');
  }

  const canonicalMutationReadback = canonicalMutationReadbackOwnsInspection(canonicalTaskContract);
  const needsReadEvidence = !canonicalMutationReadback && requiresReadEvidence(semanticContract);
  const needsFileContentReadEvidence = requiresFileContentReadEvidence(semanticContract);
  if (needsReadEvidence) {
    const readConditions = semanticContract.completion.doneIff.filter(condition => (
      condition.kind === 'read-evidence' || condition.kind === 'file-content-read'
    ));
    const hasReadEvidence = readConditions.length > 0
      ? readConditions.every(condition => hasReadConditionEvidence(
          condition,
          readEvidencePaths,
          successfulTerminalEvidence,
          workspaceRoot,
        ))
      : readEvidencePaths.length > 0
        || successfulTerminalEvidence.some(evidence => (
          evidence.kind === 'other'
            && (needsFileContentReadEvidence
              ? isFileContentTerminalEvidenceCommand(evidence.command)
              : isReadOnlyTerminalEvidenceCommand(evidence.command))
        ));
    if (!hasReadEvidence) {
      missing.push(needsFileContentReadEvidence ? '文件内容读取结果' : '文件读取/检查结果');
    }
  }

  if (requiresTestEvidence(semanticContract)) {
    const passed = hasPassedVerificationReceipt
      || successfulTerminalEvidence.some(evidence => (
        evidence.kind === 'test' || evidence.kind === 'run' || evidence.kind === 'compile-run'
      ));
    if (!passed) missing.push('成功的测试/运行结果');
  } else if (requiresRunEvidence(semanticContract)) {
    const passed = hasPassedVerificationReceipt
      || successfulTerminalEvidence.some(evidence => (
        evidence.kind === 'run' || evidence.kind === 'test' || evidence.kind === 'compile-run'
      ));
    if (!passed) missing.push('成功的程序运行结果');
  } else if (requiresFileCheckEvidence(semanticContract) && !canonicalMutationReadback) {
    const passed = hasFileArtifactReadbackEvidence({
      semanticContract,
      writtenFiles: existingWrittenFiles,
      terminalEvidence: successfulTerminalEvidence,
      readEvidencePaths,
      workspaceRoot,
    });
    if (!passed) missing.push('文件读取/检查结果');
  } else if (requiresCommandEvidence(semanticContract) && !hasSuccessfulValidationEvidence) {
    missing.push(needsCodeArtifact
      ? '成功的编译/测试/语法验证命令结果'
      : '成功的编译/运行/测试命令结果');
  }

  const declaredTargets = canonicalTaskContract
    ? canonicalTaskContract.deliverables
        .filter(deliverable => deliverable.kind === 'source-change' || deliverable.kind === 'report')
        .flatMap(deliverable => deliverable.path ? [deliverable.path] : [])
    : semanticContract.obligations.artifacts
        .map(obligation => obligation.target)
        .filter((target): target is string => Boolean(target));
  const missingDeliverables = getMissingDeclaredDeliverableTargets(
    declaredTargets,
    existingWrittenFiles,
    workspaceRoot,
  );
  missing.push(...missingDeliverables.map(pathValue => `指定交付文件：${pathValue}`));
  return [...new Set(missing)];
}

function hasPassedCompletionVerification(receipts: readonly CodingVerificationReceipt[]): boolean {
  return receipts.some(receipt => (
    receipt.status === 'passed'
      && receipt.acceptance.length > 0
      && receipt.acceptance.every(result => result.status === 'passed')
  ));
}

function canonicalMutationReadbackOwnsInspection(
  contract: CodingKernelTaskContract | undefined,
): boolean {
  if (!contract) return false;
  const mutatingDeliverable = contract.deliverables.some(deliverable => (
    deliverable.kind === 'source-change' || deliverable.kind === 'report'
  ));
  if (!mutatingDeliverable) return false;
  return contract.acceptance?.some(criterion => (
    criterion.oracle.kind === 'workspace-readback'
      && criterion.oracle.evidenceKinds.includes('workspace-mutation-receipt')
      && criterion.oracle.evidenceKinds.includes('workspace-readback')
  )) === true;
}

function getMissingDeclaredDeliverableTargets(
  targets: readonly string[],
  writtenFiles: readonly WrittenFileEvidence[],
  workspaceRoot?: string,
): string[] {
  const written = writtenFiles.map(file => resolveCompletionEvidencePath(file.path, workspaceRoot));
  return [...new Set(targets)].filter(target => {
    const resolvedTarget = resolveCompletionEvidencePath(target, workspaceRoot);
    const matched = written.find(pathValue => pathValue === resolvedTarget || (
      !nodePath.isAbsolute(target) && pathValue.endsWith(`/${target.replace(/\\/g, '/')}`)
    ));
    if (!matched) return true;
    try {
      return !fs.existsSync(matched);
    } catch {
      return true;
    }
  });
}

function hasReadConditionEvidence(
  condition: TaskSemanticContract['completion']['doneIff'][number],
  readEvidencePaths: readonly string[],
  terminalEvidence: readonly TerminalEvidence[],
  workspaceRoot?: string,
): boolean {
  const target = condition.target;
  if (readEvidencePaths.some(pathValue => (
    !target || completionEvidencePathsMatch(pathValue, target, workspaceRoot)
  ))) {
    return true;
  }
  return terminalEvidence.some(evidence => {
    if (evidence.kind !== 'other') return false;
    const commandMatchesKind = condition.kind === 'file-content-read'
      ? isFileContentTerminalEvidenceCommand(evidence.command)
      : isReadOnlyTerminalEvidenceCommand(evidence.command);
    return commandMatchesKind && (!target || terminalCommandTargetsPath(evidence.command, target, workspaceRoot));
  });
}

function hasFileArtifactReadbackEvidence(input: {
  semanticContract: TaskSemanticContract;
  writtenFiles: readonly WrittenFileEvidence[];
  terminalEvidence: readonly TerminalEvidence[];
  readEvidencePaths: readonly string[];
  workspaceRoot?: string;
}): boolean {
  if (input.terminalEvidence.some(evidence => (
    evidence.kind === 'other' && isReadOnlyTerminalEvidenceCommand(evidence.command)
  ))) {
    return true;
  }
  const targets = fileArtifactReadbackTargets(input.semanticContract, input.writtenFiles);
  if (targets.length === 0) return input.readEvidencePaths.length > 0;
  return targets.every(target => input.readEvidencePaths.some(readPath => (
    completionEvidencePathsMatch(readPath, target, input.workspaceRoot)
  )));
}

function fileArtifactReadbackTargets(
  semanticContract: TaskSemanticContract,
  writtenFiles: readonly WrittenFileEvidence[],
): string[] {
  const artifactTargets = semanticContract.obligations.artifacts
    .filter(artifact => artifact.kind === 'report' && artifact.target && !isCodeArtifactPath(artifact.target))
    .map(artifact => artifact.target ?? '');
  if (artifactTargets.length > 0) return uniqueNonEmptyStrings(artifactTargets);

  const writeConditionTargets = semanticContract.completion.doneIff
    .filter(condition => condition.kind === 'file-written' && condition.target && !isCodeArtifactPath(condition.target))
    .map(condition => condition.target ?? '');
  if (writeConditionTargets.length > 0) return uniqueNonEmptyStrings(writeConditionTargets);

  return uniqueNonEmptyStrings(writtenFiles
    .filter(file => !isCodeArtifactPath(file.path))
    .map(file => file.path));
}

function uniqueNonEmptyStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function completionEvidencePathsMatch(candidate: string, target: string, workspaceRoot?: string): boolean {
  const normalizedCandidate = String(candidate || '').replace(/\\/g, '/');
  const normalizedTarget = String(target || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedCandidate === normalizedTarget || normalizedCandidate.endsWith(`/${normalizedTarget}`)) return true;
  return resolveCompletionEvidencePath(normalizedCandidate, workspaceRoot)
    === resolveCompletionEvidencePath(normalizedTarget, workspaceRoot);
}

function terminalCommandTargetsPath(command: string, target: string, workspaceRoot?: string): boolean {
  const normalizedCommand = String(command || '').replace(/\\/g, '/');
  const normalizedTarget = String(target || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedCommand.includes(normalizedTarget)) return true;
  return normalizedCommand.includes(resolveCompletionEvidencePath(normalizedTarget, workspaceRoot));
}

function resolveCompletionEvidencePath(value: string, workspaceRoot?: string): string {
  const normalized = String(value || '').replace(/\\/g, '/');
  const resolved = nodePath.isAbsolute(normalized)
    ? nodePath.resolve(normalized)
    : workspaceRoot
      ? nodePath.resolve(workspaceRoot, normalized)
      : nodePath.resolve(normalized);
  return resolved.replace(/\\/g, '/');
}
