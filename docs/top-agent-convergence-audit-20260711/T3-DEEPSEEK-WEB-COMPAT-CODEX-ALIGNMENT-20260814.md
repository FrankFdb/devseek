---
devseek_governance:
  generator: "manual-codex-t3-alignment/v1"
  status: "local-evidence"
  path: "docs/top-agent-convergence-audit-20260711/T3-DEEPSEEK-WEB-COMPAT-CODEX-ALIGNMENT-20260814.md"
  source_group: "audit"
  decision: "accepted-local-t3"
  relationship: "deepseek-web-provider-output-compatibility"
  asserts_gate_pass: false
---

# T3 DeepSeek Web 兼容与 Codex 源码对标

- 日期：2026-08-14
- 版本基线：`2.0.23`
- 本轮精确 VSIX：`devseek-netai-2.0.23-debug.20260814.t170131.g19cee47.vsix`
- 结论：`PASS`

## 对标结论

Codex 固定源码快照：`code/upstream-agent-sources/openai-codex` @ `fe614a6304ef804be74a622e482fdd75977abcba`。

本轮 T3 只把 Codex 源码可审计行为作为硬基线。Claude Code 核心源码不作为本地硬证据；后续如要更新 Claude Code 对标，只能基于可审计源码或明确标注为公开行为观察。

Codex 关键契约：

- `codex-rs/core/src/tools/router.rs:153-205` 将 `FunctionCall`、`ToolSearchCall`、`CustomToolCall` 归一化为统一 `ToolCall`。
- `codex-rs/core/src/tools/registry.rs:520-590` 对未知工具、payload 类型不兼容和 pre-tool hook 阻断做显式错误处理；可恢复错误返回模型，不沉默完成。
- `codex-rs/core/src/tools/parallel.rs:72-85`、`:230-245` 将非致命工具失败转换为模型可见 failure response，而不是把坏工具输出当成最终答案。

DevSeek 对策：DeepSeek Web 返回自然语言、Markdown、坏 JSON、半截工具或 provider footer 时，先进入本地工具协议归一化层。可恢复工具调用进入执行与证据闭环；无法恢复或截断的工具请求 fail closed；provider 自写的工具结果文本不能作为完成证据。

## 本轮实现

- `packages/vscode-extension/src/agent/fake-tool-parser.ts`
  - 支持从 quote-damaged OpenAI `tool_calls` wrapper 中恢复一个或多个工具调用。
  - 支持解析 Markdown 编号列表中的多个独立 JSON 工具对象。
  - `stripToolCallBlocks()` 会剥离已恢复的工具 payload，保留用户可见自然语言，不泄漏协议 JSON。
  - 保留 artifact JSON array 防误判保护，避免把普通报告内容误当工具。

- `packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs`
  - 新增 `t3-deepseek-web-compat` 套件。
  - 新增 `t3-deepseek-malformed-openai-tool-calls`：模拟 DeepSeek Web 生成 quote-damaged `tool_calls` wrapper，要求创建文件、读回、完成。
  - 新增 `t3-deepseek-markdown-json-tool-list`：模拟网页把工具 JSON 编号混入 Markdown，要求创建文件、读回、完成，且禁止终端运行。

- `scripts/devseek-top-agent-user-simulation-runner.mjs`
  - `t3-deepseek-web-compat` 进入默认 controlled suites 和 acceptance suites。
  - 新增 case design 维度 `deepseek_web_tool_json_compatibility`。
  - 强制验收 case 从 `65` 增至 `67`。

## 仿真用户 Case

| Case | 用户输入摘要 | 覆盖点 | 通过条件 |
| --- | --- | --- | --- |
| `t3-deepseek-malformed-openai-tool-calls` | “DeepSeek 网页刚才吐了奇怪的 tool_calls JSON。请创建 reports/malformed-wrapper-result.txt，内容必须是一行 MALFORMED_WRAPPER_OK。写完读回确认，不要修改其他文件。” | quote-damaged OpenAI wrapper、多工具恢复、provider footer 剥离 | 只创建指定文件；readback 匹配；`create_file/read_file/task_complete` 真实执行；不运行终端；无额外修改 |
| `t3-deepseek-markdown-json-tool-list` | “如果网页把工具 JSON 编号列出来，也要正常执行。请创建 reports/markdown-json-list-result.txt，内容必须是一行 MARKDOWN_JSON_LIST_OK。写完读回确认，不要运行终端，不要改其他文件。” | Markdown 编号 JSON、多对象扫描、no-run 约束 | 只创建指定文件；readback 匹配；`create_file/read_file/task_complete` 真实执行；`run_terminal` 禁止；无额外修改 |

## 验证证据

- Parser 与 provider integrity：`node --test packages/vscode-extension/test/unit/fake-tool-parser.test.mjs packages/vscode-extension/test/unit/provider-output-integrity.test.mjs`，`138/138 PASS`。
- Runner contract：`node --test scripts/test/devseek-top-agent-user-simulation-runner.test.mjs`，`12/12 PASS`。
- Controlled VSIX prompt contract：`node --test packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs`，`74/74 PASS`。
- Release loop：`npm run extension:package:debug` PASS，`code --install-extension devseek-netai-latest.vsix --force` PASS，`npm run verify:packaged-bridge` PASS。
- T3 focused exact-VSIX 仿真：`20260814-t3-deepseek-web-compat` PASS，报告 `docs/testing/devseek-20260814-t3-deepseek-web-compat.md`。
- 默认 acceptance exact-VSIX 仿真：`20260814-t3-deepseek-web-compat-acceptance` PASS，报告 `docs/testing/devseek-20260814-t3-deepseek-web-compat-acceptance.md`。
- Acceptance 结果：`85` 个 selected case，`67` 个 required acceptance case，`34/34` 维度覆盖，缺失维度 `0`，execution evidence missing `0`。

## 后续 T3 入口

后续 DeepSeek Web 兼容不再靠新增关键词命中。新网页异常应先沉淀为最小 provider-output fixture，再纳入 fake parser/provider integrity 单测，最后进入真实 VSIX user simulation。

优先补充方向：

- 半截工具调用：确认 fail closed、零写入、有界重试。
- 重复命令：确认同一失败不无限循环，且错误回灌模型。
- 错误后恢复：第一次坏 wrapper 失败后，第二次有效工具调用能继续完成。
- 真实网页 live sample：只有用户授权保留窗口和 DeepSeek 页面时执行，并明确标注为 live Provider evidence。
