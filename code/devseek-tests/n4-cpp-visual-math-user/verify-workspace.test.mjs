import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findInteractionDispatcherCycles,
  inspectScriptRenderOwnership,
  ppmLooksGraphical,
  readPpmStats,
  verifyWorkspace,
} from './verify-workspace.mjs';

test('interaction call graph accepts helpers that delegate to domain mutations', () => {
  const source = `
bool LessonController::handleMouseClick(int x, int y) {
  return handleFractionClick(x, y, 100, 40) || handleNumberLineClick(x, y, 200, 40);
}
bool LessonController::handleFractionClick(int, int, int, int) {
  incrementSelected();
  return true;
}
bool LessonController::handleNumberLineClick(int, int, int, int) {
  incrementMarker();
  return true;
}
`;

  assert.deepEqual(findInteractionDispatcherCycles(source), []);
});

test('interaction call graph rejects a helper that re-enters its dispatcher', () => {
  const source = `
bool LessonController::handleMouseClick(int x, int y) {
  return handleFractionClick(x, y, 100, 40);
}
bool LessonController::handleFractionClick(int x, int y, int, int) {
  const char* ignored = "handleMouseClick(ignored) {";
  // handleMouseClick in a comment must not affect the call graph.
  return handleMouseClick(x, y);
}
bool LessonController::handleNumberLineClick(int, int, int, int) {
  return false;
}
`;

  assert.deepEqual(findInteractionDispatcherCycles(source), [
    'handleMouseClick -> handleFractionClick -> handleMouseClick',
  ]);
});

test('script rendering accepts delegation to the production controller', () => {
  const source = `
int runScript() {
  LessonController controller;
  RasterCanvas canvas;
  controller.render(canvas);
  return 0;
}
`;

  assert.deepEqual(inspectScriptRenderOwnership(source), {
    functionFound: true,
    delegatesToLessonController: true,
    directLessonRendererCalls: [],
  });
});

test('script rendering exposes direct lesson renderer bypasses', () => {
  const source = `
int runScript() {
  LessonController controller;
  RasterCanvas canvas;
  canvas.renderFraction(3, 4);
  canvas.renderNumberLine(6);
  return 0;
}
`;

  assert.deepEqual(inspectScriptRenderOwnership(source), {
    functionFound: true,
    delegatesToLessonController: false,
    directLessonRendererCalls: ['renderFraction', 'renderNumberLine'],
  });
});

test('PPM diagnostics expose the spatial distribution of visible pixels', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-ppm-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ppmPath = path.join(directory, 'sample.ppm');
  fs.writeFileSync(ppmPath, [
    'P3',
    '4 4',
    '255',
    ...Array.from({ length: 16 }, (_, pixel) => pixel === 14 ? '255 0 0' : '255 255 255'),
    '',
  ].join('\n'));

  const stats = readPpmStats(ppmPath);
  assert.deepEqual(stats.dominantSampledColor, { rgb: [255, 255, 255], count: 15, ratio: 0.9375 });
  assert.deepEqual(stats.nonDominantBounds, { minX: 2, minY: 3, maxX: 2, maxY: 3 });
  assert.deepEqual(stats.nonDominantQuadrants, {
    topLeft: 0,
    topRight: 0,
    bottomLeft: 0,
    bottomRight: 1,
  });
  assert.equal(stats.topHalfNonDominantSampledPixels, 0);
  assert.equal(stats.bottomHalfNonDominantSampledPixels, 1);
});

test('PPM acceptance rejects graphics confined to one vertical half', () => {
  const base = {
    width: 800,
    height: 600,
    uniqueSampledColors: 10,
    nonDominantRatio: 0.2,
    topHalfNonDominantSampledPixels: 20,
    bottomHalfNonDominantSampledPixels: 20,
  };

  assert.equal(ppmLooksGraphical(base), true);
  assert.equal(ppmLooksGraphical({
    ...base,
    topHalfNonDominantSampledPixels: 0,
  }), false);
});

test('targeted verification runs only the requested independent check', t => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-targeted-verification-'));
  const evidence = path.join(workspace, 'evidence');
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  fs.writeFileSync(path.join(workspace, 'README.md'), [
    '# Math Visual Lab',
    'Build with CMake.',
    'Use the keyboard or mouse.',
    'Run --smoke-frames 3 for X11 acceptance.',
  ].join('\n'));

  const report = verifyWorkspace(workspace, 4, evidence, { checkIds: ['operator-readme'] });

  assert.equal(report.ok, true);
  assert.equal(report.mode, 'targeted');
  assert.deepEqual(report.checks.map(check => check.id), ['operator-readme']);
  assert.equal(fs.existsSync(path.join(evidence, 'public-test.log')), false);
});
