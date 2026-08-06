import {
  CanonicalRunEvidenceRetentionService,
  createProductRunEvidenceAuthorityToken,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type CodingRunLifecycleSnapshot,
  type ProductRunEvidenceRecordInput,
  type RunEvidenceSettlementStatus,
} from '@devseek-netai/shared';
import { formatCliError } from './cli-error';

export type CliRunSurfaceKind = 'cli' | 'jsonl';

type EvidenceSessionPort = Pick<
  ProductRunEvidenceSession,
  'readEvents' | 'record' | 'settleAndSeal'
>;
type EvidenceSessionOptions = Parameters<typeof ProductRunEvidenceSession.forWorkspace>[0];

export interface CliRunEvidenceRuntime {
  createAuthorityToken(): string;
  openSession(options: EvidenceSessionOptions): EvidenceSessionPort;
  formatError(error: unknown): string;
  warn(message: string): void;
}

export interface CliRunEvidenceOpenInput {
  workspaceRoot: string;
  runId: string;
  prompt: string;
  surface: CliRunSurfaceKind;
}

const DEFAULT_RUNTIME: CliRunEvidenceRuntime = {
  createAuthorityToken: createProductRunEvidenceAuthorityToken,
  openSession: options => ProductRunEvidenceSession.forWorkspace(options),
  formatError: formatCliError,
  warn: message => console.error(message),
};

export class CliRunEvidence {
  static open(
    input: CliRunEvidenceOpenInput,
    runtime: CliRunEvidenceRuntime = DEFAULT_RUNTIME,
  ): CliRunEvidence {
    const ownerToken = runtime.createAuthorityToken();
    const participantToken = runtime.createAuthorityToken();
    try {
      const session = runtime.openSession({
        workspaceRoot: input.workspaceRoot,
        runId: input.runId,
        surface: input.surface,
        authority: { role: 'owner', token: ownerToken, participantToken },
        openIfMissing: true,
        openPayload: {
          owner_surface: input.surface,
          cwd: summarizeTraceText(input.workspaceRoot),
        },
      });
      session.record({
        type: 'command.accepted',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-command-accepted', { runId: input.runId }),
        payload: { prompt: summarizeTraceText(input.prompt) },
      });
      return new CliRunEvidence(input, participantToken, runtime, session, false);
    } catch (error) {
      runtime.warn(`DevSeek evidence warning: ${runtime.formatError(error)}`);
      return new CliRunEvidence(input, participantToken, runtime, undefined, true);
    }
  }

  readonly participantToken: string;
  readonly surface: CliRunSurfaceKind;
  private readonly runId: string;
  private degraded: boolean;
  private degradationRecorded = false;

  private constructor(
    input: CliRunEvidenceOpenInput,
    participantToken: string,
    private readonly runtime: CliRunEvidenceRuntime,
    private readonly session: EvidenceSessionPort | undefined,
    degraded: boolean,
  ) {
    this.participantToken = participantToken;
    this.surface = input.surface;
    this.runId = input.runId;
    this.degraded = degraded;
  }

  recordOperation(
    input: ProductRunEvidenceRecordInput,
    operationId: string,
    boundary?: string,
  ): void {
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? input.payload
      : {};
    this.record({
      ...input,
      payload: {
        ...payload,
        operation_id: operationId,
        ...(boundary ? { boundary } : {}),
        status: input.type.slice(input.type.indexOf('.') + 1),
        trust: 'product-runtime-observation',
      },
    });
  }

  assertBridgeComplete(operationId: string, expectedTerminal: 'completed' | 'failed'): void {
    if (!this.session) return;
    try {
      const matching = this.session.readEvents().filter(event => {
        if (!event.type.startsWith('provider.')) return false;
        if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
        return event.payload.operation_id === operationId && event.payload.boundary === 'bridge-server';
      });
      const requested = matching.filter(event => event.type === 'provider.requested').length;
      const terminal = matching.filter(event => (
        event.type === 'provider.completed' || event.type === 'provider.failed'
      )).length;
      if (requested !== 1 || terminal !== 1 || matching.at(-1)?.type !== `provider.${expectedTerminal}`) {
        this.markDegraded(
          new Error(`Bridge evidence boundary is incomplete for ${operationId}; expected provider.${expectedTerminal}`),
        );
      }
    } catch (error) {
      this.markDegraded(error);
    }
  }

  async waitForBridgeProviderTerminals(timeoutMs = 500): Promise<void> {
    if (!this.session) return;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      try {
        if (this.findPendingBridgeProviderOperations().length === 0) return;
      } catch (error) {
        this.markDegraded(error);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  retainLifecycle(snapshot: CodingRunLifecycleSnapshot): void {
    if (!this.session) {
      this.degraded = true;
      return;
    }
    try {
      new CanonicalRunEvidenceRetentionService(this.runId, this.session).retainLifecycle(snapshot);
    } catch (error) {
      this.markDegraded(error);
    }
  }

  settle(status: RunEvidenceSettlementStatus): void {
    if (!this.session) return;
    if (status === 'completed' && this.degraded) {
      this.runtime.warn('DevSeek evidence warning: completed settlement refused because evidence is degraded');
      return;
    }
    try {
      this.session.settleAndSeal({
        status,
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-run-settled', { runId: this.runId }),
        payload: { surface: this.surface },
      });
    } catch (error) {
      this.markDegraded(error);
    }
  }

  private record(input: ProductRunEvidenceRecordInput): void {
    if (!this.session) {
      this.degraded = true;
      return;
    }
    try {
      this.session.record(input);
    } catch (error) {
      this.markDegraded(error);
    }
  }

  private markDegraded(error: unknown): void {
    this.degraded = true;
    const message = this.runtime.formatError(error);
    this.runtime.warn(`DevSeek evidence warning: ${message}`);
    if (!this.session || this.degradationRecorded) return;
    try {
      this.session.record({
        type: 'evidence.degraded',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-evidence-degraded', { message }),
        payload: {
          trust: 'product-runtime-observation',
          status: 'degraded',
          reason: message,
        },
      });
      this.degradationRecorded = true;
    } catch (appendError) {
      this.runtime.warn(`DevSeek evidence warning: ${this.runtime.formatError(appendError)}`);
    }
  }

  private findPendingBridgeProviderOperations(): string[] {
    if (!this.session) return [];
    const states = new Map<string, { requested: boolean; terminal: boolean }>();
    for (const event of this.session.readEvents()) {
      if (!event.type.startsWith('provider.')) continue;
      if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue;
      if (event.payload.boundary !== 'bridge-server') continue;
      const operationId = String(event.payload.operation_id || '').trim();
      if (!operationId) continue;
      const state = states.get(operationId) ?? { requested: false, terminal: false };
      if (event.type === 'provider.requested') state.requested = true;
      if (event.type === 'provider.completed' || event.type === 'provider.failed') state.terminal = true;
      states.set(operationId, state);
    }
    return [...states.entries()]
      .filter(([, state]) => state.requested && !state.terminal)
      .map(([operationId]) => operationId);
  }
}
