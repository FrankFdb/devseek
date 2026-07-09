import * as fs from 'fs';
import * as nodePath from 'path';
import type * as vscode from 'vscode';
import type { AgentTask } from '../agent-task-decomposer';
import type { ChatMessage } from '../llm/types';
import { roughLineDiff } from '../utils';
import { WorkspaceEditService } from '../workspace/edit-service';
import {
  isMarkdownDocumentCreateTask,
  isMarkdownDocumentDeliverableRequest,
} from './deliverable-document';
import { stripToolCallBlocks } from './fake-tool-parser';
import type { AgentLoopCallbacks } from './loop-types';
import {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
} from './provider-output-integrity';
import type { TaskExecutionResult } from './task-execution-result';
import type { WrittenFileEvidence } from './completion-evidence';

export type MarkdownDeliverableChat = (messages: ChatMessage[]) => Promise<string>;

export interface MarkdownDeliverableTaskInput {
  task: AgentTask;
  taskIndex: number;
  taskTotal: number;
  userPrompt: string;
  workspaceRoot: vscode.Uri;
  effectiveAbsPath?: string;
  callbacks: AgentLoopCallbacks;
  chat: MarkdownDeliverableChat;
}

interface EvidenceFile {
  absPath: string;
  relPath: string;
  kind: 'requirement' | 'source';
  content: string;
  truncated: boolean;
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
  integrityKind?: string;
}

interface MarkdownStatusOptions {
  title?: string;
  detail: string;
  diff?: { added: number; removed: number };
}

