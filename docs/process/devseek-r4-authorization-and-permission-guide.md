# DevSeek R4 授权与权限操作说明

## 1. 当前授权确认

本文件记录 2026-07-24 用户对 R4 后续迭代的授权边界。

当前用户授权的范围是：

- 可以继续推进 `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME` 的受限本地迭代。
- 可以做只读的本地身份检查，目标是判断当前候选 runtime 是否能形成 clean candidate identity。
- 可以在仓库内新增或更新与本授权、检查结论、证据路径相关的文档或 process artifact。
- 可以运行本地静态检查、schema/checker、node 单元测试，以及不触碰 live Provider 的本地验证命令。
- 如果证据充分，可以准备 clean candidate identity 的本地候选记录；若需要窗口动作、安装动作或真实 Provider 动作，必须先停止并再次请求用户确认。

当前授权不包含：

- 不允许关闭已有 VS Code 窗口。
- 不允许关闭已有 DeepSeek 页面。
- 不允许安装、卸载或替换 VSIX。
- 不允许运行真实 live Provider qualification。
- 不允许向 DeepSeek 页面发送任务、点击执行、点击安全重试或读取账号隐私内容。
- 不允许读取、保存、截图或转录密钥、cookie、token、账号信息、聊天隐私内容。
- 不允许 push、发布、打包安装或执行破坏性 git 操作。
- 不允许把本地文档、fixture、本地 PASS 或 Markdown 结果升级为 Gate0/R1 qualification。

因此，本次授权只解除 `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME` 的本地安全前置阻塞；不解除 live、holdout、Gate0/R1 或外部 authority 阻塞。

## 2. 操作权限分层

| 权限层 | 当前状态 | 允许动作 | 禁止动作 | 何时需要再次授权 |
| --- | --- | --- | --- | --- |
| Repo read | `AUTHORIZED` | `git status`、`git log`、`rg`、读取 docs/process/source/test | 无 | 不需要 |
| Repo write | `AUTHORIZED_SCOPED` | 写入 R4 授权说明、检查报告、schema/checker/generated view、本地非 live 测试 | 修改无关源码、扩大 claims、改 Gate0/R1 状态 | 触碰产品运行逻辑或资格状态时 |
| Local verification | `AUTHORIZED_SCOPED` | `npm run verify:*`、node 单元测试、静态 checker、compile 类本地命令 | live Provider、安装 VSIX、发布打包安装链路 | 需要真实窗口或安装时 |
| Runtime identity observation | `AUTHORIZED_LIMITED` | 只读检查当前本地进程、日志、候选 identity 文件、artifact hash | 关闭/重启/附着控制窗口、读取密钥、操作页面 | 需要关闭、重启、打开、安装或 Provider 页面动作时 |
| Existing window action | `NOT_AUTHORIZED` | 无 | 关闭/聚焦/复用/刷新 VS Code 或 DeepSeek 页面 | 用户明确写明允许哪一个窗口动作 |
| VSIX install/package action | `NOT_AUTHORIZED` | 无 | 安装、卸载、替换、打包后安装 | 用户明确授权具体 artifact 和命令 |
| Live Provider action | `NOT_AUTHORIZED` | 无 | headed live run、发送 prompt、点击网页、点击安全重试 | 用户明确授权 headed + keep-window + keep-deepseek-page live 条款 |
| External authority import | `NOT_AUTHORIZED` | 无 | 把本地结果导入 Gate0/R1、声明资格、修改 claims | 外部 authority 提供 approved artifact |

## 3. R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME 的执行方式

本 leaf 的目标是把当前候选身份从 `deferred-unusable-until-clean-runtime` 推进到可审计的 clean runtime identity，或者给出精确 blocker。

在当前授权下，执行顺序应为：

1. 读取现有 identity、release manifest、doc-process reconciliation、live request packet 与 rollup。
2. 只读检查本机可见的 DevSeek/VS Code Extension Host runtime 信息。
3. 对比 runtime artifact、VSIX hash、commit、workspace、extension id 与 release candidate manifest。
4. 如果存在 exactly-one stable runtime 且不需要窗口动作，则生成本地检查报告。
5. 如果证据不足或发现多个 runtime、stale runtime、unknown runtime，则以 `BLOCKED` 结算并记录 blocker。
6. 如果需要关闭窗口、重启 extension host、安装 VSIX、操作 DeepSeek 页面或跑 live，立即停止并请求单独授权。

该 leaf 的完成证据不能来自旧聊天记忆，只能来自 Git、工作树、机器 artifact、测试输出和本轮可复算证据。

## 4. 当前 R4 六项状态

| R4 leaf | 当前状态 | 是否需要用户处理 | 说明 |
| --- | --- | --- | --- |
| `R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME` | `AUTHORIZED_LIMITED_IN_PROGRESS` | 是 | 已获得本地受限授权；若需要窗口、安装或 live 动作会再次请求 |
| `R4-RELEASE-CANDIDATE-MANIFEST` | `COMPLETED` | 否 | 本地 release candidate manifest 已生成并验证；qualification effect=`NONE` |
| `R4-DOC-PROCESS-IDENTITY-RECONCILIATION` | `COMPLETED` | 否 | stale/current/archived identity 已区分；current candidate 仍需 clean runtime |
| `R4-LIVE-QUALIFICATION-REQUEST-PACKET` | `COMPLETED_REQUEST_ONLY` | 后续可能需要 | 只生成授权请求包；没有授权 live qualification |
| `R4-LIVE-USER-WAY-HOLDOUT-MATRIX` | `COMPLETED_REQUEST_ONLY` | 后续可能需要 | holdout case 已定义；case 语言来自 scenario contract，不固定中文 |
| `R4-REAL-PROVIDER-FAILURE-TAXONOMY` | `COMPLETED` | 否 | 已定义 live 失败分类与重跑前证据要求 |

