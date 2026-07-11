import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-contract.bundle.cjs');
execSync(`npx esbuild src/agent/task-contract.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`, {
  cwd: rootDir,
  stdio: 'pipe',
});
const {
  authorizeAgentFileWriteContract,
  authorizeMarkdownArtifactWrite,
  buildTaskContract,
  getSourceClaimArtifactContractIssue,
  hasArtifactWriteIntent,
  resolveTaskContractSourcePaths,
} = createRequire(import.meta.url)(bundlePath);

test('plain configuration extraction requires evidence but no protocol or implementation plan', () => {
  const contract = buildTaskContract('读取 /repo/config/app.ts 的三个超时常量，创建 docs/config-facts.md，不要修改源码');
  assert.deepEqual(contract.constraints, ['no-source-change']);
  assert.ok(contract.qualityObligations.includes('source-evidence'));
  assert.ok(!contract.qualityObligations.includes('protocol-facts'));
  assert.ok(!contract.qualityObligations.includes('interface-contract'));
  assert.ok(!contract.qualityObligations.includes('modification-plan'));
  assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), []);
});

test('explicit constant extraction records per-symbol evidence requirements', () => {
  const contract = buildTaskContract('读取 config.hpp，提取 kRequestTimeoutMs、kMaxRetries 的真实值并创建报告');
  assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), ['kRequestTimeoutMs', 'kMaxRetries']);
});

test('path segments that look like constants do not become evidence claims', () => {
  const contract = buildTaskContract([
    '请读取 /tmp/kInjectedSource/license_types.hpp，提取 kAlpha、kBeta 两个常量的真实值。',
    '请创建 Markdown 报告 /tmp/kPhantomTarget/report.md，包含标题和两行表格。',
  ].join('\n'));
  assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), ['kAlpha', 'kBeta']);
});

test('exact fact report produces executable artifact verification requirements', () => {
  const contract = buildTaskContract([
    '请读取 /repo/src/config.hpp，提取 kRequestTimeoutMs、kMaxRetries 的真实值。',
    '只创建一个 Markdown 报告 /repo/docs/config.md，必须包含标题、源码路径和一个 2 行表格。',
    '加入 Python 代码块，代码内容必须是 `print("\\nready")`，写入后重新读取，不要创建其他文件。',
  ].join('\n'));
  assert.equal(contract.verificationContract.requireTitle, true);
  assert.deepEqual(contract.verificationContract.requiredSourcePaths, ['/repo/src/config.hpp']);
  assert.deepEqual(contract.verificationContract.exactClaimTable, {
    symbols: ['kRequestTimeoutMs', 'kMaxRetries'],
    rowCount: 2,
    forbidAdditionalRows: true,
  });
  assert.deepEqual(contract.verificationContract.exactCodeBlocks, [{ language: 'python', content: 'print("\\nready")' }]);
  assert.equal(contract.verificationContract.requireArtifactReadback, true);
  assert.equal(contract.verificationContract.maxWrittenFiles, 1);
});

test('an unfamiliar source-report mutation verb becomes a grounded fail-closed obligation', () => {
  const contract = buildTaskContract([
    '请读取 src/config.hpp，提取 kRequestTimeoutMs 的真实值。',
    '请登记于 Markdown 报告 docs/config.md。',
  ].join(''));
  assert.ok(contract.deliverables.includes('report'));
  assert.equal(contract.verificationContract.requireSourceClaimGrounding, true);
  assert.deepEqual(contract.deliverableTargets, [], 'unknown verbs must not silently authorize a target');
});

test('numbered fenced-block wording preserves the exact code contract', () => {
  const contract = buildTaskContract([
    '请读取 /repo/src/config.hpp，提取 kRequestTimeoutMs、kMaxRetries 的真实值。',
    '只创建 Markdown 报告 /repo/docs/config.md。',
    '4. 仅包含一个 Python fenced 代码块，语言标记必须为 python，块内内容必须逐字为：print("\\nready")',
  ].join('\n'));
  assert.deepEqual(contract.verificationContract.exactCodeBlocks, [
    { language: 'python', content: 'print("\\nready")' },
  ]);
});

test('protocol-like claim symbols do not imply a project-wide communication investigation', () => {
  const contract = buildTaskContract([
    '读取 /repo/license_types.hpp，提取 kTopicLicenseTunnelRx、kMavTunnelCmdLicense 的真实值。',
    '只创建 Markdown 报告 /repo/license-facts.md，不要修改源码。',
  ].join('\n'));
  assert.ok(contract.qualityObligations.includes('protocol-facts'));
  assert.ok(!contract.qualityObligations.includes('project-communication-chain'));
});

