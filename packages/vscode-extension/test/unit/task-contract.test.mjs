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
  resolveTaskMutationTargets,
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

test('strict source-fact structure compiles into a complete host-owned artifact contract', () => {
  const source = '/repo/src/config.hpp';
  const contract = buildTaskContract([
    `请读取 ${source}，从源码提取 kRequestTimeoutMs、kMaxRetries 两个常量的真实定义和值。`,
    '只创建 Markdown 报告 /repo/docs/config.md。',
    '报告必须严格满足以下结构：',
    '1. 仅包含一个 Markdown 标题，且必须逐字为：# 配置源码事实',
    `2. 紧接一行必须逐字为：源码路径：${source}`,
    '3. 仅包含一个 Markdown 表格，表头必须是 Symbol 和 Value，数据行恰好两行。',
    '4. 仅包含一个 Python 代码块，语言标记必须为 python，块内内容必须逐字为：print("ready")',
    '不得增加其他标题、表格数据行、代码块或说明段落；写入后重新读取。',
  ].join('\n'));

  assert.equal(contract.verificationContract.exactArtifactRequested, true);
  assert.deepEqual(contract.verificationContract.exactArtifact, {
    kind: 'source-fact-markdown',
    title: '# 配置源码事实',
    sourcePathLines: [`源码路径：${source}`],
    tableHeader: ['Symbol', 'Value'],
    symbols: ['kRequestTimeoutMs', 'kMaxRetries'],
    valuePresentation: 'source-initializer',
    codeBlocks: [{ language: 'python', content: 'print("ready")' }],
    forbidAdditionalContent: true,
  });
  assert.equal(getSourceClaimArtifactContractIssue(contract), undefined);
});

test('English strict source-fact contract preserves paths, ordered symbols, and exact bytes', () => {
  const source = '/repo/src/config.hpp';
  const target = '/repo/docs/config.md';
  const contract = buildTaskContract([
    `Read ${source} and extract the real definitions and values of kRequestTimeoutMs, kMaxRetries.`,
    `Create only one Markdown report ${target}.`,
    'The report must strictly follow this structure:',
    '1. The title must exactly be: # Source Facts Report',
    `2. The next line must exactly be: Source path: ${source}`,
    '3. Include only one Markdown table; the header must be Symbol and Value; the table must have 2 rows.',
    '4. Include only one Python code block; the language marker must be python; code block content must exactly be: print("ready")',
    'No additional content, headings, rows, or blocks may be added; read it back after writing.',
  ].join('\n'));

  assert.deepEqual(contract.inputs, [source, target]);
  assert.deepEqual(contract.deliverableTargets, [target]);
  assert.deepEqual(contract.evidenceRequirements.map(item => [item.symbol, item.sourcePath]), [
    ['kRequestTimeoutMs', source],
    ['kMaxRetries', source],
  ]);
  assert.deepEqual(contract.verificationContract.requiredSourcePaths, [source]);
  assert.equal(contract.verificationContract.exactArtifactRequested, true);
  assert.deepEqual(contract.verificationContract.exactArtifact, {
    kind: 'source-fact-markdown',
    title: '# Source Facts Report',
    sourcePathLines: [`Source path: ${source}`],
    tableHeader: ['Symbol', 'Value'],
    symbols: ['kRequestTimeoutMs', 'kMaxRetries'],
    valuePresentation: 'source-initializer',
    codeBlocks: [{ language: 'python', content: 'print("ready")' }],
    forbidAdditionalContent: true,
  });
  assert.equal(getSourceClaimArtifactContractIssue(contract), undefined);
});

