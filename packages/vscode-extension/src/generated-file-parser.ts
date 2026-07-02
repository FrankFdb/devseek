import { shouldBlockProjectInstructionFileContent } from './workspace/instruction-file-safety';

export interface GeneratedFile {
  type: 'file';
  path: string;
  language?: string;
  content: string;
}

export interface GeneratedPatch {
  type: 'patch';
  path: string;
  diff: string;
}

export type GeneratedArtifact = GeneratedFile | GeneratedPatch;

const INSTRUCTION_HEADING_RE = /(?:使用说明|编译运行|运行方式|执行命令|命令示例|示例命令|步骤|安装|启动|验证|usage|instructions?|compile|build|run|how to run)/i;

// Headings that describe / analyze existing files rather than naming new ones to generate.
// When such a heading appears immediately before a code block, the block shows existing code
// being analyzed — it is NOT a file the agent should write to disk.
const ANALYSIS_HEADING_RE = /(?:分析|结构|说明|特点|功能|内容|定义|继承|关系|描述|总结|改进|建议|优化|问题|评估|analysis|structure|description|explanation|summary|overview|improvement)/i;

const PATH_LINE_PATTERNS = [
  /^#{1,6}\s+`?([^`\n]+?)`?\s*$/,
  /^\d+[.)]\s+`?([^`\n]+?)`?(?:\s*[-—–:：].*)?$/,
  /^(?:文件|File)\s*\d+\s*[:：]\s*`?([^`\n]+?)`?(?:\s*[-—–:：].*)?$/i,
  /^\*\*`?([^`\n]+?)`?\*\*(?:\s*[-—–:：].*)?$/,
  /^(?:文件|路径|File|Path|Filename|文件名)\s*[:：]\s*`?([^`\n]+?)`?\s*$/i,
  /^[-*]\s*(?:文件|File)?\s*`([^`]+)`\s*$/i,
  /^`([^`]+)`\s*$/,
  /^([A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|xml|yaml|yml|toml|ini|env|py|java|go|rs|c|cc|cpp|cxx|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte|txt))\s*(?:[-—–:：].*)?$/i,
];

// Regex matching a bare filename with a known code/markup extension
const FILE_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|xml|yaml|yml|toml|ini|env|py|java|go|rs|c|cc|cpp|cxx|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte|txt)$/i;

const PATH_EXT_RE = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|xml|yaml|yml|toml|ini|env|py|java|go|rs|c|cc|cpp|cxx|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte|txt)$/i;
const SPECIAL_FILENAMES = new Set(['Makefile', 'Dockerfile', 'CMakeLists.txt']);
const FILE_TOOL_NAMES = new Set(['create_file', 'write_file', 'replace_file']);

export function looksLikeRawToolCallText(content: string): boolean {
  const trimmed = (content || '').trim();
  if (!trimmed) return false;
  if (/^\[TOOL:[A-Za-z_]\w*(?:\s*\]|\s*)\s*\{/.test(trimmed) && /"path"\s*:|"filePath"\s*:|"content"\s*:/.test(trimmed)) return true;
  if (/^<tool_calls?>[\s\S]*<\/tool_calls?>$/i.test(trimmed)) return true;
  if (/^[*_]{0,3}(?:Calling|Call|调用)(?:[ \t]*[:：]?[ \t]*tool\b|[ \t]+tool\b)?[ \t]*[:：]?[ \t]*[*_]{0,3}[ \t]*\[?`?[A-Za-z_]\w*`?\]?/i.test(trimmed)
    && /"path"\s*:|"filePath"\s*:|"content"\s*:/.test(trimmed)) return true;
  return false;
}

function looksLikeToolOrSummaryJson(content: string): boolean {
  const trimmed = content.trim();
  if (looksLikeRawToolCallText(trimmed)) return true;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const isToolLike = (value: unknown): boolean => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const obj = value as Record<string, unknown>;
      return typeof obj.tool === 'string'
        || typeof obj.name === 'string'
        || typeof obj.summary === 'string'
        || Array.isArray(obj.todoList);
    };
    return Array.isArray(parsed) ? parsed.some(isToolLike) : isToolLike(parsed);
  } catch {
    return false;
  }
}

