import assert from 'node:assert/strict';
import test from 'node:test';

import { findInteractionDispatcherCycles } from './verify-workspace.mjs';

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
