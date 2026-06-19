import * as vscode from 'vscode';
import * as nodePath from 'path';
import * as fs from 'fs';
import { ChangeAction, createChangeAction, ResolvedGeneratedArtifact, summarizeChangeActions } from './change-plan';
import { GeneratedArtifact, GeneratedFile, looksLikeRawToolCallText, parseGeneratedArtifacts } from './generated-file-parser';
import { CppValidationPolicy, planCppValidation } from './validation-planner';
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

export interface ApplyWorkflowStatus {
  phase: 'apply' | 'validate' | 'repair';
  state: 'started' | 'completed' | 'skipped' | 'passed' | 'failed';
  title: string;
  detail?: string;
}

export interface AutoValidationResult {
  ran: boolean;
  ok: boolean;
  command: string;
  exitCode: number | null;
  output: string;
  cwd: string;
  mode?: 'compile-only' | 'compile-link' | 'compile-run' | 'cmake';
  reason?: string;
}

export interface ApplyWorkflowResult {
  applied: boolean;
  changeCount: number;
  changedPaths: string[];
  validation?: AutoValidationResult;
  rolledBack?: boolean;
}

export interface AppliedChangeRecord {
  path: string;
  existed: boolean;
  oldContent: string;
  newContent: string;
}

type ApplyWorkflowReporter = (status: ApplyWorkflowStatus) => void | Thenable<void>;
type AppliedChangeReporter = (change: AppliedChangeRecord) => void | Thenable<void>;

const CPP_COMPILE_VALIDATION_TIMEOUT_MS = 15_000;
const CPP_RUN_VALIDATION_TIMEOUT_MS = 30_000;
const PROJECT_BUILD_VALIDATION_TIMEOUT_MS = 120_000;
const CMAKE_RUN_VALIDATION_TIMEOUT_MS = 30_000;

export interface ApplyGeneratedArtifactsOptions {
  rollbackOnValidationFailure?: boolean;
}

interface PreparedChange {
  action: ChangeAction;
  targetUri: vscode.Uri;
  relPath: string;
  exists: boolean;
  oldContent: string;
  newContent: string;
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
  const selected = selectPreparedChangesByPath(prepared, targetPath);
  return applyPreparedChanges(selected, reporter, autoApply, targetPath, requestPrompt, onAppliedChange, preferredAbsolutePaths, options);
}

async function applyPreparedChanges(
  prepared: PreparedChange[],
  reporter?: ApplyWorkflowReporter,
  autoApply = false,
  targetPathForMsg?: string,
  requestPrompt?: string,
  onAppliedChange?: AppliedChangeReporter,
  preferredAbsolutePaths?: string[],
  options?: ApplyGeneratedArtifactsOptions,
): Promise<ApplyWorkflowResult> {
  const root = getWorkspaceRoot(requestPrompt, preferredAbsolutePaths);
  const pathContext = root ? buildWorkspacePathContext(root, requestPrompt, preferredAbsolutePaths) : undefined;
  const rollbackOnValidationFailure = options?.rollbackOnValidationFailure !== false;
  if (prepared.length === 0) {
    if (targetPathForMsg) {
      vscode.window.showInformationMessage(`DeepSeek: 未检测到可应用的目标文件变更：${targetPathForMsg}`);
    } else {
      vscode.window.showInformationMessage('DeepSeek: 未检测到可应用的文件或 diff。');
    }
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
    };
  }

  const summary = summarizeChangeActions(prepared.map((change) => change.action));
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
        return {
          applied: false,
          changeCount: 0,
          changedPaths: [],
        };
      }
    } else if (choice !== '应用全部') {
      return {
        applied: false,
        changeCount: 0,
        changedPaths: [],
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
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
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
    return {
      applied: false,
      changeCount: 0,
      changedPaths: [],
    };
  }

  await reportWorkflow(reporter, {
    phase: 'apply',
    state: 'started',
    title: '正在应用文件变更',
    detail: `共 ${prepared.length} 个变更，新建 ${summary.creates}，覆盖 ${summary.overwrites}，补丁 ${summary.patches}${targetPathForMsg ? `\n目标: ${targetPathForMsg}` : ''}`,
  });

  const createdDirs = new Set<string>();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'DeepSeek: 正在应用文件变更...', cancellable: false },
    async () => {
      for (const change of prepared) {
        const parent = vscode.Uri.file(nodePath.dirname(change.targetUri.fsPath));
        for (const dir of collectMissingParentDirs(parent.fsPath, root?.fsPath)) {
          createdDirs.add(dir);
        }
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(change.targetUri, Buffer.from(change.newContent, 'utf8'));
      }
    },
  );

  vscode.window.showInformationMessage(`DeepSeek: 已应用 ${prepared.length} 个文件变更`);
  await vscode.window.showTextDocument(prepared[0].targetUri, { preview: false });

  await reportWorkflow(reporter, {
    phase: 'apply',
    state: 'completed',
    title: '文件应用完成',
    detail: prepared.slice(0, 6).map((change) => change.relPath).join('\n'),
  });

  await reportWorkflow(reporter, {
    phase: 'validate',
    state: 'started',
    title: '正在执行自动编译/验证',
    detail: '根据变更路径自动选择构建命令',
  });

  const validation = await runAutoValidation(prepared.map((p) => p.relPath), root, requestPrompt);
  if (!validation) {
    await reportWorkflow(reporter, {
      phase: 'validate',
      state: 'skipped',
      title: '未执行自动验证',
      detail: '未识别到可自动验证的目标（bridge / extension / C++ 目录项目）。',
    });
    await reportAppliedChanges(prepared, onAppliedChange);
    return {
      applied: true,
      changeCount: prepared.length,
      changedPaths: prepared.map((p) => p.relPath),
    };
  }

  await reportWorkflow(reporter, {
    phase: 'validate',
    state: validation.ok ? 'passed' : 'failed',
    title: validation.ok ? '自动验证通过' : '自动验证失败',
    detail: `模式: ${validation.mode || 'unknown'}\n原因: ${validation.reason || 'n/a'}\n命令: ${validation.command}\nexitCode: ${validation.exitCode ?? 'null'}\n${validation.output.trim().slice(0, 1200)}`,
  });

  if (!validation.ok && autoApply && rollbackOnValidationFailure) {
    await rollbackPreparedChanges(prepared, createdDirs);
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
      rolledBack: true,
    };
  }

  await reportAppliedChanges(prepared, onAppliedChange);

  return {
    applied: true,
    changeCount: prepared.length,
    changedPaths: prepared.map((p) => p.relPath),
    validation,
  };
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
    const exists = await fileExists(targetUri);
    const action = createChangeAction(resolved, exists);
    const oldContent = exists ? await readText(targetUri) : '';
    const newContent = action.type === 'patch-file'
      ? applyUnifiedDiff(oldContent, action.diff, relPath)
      : ensureFinalNewline(action.content);
    if (looksLikeRawToolCallText(newContent)) continue;

    changes.push({ action, targetUri, relPath, exists, oldContent, newContent });
  }

  return dedupeChanges(changes);
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

