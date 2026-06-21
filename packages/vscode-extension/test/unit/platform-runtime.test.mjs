/**
 * Contract tests for ARCH-05 Phase 10 PlatformRuntimeAdapter and SurfaceAdapter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bundle(entry, name) {
  const out = path.join(rootDir, `test/unit/${name}.bundle.cjs`);
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${out} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
  return createRequire(import.meta.url)(out);
}

const runtime = bundle('../shared/src/platform-runtime.ts', 'platform-runtime');
const surface = bundle('../shared/src/surface-adapter.ts', 'surface-adapter');

test('PlatformRuntimeAdapter detects Linux POSIX shell and path behavior', () => {
  const profile = runtime.detectPlatformProfile({
    platform: 'linux',
    shellPath: '/bin/bash',
    env: {},
  });
  const adapter = runtime.createPlatformRuntimeAdapter(profile);

  assert.equal(profile.os, 'linux');
  assert.equal(profile.shell, 'posix');
  assert.equal(profile.pathStyle, 'posix');
  assert.equal(profile.lineEnding, 'lf');
  assert.equal(adapter.path.join('src', 'app', 'x.ts'), 'src/app/x.ts');
  assert.equal(adapter.shell.buildCommand('printf', ["a'b"]), "printf 'a'\\''b'");
});

test('PlatformRuntimeAdapter detects Windows cmd and CRLF defaults', () => {
  const profile = runtime.detectPlatformProfile({
    platform: 'win32',
    shellPath: 'C:\\Windows\\System32\\cmd.exe',
    env: {},
  });
  const adapter = runtime.createPlatformRuntimeAdapter(profile);

  assert.equal(profile.os, 'win32');
  assert.equal(profile.shell, 'cmd');
  assert.equal(profile.pathStyle, 'windows');
  assert.equal(profile.lineEnding, 'crlf');
  assert.equal(profile.caseSensitive, false);
  assert.equal(adapter.path.join('src', 'app', 'x.ts'), 'src\\app\\x.ts');
});

test('PlatformRuntimeAdapter treats WSL workspace as POSIX path on Windows host', () => {
  const profile = runtime.detectPlatformProfile({
    platform: 'win32',
    shellPath: '/bin/bash',
    env: { WSL_DISTRO_NAME: 'Ubuntu' },
  });

  assert.equal(profile.workspaceKind, 'wsl');
  assert.equal(profile.pathStyle, 'posix');
  assert.equal(profile.shell, 'posix');
});

test('SurfaceAdapter creates chat command and reports capability gaps', () => {
  const command = surface.createChatRequestCommand({
    surface: 'jsonl',
    capabilities: surface.JSONL_SURFACE_CAPABILITIES,
    platform: runtime.detectPlatformProfile({ platform: 'linux', env: {} }),
    prompt: 'phase10',
  });
  const gaps = surface.summarizeSurfaceCapabilityGaps(surface.JSONL_SURFACE_CAPABILITIES, {
    supportsHunkReview: 'hunk-review',
    supportsInlineSelection: 'inline-selection',
    supportsTerminalEmbedding: 'terminal-embedding',
    supportsDiagnostics: 'diagnostics',
  });

  assert.equal(command.type, 'chat.request');
  assert.equal(command.surface, 'jsonl');
  assert.equal(command.request.prompt, 'phase10');
  assert.deepEqual(gaps, ['hunk-review', 'inline-selection', 'terminal-embedding', 'diagnostics']);
});
