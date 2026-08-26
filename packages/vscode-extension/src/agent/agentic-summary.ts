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

const DEFERRED_CHINESE_ACTION = /(?:^|[。！？；.!?;]\s*)(?:(?:我将|我会|接下来(?:我)?(?:将|会)?)(?:先|立即|开始)?|让我(?:先|开始)?|现在(?:我)?需要).{0,24}(?:读取|阅读|检查|获取|查看|打开|了解|分析|创建|修改|修复|实现|运行|执行|测试|验证)/u;
const DEFERRED_ENGLISH_ACTION = /(?:^|[.!?;]\s*)(?:(?:I(?:'ll| will)|next I(?:'ll| will))(?: first| immediately| start(?: by| to)?)?|let me(?: first| start(?: by| to)?)|(?:now )?I need to).{0,24}(?:read|inspect|check|open|understand|analy[sz]e|create|modify|fix|implement|run|execute|test|verify|look)\b/iu;

function removeBoundedQuotedSegments(text: string): string {
  return text.replace(
    /“[^”\n]{0,300}”|‘[^’\n]{0,300}’|"[^"\n]{0,300}"|`[^`\n]{0,300}`/gu,
    ' ',
  );
}

function removeMarkdownFencedBlocks(text: string): string {
  const visibleLines: string[] = [];
  let fenceCharacter = '';
  let fenceLength = 0;

  for (const line of text.split(/\r?\n/u)) {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/u)?.[1] ?? '';
    if (!fenceCharacter) {
      if (marker) {
        fenceCharacter = marker[0];
        fenceLength = marker.length;
        visibleLines.push(' ');
      } else {
        visibleLines.push(line);
      }
      continue;
    }

    const closingMarker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1] ?? '';
    if (closingMarker[0] === fenceCharacter && closingMarker.length >= fenceLength) {
      fenceCharacter = '';
      fenceLength = 0;
    }
  }

  return visibleLines.join('\n');
}

/** A bounded hint that prose promises a later tool action instead of delivering an answer. */
export function isDeferredAgentActionAnnouncement(text: string): boolean {
  const normalized = removeMarkdownFencedBlocks(normalizeAgentUserAnnouncement(text))
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > 600) return false;
  const unquoted = removeBoundedQuotedSegments(normalized);
  return DEFERRED_CHINESE_ACTION.test(unquoted) || DEFERRED_ENGLISH_ACTION.test(unquoted);
}
