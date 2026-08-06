import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_COMMAND_VERSION,
  CLI_SURFACE_CAPABILITIES,
  HEADLESS_SURFACE_CAPABILITIES,
  JSONL_SURFACE_CAPABILITIES,
  SURFACE_ADAPTER_CONFORMANCE_VERSION,
  VSCODE_SURFACE_CAPABILITIES,
  CanonicalSurfaceAdapterConformanceService,
  createChatRequestCommand,
} from '../dist/index.js';

const platform = {
  os: 'linux',
  shell: 'posix',
  pathStyle: 'posix',
  lineEnding: 'lf',
  caseSensitive: true,
  workspaceKind: 'local',
};

const cases = [
  ['vscode', VSCODE_SURFACE_CAPABILITIES, { channel: 'webview', ordering: 'host-ordered', backpressure: 'host-managed' }],
  ['cli', CLI_SURFACE_CAPABILITIES, { channel: 'stdout', ordering: 'serialized', backpressure: 'awaited' }],
  ['jsonl', JSONL_SURFACE_CAPABILITIES, { channel: 'stdout', ordering: 'serialized', backpressure: 'awaited' }],
  ['headless', HEADLESS_SURFACE_CAPABILITIES, { channel: 'callback', ordering: 'serialized', backpressure: 'awaited' }],
];

function input(surface, capabilities, eventDelivery) {
  return {
    adapterId: `${surface}-adapter`,
    kind: surface,
    capabilities,
    platform,
    command: createChatRequestCommand({
      surface,
      capabilities,
      platform,
      prompt: 'verify adapter',
      commandId: `${surface}-command`,
      now: () => 42,
    }),
    eventDelivery,
  };
}

test('SurfaceAdapterConformancePort certifies all product Surface delivery contracts', () => {
  const service = new CanonicalSurfaceAdapterConformanceService();
  for (const [surface, capabilities, eventDelivery] of cases) {
    const receipt = service.certify(input(surface, capabilities, eventDelivery));
    assert.equal(receipt.version, SURFACE_ADAPTER_CONFORMANCE_VERSION, surface);
    assert.equal(receipt.surface, surface);
    assert.equal(receipt.commandVersion, AGENT_COMMAND_VERSION);
    assert.deepEqual(receipt.eventDelivery, eventDelivery);
    assert.equal(receipt.checks.length, 5);
    assert.equal(Object.isFrozen(receipt), true);
    assert.equal(Object.isFrozen(receipt.capabilities), true);
    assert.equal(Object.isFrozen(receipt.eventDelivery), true);
  }
});

test('SurfaceAdapterConformancePort fails closed on command, profile, and delivery drift', () => {
  const service = new CanonicalSurfaceAdapterConformanceService();
  const canonical = input('cli', CLI_SURFACE_CAPABILITIES, {
    channel: 'stdout',
    ordering: 'serialized',
    backpressure: 'awaited',
  });

  assert.throws(
    () => service.certify({ ...canonical, kind: 'headless' }),
    /surface-adapter-conformance:command-surface-mismatch/u,
  );
  assert.throws(
    () => service.certify({
      ...canonical,
      capabilities: { ...CLI_SURFACE_CAPABILITIES, supportsJsonl: true },
    }),
    /surface-adapter-conformance:command-capabilities-mismatch/u,
  );
  assert.throws(
    () => service.certify({ ...canonical, platform: { ...platform, workspaceKind: 'container' } }),
    /surface-adapter-conformance:command-platform-mismatch/u,
  );
  assert.throws(
    () => service.certify({
      ...canonical,
      eventDelivery: { channel: 'stdout', ordering: 'host-ordered', backpressure: 'awaited' },
    }),
    /surface-adapter-conformance:event-delivery-mismatch/u,
  );
  assert.throws(
    () => service.certify({ ...canonical, command: { ...canonical.command, version: 'legacy' } }),
    /surface-adapter-conformance:non-canonical-command-version/u,
  );
});
