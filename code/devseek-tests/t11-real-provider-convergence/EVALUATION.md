# T11 真实 Provider 编程收敛评估

## 1. 范围与结论

T11 不重复 T1-T10 的通用意图分类用例，而是用真实 DeepSeek Web 完成一个中等规模、五文件、
跨进程持久化的 Node.js CLI，再用独立黑盒测试审查模型没有自测到的公共入口边界。受影响的
协议、路径、验证、完成和 UI 状态随后进入 17 套 60 个产品流程的 exact-VSIX 回归。

本轮本地结论：

- 最新真实 Provider 任务成功交付 5 个指定文件，最终项目自测 `16/16`，独立黑盒 `8/8`。
- 前一候选虽然项目自测和 harness 均显示通过，独立黑盒仍稳定发现 2 个公共入口缺陷；这证明
  holdout 不是实现自证的重复测试。
- exact-VSIX 产品矩阵 `17/17 suites`、`60/60 cases` 通过。
- Extension `197/197 suites`、Phase10、架构漂移、T6 生命周期、run-evidence contract 和
  packaged Bridge 全部通过。

这些结果证明 `2.0.32` 在本轮本地范围内收敛，不等于 Codex/Claude Code 整体能力认证，也
不替代 C14 受保护 RC、sealed holdout 和外部 authority。

## 2. Codex 源码基线

主基线是本地保留的 OpenAI Codex 源码：

- 路径：`code/upstream-agent-sources/openai-codex`
- commit：`fe614a6304ef804be74a622e482fdd75977abcba`
- `codex-rs/core/src/session/turn.rs:273-279`：一个 turn 内复用模型 session，并把 pending user
  input 作为后续模型步骤输入。
- `codex-rs/core/src/session/turn.rs:349-405`：从结构化 history 构造下一次模型请求，不用本地
  关键词替代主模型语义。
- `codex-rs/core/src/session/turn.rs:2198-2366`：结构化 `ResponseItem` 进入统一 output handler，
  tool future 和 follow-up 由 agent loop 驱动。
- `codex-rs/core/src/input_queue.rs:19-30,64-78,252-278`：中途 steering 进入有序输入队列，
  由当前 turn 消费。
- `codex-rs/core/src/compact.rs:59-79,271-345`：压缩后保留可继续执行的结构化历史，而不是把
  摘要文本当成新授权。

源码确认的是责任边界，不是 TypeScript 应照抄 Rust 文件结构。DevSeek 对齐为：保留原始用户
输入，由模型提出语义和动作，本地逐个仲裁具体工具，真实结果回注，同任务可接受 steering，
最后只根据当前回执结算。

Claude Code 的产品核心循环没有可完整审计的公开源码，本轮只把其公开文档和可观察行为作为
补充，未声称确认其闭源内部实现。

## 3. 仿真发现的缺陷类别与结构性修复

| 缺陷类别 | 真实表现 | 根因 | 本轮 owner 级修复 |
| --- | --- | --- | --- |
| 浏览器动作重复 | Provider 已确认消息送达，等待响应超时后仍可能把同一 prompt 再发送一次 | retry owner 只知道“尚无输出”，不知道不可安全重放的外部提交已发生 | Bridge dispatch port 在 DOM 提交确认后记录 `providerSubmissionAttempt`；提交前错误可有界重试，提交后错误停止重放 |
| 混合工具协议 | 一次回复可同时出现不兼容 XML/Calling/JSON 工具表示 | parser 采用“首个能解析的 dialect”，没有跨 dialect 冲突仲裁 | `model-tool-protocol-adapter` 汇总协议 match；不同位置出现新增工具时 fail closed，payload-only parser 不制造假冲突 |
| 损坏响应污染后续轮 | malformed response 被拒绝后，浏览器会话仍保留该回复 | 本地恢复重试和远端 conversation 状态没有共同 cursor | 每个被拒绝的 Provider 回复都重建浏览器 session；prompt cursor 只提交成功请求，history 分叉时 reset-full |
| 增量上下文漂移 | 本地压缩后的 assistant 文本与网页原始回复字节不同，导致重复发送完整上下文 | cursor 把本地 assistant 响应 hash 当成远端确认位置 | cursor 记录 request message hashes；网页已拥有的一个 assistant turn 按角色跳过，其他前缀漂移全部重置 |
| 路径错投与斜杠误判 | 根目录 `package.json` 被对齐到 `src/`；`high/normal/low`、`CPU/GPU` 可能被当成路径 | exact file、目录 scope、枚举列表和自然语言斜杠词共用弱路径启发式 | path owner 增加 exact file hints、同一枚举中的根文件提升和目录内包含关系；共享 path intent 排除斜杠词汇 |
| 完成清单重开任务 | 模型完成后输出“任务清单”会被当成新计划，造成多余循环 | fallback todo parser 不知道真实 work tool 已经执行 | todo adoption 只允许发生在 substantive work 之前；完成候选和普通进展文本分开 |
| 退出码 0 的假通过 | 自定义测试打印 `Tests: 14 passed, 14 failed`，但进程退出 0，旧逻辑仍接受 | verifier 只信 exit code，输出诊断只处理 C/C++ warning | validation diagnostics 结构化识别 Jest/custom、TAP、pytest/Mocha、Maven、Rust 和中文正失败计数；正数失败 fail closed，零失败不误报 |
| 自测遗漏公共入口 | 模型测试覆盖 service，却接受空白描述和 `1abc` 部分数字 ID | 工程 prompt 没要求从真实 public entrypoint 独立验证边界 | 集中 `USER_ENTRYPOINT_DELIVERY_RULES`：CLI/API/UI 必须运行真实入口，输入先 normalize 后 validate，并覆盖明确要求的失败和边界 |
| harness 交付类型误判 | 只指定代码成果物时仍套用正式 Markdown 质量门禁 | scenario 名称比显式 deliverables 拥有更高优先级 | quality profile 由实际 Markdown/code deliverables 专门化，代码任务不再要求无关报告 |
| 等待动画误导 | 已就绪界面仍显示循环移动条，像一直在等待 | ready indicator 使用无限动画表达静态状态 | 改成稳定的 VS Code progress 色带，并在 done 后隐藏；可访问性回归固定状态语义 |

