import * as nodePath from 'path';
import type { CodingToolCall, ToolDispatchPort } from '@devseek-netai/shared';
import { parseGeneratedArtifacts } from '../generated-file-parser';

const FILE_MUTATION_TOOL_NAMES = new Set([
  'create_file',
  'write_file',
  'replace_file',
  'replace_in_file',
  'delete_file',
  'create_directory',
]);

export interface MarkdownArtifactProjectionPolicyInput {
  readonly taskRequiresTools: boolean;
  readonly workspaceAccess?: 'read-only' | 'read-write';
  readonly tools: readonly Pick<CodingToolCall, 'name'>[];
}

export interface MarkdownArtifactToolProjectionInput {
  readonly text: string;
  readonly userPrompt: string;
  readonly workspaceRoot: string;
  readonly dispatch: ToolDispatchPort;
}

interface MarkdownFileCandidate {
  readonly path: string;
  readonly content: string;
}

export function isFileMutationToolName(name: string): boolean {
  return FILE_MUTATION_TOOL_NAMES.has(name);
}

export function shouldProjectMarkdownFileArtifacts(
  input: MarkdownArtifactProjectionPolicyInput,
): boolean {
  return input.taskRequiresTools
    && input.workspaceAccess === 'read-write'
    && !input.tools.some(tool => isFileMutationToolName(tool.name));
}

/** Converts legacy Markdown file output into normal tool calls; it never writes the workspace. */
export function projectMarkdownFileArtifactToolsForLoop(
  input: MarkdownArtifactToolProjectionInput,
): CodingToolCall[] {
  const parsed = parseGeneratedArtifacts(input.text)
    .filter((artifact): artifact is Extract<ReturnType<typeof parseGeneratedArtifacts>[number], { type: 'file' }> => artifact.type === 'file')
    .map(artifact => ({ path: artifact.path, content: artifact.content }));
  const candidates = parsed.length > 0
    ? parsed
    : inferCArtifactFromMarkdown(input.text, input.userPrompt);
  const calls: CodingToolCall[] = [];
  const seen = new Set<string>();

  for (const [index, candidate] of candidates.entries()) {
    const path = candidate.path.trim().replace(/\\/g, '/');
    if (!isLikelyWritableFilePath(path) || !candidate.content.trim() || seen.has(path)) continue;
    seen.add(path);
    const envelope = input.dispatch.dispatch({
      id: `markdown-artifact:${index + 1}:${path}`,
      name: 'write_file',
      input: { path, content: candidate.content },
    }, {
      source: 'internal',
      workspaceRoot: input.workspaceRoot,
    });
    calls.push(envelope.call);
  }

  return calls;
}

function promptLooksLikeCppProgram(userPrompt: string): boolean {
  return /(?:c\+\+|cpp|\.cpp\b|\.cc\b|\.cxx\b|C\+\+)/i.test(userPrompt);
}

function promptLooksLikeCProgram(userPrompt: string): boolean {
  return /(?:\bC\b|C语言|c程序|\.c\b)/i.test(userPrompt) && !promptLooksLikeCppProgram(userPrompt);
}

function contentLooksLikeCppProgram(content: string): boolean {
  return /#include\s*<(?:iostream|vector|string|map|memory|algorithm|GL\/glut|GLFW|SFML)|\bstd::|using\s+namespace\s+std|class\s+\w+/i.test(content);
}

function defaultCodeArtifactBasename(userPrompt: string): string {
  return /(?:三维|3d|3D|OpenGL|GLUT|动画世界)/i.test(userPrompt) ? '3d_world' : 'main';
}

function inferCArtifactFromMarkdown(text: string, userPrompt: string): MarkdownFileCandidate[] {
  const wantsCpp = promptLooksLikeCppProgram(userPrompt);
  const wantsC = !wantsCpp && promptLooksLikeCProgram(userPrompt);
  if (!wantsCpp && !wantsC) return [];
  const blockRe = /```(?:c|cpp|cxx|cc|c\+\+)\s*\n([\s\S]*?)```/gi;
  const results: MarkdownFileCandidate[] = [];
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    const content = (match[1] || '').trim();
    if (!/#include\s*</.test(content) || !/\bmain\s*\(/.test(content)) continue;
    if (wantsCpp && !contentLooksLikeCppProgram(content) && !/(?:c\+\+|cpp|cxx|cc)/i.test(match[0].slice(0, 24))) continue;
    const before = text.slice(Math.max(0, match.index - 400), match.index);
    const pathMatch = before.match(/([A-Za-z0-9_./-]+\.(?:c|cc|cpp|cxx))\b/g);
    const extension = wantsCpp ? '.cpp' : '.c';
    const path = pathMatch?.[pathMatch.length - 1]
      || `code/${defaultCodeArtifactBasename(userPrompt)}${extension}`;
    results.push({ path, content });
  }
  return results;
}

function isLikelyWritableFilePath(filePath: string): boolean {
  if (!filePath || filePath.endsWith('/')) return false;
  const base = nodePath.posix.basename(filePath);
  return ['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base) || /\.[A-Za-z0-9]+$/.test(base);
}
