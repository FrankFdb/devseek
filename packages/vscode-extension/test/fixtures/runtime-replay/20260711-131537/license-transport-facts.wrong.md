# License 模块传输常量事实记录

**源码路径**: `/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp`

| 常量名 | 值 | 说明 |
| --- | --- | --- |
| `kTopicLicenseState` | `"/uav/dt/license/state"` | License 状态发布 topic |
| `kTopicLicenseTunnelRx` | `"/uav/dt/license/tunnel/rx"` | License 隧道接收 topic |
| `kMavTunnelCmdLicense` | `300` | MAVLink 隧道命令号 |
| `kTunnelVersion` | `1` | 隧道协议版本 |
| `kTunnelMaxTotalLen` | `81920` | 隧道最大总长度（字节） |
| `kTunnelSessionTimeoutMs` | `30000` | 隧道会话超时时间（毫秒） |

```
print("\nready")
```

