我在维护一个大约千行的 C++17 部署运行库。现有 scheduler、inventory、retry、event bus 都已经可用，现在请把 deployment_coordinator 的占位实现补完整。

用户期望：
- addJob 在写入任何状态前验证空 id、重复 id、资源 sku/数量和 retry 策略；失败不能留下半注册任务。
- preview 只返回确定性依赖计划，不能消耗库存、发事件或执行回调。
- execute 按计划执行。依赖未成功的任务标记 Blocked，但独立分支继续。
- 每个任务执行前用 `deployment:<job-id>` 预留资源。库存不足时标记 Blocked，不能执行回调；所有终态都必须释放本次成功预留的库存。
- 使用 RetryExecutor 执行回调，准确记录 attempts；第二次及之后尝试前发布 job.retry。
- 发布 job.started/job.retry/job.succeeded/job.failed/job.blocked，payload 使用稳定的 `id=...;...` 格式。
- EventBus handler 抛错不能中断部署，把 PublishReport.failures 追加到 result.eventFailures 并保留事件名和任务 id。
- 多次 preview、execute 都应可重复，不能把运行态写回 coordinator。

只允许修改 include/deployment_coordinator.hpp 和 src/deployment_coordinator.cpp。不要改测试、CMake 和已有四个组件。请先阅读接口和现有测试，按职责拆分验证、事件投影和执行状态逻辑。完成后运行 ./test.sh；编译警告也视为失败。不要只给代码说明，要实际修改并验证。
