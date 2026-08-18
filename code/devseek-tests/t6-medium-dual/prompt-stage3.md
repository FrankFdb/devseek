继续当前部署协调器修复。CI 现在只剩一个明确问题：`eventFailures` 虽然记录了订阅者异常，但格式不是稳定的命名字段，日志消费者无法可靠解析。

请检查统一的事件发布边界，使每条订阅失败记录使用 `event=<事件名>;id=<任务 id>;failure=<错误>` 的稳定顺序；所有事件类型都必须经过同一个实现，不能只为 `job.succeeded` 特判。订阅者异常仍然不能改变任务状态，也不能阻止后续独立任务执行。

仍然只允许修改 include/deployment_coordinator.hpp 和 src/deployment_coordinator.cpp，不能修改 tests、CMake、test.sh 或已有组件。完成后运行 ./test.sh，并基于真实工具证据结束任务。
