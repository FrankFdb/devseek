import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/operational-language-boundary.bundle.cjs');

execSync(
  `npx esbuild src/intent/operational-language-boundary.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  classifyExternalEffectIntent,
  configureOperationalLanguageLexicon,
  hasExternalEffectProhibition,
  hasIntentRevisionLanguageSignal,
  hasOperationalRunProhibition,
  loadOperationalLanguageLexicon,
  resetOperationalLanguageLexicon,
  stripOperationalRunProhibitionPhrases,
} = createRequire(import.meta.url)(bundlePath);

test('OperationalLanguageBoundary: domain publish APIs are not release effects', () => {
  assert.equal(classifyExternalEffectIntent(
    'publish 以调用开始时的订阅快照为准，handler 可以递归 publish。',
  ), 'none');
  assert.equal(classifyExternalEffectIntent(
    '修复事件发布期间订阅变化导致的缺陷。',
  ), 'none');
});

test('OperationalLanguageBoundary: real release requests and questions remain external effects', () => {
  assert.equal(classifyExternalEffectIntent('请发布当前扩展到市场。'), 'requested');
  assert.equal(classifyExternalEffectIntent('如何发布这个 npm 包？'), 'question');
  assert.equal(classifyExternalEffectIntent('不要推送当前分支。'), 'none');
  assert.equal(classifyExternalEffectIntent('请实现 tools/log_summary.py；不要引入依赖，不要改其他文件。'), 'none');
  assert.equal(classifyExternalEffectIntent('Create src/app.ts without adding new dependencies.'), 'none');
  assert.equal(classifyExternalEffectIntent('Commit the current changes but do not push.'), 'requested');
  assert.equal(classifyExternalEffectIntent(
    'Update src/api.ts and open a PR? No, do not open a PR or push; just make the code change.',
  ), 'none');
});

test('OperationalLanguageBoundary: external effect prohibitions are exposed as local boundaries', () => {
  assert.equal(hasExternalEffectProhibition('Fix src/login.ts, but do not commit or push anything.'), true);
  assert.equal(hasExternalEffectProhibition('修复 src/login.ts，但不要提交也不要推送。'), true);
  assert.equal(hasExternalEffectProhibition('Commit the current changes.'), false);
});

test('OperationalLanguageBoundary: domain execution rules are not host run prohibitions', () => {
  assert.equal(hasOperationalRunProhibition(
    '本轮新增订阅不执行，在轮到前被取消的 handler 不执行。',
  ), false);
  assert.equal(hasOperationalRunProhibition(
    'New handlers must not execute during the current event publish.',
  ), false);
});

test('OperationalLanguageBoundary: explicit host validation prohibitions remain effective', () => {
  assert.equal(hasOperationalRunProhibition('不要运行或测试。'), true);
  assert.equal(hasOperationalRunProhibition('不运行网络，不安装依赖。'), true);
  assert.equal(hasOperationalRunProhibition('Do not run the test.sh script.'), true);
  assert.equal(hasOperationalRunProhibition('Verify src/login.ts without running commands.'), true);
  const stripped = stripOperationalRunProhibitionPhrases('Verify src/login.ts without running commands.');
  assert.match(stripped, /Verify src\/login\.ts/);
  assert.doesNotMatch(stripped, /running commands/);
  assert.doesNotMatch(stripOperationalRunProhibitionPhrases('不运行网络，不安装依赖。'), /不运行网络/);
});

test('OperationalLanguageBoundary: lexicon config can add multilingual external-effect evidence dynamically', () => {
  resetOperationalLanguageLexicon();
  assert.equal(classifyExternalEffectIntent('Bitte shipit-now src/login.ts.'), 'none');
  assert.equal(hasIntentRevisionLanguageSignal('correction', 'corrige-ahora src/login.ts'), false);

  try {
    configureOperationalLanguageLexicon({
      version: 'devseek.operational-language-lexicon/v1',
      externalEffect: {
        unambiguous: [{
          id: 'test-german-shipit',
          source: String.raw`\bshipit-now\b`,
        }],
      },
      intentRevision: {
        correction: [{
          id: 'test-spanish-correction',
          source: String.raw`\bcorrige-ahora\b`,
        }],
      },
    });

    assert.equal(classifyExternalEffectIntent('Bitte shipit-now src/login.ts.'), 'requested');
    assert.equal(hasIntentRevisionLanguageSignal('correction', 'corrige-ahora src/login.ts'), true);
  } finally {
    resetOperationalLanguageLexicon();
  }

  assert.equal(classifyExternalEffectIntent('Bitte shipit-now src/login.ts.'), 'none');
  assert.equal(hasIntentRevisionLanguageSignal('correction', 'corrige-ahora src/login.ts'), false);
});

test('OperationalLanguageBoundary: lexicon JSON can be loaded without code changes', () => {
  resetOperationalLanguageLexicon();
  const filePath = path.join(os.tmpdir(), `devseek-operational-lexicon-${process.pid}.json`);
  fs.writeFileSync(filePath, JSON.stringify({
    version: 'devseek.operational-language-lexicon/v1',
    runProhibition: {
      strong: [{
        id: 'test-spanish-no-shell',
        source: String.raw`sin\s+shell`,
      }],
      operationalExecutionTarget: [{
        id: 'test-spanish-shell-target',
        source: String.raw`\bshell\b`,
      }],
      phrase: [{
        id: 'test-spanish-no-shell-phrase',
        source: String.raw`\bsin\s+shell\b`,
        flags: 'gi',
      }],
    },
  }), 'utf8');

  try {
    assert.equal(hasOperationalRunProhibition('Verifica src/login.ts sin shell.'), false);
    loadOperationalLanguageLexicon(filePath);
    assert.equal(hasOperationalRunProhibition('Verifica src/login.ts sin shell.'), true);
    assert.doesNotMatch(
      stripOperationalRunProhibitionPhrases('Verifica src/login.ts sin shell.'),
      /sin shell/i,
    );
  } finally {
    resetOperationalLanguageLexicon();
  }
});
