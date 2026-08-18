export interface FakeTool {
  name: string;
  input: Record<string, unknown>;
}

export interface FakeToolJsonUtilsContext {
  normalizeToolName(name: string): string;
  jsonObjectToFakeTool(obj: Record<string, unknown>): FakeTool | null;
  normalizeFakeTool(tool: FakeTool): FakeTool;
}
