import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CanonicalMcpBoundaryService } from '../dist/index.js';

function prepareServer(session, overrides = {}) {
  return session.prepareServerLaunch({
    serverName: 'workspace-tools',
    command: '/usr/bin/node',
    args: ['server.mjs', '--token', 'argument-secret'],
    env: { MCP_TOKEN: 'environment-secret' },
    ...overrides,
  });
}

function allowLaunch(session, prepared) {
  return session.authorizeServerLaunch(prepared.request, {
    decision: 'allow',
    actor: 'user',
    reason: 'user-approved-visible-server-launch',
    evidenceRef: `test-launch-confirmation:${prepared.request.requestSha256}`,
  });
}

test('MCP configuration is not launch authority and receipts contain no raw arguments or secrets', () => {
  const session = new CanonicalMcpBoundaryService().bind({ workspaceRoot: '/workspace' });
  const prepared = prepareServer(session);

  assert.throws(
    () => session.verifyServerLaunch(prepared, {}),
    /server-launch-not-authorized/,
  );
  assert.throws(
    () => session.authorizeServerLaunch(prepared.request, {
      decision: 'allow',
      actor: 'host-policy',
      reason: 'configuration-exists',
      evidenceRef: 'implicit-policy',
    }),
    /server-launch-requires-user-approval/,
  );

  const receipt = allowLaunch(session, prepared);
  assert.equal(session.verifyServerLaunch(prepared, receipt).cwd, '/workspace');
  const authorityRecord = JSON.stringify({ request: prepared.request, receipt });
  assert.equal(authorityRecord.includes('argument-secret'), false);
  assert.equal(authorityRecord.includes('environment-secret'), false);
  assert.equal(authorityRecord.includes('MCP_TOKEN'), true);
});

test('MCP tool aliases fail closed on normalized collisions', () => {
  const session = new CanonicalMcpBoundaryService().bind({ workspaceRoot: '/workspace' });
  const prepared = prepareServer(session, { args: [] });
  const receipt = allowLaunch(session, prepared);

  assert.throws(
    () => session.registerTools({
      prepared,
      receipt,
      tools: [
        { name: 'read-file', inputSchema: { type: 'object' } },
        { name: 'read.file', inputSchema: { type: 'object' } },
      ],
    }),
    /duplicate-tool-alias:mcp__workspace_tools__read_file/,
  );
  assert.deepEqual(session.toolRefs(), []);
});