修复没有为本次 todo prompt 添加任务关键词分支。模型仍负责理解自然语言和生成实现；本地代码
只拥有协议完整性、路径/权限、真实执行、验证证据和完成结算。

## 4. 独立真实用户黑盒

`held-out-todo-cli.mjs` 把待测项目复制到全新沙箱，通过真实 CLI 子进程操作，动态发现其持久化
JSON 和实际 ID 类型。它不导入生产类、不要求固定目录或数字 ID，因此允许 UUID、不同存储路径
等合理实现。

八类检查：

1. 无第三方 runtime dependency。
2. 三种 priority 跨 CLI 进程持久化。
3. status filter 与 done 跨进程保持。
4. stats 与持久化状态一致。
5. 非法命令、状态、priority 和未知任务明确失败。
6. 空白描述失败。
7. 仅在实现采用数字 ID 时验证部分数字不能被接受。
8. repository 使用同目录临时文件加 rename。

差分结果：

- 最新 workspace `/tmp/devseek-t11-live-entrypoint.RUv9WE`：`8 passed, 0 failed`。
- 前一 workspace `/tmp/devseek-t11-live-evidence.kaDZEO`：`6 passed, 2 failed`，稳定发现空白描述
  和部分数字 ID 两类缺陷。

## 5. 真实 Provider 结果

最终真实运行：

- report：`/tmp/devseek-real-plugin-deepseek-HNGIfD/report.json`
- workspace：`/tmp/devseek-t11-live-entrypoint.RUv9WE`
- elapsed：`206802 ms`
- run log：`254` events，`20` 次工具执行，`5` 个 committed mutation。
- 浏览器实际 `message-sent`：`8`，`chat-request-retry`：`0`。
- 最终状态：`completed`；实现、验证两个必需 stage 均通过。
- 生成文件：`package.json`、`src/json-file-repository.js`、`src/task-service.js`、
  `src/cli.js`、`test/task-service.test.js`。
- 模型自测：`16/16`，显式输出 `Failed: 0`；独立黑盒再得 `8/8`。

运行中 DeepSeek 曾产生 malformed JSON tool content 和非契约 Calling 文本。完整性层阻止了损坏
动作，恢复轮重建会话，后续有效工具才进入本地仲裁；没有把损坏 proposal 当作已执行效果。

前一真实运行 `/tmp/devseek-real-plugin-deepseek-o6346e/report.json` 也被 harness 判定完成，但独立
黑盒发现 2 个入口缺陷。该差异是本轮继续迭代的依据，而不是删除失败样本后只报告最终成功。

## 6. 全面产品仿真与工程门禁

预提交 exact VSIX：

- build：`2.0.32-debug.20260819.t120353.g4f6c3b6`
- artifact：`packages/vscode-extension/devseek-netai-2.0.32-debug.20260819.t120353.g4f6c3b6.vsix`
- SHA-256：`4316329173e609f0fcf5e0b76af7e1efeae35c4431d30d906d16718b45deee72`
- aggregate：`/tmp/devseek-t11-controlled-final/aggregate.json`
- result：`17/17 suites`、`60/60 cases`、`0 error`

工程门禁：

- `npm test --workspace=packages/vscode-extension`：`197/197 suites`。
- `npm run verify:phase10`：Shared、Bridge、CLI `83` tests、Headless `25` tests、Extension
  typecheck/compile 全部通过。
- `npm run verify:architecture-drift`：`0 violation`。
- `npm run verify:t6-lifecycle`：HTTP graceful shutdown 与 extension-host parent exit 通过。
- `npm run verify:run-evidence-contract`：`38/38`，6 schemas、30 event types、19 critical
  operations。
- `npm run verify:packaged-bridge`：packaged Bridge health `200`。
- `git diff --check`：通过。

`npm run verify:doc-governance` 保持既有 `2/4` 历史库存失败：legacy inventory 只登记 31 份，
当前受治理文档为 60 份，缺 29 条历史记录。该问题在 T11 开始前已存在，不是产品代码回归；本轮
没有伪造库存记录来让门禁变绿。

## 7. 复现

```bash
node code/devseek-tests/t11-real-provider-convergence/held-out-todo-cli.mjs \
  /tmp/devseek-t11-live-entrypoint.RUv9WE
npm test --workspace=packages/vscode-extension
npm run verify:phase10
npm run verify:architecture-drift
npm run verify:t6-lifecycle
npm run verify:run-evidence-contract
npm run verify:packaged-bridge
node code/devseek-tests/t9-t10-provider-efficiency/run-comprehensive-product-simulation.mjs \
  --vsix packages/vscode-extension/devseek-netai-2.0.32-debug.20260819.t120353.g4f6c3b6.vsix \
  --report-dir /tmp/devseek-t11-controlled-final
```

真实 DeepSeek Web 运行依赖当前登录状态和外部服务可用性，不能把旧 report 当作新候选的实时
Provider 回执。最终提交后重新打包的 VSIX 会有新的 commit identity；以仓库根目录
`devseek-netai-latest.vsix`、`git log -1` 和本地已安装版本为最终交付身份。
