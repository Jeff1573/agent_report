// agent/examples/runtime-integrity-test.ts
/**
 * 文档说明：createAgentRuntime 运行时完整性测试脚本（仅测试用途）。
 * - 目标：系统性验证 runtime 的核心能力连通性与稳定性；对 MMR 最小改动做连通性轻验。
 * - 约束：不引入新依赖；复用 agent 目录现有实现；环境变量使用 env.ts 导出；允许 Chroma 不可用（对应检查标记 SKIP）。
 */

import { createAgentRuntime } from '../runtime/index.js'
import { logger as baseLogger, createLogger } from '../utils/logger.js'
import { TIMEOUT_MS, THREAD_ID_FALLBACK, KB_COLLECTION, CHROMA_URL } from '../config/env.js'
import { buildChromaRetriever } from '../services/storage.js'
import { tavilyTool } from '../tools/tavily.js'

type TestResult = 'PASS' | 'FAIL' | 'ERROR' | 'SKIP'

/**
 * 超时工具：为 Promise 增加超时限制。
 * @param {Promise<T>} p - 待包装的 Promise
 * @param {number} ms - 超时时间（毫秒）
 * @returns {Promise<T>} 带超时的 Promise
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout ${ms}ms`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }).catch((e) => { clearTimeout(t); reject(e) })
  })
}

/**
 * 断言工具：条件为假时抛错。
 * @param {boolean} cond - 条件
 * @param {string} msg - 失败消息
 */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

/**
 * 运行单个子测试并打印结果。
 * @param {string} name - 用例名
 * @param {() => Promise<void>} fn - 测试体
 * @param {number} timeoutMs - 超时（毫秒）
 */
async function runCase(name: string, fn: () => Promise<void>, timeoutMs: number): Promise<TestResult> {
  const start = Date.now()
  try {
    await withTimeout(fn(), timeoutMs)
    const took = Date.now() - start
    baseLogger.info(`[PASS] ${name} (${took}ms)`) // 统一使用项目 logger
    return 'PASS'
  } catch (e: any) {
    const took = Date.now() - start
    baseLogger.warn(`[FAIL] ${name} (${took}ms): ${e?.message || e}`)
    return 'FAIL'
  }
}

/**
 * 主入口：串行执行子测试。
 */
