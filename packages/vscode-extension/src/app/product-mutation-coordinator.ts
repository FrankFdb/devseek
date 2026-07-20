import * as crypto from 'crypto';
import {
  PRODUCT_RUNTIME_OBSERVATION_TRUST,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type RunEvidenceJson,
} from '@devseek-netai/shared';
import type { DevSeekRunContext } from './run-context';

export interface ProductMutationAuthorizationDecision {
  allowed: boolean;
  source: 'explicit-user-action' | 'user-confirmed' | 'execution-policy';
  reason?: string;
}

export interface ProductMutationRequest<T> {
  kind: 'workspace-directory' | 'vscode-command' | 'pending-edit-undo' | 'pending-edit-resolution' | 'mcp-tool';
  label: string;
  authorize: () => ProductMutationAuthorizationDecision | Promise<ProductMutationAuthorizationDecision>;
  invoke: () => T | Promise<T>;
  /**
   * Must be selected before dispatch. A postcondition proves resulting state; a
   * receipt proves only that the product/tool call resolved successfully.
   * Requests with neither are rejected before `invoke`.
   */
  completionEvidence?: ProductMutationCompletionEvidence<T>;
}

export type ProductMutationCompletionEvidence<T> =
  | {
    kind: 'verified-postcondition';
    verify: (value: T) => boolean | Promise<boolean>;
    proof?: (value: T) => RunEvidenceJson;
  }
  | {
    kind: 'invocation-receipt';
    proof: (value: T) => RunEvidenceJson;
  };

export class ProductMutationDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductMutationDeniedError';
  }
}

export class ProductMutationIndeterminateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductMutationIndeterminateError';
  }
}

/** Sole authority for mutations not already owned by the workspace writer or terminal coordinator. */
export class ProductMutationCoordinator {
  private readonly session: Pick<ProductRunEvidenceSession, 'record'>;

  constructor(
    private readonly runContext: DevSeekRunContext,
    readonly boundary: string,
    evidenceSession?: Pick<ProductRunEvidenceSession, 'record'>,
  ) {
    if (evidenceSession) {
      this.session = evidenceSession;
      return;
    }
    try {
      this.session = ProductRunEvidenceSession.forWorkspace({
        workspaceRoot: runContext.workspaceRoot,
        runId: runContext.runId,
        surface: 'vscode-product-mutation',
        authority: { role: 'participant', token: runContext.evidenceParticipantToken },
      });
    } catch (error) {
      runContext.markEvidenceDegraded(error);
      throw new ProductMutationDeniedError('Mutation evidence authority is unavailable');
    }
  }

