function normalizeScopePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function normalizeScopePaths(paths: readonly string[] | undefined): string[] {
  return [...new Set((paths ?? []).map(normalizeScopePath).filter(Boolean))].sort();
}

/**
 * Owns the correlation between verification operations and the workspace files
 * they actually covered. Recovery code can then require a real scope superset
 * instead of inferring ownership from display text or operation-id formatting.
 */
export class VerificationScopeRegistry {
  private readonly pathsByOperationId = new Map<string, readonly string[]>();

  record(operationId: string, paths: readonly string[] | undefined): readonly string[] {
    const normalized = normalizeScopePaths(paths);
    if (normalized.length > 0) this.pathsByOperationId.set(operationId, normalized);
    return normalized;
  }

  has(operationId: string): boolean {
    return this.pathsByOperationId.has(operationId);
  }

  pathsFor(operationId: string): readonly string[] {
    return this.pathsByOperationId.get(operationId) ?? [];
  }

  supersedes(candidateOperationId: string, adverseOperationIds: readonly string[]): boolean {
    const candidatePaths = this.pathsByOperationId.get(candidateOperationId);
    if (!candidatePaths || candidatePaths.length === 0 || adverseOperationIds.length === 0) return false;
    const candidateSet = new Set(candidatePaths);
    return adverseOperationIds.every(operationId => {
      const adversePaths = this.pathsByOperationId.get(operationId);
      return !!adversePaths
        && adversePaths.length > 0
        && adversePaths.every(scopePath => candidateSet.has(scopePath));
    });
  }
}
