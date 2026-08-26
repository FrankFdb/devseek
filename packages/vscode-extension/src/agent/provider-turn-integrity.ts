import {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
  isProviderOutputFatal,
  type ProviderOutputObservation,
} from './provider-output-integrity';

export function assertProviderTurnIntegrity(
  text: string,
  observation: ProviderOutputObservation = {},
): void {
  const output = classifyProviderOutputIntegrity(text, observation);
  if (!isProviderOutputFatal(output.kind)) return;
  throw new Error(`RESPONSE_CORRUPTED:${output.kind}:${describeProviderOutputIntegrity(output.kind)}`);
}
