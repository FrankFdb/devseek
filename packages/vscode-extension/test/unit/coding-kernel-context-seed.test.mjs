import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/coding-kernel-context-seed.bundle.cjs');
execSync(
  `npx esbuild src/app/coding-kernel-context-seed.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
const { projectVsCodeCodingContextSeed } = createRequire(import.meta.url)(bundlePath);

function semanticContract(projectInstructions) {
  return { context: { projectInstructions } };
}

test('VS Code coding context seed preserves structured scoped instruction sources', () => {
  const seed = projectVsCodeCodingContextSeed(['src/value.ts'], semanticContract({
    content: 'merged',
    sources: [{
      sourceId: 'source:agents',
      kind: 'codex-override',
      relPath: 'AGENTS.override.md',
      content: 'Use focused tests.',
      priority: 11,
      depth: 0,
    }],
  }));

  assert.deepEqual(seed.files, [{ path: 'src/value.ts' }]);
  assert.deepEqual(seed.instructions, [{
    sourceId: 'source:agents',
    kind: 'agents-override',
    locator: 'AGENTS.override.md',
    content: 'Use focused tests.',
    scopeDepth: 0,
    sourcePriority: 11,
  }]);
});

test('VS Code coding context seed retains legacy merged instruction bindings', () => {
  const seed = projectVsCodeCodingContextSeed([], semanticContract({
    content: '[source: AGENTS.md]\nUse focused tests.',
    sources: [{ kind: 'codex', relPath: 'AGENTS.md', priority: 10, depth: 0 }],
  }));

  assert.equal(seed.instructions.length, 1);
  assert.equal(seed.instructions[0].kind, 'other');
  assert.equal(seed.instructions[0].locator, 'semantic-contract:project-instructions');
});
