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

const CODE_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.go', '.rs', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.scala',
  '.html', '.css', '.scss', '.sass', '.vue', '.svelte', '.sh', '.bash', '.zsh',
]);

const FILE_CHANGE_RE = /(?:写|创建|新建|生成|编写|实现|开发|做(?:一个|一款)?|修复|修改|改进|改造|重构|更新|添加|删除|create|write|implement|develop|fix|repair|modify|edit|refactor|update|add|delete)/i;
const CODE_TARGET_RE = /(?:代码|源码|程序|脚本|算法|功能|组件|文件|游戏|网页|页面|应用|component|class|function|algorithm|app|web|c\+\+|cpp|c语言|python|javascript|typescript|java|golang|rust|\.c\b|\.cc\b|\.cpp\b|\.h\b|\.hpp\b|\.py\b|\.js\b|\.jsx\b|\.ts\b|\.tsx\b|\.mjs\b|\.java\b|\.go\b|\.rs\b|\.cs\b|\.php\b|\.rb\b|\.swift\b|\.kt\b|\.html\b|\.css\b|\.vue\b|\.svelte\b|\.sh\b)/i;
const READ_ONLY_RE = /(?:(?:不要|不用|无需|不需要|禁止).{0,8}(?:修改代码|改代码|写代码|写入文件)|(?:只|仅).{0,6}(?:分析|评估|说明|解释|计划|审计|查看|确认)|do not .{0,20}(?:modify|edit|change|write))/i;

export function isCodeArtifactPath(filePath: string): boolean {
  return CODE_FILE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

function buildEvidenceText(userPrompt: string, todos: CompletionTodo[]): string {
  return `${userPrompt}\n${todos.map(t => t.title).join('\n')}`.toLowerCase();
}

function explicitlyReadOnly(text: string): boolean {
  return READ_ONLY_RE.test(text);
}

function requiresFileChangeEvidence(text: string): boolean {
  if (!text.trim() || explicitlyReadOnly(text)) return false;
  return FILE_CHANGE_RE.test(text) && CODE_TARGET_RE.test(text);
}

export function requiresCodeArtifactForEvidence(text: string): boolean {
  return requiresFileChangeEvidence(text);
}

export function requiresCommandEvidence(text: string): boolean {
  return /(?:编译|运行|执行|测试|验证|调试|compile|build|test|run|execute|verify)/i.test(text);
}

function requiresRunEvidence(text: string): boolean {
  return /(?:运行|执行|run|execute)/i.test(text);
}

function requiresTestEvidence(text: string): boolean {
  return /(?:测试|test)/i.test(text);
}

export function requiresRuntimeValidation(text: string): boolean {
  return requiresRunEvidence(text) || requiresTestEvidence(text) || /(?:启动|看结果|输出效果|运行效果)/i.test(text);
}

export function getMissingCompletionEvidence(
  userPrompt: string,
  todos: CompletionTodo[],
  writtenFiles: WrittenFileEvidence[],
  terminalEvidence: TerminalEvidence[],
): string[] {
  const text = buildEvidenceText(userPrompt, todos);
  const existingWrittenFiles = writtenFiles.filter(f => {
    try { return fs.existsSync(f.path); } catch { return false; }
  });
  const existingCodeWrites = existingWrittenFiles.filter(f => isCodeArtifactPath(f.path));
  const successfulEvidence = terminalEvidence.filter(e => e.ok);
  const missing: string[] = [];

  const needsCodeArtifact = requiresCodeArtifactForEvidence(text);
  if (needsCodeArtifact && existingCodeWrites.length === 0) {
    missing.push('代码修改结果');
  }

  if (requiresRunEvidence(text)) {
    const hasRunEvidence = successfulEvidence.some(e => e.kind === 'run' || e.kind === 'test' || e.kind === 'compile-run');
    if (!hasRunEvidence) missing.push('成功的程序运行结果');
  } else if (requiresTestEvidence(text)) {
    const hasTestEvidence = successfulEvidence.some(e => e.kind === 'test' || e.kind === 'run' || e.kind === 'compile-run');
    if (!hasTestEvidence) missing.push('成功的测试/运行结果');
  } else if (requiresCommandEvidence(text) && successfulEvidence.length === 0) {
    missing.push('成功的编译/运行/测试命令结果');
  } else if (needsCodeArtifact && existingCodeWrites.length > 0 && successfulEvidence.length === 0) {
    missing.push('成功的编译/测试/语法验证命令结果');
  }

  return missing;
}
