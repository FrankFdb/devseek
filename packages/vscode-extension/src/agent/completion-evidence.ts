import * as fs from 'fs';
import * as nodePath from 'path';
import {
  isAdvisoryPlanningRequest,
  isDeferredImplementationRequest,
  isDirectImplementationRequest,
  isScopedNoChangeWithDeliverableWriteRequest,
} from '../intent/advisory-patterns';
import { classifyShellCommandEvidence } from '../tools/shell-command-analysis';
import { stripToolCallBlocks } from './fake-tool-parser';

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
  kind: TerminalEvidenceKind;
  ok: boolean;
  exitCode: number | null;
  outputPath?: string;
  detail?: string;
  reviewRequired?: boolean;
};

export function classifyTerminalEvidenceCommand(command: string): TerminalEvidenceKind {
  return classifyShellCommandEvidence(command) as TerminalEvidenceKind;
}

const CODE_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.go', '.rs', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.scala',
  '.html', '.css', '.scss', '.sass', '.vue', '.svelte', '.sh', '.bash', '.zsh',
]);

const FILE_CHANGE_RE = /(?:写|创建|新建|生成|编写|实现|开发|做(?:一个|一款)?|修复|修改|改进|改造|重构|更新|添加|删除|create|write|implement|develop|fix|repair|modify|edit|refactor|update|add|delete)/i;
const CODE_TARGET_PATTERNS = [
  '代码', '源码', '程序', '脚本', '算法', '功能', '组件', '游戏', '网页', '页面',
  '应用', '图形', '图形库', '绘图', '画面', '界面', '窗口', '标题', '窗口标题',
  '乱码', '渲染', '动画', '鼠标', '键盘', '控制', '背景', '天空', '球体',
  '立方体', '长方体', '三维', '二维',
  'OpenGL', 'GLUT', 'X11', 'GUI',
  'component', 'class', 'function', 'algorithm', 'app', 'web', 'graphics?',
  'render', 'visual', 'window', 'title', 'caption', 'label', 'mojibake',
  'encoding', 'unicode', 'mouse', 'keyboard', 'background', 'sky', 'cube',
  'sphere', '3d', '2d',
  'c\\+\\+', 'cpp', 'c语言', 'python', 'javascript', 'typescript', 'java',
  'golang', 'rust',
  '\\.c\\b', '\\.cc\\b', '\\.cpp\\b', '\\.h\\b', '\\.hpp\\b', '\\.py\\b',
  '\\.js\\b', '\\.jsx\\b', '\\.ts\\b', '\\.tsx\\b', '\\.mjs\\b',
  '\\.java\\b', '\\.go\\b', '\\.rs\\b', '\\.cs\\b', '\\.php\\b',
  '\\.rb\\b', '\\.swift\\b', '\\.kt\\b', '\\.html\\b', '\\.css\\b',
  '\\.vue\\b', '\\.svelte\\b', '\\.sh\\b',
].join('|');
const CODE_TARGET_RE = new RegExp(`(?:${CODE_TARGET_PATTERNS})`, 'i');
const FILE_PATH_TARGET_RE = /(?:^|[^\w/.-])(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[A-Za-z0-9]{1,12}\b/;
const READ_ONLY_RE = /(?:(?:不要|不用|无需|不需要|禁止|别).{0,8}(?:修改|改动|改|变更|写|写入|创建|新建|生成|更新|删除).{0,4}(?:代码|文件|内容)?|(?:只|仅).{0,6}(?:分析|评估|说明|解释|计划|审计|查看|确认|检查|读取|显示)|do not .{0,20}(?:modify|edit|change|write|create|update|delete))/i;
const READ_EVIDENCE_RE = /(?:检查|查看|读取|显示|确认|是否存在|内容|read|show|display|check|inspect|exists?)/i;
const FILE_CONTENT_EVIDENCE_RE = /(?:(?:显示|查看|读取|输出|打印).{0,8}(?:文件)?内容|(?:read|show|display|print).{0,16}(?:file\s*)?content)/i;
const READ_ONLY_TERMINAL_EVIDENCE_RE = /\b(?:cat|ls|test|grep|head|tail|sed|wc|stat|file|find)\b/i;
const FILE_CONTENT_TERMINAL_EVIDENCE_RE = /\b(?:cat|grep|head|tail|sed)\b/i;
const READ_ONLY_TOOL_INTENT_RE = /(?:我(?:来|会|将|先|需要|已经)|让我|首先|先|接下来|下一步|现在我|需要).{0,140}(?:查看|读取|检查|搜索|列出|调用|使用|打开|浏览|生成|输出|整理|形成|收集|了解|分析|给出).{0,100}(?:文件|目录|代码|文档|结构|相关|信息|工具|报告|结论|分析|建议|差异|对策|tool|read_file|list_dir|grep_search)/i;
const READ_ONLY_DELIVERY_STRUCTURE_RE = /(?:^|\n)\s*(?:#{1,6}\s+|[-*]\s+|\d+[.、]\s+|(?:结论|建议|对策|任务|差异|风险|主控|实现方案|分析结果)\s*[:：])/i;
const READ_ONLY_ANSWER_MARKER_RE = /(?:结论|依据|原因|问题|风险|建议|对策|方案|任务|任务拆解|差异|主控|实现方案|分析结果|不存在|未找到|无法读取|summary|conclusion|evidence|recommendation|risk|not\s+found|does\s+not\s+exist)/i;
const READ_ONLY_TRANSITION_RE = /(?:我(?:已经|已)|现在我(?:已经|已)?|目前(?:已经|已)?|现在).{0,80}(?:收集|读取|查看|了解|掌握).{0,100}(?:让我|接下来|下一步|将|继续|准备).{0,60}(?:分析|给出|生成|输出|整理|形成|撰写)/i;
const SUMMARY_FILE_CLAIM_RE = /(?:^|[^\w/.-])((?:[\w.-]+\/)*[\w.-]+(?:\.(?:cpp|cxx|cc|c|hpp|hxx|hh|h|tsx|jsx|mjs|cjs|ts|js|py|java|go|rs|cs|php|rb|swift|kts|kt|scala|html|scss|sass|css|svelte|vue|bash|zsh|sh|json|ya?ml|md|txt|cmake)|\/CMakeLists\.txt|CMakeLists\.txt))/gi;
const SUMMARY_QUOTED_FILE_CLAIM_RE = /[《「“"'`]([^《》「」“”"'`\n\r]{1,180}\.(?:cpp|cxx|cc|c|hpp|hxx|hh|h|tsx|jsx|mjs|cjs|ts|js|py|java|go|rs|cs|php|rb|swift|kts|kt|scala|html|scss|sass|css|svelte|vue|bash|zsh|sh|json|ya?ml|md|txt|cmake))[》」”"'`]/gi;
const SUMMARY_FILE_CLAIM_POSITIVE_RE = /(?:创建|新建|生成|添加|新增|编写|实现|更新|修改|改造|重构|写入|落地|复制|拷贝|重命名|改名|移动|迁移|替换|create|created|add|added|generate|generated|write|wrote|implement|implemented|update|updated|modify|modified|refactor|refactored|copy|copied|duplicate|duplicated|rename|renamed|move|moved|replace|replaced)/i;
const SUMMARY_FILE_CLAIM_NEGATIVE_RE = /(?:未|没有|尚未|无法|不能|失败|缺少|不存在|not\s+|no\s+|did\s+not|failed|missing|absent)/i;
const SUMMARY_FILE_CLAIM_ADVISORY_RE = /(?:建议|应当|需要|可以|计划|准备|待|后续|下一步|should|could|would|plan(?:ned)?|todo).{0,20}$/i;
const SUMMARY_FILE_TRANSFER_RE = /(?:复制|拷贝|重命名|改名|移动|迁移|替换|copy|copied|duplicate|duplicated|rename|renamed|move|moved|replace|replaced)/i;
const SUMMARY_FILE_TRANSFER_SOURCE_MARKER_RE = /(?:将|把|从|复制|拷贝|重命名|改名|移动|迁移|\bfrom\b|\bcopy(?:ing|ied)?\b|\bcopied\b|\bduplicate(?:d)?\b|\brename(?:d)?\b|\bmove(?:d)?\b|\breplace(?:d)?\b)\s*$/i;
const SUMMARY_FILE_TRANSFER_DEST_CONNECTOR_RE = /^\s*(?:复制为|拷贝为|复制到|拷贝到|重命名为|改名为|移动到|迁移到|替换为|作为|为|到|\bto\b|\bas\b|\binto\b|\bwith\b)/i;
const GENERIC_EVIDENCE_TODO_TITLES = new Set([
  '创建/更新文件',
  '编译/运行并验证结果',
]);

export function isCodeArtifactPath(filePath: string): boolean {
  return CODE_FILE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

function normalizeWrittenFileEvidenceKey(filePath: string, workspaceRoot?: string): string {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  if (!normalizedPath) return '';
  const normalizedRoot = String(workspaceRoot || '').replace(/\\/g, '/');
  if (normalizedRoot) {
    try {
      const rel = nodePath.relative(normalizedRoot, normalizedPath).replace(/\\/g, '/');
      if (rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel)) return rel;
    } catch {
      // Fall back to the normalized path below.
    }
  }
  return normalizedPath;
}

export function coalesceWrittenFileEvidence(
  files: WrittenFileEvidence[],
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

function normalizeFactPath(value: string): string {
  return value
    .replace(/^[《「“"'`\s]+|[》」”"'`\s]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function sentenceAround(text: string, start: number, end: number): string {
  const leftCandidates = ['\n', '。', '；', ';', '!', '！', '?', '？'].map(ch => text.lastIndexOf(ch, start));
  const left = Math.max(-1, ...leftCandidates) + 1;
  const rightCandidates = ['\n', '。', '；', ';', '!', '！', '?', '？']
    .map(ch => text.indexOf(ch, end))
    .filter(index => index >= 0);
  const right = rightCandidates.length > 0 ? Math.min(...rightCandidates) : text.length;
  return text.slice(left, right);
}

function summaryClaimIsPositive(sentence: string, tokenStartInSentence: number): boolean {
  if (!SUMMARY_FILE_CLAIM_POSITIVE_RE.test(sentence)) return false;
  const beforeToken = sentence.slice(Math.max(0, tokenStartInSentence - 16), tokenStartInSentence);
  if (SUMMARY_FILE_CLAIM_NEGATIVE_RE.test(beforeToken)) return false;
  const beforeSentence = sentence.slice(0, tokenStartInSentence);
  return !SUMMARY_FILE_CLAIM_ADVISORY_RE.test(beforeSentence);
}

function summaryFileClaimIsTransferSource(
  sentence: string,
  tokenStartInSentence: number,
  tokenEndInSentence: number,
): boolean {
  if (!SUMMARY_FILE_TRANSFER_RE.test(sentence)) return false;
  const beforeToken = sentence.slice(Math.max(0, tokenStartInSentence - 32), tokenStartInSentence);
  const afterToken = sentence.slice(tokenEndInSentence, Math.min(sentence.length, tokenEndInSentence + 40));
  if (/(?:从|\bfrom\b)\s*$/i.test(beforeToken)) return true;
  return SUMMARY_FILE_TRANSFER_SOURCE_MARKER_RE.test(beforeToken)
    && SUMMARY_FILE_TRANSFER_DEST_CONNECTOR_RE.test(afterToken);
}

export function extractClaimedSummaryFiles(summary: string): string[] {
  const text = String(summary || '');
  if (!text.trim()) return [];

  const claimed = new Set<string>();
  collectClaimedSummaryFiles(text, SUMMARY_FILE_CLAIM_RE, claimed);
  collectClaimedSummaryFiles(text, SUMMARY_QUOTED_FILE_CLAIM_RE, claimed);
  return [...claimed];
}

function collectClaimedSummaryFiles(text: string, pattern: RegExp, claimed: Set<string>): void {
  let match: RegExpExecArray | null;
  pattern.lastIndex = 0;
  while ((match = pattern.exec(text)) !== null) {
    const token = match[1] || '';
    const rawPath = normalizeFactPath(token);
    if (!rawPath) continue;
    const tokenStart = match.index + match[0].lastIndexOf(token);
    const tokenEnd = tokenStart + token.length;
    const sentence = sentenceAround(text, tokenStart, tokenEnd);
    const sentenceStart = text.lastIndexOf(sentence, tokenStart);
    const tokenStartInSentence = sentenceStart >= 0 ? tokenStart - sentenceStart : 0;
    const tokenEndInSentence = tokenStartInSentence + token.length;
    if (!summaryClaimIsPositive(sentence, tokenStartInSentence)) continue;
    if (summaryFileClaimIsTransferSource(sentence, tokenStartInSentence, tokenEndInSentence)) continue;
    claimed.add(rawPath);
  }
}

function fileClaimHasEvidence(
  claim: string,
  writtenFiles: WrittenFileEvidence[],
  workspaceRoot?: string,
): boolean {
  const normalizedClaim = normalizeFactPath(claim);
  const claimBase = nodePath.posix.basename(normalizedClaim);
  const written = coalesceWrittenFileEvidence(writtenFiles, workspaceRoot);

  for (const file of written) {
    const filePath = normalizeFactPath(file.path);
    const fileBase = nodePath.posix.basename(filePath);
    if (filePath === normalizedClaim || filePath.endsWith(`/${normalizedClaim}`) || fileBase === claimBase) {
      try {
        if (fs.existsSync(file.path)) return true;
      } catch {
        return true;
      }
    }
  }

  if (nodePath.isAbsolute(normalizedClaim)) {
    try { return fs.existsSync(normalizedClaim); } catch { return false; }
  }
  if (normalizedClaim.includes('/') && workspaceRoot) {
    try { return fs.existsSync(nodePath.resolve(workspaceRoot, normalizedClaim)); } catch { return false; }
  }
  return false;
}

export function getUnsupportedSummaryFileClaims(
  summary: string,
  writtenFiles: WrittenFileEvidence[],
  workspaceRoot?: string,
): string[] {
  return extractClaimedSummaryFiles(summary)
    .filter(claim => !fileClaimHasEvidence(claim, writtenFiles, workspaceRoot));
}

function buildEvidenceText(userPrompt: string, todos: CompletionTodo[]): string {
  const promptIntentText = stripInlineFileContent(userPrompt);
  const todoText = todos
    .map(t => t.title.trim())
    .filter(title => !GENERIC_EVIDENCE_TODO_TITLES.has(title))
    .join('\n');
  return `${promptIntentText}\n${todoText}`.toLowerCase();
}

export function isExplicitlyReadOnlyRequest(text: string): boolean {
  if (isScopedNoChangeWithDeliverableWriteRequest(text)) return false;
  return READ_ONLY_RE.test(text)
    || (isAdvisoryPlanningRequest(text) && (!isDirectImplementationRequest(text) || isDeferredImplementationRequest(text)));
}

function stripInlineFileContent(text: string): string {
  return text.replace(
    /(?:内容为|内容是|内容如下|content\s*(?:is|:)|with\s+content)\s*[:：]?\s*([\s\S]*)$/i,
    (_full, tail) => {
      const trailingIntent = extractTrailingContentIntent(String(tail || ''));
      return trailingIntent ? ` ${trailingIntent}` : '';
    },
  );
}

function extractTrailingContentIntent(text: string): string {
  const trimmed = text.trim();
  const match = /(?:[，,;；。.]?\s*((?:并|然后|并且|同时|随后)?\s*(?:验证|确认|检查|校验)[\s\S]*))$/i.exec(trimmed)
    || /(?:[，,;；.]?\s*((?:and\s+then\s+|then\s+|and\s+)?(?:verify|check|confirm)\b[\s\S]*))$/i.exec(trimmed);
  return match?.[1]?.trim() ?? '';
}

export function requiresFileChangeEvidence(text: string): boolean {
  if (!text.trim() || isExplicitlyReadOnlyRequest(text)) return false;
  return FILE_CHANGE_RE.test(text) && (CODE_TARGET_RE.test(text) || FILE_PATH_TARGET_RE.test(text));
}

export function requiresCodeArtifactForEvidence(text: string): boolean {
  if (!text.trim() || isExplicitlyReadOnlyRequest(text)) return false;
  return FILE_CHANGE_RE.test(text) && CODE_TARGET_RE.test(text);
}

export function requiresReadEvidence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return isExplicitlyReadOnlyRequest(trimmed) && FILE_PATH_TARGET_RE.test(trimmed) && READ_EVIDENCE_RE.test(trimmed);
}

export function requiresFileContentReadEvidence(text: string): boolean {
  return requiresReadEvidence(text) && FILE_CONTENT_EVIDENCE_RE.test(text);
}

export function hasReadOnlyAnswerEvidence(raw: string | undefined): boolean {
  const original = String(raw || '').trim();
  if (!original) return false;
  const visibleText = stripToolCallBlocks(original).trim();
  if (!visibleText) return false;
  const compact = visibleText.replace(/\s+/g, ' ').trim();
  if (READ_ONLY_TRANSITION_RE.test(compact)) return false;
  if (isToolIntentOnlyReadOnlyText(compact)) return false;
  if (READ_ONLY_DELIVERY_STRUCTURE_RE.test(visibleText)) return true;
  if (compact.length < 120) {
    return /[:：]/.test(compact) && READ_ONLY_ANSWER_MARKER_RE.test(compact);
  }
  return READ_ONLY_ANSWER_MARKER_RE.test(compact);
}

function isToolIntentOnlyReadOnlyText(text: string): boolean {
  if (!text || text.length > 220) return false;
  if (READ_ONLY_DELIVERY_STRUCTURE_RE.test(text)) return false;
  return READ_ONLY_TOOL_INTENT_RE.test(text);
}

export function isReadOnlyTerminalEvidenceCommand(command: string): boolean {
  return READ_ONLY_TERMINAL_EVIDENCE_RE.test(command || '');
}

export function isFileContentTerminalEvidenceCommand(command: string): boolean {
  return FILE_CONTENT_TERMINAL_EVIDENCE_RE.test(command || '');
}

export function requiresCommandEvidence(text: string): boolean {
  return /(?:编译|运行|执行|测试|验证|调试|compile|build|test|run|execute|verify)/i.test(text);
}

function requiresRunEvidence(text: string): boolean {
  return /(?:运行|执行|run|execute)/i.test(text);
}

function requiresTestEvidence(text: string): boolean {
  return /(?:测试|run\s+tests?|execute\s+tests?|npm\s+test|pnpm\s+test|yarn\s+test|bun\s+test|unit\s+tests?|pytest|go\s+test|cargo\s+test)/i.test(text);
}

export function requiresRuntimeValidation(text: string): boolean {
  return requiresRunEvidence(text) || requiresTestEvidence(text) || /(?:启动|看结果|输出效果|运行效果)/i.test(text);
}

export function requiresFileCheckEvidence(text: string): boolean {
  if (!text.trim() || isExplicitlyReadOnlyRequest(text)) return false;
  return requiresFileChangeEvidence(text)
    && !requiresCodeArtifactForEvidence(text)
    && requiresCommandEvidence(text)
    && !requiresRuntimeValidation(text);
}

function lastUnclearedTerminalFailure(
  terminalEvidence: TerminalEvidence[],
  failureKinds: Set<TerminalEvidenceKind>,
  successKinds: Set<TerminalEvidenceKind>,
): TerminalEvidence | undefined {
  let blockingFailure: TerminalEvidence | undefined;
  for (const evidence of terminalEvidence) {
    if (evidence.reviewRequired) {
      blockingFailure = undefined;
      continue;
    }
    if (evidence.ok && successKinds.has(evidence.kind)) {
      blockingFailure = undefined;
      continue;
    }
    if (!evidence.ok && failureKinds.has(evidence.kind)) {
      blockingFailure = evidence;
    }
  }
  return blockingFailure;
}

export function isBlockingTerminalFailureEvidence(evidence: TerminalEvidence): boolean {
  if (evidence.reviewRequired) return false;
  if (evidence.ok) return false;
  return evidence.kind !== 'other' || looksLikeValidationShellCommand(evidence.command);
}

export function findBlockingTerminalFailureEvidence(evidence: readonly TerminalEvidence[] | undefined): TerminalEvidence | undefined {
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
    if (isBlockingTerminalFailureEvidence(item)) {
      blockingFailure = item;
    }
  }
  return blockingFailure;
}