test('bare fixture paths and duplicated prompt obligations remain canonical', () => {
  const prompt = '读取 license_types.hpp，提取 kValue 的真实值。创建 Markdown 报告 facts.md，加入 Python 代码块，代码内容必须是 print("\\nready")。';
  const contract = buildTaskContract(`${prompt}\n${prompt}`);
  assert.deepEqual(contract.inputs, ['license_types.hpp', 'facts.md']);
  assert.deepEqual(contract.deliverableTargets, ['facts.md']);
  assert.deepEqual(contract.verificationContract.exactCodeBlocks, [
    { language: 'python', content: 'print("\\nready")' },
  ]);
});

test('lowerCamel source claims and noun-before-symbol wording remain grounded', () => {
  for (const prompt of [
    '读取 config.hpp，提取 timeoutMs 的真实值并创建 report.md。',
    '读取 config.hpp，提取常量 timeoutMs 的真实值并创建 report.md。',
    '读取 config.hpp，提取字段 timeoutMs 的真实值并创建 report.md。',
    'Read config.hpp, extract the value of timeoutMs and create report.md.',
  ]) {
    const contract = buildTaskContract(prompt);
    assert.deepEqual(contract.evidenceRequirements.map(item => item.symbol), ['timeoutMs'], prompt);
    assert.equal(contract.verificationContract.requireSourceClaimGrounding, true, prompt);
  }
});

test('unresolved source-fact extraction stays an explicit grounding obligation', () => {
  const contract = buildTaskContract('读取 config.hpp，提取真实配置值并创建 report.md。');
  assert.deepEqual(contract.evidenceRequirements, []);
  assert.equal(contract.verificationContract.requireSourceClaimGrounding, true);
  assert.match(getSourceClaimArtifactContractIssue(contract), /未能解析出明确的 claim symbol/);
});

test('structured Markdown targets accept target-first wording and Chinese punctuation', () => {
  const contract = buildTaskContract('源文件：config.hpp，提取 timeoutMs 的真实值。目标是 report.md，请创建该 Markdown 报告。');
  assert.deepEqual(contract.inputs, ['config.hpp', 'report.md']);
  assert.deepEqual(contract.deliverableTargets, ['report.md']);
  assert.deepEqual(contract.evidenceRequirements.map(item => item.sourcePath), ['config.hpp']);
  assert.deepEqual(
    buildTaskContract('基于 docs/requirements.md 完成分析，通过 md 文档提供。').deliverableTargets,
    [],
    '“基于” must not turn an input document into the implicit output target',
  );
});

test('artifact mutation vocabulary is shared by intent routing and Markdown target extraction', () => {
  assert.equal(hasArtifactWriteIntent('请结合这些信息分析，通过 md 文档提供。'), true);
  for (const verb of ['提供', '更新', '修改', '改写']) {
    const prompt = `读取 config.hpp，提取 kValue 的真实值并${verb} Markdown 报告 report.md。`;
    assert.equal(hasArtifactWriteIntent(prompt), true);
    assert.deepEqual(buildTaskContract(prompt).deliverableTargets, ['report.md']);
  }
  for (const verb of ['provide', 'update', 'modify', 'revise']) {
    const prompt = `Read config.hpp, extract kValue and ${verb} Markdown report report.md.`;
    assert.equal(hasArtifactWriteIntent(prompt), true);
    assert.deepEqual(buildTaskContract(prompt).deliverableTargets, ['report.md']);
  }
  for (const prompt of [
    '读取 config.hpp，提取 kValue 的真实值并记录到 Markdown 报告 report.md。',
    '读取 config.hpp，提取 kValue 的真实值并汇总至 Markdown 报告 report.md。',
    'Read config.hpp, extract kValue and record it in Markdown report report.md.',
  ]) {
    assert.equal(hasArtifactWriteIntent(prompt), true, prompt);
    assert.deepEqual(buildTaskContract(prompt).deliverableTargets, ['report.md'], prompt);
  }
  assert.equal(hasArtifactWriteIntent('读取 config.hpp，提取 kValue，Markdown 报告给我，不要修改任何源码。'), false);
  assert.equal(hasArtifactWriteIntent('读取 config.hpp，提取 kValue 并检查 report.md，不要修改源码。'), false);
  assert.equal(hasArtifactWriteIntent('provider 会检查 report.md，但不应写盘。'), false);
  assert.equal(hasArtifactWriteIntent('修改源码并检查 report.md。'), false);
  for (const prompt of [
    '不修改 report.md。',
    '勿修改 report.md。',
    '不得提供 Markdown 报告 report.md。',
    '不允许生成 Markdown 报告 report.md。',
  ]) {
    assert.equal(hasArtifactWriteIntent(prompt), false, prompt);
    assert.deepEqual(buildTaskContract(prompt).deliverableTargets, [], prompt);
  }
  assert.equal(hasArtifactWriteIntent('读取 config.hpp，提取 kValue；不要修改源码，只更新 Markdown 报告 report.md。'), true);
  assert.deepEqual(
    buildTaskContract('读取 config.hpp，提取 kValue；不要修改 Markdown 报告 report.md。').deliverableTargets,
    [],
  );
  assert.deepEqual(
    buildTaskContract('读取 config.hpp，提取 kValue 的真实值；把 report.md 更新为新的 Markdown 报告。').deliverableTargets,
    ['report.md'],
  );
});

