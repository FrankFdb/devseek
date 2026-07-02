import * as nodePath from 'path';
import { GeneratedArtifact, GeneratedFile, parseGeneratedArtifacts } from './generated-file-parser';
import { shouldBlockProjectInstructionFileContent } from './workspace/instruction-file-safety';
import { createWorkspaceFilePathTokenRegExp } from './workspace/path-patterns';

export interface ResolvedGeneratedFile extends GeneratedFile {
  resolvedPath: string;
}

export interface ResolveGeneratedArtifactsOptions {
  responseText: string;
  requestPrompt?: string;
}

export async function resolveGeneratedArtifacts(options: ResolveGeneratedArtifactsOptions): Promise<ResolvedGeneratedFile[]> {
  if (looksLikeReadOnlyPrompt(options.requestPrompt || '')) return [];

  let artifacts = parseGeneratedArtifacts(options.responseText)
    .filter((artifact): artifact is GeneratedFile => artifact.type === 'file')
    .filter((artifact) => !shouldBlockProjectInstructionFileContent(artifact.path, artifact.content));
  if (artifacts.length === 0) {
    artifacts = inferFallbackFiles(options.responseText, options.requestPrompt || '');
  }
  if (artifacts.length === 0) return [];

  const rootPrefix = inferProjectRootPrefix(artifacts, options.requestPrompt || '');
  return artifacts.map((artifact) => ({
    ...artifact,
    resolvedPath: resolveGeneratedPath(artifact.path, options.requestPrompt || '', rootPrefix),
  }));
}

function inferFallbackFiles(responseText: string, requestPrompt: string): GeneratedFile[] {
  const results: GeneratedFile[] = [];
  const blockRe = /```(\w*)\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(responseText)) !== null) {
    const language = (m[1] || '').toLowerCase();
    const content = (m[2] || '').trim();
    if (!content) continue;
    if (looksLikeShellCommands(content)) continue;
    const before = responseText.slice(Math.max(0, m.index - 600), m.index);
    const pathFromContext = extractNearbyPath(before);
    const isCpp = language === 'cpp' || /#include\s*<iostream>|std::|int\s+main\s*\(/.test(content);
    if (!pathFromContext && !(requestMentionsCodeDir(requestPrompt) && isCpp)) continue;
    const path = pathFromContext || `code/${inferProgramBaseName(requestPrompt)}.cpp`;
    if (shouldBlockProjectInstructionFileContent(path, content)) continue;
    results.push({
      type: 'file',
      path,
      language: language || (isCpp ? 'cpp' : undefined),
      content,
    });
  }
  return results;
}

function looksLikeShellCommands(content: string): boolean {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const shellRe = /^(?:[$#]\s*)?(?:mkdir|cd|cp|mv|rm|touch|cat|echo|printf|chmod|chown|g\+\+|gcc|clang\+\+|clang|cmake|make|npm|npx|pnpm|yarn|pip|python|python3|node|go|cargo|rustc|java|javac|git|curl|wget|bash|sh|zsh|\.\/\S+)/i;
  return lines.filter((line) => shellRe.test(line)).length >= Math.ceil(lines.length / 2);
}

function extractNearbyPath(text: string): string | undefined {
  const matches = [...text.matchAll(createWorkspaceFilePathTokenRegExp())]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
  return matches?.[matches.length - 1]?.replace(/\\/g, '/');
}

function inferProgramBaseName(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/hello\s*world|helloworld/.test(lower)) return 'hello';
  if (/动物|animal/.test(lower)) return 'main';
  return 'main';
}

function looksLikeReadOnlyPrompt(prompt: string): boolean {
  const text = prompt || '';
  const readOnly = /(?:解释|说明|分析|为什么|原因|作用|用途|含义|查看|检查|review|explain|analy[sz]e|why)/i.test(text);
  const writeText = text.replace(/实现(?:的)?(?:作用|用途|含义|方式|逻辑)/g, '');
  const writeIntent = /(?:编写|创建|新建|修改|生成|实现|修复|添加|删除|更新|改造|重构|write|create|modify|fix|implement|generate)/i.test(writeText);
  return readOnly && !writeIntent;
}

function resolveGeneratedPath(rawPath: string, requestPrompt: string, rootPrefix: string): string {
  let rel = normalizePath(rawPath);
  if (!rel) return rel;

  if (rel.startsWith('~/')) return rel;
  rel = rel.replace(/^\.\//, '').replace(/^a\//, '').replace(/^b\//, '');
  rel = stripKnownWorkspacePrefix(rel);

  if (!rootPrefix && requestMentionsCodeDir(requestPrompt) && isCodeLikePath(rel) && !rel.startsWith('code/')) {
    rel = nodePath.posix.join('code', nodePath.posix.basename(rel));
  }

  if (rootPrefix && !rel.startsWith(`${rootPrefix}/`) && shouldWrapInProjectRoot(rel)) {
    rel = nodePath.posix.join(rootPrefix, rel);
  }

  return rel;
}

function normalizePath(rawPath: string): string {
  return (rawPath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^`|`$/g, '')
    .replace(/^["']|["']$/g, '');
}

function stripKnownWorkspacePrefix(path: string): string {
  return path
    .replace(/^\/?home\/[^/]+\/work\/(?:devseek_netai|deepseek_netai)\//, '')
    .replace(/^.*\/(?:devseek_netai|deepseek_netai)\//, '');
}

function requestMentionsCodeDir(prompt: string): boolean {
  return /(?:code\s*目录|code目录|code\/|code\\|code\s+dir|code\s+folder)/i.test(prompt);
}

function isCodeLikePath(path: string): boolean {
  const base = nodePath.posix.basename(path);
  if (['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base)) return true;
  return /\.(?:c|cc|cpp|cxx|h|hpp|ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|sh|bash|zsh|sql|vue|svelte|html|css|scss|json|md|txt)$/i.test(base);
}

function shouldWrapInProjectRoot(path: string): boolean {
  return /^(?:include|src)\//.test(path) || /^(?:CMakeLists\.txt|Makefile)$/.test(path);
}

function inferProjectRootPrefix(artifacts: GeneratedArtifact[], requestPrompt: string): string {
  const text = requestPrompt.toLowerCase();
  if (/四则|calculator|计算器|运算/.test(text)) return 'calculator';
  if (requestMentionsCodeDir(requestPrompt)) return '';
  const explicitTop = artifacts
    .filter((artifact): artifact is GeneratedFile => artifact.type === 'file')
    .map((artifact) => normalizePath(artifact.path).split('/')[0])
    .find((top) => top && !['include', 'src'].includes(top) && !/^(?:CMakeLists\.txt|Makefile)$/.test(top));
  if (explicitTop && artifacts.some((artifact) => normalizePath(artifact.path).includes('/'))) {
    return '';
  }

  if (artifacts.some((artifact) => {
    const p = normalizePath(artifact.path);
    return /^(?:include|src)\//.test(p) || /^(?:CMakeLists\.txt|Makefile)$/.test(p);
  })) {
    return 'generated-cpp-project';
  }
  return '';
}