function terminalSuccessClearsFailure(success: TerminalEvidence, failure: TerminalEvidence): boolean {
  if (!success.ok) return false;
  if (success.kind === 'compile-run') return isCommandTerminalEvidenceKind(failure.kind);
  if (success.kind === 'run' || success.kind === 'test') {
    return failure.kind === 'compile' || failure.kind === 'run' || failure.kind === 'test' || failure.kind === 'compile-run';
  }
  if (success.kind === 'compile') {
    return failure.kind === 'compile';
  }
  return success.kind === 'other'
    && failure.kind === 'other'
    && looksLikeValidationShellCommand(success.command);
}

function isCommandTerminalEvidenceKind(kind: TerminalEvidenceKind): boolean {
  return kind === 'compile' || kind === 'run' || kind === 'test' || kind === 'compile-run';
}

function looksLikeValidationShellCommand(command: string): boolean {
  const c = String(command || '').trim().toLowerCase();
  return /\b(?:test\s+-[efsdx]|wc\s+-c|stat|file|cmake|make|ninja|g\+\+|gcc|clang|ctest|npm\s+(?:test|run\s+(?:test|build|compile))|pnpm\s+(?:test|run\s+(?:test|build|compile))|yarn\s+(?:test|run\s+(?:test|build|compile))|bun\s+(?:test|run\s+(?:test|build|compile))|pytest|go\s+test|cargo\s+test|cargo\s+build|dotnet\s+(?:test|build))\b/.test(c);
}

