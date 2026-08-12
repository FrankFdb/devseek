import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-mcp-runtime-'));
const bundlePath = path.join(bundleRoot, 'runtime.cjs');
execFileSync('npx', [
  'esbuild',
  'src/mcp/vscode-mcp-runtime.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--external:vscode',
  `--outfile=${bundlePath}`,
], { cwd: packageRoot, stdio: 'pipe' });

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return { workspace: {}, window: {} };
  return originalLoad.call(this, request, parent, isMain);
};
const { createVscodeMcpManager, initializeWorkspaceMcp } = createRequire(import.meta.url)(bundlePath);
Module._load = originalLoad;
process.on('exit', () => rmSync(bundleRoot, { recursive: true, force: true }));

test('VS Code MCP launch presentation exposes safe identity and denial cannot connect', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-mcp-workspace-'));
  const configPath = path.join(workspaceRoot, 'mcp.json');
  writeFileSync(configPath, JSON.stringify({
    mcpServers: {
      workspaceTools: {
        command: '/usr/bin/node',
        args: ['--token=argument-secret'],
        env: { API_TOKEN: 'environment-secret' },
      },
    },
  }));
  const confirmations = [];
  const manager = createVscodeMcpManager({
    workspaceRoot: () => workspaceRoot,
    confirmLaunch: async (message, action) => {
      confirmations.push({ message, action });
      return false;
    },
    warn: () => {},
  });

  try {
    const report = await manager.load(configPath, workspaceRoot);
    assert.deepEqual(report.deniedServers, ['workspaceTools']);
    assert.deepEqual(report.connectedServers, []);
    assert.equal(confirmations.length, 1);
    assert.match(confirmations[0].message, /workspaceTools/);
    assert.match(confirmations[0].message, /API_TOKEN/);
    assert.equal(confirmations[0].message.includes('argument-secret'), false);
    assert.equal(confirmations[0].message.includes('environment-secret'), false);
  } finally {
    await manager.dispose();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('VS Code MCP startup reports bounded categorical failures through its Surface owner', async () => {
  const warnings = [];
  const loads = [];
  const report = await initializeWorkspaceMcp({
    load: async (configPath, workspaceRoot) => {
      loads.push({ configPath, workspaceRoot });
      return {
        configStatus: 'invalid',
        configuredServers: 1,
        connectedServers: [],
        deniedServers: [],
        registeredTools: 0,
        failures: [
          { serverName: 'unsafe', stage: 'config-validation', code: 'server-configuration-too-large' },
        ],
      };
    },
  }, {
    workspaceRoot: () => '/workspace',
    confirmLaunch: async () => false,
    warn: message => warnings.push(message),
  });

  assert.equal(report.configStatus, 'invalid');
  assert.deepEqual(loads, [{
    configPath: path.join('/workspace', '.devseek', 'mcp.json'),
    workspaceRoot: '/workspace',
  }]);
  assert.deepEqual(warnings, [
    'DevSeek MCP 初始化未完全成功：unsafe:config-validation:server-configuration-too-large',
  ]);
});

test('VS Code MCP startup stays quiet when the optional workspace config is absent', async () => {
  const warnings = [];
  const loads = [];
  const report = await initializeWorkspaceMcp({
    load: async (configPath, workspaceRoot) => {
      loads.push({ configPath, workspaceRoot });
      return {
        configStatus: 'absent',
        configuredServers: 0,
        connectedServers: [],
        deniedServers: [],
        registeredTools: 0,
        failures: [],
      };
    },
  }, {
    workspaceRoot: () => '/workspace',
    confirmLaunch: async () => false,
    warn: message => warnings.push(message),
  });

  assert.equal(report.configStatus, 'absent');
  assert.deepEqual(loads, [{
    configPath: path.join('/workspace', '.devseek', 'mcp.json'),
    workspaceRoot: '/workspace',
  }]);
  assert.deepEqual(warnings, []);
});

test('VS Code MCP startup contains unexpected runtime rejection at the Surface boundary', async () => {
  const warnings = [];
  const report = await initializeWorkspaceMcp({
    load: async () => {
      throw new Error('sensitive provider startup detail');
    },
  }, {
    workspaceRoot: () => '/workspace',
    confirmLaunch: async () => false,
    warn: message => warnings.push(message),
  });

  assert.equal(report, undefined);
  assert.deepEqual(warnings, ['DevSeek MCP 初始化失败：unexpected-runtime-failure']);
});
