import type { AnalysisFindings } from '../agent-task-decomposer';

const ISSUE_KEYWORDS = /\b(笔误|错误|bug|问题|缺陷|越界|typo|wrong|issue|改进|建议|修复|不一致|漏掉|遗漏|溢出|补全|增加|考虑|优化|重构|改为|改用|避免|确认|验证)\b/i;

export function extractAnalysisFindings(analysisText: string): AnalysisFindings {
  const issues: string[] = [];
  for (const line of analysisText.split('\n')) {
    const trimmed = line.replace(/^[-*•\d.)\s]+/, '').trim();
    if (trimmed.length > 10 && trimmed.length < 200 && ISSUE_KEYWORDS.test(trimmed)) {
      issues.push(trimmed);
    }
  }

  const seen = new Set<string>();
  const unique = issues.filter(issue => {
    if (seen.has(issue)) return false;
    seen.add(issue);
    return true;
  }).slice(0, 20);

  return { issues: unique };
}