const workspaceEditService = new WorkspaceEditService();
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
  const relPath = displayPath(input.workspaceRoot.fsPath, absPath, task.file || basename);

  await postMarkdownStatus(input, 'started', basename, {
    title: '收集 Markdown 交付证据',
    detail: [
      `目标：${relPath}`,
      '正在读取需求文档和旧实现证据；本阶段只读文件，不修改源码。',
    ].join('\n'),
  });
  const evidence = collectMarkdownEvidence(input.userPrompt, input.workspaceRoot.fsPath, absPath);
  if (evidence.sourceDirs.length > 0) {
    callbacks.onToolActivity?.('list', summarizeActivityPaths(evidence.sourceDirs, input.workspaceRoot.fsPath));
  }
  if (evidence.files.length > 0) {
    callbacks.onToolActivity?.('read', `${evidence.files.length} 个 Markdown 交付证据文件`);
  }

  await postMarkdownStatus(
    input,
    'started',
    basename,
    {
      title: evidence.files.length > 0 ? `已收集 ${evidence.files.length} 个证据文件` : '未找到本地证据文件',
      detail: evidence.files.length > 0
        ? `${describeEvidenceSummary(evidence)}\n下一步请求 DeepSeek 生成完整 Markdown 报告。`
        : '未找到可读取证据文件；下一步将请求 DeepSeek 生成带风险提示的 Markdown 报告。',
    },
  );

  callbacks.onToolActivity?.('web', 'DeepSeek 生成 Markdown 报告');
  await postMarkdownStatus(input, 'started', basename, {
    title: '请求 DeepSeek 生成 Markdown 报告',
    detail: [
      `目标：${relPath}`,
      `上下文：${evidence.files.length} 个本地证据文件，已整理为受控提示词。`,
      '正在等待 DeepSeek 返回完整 Markdown 正文。',
    ].join('\n'),
  });
  const provider = await generateProviderMarkdown(input, evidence, absPath);
  await postMarkdownStatus(input, 'started', basename, {
    title: provider.markdown ? 'DeepSeek 报告已返回' : 'DeepSeek 返回不可直接采用',
    detail: provider.markdown
      ? `DeepSeek 返回 ${provider.responseChars ?? 0} 字符，完整性检查通过（${provider.integrityKind || 'complete'}）；下一步写入 ${relPath}。`
      : `DeepSeek 输出未通过交付门禁（${provider.reason || 'Provider 未返回可用的完整 Markdown 报告。'}）；将使用本地证据生成兜底 Markdown 并继续写盘验证。`,
  });
  const markdown = provider.markdown || buildFallbackMarkdown({
    userPrompt: input.userPrompt,
    targetRelPath: relPath,
    deliveryObjective: input.task.desc,
    evidence,
    reason: provider.reason || 'Provider 未返回可用的完整 Markdown 报告。',
  });

  await postMarkdownStatus(input, 'started', basename, {
    title: '准备写入 Markdown 文档',
    detail: `目标：${relPath}\n正在通过写入权限和保护规则检查。`,
  });
  if (callbacks.onBeforeFileWrite && !(await callbacks.onBeforeFileWrite(absPath, {
    purpose: 'markdown-deliverable',
    userRequested: true,
    taskAction: task.action,
    displayName: relPath,
  }))) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: 'Markdown 写入被阻止',
      detail: `目标：${relPath}\n写入被权限或保护规则阻止。`,
    });
    return { applied: false, path: absPath, failedReason: 'Markdown deliverable write blocked by guard' };
  }

  try {
    callbacks.onToolActivity?.('write', relPath);
    await postMarkdownStatus(input, 'started', basename, {
      title: '写入并验证 Markdown 文档',
      detail: `正在写入 ${relPath}，随后读回校验内容一致性。`,
    });
    const writeResult = workspaceEditService.writeTextFileSync(absPath, ensureFinalNewline(markdown), { validateSourceSanity: true });
    const freshContent = fs.readFileSync(absPath, 'utf8');
    const finalContent = ensureFinalNewline(markdown);
    const diff = roughLineDiff(writeResult.oldContent, finalContent);
    if (freshContent !== finalContent) {
      await postMarkdownStatus(input, 'failed', basename, {
        title: 'Markdown 写入校验失败',
        detail: `目标：${relPath}\n写入后读回内容不一致。`,
        diff,
      });
      return {
        applied: false,
        path: absPath,
        raw: `Markdown deliverable verification failed: ${relPath}`,
        linesAdded: diff.added,
        linesRemoved: diff.removed,
        failedReason: 'Markdown deliverable verification failed after write',
      };
    }

    await callbacks.onAppliedChange({ path: relPath, ...writeResult });
    const action = writeResult.existed ? 'modify' : 'create';
    const verb = writeResult.existed ? '已更新' : '已创建';
    const writtenFiles = [buildWrittenFileEvidence(absPath, action, diff.added, diff.removed)];
    const providerNote = provider.markdown ? 'Provider 正文已通过完整性检查' : 'Provider 输出不可用，已使用本地证据兜底正文';
    await postMarkdownStatus(input, 'completed', basename, {
      title: 'Markdown 文档已生成',
      detail: `${relPath} · 已写入并读回验证；${providerNote}。`,
      diff,
    });
    return {
      applied: true,
      path: absPath,
      raw: [
        `${verb} Markdown 建议文档：${relPath}`,
        `本地证据文件：${evidence.files.length} 个`,
        provider.markdown ? 'Provider 结果：已采用完整 Markdown 正文。' : `Provider 结果：${provider.reason || '不可用'}，已写入本地证据兜底正文。`,
      ].join('\n'),
      taskComplete: true,
      linesAdded: diff.added,
      linesRemoved: diff.removed,
      writtenFiles,
    };
  } catch (error) {
    await postMarkdownStatus(input, 'failed', basename, {
      title: 'Markdown 文档写入失败',
      detail: `${relPath}\n${(error as Error).message}`,
    });
    return { applied: false, path: absPath, failedReason: (error as Error).message };
  }
}

function shouldExecuteMarkdownDeliverableTask(input: MarkdownDeliverableTaskInput): boolean {
  const { task } = input;
  if (!isMarkdownDocumentCreateTask(task)) return false;

  const taskIntentText = [
    task.desc,
    task.visibleTarget,
    task.file,
  ].filter(Boolean).join('\n');
  if (isMarkdownDocumentDeliverableRequest(taskIntentText)) return true;

  return isMarkdownDocumentDeliverableRequest(extractCurrentUserRequest(input.userPrompt));
}

