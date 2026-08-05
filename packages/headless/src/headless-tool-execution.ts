import {
  CanonicalToolExecutor,
  buildCodingToolAction,
  type BuildCodingToolActionInput,
  type CodingToolExecutionOutcome,
  type ToolExecutionHostPort,
  type ToolExecutorPort,
} from '@devseek-netai/shared';

export interface HeadlessToolExecutionInput<TInput, TResult> {
  readonly action: BuildCodingToolActionInput<TInput>;
  readonly host: ToolExecutionHostPort<TInput, TResult>;
}

/** Programmatic Surface composition for caller-supplied host capabilities. */
export class HeadlessToolExecutionAdapter {
  constructor(private readonly executor: ToolExecutorPort = new CanonicalToolExecutor()) {}

  execute<TInput, TResult>(
    input: HeadlessToolExecutionInput<TInput, TResult>,
  ): Promise<CodingToolExecutionOutcome<TResult>> {
    return this.executor.execute(buildCodingToolAction(input.action), input.host);
  }
}
