import {
  CanonicalToolExecutor,
  buildCodingToolAction,
  type BuildCodingToolActionInput,
  type CodingToolAuthoritySessionPort,
  type CodingToolExecutionOutcome,
  type CodingToolPurpose,
  type CodingToolRisk,
  type CodingToolSurfaceConstraint,
  type ToolExecutionHostPort,
  type ToolExecutorPort,
} from '@devseek-netai/shared';

export interface HeadlessToolExecutionInput<TInput, TResult> {
  readonly action: Omit<BuildCodingToolActionInput<TInput>, 'authority' | 'purpose'>;
  readonly authority: CodingToolAuthoritySessionPort;
  readonly purpose: CodingToolPurpose;
  readonly risk?: CodingToolRisk;
  readonly protectedPath?: boolean;
  readonly targetPaths?: readonly string[];
  readonly surfaceConstraint?: CodingToolSurfaceConstraint;
  readonly host: ToolExecutionHostPort<TInput, TResult>;
}

/** Programmatic Surface composition for caller-supplied host capabilities. */
export class HeadlessToolExecutionAdapter {
  constructor(private readonly executor: ToolExecutorPort = new CanonicalToolExecutor()) {}

  execute<TInput, TResult>(
    input: HeadlessToolExecutionInput<TInput, TResult>,
  ): Promise<CodingToolExecutionOutcome<TResult>> {
    const authorization = input.authority.authorize({
      actionId: input.action.actionId,
      tool: input.action.tool,
      purpose: input.purpose,
      effects: input.action.effects,
      input: input.action.input,
      risk: input.risk,
      protectedPath: input.protectedPath,
      targetPaths: input.targetPaths,
      surfaceConstraint: input.surfaceConstraint,
    });
    return this.executor.execute(buildCodingToolAction({
      ...input.action,
      purpose: input.purpose,
      authority: authorization.receipt,
    }), input.host, input.authority);
  }
}