function extractCurrentUserRequest(text: string | undefined): string {
  const raw = String(text || '');
  const currentMessageMatch = raw.match(/当前用户消息[:：]\s*([\s\S]*?)(?:\n(?:上一轮 Agent 状态|上一轮|本 session|最近对话摘要)[:：]|$)/);
  if (currentMessageMatch?.[1]?.trim()) return currentMessageMatch[1].trim();
  const originalMatch = raw.match(/【原始用户需求】\s*([\s\S]*?)(?:\n【同一会话续作上下文】|\n【本次子任务】|$)/);
  if (originalMatch?.[1]?.trim()) return originalMatch[1].trim();
  return raw.split('【同一会话续作上下文】')[0].trim();
}

async function generateProviderMarkdown(
  input: MarkdownDeliverableTaskInput,
  evidence: EvidenceBundle,
  absPath: string,
): Promise<ProviderMarkdownResult> {
  try {
    const response = await input.chat([{
      role: 'user',
      content: buildProviderPrompt(input, evidence, absPath),
    }]);
    const integrity = classifyProviderOutputIntegrity(response);
    const normalized = normalizeProviderMarkdown(response);
    if (normalized) {
      return {
        markdown: normalized,
        responseChars: response.length,
        integrityKind: integrity.kind,
      };
    }
    return {
      reason: describeProviderMarkdownRejection(response, integrity.kind),
      responseChars: response.length,
      integrityKind: integrity.kind,
    };
  } catch (error) {
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

function collectMarkdownEvidence(userPrompt: string, workspaceRoot: string, targetAbsPath: string): EvidenceBundle {
  const paths = extractExistingAbsolutePaths(userPrompt);
  const targetDir = nodePath.dirname(targetAbsPath);
  const requirementFiles = paths
    .filter(absPath => isFile(absPath) && isMarkdownPath(absPath))
    .slice(0, MAX_REQUIREMENT_FILES);
  const sourceDirs = paths
    .filter(absPath => isDirectory(absPath))
    .filter(absPath => nodePath.normalize(absPath) !== nodePath.normalize(targetDir))
    .filter(absPath => !isExcludedPath(absPath))
    .slice(0, 4);

  const files: EvidenceFile[] = [];
  let remainingChars = MAX_TOTAL_EVIDENCE_CHARS;
  for (const absPath of requirementFiles) {
    const loaded = readEvidenceFile(absPath, workspaceRoot, 'requirement', remainingChars);
    if (!loaded) continue;
    files.push(loaded);
    remainingChars -= loaded.content.length;
  }

  const sourceFiles = uniquePaths(
    sourceDirs.flatMap(dir => collectSourceFiles(dir, SOURCE_DIR_DEPTH, MAX_EVIDENCE_FILES)),
  )
    .filter(absPath => !requirementFiles.includes(absPath))
    .slice(0, Math.max(0, MAX_EVIDENCE_FILES - files.length));

  for (const absPath of sourceFiles) {
    const loaded = readEvidenceFile(absPath, workspaceRoot, 'source', remainingChars);
    if (!loaded) continue;
    files.push(loaded);
    remainingChars -= loaded.content.length;
    if (remainingChars <= 0) break;
  }

  return { files, sourceDirs };
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

function readEvidenceFile(
  absPath: string,
  workspaceRoot: string,
  kind: EvidenceFile['kind'],
  remainingChars: number,
): EvidenceFile | undefined {
  if (remainingChars <= 0) return undefined;
  try {
    const raw = fs.readFileSync(absPath, 'utf8');
    const limit = Math.min(MAX_FILE_CHARS, remainingChars);
    const content = raw.length > limit
      ? `${raw.slice(0, limit)}\n\n[DevSeek: 文件内容超过本次证据预算，已截断]`
      : raw;
    return {
      absPath,
      relPath: displayPath(workspaceRoot, absPath, absPath),
      kind,
      content,
      truncated: raw.length > limit,
    };
  } catch {
    return undefined;
  }
}

function buildProviderPrompt(input: MarkdownDeliverableTaskInput, evidence: EvidenceBundle, absPath: string): string {
  const relTarget = displayPath(input.workspaceRoot.fsPath, absPath, input.task.file || nodePath.basename(absPath));
  const evidenceText = evidence.files.length > 0
    ? evidence.files.map(file => [
      `### ${file.kind === 'requirement' ? '需求文档' : '旧实现'}: ${file.relPath}${file.truncated ? '（已截断）' : ''}`,
      '```text',
      file.content,
      '```',
    ].join('\n')).join('\n\n')
    : '未读取到本地证据文件。';
  return [
    '你是顶级编程智能体的文档交付模块。所有文件证据已经由本地运行时读取完毕。',
    '请只输出完整 Markdown 文档正文，不要请求工具，不要输出 [TOOL:...]、Calling、工具执行结果或代码块包裹整个文档。',
    '文档必须包含：需求差异、旧实现职责观察、实现对策、主控任务拆分、风险与验证建议、后续任务清单。',
    `目标写入路径：${relTarget}`,
    '',
    '## 本文档交付目标',
    input.task.desc || '生成用户要求的 Markdown 建议文档。',
    '',
    '## 用户原始要求',
    input.userPrompt,
    '',
    '## 本地证据',
    evidenceText,
  ].join('\n');
}

function normalizeProviderMarkdown(text: string): string | undefined {
  const integrity = classifyProviderOutputIntegrity(text);
  if (!integrity.okForSettlement) return undefined;
  let trimmed = unwrapMarkdownFence(stripToolCallBlocks(text).trim());
  if (BAD_PROVIDER_REPORT_RE.test(trimmed)) return undefined;
  if (trimmed.length < REPORT_MIN_CHARS) return undefined;
  if (!/(?:^|\n)#{1,3}\s+\S/.test(trimmed)) {
    trimmed = `# Markdown 建议文档\n\n${trimmed}`;
  }
  return ensureFinalNewline(trimmed);
}

function describeProviderMarkdownRejection(text: string, integrityKind: string): string {
  const trimmed = unwrapMarkdownFence(stripToolCallBlocks(text).trim());
  if (BAD_PROVIDER_REPORT_RE.test(trimmed)) {
    return `${integrityKind}: Provider 返回包含工具调用痕迹，不能作为最终 Markdown 文档。`;
  }
  if (trimmed.length < REPORT_MIN_CHARS) {
    return `${integrityKind}: Provider 返回正文过短（${trimmed.length} 字符），不能作为完整交付物。`;
  }
  return `${integrityKind}: ${describeProviderOutputIntegrity(integrityKind)}`;
}

function describeEvidenceSummary(evidence: EvidenceBundle): string {
  const requirementCount = evidence.files.filter(file => file.kind === 'requirement').length;
  const sourceCount = evidence.files.filter(file => file.kind === 'source').length;
  const truncatedCount = evidence.files.filter(file => file.truncated).length;
  const labels = evidence.files.slice(0, 6).map(file => {
    const prefix = file.kind === 'requirement' ? '需求' : '旧实现';
    const suffix = file.truncated ? '（截断）' : '';
    return `${prefix}:${file.relPath}${suffix}`;
  });
  const omitted = evidence.files.length > labels.length
    ? `，另 ${evidence.files.length - labels.length} 个文件`
    : '';
  return [
    `证据：需求文档 ${requirementCount} 个，旧实现 ${sourceCount} 个。`,
    labels.length > 0 ? `已读取：${labels.join('、')}${omitted}。` : '',
    evidence.sourceDirs.length > 0 ? `扫描目录：${evidence.sourceDirs.length} 个。` : '',
    truncatedCount > 0 ? `有 ${truncatedCount} 个文件按证据预算截断。` : '',
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
  const sourceFiles = input.evidence.files.filter(file => file.kind === 'source');
  const requirementDigest = requirementFiles
    .map(file => `### ${file.relPath}\n${extractImportantLines(file.content, 28)}`)
    .join('\n\n') || '- 未读取到需求文档正文，请检查用户提供路径是否有效。';
  const sourceDigest = sourceFiles
    .map(file => `### ${file.relPath}\n${extractSourceResponsibilities(file.content)}`)
    .join('\n\n') || '- 未读取到旧实现源码，请补充旧实现路径后复核。';
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
