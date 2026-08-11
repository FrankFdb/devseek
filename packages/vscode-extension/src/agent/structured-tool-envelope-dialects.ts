import { createGenericToolEnvelopeDialect } from './generic-tool-envelope-dialect';
import { createToolUseEnvelopeDialect } from './tool-use-envelope-dialect';

export interface StructuredToolEnvelopeAdapter<TTool> {
  isRegisteredName(name: string): boolean;
  normalizeName(name: string): string;
  parseInput(name: string, value: unknown): Record<string, unknown> | null;
  createTool(name: string, input: Record<string, unknown>): TTool;
}

export function createStructuredToolEnvelopeDialects<TTool>(
  adapter: StructuredToolEnvelopeAdapter<TTool>,
) {
  const generic = createGenericToolEnvelopeDialect<TTool>({
    isRegisteredName: adapter.isRegisteredName,
    normalizeName: adapter.normalizeName,
    parseCompatibleInput: (name, rawInput) => adapter.parseInput(name, rawInput),
    createTool: adapter.createTool,
  });
  const toolUse = createToolUseEnvelopeDialect<TTool>(adapter);
  const dialects = [toolUse, generic] as const;
  return {
    dialects,
    parseGenericBody: generic.parseBody,
    hasIncomplete: (text: string) => dialects.some(dialect => dialect.hasIncomplete(text)),
  };
}