test('artifact mutation negation does not consume positive words ending in 不 or 别', () => {
  for (const prompt of [
    '请进行接口设计，并分别做成 md 文档。',
    '请为不同模块编写 Markdown 文档。',
  ]) {
    assert.equal(hasArtifactWriteIntent(prompt), true, prompt);
  }
  for (const prompt of [
    '请别修改 report.md。',
    '请不要再修改 report.md。',
    '请不再更新 Markdown 报告 report.md。',
    '我们别创建 Markdown 文档 report.md。',
    '先别生成 Markdown 报告 report.md。',
    '并且别提供 Markdown 报告 report.md。',
    '不应当创建 Markdown 报告 report.md。',
    '不可以创建 Markdown 报告 report.md。',
    '不可再创建 Markdown 报告 report.md。',
    'Should not create Markdown report report.md.',
  ]) {
    assert.equal(hasArtifactWriteIntent(prompt), false, prompt);
  }
  assert.equal(hasArtifactWriteIntent('无需额外说明并生成 Markdown 报告 report.md。'), true);
});

test('deliverable target extraction isolates positive and prohibited sibling targets', () => {
  for (const prompt of [
    '请创建 Markdown 报告 a.md，不要修改 b.md。',
    '请创建 Markdown 报告 a.md, do not generate b.md.',
    '请创建 a.md，不允许生成 b.md。',
  ]) {
    assert.deepEqual(buildTaskContract(prompt).deliverableTargets, ['a.md'], prompt);
  }
  assert.deepEqual(
    buildTaskContract('目标是 report.md，请创建该 Markdown 报告。').deliverableTargets,
    ['report.md'],
  );
  for (const prompt of [
    '目标文件是 report.md，请生成 Markdown 报告。',
    'target file is report.md, create the Markdown report.',
    'file is report.md, create the Markdown report.',
  ]) {
    assert.deepEqual(buildTaskContract(prompt).deliverableTargets, ['report.md'], prompt);
  }
});

test('Markdown write authorization enforces prohibitions and explicit target scope', () => {
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: '不要创建 Markdown 报告 b.md。',
    targetPath: '/workspace/b.md',
    workspaceRoot: '/workspace',
  }).reason, 'markdown-artifact-write-prohibited');

  const promptText = '请创建 Markdown 报告 a.md，不要修改 b.md。';
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText,
    targetPath: '/workspace/a.md',
    workspaceRoot: '/workspace',
  }).allowed, true);
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText,
    targetPath: '/workspace/b.md',
    workspaceRoot: '/workspace',
  }).reason, 'markdown-artifact-write-prohibited');

  for (const prohibition of [
    '不要创建任何文件。',
    '禁止写入文件。',
    'Do not create any files.',
  ]) {
    assert.equal(authorizeMarkdownArtifactWrite({
      promptText: prohibition,
      targetPath: '/workspace/report.md',
      workspaceRoot: '/workspace',
    }).reason, 'markdown-artifact-write-prohibited', prohibition);
  }

  for (const mixed of [
    '请创建一个 Markdown 报告，但不要修改 existing.md。',
    '生成 Markdown 文档；禁止覆盖 protected.md。',
    'Create a Markdown report, but do not modify existing.md.',
  ]) {
    const deniedName = mixed.includes('protected') ? 'protected.md' : 'existing.md';
    assert.equal(authorizeMarkdownArtifactWrite({
      promptText: mixed,
      targetPath: `/workspace/${deniedName}`,
      workspaceRoot: '/workspace',
    }).reason, 'markdown-artifact-write-prohibited', mixed);
    assert.equal(authorizeMarkdownArtifactWrite({
      promptText: mixed,
      targetPath: '/workspace/new-report.md',
      workspaceRoot: '/workspace',
      allowImplicitPrimaryArtifact: true,
    }).allowed, true, mixed);
  }

  const exclusivePrompt = '请创建 Markdown 报告 report.md，不要创建其他文件。';
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: exclusivePrompt,
    targetPath: '/workspace/report.md',
    workspaceRoot: '/workspace',
  }).allowed, true);
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: exclusivePrompt,
    targetPath: '/workspace/other.md',
    workspaceRoot: '/workspace',
  }).reason, 'markdown-artifact-target-not-requested');

  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: '请创建 Markdown 报告，不要修改正式源码文件。',
    targetPath: '/workspace/report.md',
    workspaceRoot: '/workspace',
    allowImplicitPrimaryArtifact: true,
  }).allowed, true);
});

