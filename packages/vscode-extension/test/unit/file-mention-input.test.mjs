import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(tmpdir(), `devseek-file-mention-input-${process.pid}.cjs`);

execSync(
  `npx esbuild src/ui/file-mention-input.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { resolveFileMentionInput } = createRequire(import.meta.url)(bundlePath);

test('unresolved at tokens preserve the exact user turn', () => {
  const prompt = '报告必须逐字包含 @modelcontextprotocol/sdk。';
  assert.equal(resolveFileMentionInput(prompt, 'modelcontextprotocol/sdk', null), prompt);
});

test('resolved file mentions inject known content, including empty files', () => {
  assert.match(
    resolveFileMentionInput('解释 @src/cache.ts', 'src/cache.ts', 'export const ready = true;'),
    /文件内容 `src\/cache\.ts`[\s\S]*ready = true/u,
  );
  assert.match(
    resolveFileMentionInput('解释 @empty.txt', 'empty.txt', ''),
    /文件内容 `empty\.txt`/u,
  );
});
