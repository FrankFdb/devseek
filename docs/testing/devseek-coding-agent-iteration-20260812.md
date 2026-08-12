# DevSeek 编程智能体迭代测试报告 2026-08-12

## 结论

本轮不能宣称已经达成“顶级编程智能体”目标。

DevSeek 已经从“public pass / hidden fail 仍误报完成”推进到“失败会阻断完成”，并补上了面向修正点的小 case 验证。但真实链路 `VS Code extension -> DevSeek -> free DeepSeek Web` 在 `11-order-book` 大 case 上仍失败，attempt-21 还暴露了 DeepSeek Web 输出 C++ 函数体片段覆盖整文件后长时间未收束的问题。

## 仿真测试证据

主测试用例：`code/devseek-tests/cpp-user-matrix/cases/11-order-book/prompt.md`

| Attempt | 报告 | 结果 | 关键观察 |
| --- | --- | --- | --- |
| attempt-15 | `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-15/report.md` | FAIL | public PASS、hidden PASS，但产品未形成成功完成证据；生成的 Markdown/todo 干扰完成判定。 |
| attempt-16 | `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-16/report.md` | FAIL | public PASS、hidden FAIL；发现无效/重复订单返回空 trades，调用者无法区分拒绝和合法无成交。 |
| attempt-17 | `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-17/report.md` | FAIL | hidden FAIL，但 canonical completion 曾误判完成。 |
| attempt-18 | `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-18/report.md` | FAIL | hidden FAIL，继续暴露完成判定缺少最终需求审查阻断。 |
| attempt-19 | `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-19/report.md` | FAIL | canonical completion 已变为 failed；仍有 used id 生命周期缺陷。 |
| attempt-20 | `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-20/report.md` | FAIL | canonical completion failed；hidden 在 `remaining("b1") == 1 && bestBid() == 9` 失败，暴露部分成交后索引数量不同步。 |
| attempt-21 | `code/devseek-tests/cpp-user-matrix/runs/11-order-book/attempt-21/report.md` | FAIL | 900s timeout，public/hidden 都 FAIL；`src/order_book.cpp` 被 11 行裸 `if` 片段覆盖，随后进入只读审查/读取坏源码循环。 |

## 已修正问题

- VS Code 启动时 `DevSeek MCP 初始化未完全成功：config:config-read:error`：缺失可选 MCP config 时按 ENOENT 处理，不再启动噪声告警。
- 完成误判：最终 settlement 会检查 requirement review blocker，failed/indeterminate/incomplete review 不能进入成功完成。
- 需求审查证据：审查 prompt 要求对排序、FIFO、best bid/ask、拒绝路径、used id 生命周期给出具体执行轨迹。
- 审查解析：当逐条表格有瑕疵但 findings 有可追溯源码反例时，保留 actionable findings 并阻断完成。
- 部分成交状态一致性：新增小 case，检测 `remaining()` 读取 id 索引副本而部分成交分支只更新价格层容器的缺陷。
- C++ 片段覆盖：新增写入闸门，拒绝把顶层裸 `if/return/throw` 等函数体片段作为完整 `.cpp/.hpp` 文件写入。
- DeepSeek Web fragment overwrite：既有长文件截断覆盖拦截保留，并补上 attempt-21 暴露的短文件裸语句覆盖形态。

## 对三点问题的检讨

1. DeepSeek 网页交付错误后的重复循环仍未完全解决。
   attempt-21 证明：当文件已被坏片段覆盖后，系统虽然不断要求只读重试审查，但没有优先恢复可编译源码或中止无效审查循环。已补写入闸门防止同类坏写入再次落盘；下一步需要在编译级语法失败后暂停 requirement review，优先按最近 baseline/完整文件重写协议恢复。

2. 不应每次修一个点就从 0 跑大 case。
   本轮已经采用分层验证：真实大 case 暴露缺陷 -> 针对缺陷建立微型源码 case -> 跑受影响单测 -> 跑扩展全量回归。后续只有在微 case 和回归都通过后，才跑大 case 作为门禁，而不是每个小修立即 attempt+1。

3. 权限可以放宽，但必须是“给定目录/隔离目录”的受控放宽。
   对编程智能体来说，在用户明确给定的输出目录或隔离验证目录中新建文件风险较低，DevSeek 已支持 scoped isolated artifact allowance。仍不应全局放宽：工作区根配置、隐藏运行目录、受保护源码边界、symlink escape、父级目录和用户禁止路径必须继续拒绝。

## 对标 Claude Code / Codex 的优化方向

成熟编程智能体在这类任务中应当做到：

- 先建立最小可复现路径，再做全量回归。
- 错误反馈必须指向当前失败点，而不是重启完整任务。
- 源码写入必须有结构完整性保护，不能让模型片段直接覆盖整文件。
- visible tests 只能作为证据之一，不能让 public PASS 覆盖独立需求审查和隐藏行为风险。
- 对固定 public API 的拒绝语义，空成功返回不能替代异常或可区分失败通道。

## 验证记录

- `node --test packages/vscode-extension/test/unit/independent-requirement-review.test.mjs packages/vscode-extension/test/unit/requirement-review-ledger.test.mjs`: PASS
- `node --test packages/vscode-extension/test/unit/workspace-edit-service.test.mjs`: PASS
- 受影响集合 67 tests: PASS
- `npm run compile --workspace=packages/vscode-extension`: PASS
- `npm test --workspace=packages/vscode-extension`: 173 suites PASS
- `npm run shared:test`: 321 tests PASS
- `npm run verify:architecture-drift`: PASS
- `npm run extension:package && code --install-extension packages/vscode-extension/devseek-netai-latest.vsix --force`: 已安装 `1.0.0-debug.20260812.t124715.gea8f8c8`

## 下一轮优先级

1. 编译失败恢复闸门：当 changed C++ file 在第 1 行出现 `expected unqualified-id` 等整文件结构错误时，禁止进入只读需求审查循环，要求恢复完整源码或重写完整文件。
2. 循环检测：同一坏源码快照、同一 validation signature、同一 read_file 请求重复出现时，应停止 DeepSeek Web 继续消耗轮次并给出修复协议。
3. 再跑 `11-order-book` 大 case 前，先补一个“坏 C++ 片段写入被拒绝后模型用 replace_in_file 精修”的真实/准真实小 case。