function looksLikeShellCommandFenceForNonShellFile(content: string, fenceInfo: string, path: string): boolean {
  const lang = (extractLanguage(fenceInfo) || '').toLowerCase();
  const shellishFence = /^(?:bash|sh|shell|zsh|console|terminal|cmd|powershell|pwsh)$/i.test(lang);
  const genericFence = !lang || /^(?:code|text|plain|plaintext)$/i.test(lang);
  if (!shellishFence && !genericFence) return false;

  const cleanPath = normalizeCandidatePath(path) || path;
  if (/\.(?:sh|bash|zsh|ps1|cmd|bat)$/i.test(cleanPath)) return false;
  return looksLikeShellCommandBlock(content);
}

function looksLikeShellCommandBlock(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\$\s*/, '').replace(/^>\s*/, ''))
    .filter(Boolean);
  if (lines.length === 0) return false;

  const commandLikeCount = lines.filter(looksLikeShellCommandLine).length;
  if (commandLikeCount === 0) return false;

  if (looksLikeSourceCodeBlock(content)) {
    return commandLikeCount >= Math.max(2, Math.ceil(lines.length * 0.5));
  }

  if (lines.length <= 3) return commandLikeCount === lines.length;
  return commandLikeCount >= 2 && commandLikeCount / lines.length >= 0.5;
}

function looksLikeShellCommandLine(line: string): boolean {
  return /^(?:cat|type|get-content|find|rg|grep|sed|head|tail|ls|dir|pwd|cd|npm|npx|pnpm|yarn|node|git|python|python3|bash|sh|zsh|cmd|powershell|pwsh|mkdir|cp|mv|rm|touch|code|g\+\+|gcc|clang|make|cmake|go|cargo|pytest|mvn|gradle|docker|curl|wget)\b/i.test(line)
    || /(?:^|\s)(?:&&|\|\||[|;])(?:\s|$)/.test(line)
    || /(?:^|\s)\d?>&?\S/.test(line);
}

