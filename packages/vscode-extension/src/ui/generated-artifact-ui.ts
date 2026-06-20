import * as vscode from 'vscode';
import * as nodePath from 'path';
import { parseGeneratedArtifacts, type GeneratedArtifact } from '../generated-file-parser';
import { resolveGeneratedArtifactPathForPrompt } from '../workspace-applier';
import { isGeneratedArtifactAllowedForPrompt } from '../workspace/path-resolver';
import { resolveWorkspaceFileUri } from '../workspace-roots';

type GeneratedContentDisplayMode = 'hidden' | 'collapsed' | 'full';
type WorkingCopyStyle = 'concise' | 'detailed';

interface OpenGeneratedPathOptions {
  rawPath: string;
  line?: number;
  generatedText?: string;
  requestPrompt?: string;
  preferredAbsolutePaths?: string[];
  fallbackAbsolutePaths?: string[];
}

function getGeneratedContentDisplayMode(): GeneratedContentDisplayMode {
  const config = vscode.workspace.getConfiguration('devseek');
  const mode = config.get<string>('generatedContentDisplayMode', 'collapsed');
  if (mode === 'hidden' || mode === 'full') return mode;
  return 'collapsed';
}

function getWorkingCopyStyle(): WorkingCopyStyle {
  const config = vscode.workspace.getConfiguration('devseek');
  const style = config.get<string>('workingCopyStyle', 'detailed');
  return style === 'concise' ? 'concise' : 'detailed';
}

export function pushUiSettings(webview: vscode.Webview): void {
  const cfg = vscode.workspace.getConfiguration('devseek');
  webview.postMessage({
    type: 'uiSettings',
    generatedContentDisplayMode: getGeneratedContentDisplayMode(),
    workingCopyStyle: getWorkingCopyStyle(),
    autopilotMode: cfg.get<boolean>('autopilotMode', false),
    agentEnabled: cfg.get<boolean>('agentEnabled', true),
    maxAgentRounds: cfg.get<number>('maxAgentRounds', 25),
  });
}

interface GeneratedPathMeta {
  path: string;
  kind: 'file' | 'patch';
  operation: 'create' | 'update' | 'patch';
  exists: boolean;
}