test('current user request is the only authority across continuation context', () => {
  const stalePositive = [
    '不要创建 report.md。',
    '',
    '【同一会话续作上下文】',
    '上一轮目标：请创建 report.md。',
  ].join('\n');
  assert.deepEqual(buildTaskContract(stalePositive).deliverableTargets, []);
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: stalePositive,
    targetPath: '/workspace/report.md',
    workspaceRoot: '/workspace',
  }).reason, 'markdown-artifact-write-prohibited');

  const staleNegative = [
    '请创建 report.md。',
    '',
    '【同一会话续作上下文】',
    '上一轮目标：不要创建 report.md。',
  ].join('\n');
  assert.deepEqual(buildTaskContract(staleNegative).deliverableTargets, ['report.md']);
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: staleNegative,
    targetPath: '/workspace/report.md',
    workspaceRoot: '/workspace',
  }).allowed, true);

  for (const wrapped of [
    [
      '请创建 report.md。',
      '【同一会话续作上下文】',
      '历史信息',
    ].join('\n'),
    [
      '【原始用户需求】',
      '请创建 report.md。',
      '【本次子任务】继续执行',
    ].join('\n'),
    [
      '当前用户消息：请创建 report.md。',
      '上一轮 Agent 状态：继续执行',
    ].join('\n'),
  ]) {
    const steered = [
      wrapped,
      '【用户实时补充/纠偏】',
      '停止写入。不要创建任何文件。',
      '',
      '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。不要从头开启新任务。',
    ].join('\n');
    assert.equal(authorizeAgentFileWriteContract({
      promptText: steered,
      targetPath: '/workspace/report.md',
      workspaceRoot: '/workspace',
    }).allowed, false, wrapped);
  }
});

test('read or summarize existing Markdown content is not a write request', () => {
  for (const prompt of [
    '请汇总 report.md 的内容并告诉我。',
    'Summarize report.md and tell me the result.',
    '请返回 report.md 的内容。',
    'Return the contents of report.md.',
    '请输出 report.md 的内容。',
    '请提供 report.md 的内容。',
    'Output the contents of report.md.',
    'Provide the contents of report.md.',
    'Deliver the contents of report.md.',
  ]) {
    assert.equal(hasArtifactWriteIntent(prompt), false, prompt);
    assert.deepEqual(buildTaskContract(prompt).deliverableTargets, [], prompt);
  }
  const writePrompt = '请把汇总结果写到 report.md。';
  assert.equal(hasArtifactWriteIntent(writePrompt), true);
  assert.deepEqual(buildTaskContract(writePrompt).deliverableTargets, ['report.md']);
  assert.deepEqual(buildTaskContract('Output result to report.md.').deliverableTargets, ['report.md']);
});