## 5. 其他 R4/R4-02/R4-03 项需要怎样授权

### 5.1 Live Qualification 用户窗口授权

对应 request：`R4-LIVE-AUTH-01-USER-WINDOW-AUTHORIZATION`

需要用户明确授权：

```text
授权运行一次 DeepSeek headed live qualification。
必须 keep-window，必须 keep-deepseek-page。
允许使用当前已登录 DeepSeek 用户页面发送本次 scenario prompt。
不允许关闭页面；失败后先分析 report.json、run log、changedPaths、terminal settlement、provider classification 和生成文件质量，再决定是否重跑。
```

没有这项授权时，任何真实 DeepSeek live qualification 都必须保持 `BLOCKED`。

### 5.2 Clean Runtime Candidate 授权

对应 request：`R4-LIVE-AUTH-02-CLEAN-RUNTIME-CANDIDATE`

当前已经具备受限本地授权，但完整授权需要用户明确选择是否允许窗口或安装动作：

```text
授权 clean runtime identity refresh。
允许检查并隔离旧 debug runtime。
允许在必要时关闭或重启指定的 Extension Development Host。
允许在必要时安装指定 VSIX artifact。
不允许关闭 DeepSeek 页面，除非后续另行确认。
```

如果用户不授权关闭/重启/安装，则只能做只读身份检查和 blocker 记录。

### 5.3 Holdout Profile 授权

对应 request：`R4-LIVE-AUTH-03-HOLDOUT-PROFILE`

需要 profile owner 批准：

- 使用哪个 frozen candidate artifact。
- 使用哪个 headed DeepSeek user-way profile。
- 允许哪些 scenario family。
- 每个 case 的语言合同、重试预算、失败分类和停止条件。
- 是否允许进入 `R4-03A-PROTECTED-HOLDOUT-PLAN`。

没有此授权时，`R4-03A` 不能签发 slot，`R4-03S-*` 不能执行。

### 5.4 Trusted Evidence 授权

对应 request：`R4-LIVE-AUTH-04-TRUSTED-EVIDENCE`

需要外部 evidence authority 提供：

- trusted evidence manifest。
- 非回滚时间或外部时间锚。
- retention/WORM 约束。
- stream head 或外部锚定摘要。
- 证据保留与篡改检测规则。

没有此授权时，本地 report、截图或测试日志都不能升级为正式资格证据。

### 5.5 Qualification Import 授权

对应 request：`R4-LIVE-AUTH-05-QUALIFICATION-IMPORT`

需要独立 qualification import authority 批准：

- 哪些 evidence 可以导入 Gate0/R1。
- 哪些 claim 可被计算。
- 哪些 veto 会导致 fail closed。
- 是否允许修改 qualification ledger。

没有此授权时，Gate0 必须保持 `NOT_PASSED`，R1 qualification 必须保持 `NOT_STARTED`，claims 必须保持 `[]`。

### 5.6 R4-02 Canary/Medium/Formal 授权

对应 leaf：

- `R4-02A-CANARY-01`
- `R4-02B-CANARY-02`
- `R4-02C-CANARY-03`
- `R4-02D-MEDIUM-01`
- `R4-02E-MEDIUM-02`
- `R4-02F-FORMAL-01`
- `R4-02G-RC-AGGREGATE`

需要先满足：

- clean runtime identity 成立。
- frozen candidate 不变。
- profile/runner 已批准。
- 每个 slot 有独立 attempt receipt。
- 失败不能被补跑覆盖。
- aggregate 只消费已有 slot，不执行新 case。

这些不是单纯用户授权即可完成；还需要 profile、evidence 和 aggregate authority。

### 5.7 R4-03 Protected Holdout 授权

对应 leaf：

- `R4-03A-PROTECTED-HOLDOUT-PLAN`
- `R4-03S-<family>-<attempt>`
- `R4-03B-SEALED-HOLDOUT-AGGREGATE`

需要先满足：

- 外部 authority 冻结 disjoint family/slot denominator。
- oracle 对执行者不可见。
- signed plan 生成具体 slot ID。
- 每个窗口最多领取一个已签发 slot。
- sealed aggregate 由独立聚合器消费全部 receipt。

没有 signed plan 时，`R4-03S-*` 只是参数化模板，不能由仓库或模型自行造 72 个 case。

## 6. 建议的授权用语

如果只想继续当前安全前置，可以使用：

```text
授权继续 R4-CANDIDATE-IDENTITY-CLEAN-RUNTIME 的受限本地检查。
允许只读观察本地 runtime 身份和仓库 artifact。
允许写入 docs/process 下的检查报告。
不允许关闭窗口、不允许安装 VSIX、不允许真实 live Provider、不允许读取密钥。
如果需要更高权限，先停止并说明原因。
```

如果要进入真实 live qualification，需要另行使用：

```text
授权一次 R4 headed DeepSeek live qualification。
必须 keep-window + keep-deepseek-page。
允许发送指定 scenario prompt。
失败后必须先分析 report.json、run log、changedPaths、terminal settlement、provider classification 和生成文件质量。
不允许重复跑同一个红色 live loop 来覆盖失败。
```

如果要进入正式 Gate0/R1 qualification，需要另行提供：

```text
提供 EXT-01..05 approved external authority artifacts。
授权导入 trusted evidence。
授权 protected profile execution 或 sealed aggregate。
允许在满足 fail-closed oracle 后更新 qualification ledger。
```

没有上述外部 artifact 时，本仓库只能继续产品侧或本地 process 迭代，不能 claim Gate0/R1。
