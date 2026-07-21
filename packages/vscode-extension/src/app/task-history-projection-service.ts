import * as fs from 'fs';
import * as nodePath from 'path';
import {
  FileSystemRunEvidenceLedger,
  productRunEvidenceRoot,
  type RunEvidenceEvent,
  type RunEvidenceJson,
  type RunEvidenceSnapshot,
  type RunEvidenceVerificationReport,
} from '@devseek-netai/shared';
import {
  TaskCheckpointStore,
  type TaskCheckpointRecord,
  type TaskCheckpointStorage,
} from './task-checkpoint-store';
import type {
  TaskRunRecord,
  TaskRunStatus,
  TaskRunTimelineItem,
} from './task-history-store';

export const TASK_HISTORY_PROJECTION_PROTOCOL = 'devseek.task-history-projection/v1';

type JsonObject = { [key: string]: RunEvidenceJson };

export interface TaskHistoryProjectionDetail {
  protocol: typeof TASK_HISTORY_PROJECTION_PROTOCOL;
  source: 'run-evidence';
  verificationStatus: RunEvidenceVerificationReport['status'];
  task: TaskRunRecord;
  timeline: TaskRunTimelineItem[];
}

export interface TaskHistoryProjectionServiceDeps<TTask = unknown> {
  workspaceRoot: string;
  storage?: TaskCheckpointStorage;
  checkpointStore?: TaskCheckpointStore<TTask>;
  ledger?: FileSystemRunEvidenceLedger;
  maxRecords?: number;
}

export class TaskHistoryProjectionService<TTask = unknown> {
  private readonly workspaceRoot: string;
  private readonly evidenceRoot: string;
  private readonly ledger: FileSystemRunEvidenceLedger;
  private readonly checkpointStore?: TaskCheckpointStore<TTask>;
  private readonly maxRecords: number;

  constructor(deps: TaskHistoryProjectionServiceDeps<TTask>) {
    this.workspaceRoot = nodePath.resolve(String(deps.workspaceRoot || process.cwd()));
    this.evidenceRoot = productRunEvidenceRoot(this.workspaceRoot);
    this.ledger = deps.ledger ?? new FileSystemRunEvidenceLedger({ rootDir: this.evidenceRoot });
    this.checkpointStore = deps.checkpointStore ?? (
      deps.storage ? new TaskCheckpointStore<TTask>(deps.storage) : undefined
    );
    this.maxRecords = Math.max(1, Math.floor(deps.maxRecords ?? 100));
  }

