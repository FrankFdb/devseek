import type { TodoItem } from './evidence-recovery';

export function extractPlanningTodoItems(text: string): TodoItem[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const startIndex = lines.findIndex(line => (
    /(规划任务|任务规划|任务清单|待办清单|计划任务|规划如下|计划如下|todos?|tasks?)(：|:)?$/i.test(line)
  ));
  if (startIndex < 0) return [];

  const items: string[] = [];
  for (const rawLine of lines.slice(startIndex + 1)) {
    if (!/^\s*(?:[-*•]|\d+[.)、])\s+/.test(rawLine)) {
      if (items.length > 0) break;
      continue;
    }
    const line = rawLine.replace(/^[-*•]\s*/, '').replace(/^\d+[.)、]\s*/, '').trim();
    if (!line) continue;
    if (/^(<tool_call>|\[TOOL:|```|\{|\}|我来|让我|下面是|以下是|请开始|开始执行|让我开始)/i.test(line)) break;
    if (/^(规划任务|任务规划|任务清单|待办清单|计划任务|规划如下|计划如下)$/i.test(line)) continue;
    if (/^[，。,。.；;：:]+$/.test(line)) continue;
    items.push(line);
  }

  const uniqueItems = [...new Set(items)];
  return uniqueItems.slice(0, 8).map((title, index) => ({
    id: index + 1,
    title,
    status: index === 0 ? 'in-progress' : 'not-started',
  }));
}