export function getBlockingTerminalFailure(
  userPrompt: string,
  todos: CompletionTodo[],
  writtenFiles: WrittenFileEvidence[],
  terminalEvidence: TerminalEvidence[],
): TerminalEvidence | undefined {
  if (terminalEvidence.length === 0) return undefined;
  const text = buildEvidenceText(userPrompt, todos);
  const existingWrittenFiles = coalesceWrittenFileEvidence(writtenFiles).filter(f => {
    try { return fs.existsSync(f.path); } catch { return false; }
  });
  const existingCodeWrites = existingWrittenFiles.filter(f => isCodeArtifactPath(f.path));
  const needsReadEvidence = requiresReadEvidence(text);
  const needsCodeArtifact = requiresCodeArtifactForEvidence(text);
  const needsCommand = !needsReadEvidence
    && (requiresCommandEvidence(text) || (needsCodeArtifact && existingCodeWrites.length > 0));

  const runtimeKinds = new Set<TerminalEvidenceKind>(['run', 'test', 'compile-run']);
  const testKinds = new Set<TerminalEvidenceKind>(['test', 'run', 'compile-run']);
  const commandKinds = new Set<TerminalEvidenceKind>(['compile', 'run', 'test', 'compile-run']);

  if (requiresRunEvidence(text) || (requiresRuntimeValidation(text) && !requiresTestEvidence(text))) {
    const failure = lastUnclearedTerminalFailure(terminalEvidence, runtimeKinds, runtimeKinds);
    if (failure) return failure;
  }
  if (requiresTestEvidence(text)) {
    const failure = lastUnclearedTerminalFailure(terminalEvidence, testKinds, testKinds);
    if (failure) return failure;
  }
  if (needsCommand) {
    const failure = lastUnclearedTerminalFailure(terminalEvidence, commandKinds, commandKinds);
    if (failure) return failure;
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

export function buildTerminalFailureRepairFeedback(failure: TerminalEvidence, missing: string[]): string {
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

export function getMissingCompletionEvidence(
  userPrompt: string,
  todos: CompletionTodo[],
  writtenFiles: WrittenFileEvidence[],
  terminalEvidence: TerminalEvidence[],
  readEvidencePaths: string[] = [],
): string[] {
  const text = buildEvidenceText(userPrompt, todos);
  const existingWrittenFiles = coalesceWrittenFileEvidence(writtenFiles).filter(f => {
    try { return fs.existsSync(f.path); } catch { return false; }
  });
  const existingCodeWrites = existingWrittenFiles.filter(f => isCodeArtifactPath(f.path));
  const successfulEvidence = terminalEvidence.filter(e => e.ok);
  const missing: string[] = [];

  const needsFileChange = requiresFileChangeEvidence(text);
  const needsCodeArtifact = requiresCodeArtifactForEvidence(text);
  const needsReadEvidence = requiresReadEvidence(text);
  const needsFileContentReadEvidence = requiresFileContentReadEvidence(text);
  const needsFileCheckEvidence = requiresFileCheckEvidence(text);
  if (needsCodeArtifact && existingCodeWrites.length === 0) {
    missing.push('代码修改结果');
  } else if (needsFileChange && existingWrittenFiles.length === 0) {
    missing.push('文件修改结果');
  }

  if (needsReadEvidence) {
    const hasReadEvidence = readEvidencePaths.length > 0
      || successfulEvidence.some(e =>
        e.kind === 'other'
        && (needsFileContentReadEvidence
          ? isFileContentTerminalEvidenceCommand(e.command)
          : isReadOnlyTerminalEvidenceCommand(e.command)),
      );
    if (!hasReadEvidence) missing.push(needsFileContentReadEvidence ? '文件内容读取结果' : '文件读取/检查结果');
  }

  const commandEvidenceNeeded = !needsReadEvidence && requiresCommandEvidence(text);
  if (requiresRunEvidence(text)) {
    const hasRunEvidence = successfulEvidence.some(e => e.kind === 'run' || e.kind === 'test' || e.kind === 'compile-run');
    if (!hasRunEvidence) missing.push('成功的程序运行结果');
  } else if (requiresTestEvidence(text)) {
    const hasTestEvidence = successfulEvidence.some(e => e.kind === 'test' || e.kind === 'run' || e.kind === 'compile-run');
    if (!hasTestEvidence) missing.push('成功的测试/运行结果');
  } else if (needsFileCheckEvidence) {
    const hasFileCheckEvidence = successfulEvidence.some(e =>
      e.kind === 'other' && isReadOnlyTerminalEvidenceCommand(e.command),
    );
    if (!hasFileCheckEvidence) missing.push('文件读取/检查结果');
  } else if (commandEvidenceNeeded && successfulEvidence.length === 0) {
    missing.push('成功的编译/运行/测试命令结果');
  } else if (needsCodeArtifact && existingCodeWrites.length > 0 && successfulEvidence.length === 0) {
    missing.push('成功的编译/测试/语法验证命令结果');
  }

  return missing;
}