test('I23-CAL-01 user journey: session-approved read-only MCP stays low-friction while risky calls require user evidence', () => {
  const session = new CanonicalMcpBoundaryService().bind({ workspaceRoot: '/workspace' });
  const prepared = prepareServer(session, { args: [] });
  const launchReceipt = allowLaunch(session, prepared);
  const refs = session.registerTools({
    prepared,
    receipt: launchReceipt,
    tools: [
      {
        name: 'inspect',
        description: 'Read workspace metadata',
        inputSchema: { type: 'object' },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      {
        name: 'publish',
        inputSchema: { type: 'object' },
        annotations: { destructiveHint: true },
      },
    ],
  });
  assert.deepEqual(refs.map(ref => [ref.fakeName, ref.risk]), [
    ['mcp__workspace_tools__inspect', 'medium'],
    ['mcp__workspace_tools__publish', 'destructive'],
  ]);

  const mutableArgs = { path: 'README.md', nested: { limit: 2 } };
  const request = session.prepareToolCall(refs[0].fakeName, mutableArgs);
  mutableArgs.nested.limit = 99;
  assert.equal(request.requiresUserConfirmation, false);
  const callReceipt = session.authorizeToolCall(request, {
    decision: 'allow',
    actor: 'host-policy',
    reason: 'session-approved-read-only-mcp-tool-call',
    evidenceRef: `test-session-registration:${request.registrationSha256}`,
  });
  assert.deepEqual(session.verifyToolCall(request, callReceipt).arguments, {
    path: 'README.md',
    nested: { limit: 2 },
  });
  assert.equal(JSON.stringify({ request, callReceipt }).includes('README.md'), false);
  assert.throws(
    () => session.verifyToolCall(
      request,
      { ...callReceipt, requestSha256: '0'.repeat(64) },
    ),
    /tool-call-receipt-mismatch/,
  );
  assert.throws(
    () => session.verifyToolCall(request, callReceipt),
    /tool-call-effect-already-claimed/,
  );

  const riskyRequest = session.prepareToolCall(refs[1].fakeName, { channel: 'release' });
  assert.equal(riskyRequest.requiresUserConfirmation, true);
  assert.throws(
    () => session.authorizeToolCall(riskyRequest, {
      decision: 'allow',
      actor: 'host-policy',
      reason: 'autopilot-mode',
      evidenceRef: 'automatic',
    }),
    /tool-call-requires-user-approval/,
  );
  const riskyReceipt = session.authorizeToolCall(riskyRequest, {
    decision: 'allow',
    actor: 'user',
    reason: 'user-approved-visible-tool-call',
    evidenceRef: `test-call-confirmation:${riskyRequest.requestSha256}`,
  });
  assert.deepEqual(session.verifyToolCall(riskyRequest, riskyReceipt).arguments, {
    channel: 'release',
  });
});

test('denied MCP launch and call receipts remain terminal and unverifiable as authority', () => {
  const launchSession = new CanonicalMcpBoundaryService().bind({ workspaceRoot: '/workspace' });
  const deniedPrepared = prepareServer(launchSession);
  const deniedLaunch = launchSession.authorizeServerLaunch(deniedPrepared.request, {
    decision: 'deny',
    actor: 'user',
    reason: 'user-rejected-server',
  });
  assert.throws(
    () => launchSession.verifyServerLaunch(deniedPrepared, deniedLaunch),
    /server-launch-denied/,
  );

  const callSession = new CanonicalMcpBoundaryService().bind({ workspaceRoot: '/workspace' });
  const prepared = prepareServer(callSession, { args: [] });
  const launchReceipt = allowLaunch(callSession, prepared);
  const [tool] = callSession.registerTools({
    prepared,
    receipt: launchReceipt,
    tools: [{ name: 'inspect', inputSchema: { type: 'object' } }],
  });
  const request = callSession.prepareToolCall(tool.fakeName, {});
  const deniedCall = callSession.authorizeToolCall(request, {
    decision: 'deny',
    actor: 'user',
    reason: 'user-rejected-tool',
  });
  assert.throws(
    () => callSession.verifyToolCall(request, deniedCall),
    /tool-call-denied/,
  );
});

test('I23-BND-01 user journey: MCP configuration schemas and arguments obey resource bounds', () => {
  const session = new CanonicalMcpBoundaryService().bind({ workspaceRoot: '/workspace' });
  assert.throws(
    () => prepareServer(session, { env: { PAYLOAD: 'x'.repeat(1_048_576) } }),
    /server-configuration-too-large/,
  );

  const prepared = prepareServer(session, { args: [], env: {} });
  const launchReceipt = allowLaunch(session, prepared);
  assert.throws(
    () => session.registerTools({
      prepared,
      receipt: launchReceipt,
      tools: [{
        name: 'oversized',
        inputSchema: { type: 'object', description: 'x'.repeat(262_144) },
      }],
    }),
    /tool-input-schema-too-large/,
  );

  let deepSchema = { type: 'string' };
  for (let depth = 0; depth < 34; depth += 1) deepSchema = { items: deepSchema };
  assert.throws(
    () => session.registerTools({
      prepared,
      receipt: launchReceipt,
      tools: [{ name: 'too-deep', inputSchema: deepSchema }],
    }),
    /tool-input-schema-too-deep/,
  );

  const [tool] = session.registerTools({
    prepared,
    receipt: launchReceipt,
    tools: [{ name: 'bounded', inputSchema: { type: 'object' } }],
  });
  assert.throws(
    () => session.prepareToolCall(tool.fakeName, { payload: 'x'.repeat(1_048_576) }),
    /tool-arguments-too-large/,
  );
});
