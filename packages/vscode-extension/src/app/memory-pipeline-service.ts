import { randomUUID } from 'crypto';
import type { LLMProvider } from '../llm/types';
import { MemoryPipelineStore } from '../memory/memory-pipeline-store';
import { MemoryProjectionWriter } from '../memory/memory-projection';
import {
  MemorySemanticConsolidator,
  MemorySemanticExtractor,
  type MemoryModelPort,
} from '../memory/memory-semantic-model';
import { SensitiveMemoryGuard } from '../memory/sensitive-memory-guard';
import type { MemoryRolloutEvidence, MemoryStage1Job } from '../memory/pipeline-types';
import { MemoryService } from './memory-service';

export interface MemoryPipelineServiceDeps {
  workspaceRoot: string;
  model: MemoryModelPort;
  memoryHome?: string;
  workerId?: string;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export class MemoryPipelineService {
  private readonly memory: MemoryService;
  private readonly queue: MemoryPipelineStore;
  private readonly extractor: MemorySemanticExtractor;
  private readonly consolidator: MemorySemanticConsolidator;
  private readonly projection: MemoryProjectionWriter;
  private readonly guard = new SensitiveMemoryGuard();
  private readonly workerId: string;
  private readonly now: () => number;

  constructor(private readonly deps: MemoryPipelineServiceDeps) {
    this.memory = new MemoryService({
      workspaceRoot: deps.workspaceRoot,
      memoryHome: deps.memoryHome,
    });
    this.queue = new MemoryPipelineStore(deps.workspaceRoot, {
      location: this.memory.getLocation(),
    });
    this.extractor = new MemorySemanticExtractor(deps.model);
    this.consolidator = new MemorySemanticConsolidator(deps.model);
    this.projection = new MemoryProjectionWriter(this.memory.getLocation());
    this.workerId = deps.workerId ?? `memory-worker-${process.pid}-${randomUUID()}`;
    this.now = deps.now ?? Date.now;
  }

  enqueue(evidence: MemoryRolloutEvidence): void {
    if (evidence.repositoryId !== this.memory.getLocation().repositoryId) {
      throw new Error('memory-pipeline:repository-mismatch');
    }
    this.queue.enqueue(evidence, this.now());
  }

  async processPending(signal?: AbortSignal): Promise<void> {
    const jobs = this.queue.claimStage1(this.workerId, this.now(), 2);
    await Promise.all(jobs.map(job => this.processStage1Job(job, signal)));

    const selected = this.queue.claimConsolidation(this.workerId, this.now(), 256);
    if (selected.length === 0) return;
    try {
      const current = this.memory.retrieve({ includeDisabled: true, limit: 100 });
      const output = await this.consolidator.consolidate(selected, current, signal);
      const rolloutIds = selected.map(job => job.rolloutId);
      for (const proposal of output.proposals) {
        try {
          this.memory.acceptConsolidationProposal(proposal, rolloutIds);
        } catch (error) {
          this.deps.onError?.(error);
        }
      }
      const records = this.memory.retrieve({ includeDisabled: true, limit: 500 });
      this.projection.write({
        records,
        stage1Jobs: selected,
      });
      this.queue.completeConsolidation(this.workerId, selected.map(job => job.id), this.now());
    } catch (error) {
      this.queue.failConsolidation(this.workerId, error, this.now());
      this.deps.onError?.(error);
    }
  }

  private async processStage1Job(job: MemoryStage1Job, signal?: AbortSignal): Promise<void> {
    try {
      const sanitized = sanitizeRolloutEvidence(job.evidence, this.guard);
      const output = await this.extractor.extract(sanitized, signal);
      this.queue.completeStage1(job.id, this.workerId, output, this.now());
    } catch (error) {
      this.queue.failStage1(job.id, this.workerId, error, this.now());
      this.deps.onError?.(error);
    }
  }
}

type MemoryPipelineWork = (signal: AbortSignal) => Promise<void>;

interface QueuedMemoryPipelineWork {
  readonly work: MemoryPipelineWork;
  readonly onError?: (error: unknown) => void;
}

class MemoryBackgroundWorkCoordinator {
  private readonly queue: QueuedMemoryPipelineWork[] = [];
  private foregroundDepth = 0;
  private forceDrain = false;
  private active?: { controller: AbortController; promise: Promise<void> };

  async beginForeground(): Promise<void> {
    this.foregroundDepth += 1;
    const active = this.active;
    if (!active) return;
    active.controller.abort(new Error('memory-pipeline:foreground-run-started'));
    await active.promise;
  }

  endForeground(): void {
    this.foregroundDepth = Math.max(0, this.foregroundDepth - 1);
    this.kick();
  }

  schedule(work: MemoryPipelineWork, onError?: (error: unknown) => void): void {
    this.queue.push({ work, onError });
    this.kick();
  }

  async flush(): Promise<void> {
    this.forceDrain = true;
    try {
      while (this.active || this.queue.length > 0) {
        this.kick();
        if (this.active) await this.active.promise;
        else await Promise.resolve();
      }
    } finally {
      this.forceDrain = false;
    }
  }

  private kick(): void {
    if (this.active || this.queue.length === 0) return;
    if (!this.forceDrain && this.foregroundDepth > 0) return;

    const item = this.queue.shift()!;
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => item.work(controller.signal))
      .catch(error => { item.onError?.(error); })
      .finally(() => {
        if (this.active?.promise === promise) this.active = undefined;
        this.kick();
      });
    this.active = { controller, promise };
  }
}

const memoryBackgroundWork = new MemoryBackgroundWorkCoordinator();

export function scheduleMemoryPipelineWork(
  work: MemoryPipelineWork,
  onError?: (error: unknown) => void,
): void {
  memoryBackgroundWork.schedule(work, onError);
}

export async function beginMemoryForegroundRun(): Promise<void> {
  await memoryBackgroundWork.beginForeground();
}

export function endMemoryForegroundRun(): void {
  memoryBackgroundWork.endForeground();
}

export async function flushMemoryPipelineWork(): Promise<void> {
  await memoryBackgroundWork.flush();
}

export function createProviderMemoryModel(provider: LLMProvider): MemoryModelPort {
  return {
    chat: input => provider.chat({
      messages: input.messages,
      stream: false,
      mode: 'r1',
      newSession: true,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
    }),
  };
}

function sanitizeRolloutEvidence(
  evidence: MemoryRolloutEvidence,
  guard: SensitiveMemoryGuard,
): MemoryRolloutEvidence {
  const redact = (value: string) => guard.redact(value).text;
  return {
    ...evidence,
    userTurns: evidence.userTurns.map(redact),
    ...(evidence.assistantSummary ? { assistantSummary: redact(evidence.assistantSummary) } : {}),
    changedPaths: evidence.changedPaths.map(redact),
    toolEvidence: evidence.toolEvidence.map(redact),
    verificationEvidence: evidence.verificationEvidence.map(redact),
    evidenceRefs: evidence.evidenceRefs.map(redact),
  };
}
