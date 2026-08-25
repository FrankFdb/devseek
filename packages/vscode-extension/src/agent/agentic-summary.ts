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

/** A bounded hint that prose promises a later tool action instead of delivering an answer. */
export function isDeferredAgentActionAnnouncement(text: string): boolean {
  const normalized = normalizeAgentUserAnnouncement(text).replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 600) return false;
  return /(?:我将|我会|让我|接下来).{0,180}(?:先|开始)(?:读取|检查|获取|查看|创建|修改|实现|运行)/u.test(normalized)
    || /(?:I(?:'ll| will)|let me|next).{0,180}(?:first |start(?: by | to )?)(?:read|inspect|check|open|create|modify|implement|run|look)/iu.test(normalized);
}
