# polling-kit

轮询工具，零依赖、全 TypeScript。递归 setTimeout（避免重叠）+ 立即/延迟执行 + 指数退避 + 超时 + 手动停止。从 SaaS 平台的任务进度轮询、订单状态轮询场景提炼。

## 安装

```bash
npm install polling-kit
```

## 快速开始

```ts
import { poll } from 'polling-kit'

const { promise, stop, isRunning } = poll(
  async () => (await fetch('/api/task/status')).json(),
  {
    interval: 2000,          // 每 2s 一次
    immediate: true,         // 立即执行第一次
    shouldStop: (res) => res.status === 'done',  // 完成即停
    timeout: 60_000,         // 最多 60s
    onPoll: (res) => console.log(res.status),
    onError: (err) => console.warn(err),
  },
)

const finalResult = await promise   // shouldStop 命中 / 超时 / stop 时 resolve
// 用户主动取消：
// stop()
```

## API

| 选项 | 说明 |
| --- | --- |
| `interval` | 轮询间隔 ms（默认 1000） |
| `timeout` | 总超时 ms，超时自动停止（默认 0 不限时） |
| `immediate` | 是否立即执行第一次（默认 true） |
| `retries` | 连续失败最大重试次数（默认 0，失败即停） |
| `backoff` / `maxDelay` | 失败指数退避倍数（默认 2）/ 上限（默认 30s） |
| `shouldStop(result)` | 返回 true 停止并以该结果 resolve |
| `onPoll` / `onError` | 成功/失败回调 |

返回 `{ promise, stop, isRunning }`，`promise` 的 resolve 值是**最后一次成功结果**。

## ⚠️ 三个必须知道的坑

### 1. `setInterval` 任务耗时 > 间隔时会重叠执行

如果一次轮询要 3s，而 `setInterval` 间隔是 1s，会**同时跑 3 个请求**，结果乱序、服务端被打爆。本库用**递归 `setTimeout`**：等上一次 `await fn()` 真正结束，才调度下一次，天然串行，绝不重叠。

### 2. 轮询永远停不下来

轮询必须有明确的退出条件。本库提供三重保障：`shouldStop` 条件、`timeout` 总超时、`stop()` 手动停止。组件卸载、页面隐藏时记得调 `stop()`，否则内存泄漏 + 持续请求。

### 3. 失败要退避，否则打爆服务端

网络抖动/服务端临时故障时，如果还按原间隔疯狂重试，等于给服务端叠 debuff。本库在连续失败时按**指数退避**拉长间隔（`interval * backoff^n`，`maxDelay` 封顶），恢复成功后自动回到正常间隔。

## 实现要点

- 状态跟踪：`stopped` 标志 + `failStreak` 计数，`finish()` 幂等清理定时器并 resolve。
- 成功与失败分开调度：成功走正常 `interval`，失败走退避延迟。
- `promise` 用「外部 resolve」模式，`stop()`/`timeout`/`shouldStop` 都能触发。

## License

MIT
