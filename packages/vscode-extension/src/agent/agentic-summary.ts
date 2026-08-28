export function normalizeAgentUserAnnouncement(text: string): string {
  const cleaned = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return '';
  if (/^【系统反馈】/.test(cleaned)) return '';
  return cleaned;
}

export function cleanAgentFinalSummaryForUser(text: string): string {
  return String(text || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function agentAnnouncementKey(text: string): string {
  return normalizeAgentUserAnnouncement(text).toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}

const CHINESE_DEFERRED_ACTOR = [
  '(?:我将|我会|接下来(?:我)?(?:将|会)?)(?:先|立即|开始)?',
  '我(?:先|立即|开始)',
  '我需要(?:先|立即|开始)?',
  '我(?:现在|仍然|仍|还|继续)(?:需要|要|得)(?:先|立即|开始)?',
  '让我(?:先|开始)?',
  '现在让我(?:先|开始)?',
  '现在(?:我)?需要',
].join('|');
const CHINESE_AGENT_ACTION = [
  '读取', '阅读', '检查', '获取', '查看', '打开', '了解', '分析',
  '浏览', '检索', '搜索', '探查', '调查', '调研', '排查', '定位', '审查',
  '创建', '修改', '修复', '实现', '运行', '执行', '测试', '验证',
].join('|');
const DEFERRED_CHINESE_ACTION = new RegExp(
  String.raw`(?:^|[。！？；.!?;]\s*)(?:${CHINESE_DEFERRED_ACTOR}).{0,24}(?:${CHINESE_AGENT_ACTION})`,
  'u',
);

const ENGLISH_DEFERRED_ACTOR = [
  String.raw`(?:I(?:'ll| will)|next I(?:'ll| will))(?: first| immediately| start(?: by| to)?)?`,
  String.raw`let me(?: first| start(?: by| to)?)`,
  String.raw`(?:now )?I(?: now| still)? need to`,
].join('|');
const ENGLISH_AGENT_ACTION = [
  'read', 'inspect', 'check', 'open', 'understand', 'analy[sz]e',
  'browse', 'search', 'investigate', 'explore', 'audit', 'debug', 'locate',
  'create', 'modify', 'fix', 'implement', 'run', 'execute', 'test', 'verify', 'look',
].join('|');
const DEFERRED_ENGLISH_ACTION = new RegExp(
  String.raw`(?:^|[.!?;]\s*)(?:${ENGLISH_DEFERRED_ACTOR}).{0,24}(?:${ENGLISH_AGENT_ACTION})\b`,
  'iu',
);
const DEFERRED_ACTION_CONTEXT_LENGTH = 1_200;
const DEFERRED_ACTION_SCAN_LENGTH = 600;

function removeBoundedQuotedSegments(text: string): string {
  return text.replace(
    /“[^”\n]{0,300}”|‘[^’\n]{0,300}’|"[^"\n]{0,300}"|`[^`\n]{0,300}`/gu,
    ' ',
  );
}

interface MarkdownFenceProjection {
  readonly visibleText: string;
  readonly blocks: readonly { readonly info: string; readonly content: string }[];
}

function projectMarkdownFences(text: string): MarkdownFenceProjection {
  const visibleLines: string[] = [];
  const blocks: Array<{ info: string; content: string }> = [];
  let fenceCharacter = '';
  let fenceLength = 0;
  let fenceInfo = '';
  let fencedLines: string[] = [];

  for (const line of text.split(/\r?\n/u)) {
    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^\r\n]*$/u);
    const marker = opening?.[1] ?? '';
    if (!fenceCharacter) {
      if (marker) {
        fenceCharacter = marker[0];
        fenceLength = marker.length;
        fenceInfo = (opening?.[2] ?? '').toLowerCase();
        fencedLines = [];
        visibleLines.push(' ');
      } else {
        visibleLines.push(line);
      }
      continue;
    }

    const closingMarker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1] ?? '';
    if (closingMarker[0] === fenceCharacter && closingMarker.length >= fenceLength) {
      blocks.push({ info: fenceInfo, content: fencedLines.join('\n') });
      fenceCharacter = '';
      fenceLength = 0;
      fenceInfo = '';
      fencedLines = [];
    } else {
      fencedLines.push(line);
    }
  }

  if (fenceCharacter) blocks.push({ info: fenceInfo, content: fencedLines.join('\n') });
  return { visibleText: visibleLines.join('\n'), blocks };
}

function removeMarkdownFencedBlocks(text: string): string {
  return projectMarkdownFences(text).visibleText;
}

/** A bounded hint that prose promises a later tool action instead of delivering an answer. */
export function isDeferredAgentActionAnnouncement(text: string): boolean {
  const normalized = removeMarkdownFencedBlocks(normalizeAgentUserAnnouncement(text))
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  const terminalContext = normalized.slice(-DEFERRED_ACTION_CONTEXT_LENGTH);
  const unquoted = removeBoundedQuotedSegments(terminalContext);
  const boundedTail = unquoted.slice(-DEFERRED_ACTION_SCAN_LENGTH);
  return DEFERRED_CHINESE_ACTION.test(boundedTail) || DEFERRED_ENGLISH_ACTION.test(boundedTail);
}

const SHELL_FENCE_LANGUAGES = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal']);
const SHELL_COMMAND_LINE = /^(?:\$\s*)?(?:cd|pwd|ls|cat|head|tail|sed|awk|xxd|file|find|rg|grep|cmake|make|ninja|ctest|npm|pnpm|yarn|bun|node|python3?|pytest|cargo|go|dotnet|bash|sh|timeout|\.\.?\/\S+)(?:\s|$)/iu;

function looksLikeShellCommandBlock(content: string): boolean {
  const actionableLines = content.split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
  return actionableLines.length > 0
    && actionableLines.every(line => SHELL_COMMAND_LINE.test(line));
}

/** Detects command proposals shown as Markdown data; it never authorizes or executes them. */
export function hasUnexecutedShellActionPresentation(text: string): boolean {
  const normalized = normalizeAgentUserAnnouncement(text);
  const projection = projectMarkdownFences(normalized);
  const hasShellBlock = projection.blocks.some(block => (
    (SHELL_FENCE_LANGUAGES.has(block.info) && block.content.trim().length > 0)
    || (!block.info && looksLikeShellCommandBlock(block.content))
  ));
  if (!hasShellBlock) return false;
  const visibleText = projection.visibleText.replace(/\s+/gu, ' ').trim();
  return !visibleText || isDeferredAgentActionAnnouncement(normalized);
}
