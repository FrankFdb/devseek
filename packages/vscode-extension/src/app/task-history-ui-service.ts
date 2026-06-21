import { TaskHistoryStore, type TaskHistoryStorage, type TaskRunRecord } from './task-history-store';

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

export type TaskHistoryUiResponse =
  | { type: 'taskHistoryList'; tasks: TaskRunRecord[] }
  | { type: 'taskHistoryDetail'; task?: TaskRunRecord; id?: string }
  | { type: 'taskHistoryContinueRequested'; task?: TaskRunRecord; id: string; checkpointRef?: string }
  | { type: 'taskHistoryArchived'; task?: TaskRunRecord; id: string }
  | { type: 'taskHistoryDeleted'; id: string }
  | { type: 'taskHistoryExported'; id: string; data?: string };

export class TaskHistoryUiService {
  private readonly store: TaskHistoryStore;

  constructor(storage: TaskHistoryStorage) {
    this.store = new TaskHistoryStore(storage);
  }

  canHandle(command: Pick<TaskHistoryUiCommand, 'type'>): boolean {
    return TASK_HISTORY_UI_COMMANDS.has(command.type);
  }

  async handle(command: TaskHistoryUiCommand): Promise<TaskHistoryUiResponse[]> {
    switch (command.type) {
      case 'listTasks':
        return [this.list()];
      case 'openTask':
        return [{ type: 'taskHistoryDetail', id: command.id, task: this.get(command.id) }];
      case 'continueTask': {
        const task = this.get(command.id);
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
        return [{ type: 'taskHistoryExported', id: command.id ?? '', data: command.id ? this.store.exportRecord(command.id) : undefined }];
      default:
        return [];
    }
  }

  private list(): TaskHistoryUiResponse {
    return { type: 'taskHistoryList', tasks: this.store.list() };
  }

  private get(id?: string): TaskRunRecord | undefined {
    return id ? this.store.get(id) : undefined;
  }
}
