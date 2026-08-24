# DevSeek Post-R4 非权限后续迭代整理

## 1. 整理范围

本文件按用户 2026-07-24 指令整理：权限相关迭代先放置，先列出无需新增窗口、安装、live Provider、外部 authority 或 Gate0/R1 qualification 授权即可继续推进的后续迭代项。

本文件只做计划整理，不声明任何资格通过：

- `qualification_effect=NONE`
- `claims=[]`
- `Gate0=NOT_PASSED`
- `R1 qualification=NOT_STARTED`
- 不关闭已有 VS Code 或 DeepSeek 页面
- 不安装、卸载或替换 VSIX
- 不运行真实 DeepSeek live Provider
- 不读取密钥、cookie、token、账号隐私或完整命令行

## 2. 已挂起的权限/外部授权支线

以下任务先放置，不作为当前非权限迭代领取项：

| 项 | 当前原因 | 恢复条件 |
| --- | --- | --- |
| `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME` 完整收口 | 受限观察显示 stable runtime count=`0`，tracked identity 仍是旧 `00449c6` | 用户授权窗口/安装/runtime 激活动作，或提供 external clean candidate identity receipt |
| `R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION` | 真实 headed live qualification 未授权 | 用户明确授权 headed + keep-window + keep-deepseek-page live run |
| `R4-LIVE-AUTH-03-HOLDOUT-PROFILE` | protected holdout profile 未批准 | profile owner 提供 approved profile/runner/failure taxonomy |
| `R4-LIVE-AUTH-04-TRUSTED-EVIDENCE` | trusted evidence manifest/time/retention/anchor 未提供 | 外部 evidence authority 提供 approved artifacts |
| `R4-LIVE-AUTH-05-QUALIFICATION-IMPORT` | 独立 qualification import authority 未批准 | 独立 authority 批准导入 Gate0/R1 ledger |
| `R4-02A`～`R4-02G` frozen RC smoke | 需要 frozen candidate、slot receipt、profile/runner、可能的窗口/安装授权 | 前置均通过且每 slot 单独授权/receipt |
| `R4-03A`、`R4-03S-*`、`R4-03B` protected holdout | 需要 signed plan、盲评 oracle、sealed aggregate、外部 custody | 外部 authority 签发 plan/slot/aggregate |
| `G0-13`/`G0-14` formal protected qualification | EXT-01..05 仍 blocked，external blockers=6 | EXT approved artifacts 可用 |

## 3. 当前本地事实

| 事实 | 值 |
| --- | --- |
| R4 原始叶子总数 | `6` |
| R4 已完成本地/process 叶子 | `5` |
| R4 当前未完成叶子 | `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME` |
| Clean runtime 受限观察结论 | `BLOCKED` |
| 受限观察 expected candidate | `a034e5e050c044460fb07705639d9d41e6b193c0` |
| 受限观察 expected VSIX | `027ef950a79a576444eaf3075d689b44ef0af8bec3d22df65ca61ed2cc1df19d` |
| 受限观察 stable runtime count | `0` |
| 受限观察 tracked identity | old `00449c6`, observe=`failed` |
| R3 local leaves | 本地 R3 through `R3-09B` 已关闭；real-provider qualification deferred |
| R1/R2 local product-side track | 已进入 product-side nonqualification，不能产生 qualification claim |

## 4. 非权限可继续迭代队列

### NP-01 R4 状态 rollup source-binding refresh

目标：把新产生的授权说明和 clean-runtime 受限观察报告纳入 R4 状态 rollup 的 source binding。

允许动作：

- 更新 R4 rollup schema/builder/checker/generated view。
- 保持 R4 原始叶子数仍为 `6`。
- 将 clean-runtime terminal state 保持为 `BLOCKED`，不能改成 PASS。
- 新增测试防止 rollup 把受限观察误当成 live qualification 或 clean runtime completion。

验证：

- `npm run verify:r4-iteration-status-rollup`
- `npm run verify:r4-clean-runtime-limited-observation`
- `git diff --check`

不允许：

- 不刷新 current candidate identity 为 PASS。
- 不关闭窗口、不安装 VSIX、不跑 live。

### NP-02 R4 process verifier aggregate

目标：新增一个本地 aggregate checker，一次性验证 R4 相关 process artifacts 没有 drift。

覆盖对象：

- release candidate manifest
- doc process identity reconciliation
- live qualification request packet
- user-way holdout matrix
- provider failure taxonomy
- iteration status rollup
- authorization guide
- clean-runtime limited observation

验证：

- 新增 `verify:r4-process-artifacts` 或等价 checker。
- 检查所有 generated view 与 JSON source 一致。
- 检查所有 `qualification_effect=NONE`、`claims_permitted=false`、`asserts_gate_pass=false`。

不允许：

- 不把 aggregate 结果解释为 Gate0/R1。
- 不消费 live evidence。

### NP-03 Existing live failure receipt taxonomy mapping

目标：只消费已有 live/controlled 失败证据，把已发生的失败映射到 `R4-REAL-PROVIDER-FAILURE-TAXONOMY`，不重跑。

输入：

- 现有 `report.json`
- run log
- changedPaths
- terminal settlement
- provider classification
- generated artifact quality
- 用户截图中已确认的 safety interstitial / `RESPONSE_CORRUPTED` 事实

输出：

- 一个 source-bound mapping report。
- 每条失败标记 category、证据路径、是否允许重跑。
- 缺证据的条目必须 `BLOCKED_NEEDS_EVIDENCE`。

不允许：

- 不补跑同一个红色 live loop。
- 不以截图或聊天描述单独作为完整证据。

### NP-04 Scenario language contract replay corpus

目标：围绕“测试 case 是中文就中文，英文就英文，不在产品里固定中文”增加本地 replay/unit corpus。

