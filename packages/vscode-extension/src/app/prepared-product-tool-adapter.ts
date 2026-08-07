import type {
  CodingToolHostResult,
  CodingToolSurfaceConstraint,
} from '@devseek-netai/shared';
import type { AgentPreparedToolExecution } from '../agent/loop-types';
import {
  ProductMutationDeniedError,
  ProductMutationIndeterminateError,
  type PreparedProductMutation,
} from './product-mutation-coordinator';

export function adaptPreparedProductTool<T>(input: {
  prepared: PreparedProductMutation<T>;
  constraintRef: string;
  completedEvidenceRef: string;
  formatResult: (value: T) => string;
}): AgentPreparedToolExecution<string> {
  return {
    constraint: projectProductToolConstraint(input.prepared, input.constraintRef),
    reconciliationScope: 'process-local',
    reconcile: async () => {
      const reconciliation = await input.prepared.reconcile();
      return {
        status: reconciliation.status,
        ...(reconciliation.result === undefined ? {} : {
          result: input.formatResult(reconciliation.result),
        }),
        evidenceRefs: [`${input.constraintRef}:reconcile-${reconciliation.status}`],
      };
    },
    execute: async () => executePreparedProductTool(input),
  };
}

function projectProductToolConstraint<T>(
  prepared: PreparedProductMutation<T>,
  constraintRef: string,
): CodingToolSurfaceConstraint {
  const { authorization } = prepared;
  const userConfirmed = authorization.source === 'user-confirmed';
  const reason = authorization.reason ?? (authorization.allowed
    ? 'product-tool-authorized'
    : 'product-tool-denied');
  const evidenceRefs = [`${constraintRef}:${authorization.allowed ? 'allowed' : 'denied'}`];
  if (!authorization.allowed) return { decision: 'deny', reason, evidenceRefs };
  if (userConfirmed) {
    return {
      decision: 'require-confirmation',
      reason,
      confirmationRef: `${constraintRef}:confirmed`,
      evidenceRefs,
    };
  }
  return { decision: 'allow', reason, evidenceRefs };
}

async function executePreparedProductTool<T>(input: {
  prepared: PreparedProductMutation<T>;
  completedEvidenceRef: string;
  formatResult: (value: T) => string;
}): Promise<CodingToolHostResult<string>> {
  try {
    const value = await input.prepared.execute();
    return {
      status: 'completed',
      result: input.formatResult(value),
      evidenceRefs: [input.completedEvidenceRef],
    };
  } catch (error) {
    if (error instanceof ProductMutationDeniedError) {
      return {
        status: 'failed',
        errorCode: 'product-tool-dispatch-denied',
        evidenceRefs: [`${input.completedEvidenceRef}:denied`],
      };
    }
    return {
      status: 'indeterminate',
      errorCode: error instanceof ProductMutationIndeterminateError
        ? 'product-tool-evidence-indeterminate'
        : 'product-tool-host-indeterminate',
      evidenceRefs: [`${input.completedEvidenceRef}:indeterminate`],
    };
  }
}