test('strict-looking wording does not transfer artifact ownership without affirmative no-extra-content semantics', () => {
  const base = [
    '请读取 /repo/config.hpp，提取 kValue 的真实值并创建 Markdown 报告 /repo/facts.md。',
    '报告必须严格满足以下结构：标题必须逐字为：# 源码事实报告。',
    '表格之后再增加一段风险解释。',
  ];
  assert.equal(buildTaskContract(base.join('\n')).verificationContract.exactArtifactRequested, false);
  assert.equal(buildTaskContract([
    base[0],
    '报告无需严格满足以下结构：标题必须逐字为：# 源码事实报告。',
    '不得增加其他内容。',
  ].join('\n')).verificationContract.exactArtifactRequested, false);

  for (const wording of [
    '报告不需要严格满足以下结构：',
    '报告不要求严格满足以下结构：',
    'The report does not have to strictly follow this structure:',
  ]) {
    const contract = buildTaskContract([
      base[0],
      wording,
      '标题必须逐字为：# 源码事实报告。',
      '不得增加其他内容。',
    ].join('\n'));
    assert.equal(contract.verificationContract.exactArtifactRequested, false, wording);
  }

  for (const scopedForbid of [
    '代码块内不得增加其他内容；表格之后再增加一段风险解释。',
    '其他文件不得增加其他内容；表格之后再增加一段风险解释。',
    '对于附录，不得增加其他标题；表格之后再增加一段风险解释。',
    '表格之后必须增加一段风险解释；No additional content inside the Python code block.',
    '报告不得增加其他内容。更正：允许增加风险说明。',
    '不要求“不得增加其他内容”这一限制，表格后允许添加说明。',
  ]) {
    const contract = buildTaskContract([
      base[0],
      '报告必须严格满足以下结构：标题必须逐字为：# 源码事实报告。',
      scopedForbid,
    ].join('\n'));
    assert.equal(contract.verificationContract.exactArtifactRequested, false, scopedForbid);
  }

  const corrected = buildTaskContract([
    base[0],
    '报告无需严格满足以下结构。更正：报告必须严格满足以下结构：',
    '标题必须逐字为：# 源码事实报告。',
    '不得增加其他内容。',
  ].join('\n'));
  assert.equal(corrected.verificationContract.exactArtifactRequested, true);
});