  async run<T>(request: ProductMutationRequest<T>): Promise<T> {
    const operationId = `vscode-product-mutation-${crypto.randomUUID()}`;
    const observation = summarizeTraceText(`${request.kind}\n${request.label}`);
    this.recordBeforeMutation('side_effect.requested', operationId, 'requested', observation, {
      mutation_kind: request.kind,
    });
    if (!request.completionEvidence) {
      this.recordBeforeMutation('side_effect.failed', operationId, 'failed', observation, {
        failure_phase: 'preflight',
        reason: 'mutation has neither an independent postcondition nor an accepted invocation receipt',
      });
      throw new ProductMutationDeniedError(
        `${request.label} was blocked before dispatch because no safe completion evidence is available`,
      );
    }

    let authorization: ProductMutationAuthorizationDecision;
    try {
      authorization = await request.authorize();
    } catch (error) {
      this.recordBeforeMutation('side_effect.failed', operationId, 'failed', observation, {
        failure_phase: 'authorization',
        reason: summarizeTraceText(error instanceof Error ? error.message : String(error)),
      });
      throw error;
    }
    if (!authorization.allowed) {
      this.recordBeforeMutation('side_effect.failed', operationId, 'failed', observation, {
        failure_phase: 'authorization',
        reason: summarizeTraceText(authorization.reason ?? 'mutation authorization denied'),
      });
      throw new ProductMutationDeniedError(authorization.reason ?? 'Mutation authorization denied');
    }
    this.recordBeforeMutation('side_effect.authorized', operationId, 'authorized', observation, {
      authorization: authorization.source,
    });
    this.recordBeforeMutation('side_effect.started', operationId, 'started', observation);

    let value: T;
    try {
      value = await request.invoke();
    } catch (error) {
      this.recordAfterMutation('side_effect.indeterminate', operationId, 'indeterminate', observation, {
        failure_phase: 'invocation',
        reason: summarizeTraceText(error instanceof Error ? error.message : String(error)),
      });
      throw error;
    }

    let proof: RunEvidenceJson;
    if (request.completionEvidence.kind === 'verified-postcondition') {
      let verified = false;
      try {
        verified = await request.completionEvidence.verify(value);
      } catch (error) {
        this.recordAfterMutation('side_effect.indeterminate', operationId, 'indeterminate', observation, {
          failure_phase: 'postcondition',
          reason: summarizeTraceText(error instanceof Error ? error.message : String(error)),
        });
        throw error;
      }
      if (!verified) {
        this.recordAfterMutation('side_effect.indeterminate', operationId, 'indeterminate', observation, {
          failure_phase: 'postcondition',
          reason: 'independent mutation postcondition is false',
        });
        throw new ProductMutationIndeterminateError(
          `${request.label} returned, but its mutation result could not be independently verified`,
        );
      }
      proof = {
        scope: 'verified-postcondition',
        external_effect_verified: true,
        evidence: request.completionEvidence.proof?.(value) ?? { kind: 'postcondition-verified' },
      };
    } else {
      try {
        proof = {
          scope: 'invocation-receipt',
          external_effect_verified: false,
          receipt: request.completionEvidence.proof(value),
        };
      } catch (error) {
        this.recordAfterMutation('side_effect.indeterminate', operationId, 'indeterminate', observation, {
          failure_phase: 'receipt',
          reason: summarizeTraceText(error instanceof Error ? error.message : String(error)),
        });
        throw error;
      }
    }
    this.recordAfterMutation('side_effect.committed', operationId, 'committed', observation, { proof });
    return value;
  }

  private recordBeforeMutation(
    type: 'side_effect.requested' | 'side_effect.authorized' | 'side_effect.started' | 'side_effect.failed',
    operationId: string,
    status: string,
    observation: { length: number; sha256: string },
    details: Record<string, RunEvidenceJson> = {},
  ): void {
    try {
      this.record(type, operationId, status, observation, details);
    } catch (error) {
      this.runContext.markEvidenceDegraded(error);
      throw new ProductMutationDeniedError('Mutation was blocked because evidence could not be durably appended');
    }
  }

  private recordAfterMutation(
    type: 'side_effect.committed' | 'side_effect.indeterminate',
    operationId: string,
    status: string,
    observation: { length: number; sha256: string },
    details: Record<string, RunEvidenceJson>,
  ): void {
    try {
      this.record(type, operationId, status, observation, details);
    } catch (error) {
      this.runContext.markEvidenceDegraded(error);
      if (type === 'side_effect.committed') {
        try {
          this.record('side_effect.indeterminate', operationId, 'indeterminate', observation, {
            failure_phase: 'terminal-evidence',
            reason: 'committed evidence could not be durably appended',
          });
        } catch (indeterminateError) {
          this.runContext.markEvidenceDegraded(indeterminateError);
        }
      }
      throw new ProductMutationIndeterminateError(
        'Mutation was invoked, but its terminal evidence could not be durably appended',
      );
    }
  }

  private record(
    type: Parameters<ProductRunEvidenceSession['record']>[0]['type'],
    operationId: string,
    status: string,
    observation: { length: number; sha256: string },
    details: Record<string, RunEvidenceJson>,
  ): void {
    this.session.record({
      type,
      idempotencyKey: productRunEvidenceIdempotencyKey(`vscode-product-mutation-${type}`, {
        runId: this.runContext.runId,
        operationId,
      }),
      payload: {
        operation_id: operationId,
        boundary: this.boundary,
        status,
        trust: PRODUCT_RUNTIME_OBSERVATION_TRUST,
        observation,
        ...details,
      },
    });
  }
}
