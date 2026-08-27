export interface PendingProviderShortIntent {
  line: number;
  evidence: string;
}

export type RecoverableProviderReplayIssueKind =
  | 'empty-provider-response'
  | 'malformed-tool-block'
  | 'provider-truncated-response'
  | 'provider-incomplete-answer'
  | 'provider-authored-tool-result';

export interface PendingProviderIntegrityFailure {
  kind: RecoverableProviderReplayIssueKind;
  severity: 'warn' | 'error';
  line: number;
  message: string;
  evidence?: string;
}

export interface PendingTerminalFailure {
  line: number;
  exitCode: number;
  evidence: string;
  commandIdentity?: string;
  outputSha?: string;
  output?: string;
}

/**
 * Owns recoverable run evidence until a later host-owned event settles it.
 * Intermediate repair failures remain auditable without becoming final errors.
 */
export class RunRecoverySettlement {
  private readonly providerShortIntents: PendingProviderShortIntent[] = [];
  private readonly providerIntegrityFailures: PendingProviderIntegrityFailure[] = [];
  private terminalFailures: PendingTerminalFailure[] = [];
  private readonly terminalOutputBySha = new Map<string, string>();

  recordProviderShortIntent(intent: PendingProviderShortIntent): void {
    this.providerShortIntents.push(intent);
  }

  settleLatestProviderShortIntent(): void {
    this.providerShortIntents.pop();
  }

  unresolvedProviderShortIntents(): readonly PendingProviderShortIntent[] {
    return this.providerShortIntents;
  }

  recordProviderIntegrityFailure(failure: PendingProviderIntegrityFailure): void {
    this.providerIntegrityFailures.push(failure);
  }

  settleLatestProviderIntegrityFailure(): void {
    this.providerIntegrityFailures.pop();
  }

  unresolvedProviderIntegrityFailures(): readonly PendingProviderIntegrityFailure[] {
    return this.providerIntegrityFailures;
  }

  recordTerminalFailure(failure: PendingTerminalFailure): void {
    const output = failure.outputSha
      ? this.terminalOutputBySha.get(failure.outputSha)
      : undefined;
    this.terminalFailures.push({ ...failure, output: failure.output ?? output });
  }

  recordTerminalSuccess(commandIdentity: string | undefined): void {
    if (!commandIdentity) return;
    this.terminalFailures = this.terminalFailures.filter(failure => (
      failure.commandIdentity !== commandIdentity
    ));
  }

  recordSuccessfulValidation(): void {
    this.terminalFailures = [];
  }

  recordTerminalOutput(sha: string | undefined, output: string): void {
    if (!sha) return;
    this.terminalOutputBySha.set(sha, output);
    const unresolved = this.terminalFailures
      .slice()
      .reverse()
      .find(failure => !failure.output && failure.outputSha === sha);
    if (unresolved) unresolved.output = output;
  }

  unresolvedTerminalFailures(): readonly PendingTerminalFailure[] {
    return this.terminalFailures;
  }
}

export function terminalCommandIdentity(commandSha: string | undefined, workdir: string | undefined): string | undefined {
  const sha = commandSha?.trim();
  if (!sha) return undefined;
  return `${sha}\u0000${workdir?.trim() ?? ''}`;
}
