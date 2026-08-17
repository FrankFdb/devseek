import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CODING_PROVIDER_EVENT_VERSION,
  CODING_TOOL_DISPATCH_VERSION,
  CODING_TOOL_SCHEMA_VERSION,
  CanonicalProviderEventService,
  CanonicalToolDispatchService,
  CanonicalToolSchemaRegistry,
  getCodingToolDescriptor,
  isFileWriteToolName,
  listCodingToolNames,
  normalizeCodingToolInput,
  normalizeCodingToolName,
} from '../dist/index.js';

function comparableCall(call) {
  return {
    name: call.name,
    input: call.input,
    registered: call.registered,
    kind: call.kind,
    risk: call.risk,
    purpose: call.purpose,
    effects: call.effects,
    executable: call.executable,
  };
}

test('CanonicalToolSchemaRegistry owns canonical names, descriptors, and model visibility', () => {
  const schemas = new CanonicalToolSchemaRegistry();

  assert.equal(normalizeCodingToolName('search_content'), 'grep_search');
  assert.equal(normalizeCodingToolName('search_replace'), 'replace_in_file');
  assert.equal(getCodingToolDescriptor('create_file').version, CODING_TOOL_SCHEMA_VERSION);
  assert.equal(getCodingToolDescriptor('create_file').mutatesWorkspace, true);
  assert.equal(Object.isFrozen(getCodingToolDescriptor('create_file').schema.properties.path), true);
  assert.equal(getCodingToolDescriptor('run_terminal').requiresTerminal, true);
  assert.equal(getCodingToolDescriptor('run_terminal').completionImpact, 'required');
  assert.equal(getCodingToolDescriptor('memory_write').completionImpact, 'advisory');
  assert.deepEqual(getCodingToolDescriptor('memory_write').effects, ['local-state']);
  assert.equal(getCodingToolDescriptor('mcp__repo__search').kind, 'mcp');
  assert.equal(isFileWriteToolName('search_replace'), true);
  assert.equal(isFileWriteToolName('run_terminal'), false);
  assert.equal(listCodingToolNames(true).includes('search_content'), true);
  assert.equal(schemas.listNames().includes('apply_workspace_artifacts'), false);
  assert.equal(schemas.listNames({ includeInternal: true }).includes('apply_workspace_artifacts'), true);
});

test('CanonicalToolSchemaRegistry normalizes provider aliases without mutating provider input', () => {
  const providerInput = {
    filePath: '/workspace/src/main.cpp',
    fileContent: 'int main() {}',
  };
  const normalizedWrite = normalizeCodingToolInput('write_file', providerInput);
  const normalizedRead = normalizeCodingToolInput('read_file', {
    filePath: '/workspace/src/main.cpp',
    offset: 0,
    limit: 150,
  });
  const normalizedSearch = normalizeCodingToolInput('search_content', {
    query: 'main',
    directory: '/workspace/src',
    fileTypes: '.cpp,.h',
  });

  assert.deepEqual(providerInput, {
    filePath: '/workspace/src/main.cpp',
    fileContent: 'int main() {}',
  });
  assert.equal(normalizedWrite.path, '/workspace/src/main.cpp');
  assert.equal(normalizedWrite.content, 'int main() {}');
  assert.deepEqual(
    { path: normalizedRead.path, startLine: normalizedRead.startLine, endLine: normalizedRead.endLine },
    { path: '/workspace/src/main.cpp', startLine: 1, endLine: 150 },
  );
  assert.deepEqual(
    {
      pattern: normalizedSearch.pattern,
      path: normalizedSearch.path,
      includePattern: normalizedSearch.includePattern,
    },
    { pattern: 'main', path: '/workspace/src', includePattern: '.cpp,.h' },
  );
  assert.equal(Object.isFrozen(normalizedWrite), true);
});

test('CanonicalToolDispatchService gives fake and native calls the same executable contract', () => {
  const dispatch = new CanonicalToolDispatchService();
  const fake = dispatch.dispatch({ name: 'read_file', input: { path: 'src/index.ts' } });
  const native = dispatch.dispatch({
    id: 'call-1',
    function: {
      name: 'read_file',
      arguments: JSON.stringify({ path: 'src/index.ts' }),
    },
  }, { source: 'native' });

  assert.equal(fake.version, CODING_TOOL_DISPATCH_VERSION);
  assert.equal(fake.decision, 'accepted');
  assert.equal(native.decision, 'accepted');
  assert.deepEqual(comparableCall(fake.call), comparableCall(native.call));
  assert.equal(Object.isFrozen(native.call), true);
  assert.equal(Object.isFrozen(native.call.input), true);
});