async function rollbackPreparedChanges(prepared: PreparedChange[], createdDirs?: Set<string>): Promise<void> {
  for (const change of [...prepared].reverse()) {
    if (change.exists) {
      await vscode.workspace.fs.writeFile(change.targetUri, Buffer.from(change.oldContent, 'utf8'));
      continue;
    }

    try {
      await vscode.workspace.fs.delete(change.targetUri, { useTrash: false });
    } catch {
      // Ignore rollback delete errors for files that do not exist.
    }
  }

  await cleanupCreatedEmptyDirs(createdDirs);
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
  const sectionRe = /^\s*\d+[.)]\s+([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql))(?:\s*[-—–:：].*)?\s*$/i;
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

function inferPathFromText(text: string): string | undefined {
  const re = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql))/gi;
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

function getWorkspaceRoot(requestPrompt?: string, preferredAbsolutePaths?: string[]): vscode.Uri | undefined {
  return getWorkspaceRootUri(requestPrompt, preferredAbsolutePaths);
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

async function readText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
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

async function runAutoValidation(changedPaths: string[], root?: vscode.Uri, requestPrompt?: string): Promise<AutoValidationResult | null> {
  if (!root) return null;
  const config = vscode.workspace.getConfiguration('devseek');

  const hasBridge = changedPaths.some((p) => p.startsWith('packages/bridge/'));
  const hasExtension = changedPaths.some((p) => p.startsWith('packages/vscode-extension/'));
  const cppRelated = changedPaths.filter((p) => /\.(cpp|cc|cxx|c|h|hpp)$/i.test(p));

  if (hasBridge) {
    return runShell('npm run build', nodePath.join(root.fsPath, 'packages', 'bridge'), PROJECT_BUILD_VALIDATION_TIMEOUT_MS);
  }
  if (hasExtension) {
    return runShell('npm run compile', nodePath.join(root.fsPath, 'packages', 'vscode-extension'), PROJECT_BUILD_VALIDATION_TIMEOUT_MS);
  }
  if (cppRelated.length > 0) {
    const cppPolicy = config.get<CppValidationPolicy>('cppValidationPolicy', 'conservative');
    return runCppAutoValidation(root.fsPath, cppRelated, cppPolicy, shouldRunCppValidation(requestPrompt || ''));
  }

  return null;
}

async function runCppAutoValidation(
  rootFsPath: string,
  cppRelated: string[],
  cppPolicy: CppValidationPolicy,
  shouldRun: boolean,
): Promise<AutoValidationResult | null> {
  const fsNode = require('fs');
  const plan = planCppValidation(cppRelated, rootFsPath, fsNode, cppPolicy, { run: shouldRun });
  if (!plan) return null;

  const timeoutMs = plan.mode === 'compile-run'
    ? CPP_RUN_VALIDATION_TIMEOUT_MS
    : plan.mode === 'cmake' && shouldRun
      ? CMAKE_RUN_VALIDATION_TIMEOUT_MS
      : plan.mode === 'cmake'
        ? PROJECT_BUILD_VALIDATION_TIMEOUT_MS
        : CPP_COMPILE_VALIDATION_TIMEOUT_MS;
  const result = await runShell(plan.command, plan.cwd, timeoutMs);
  return {
    ...result,
    mode: plan.mode,
    reason: plan.reason,
  };
}

function shouldRunCppValidation(prompt: string): boolean {
  return /(?:运行|执行|启动|测试|test|run|execute|看结果|输出效果|运行效果)/i.test(prompt || '');
}

async function runShell(command: string, cwd: string, timeoutMs: number): Promise<AutoValidationResult> {
  return new Promise((resolve) => {
    const cp = require('child_process');
    cp.exec(command, { cwd, timeout: timeoutMs }, (error: Error & { code?: number; killed?: boolean; signal?: string }, stdout: string, stderr: string) => {
      const timedOut = !!error && (error.killed || /timed out|timeout/i.test(error.message || ''));
      const exitCode = !error ? 0 : timedOut ? 124 : (typeof error.code === 'number' ? error.code : null);
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      resolve({
        ran: true,
        ok: !error,
        command,
        exitCode,
        output: timedOut
          ? [output, `[DevSeek] 命令超时，已终止（timeout ${timeoutMs}ms）。这通常表示程序仍在运行、等待输入或构建卡住；自动验证按失败处理。`].filter(Boolean).join('\n')
          : output,
        cwd,
      });
    });
  });
}
