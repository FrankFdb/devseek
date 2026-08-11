import {
  getCodingToolDescriptor,
  normalizeCodingToolInput,
  normalizeCodingToolName,
} from '@devseek-netai/shared';
import type { FakeTool } from './fake-tool-json-utils';

const FILE_WRITE_TOOL_NAMES = new Set(['create_file', 'write_file', 'replace_file']);

function decodeSchemaStructuredStrings(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...input };
  const descriptor = getCodingToolDescriptor(toolName);
  for (const [key, property] of Object.entries(descriptor?.schema.properties ?? {})) {
    const value = normalized[key];
    if (typeof value !== 'string' || (property.type !== 'array' && property.type !== 'object')) continue;
    try {
      const decoded = JSON.parse(value) as unknown;
      if ((property.type === 'array' && Array.isArray(decoded))
        || (property.type === 'object' && decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded))) {
        normalized[key] = decoded;
      }
    } catch { /* Keep non-JSON model text for canonical schema validation. */ }
  }
  return normalized;
}

function unwrapNestedFileWriteContent(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!FILE_WRITE_TOOL_NAMES.has(toolName) || typeof input.content !== 'string') return input;
  const match = /^\s*<\s*(content|contents|text|body|fileContent|file_content|source|code|newContent|new_content)\b[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/\s*\1\s*>\s*$/i.exec(input.content);
  return match ? { ...input, content: match[2] } : input;
}

export function normalizeToolInput(
  toolName: string,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const name = normalizeCodingToolName(toolName);
  const normalized = normalizeCodingToolInput(name, input);
  return unwrapNestedFileWriteContent(name, decodeSchemaStructuredStrings(name, normalized));
}

export function normalizeFakeTool(tool: FakeTool): FakeTool {
  const name = normalizeCodingToolName(tool.name);
  return { name, input: normalizeToolInput(name, tool.input) };
}
