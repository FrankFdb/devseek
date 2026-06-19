export type TaskLedgerStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
export type TaskLedgerSource = 'tool' | 'validation' | 'user' | 'model-prose';

export interface TaskLedgerInput {
  id?: string;
  title?: string;
  desc?: string;
  status?: string;
  evidence?: string[];
}

export interface TaskLedgerItem {
  id: string;
  title: string;
  status: TaskLedgerStatus;
  source: TaskLedgerSource;
  evidence: string[];
  updatedAt: number;
}

export class TaskLedger {
  private readonly items = new Map<string, TaskLedgerItem>();

  applyTodoUpdate(items: TaskLedgerInput[], source: TaskLedgerSource = 'tool'): TaskLedgerItem[] {
    if (source === 'model-prose') {
      return this.snapshot();
    }

    const now = Date.now();
    for (const input of items) {
      const id = normalizeId(input);
      const existing = this.items.get(id);
      const title = normalizeTitle(input) || existing?.title || id;
      this.items.set(id, {
        id,
        title,
        status: normalizeStatus(input.status) ?? existing?.status ?? 'pending',
        source,
        evidence: mergeEvidence(existing?.evidence ?? [], input.evidence ?? []),
        updatedAt: now,
      });
    }
    return this.snapshot();
  }

  applyValidationFact(id: string, status: Extract<TaskLedgerStatus, 'completed' | 'failed' | 'skipped'>, evidence: string[] = []): TaskLedgerItem[] {
    const key = normalizePlainId(id);
    const existing = this.items.get(key);
    const now = Date.now();
    this.items.set(key, {
      id: key,
      title: existing?.title ?? key,
      status,
      source: 'validation',
      evidence: mergeEvidence(existing?.evidence ?? [], evidence),
      updatedAt: now,
    });
    return this.snapshot();
  }

  applyModelProse(_text: string): TaskLedgerItem[] {
    return this.snapshot();
  }

  snapshot(): TaskLedgerItem[] {
    return [...this.items.values()].sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id));
  }
}

function normalizeId(input: TaskLedgerInput): string {
  return normalizePlainId(input.id || normalizeTitle(input));
}

function normalizePlainId(value: string): string {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '-');
  return normalized || 'task';
}

function normalizeTitle(input: TaskLedgerInput): string {
  return String(input.title ?? input.desc ?? '').trim();
}

function normalizeStatus(value: string | undefined): TaskLedgerStatus | undefined {
  switch ((value || '').trim().toLowerCase()) {
    case 'todo':
    case 'pending':
      return 'pending';
    case 'doing':
    case 'in_progress':
    case 'in-progress':
    case 'running':
      return 'in_progress';
    case 'done':
    case 'completed':
    case 'complete':
      return 'completed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'skipped':
    case 'skip':
      return 'skipped';
    default:
      return undefined;
  }
}

function mergeEvidence(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right].filter(Boolean))];
}