test('an incomplete strict artifact contract fails closed instead of falling back to provider prose', () => {
  const contract = buildTaskContract([
    '请读取 /repo/config.hpp，提取 kValue 的真实值并创建 Markdown 报告 /repo/facts.md。',
    '报告必须严格满足以下结构：标题必须逐字为：# 源码事实报告。',
    '不得增加其他内容。',
  ].join('\n'));
  assert.equal(contract.verificationContract.exactArtifactRequested, true);
  assert.equal(contract.verificationContract.exactArtifact, undefined);
  assert.match(getSourceClaimArtifactContractIssue(contract), /逐字源码事实报告契约不完整/);
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
  assert.equal(hasArtifactWriteIntent('只检查 controlled-boundary.txt，并确认无文件改动。'), false);
  assert.equal(hasArtifactWriteIntent('读取 controlled-boundary.txt，确认没有文件修改。'), false);
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

  const dedupePrompt = '请将仿真测试结果输出到 /workspace/docs/warranty-maintenance-advice-simulation.md，文件名需要保留 simulation 标识。';
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: dedupePrompt,
    targetPath: '/workspace/docs/warranty-maintenance-advice-simulation-1.md',
    workspaceRoot: '/workspace',
  }).allowed, true);
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: dedupePrompt,
    targetPath: '/workspace/other/warranty-maintenance-advice-simulation-1.md',
    workspaceRoot: '/workspace',
  }).reason, 'markdown-artifact-target-not-requested');
  assert.equal(authorizeMarkdownArtifactWrite({
    promptText: dedupePrompt,
    targetPath: '/workspace/docs/warranty-maintenance-advice-notes-1.md',
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
    ['只修复 src/math.js，不要修改其他文件。', 'src/math.js', 'src/other.js'],
    [
      '请修复 src/math.js 中 add(a, b) 的明显错误。要求 add(2, 3) 返回 5，修改后用 node 命令验证并结束任务。不要修改其他文件。',
      'src/math.js',
      'src/other.js',
    ],
    ['Only create config.json; do not create other files.', 'config.json', 'extra.txt'],
    ['Fix src/math.js so add(2, 3) returns 5; do not modify other files.', 'src/math.js', 'src/other.js'],
    ['Fix add(a, b) in src/math.js, do not modify other files, and verify add(2, 3) returns 5.', 'src/math.js', 'src/other.js'],
  ]) {
    assert.equal(decide(prompt, `${root}/${primary}`).allowed, true, prompt);
    assert.equal(decide(prompt, `${root}/${extra}`).reason, 'artifact-other-file-write-prohibited', prompt);
  }

  assert.equal(decide('除 report.md 外，不要创建任何文件；请创建 report.md。', `${root}/report.md`).allowed, true);
  assert.equal(decide('Do not create any files except report.md.', `${root}/report.md`).allowed, true);
  assert.equal(decide('只创建 report.md。', `${root}/extra.txt`).reason, 'artifact-other-file-write-prohibited');
  assert.equal(decide('不要创建 report.md；更正：请创建 report.md。', `${root}/report.md`).allowed, true);
  assert.equal(decide('请创建 report.md；更正：不要创建 report.md。', `${root}/report.md`).allowed, false);

  const implementSourceAndTest = '请实现 src/repeat-label.js，并新增 test/repeat-label.test.js。repeatLabel("devseek", 3) 应返回 devseek-devseek-devseek。对非法负数 count 抛出错误，改完运行 node test/repeat-label.test.js。';
  assert.deepEqual(
    resolveTaskMutationTargets(implementSourceAndTest),
    ['src/repeat-label.js', 'test/repeat-label.test.js'],
  );
  assert.equal(decide(implementSourceAndTest, `${root}/src/repeat-label.js`).allowed, true);
  assert.equal(decide(implementSourceAndTest, `${root}/test/repeat-label.test.js`).allowed, true);
  assert.equal(
    decide(implementSourceAndTest, `${root}/src/other.js`).reason,
    'target-file-write-prohibited',
  );

  assert.equal(decide('CI is red, get it green.', `${root}/src/parser.js`).allowed, true);
  assert.equal(decide('测试挂了，帮我过掉。', `${root}/src/parser.js`).allowed, true);
  assert.equal(decide('The app is broken, make it work again.', `${root}/src/parser.js`).allowed, true);
  assert.equal(decide('登录流程坏了，帮我恢复可用。', `${root}/src/auth.js`).allowed, true);
  assert.equal(
    decide('Here is the stack trace from login: TypeError: Cannot read properties of undefined. Can you take care of it?', `${root}/src/auth.js`).allowed,
    true,
  );
  assert.equal(
    decide('Users cannot sign in after entering the correct password. Please sort it out.', `${root}/src/auth.js`).allowed,
    true,
  );
  assert.equal(decide('CI is red, get it green.', `${root}/README.md`).reason, 'markdown-artifact-target-not-requested');
  assert.equal(
    decide('The app is broken, make it work again.', `${root}/README.md`).reason,
    'markdown-artifact-target-not-requested',
  );
  assert.equal(
    decide('Here is the stack trace from login: TypeError: Cannot read properties of undefined. Can you take care of it?', `${root}/README.md`).reason,
    'markdown-artifact-target-not-requested',
  );
  assert.equal(
    decide('Users cannot sign in after entering the correct password. Please sort it out.', `${root}/README.md`).reason,
    'markdown-artifact-target-not-requested',
  );
  assert.equal(
    decide('CI is red, get it green, but do not change files.', `${root}/src/parser.js`).reason,
    'all-file-writes-prohibited',
  );
  assert.equal(
    decide('The app is broken, explain why; do not change files.', `${root}/src/parser.js`).reason,
    'all-file-writes-prohibited',
  );
  assert.equal(
    decide('Here is the stack trace. Explain the likely cause only, do not change files.', `${root}/src/auth.js`).reason,
    'all-file-writes-prohibited',
  );
  assert.equal(
    decide('How do I fix src/login.ts if users cannot sign in?', `${root}/src/login.ts`).reason,
    'target-file-write-prohibited',
  );

  const directoryScope = '只允许修改 `src/` 下的生产代码，不得修改 `tests/`、`package.json`。';
  assert.equal(decide(directoryScope, `${root}/src/domain/policy.js`).allowed, true);
  assert.equal(decide(directoryScope, `${root}/tests/policy.test.js`).allowed, false);
  assert.equal(decide(directoryScope, `${root}/package.json`).allowed, false);

  const bareDirectoryScope = '只允许修改 include/ 和 src/。不得修改 CMakeLists.txt、test.sh 或 tests/。';
  assert.equal(decide(bareDirectoryScope, `${root}/src/domain/job_scheduler.cpp`).allowed, true);
  assert.equal(decide(bareDirectoryScope, `${root}/include/job_scheduler.hpp`).allowed, true);
  assert.equal(decide(bareDirectoryScope, `${root}/tests/job_scheduler.test.cpp`).allowed, false);

  const dedupePrompt = `请将仿真测试结果输出到 ${root}/docs/warranty-maintenance-advice-simulation.md，文件名需要保留 simulation 标识。`;
  assert.equal(decide(dedupePrompt, `${root}/docs/warranty-maintenance-advice-simulation-1.md`).allowed, true);
  assert.equal(
    decide(dedupePrompt, `${root}/other/warranty-maintenance-advice-simulation-1.md`).reason,
    'markdown-artifact-target-not-requested',
  );
  assert.equal(
    decide(dedupePrompt, `${root}/docs/warranty-maintenance-advice-notes-1.md`).reason,
    'markdown-artifact-target-not-requested',
  );
});