export async function emitResponseMeta(
  webview: vscode.Webview,
  rawResponse: string,
  requestPrompt?: string,
  preferredAbsolutePaths?: string[],
): Promise<void> {
  const artifacts = parseGeneratedArtifacts(rawResponse || '');
  const generatedPaths: GeneratedPathMeta[] = [];
  const seen = new Set<string>();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

  for (const artifact of artifacts) {
    const normalized = normalizePathForMeta(
      resolveGeneratedArtifactPathForPrompt(artifact.path, requestPrompt, preferredAbsolutePaths),
    );
    if (!isGeneratedArtifactAllowedForPrompt(normalized, requestPrompt, preferredAbsolutePaths)) continue;
    const key = `${artifact.type}:${normalized}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const exists = workspaceRoot ? await workspacePathExists(workspaceRoot, normalized) : false;
    const operation: 'create' | 'update' | 'patch' = artifact.type === 'patch'
      ? 'patch'
      : exists
        ? 'update'
        : 'create';

    generatedPaths.push({
      path: normalized,
      kind: artifact.type,
      operation,
      exists,
    });
  }

  webview.postMessage({
    type: 'responseMeta',
    hasGeneratedArtifacts: generatedPaths.length > 0,
    generatedPaths,
    pathHints: preferredAbsolutePaths ?? [],
  });
}

function normalizePathForMeta(pathValue: string): string {
  return (pathValue || '')
    .trim()
    .replace(/^a\//, '')
    .replace(/^b\//, '')
    .replace(/^\.\//, '')
    .replace(/\\/g, '/');
}

async function workspacePathExists(workspaceRoot: vscode.Uri, relativePath: string): Promise<boolean> {
  if (!relativePath) return false;
  const safe = relativePath.replace(/^\/+/, '').replace(/\.\.(?:\/|$)/g, '');
  if (!safe) return false;
  const target = vscode.Uri.joinPath(workspaceRoot, ...safe.split('/'));
  try {
    await vscode.workspace.fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function openWorkspacePathInEditor(options: OpenGeneratedPathOptions): Promise<void> {
  const parsed = parsePathRef(options.rawPath, options.line);
  const preferredAbsolutePaths = options.preferredAbsolutePaths && options.preferredAbsolutePaths.length > 0
    ? options.preferredAbsolutePaths
    : (options.fallbackAbsolutePaths ?? []);
  const normalized = normalizePathForMeta(
    resolveGeneratedArtifactPathForPrompt(parsed.path, options.requestPrompt, preferredAbsolutePaths),
  );
  const targetLine = parsed.line;
  const target = resolveWorkspaceFileUri(normalized, preferredAbsolutePaths);
  if (!target) {
    vscode.window.showWarningMessage('DeepSeek: 当前没有打开工作区，无法定位文件。');
    return;
  }

  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    vscode.window.showWarningMessage(`DeepSeek: 非法路径，无法打开：${options.rawPath}`);
    return;
  }

  try {
    await vscode.workspace.fs.stat(target);
    const doc = await vscode.workspace.openTextDocument(target);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    revealEditorLine(editor, targetLine);
    return;
  } catch {
    // Fallback to virtual preview for generated but not yet applied content.
  }

  const preview = buildVirtualPreviewFromGenerated(normalized, options.generatedText || '', options.requestPrompt, preferredAbsolutePaths);
  if (!preview) {
    vscode.window.showInformationMessage(`DeepSeek: 文件尚未落地：${normalized}。可先点击“预览”或“应用”。`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument({
    content: preview.content,
    language: preview.language,
  });
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  revealEditorLine(editor, targetLine);
  vscode.window.showInformationMessage(`DeepSeek: 打开了 ${normalized} 的虚拟预览（尚未写入工作区）。`);
}


function parsePathRef(rawPath: string, lineHint?: number): { path: string; line?: number } {
  let path = (rawPath || '').replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^a\//, '').replace(/^b\//, '');
  let line = normalizeLine(lineHint);

  const hashRef = path.match(/#L(\d+)$/i);
  if (hashRef) {
    path = path.slice(0, hashRef.index).trim();
    line = normalizeLine(Number(hashRef[1])) || line;
  }

  const colonRef = path.match(/:(\d+)(?::\d+)?$/);
  if (colonRef) {
    path = path.slice(0, colonRef.index).trim();
    line = normalizeLine(Number(colonRef[1])) || line;
  }

  return { path, line };
}

function normalizeLine(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.floor(value);
  return rounded >= 1 ? rounded : undefined;
}

export function revealEditorLine(editor: vscode.TextEditor, line?: number): void {
  if (!line) return;
  const target = new vscode.Position(Math.max(0, line - 1), 0);
  editor.selection = new vscode.Selection(target, target);
  editor.revealRange(new vscode.Range(target, target), vscode.TextEditorRevealType.InCenter);
}

function buildVirtualPreviewFromGenerated(path: string, rawText: string, requestPrompt: string | undefined, preferredAbsolutePaths: string[]): { content: string; language?: string } | undefined {
  if (!rawText.trim()) return undefined;
  const targetKey = normalizePathKey(path);
  const artifacts = parseGeneratedArtifacts(rawText);

  const direct = findArtifactByPath(artifacts, targetKey, requestPrompt, preferredAbsolutePaths);
  if (direct) return artifactToPreview(direct);

  const targetBase = nodePath.posix.basename(targetKey);
  const byBase = artifacts.filter((artifact) => nodePath.posix.basename(normalizePathKey(artifact.path)) === targetBase);
  if (byBase.length === 1) return artifactToPreview(byBase[0]);

  // Fallback for prompts that mention the path without strict artifact structure.
  const promptPath = extractPreviewPathFromPrompt(requestPrompt || '', targetBase);
  if (promptPath) {
    const promptHit = findArtifactByPath(artifacts, normalizePathKey(promptPath), requestPrompt, preferredAbsolutePaths);
    if (promptHit) return artifactToPreview(promptHit);
  }

  return undefined;
}

function findArtifactByPath(artifacts: GeneratedArtifact[], targetKey: string, requestPrompt: string | undefined, preferredAbsolutePaths: string[]): GeneratedArtifact | undefined {
  for (const artifact of artifacts) {
    if (normalizePathKey(artifact.path) === targetKey) return artifact;
    const resolved = resolveGeneratedArtifactPathForPrompt(artifact.path, requestPrompt, preferredAbsolutePaths);
    if (normalizePathKey(resolved) === targetKey) return artifact;
  }
  return undefined;
}

function artifactToPreview(artifact: GeneratedArtifact): { content: string; language?: string } {
  if (artifact.type === 'file') {
    return {
      content: artifact.content,
      language: artifact.language || guessLanguageFromPath(artifact.path),
    };
  }
  return {
    content: artifact.diff,
    language: 'diff',
  };
}

function normalizePathKey(path: string): string {
  return (path || '')
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\.\//, '')
    .replace(/^a\//, '')
    .replace(/^b\//, '');
}

function extractPreviewPathFromPrompt(prompt: string, baseName: string): string | undefined {
  if (!prompt || !baseName) return undefined;
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = prompt.match(new RegExp(`([A-Za-z0-9_./-]+/${escaped})`, 'i'));
  return m ? m[1] : undefined;
}

function guessLanguageFromPath(path: string): string | undefined {
  const ext = nodePath.posix.extname(path).toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    json: 'json',
    md: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    sh: 'shellscript',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    java: 'java',
  };
  return map[ext];
}

/**
 * 当 parser 无法从回复中识别文件路径时，尝试把附加文件路径注入到无标识代码块前，
 * 以便 parser 能关联代码块和文件。仅对语言扩展匹配的代码块注入，且只处理单文件匹配。
 */
export function injectFileHintsIntoResponse(response: string, absoluteFilePaths: string[]): string {
  if (!response || absoluteFilePaths.length === 0) return response;

  // 获取相对路径和扩展名映射
  const fileInfos = absoluteFilePaths.map((abs) => {
    const rel = vscode.workspace.asRelativePath(abs, false).replace(/\\/g, '/');
    const ext = rel.split('.').pop()?.toLowerCase() ?? '';
    return { abs, rel, ext };
  });

  // 逐个代码块检测：如果该代码块前面的文本没有路径标签，且语言扩展匹配唯一文件，则注入
  const codeBlockRe = /```([^\n`]*)\n([\s\S]*?)```/g;
  type Injection = { index: number; label: string };
  const injections: Injection[] = [];
  let m: RegExpExecArray | null;

  while ((m = codeBlockRe.exec(response)) !== null) {
    const fenceLang = m[1].trim().toLowerCase();
    // 检查此代码块前 200 字符内是否已有文件路径标签
    const preText = response.slice(Math.max(0, m.index - 200), m.index);
    const alreadyLabeled = fileInfos.some(({ rel }) =>
      preText.includes(rel) || preText.includes(rel.split('/').pop() ?? ''),
    );
    if (alreadyLabeled) continue;

    // 按语言扩展找匹配文件（支持同义别名：cpp/cc/cxx/h → cpp, js/ts → js/ts）
    const EXT_ALIASES: Record<string, string[]> = {
      cpp: ['cpp', 'cc', 'cxx', 'c++'],
      c: ['c'],
      h: ['h', 'hpp'],
      hpp: ['h', 'hpp'],
      ts: ['ts', 'tsx'],
      js: ['js', 'jsx', 'mjs', 'cjs'],
    };
    const aliases = EXT_ALIASES[fenceLang] ?? [fenceLang];
    const matched = fileInfos.filter(({ ext }) => aliases.includes(ext));

    // 只在唯一匹配时注入，避免歧义；注入文件名（basename），applier 负责映射到完整路径
    if (matched.length === 1) {
      const basename = matched[0].rel.split('/').pop() ?? matched[0].rel;
      injections.push({ index: m.index, label: `${basename}\n` });
    }
  }

  // 顺序注入兜底：唯一性匹配全部失败，但代码块数 == 文件数时，按顺序对应注入
  // 这是处理多个同扩展名文件（如 6 个 .hpp）的关键路径
  if (injections.length === 0) {
    const seqBlocks: number[] = [];
    const seqRe = /```[^\n`]*\n[\s\S]*?```/g;
    let seqM: RegExpExecArray | null;
    while ((seqM = seqRe.exec(response)) !== null) {
      seqBlocks.push(seqM.index);
    }
    if (seqBlocks.length === fileInfos.length && seqBlocks.length > 0) {
      for (let i = 0; i < seqBlocks.length; i++) {
        const basename = fileInfos[i].rel.split('/').pop() ?? fileInfos[i].rel;
        injections.push({ index: seqBlocks[i], label: `${basename}\n` });
      }
    }
  }

  if (injections.length === 0) return response;

  // 从后向前注入，保持偏移正确
  let result = response;
  for (const inj of injections.reverse()) {
    result = result.slice(0, inj.index) + inj.label + result.slice(inj.index);
  }
  return result;
}
