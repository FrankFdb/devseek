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
const FILE_CONTENT_EVIDENCE_RE = /(?:(?:显示|查看|读取|输出|打印).{0,8}(?:文件)?内容|(?:read|show|display|print).{0,16}(?:file\s*)?content)/i;
const READ_ONLY_TERMINAL_EVIDENCE_RE = /\b(?:cat|ls|test|grep|head|tail|sed|wc|stat|file|find)\b/i;
const FILE_CONTENT_TERMINAL_EVIDENCE_RE = /\b(?:cat|grep|head|tail|sed)\b/i;
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