test('file-write authorization covers neutral, prohibited, exclusive, and corrected requests', () => {
  const root = '/workspace/project';
  const decide = (promptText, targetPath) => authorizeAgentFileWriteContract({
    promptText,
    targetPath,
    workspaceRoot: root,
  });
  for (const prompt of ['只读 report.md。', '请读取 report.md 并汇总内容告诉我。', '解释问题。']) {
    assert.equal(decide(prompt, `${root}/report.md`).allowed, false, prompt);
  }
  for (const [prompt, target] of [
    ['不要创建文件。', 'notes.txt'],
    ['禁止写入文件。', 'out.json'],
    ['Do not create files.', 'notes.txt'],
    ['严禁创建任何文件。', 'notes.txt'],
    ['No files should be created.', 'notes.txt'],
  ]) {
    assert.equal(decide(prompt, `${root}/${target}`).reason, 'all-file-writes-prohibited', prompt);
  }
  for (const [prompt, target] of [
    ['请创建 report.md；不要修改 src/main.ts。', 'src/main.ts'],
    ['请创建 report.md；禁止覆盖 config.json。', 'config.json'],
    ["Create report.md but don't delete notes.txt.", 'notes.txt'],
  ]) {
    assert.equal(decide(prompt, `${root}/${target}`).reason, 'target-file-write-prohibited', prompt);
  }

  for (const [prompt, primary, extra] of [
    ['请创建 config.json，不要创建其他文件。', 'config.json', 'extra.txt'],
    ['只修改 src/main.ts，不要修改其他文件。', 'src/main.ts', 'src/other.ts'],
    ['Only create config.json; do not create other files.', 'config.json', 'extra.txt'],
  ]) {
    assert.equal(decide(prompt, `${root}/${primary}`).allowed, true, prompt);
    assert.equal(decide(prompt, `${root}/${extra}`).reason, 'artifact-other-file-write-prohibited', prompt);
  }

  assert.equal(decide('除 report.md 外，不要创建任何文件；请创建 report.md。', `${root}/report.md`).allowed, true);
  assert.equal(decide('Do not create any files except report.md.', `${root}/report.md`).allowed, true);
  assert.equal(decide('只创建 report.md。', `${root}/extra.txt`).reason, 'artifact-other-file-write-prohibited');
  assert.equal(decide('不要创建 report.md；更正：请创建 report.md。', `${root}/report.md`).allowed, true);
  assert.equal(decide('请创建 report.md；更正：不要创建 report.md。', `${root}/report.md`).allowed, false);
});

test('file-write authorization binds actions to output roles and fails closed on read-only paths', () => {
  const authorize = (promptText, relativeTarget, extra = {}) => authorizeAgentFileWriteContract({
    promptText,
    targetPath: path.join('/workspace', relativeTarget),
    workspaceRoot: '/workspace',
    ...extra,
  });
  for (const [promptText, target] of [
    ['Create output.md using template.md.', 'template.md'],
    ['Update output.md based on input.md.', 'input.md'],
    ['根据 template.md 创建 output.md。', 'template.md'],
    ['以 template.md 为模板生成 output.md。', 'template.md'],
    ['将 input.md 的内容写到 output.md。', 'input.md'],
    ['把 input.md 内容写入 output.md。', 'input.md'],
    ['Write input.md contents into output.md.', 'input.md'],
    ['Save input.md contents as output.md.', 'input.md'],
    ['Render input.md into output.md.', 'input.md'],
    ['Generate input.md into output.md.', 'input.md'],
    ['Write contents of input.md as output.md.', 'input.md'],
    ['将 input.md 保存为 output.md。', 'input.md'],
    ['将 input.md 生成为 output.md。', 'input.md'],
    ['以 input.md 内容生成 output.md。', 'input.md'],
    ['Only create a.md and inspect b.md.', 'b.md'],
    ['Summarize report.md into the chat response.', 'report.md'],
    ['把 report.md 内容写到回复里。', 'report.md'],
    ['Write the contents of report.md in the response.', 'report.md'],
    ['Write report.md contents to the user.', 'report.md'],
    ['Write out report.md contents as your answer.', 'report.md'],
    ['请写出 report.md 的内容作为答复。', 'report.md'],
    ['Read all files except report.md.', 'report.md'],
    ['读取除 report.md 以外的所有文件。', 'report.md'],
    ['Inspect config.json and summarize it.', 'config.json'],
    ['只读检查 config.json。', 'config.json'],
    ['Create a.md but not b.md.', 'b.md'],
    ['Create a.md instead of b.md.', 'b.md'],
  ]) {
    assert.equal(authorize(promptText, target).allowed, false, promptText);
  }
  assert.equal(authorize('Create output.md using template.md.', 'output.md').allowed, true);
  assert.equal(authorize('根据 template.md 创建 output.md。', 'output.md').allowed, true);
  assert.equal(authorize('以 template.md 为模板生成 output.md。', 'output.md').allowed, true);
  assert.equal(authorize('将 input.md 的内容写到 output.md。', 'output.md').allowed, true);
  for (const promptText of [
    'Save input.md contents as output.md.',
    'Render input.md into output.md.',
    'Generate input.md into output.md.',
    'Write contents of input.md as output.md.',
    '将 input.md 保存为 output.md。',
    '将 input.md 生成为 output.md。',
    '以 input.md 内容生成 output.md。',
  ]) {
    assert.equal(authorize(promptText, 'output.md').allowed, true, promptText);
  }
  assert.equal(authorize('Save report.md contents as answer.md.', 'report.md').allowed, false);
  assert.equal(authorize('Save report.md contents as answer.md.', 'answer.md').allowed, true);
  assert.equal(authorize('Write out report.md to disk.', 'report.md').allowed, true);
  assert.equal(authorize('Write the answer to report.md.', 'report.md').allowed, true);
  assert.equal(authorize('Update response.md.', 'response.md').allowed, true);
});