function looksLikeSourceCodeBlock(content: string): boolean {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;

  if (/(^|\n)\s*#include\b/.test(content)) return true;
  if (/(^|\n)\s*(?:import|export|from|package|using|namespace|template|class|struct|interface|enum|type)\b/.test(content)) return true;
  if (/(^|\n)\s*(?:const|let|var|function|def|public|private|protected|static)\b/.test(content)) return true;
  if (/(^|\n)\s*(?:int|void|float|double|bool|char|auto|std::[A-Za-z_]\w*)\s+[\w:*&<>,\s]+\([^;]*\)\s*\{?/.test(content)) return true;

  const sourceLikeCount = lines.filter(line =>
    /[{}]/.test(line)
    || /^\s*(?:if|for|while|switch|return|case|break|continue)\b/.test(line)
    || /;\s*(?:(?:\/\/|#).*)?$/.test(line)
  ).length;
  return sourceLikeCount >= Math.max(3, Math.ceil(lines.length * 0.25));
}

export function parseGeneratedArtifacts(markdown: string): GeneratedArtifact[] {
  const artifacts: GeneratedArtifact[] = [];
  const seenPatches = new Set<string>();
  const filesByPath = new Map<string, { artifact: GeneratedFile; score: number }>();
  const structurePaths = extractStructureTreePaths(markdown);

  for (const file of parseFileToolArtifacts(markdown)) {
    const existing = filesByPath.get(file.path);
    const score = scoreFileCandidate(file, 'tool');
    if (!existing || score > existing.score) {
      filesByPath.set(file.path, { artifact: file, score });
    }
  }

  for (const file of parseJsonPlanArtifacts(markdown)) {
    const existing = filesByPath.get(file.path);
    const score = scoreFileCandidate(file, 'json-plan');
    if (!existing || score > existing.score) {
      filesByPath.set(file.path, { artifact: file, score });
    }
  }

  for (const patch of parseDiffArtifacts(markdown)) {
    const key = `patch:${patch.path}:${patch.diff.length}`;
    if (!seenPatches.has(key)) { artifacts.push(patch); seenPatches.add(key); }
  }

  const codeBlockRe = /```([^\n`]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = codeBlockRe.exec(markdown)) !== null) {
    const fenceInfo = (m[1] || '').trim();
    const content = trimCodeBlock(m[2] || '');
    if (!content.trim()) continue;
    if (/^(diff|patch)$/i.test(fenceInfo) || looksLikeUnifiedDiff(content)) continue;

    const pathFromFence = extractPathFromFenceInfo(fenceInfo);
    const pathFromCode = extractPathFromCodeComment(content);
    const pathFromContext = findPathBefore(markdown.slice(0, m.index));
    const path = pathFromFence || pathFromCode?.path || pathFromContext;
    if (!path) continue;
    if (looksLikeShellCommandFenceForNonShellFile(content, fenceInfo, path)) continue;
    if (looksLikeToolOrSummaryJson(content) || looksLikeRawToolCallText(content)) continue;

    let clean = normalizeCandidatePath(path);
    if (!clean) continue;
    clean = applyStructureTreeHint(clean, structurePaths);

    const finalContent = pathFromCode?.path === path ? pathFromCode.content : content;
    if (looksLikeRawToolCallText(finalContent)) continue;
    const language = extractLanguage(fenceInfo);
    const source: CandidatePathSource = pathFromFence
      ? 'fence'
      : pathFromCode?.path
        ? 'code-comment'
        : 'context';
    if (shouldSkipFileCandidate(clean, finalContent, language, source, markdown.slice(0, m.index))) continue;

    const candidate: GeneratedFile = { type: 'file', path: clean, language, content: finalContent };
    const score = scoreFileCandidate(candidate, source);
    const existing = filesByPath.get(clean);
    if (!existing || score > existing.score) {
      filesByPath.set(clean, { artifact: candidate, score });
    }
  }

  for (const { artifact } of filesByPath.values()) {
    artifacts.push(artifact);
  }

  return artifacts;
}

export function looksLikeGeneratedArtifacts(markdown: string): boolean {
  return parseGeneratedArtifacts(markdown).length > 0;
}

type CandidatePathSource = 'fence' | 'code-comment' | 'context' | 'tool';

function parseFileToolArtifacts(markdown: string): GeneratedFile[] {
  const results: GeneratedFile[] = [];
  const re = /\[TOOL:(\w+)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const name = m[1];
    if (!FILE_TOOL_NAMES.has(name)) continue;

    let jsonStart = m.index + m[0].length;
    if (markdown[jsonStart] === ']') jsonStart++;
    while (jsonStart < markdown.length && /\s/.test(markdown[jsonStart])) jsonStart++;
    if (markdown[jsonStart] !== '{') continue;

    const jsonEnd = findJsonObjectEndAt(markdown, jsonStart);
    if (jsonEnd < 0) continue;

    try {
      const input = JSON.parse(markdown.slice(jsonStart, jsonEnd + 1)) as Record<string, unknown>;
      const rawPath = typeof input.path === 'string'
        ? input.path
        : typeof input.filePath === 'string'
          ? input.filePath
          : '';
      const clean = normalizeCandidatePath(rawPath);
      const content = typeof input.content === 'string' ? trimCodeBlock(input.content) : '';
      if (!clean || !content || looksLikeRawToolCallText(content)) continue;
      if (shouldSkipFileCandidate(clean, content, inferLanguageFromPath(clean), 'tool', markdown.slice(0, m.index))) continue;
      results.push({
        type: 'file',
        path: clean,
        language: inferLanguageFromPath(clean),
        content,
      });
      re.lastIndex = jsonEnd + 1;
    } catch {
      const loose = parseLooseFileToolArtifact(markdown.slice(m.index, jsonEnd + 1));
      if (loose) results.push(loose);
      re.lastIndex = jsonEnd + 1;
    }
  }
  return results;
}

function parseLooseFileToolArtifact(raw: string): GeneratedFile | undefined {
  const toolMatch = raw.match(/\[TOOL:(\w+)/);
  if (!toolMatch || !FILE_TOOL_NAMES.has(toolMatch[1])) return undefined;
  const pathMatch = raw.match(/"(?:path|filePath|filepath|filename|targetPath)"\s*:\s*"([^"]+)"/);
  if (!pathMatch) return undefined;
  const clean = normalizeCandidatePath(pathMatch[1]);
  if (!clean) return undefined;

  const contentKey = raw.match(/"(?:content|contents|text|body)"\s*:\s*"/);
  if (!contentKey || contentKey.index === undefined) return undefined;
  const contentStart = contentKey.index + contentKey[0].length;
  let contentEnd = -1;
  for (const marker of ['"}]', '" }]', '"}', '" }']) {
    const idx = raw.lastIndexOf(marker);
    if (idx > contentStart) {
      contentEnd = idx;
      break;
    }
  }
  if (contentEnd < 0) return undefined;
  const content = decodeLooseJsonString(raw.slice(contentStart, contentEnd));
  if (!content.trim() || looksLikeRawToolCallText(content)) return undefined;
  if (shouldBlockProjectInstructionFileContent(clean, content)) return undefined;
  return {
    type: 'file',
    path: clean,
    language: inferLanguageFromPath(clean),
    content: trimCodeBlock(content),
  };
}

function decodeLooseJsonString(value: string): string {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function findJsonObjectEndAt(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseJsonPlanArtifacts(markdown: string): GeneratedFile[] {
  const results: GeneratedFile[] = [];
  const codeBlockRe = /```(?:json)?\s*\n([\s\S]*?)```/gi;
  const candidates = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = codeBlockRe.exec(markdown)) !== null) {
    const body = trimCodeBlock(m[1] || '');
    if (body.includes('"actions"')) candidates.add(body);
  }
  if (markdown.includes('"actions"')) candidates.add(markdown);

  for (const raw of candidates) {
    const parsed = tryParseJsonPlan(raw);
    if (!parsed) continue;
    for (const action of parsed) {
      const clean = normalizeCandidatePath(action.path);
      if (!clean) continue;
      if (action.type === 'patch' && typeof action.patch === 'string') continue;
      if (typeof action.content !== 'string' || !action.content.trim()) continue;
      if (looksLikeRawToolCallText(action.content)) continue;
      if (shouldSkipFileCandidate(clean, action.content, inferLanguageFromPath(clean), 'json-plan', raw.slice(0, Math.max(0, raw.indexOf(action.path ?? ''))))) continue;
      results.push({
        type: 'file',
        path: clean,
        language: inferLanguageFromPath(clean),
        content: trimCodeBlock(action.content),
      });
    }
  }

  return results;
}

function tryParseJsonPlan(text: string): Array<{ type?: string; path?: string; content?: string; patch?: string }> | null {
  const candidate = extractFirstJsonObject(text);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || !Array.isArray(parsed.actions)) return null;
    return parsed.actions;
  } catch {
    return null;
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseDiffArtifacts(markdown: string): GeneratedPatch[] {
  const patches: GeneratedPatch[] = [];
  const diffBlocks: string[] = [];
  const blockRe = /```(?:diff|patch)?\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(markdown)) !== null) {
    const body = trimCodeBlock(m[1] || '');
    if (looksLikeUnifiedDiff(body)) diffBlocks.push(body);
  }
  if (diffBlocks.length === 0 && looksLikeUnifiedDiff(markdown)) diffBlocks.push(markdown);

  for (const diff of diffBlocks) {
    const sections = splitUnifiedDiff(diff);
    patches.push(...sections);
  }
  return patches;
}

function splitUnifiedDiff(diff: string): GeneratedPatch[] {
  const lines = diff.replace(/\r\n/g, '\n').split('\n');
  const result: GeneratedPatch[] = [];
  let currentPath = '';
  let current: string[] = [];

  function flush() {
    if (currentPath && current.some(l => l.startsWith('@@'))) {
      const clean = normalizeCandidatePath(currentPath);
      if (clean) result.push({ type: 'patch', path: clean, diff: current.join('\n') });
    }
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
      currentPath = '';
      const mm = line.match(/ b\/(.+)$/);
      if (mm) currentPath = mm[1].trim();
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      if (p !== '/dev/null') currentPath = p.replace(/^b\//, '');
      current.push(line);
      continue;
    }
    if (line.startsWith('--- ') && current.length === 0) {
      current.push(line);
      continue;
    }
    if (current.length > 0 || line.startsWith('@@')) current.push(line);
  }
  flush();
  return result;
}

function looksLikeUnifiedDiff(text: string): boolean {
  return /(^|\n)@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.test(text)
    && /(^|\n)(---\s+\S+\n\+\+\+\s+\S+|diff --git\s+)/.test(text);
}

function findPathBefore(prefix: string): string | undefined {
  const lines = prefix.split('\n').slice(-8).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = stripMarkdownDecoration(lines[i]);
    for (const re of PATH_LINE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        const candidate = normalizeCandidatePath(m[1]);
        if (candidate && isLikelyFilePath(candidate)) return candidate;
        // Pattern captured mixed Chinese+filename text — scan each token for a file path.
        // e.g. "修改后的 maintenance_data_collector.hpp" → take the .hpp token.
        if (m[1]) {
          for (const token of m[1].split(/\s+/)) {
            const clean = token.replace(/^[`'"*]+|[`'"*]+$/g, '');
            if (clean && FILE_EXT_RE.test(clean)) {
              const c = normalizeCandidatePath(clean);
              if (c && isLikelyFilePath(c)) return c;
            }
          }
        }
      }
    }
    // Inline backtick: match any backtick-enclosed filename with a known extension
    // (previously required '/' which excluded bare filenames like "foo.hpp").
    const inlineRe = /`([^`]+)`/g;
    let inlineM: RegExpExecArray | null;
    while ((inlineM = inlineRe.exec(line)) !== null) {
      const candidate = normalizeCandidatePath(inlineM[1]);
      if (candidate && isLikelyFilePath(candidate)) return candidate;
    }
    const natural = line.match(/(?:创建|新建|生成|保存|写入|修改|更新|create|write|save|generate|modify|update)[^`\n]*?([\w@.\-]+(?:\/[\w@.\-]+)+)/i)
      || line.match(/([^\s`：:，,。；;]+\/[\w@.\-]+\.[A-Za-z0-9]+)(?:\s|$|[：:，,。；;])/);
    if (natural) {
      const candidate = normalizeCandidatePath(natural[1]);
      if (candidate && isLikelyFilePath(candidate)) return candidate;
    }
    // Extract a clean filename/path token from mixed natural-language prose, e.g.
    // "目录下创建了... 文件：weekend_feeling.c" -> "weekend_feeling.c".
    const fileTokenRe = /(?:^|[^A-Za-z0-9_./\\-])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|xml|yaml|yml|toml|ini|env|py|java|go|rs|c|cc|cpp|cxx|h|hpp|cs|php|rb|sh|bash|zsh|sql|vue|svelte|txt))(?:$|[^A-Za-z0-9_./\\-])/gi;
    let tokenM: RegExpExecArray | null;
    while ((tokenM = fileTokenRe.exec(line)) !== null) {
      const candidate = normalizeCandidatePath(tokenM[1]);
      if (candidate && isLikelyFilePath(candidate)) return candidate;
    }
    // Last-resort: find any word in the line that looks like a file with a known extension.
    for (const word of line.split(/\s+/)) {
      const clean = word.replace(/^[`'"*#[\]()+]+|[`'"*#[\]()+，,。；;：:]+$/g, '');
      if (clean && FILE_EXT_RE.test(clean) && !clean.includes('://')) {
        const candidate = normalizeCandidatePath(clean);
        if (candidate && isLikelyFilePath(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export function inferProjectRootName(markdown: string): string | undefined {
  const projectMatch = markdown.match(/\bproject\s*\(\s*([A-Za-z0-9_.-]+)\s*\)/i);
  if (projectMatch) return normalizeProjectDirName(projectMatch[1]);

  const targetMatch = markdown.match(/^TARGET\s*=\s*([A-Za-z0-9_.-]+)\s*$/im);
  if (targetMatch) return normalizeProjectDirName(targetMatch[1]);

  return undefined;
}

function normalizeProjectDirName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized ? normalized.toLowerCase() : undefined;
}

function extractPathFromFenceInfo(info: string): string | undefined {
  const m = info.match(/(?:file|path|filename)=(["']?)([^"'\s]+)\1/i)
    || info.match(/(?:^|\s)([^\s]+\/[\w.\-@]+)$/);
  if (!m) return undefined;
  return normalizeCandidatePath(m[2] || m[1]);
}

function extractPathFromCodeComment(content: string): { path: string; content: string } | undefined {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const maxScan = Math.min(3, lines.length);
  for (let i = 0; i < maxScan; i++) {
    const line = lines[i].trim();
    const m = line.match(/^(?:\/\/|#|--|\/\*|\*)\s*(?:file|path|文件|路径)?\s*[:：]?\s*([^\s*]+\/[\w.\-@]+)\s*(?:\*\/)?\s*$/i);
    if (!m) continue;
    const path = normalizeCandidatePath(m[1]);
    if (!path) continue;
    const next = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').replace(/^\n+/, '');
    return { path, content: next };
  }
  return undefined;
}

function extractLanguage(info: string): string | undefined {
  const lang = info.split(/\s+/)[0]?.trim();
  if (!lang || lang.includes('/') || lang.includes('=')) return undefined;
  return lang;
}

function scoreFileCandidate(file: GeneratedFile, source: CandidatePathSource | 'json-plan'): number {
  let score = 0;
  if (source === 'tool') score += 8;
  if (source === 'json-plan') score += 6;
  if (source === 'fence' || source === 'code-comment') score += 4;
  if (source === 'context') score += 1;
  if (languageMatchesPath(file.language, file.path)) score += 3;
  if (!looksLikeShellCommands(file.content)) score += 1;
  return score;
}

function inferLanguageFromPath(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', java: 'java', go: 'go', rs: 'rust',
    json: 'json', md: 'markdown', sh: 'shell', bash: 'bash', zsh: 'zsh',
  };
  return ext ? map[ext] : undefined;
}

function shouldSkipFileCandidate(
  path: string,
  content: string,
  language: string | undefined,
  source: CandidatePathSource | 'json-plan',
  prefixText: string,
): boolean {
  if (shouldBlockProjectInstructionFileContent(path, content)) return true;
  if (isShellLikePath(path)) return false;
  if (isShellLanguage(language) || looksLikeShellCommands(content)) return true;
  if (source === 'context' && looksLikeInstructionSection(prefixText)) return true;
  // P7: skip when the preceding heading is an analysis/description heading
  // (e.g. "**1. Animal.h 的结构**") — these show existing content, not new generation.
  if (source === 'context' && looksLikeAnalysisSection(prefixText)) return true;
  return false;
}

function languageMatchesPath(language: string | undefined, path: string): boolean {
  if (!language) return false;
  const ext = path.split('.').pop()?.toLowerCase();
  const normalized = language.toLowerCase();
  const map: Record<string, string[]> = {
    cpp: ['cpp', 'cc', 'cxx', 'hpp', 'h'],
    c: ['c', 'h'],
    typescript: ['ts'],
    tsx: ['tsx'],
    javascript: ['js'],
    jsx: ['jsx'],
    python: ['py'],
    java: ['java'],
    go: ['go'],
    rust: ['rs'],
    json: ['json'],
    markdown: ['md'],
    shell: ['sh', 'bash', 'zsh'],
    bash: ['sh', 'bash'],
    sh: ['sh'],
    zsh: ['zsh'],
  };
  const allowed = map[normalized];
  return !!ext && !!allowed?.includes(ext);
}

function isShellLanguage(language?: string): boolean {
  if (!language) return false;
  return ['shell', 'bash', 'sh', 'zsh', 'console'].includes(language.toLowerCase());
}

function isShellLikePath(path: string): boolean {
  return /\.(?:sh|bash|zsh)$/i.test(path);
}

function looksLikeShellCommands(content: string): boolean {
  const lines = content.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  const shellCommandRe = /^(?:[$#]\s*)?(?:mkdir|cd|cp|mv|rm|touch|cat|echo|printf|chmod|chown|g\+\+|gcc|clang\+\+|clang|cmake|make|npm|npx|pnpm|yarn|pip|python|python3|node|go|cargo|rustc|java|javac|git|curl|wget|bash|sh|zsh|\.\/[^^\s]+)\b/i;
  const shellLikeLines = lines.filter((line) => shellCommandRe.test(line) || /^\.\/.+/.test(line));
  return shellLikeLines.length > 0 && shellLikeLines.length >= Math.ceil(lines.length / 2);
}

function looksLikeInstructionSection(prefixText: string): boolean {
  const lines = prefixText.replace(/\r\n/g, '\n').split('\n').slice(-4).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  return lines.some((line) => INSTRUCTION_HEADING_RE.test(stripMarkdownDecoration(line)));
}

// P7: detect analysis-section headings immediately before a code block.
// Headings like "**1. Animal.h 的结构**" or "### 功能分析" signal that the following
// code block is showing existing / analyzed content, not new content to write.
function looksLikeAnalysisSection(prefixText: string): boolean {
  const lines = prefixText.replace(/\r\n/g, '\n').split('\n').slice(-4).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  return lines.some((line) => {
    const clean = stripMarkdownDecoration(line);
    // Must also contain a descriptor word — pure filenames e.g. "Animal.h" should still pass
    return ANALYSIS_HEADING_RE.test(clean) && /[\u4e00-\u9fa5a-zA-Z]{2}/.test(clean);
  });
}

function stripMarkdownDecoration(line: string): string {
  return line.replace(/^[-*]\s+/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
}

// System directories that are never valid workspace-relative project paths.
// Rejects OS paths that slip through after shebang stripping or AI path hallucination.
const SYSTEM_DIR_PREFIXES = new Set([
  'bin', 'sbin', 'usr', 'etc', 'dev', 'proc', 'sys', 'var', 'tmp',
  'run', 'home', 'root', 'opt', 'lib', 'lib64', 'boot', 'mnt', 'media', 'srv',
]);

// OS/distro names used as first dir segment in hallucinated paths like "Ubuntu/Debian".
const OS_DISTRO_PREFIXES = new Set([
  'Ubuntu', 'Debian', 'Windows', 'macOS', 'Linux', 'Fedora', 'CentOS',
  'Alpine', 'Arch', 'RedHat', 'RHEL', 'Mint', 'KDE', 'GNOME',
  'iOS', 'Android', 'WSL', 'FreeBSD', 'OpenBSD',
]);

function normalizeCandidatePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  let p = path.trim().replace(/^['"`]+|['"`]+$/g, '');
  p = p.replace(/\\/g, '/');
  // Strip shebang artifact: extractPathFromCodeComment parses "#!/bin/bash" as "!/bin/bash"
  // because "#" is the comment prefix and the rest becomes the path candidate.
  // Stripping leading "!" reveals the absolute path → caught by startsWith('/') check below.
  p = p.replace(/^!+/, '');
  p = p.replace(/^\.\//, '').replace(/^a\//, '').replace(/^b\//, '');
  p = p.split(/\s+/)[0];
  p = p.replace(/[:：]$/, '');
  if (!p || p === '/dev/null') return undefined;
  // Reject natural-language prose accidentally captured as a path. Real paths in
  // this parser are ASCII-ish workspace paths; mixed Chinese sentences like
  // "目录下创建了...文件：weekend_feeling.c" must not become filenames.
  if (/[\u3400-\u9fff]/.test(p) || /[，。；：“”‘’]/.test(p)) return undefined;
  // Reject absolute paths (system paths, shebang artifacts exposed after ! strip).
  if (p.startsWith('/')) return undefined;
  // P16: reject paths that contain git conflict marker or SEARCH/REPLACE segment names.
  if (p.split('/').some((seg) => seg === 'SEARCH' || seg === 'REPLACE')) return undefined;
  if (/^[<=>]{7}/.test(p)) return undefined;
  // Reject system directory roots (e.g. "bin/bash", "usr/include/GL/glut.h").
  const firstSeg = p.split('/')[0].toLowerCase();
  if (SYSTEM_DIR_PREFIXES.has(firstSeg)) return undefined;
  // Reject OS/distro name as first directory segment without a file extension
  // (e.g. "Ubuntu/Debian", "Windows/Registry"). A real project subdir could share
  // a name, but an extensionless path under these prefixes is virtually always AI hallucination.
  if (OS_DISTRO_PREFIXES.has(p.split('/')[0]) && !PATH_EXT_RE.test(p)) return undefined;
  if (!isLikelyFilePath(p)) return undefined;
  return p;
}

function extractStructureTreePaths(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let rootDir: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const rootMatch = line.match(/^([A-Za-z0-9_.-]+\/)\s*$/);
    if (rootMatch) {
      rootDir = rootMatch[1].replace(/\/$/, '');
      continue;
    }

    const childMatch = line.match(/^[│\s]*[├└]──\s+([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/);
    if (!childMatch || !rootDir) continue;

    const rel = childMatch[1].trim();
    const fullPath = `${rootDir}/${rel}`.replace(/\/+/g, '/');
    const base = fullPath.split('/').pop();
    if (!base || map.has(base)) continue;
    map.set(base, fullPath);
  }

  return map;
}

function applyStructureTreeHint(path: string, structurePaths: Map<string, string>): string {
  if (path.includes('/')) return path;
  return structurePaths.get(path) || path;
}

function isLikelyFilePath(path: string): boolean {
  if (path.includes('://')) return false;
  if (path.startsWith('/')) return false;
  if (path.startsWith('!')) return false;  // shebang artifact before ! stripping in normalize
  if (path.includes('..')) return false;
  return path.includes('/') || PATH_EXT_RE.test(path) || SPECIAL_FILENAMES.has(path);
}

function trimCodeBlock(content: string): string {
  return content.replace(/^\n+/, '').replace(/\n+$/, '');
}
