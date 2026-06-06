import * as vscode from 'vscode';

export interface CodeContext {
  code: string;
  language: string;
  filename: string;
  relPath: string;
  diagnostics: string;
}

/** 获取当前编辑器代码上下文 */
export function buildContext(editor: vscode.TextEditor): CodeContext {
  const doc = editor.document;
  const config = vscode.workspace.getConfiguration('devseek');
  const maxLines = config.get<number>('maxContextLines', 100);

  const language = doc.languageId;
  const filename = doc.fileName.split('/').pop() || 'unknown';
  const relPath = vscode.workspace.asRelativePath(doc.uri);

  // 优先用选中区域，否则取光标周围 ±maxLines/2 行
  let code: string;
  if (!editor.selection.isEmpty) {
    code = doc.getText(editor.selection);
  } else {
    const line = editor.selection.active.line;
    const half = Math.floor(maxLines / 2);
    const startLine = Math.max(0, line - half);
    const endLine = Math.min(doc.lineCount - 1, line + half);
    const range = new vscode.Range(startLine, 0, endLine, doc.lineAt(endLine).text.length);
    code = doc.getText(range);
  }

  // LSP 诊断（错误 & 警告）
  const diags = vscode.languages.getDiagnostics(doc.uri)
    .filter((d) => d.severity === vscode.DiagnosticSeverity.Error ||
                   d.severity === vscode.DiagnosticSeverity.Warning)
    .slice(0, 10)
    .map((d) => `Line ${d.range.start.line + 1}: [${d.severity === 0 ? 'ERROR' : 'WARN'}] ${d.message}`)
    .join('\n');

  return { code, language, filename, relPath, diagnostics: diags };
}

/** 构建发往 DeepSeek 的完整 Prompt */
export function buildPrompt(ctx: CodeContext, instruction: string): string {
  const config = vscode.workspace.getConfiguration('devseek');
  const replyLang = config.get<string>('language', 'zh') === 'zh' ? '中文' : 'English';

  const parts: string[] = [
    '你是一个专业的编程助手。',
    '',
    `当前文件：${ctx.relPath}`,
    `编程语言：${ctx.language}`,
    '',
  ];

  if (ctx.diagnostics) {
    parts.push('当前诊断错误：');
    parts.push('```');
    parts.push(ctx.diagnostics);
    parts.push('```');
    parts.push('');
  }

  parts.push('代码：');
  parts.push(`\`\`\`${ctx.language}`);
  parts.push(ctx.code);
  parts.push('```');
  parts.push('');
  parts.push('---');
  parts.push(instruction);
  parts.push('');
  parts.push(`请用${replyLang}回复。`);

  return parts.join('\n');
}

/** 构建行内补全 Prompt（EX-31）
 *  prefix: 光标前代码，suffix: 光标后代码
 */
export function buildCompletionPrompt(
  prefix: string, suffix: string, language: string, relPath: string,
): string {
  const config = vscode.workspace.getConfiguration('devseek');
  const replyLang = config.get<string>('language', 'zh') === 'zh' ? '中文' : 'English';
  return [
    '你是一个专业的代码补全助手。',
    `当前文件：${relPath}  编程语言：${language}`,
    '',
    '补全下面代码中间缺失的部分（只输出补全内容，不要重复已有代码，不要解释）：',
    `\`\`\`${language}`,
    `${prefix}<FILL_HERE>${suffix}`,
    '```',
    '',
    `请用${replyLang}输出纯代码，不要 markdown 包裹。`,
  ].join('\n');
}

/** 构建行内聊天 Prompt（EX-40）
 *  instruction: 用户指令，code: 选中代码
 */
export function buildInlineChatPrompt(
  instruction: string, code: string, language: string, relPath: string,
): string {
  const config = vscode.workspace.getConfiguration('devseek');
  const replyLang = config.get<string>('language', 'zh') === 'zh' ? '中文' : 'English';
  return [
    '你是一个专业的编程助手。',
    `当前文件：${relPath}  编程语言：${language}`,
    '',
    `对下面的代码执行以下操作：${instruction}`,
    '只输出修改后的完整代码块，不要解释：',
    `\`\`\`${language}`,
    code,
    '```',
    '',
    `请用${replyLang}输出。`,
  ].join('\n');
}

/** 构建 Git 提交信息 Prompt（EX-70）*/
export function buildCommitPrompt(diff: string): string {
  return [
    '根据以下 git diff 生成一条符合 Conventional Commits 规范的提交信息。',
    '格式：type(scope): description（用中文描述，scope 可省略）',
    '只输出提交信息本身，不要解释，不要 markdown：',
    '',
    '```diff',
    diff.slice(0, 6000),   // 防止超长
    '```',
  ].join('\n');
}

/** 获取 #problems 诊断列表（EX-52）*/
export function getProblemsContext(): string {
  const all = vscode.languages.getDiagnostics();
  const lines: string[] = [];
  for (const [uri, diags] of all) {
    const rel = vscode.workspace.asRelativePath(uri);
    for (const d of diags) {
      if (d.severity > vscode.DiagnosticSeverity.Warning) continue;
      const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'ERROR' : 'WARN';
      lines.push(`${rel}:${d.range.start.line + 1} [${sev}] ${d.message}`);
    }
  }
  return lines.slice(0, 50).join('\n');
}

/**
 * P2-4: 将当前工作区诊断错误格式化为可注入 prompt 的字符串
 * @param scope 'all' = 全工作区，'active' = 仅当前文件
 * @param maxItems 最多返回多少条（默认 30）
 */
export function getDiagnosticsContext(scope: 'all' | 'active' = 'all', maxItems = 30): string {
  const editor = vscode.window.activeTextEditor;
  let entries: [vscode.Uri, vscode.Diagnostic[]][];

  if (scope === 'active' && editor) {
    const diags = vscode.languages.getDiagnostics(editor.document.uri);
    entries = [[editor.document.uri, diags]];
  } else {
    entries = vscode.languages.getDiagnostics();
  }

  const lines: string[] = [];
  for (const [uri, diags] of entries) {
    const rel = vscode.workspace.asRelativePath(uri);
    for (const d of diags) {
      if (d.severity > vscode.DiagnosticSeverity.Warning) continue;
      const sev = d.severity === vscode.DiagnosticSeverity.Error ? 'error' : 'warning';
      const src = d.source ? `[${d.source}] ` : '';
      lines.push(`${rel}:${d.range.start.line + 1}:${d.range.start.character + 1}: ${sev}: ${src}${d.message}`);
      if (lines.length >= maxItems) break;
    }
    if (lines.length >= maxItems) break;
  }

  if (lines.length === 0) return '';
  return '[当前诊断错误]\n' + lines.join('\n') + '\n[/当前诊断错误]';
}
