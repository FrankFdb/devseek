# DevSeek 2.0.26 T1 可见交付仿真报告

日期：2026-08-17

## 缺陷回放

- 用户输入：`说明gpu cpu`
- 旧行为：界面显示“正在调查：直接回答”和完成状态，但没有用户可见的 CPU/GPU 回答。
- 根因：model-led 没有 plan 事件，Webview 却以 plan 完成为 assistant delta 的显示门；旧验收只观察运行日志。

## 验收结果

| 层级 | 结果 | 关键覆盖 |
| --- | --- | --- |
| 连续问答/DOM/VSIX 合同专项 | 122/122 PASS | 可见交付、省略指代、内部状态抑制、工具动态升级、顶层计划覆盖 |
| Mutation sensitivity | PASS | 恢复旧隐藏答案门后，测试按预期失败并命中正确原因 |
| Extension 全量 | 184/184 suites PASS | T1-T5 与架构、权限、工具、验证、记忆回归 |
| exact-VSIX DOM | PASS | 13 类输入精确可见，零伪调查；真实 read activity 正确显示进度 |
| exact-VSIX `t1-direct-answer-product` | 5/5 PASS | 截图原句、中文、错字口语、英文、日文；零工具、零写入 |
| exact-VSIX `t1-direct-followup-product` | 2/2 PASS | `说明gpu cpu` 后省略主语追问；同 session 上下文完整，零工具、零写入 |

## 制品

- VSIX：`devseek-netai-2.0.26-debug.20260817.t175130.ga2ab373.vsix`
- SHA-256：`bff00c7cfb477d7d9fa0955d9397c75fe0f99726d108f763bcb7201126adc97f`
- dirty-runtime fingerprint：`65d20470ea926acc478e5b4131f227f3507237f539bb1ee5393f1c1314484c1b`
- controlled report：`/tmp/devseek-t1-direct-2.0.26-report.json`
- follow-up controlled report：`/tmp/devseek-t1-followup-2.0.26-report.json`
- exact-VSIX DOM resource root：`/tmp/devseek-vsix-visible-ui-40M2e6/extension/media`

## Case 判定原则

后续用户仿真不以“未发现问题”等同于系统正确。关键 case 必须声明风险假设、正反 oracle 和预期杀死的缺陷；历史缺陷必须固定回放；高风险边界使用故障注入或 mutation test 验证 case 敏感性。不能杀死对应缺陷的 case 不计入有效覆盖。

本报告属于 T3 controlled surface，不是 live Provider 或发布资格证明。