test('file-write authorization treats standalone programming requests as bounded source artifacts', () => {
  const root = '/workspace/project';
  const authorize = (promptText, relativeTarget) => authorizeAgentFileWriteContract({
    promptText,
    targetPath: path.join(root, relativeTarget),
    workspaceRoot: root,
  });
  const prompt = '编写一个 C++ 程序，打印下午好';
  const contract = buildTaskContract(prompt);
  assert.ok(contract.deliverables.includes('source-change'));
  assert.ok(contract.taskShapes.includes('standalone'));
  assert.ok(!contract.taskShapes.includes('existing-project'));
  assert.ok(!contract.taskShapes.includes('repair'));
  assert.ok(!contract.qualityObligations.includes('modification-plan'));
  assert.equal(authorize(prompt, 'hello.cpp').allowed, true);
  assert.equal(authorize(prompt, 'code/hello_afternoon.cpp').allowed, true);
  assert.equal(authorize(prompt, 'notes.txt').reason, 'target-file-write-prohibited');
  assert.equal(authorize(`${prompt}，不要创建文件。`, 'hello.cpp').reason, 'all-file-writes-prohibited');
  assert.equal(authorize('只回答代码，不要写文件：编写一个 C++ 程序，打印下午好。', 'hello.cpp').allowed, false);
  assert.equal(authorize('请创建 main.cpp。', 'hello.cpp').reason, 'target-file-write-prohibited');
});

test('semantic mutation targets distinguish writable directory scope from required files', () => {
  assert.deepEqual(
    resolveTaskMutationTargets('只允许修改 include/ 和 src/。不得修改 CMakeLists.txt、test.sh 或 tests/。'),
    [],
  );
  assert.deepEqual(
    resolveTaskMutationTargets('只修改 src/main.ts，不要修改其他文件。'),
    ['src/main.ts'],
  );
  assert.deepEqual(
    resolveTaskMutationTargets('Only modify files under src/; leave tests/ unchanged.'),
    [],
  );
  assert.deepEqual(
    resolveTaskMutationTargets('读取 README.md 并翻译成 docs/readme.zh.md'),
    ['docs/readme.zh.md'],
  );
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
    ['Do not fix src/math.js.', 'src/math.js'],
    ['请读取 src/math.js 并说明问题，不要修改其他文件。', 'src/math.js'],
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
  assert.equal(authorize(
    '这是一次多轮需求的最终轮：前面曾说写 INITIAL_REQUIREMENT，但现在改为 FINAL_REQUIREMENT_OK。请只按最新要求创建 journey-result.txt，文件内容必须精确包含一行 FINAL_REQUIREMENT_OK。完成写入和读回验证后结束任务，不要创建旧要求文件。',
    'journey-result.txt',
  ).allowed, true);
  assert.equal(authorize('不要修改现有源码。更正：更新 src/main.ts。', 'src/main.ts').allowed, true);
  assert.equal(authorize('Do not modify existing source. Correction: update src/main.ts.', 'src/main.ts').allowed, true);
});

test('explicit nested standalone source path remains allowed under no-other-file constraint', () => {
  const root = '/workspace/project';
  const prompt = [
    '我在真实项目里需要一个小 Python 命令行工具 tools/log_summary.py。',
    '它从 stdin 读取日志文本，统计包含 ERROR 和 WARN 的行数，输出格式先用 ERROR=<n> WARN=<n>。',
    '请实现最小版本并用 python 命令自测；不要引入依赖，不要改其他文件。',
  ].join('');
  const authorize = target => authorizeAgentFileWriteContract({
    promptText: prompt,
    targetPath: path.join(root, target),
    workspaceRoot: root,
  });

  assert.equal(authorize('tools/log_summary.py').allowed, true);
  assert.equal(authorize('tools/other.py').reason, 'artifact-other-file-write-prohibited');
  assert.equal(authorize('src/log_summary.py').reason, 'artifact-other-file-write-prohibited');
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

test('code identifiers ending in Report do not create documentation deliverables', () => {
  const contract = buildTaskContract([
    '请重构现有 C++ EventBus。',
    '在 PublishReport.failures 中按调用顺序记录 handler 异常。',
    '只允许修改 include/ 和 src/，运行 ./test.sh。',
  ].join('\n'));

  assert.equal(contract.taskShapes.includes('documentation'), false);
  assert.equal(contract.deliverables.includes('report'), false);
  assert.ok(contract.deliverables.includes('source-change'));
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
