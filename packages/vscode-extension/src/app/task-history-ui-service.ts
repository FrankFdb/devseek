import {
  exportTaskHistoryRecordRedacted,
  TaskHistoryProjectionService,
  type TaskHistoryProjectionDetail,
} from './task-history-projection-service';
import {
  TaskHistoryStore,
  type TaskHistoryContinueResult,
  type TaskHistoryLifecycleReceipt,
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
  archive?(id: string): Promise<{ task?: TaskRunRecord; lifecycleReceipt?: TaskHistoryLifecycleReceipt }>;
  delete?(id: string): Promise<{ task?: TaskRunRecord; lifecycleReceipt?: TaskHistoryLifecycleReceipt }>;
  exportRecord?(id: string): Promise<string | undefined>;
  requestContinue?(id: string): Promise<TaskHistoryContinueResult>;
}

export interface TaskHistoryUiServiceOptions {
  workspaceRoot?: string;
  projectionService?: TaskHistoryProjectionPort;
}

export type TaskHistoryUiResponse =
  | { type: 'taskHistoryList'; tasks: TaskRunRecord[] }
  | { type: 'taskHistoryDetail'; task?: TaskRunRecord; id?: string; timeline?: TaskRunTimelineItem[] }
  | { type: 'taskHistoryContinueRequested'; task?: TaskRunRecord; id: string; checkpointRef?: string; resumeStatus?: TaskHistoryContinueResult['status']; blockedReason?: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt }
  | { type: 'taskHistoryArchived'; task?: TaskRunRecord; id: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt }
  | { type: 'taskHistoryDeleted'; id: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt }
  | { type: 'taskHistoryExported'; id: string; data?: string; lifecycleReceipt?: TaskHistoryLifecycleReceipt };

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
        return [await this.requestContinue(command.id)];
      }
      case 'archiveTask': {
        return [await this.archiveTask(command.id), this.list()];
      }
      case 'deleteTask':
        return [await this.deleteTask(command.id), this.list()];
      case 'exportTask':
        return [{ type: 'taskHistoryExported', id: command.id ?? '', data: command.id ? await this.exportTask(command.id) : undefined }];
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

  private async requestContinue(id?: string): Promise<TaskHistoryUiResponse> {
    if (!id) return { type: 'taskHistoryContinueRequested', id: '' };
    if (this.projectionService?.get(id) && this.projectionService.requestContinue) {
      const result = await this.projectionService.requestContinue(id);
      return {
        type: 'taskHistoryContinueRequested',
        id,
        task: result.task,
        checkpointRef: result.checkpointRef,
        resumeStatus: result.status,
        blockedReason: result.blockedReason,
        lifecycleReceipt: result.lifecycleReceipt,
      };
    }
    const task = this.getTask(id);
    return { type: 'taskHistoryContinueRequested', id, task, checkpointRef: task?.checkpointRef };
  }

  private async archiveTask(id?: string): Promise<TaskHistoryUiResponse> {
    if (!id) return { type: 'taskHistoryArchived', id: '' };
    if (this.projectionService?.get(id) && this.projectionService.archive) {
      const result = await this.projectionService.archive(id);
      return { type: 'taskHistoryArchived', id, task: result.task, lifecycleReceipt: result.lifecycleReceipt };
    }
    const task = await this.store.archive(id);
    return { type: 'taskHistoryArchived', id, task };
  }

  private async deleteTask(id?: string): Promise<TaskHistoryUiResponse> {
    if (!id) return { type: 'taskHistoryDeleted', id: '' };
    if (this.projectionService?.get(id) && this.projectionService.delete) {
      const result = await this.projectionService.delete(id);
      return { type: 'taskHistoryDeleted', id, lifecycleReceipt: result.lifecycleReceipt };
    }
    await this.store.delete(id);
    return { type: 'taskHistoryDeleted', id };
  }

  private async exportTask(id: string): Promise<string | undefined> {
    if (this.projectionService?.get(id) && this.projectionService.exportRecord) {
      return this.projectionService.exportRecord(id);
    }
    const record = this.store.get(id);
    return record ? exportTaskHistoryRecordRedacted({ source: 'legacy-store', task: record }) : undefined;
  }
}