test('file-write authorization recognizes broad, target, exclusive, and latest prohibitions', () => {
  const authorize = (promptText, relativeTarget, extra = {}) => authorizeAgentFileWriteContract({
    promptText,
    targetPath: path.join('/workspace', relativeTarget),
    workspaceRoot: '/workspace',
    ...extra,
  });
  for (const promptText of [
    '不创建任何文件。',
    '不写任何文件。',
    '不得对文件做任何修改。',
    "Don't touch any files.",
    'Make no changes to any files.',
  ]) {
    assert.equal(authorize(promptText, 'config.json').allowed, false, promptText);
  }
  for (const [promptText, target] of [
    ['不要改 config.json。', 'config.json'],
    ['别删 notes.txt。', 'notes.txt'],
    ['Do not overwrite config.json.', 'config.json'],
    ['config.json is read-only.', 'config.json'],
    ['Create only report.md.', 'extra.json'],
    ['Only report.md may be created.', 'extra.json'],
    ['Modify only config.json.', 'extra.txt'],
    ['Update config.json; do not modify anything else.', 'extra.txt'],
    ['Create report.md and make no other changes.', 'extra.txt'],
    ['Update config.json and leave all other files unchanged.', 'extra.txt'],
    ['创建 report.md。算了，不要修改它。', 'report.md'],
    ['Create report.md. Actually, do not modify it.', 'report.md'],
    ['请创建 report.md；更正：不要创建 Markdown 报告。', 'report.md'],
  ]) {
    assert.equal(authorize(promptText, target).allowed, false, promptText);
  }
  assert.equal(authorize('Create only report.md.', 'report.md').allowed, true);
  assert.equal(authorize('Only report.md may be created.', 'report.md').allowed, true);
  assert.equal(authorize('Do not create any files except report.md.', 'report.md').allowed, true);
  assert.equal(authorize('不要创建任何文件，除了 report.md 之外。', 'report.md').allowed, true);
  assert.equal(authorize('`report.md` should be created.', 'report.md').allowed, true);
  assert.equal(authorize('不要修改现有源码。更正：更新 src/main.ts。', 'src/main.ts').allowed, true);
  assert.equal(authorize('Do not modify existing source. Correction: update src/main.ts.', 'src/main.ts').allowed, true);
});

test('implicit Markdown authority never overrides target scope, read-only intent, or prohibitions', () => {
  const authorize = (promptText, target) => authorizeAgentFileWriteContract({
    promptText,
    targetPath: `/workspace/${target}`,
    workspaceRoot: '/workspace',
    allowImplicitPrimaryArtifact: true,
  });
  assert.equal(authorize('Only report.md may be created.', 'extra.md').allowed, false);
  assert.equal(authorize('Read report.md only; do not modify it.', 'report.md').allowed, false);
  assert.equal(authorize('Inspect everything except report.md.', 'report.md').allowed, false);
  assert.equal(authorize('Please provide the analysis through a Markdown document.', 'generated.md').allowed, true);
});

test('explicit paths use canonical identity instead of basename coincidence', () => {
  assert.equal(authorizeAgentFileWriteContract({
    promptText: '请创建 config.json。',
    targetPath: '/workspace/.vscode/config.json',
    workspaceRoot: '/workspace',
  }).allowed, false);
  assert.equal(authorizeAgentFileWriteContract({
    promptText: '请创建 config.json。',
    targetPath: '/workspace/config.json',
    workspaceRoot: '/workspace',
  }).allowed, true);
});

