/**
 * polling-kit
 * 轮询工具：递归 setTimeout（避免重叠）+ 立即/延迟执行 + 指数退避 + 超时 + 手动停止，零依赖、全 TypeScript。
 *
 * 从 SaaS 平台的任务进度轮询、订单状态轮询、导出结果轮询场景提炼。
 * 三个高频坑：
 *  1. setInterval 任务耗时 > 间隔时会重叠执行 → 用递归 setTimeout
 *  2. 轮询永远停不下来 → 提供 stop() 和 shouldStop 条件
 *  3. 失败要退避，否则打爆服务端 → 指数退避 + 封顶
 */

export interface PollOptions<T> {
  /** 轮询间隔 ms，默认 1000 */
  interval?: number
  /** 总超时 ms，超时后自动停止，默认 0 = 不限时 */
  timeout?: number
  /** 是否立即执行第一次，默认 true */
  immediate?: boolean
  /** 连续失败的最大重试次数，默认 0 = 失败即停止 */
  retries?: number
  /** 失败退避倍数，默认 2 */
  backoff?: number
  /** 退避延迟上限 ms，默认 30000 */
  maxDelay?: number
  /** 返回 true 则停止轮询并以当前结果 resolve */
  shouldStop?: (result: T, attempt: number) => boolean
  /** 每次成功轮询后回调 */
  onPoll?: (result: T, attempt: number) => void
  /** 每次失败回调 */
  onError?: (error: unknown, attempt: number) => void
}

export interface PollController<T> {
  /** 轮询结束时 resolve（shouldStop 命中 / 超时 / 手动 stop），resolve 值为最后一次成功结果 */
  promise: Promise<T | undefined>
  /** 手动停止；已停止幂等 */
  stop: () => void
  /** 是否仍在运行 */
  isRunning: () => boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * 启动轮询。
 *
 * @example
 * const { promise, stop } = poll(
 *   async () => (await fetch('/task/status')).json(),
 *   { interval: 2000, shouldStop: (res) => res.status === 'done', timeout: 60000 }
 * )
 * const result = await promise
 */
export function poll<T>(fn: () => Promise<T>, options: PollOptions<T> = {}): PollController<T> {
  const interval = options.interval ?? 1000
  const timeout = options.timeout ?? 0
  const immediate = options.immediate ?? true
  const retries = options.retries ?? 0
  const backoff = options.backoff ?? 2
  const maxDelay = options.maxDelay ?? 30000

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastResult: T | undefined
  let resolvePromise!: (v: T | undefined) => void

  const promise = new Promise<T | undefined>((resolve) => {
    resolvePromise = resolve
  })

  const finish = () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    resolvePromise(lastResult)
  }

  const tick = async (attempt: number, failStreak: number) => {
    if (stopped) return
    try {
      const result = await fn()
      lastResult = result
      failStreak = 0
      options.onPoll?.(result, attempt)
      if (options.shouldStop?.(result, attempt)) {
        finish()
        return
      }
      schedule(attempt + 1, 0)
    } catch (err) {
      failStreak++
      options.onError?.(err, attempt)
      if (failStreak > retries) {
        finish()
        return
      }
      // 指数退避：连续失败后延迟翻倍，封顶
      const delay = Math.min(interval * Math.pow(backoff, failStreak - 1), maxDelay)
      schedule(attempt + 1, failStreak, delay)
    }
  }

  const schedule = (attempt: number, failStreak: number, delay = interval) => {
    if (stopped) return
    timer = setTimeout(() => tick(attempt, failStreak), delay)
  }

  // 总超时
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null
  if (timeout > 0) {
    timeoutTimer = setTimeout(finish, timeout)
  }

  // 启动：立即执行第一次，否则先等一个 interval
  if (immediate) {
    void tick(1, 0)
  } else {
    schedule(1, 0)
  }

  return {
    promise,
    stop: () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer)
        timeoutTimer = null
      }
      finish()
    },
    isRunning: () => !stopped,
  }
}
