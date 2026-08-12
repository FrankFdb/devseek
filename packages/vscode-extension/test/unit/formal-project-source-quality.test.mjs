import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/formal-project-source-quality.bundle.cjs');

execSync(
  `npx esbuild src/agent/formal-project-source-quality.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { assessFormalProjectSourceQuality } = createRequire(import.meta.url)(bundlePath);
const formalPrompt = '在既有主控正式项目内实现接口功能，复用原模块并运行项目测试';

test('formal project source quality delegates executable validation to the canonical verifier', () => {
  const result = assessFormalProjectSourceQuality([{
    path: 'src/order_book.cpp',
    action: 'modify',
    content: 'std::vector<Trade> OrderBook::submit(Order order) { return match(order); }\n',
  }], formalPrompt);

  assert.equal(result.required, true);
  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
});

test('formal project source quality still rejects an unrequested standalone entry point', () => {
  const result = assessFormalProjectSourceQuality([{
    path: 'src/order_book_demo.cpp',
    action: 'create',
    content: 'int main() { return 0; }\n',
  }], formalPrompt);

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['standalone-sample-code']);
  assert.deepEqual(result.offendingPaths, ['src/order_book_demo.cpp']);
});

test('formal project source quality still rejects unresolved integration facts', () => {
  const result = assessFormalProjectSourceQuality([{
    path: 'src/order_book.cpp',
    action: 'modify',
    content: '// TODO: 集成点待确认\nint submit() { return 0; }\n',
  }], formalPrompt);

  assert.equal(result.ok, false);
  assert.deepEqual(result.reasons, ['unresolved-project-facts']);
});
