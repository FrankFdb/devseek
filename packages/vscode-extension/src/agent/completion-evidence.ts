import * as fs from 'fs';
import * as nodePath from 'path';

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
};

export function classifyTerminalEvidenceCommand(command: string): TerminalEvidenceKind {
  const c = command.trim();
  const lower = c.toLowerCase();
  const compileLike = /\b(?:g\+\+|gcc|clang\+\+|clang|cmake|make|ninja)\b/.test(lower)
    || /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:build|compile)\b/.test(lower)
    || /\bcargo\s+build\b|\bgo\s+build\b|\bdotnet\s+build\b/.test(lower);
  const testLike = /\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test)\b/.test(lower)
    || /\b(?:pytest|go\s+test|cargo\s+test|dotnet\s+test|ctest)\b/.test(lower);
  const runLike = /(?:^|[;&|]\s*)(?:\.\/|\/)[^\s;&|]+/.test(c)
    || /\b(?:python3?|node|java|cargo\s+run|go\s+run|dotnet\s+run)\b/.test(lower);
  if (compileLike && runLike) return 'compile-run';
  if (testLike) return 'test';
  if (runLike) return 'run';
  if (compileLike) return 'compile';
  return 'other';
}

const CODE_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.go', '.rs', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.scala',
  '.html', '.css', '.scss', '.sass', '.vue', '.svelte', '.sh', '.bash', '.zsh',
]);

const FILE_CHANGE_RE = /(?:写|创建|新建|生成|编写|实现|开发|做(?:一个|一款)?|修复|修改|改进|改造|重构|更新|添加|删除|create|write|implement|develop|fix|repair|modify|edit|refactor|update|add|delete)/i;
const CODE_TARGET_RE = /(?:代码|源码|程序|脚本|算法|功能|组件|游戏|网页|页面|应用|component|class|function|algorithm|app|web|c\+\+|cpp|c语言|python|javascript|typescript|java|golang|rust|\.c\b|\.cc\b|\.cpp\b|\.h\b|\.hpp\b|\.py\b|\.js\b|\.jsx\b|\.ts\b|\.tsx\b|\.mjs\b|\.java\b|\.go\b|\.rs\b|\.cs\b|\.php\b|\.rb\b|\.swift\b|\.kt\b|\.html\b|\.css\b|\.vue\b|\.svelte\b|\.sh\b)/i;
const FILE_PATH_TARGET_RE = /(?:^|[^\w/.-])(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*\.[A-Za-z0-9]{1,12}\b/;
const READ_ONLY_RE = /(?:(?:不要|不用|无需|不需要|禁止|别).{0,8}(?:修改|改动|改|变更|写|写入|创建|新建|生成|更新|删除).{0,4}(?:代码|文件|内容)?|(?:只|仅).{0,6}(?:分析|评估|说明|解释|计划|审计|查看|确认|检查|读取|显示)|do not .{0,20}(?:modify|edit|change|write|create|update|delete))/i;
const READ_EVIDENCE_RE = /(?:检查|查看|读取|显示|确认|是否存在|内容|read|show|display|check|inspect|exists?)/i;
const GENERIC_EVIDENCE_TODO_TITLES = new Set([
  '创建/更新文件',
  '编译/运行并验证结果',
]);

export function isCodeArtifactPath(filePath: string): boolean {
  return CODE_FILE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
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
  return READ_ONLY_RE.test(text);
}

function stripInlineFileContent(text: string): string {
  return text.replace(/(?:内容为|内容是|内容如下|content\s*(?:is|:)|with\s+content)\s*[:：]?\s*[\s\S]*$/i, '');
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

export function getMissingCompletionEvidence(
  userPrompt: string,
  todos: CompletionTodo[],
  writtenFiles: WrittenFileEvidence[],
  terminalEvidence: TerminalEvidence[],
  readEvidencePaths: string[] = [],
): string[] {
  const text = buildEvidenceText(userPrompt, todos);
  const existingWrittenFiles = writtenFiles.filter(f => {
    try { return fs.existsSync(f.path); } catch { return false; }
  });
  const existingCodeWrites = existingWrittenFiles.filter(f => isCodeArtifactPath(f.path));
  const successfulEvidence = terminalEvidence.filter(e => e.ok);
  const missing: string[] = [];

  const needsFileChange = requiresFileChangeEvidence(text);
  const needsCodeArtifact = requiresCodeArtifactForEvidence(text);
  const needsReadEvidence = requiresReadEvidence(text);
  if (needsCodeArtifact && existingCodeWrites.length === 0) {
    missing.push('代码修改结果');
  } else if (needsFileChange && existingWrittenFiles.length === 0) {
    missing.push('文件修改结果');
  }

  if (needsReadEvidence) {
    const hasReadEvidence = readEvidencePaths.length > 0
      || successfulEvidence.some(e =>
        e.kind === 'other'
        && /\b(?:cat|ls|test|grep|head|tail|wc|stat|file|find)\b/i.test(e.command || ''),
      );
    if (!hasReadEvidence) missing.push('文件读取/检查结果');
  }

  const commandEvidenceNeeded = !needsReadEvidence && requiresCommandEvidence(text);
  if (requiresRunEvidence(text)) {
    const hasRunEvidence = successfulEvidence.some(e => e.kind === 'run' || e.kind === 'test' || e.kind === 'compile-run');
    if (!hasRunEvidence) missing.push('成功的程序运行结果');
  } else if (requiresTestEvidence(text)) {
    const hasTestEvidence = successfulEvidence.some(e => e.kind === 'test' || e.kind === 'run' || e.kind === 'compile-run');
    if (!hasTestEvidence) missing.push('成功的测试/运行结果');
  } else if (commandEvidenceNeeded && successfulEvidence.length === 0) {
    missing.push('成功的编译/运行/测试命令结果');
  } else if (needsCodeArtifact && existingCodeWrites.length > 0 && successfulEvidence.length === 0) {
    missing.push('成功的编译/测试/语法验证命令结果');
  }

  return missing;
}