覆盖：

- zh-CN 输入 -> zh-CN 交付物。
- en-US 输入 -> en-US 交付物。
- zh-CN with English identifiers -> zh-CN 正文、保留技术标识。
- Markdown 审计报告、单文件写入、混合路径输入输出合同。

验证：

- focused unit/replay tests。
- holdout matrix generated view 保持 scenario language source=`scenario-contract`。

不允许：

- 不添加产品固定中文默认。
- 不跑真实 DeepSeek。

### NP-05 Provider protocol replay hardening

目标：用本地 replay 扩展 DeepSeek/Provider 协议失败覆盖，不触发真实 Provider。

覆盖：

- `RESPONSE_CORRUPTED`
- `incomplete-tool-block`
- named `tool_call` envelope
- fenced tool write
- malformed JSON
- safety interstitial 后的 interrupted provider response

验证：

- parser/provider-output-integrity/run-log-replay focused tests。
- 新旧失败不被后续成功覆盖。

不允许：

- 不发送 Provider prompt。
- 不把 parser replay 称为 live PASS。

### NP-06 Terminal settlement and recovered-write regression pack

目标：把 R3 live 历史中已经修复的 recovered write、terminal settlement、provider failure after local success 做成更紧的回归包。

覆盖：

- 本地写入+读回已满足后，后续 Provider/fetch failure 不得翻案。
- recovered write 必须有 `recovery.completed` 和 `run.settled(completed)`。
- duplicate recovery start 必须被忽略而不是 degraded。
- terminal timeout report 必须指向 report-time snapshot，而不是旧 bridge status。

验证：

- RunContext/completion evidence/workflow compliance focused tests。
- 不新增 live run。

### NP-07 Artifact evidence settlement convergence

目标：生成文件只可由模型归一化后的 TaskContract、声明目标、源码 claim 验证和真实 readback 证据结算，降低假完成概率。

覆盖：

- 声明的交付目标必须真实写入，无关文件不能代替目标。
- 非代码交付物必须具有匹配目标的 readback 证据。
- 源码事实型交付物必须具有结构化 claim 契约和逐项验证结果。
- Markdown 与源码写入统一经过 canonical tool、mutation 和 completion settlement 边界。
- 旧 domain/language 关键词 artifact oracle 保持彻底退役。

验证：

- completion evidence、auto validation 与 workflow compliance 本地测试。
- controlled VSIX harness 的 generated artifact quality 回执保持独立 live 证据边界。

不允许：

- 不恢复按任务领域、关键词或语言猜测完成条件的旁路 oracle。
- 不用 Markdown 自评替代机器检查。

### NP-08 Doc/process governance compact index

目标：给长链路文档增加一个短索引，标明当前权威、历史支持文档、已挂起授权支线、非权限可领取队列。

输出：

- 一个 source-bound generated view 或人工短索引。
- 指向 `14`、`16`、`20`、R4 rollup、authorization guide、clean-runtime observation。

验证：

- doc governance checker 或 `git diff --check`。

不允许：

- 不重写历史事实。
- 不删除旧失败记录。

### NP-09 Local full regression checkpoint

目标：在不安装、不打开窗口、不跑 live 的前提下，对当前 HEAD 做纯本地 full regression checkpoint。

候选命令：

- `npm run compile --workspace=packages/vscode-extension`
- `npm test --workspace=packages/vscode-extension`
- relevant process verify scripts
- `npm run verify:architecture-drift`
- `npm run verify:doc-governance`
- `git diff --check`

不允许：

- 不运行 `extension:package:*` 后安装链路。
- 不运行 controlled VSIX self-loop，除非用户另行授权本地窗口/VSIX 行为。
- 不运行 real DeepSeek。

### NP-10 External authority packet readiness audit

目标：只审计 EXT/R4 live request packet 是否表达清晰、blocker 是否精确、恢复授权语句是否可执行。

输出：

- readiness audit report。
- 不改变 request terminal state。

不允许：

- 不把 request packet 改成 approved。
- 不写 qualification ledger。

## 5. 推荐执行顺序

建议先从最不侵入、最能减少后续混乱的项目开始：

1. `NP-01 R4 状态 rollup source-binding refresh`
2. `NP-02 R4 process verifier aggregate`
3. `NP-03 Existing live failure receipt taxonomy mapping`
4. `NP-04 Scenario language contract replay corpus`
5. `NP-05 Provider protocol replay hardening`
6. `NP-09 Local full regression checkpoint`

理由：

- `NP-01` 和 `NP-02` 先把当前事实收紧，防止 R4 blocked 状态散落。
- `NP-03` 到 `NP-05` 能把已发生的 live 问题转成本地可复测 oracle，不需要重跑 Provider。
- `NP-09` 适合作为若干小迭代后的本地健康检查，不替代 package/install/live evidence。

## 6. 当前不建议领取的项

| 项 | 原因 |
| --- | --- |
| `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME` 完整 PASS | 需要窗口/安装/runtime 激活授权或外部 clean identity receipt |
| `R4-02*` / `R4-03*` | 需要 profile、slot、sealed aggregate、外部 authority |
| real DeepSeek live rerun | 当前被授权支线挂起；且同红 loop 必须先完成证据分析 |
| current candidate identity refresh-to-PASS | 当前 stable runtime count=`0`，不能只写文件伪造 runtime |
| Gate0/R1 qualification 修改 | EXT approvals 不存在，外部 blockers 仍为 6 |

## 7. 结论

权限支线放置后，当前最合适的非权限迭代是先做 R4 process/status 的源绑定收紧，然后把已有 live 失败沉淀为本地 replay/oracle。这样可以继续提升产品收敛质量，同时不触碰窗口、安装、live Provider 或外部资格授权。
