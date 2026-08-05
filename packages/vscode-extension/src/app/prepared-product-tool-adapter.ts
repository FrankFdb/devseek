import type {
  CodingToolAuthorityReceipt,
  CodingToolHostResult,
} from '@devseek-netai/shared';
import type { AgentPreparedToolExecution } from '../agent/loop-types';
import {
  ProductMutationDeniedError,
  ProductMutationIndeterminateError,
  type PreparedProductMutation,
} from './product-mutation-coordinator';

export function adaptPreparedProductTool<T>(input: {
  prepared: PreparedProductMutation<T>;
  authorityRef: string;
  completedEvidenceRef: string;
  formatResult: (value: T) => string;
}): AgentPreparedToolExecution<string> {
  return {
    authority: projectProductToolAuthority(input.prepared, input.authorityRef),
    execute: async () => executePreparedProductTool(input),
  };
}

function projectProductToolAuthority<T>(
  prepared: PreparedProductMutation<T>,
  authorityRef: string,
): CodingToolAuthorityReceipt {
  const { authorization } = prepared;
  const userConfirmed = authorization.source === 'user-confirmed';
  return {
    decision: authorization.allowed
      ? userConfirmed ? 'require-confirmation' : 'allow'
      : 'deny',
    status: authorization.allowed ? 'authorized' : 'denied',
    reason: authorization.reason ?? (authorization.allowed
      ? 'product-tool-authorized'
      : 'product-tool-denied'),
    ...(authorization.allowed && userConfirmed ? {
      confirmationRef: `${authorityRef}:confirmed`,
    } : {}),
    evidenceRefs: [`${authorityRef}:${authorization.allowed ? 'authorized' : 'denied'}`],
  };
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
