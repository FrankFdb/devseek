export type TaskTimelineEventKind = 'workflow' | 'tool' | 'review' | 'validation' | 'quality' | 'recovery';

export interface TaskTimelineEvent {
  id?: string;
  taskId: string;
  kind: TaskTimelineEventKind;
  title: string;
  detail?: string;
  status?: string;
  evidenceRefs?: string[];
  createdAt?: number;
}

export interface TaskTimelineItem extends Required<Pick<TaskTimelineEvent, 'id' | 'taskId' | 'kind' | 'title'>> {
  detail: string;
  status: string;
  evidenceRefs: string[];
  createdAt: number;
}

export class TaskTimelineService {
  private readonly events = new Map<string, TaskTimelineItem[]>();

  append(event: TaskTimelineEvent): TaskTimelineItem {
    const item = normalizeTimelineEvent(event);
    const list = this.events.get(item.taskId) || [];
    list.push(item);
    this.events.set(item.taskId, list);
    return item;
  }

  list(taskId: string): TaskTimelineItem[] {
    return [...(this.events.get(taskId) || [])].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  summarize(taskId: string): string {
    return this.list(taskId)
      .map(item => `${item.kind}:${item.status}:${item.title}`)
      .join('\n');
  }
}

function normalizeTimelineEvent(event: TaskTimelineEvent): TaskTimelineItem {
  const createdAt = Number(event.createdAt) || Date.now();
  const kind = event.kind || 'workflow';
  const title = String(event.title || '').trim() || kind;
  const taskId = String(event.taskId || '').trim() || 'task';
  return {
    id: event.id || `${taskId}:${kind}:${createdAt}:${title.slice(0, 24)}`,
    taskId,
    kind,
    title,
    detail: String(event.detail || '').trim(),
    status: String(event.status || 'recorded').trim(),
    evidenceRefs: [...new Set((event.evidenceRefs || []).filter(Boolean))],
    createdAt,
  };
}