test('CanonicalToolDispatchService rejects malformed, partial, unknown, and incomplete calls before hosts', () => {
  const dispatch = new CanonicalToolDispatchService();
  const malformed = dispatch.dispatch({
    function: { name: 'write_file', arguments: '{"path":"src/app.ts",' },
  }, { source: 'native' });
  const partial = dispatch.dispatch({ function: { arguments: '{}' } }, { source: 'native' });
  const unknown = dispatch.dispatch({ name: 'unknown_magic', input: {} });
  const incomplete = dispatch.dispatch({ name: 'read_file', input: {} });
  const malformedShape = dispatch.dispatch({ name: 'get_errors', input: [] });
  const emptyFile = dispatch.dispatch({ name: 'write_file', input: { path: 'empty.txt', content: '' } });

  assert.equal(malformed.reason, 'malformed-tool-arguments');
  assert.equal(malformed.call.registered, true);
  assert.equal(malformed.call.executable, false);
  assert.deepEqual(malformed.result.evidence, []);
  assert.equal(partial.reason, 'partial-tool-call');
  assert.equal(unknown.reason, 'unknown-tool');
  assert.equal(incomplete.reason, 'invalid-tool-input');
  assert.deepEqual(incomplete.call.missingFields, ['path']);
  assert.equal(malformedShape.reason, 'malformed-tool-arguments');
  assert.equal(emptyFile.decision, 'accepted');
});

test('CanonicalToolDispatchService projects artifact paths and terminal effects conservatively', () => {
  const dispatch = new CanonicalToolDispatchService();
  const workspace = dispatch.dispatch({
    id: 'workspace-1',
    name: 'apply_workspace_artifacts',
    input: {
      workspaceRoot: '/workspace',
      proposal: {
        fileToolCalls: [{ filePath: 'src/new.ts', content: 'export {}' }],
        unifiedDiffs: [{ filePath: '/workspace/config/.env.local', hunks: [] }],
        terminalToolCalls: [],
        candidateCount: 2,
      },
    },
  }, { source: 'internal', workspaceRoot: '/workspace' });
  const unknownTerminal = dispatch.dispatch({
    name: 'run_terminal',
    input: { command: 'ruby custom_task.rb' },
  }, { source: 'surface', workspaceRoot: '/workspace' });
  const projectValidation = dispatch.dispatch({
    name: 'run_terminal',
    input: {
      command: 'cd /workspace && ./test.sh 2>&1 && cmake -S . -B build 2>&1 && cmake --build build -j2 2>&1',
    },
  }, { source: 'surface', workspaceRoot: '/workspace' });

  assert.equal(workspace.decision, 'accepted');
  assert.deepEqual(workspace.call.targetPaths, ['src/new.ts', '/workspace/config/.env.local']);
  assert.equal(workspace.call.protectedPath, true);
  assert.equal(unknownTerminal.decision, 'accepted');
  assert.equal(unknownTerminal.call.risk, 'high');
  assert.equal(unknownTerminal.call.purpose, 'external-effect');
  assert.deepEqual(unknownTerminal.call.effects, ['process', 'workspace-mutation']);
  assert.equal(projectValidation.call.risk, 'medium');
  assert.equal(projectValidation.call.purpose, 'verify');
  assert.deepEqual(projectValidation.call.effects, ['process']);
});

test('CanonicalProviderEventService validates and snapshots provider output', () => {
  const providerEvents = new CanonicalProviderEventService();
  const rawCall = { name: 'read_file', input: { path: 'src/index.ts' } };
  const event = providerEvents.accept({
    type: 'tool-call',
    provider: 'deepseek',
    workflowId: 'run-1',
    call: rawCall,
  });

  rawCall.input.path = 'src/mutated.ts';
  assert.equal(event.version, CODING_PROVIDER_EVENT_VERSION);
  assert.equal(event.type, 'tool-call');
  assert.equal(event.call.input.path, 'src/index.ts');
  assert.equal(Object.isFrozen(event), true);
  assert.throws(
    () => providerEvents.accept({
      type: 'usage',
      provider: 'deepseek',
      usage: { promptTokens: 4, completionTokens: 3, totalTokens: 6 },
    }),
    /inconsistent-token-total/,
  );
  assert.throws(
    () => providerEvents.accept({ type: 'tool-call', provider: 'deepseek', call: null }),
    /invalid-tool-call/,
  );
  assert.throws(
    () => providerEvents.accept({
      type: 'error',
      provider: 'deepseek',
      message: 'retry later',
      recoverable: 'false',
    }),
    /invalid-recoverable/,
  );
});