test('action-bound exact filenames are canonical and never grant sibling writes', () => {
  for (const name of [
    'Makefile', 'Dockerfile', 'LICENSE', 'BUILD',
    'Gemfile', 'Jenkinsfile', 'Vagrantfile', 'Rakefile', 'Procfile', 'Brewfile', 'Tiltfile',
    '.gitignore', 'Cargo.lock', 'Pipfile.lock', 'go.mod', 'meson.build',
  ]) {
    const verb = ['LICENSE', 'BUILD'].includes(name) ? 'Create' : 'Update';
    const promptText = `${verb} ${name}.`;
    assert.equal(authorizeAgentFileWriteContract({
      promptText,
      targetPath: `/workspace/${name}`,
      workspaceRoot: '/workspace',
    }).allowed, true, promptText);
    assert.equal(authorizeAgentFileWriteContract({
      promptText,
      targetPath: `/workspace/nested/${name}`,
      workspaceRoot: '/workspace',
    }).allowed, false, `sibling drift: ${promptText}`);
    assert.equal(authorizeAgentFileWriteContract({
      promptText,
      targetPath: '/workspace/src/main.ts',
      workspaceRoot: '/workspace',
    }).allowed, false, promptText);
  }
  assert.equal(authorizeAgentFileWriteContract({
    promptText: 'Update "manifest".',
    targetPath: '/workspace/manifest',
    workspaceRoot: '/workspace',
  }).allowed, true);
  assert.equal(authorizeAgentFileWriteContract({
    promptText: 'Update "manifest".',
    targetPath: '/workspace/nested/manifest',
    workspaceRoot: '/workspace',
  }).allowed, false);
  assert.equal(authorizeAgentFileWriteContract({
    promptText: 'Update file justfile.',
    targetPath: '/workspace/justfile',
    workspaceRoot: '/workspace',
  }).allowed, true);
  assert.equal(authorizeAgentFileWriteContract({
    promptText: 'Update file justfile.',
    targetPath: '/workspace/src/main.ts',
    workspaceRoot: '/workspace',
  }).allowed, false);
});

test('filename-like words used as concepts do not steal the real mutation target', () => {
  for (const promptText of [
    'Update Gemfile support in docs/guide.md.',
    'Update README guidance in docs/guide.md.',
  ]) {
    assert.equal(authorizeAgentFileWriteContract({
      promptText,
      targetPath: '/workspace/docs/guide.md',
      workspaceRoot: '/workspace',
    }).allowed, true, promptText);
    assert.equal(authorizeAgentFileWriteContract({
      promptText,
      targetPath: `/workspace/${promptText.includes('Gemfile') ? 'Gemfile' : 'README'}`,
      workspaceRoot: '/workspace',
    }).allowed, false, promptText);
  }
});

test('English sentence boundaries keep scoped source bans out of explicit document targets', () => {
  assert.equal(authorizeAgentFileWriteContract({
    promptText: 'Do not modify existing source files. Create docs/report.txt.',
    targetPath: '/workspace/docs/report.txt',
    workspaceRoot: '/workspace',
  }).allowed, true);
});

test('strict Markdown target extraction handles Unicode, quoted spaces, target-first, and workspace prefixes', () => {
  const root = '/workspace/project';
  const cases = [
    ['请创建 Markdown 报告 docs/事实报告.md。', 'docs/事实报告.md'],
    ['请创建 Markdown 报告 "docs/my report.md"。', 'docs/my report.md'],
    ['请创建 Markdown 报告 docs/my report.md。', 'docs/my report.md'],
    ['请在 docs/report.md 中写入结果。', 'docs/report.md'],
    ['请往 report.md 里保存内容。', 'report.md'],
    ['report.md 请创建。', 'report.md'],
    ['目标文件为 a.md、b.md，请创建这两个 Markdown 文档。', 'a.md'],
    ['目标文件为 a.md、b.md，请创建这两个 Markdown 文档。', 'b.md'],
    ['请创建 Markdown 报告 project/docs/a.md。', 'docs/a.md'],
  ];
  for (const [promptText, relativeTarget] of cases) {
    const contract = buildTaskContract(promptText);
    assert.ok(contract.deliverableTargets.length > 0, promptText);
    assert.equal(authorizeAgentFileWriteContract({
      promptText,
      targetPath: path.join(root, relativeTarget),
      workspaceRoot: root,
    }).allowed, true, promptText);
  }
  assert.equal(authorizeAgentFileWriteContract({
    promptText: '请创建 Markdown 报告 docs/事实报告.md。',
    targetPath: `${root}/other.md`,
    workspaceRoot: root,
  }).allowed, false);
  assert.equal(authorizeAgentFileWriteContract({
    promptText: '请创建 Markdown 报告 "docs/my report.md"。',
    targetPath: `${root}/report.md`,
    workspaceRoot: root,
  }).allowed, false);
  assert.equal(authorizeAgentFileWriteContract({
    promptText: '请创建 Markdown 报告 project/docs/a.md。',
    targetPath: `${root}/project/docs/a.md`,
    workspaceRoot: root,
  }).allowed, false);
});

