import * as fs from 'fs';
import * as nodePath from 'path';
import type {
  AppliedChangeRecord,
  ApplyWorkflowResult,
  ApplyWorkflowStatus,
} from '../workspace-applier';
import { resolveWorkspaceFileUri } from '../workspace-roots';
import { fenceLangForFile } from '../utils';

export interface ApplyFailureRecoveryInput {
  reporter: (status: ApplyWorkflowStatus) => Promise<void> | void;
  originalPrompt: string;
  failedResponse: string;
  failedApply: ApplyWorkflowResult;
  preferredAbsolutePaths?: string[];
  chat: (repairPrompt: string) => Promise<string>;
  apply: (
    repairResponse: string,
    repairPrompt: string,
    onAppliedChange?: (change: AppliedChangeRecord) => Promise<void> | void,
  ) => Promise<ApplyWorkflowResult>;
  onAppliedChange?: (change: AppliedChangeRecord) => Promise<void> | void;
}

const MAX_TRUNCATING_OVERWRITE_REPAIR_ATTEMPTS = 2;

export async function recoverApplyFailureIfPossible(input: ApplyFailureRecoveryInput): Promise<ApplyWorkflowResult | undefined> {
  if (!isTruncatingOverwriteFailure(input.failedApply)) return undefined;

  let failedApply = input.failedApply;
  let failedResponse = input.failedResponse;

  for (let attempt = 1; attempt <= MAX_TRUNCATING_OVERWRITE_REPAIR_ATTEMPTS; attempt += 1) {
    await input.reporter({
      phase: 'repair',
      state: 'started',
      title: attempt === 1
        ? '截断覆盖已拦截，正在重新生成安全补丁'
        : `安全补丁仍被拦截，正在第 ${attempt} 次生成最小 diff`,
      detail: failedApply.failureDetail,
    });

    const repairPrompt = buildApplyFailureRepairPrompt(
      input.originalPrompt,
      failedResponse,
      failedApply,
      input.preferredAbsolutePaths ?? [],
      attempt,
    );

    let repairResponse = '';
    try {
      repairResponse = await input.chat(repairPrompt);
    } catch (error) {
      await input.reporter({
        phase: 'repair',
        state: 'failed',
        title: '安全补丁重新生成失败',
        detail: (error as Error).message,
      });
      return undefined;
    }

    if (!repairResponse.trim()) {
      await input.reporter({
        phase: 'repair',
        state: 'failed',
        title: '安全补丁重新生成失败',
        detail: '模型未返回可解析内容。',
      });
      return undefined;
    }

    const recovered = await input.apply(repairResponse, repairPrompt, input.onAppliedChange);
    if (recovered.applied) return recovered;

    if (isTruncatingOverwriteFailure(recovered) && attempt < MAX_TRUNCATING_OVERWRITE_REPAIR_ATTEMPTS) {
      failedApply = recovered;
      failedResponse = repairResponse;
      await input.reporter({
        phase: 'repair',
        state: 'started',
        title: '安全补丁仍是截断覆盖，继续要求最小 diff',
        detail: recovered.failureDetail || recovered.review?.unfinishedItems.join('\n') || '重新生成的内容仍疑似覆盖已有文件。',
      });
      continue;
    }

    await input.reporter({
      phase: 'repair',
      state: 'failed',
      title: isTruncatingOverwriteFailure(recovered) ? '安全补丁仍被截断覆盖拦截' : '安全补丁仍未能应用',
      detail: recovered.failureDetail || recovered.review?.unfinishedItems.join('\n') || '重新生成的内容仍无法安全应用。',
    });
    return recovered;
  }

  return undefined;
}

export function buildApplyFailureRepairPrompt(
  originalPrompt: string,
  failedResponse: string,
  failedApply: ApplyWorkflowResult,
  preferredAbsolutePaths: string[],
  attempt = 1,
): string {
  const paths = [
    ...new Set([
      ...(failedApply.blockedChangePaths ?? []),
      ...(failedApply.review?.files.changedPaths ?? []),
    ].filter(Boolean)),
  ];
  const fileSnapshots = paths
    .slice(0, 8)
    .map((relPath) => renderExistingFileSnapshotForRepair(relPath, preferredAbsolutePaths))
    .filter(Boolean)
    .join('\n\n');
  const retryWarning = attempt > 1
    ? '上一轮修复仍被判定为疑似截断覆盖。已存在文件只允许 unified diff，禁止再次输出完整文件代码块。'
    : '';

  return [
    '你是一个严格的代码修复智能体。上一轮文件落地被 DevSeek 安全拦截，因为模型输出疑似用不完整内容覆盖已有文件。',
    '请改为生成最小、可应用的安全补丁。',
    retryWarning,
    '',
    '硬性要求：',
    '1. 对已存在文件只允许输出 unified diff；不要输出完整源码块、缩略版整文件，或用较短内容覆盖原文件。',
    '2. 对新增文件可以输出“文件 N: path”加完整代码块。',
    '3. 不要把源码实现写入 AGENTS.md、CLAUDE.md、.devseek/rules.md 或 Copilot instructions。',
    '4. 不要解释，不要输出编译命令说明，只输出可应用的文件变更。',
    '5. 如果需要修改 CMakeLists.txt 等已有构建文件，必须保留现有未相关内容，只用 unified diff 做最小修改。',
    '',
    '原始用户请求：',
    originalPrompt,
    '',
    'DevSeek 拦截原因：',
    failedApply.failureDetail || failedApply.review?.unfinishedItems.join('\n') || '疑似截断覆盖。',
    '',
    fileSnapshots ? `当前真实文件内容：\n${fileSnapshots}` : '当前真实文件内容：未能定位到被拦截文件；请基于原始回复生成最小补丁。',
    '',
    '上一轮模型输出（供你提取意图，不可原样照抄不完整文件）：',
    '```markdown',
    failedResponse.slice(0, 12000),
    failedResponse.length > 12000 ? '\n...[上一轮输出已截断]' : '',
    '```',
    '',
    '现在请只输出 unified diff 或新增文件完整代码块。',
  ].join('\n');
}

function isTruncatingOverwriteFailure(result: ApplyWorkflowResult | undefined): boolean {
  return result?.failureReason === 'truncating-overwrite';
}

function renderExistingFileSnapshotForRepair(relPath: string, preferredAbsolutePaths: string[]): string {
  const uri = resolveWorkspaceFileUri(relPath, preferredAbsolutePaths);
  if (!uri) return '';
  try {
    const content = fs.readFileSync(uri.fsPath, 'utf8');
    const lang = fenceLangForFile(nodePath.basename(relPath));
    const body = content.length > 10000
      ? `${content.slice(0, 10000)}\n...[文件内容已截断，仅供定位；输出必须用 diff 保留未展示部分]`
      : content;
    return [
      `文件: ${relPath}`,
      '```' + lang,
      body,
      '```',
    ].join('\n');
  } catch {
    return '';
  }
}
