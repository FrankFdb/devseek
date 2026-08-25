import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const journeyRoot = path.join(repoRoot, 'code/devseek-tests/n4-cpp-visual-math-user');

test('N4 C++ visual math journey keeps four sequential natural-user coding rounds', () => {
  const journey = JSON.parse(fs.readFileSync(path.join(journeyRoot, 'journey.json'), 'utf8'));
  assert.equal(journey.schemaVersion, 'devseek.n4-simulated-user-journey/v1');
  assert.deepEqual(journey.rounds.map(round => round.verificationStage), [1, 2, 3, 4]);
  assert.equal(new Set(journey.rounds.map(round => round.id)).size, 4);
  assert.match(journey.rounds[0].prompt, /C\+\+17/u);
  assert.match(journey.rounds[1].prompt, /--script/u);
  assert.match(journey.rounds[2].prompt, /测验/u);
  assert.match(journey.rounds[3].prompt, /--smoke-frames/u);
});

test('N4 C++ visual math workspace starts nontrivial and protects the user contract', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-n4-cpp-contract-'));
  const workspace = path.join(tempRoot, 'workspace');
  try {
    const module = await import(pathToFileURL(path.join(journeyRoot, 'prepare-workspace.mjs')));
    module.prepareWorkspace(workspace);
    const before = hashPaths(workspace, module.protectedWorkspacePaths);

    assert.equal(fs.existsSync(path.join(workspace, 'src/main.cpp')), false);
    assert.match(fs.readFileSync(path.join(workspace, 'CMakeLists.txt'), 'utf8'), /find_package\(X11 REQUIRED\)/u);
    assert.match(fs.readFileSync(path.join(workspace, 'USER_STORY.md'), 'utf8'), /same raster renderer/iu);
    assert.match(fs.readFileSync(path.join(workspace, 'assets/quiz.actions'), 'utf8'), /answer 7[\s\S]*answer 5/u);
    assert.deepEqual(hashPaths(workspace, module.protectedWorkspacePaths), before);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('N4 C++ visual math journey and verifier scripts parse', () => {
  for (const script of ['prepare-workspace.mjs', 'verify-workspace.mjs', 'run-journey.mjs']) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(journeyRoot, script)], {
      cwd: repoRoot,
      stdio: 'pipe',
    }));
  }
  const runner = fs.readFileSync(path.join(journeyRoot, 'run-journey.mjs'), 'utf8');
  assert.match(runner, /--wait-background-idle/u);
  assert.match(runner, /inputMode = .*natural-ui/u);
});

test('N4 C++ visual math verifier measures binary PPM pixels instead of file existence', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-n4-cpp-pixels-'));
  try {
    const verifier = await import(pathToFileURL(path.join(journeyRoot, 'verify-workspace.mjs')));
    const width = 640;
    const height = 480;
    const pixels = Buffer.alloc(width * height * 3);
    const palette = [
      [245, 247, 250], [31, 41, 55], [37, 99, 235], [5, 150, 105],
      [220, 38, 38], [234, 179, 8], [124, 58, 237], [8, 145, 178],
    ];
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const color = palette[Math.floor(pixel / (width * 12)) % palette.length];
      pixels.set(color, pixel * 3);
    }
    const ppmPath = path.join(tempRoot, 'visual.ppm');
    fs.writeFileSync(ppmPath, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));

    const stats = verifier.readPpmStats(ppmPath);
    assert.equal(stats.width, width);
    assert.equal(stats.height, height);
    assert.equal(stats.uniqueSampledColors, palette.length);
    assert.equal(verifier.ppmLooksGraphical(stats), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

function hashPaths(root, paths) {
  return Object.fromEntries(paths.map(rel => [
    rel,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(root, rel))).digest('hex'),
  ]));
}