test('Markdown extension aliases are excluded from source-path binding', () => {
  const contract = buildTaskContract('读取（spec.markdown）和 source.hpp，提取 kValue 的真实值并创建 report.md。');
  assert.deepEqual(contract.evidenceRequirements.map(item => item.sourcePath), ['source.hpp']);
  assert.deepEqual(contract.deliverableTargets, ['report.md']);
});

test('a bare source input resolves only against one canonical workspace match', () => {
  const contract = buildTaskContract('读取 license_types.hpp，提取 kValue 的真实值，创建 Markdown 报告 facts.md，包含源码路径');
  const resolved = resolveTaskContractSourcePaths(
    contract,
    ['/repo/src/oam/src/license/license_types.hpp'],
    '/repo',
  );
  assert.equal(resolved.evidenceRequirements[0].sourcePath, '/repo/src/oam/src/license/license_types.hpp');
  assert.deepEqual(resolved.verificationContract.requiredSourcePaths, ['/repo/src/oam/src/license/license_types.hpp']);

  const ambiguous = resolveTaskContractSourcePaths(
    contract,
    ['/repo/a/license_types.hpp', '/repo/b/license_types.hpp'],
    '/repo',
  );
  assert.equal(ambiguous.evidenceRequirements[0].sourcePath, 'license_types.hpp');
});

test('multiple source files are not guessed as one shared claim source', () => {
  const contract = buildTaskContract('读取 /repo/a.hpp 和 /repo/b.hpp，提取 kMaxA、kMaxB 的真实值并创建报告');
  assert.deepEqual(contract.evidenceRequirements.map(item => item.sourcePath), [undefined, undefined]);
  assert.match(getSourceClaimArtifactContractIssue(contract), /无法唯一绑定到源文件/);
});

test('a scoped ban on other files limits writes without cancelling the requested report', () => {
  const contract = buildTaskContract('读取 /repo/config.hpp 并创建 /repo/report.md，不要修改源码，不要创建其他文件');
  assert.equal(contract.verificationContract.maxWrittenFiles, 1);
  assert.deepEqual(contract.deliverableTargets, ['/repo/report.md']);
  assert.ok(contract.deliverables.includes('report'));
});

test('a Markdown source input is never selected as the report deliverable target', () => {
  const contract = buildTaskContract([
    '读取 /repo/spec.md 和 /repo/source.hpp，提取 kValue 的真实值。',
    '只创建一个 Markdown 报告 /repo/report.md，写入后重新读取。',
  ].join('\n'));
  assert.deepEqual(contract.inputs, ['/repo/spec.md', '/repo/source.hpp', '/repo/report.md']);
  assert.deepEqual(contract.deliverableTargets, ['/repo/report.md']);
});

test('existing TypeScript bugfix requires scoped change evidence and validation', () => {
  const contract = buildTaskContract('修复现有 TypeScript 项目的分页 bug，运行单元测试，不涉及通信协议');
  assert.ok(contract.taskShapes.includes('existing-project'));
  assert.ok(contract.qualityObligations.includes('modification-plan'));
  assert.ok(contract.qualityObligations.includes('validation'));
  assert.ok(!contract.qualityObligations.includes('interface-contract'));
});

test('standalone Python tool does not inherit existing-project integration obligations', () => {
  const contract = buildTaskContract('从零创建独立 Python CSV 清理工具，并运行测试');
  assert.ok(contract.taskShapes.includes('standalone'));
  assert.ok(!contract.qualityObligations.includes('modification-plan'));
  assert.ok(!contract.qualityObligations.includes('project-communication-chain'));
});

test('protocol interface task composes only explicitly relevant obligations', () => {
  const contract = buildTaskContract('为现有服务设计 request/response API 接口文档和通信链路，并实现代码后验证');
  assert.ok(contract.qualityObligations.includes('protocol-facts'));
  assert.ok(contract.qualityObligations.includes('interface-contract'));
  assert.ok(contract.qualityObligations.includes('project-communication-chain'));
  assert.ok(contract.qualityObligations.includes('modification-plan'));
});

console.log('\nTask contract tests passed.\n');
