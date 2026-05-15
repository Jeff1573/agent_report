/**
 * 异步控制工具。
 *
 * 统一处理两类场景：
 * 1. 用户主动取消导入任务
 * 2. 外部依赖长时间无响应，需要快速失败
 */

/**
 * 用户主动取消导入时抛出的错误。
 */
export class ImportCancelledError extends Error {
  constructor(message = '导入已取消') {
    super(message)
    this.name = 'AbortError'
  }
}

/**
 * 异步操作超时时抛出的错误。
 */
export class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/**
 * 判断当前错误是否为用户取消导入。
 *
 * @param error - 待判断的错误对象
 * @returns 是否为取消错误
 */
export function isImportCancelledError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError' && error.message.includes('导入已取消')
}

/**
 * 判断当前错误是否为超时错误。
 *
 * @param error - 待判断的错误对象
 * @returns 是否为超时错误
 */
export function isOperationTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError'
}

/**
 * 若任务已被取消，则立即终止后续流程。
 *
 * @param signal - 任务取消信号
 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ImportCancelledError()
  }
}

/**
 * 为任意异步任务补充“取消 + 超时”双重保护。
 *
 * 说明：
 * - 底层第三方 SDK 未必原生支持 AbortSignal，因此这里至少保证上层流程能及时返回。
 * - 即使底层请求稍后才自然结束，也不会继续阻塞当前导入任务。
 *
 * @param task - 实际执行的异步任务
 * @param options - 控制参数
 * @returns 异步任务结果
 */
export async function runWithAbortAndTimeout<T>(
  task: () => Promise<T>,
  options: {
    signal?: AbortSignal
    timeoutMs: number
    timeoutMessage: string
  }
): Promise<T> {
  const { signal, timeoutMs, timeoutMessage } = options
  throwIfAborted(signal)

  let timer: ReturnType<typeof setTimeout> | null = null
  let onAbort: (() => void) | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new OperationTimeoutError(timeoutMessage))
    }, timeoutMs)
  })

  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        onAbort = () => reject(new ImportCancelledError())
        signal.addEventListener('abort', onAbort, { once: true })
      })
    : null

  try {
    return await Promise.race([
      task(),
      timeoutPromise,
      ...(abortPromise ? [abortPromise] : [])
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (signal && onAbort) signal.removeEventListener('abort', onAbort)
  }
}
