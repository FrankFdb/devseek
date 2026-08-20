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