  list(): TaskRunRecord[] {
    return this.projectDetails()
      .map(detail => detail.task)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, this.maxRecords);
  }

  get(id: string): TaskHistoryProjectionDetail | undefined {
    const target = String(id || '').trim();
    if (!target) return undefined;
    return this.projectDetails().find(detail => detail.task.id === target);
  }

  private projectDetails(): TaskHistoryProjectionDetail[] {
    const details: TaskHistoryProjectionDetail[] = [];
    for (const runId of this.discoverRunIds()) {
      try {
        const verification = this.ledger.verify(runId);
        if (!verification.valid) continue;
        const snapshot = this.ledger.readSnapshot(runId);
        details.push(this.projectSnapshot(snapshot, verification));
      } catch {
        // Invalid or torn evidence is not silently converted into history UI facts.
      }
    }
    return details.sort((a, b) => b.task.updatedAt - a.task.updatedAt);
  }

  private discoverRunIds(): string[] {
    if (!fs.existsSync(this.evidenceRoot)) return [];
    const runIds = new Set<string>();
    let buckets: fs.Dirent[];
    try {
      buckets = fs.readdirSync(this.evidenceRoot, { withFileTypes: true });
    } catch {
      return [];
    }
    for (const bucket of buckets) {
      if (!bucket.isDirectory()) continue;
      const recordsDir = nodePath.join(this.evidenceRoot, bucket.name, 'records');
      const runId = discoverRunIdFromRecords(recordsDir);
      if (runId) runIds.add(runId);
    }
    return [...runIds].sort();
  }

  private projectSnapshot(
    snapshot: RunEvidenceSnapshot,
    verification: RunEvidenceVerificationReport,
  ): TaskHistoryProjectionDetail {
    const events = snapshot.records.map(record => record.event);
    const openEvent = events[0];
    const openPayload = payloadObject(openEvent);
    const commandEvent = events.find(event => event.type === 'command.accepted');
    const commandPayload = payloadObject(commandEvent);
    const settlementEvent = findLastEvent(events, 'run.settled');
    const checkpointEvent = findLastEvent(events, 'checkpoint.created');
    const activeCheckpoint = this.loadActiveCheckpoint(stringValue(openPayload.session_id));
    const timeline = events.map(projectTimelineItem);
    const createdAt = eventTimeMs(openEvent);
    const updatedAt = Math.max(
      ...events.map(eventTimeMs),
      snapshot.seal ? Date.parse(snapshot.seal.seal.sealed_at) : 0,
      createdAt,
    );
    const task: TaskRunRecord = {
      id: snapshot.runId,
      ...(stringValue(openPayload.session_id) ? { sessionId: stringValue(openPayload.session_id) } : {}),
      workspaceId: this.workspaceRoot,
      repositoryRoot: this.workspaceRoot,
      title: buildTaskHistoryTitle(snapshot.runId, settlementEvent),
      userGoal: buildEvidenceBoundUserGoal(snapshot.runId, commandPayload),
      provider: { type: 'bridge' },
      status: projectTaskRunStatus(events, settlementEvent, checkpointEvent, activeCheckpoint),
      workflowMode: projectWorkflowMode(openPayload.mode),
      todos: projectTodos(events),
      changedFiles: [],
      operationRefs: collectOperationRefs(events),
      changeSetRefs: [],
      validationRefs: collectOperationRefs(events.filter(event => event.type.startsWith('verification.'))),
      qualityGateRef: collectOperationRefs(events.filter(event => event.type.startsWith('quality_gate.'))).at(-1),
      checkpointRef: projectCheckpointRef(snapshot.runId, checkpointEvent, activeCheckpoint),
      pauseReason: projectPauseReason(checkpointEvent, activeCheckpoint),
      evidenceRefs: events.map(evidenceRef),
      historySource: 'run-evidence',
      historySourceRef: `run-evidence:${snapshot.runId}:${verification.head?.eventSha256 ?? 'open'}`,
      timeline,
      createdAt,
      updatedAt,
    };
    return {
      protocol: TASK_HISTORY_PROJECTION_PROTOCOL,
      source: 'run-evidence',
      verificationStatus: verification.status,
      task,
      timeline,
    };
  }

  private loadActiveCheckpoint(sessionId?: string): TaskCheckpointRecord<TTask> | undefined {
    if (!this.checkpointStore) return undefined;
    return this.checkpointStore.loadScoped({
      wsRootFsPath: this.workspaceRoot,
      ...(sessionId ? { sessionId } : {}),
    });
  }
}

function discoverRunIdFromRecords(recordsDir: string): string | undefined {
  let names: string[];
  try {
    names = fs.readdirSync(recordsDir)
      .filter(name => /^\d{20}\.json$/.test(name))
      .sort();
  } catch {
    return undefined;
  }
  for (const name of names) {
    const runId = runIdFromRecord(nodePath.join(recordsDir, name));
    if (runId) return runId;
  }
  return undefined;
}

function runIdFromRecord(filePath: string): string | undefined {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile()) return undefined;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const record = objectValue(parsed);
    const event = objectValue(record.event);
    const seal = objectValue(record.seal);
    return stringValue(event.run_id) ?? stringValue(seal.run_id);
  } catch {
    return undefined;
  }
}

function projectTimelineItem(event: RunEvidenceEvent): TaskRunTimelineItem {
  const payload = payloadObject(event);
  const status = stringValue(payload.status);
  return {
    id: `run-evidence:${event.sequence}:${event.event_sha256}`,
    type: event.type,
    ...(status ? { status } : {}),
    evidenceRef: evidenceRef(event),
    occurredAt: eventTimeMs(event),
    summary: summarizeTimelineEvent(event, payload),
  };
}

