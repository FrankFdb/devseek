/**
 * Unit tests for local attachment prompt injection.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/local-attachment-context.bundle.cjs');

execSync(
  `npx esbuild src/app/local-attachment-context.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { buildLocalAttachmentContextPrompt } = req(bundlePath);

test('local attachments are inlined for read-only plain chat', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-read-001-'));
  try {
    const filePath = path.join(dir, 'Makefile.cpp');
    writeFileSync(filePath, 'int main() { return 0; }\n', 'utf8');

    const result = buildLocalAttachmentContextPrompt(
      '不要修改，只分析这个文件',
      [filePath],
      { workspaceRoot: dir },
    );

    assert.deepEqual(result.inlinedFiles, [filePath]);
    assert.deepEqual(result.skippedFiles, []);
    assert.match(result.prompt, /【本地附件上下文】/);
    assert.match(result.prompt, /文件: Makefile\.cpp/);
    assert.match(result.prompt, /int main\(\) \{ return 0; \}/);
    assert.match(result.prompt, /不要要求用户重新上传，也不要输出工具调用/);
    assert.match(result.prompt, /【用户请求】\n不要修改，只分析这个文件/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('unreadable attachments leave the prompt unchanged', () => {
  const prompt = '不要修改，只分析这个文件';
  const result = buildLocalAttachmentContextPrompt(prompt, ['/tmp/definitely-missing.cpp']);

  assert.equal(result.prompt, prompt);
  assert.deepEqual(result.inlinedFiles, []);
  assert.deepEqual(result.skippedFiles, ['/tmp/definitely-missing.cpp']);
});

console.log('\nLocal attachment context tests passed.\n');