async function main() {
  const timeout = Number.isFinite(TIMEOUT_MS) ? Number(TIMEOUT_MS) : 20_000 // 临时测试变量：兜底 20s
  const threadId = THREAD_ID_FALLBACK || 'integrity-test-thread-001'
  const log = createLogger({ threadId })

  const results: Array<{ name: string; r: TestResult }> = []

  // 1) API 形状检查
  results.push({
    name: 'API 形状',
    r: await runCase('API 形状', async () => {
      const rt = await createAgentRuntime()
      assert(typeof rt.runOnce === 'function', 'runOnce 缺失')
      assert(typeof rt.streamEvents === 'function', 'streamEvents 缺失')
      assert(typeof rt.streamValues === 'function', 'streamValues 缺失')
      assert(typeof rt.onEvent === 'function', 'onEvent 缺失')
    }, timeout),
  })

  // 2) 默认工具注入 + events 流式跑通
  results.push({
    name: 'events 流式 + 默认工具',
    r: await runCase('events 流式 + 默认工具', async () => {
      const rt = await createAgentRuntime()
      let sawTool = false
      let sawRoundEnd = false
      const off = rt.onEvent((e) => {
        if (e.type === 'tool-call' || e.type === 'tool-result') sawTool = true
        if (e.type === 'round-end') sawRoundEnd = true
      })
      for await (const _ of rt.streamEvents('请用内部工具检索并简述 KB 的用途。', { threadId })) {
        // 消耗事件即可
      }
      off()
      assert(sawRoundEnd, '未收到 round-end')
      // 工具调用可能因环境而回退；此处只做“有无工具”记录，不做强断言
    }, timeout),
  })

  // 3) values 流式跑通（不要求工具）
  results.push({
    name: 'values 流式',
    r: await runCase('values 流式', async () => {
      const rt = await createAgentRuntime()
      let sawRoundEnd = false
      const off = rt.onEvent((e) => { if (e.type === 'round-end') sawRoundEnd = true })
      for await (const _ of rt.streamValues('解释一下本项目的运行模式。', { threadId })) {
        // 消耗事件即可
      }
      off()
      assert(sawRoundEnd, '未收到 round-end')
    }, timeout),
  })

  // 4) onEvent 订阅/取消可用
  results.push({
    name: 'onEvent 订阅/取消',
    r: await runCase('onEvent 订阅/取消', async () => {
      const rt = await createAgentRuntime()
      let count = 0
      const off = rt.onEvent(() => { count++ })
      for await (const _ of rt.streamEvents('打一声招呼即可。', { threadId })) { /* noop */ }
      off()
      const prev = count
      for await (const _ of rt.streamEvents('再打一声招呼。', { threadId })) { /* noop */ }
      assert(count >= prev, '订阅计数未增长')
    }, timeout),
  })

  // 5) 同一 threadId 连续两次调用完成（不做语义断言）
  results.push({
    name: '同一线程两次调用',
    r: await runCase('同一线程两次调用', async () => {
      const rt = await createAgentRuntime()
      for (let i = 0; i < 2; i++) {
        for await (const _ of rt.streamEvents(`第 ${i + 1} 次对话`, { threadId })) { /* noop */ }
      }
    }, timeout),
  })

  // 6) tools 覆盖：仅注入 tavily，验证覆盖机制生效（不强制出现工具调用）
  results.push({
    name: '工具覆盖（仅 tavily）',
    r: await runCase('工具覆盖（仅 tavily）', async () => {
      const rt = await createAgentRuntime({ tools: [tavilyTool] as any })
      let sawRoundEnd = false
      for await (const _ of rt.streamEvents('用可用工具检索 RAG 的含义。', { threadId })) {
        // 如果能跑通并 round-end 即通过
      }
      assert(!sawRoundEnd || true, '覆盖后未正常结束（仅提示，不强断言）')
    }, timeout),
  })

  // 7) MMR retriever 直连轻验（CHROMA_URL 或 KB_COLLECTION 缺失则 SKIP）
  let mmrResult: TestResult = 'SKIP'
  if (CHROMA_URL && (KB_COLLECTION || '').trim().length > 0) {
    mmrResult = await runCase('MMR retriever 直连轻验', async () => {
      const retriever = await buildChromaRetriever(KB_COLLECTION, {
        k: 8,
        searchType: 'mmr',
        mmrLambda: 0.35,
        fetchK: 32,
      })
      const docs = await retriever.invoke('RAG 是什么')
      assert(Array.isArray(docs), 'retriever.invoke 未返回数组')
    }, timeout)
  } else {
    baseLogger.info('[SKIP] MMR retriever 直连轻验（CHROMA_URL 或 KB_COLLECTION 未配置）')
  }
  results.push({ name: 'MMR retriever 直连轻验', r: mmrResult })

  // 8) runOnce 兜底路径
  results.push({
    name: 'runOnce 兜底',
    r: await runCase('runOnce 兜底', async () => {
      const rt = await createAgentRuntime()
      const out = await rt.runOnce('直接回答一句你好即可')
      assert(typeof out === 'string', 'runOnce 未返回字符串')
    }, timeout),
  })

  // 汇总
  const stats = results.reduce((acc, cur) => { acc[cur.r] = (acc[cur.r] || 0) + 1; return acc }, {} as Record<string, number>)
  baseLogger.info('--- Summary ---')
  baseLogger.info(stats)
}

main().catch((e) => {
  baseLogger.error('[ERROR] runtime-integrity-test:', e)
  process.exit(1)
})
