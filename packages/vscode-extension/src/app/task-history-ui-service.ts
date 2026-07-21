import {
  TaskHistoryProjectionService,
  type TaskHistoryProjectionDetail,
} from './task-history-projection-service';
import {
  TaskHistoryStore,
  type TaskHistoryStorage,
  type TaskRunRecord,
  type TaskRunTimelineItem,
} from './task-history-store';

export const TASK_HISTORY_UI_COMMANDS = new Set([
  'listTasks',
  'openTask',
  'continueTask',
  'archiveTask',
  'deleteTask',
  'exportTask',
]);

export interface TaskHistoryUiCommand {
  type: string;
  id?: string;
}

export interface TaskHistoryProjectionPort {
  list(): TaskRunRecord[];
  get(id: string): TaskHistoryProjectionDetail | undefined;
}

export interface TaskHistoryUiServiceOptions {
  workspaceRoot?: string;
  projectionService?: TaskHistoryProjectionPort;
}

export type TaskHistoryUiResponse =
  | { type: 'taskHistoryList'; tasks: TaskRunRecord[] }
  | { type: 'taskHistoryDetail'; task?: TaskRunRecord; id?: string; timeline?: TaskRunTimelineItem[] }
  | { type: 'taskHistoryContinueRequested'; task?: TaskRunRecord; id: string; checkpointRef?: string }
  | { type: 'taskHistoryArchived'; task?: TaskRunRecord; id: string }
  | { type: 'taskHistoryDeleted'; id: string }
  | { type: 'taskHistoryExported'; id: string; data?: string };

export class TaskHistoryUiService {
  private readonly store: TaskHistoryStore;
  private readonly projectionService?: TaskHistoryProjectionPort;

  constructor(storage: TaskHistoryStorage, options: TaskHistoryUiServiceOptions = {}) {
    this.store = new TaskHistoryStore(storage);
    this.projectionService = options.projectionService ?? (
      options.workspaceRoot
        ? new TaskHistoryProjectionService({ workspaceRoot: options.workspaceRoot, storage })
        : undefined
    );
  }

  canHandle(command: Pick<TaskHistoryUiCommand, 'type'>): boolean {
    return TASK_HISTORY_UI_COMMANDS.has(command.type);
  }

  async handle(command: TaskHistoryUiCommand): Promise<TaskHistoryUiResponse[]> {
    switch (command.type) {
      case 'listTasks':
        return [this.list()];
      case 'openTask':
        return [this.detail(command.id)];
      case 'continueTask': {
        const task = this.getTask(command.id);
        return [{ type: 'taskHistoryContinueRequested', id: command.id ?? '', task, checkpointRef: task?.checkpointRef }];
      }
      case 'archiveTask': {
        const task = command.id ? await this.store.archive(command.id) : undefined;
        return [{ type: 'taskHistoryArchived', id: command.id ?? '', task }, this.list()];
      }
      case 'deleteTask':
        if (command.id) await this.store.delete(command.id);
        return [{ type: 'taskHistoryDeleted', id: command.id ?? '' }, this.list()];
      case 'exportTask':
        return [{ type: 'taskHistoryExported', id: command.id ?? '', data: command.id ? this.exportTask(command.id) : undefined }];
      default:
        return [];
    }
  }

  private list(): TaskHistoryUiResponse {
    return { type: 'taskHistoryList', tasks: this.projectionService?.list() ?? this.store.list() };
  }

  private detail(id?: string): TaskHistoryUiResponse {
    if (!id) return { type: 'taskHistoryDetail', id };
    const projected = this.projectionService?.get(id);
    if (projected) {
      return { type: 'taskHistoryDetail', id, task: projected.task, timeline: projected.timeline };
    }
    return { type: 'taskHistoryDetail', id, task: this.store.get(id) };
  }

  private getTask(id?: string): TaskRunRecord | undefined {
    if (!id) return undefined;
    return this.projectionService?.get(id)?.task ?? this.store.get(id);
  }

  private exportTask(id: string): string | undefined {
    const projected = this.projectionService?.get(id);
    return projected ? JSON.stringify(projected, null, 2) : this.store.exportRecord(id);
  }
}
