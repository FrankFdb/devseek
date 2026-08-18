继续刚才的部署协调器任务。CI 反馈说明公开测试虽然通过，但事件投影和异常分类仍不完整，请从职责边界修正，不要针对某个断言硬编码：

- 注册失败必须保持强异常安全；资源不足时不能发布 started，也不能调用 operation。
- started 和 retrying 事件必须包含从 1 开始的 attempt；终态事件必须包含总 attempts；blocked 事件必须包含 reason，字段格式要稳定且便于程序解析。
- 事件订阅者异常只能记录到 eventFailures，格式至少能稳定区分 event、任务 id 和 failure，不能改变任务终态。
- operation 回调抛出的异常属于永久失败：只尝试一次、释放资源并进入 failed；不得当成可重试业务失败。

仍然只允许修改 include/deployment_coordinator.hpp 和 src/deployment_coordinator.cpp，不能修改 tests、CMake、test.sh 或已有组件。完成后运行 ./test.sh，确认实现和验证证据一致后再结束。