function projectTaskRunStatus(
  events: RunEvidenceEvent[],
  settlementEvent: RunEvidenceEvent | undefined,
  checkpointEvent: RunEvidenceEvent | undefined,
  activeCheckpoint: TaskCheckpointRecord<unknown> | undefined,
): TaskRunStatus {
  const settlementStatus = stringValue(payloadObject(settlementEvent).status);
  if (settlementStatus === 'completed' || settlementStatus === 'failed' || settlementStatus === 'cancelled') {
    return settlementStatus;
  }
  if (events.some(event => event.type === 'quality_gate.failed' || event.type === 'quality_gate.vetoed')) {
    return 'quality-failed';
  }
  if (checkpointEvent || activeCheckpoint) return 'recoverable';
  return 'running';
}

function projectCheckpointRef(
  runId: string,
  checkpointEvent: RunEvidenceEvent | undefined,
  activeCheckpoint: TaskCheckpointRecord<unknown> | undefined,
): string | undefined {
  if (activeCheckpoint) {
    return `checkpoint:${activeCheckpoint.sessionId}:${activeCheckpoint.startFromIndex}:${activeCheckpoint.savedAt}`;
  }
  if (!checkpointEvent) return undefined;
  return `run-evidence-checkpoint:${runId}:${checkpointEvent.sequence}`;
}

function projectPauseReason(
  checkpointEvent: RunEvidenceEvent | undefined,
  activeCheckpoint: TaskCheckpointRecord<unknown> | undefined,
): string | undefined {
  return activeCheckpoint?.pauseReason || stringValue(payloadObject(checkpointEvent).reason);
}

function projectTodos(events: RunEvidenceEvent[]): TaskRunRecord['todos'] {
  const todos = new Map<string, { id?: string | number; title: string; status: string }>();
  for (const event of events.filter(candidate => candidate.type === 'agent.status')) {
    const payload = payloadObject(event);
    const rawId = stringValue(payload.task_id) ?? numberValue(payload.task_index)?.toString();
    if (!rawId) continue;
    todos.set(rawId, {
      id: rawId,
      title: `Task ${rawId}`,
      status: stringValue(payload.status) ?? 'observed',
    });
  }
  return [...todos.values()];
}

function collectOperationRefs(events: readonly RunEvidenceEvent[]): string[] {
  return unique(events.map(event => stringValue(payloadObject(event).operation_id)));
}

function buildTaskHistoryTitle(runId: string, settlementEvent: RunEvidenceEvent | undefined): string {
  const status = stringValue(payloadObject(settlementEvent).status);
  return status ? `Run ${runId} (${status})` : `Run ${runId}`;
}

function buildEvidenceBoundUserGoal(runId: string, commandPayload: JsonObject): string {
  const promptHash = stringValue(commandPayload.prompt_sha256);
  return promptHash ? `prompt_sha256:${promptHash}` : `run_id:${runId}`;
}

function projectWorkflowMode(value: RunEvidenceJson): TaskRunRecord['workflowMode'] {
  const mode = stringValue(value);
  if (mode === 'chat' || mode === 'inspect' || mode === 'plan' || mode === 'edit' || mode === 'run' || mode === 'review') {
    return mode;
  }
  return 'chat';
}

function summarizeTimelineEvent(event: RunEvidenceEvent, payload: JsonObject): string {
  const status = stringValue(payload.status);
  const operationId = stringValue(payload.operation_id);
  const reason = stringValue(payload.reason);
  return [event.type, status, operationId, reason].filter(Boolean).join(' | ');
}

function findLastEvent(events: readonly RunEvidenceEvent[], type: RunEvidenceEvent['type']): RunEvidenceEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return undefined;
}

function eventTimeMs(event: RunEvidenceEvent | undefined): number {
  const parsed = Date.parse(String(event?.occurred_at || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function evidenceRef(event: RunEvidenceEvent): string {
  return `run-evidence:${event.sequence}:${event.event_sha256}`;
}

function payloadObject(event: RunEvidenceEvent | undefined): JsonObject {
  return objectValue(event?.payload);
}

function objectValue(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function stringValue(value: RunEvidenceJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: RunEvidenceJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}
