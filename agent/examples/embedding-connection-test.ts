// agent/examples/embedding-connection-test.ts
/**
 * 文档说明：远程 Embedding 模型连通性与检索效果最小测试脚本
 *
 * 用途：
 * - 验证 OpenAI 协议兼容端点（自定义 baseURL/鉴权头）或 Gemini Embeddings 的连通性
 * - 统计单条/批量 embed 的耗时与返回维度
 * - 使用内存向量库进行一次最小检索，并计算余弦相似度
 *
 * 运行示例：
 *  - OpenAI 兼容：
 *    npm run demo:embed -w agent -- --provider openai --model text-embedding-3-small --dimensions 1536
 *  - Gemini：
 *    npm run demo:embed -w agent -- --provider gemini --model text-embedding-004
 *
 * 环境变量（见 .env.example）：
 *  - OPENAI_BASE_URL / OPENAI_API_KEY / CUSTOM_AUTH_HEADER / CUSTOM_AUTH_VALUE
 *  - KB_EMBED_PROVIDER / KB_EMBED_MODEL / GOOGLE_API_KEY | GEMINI_API_KEY
 */

import '../config/env.js'
import { logger } from '../utils/logger.js'
import { OpenAIEmbeddings } from '@langchain/openai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import {
  OPENAI_BASE_URL,
  CUSTOM_AUTH_HEADER,
  CUSTOM_AUTH_VALUE,
  KB_EMBED_PROVIDER,
  KB_EMBED_MODEL,
  GOOGLE_API_KEY
} from '../config/env.js'

type Provider = 'openai' | 'gemini'

interface CliOptions {
  provider: Provider
  model?: string
  dimensions?: number
  k: number
}

/**
 * 解析命令行参数，合并环境变量兜底。
 *
 * @returns {CliOptions} 解析后的选项
 */
function parseCli(): CliOptions {
  const args = process.argv.slice(2)
  const get = (key: string): string | undefined => {
    const i = args.findIndex((a) => a === `--${key}`)
    if (i >= 0) return args[i + 1]
    const kv = args.find((a) => a.startsWith(`--${key}=`))
    return kv ? kv.split('=')[1] : undefined
  }

  const providerRaw = (get('provider') || KB_EMBED_PROVIDER || 'openai').toLowerCase()
  const provider: Provider = providerRaw === 'gemini' ? 'gemini' : 'openai'
  const model = get('model') || KB_EMBED_MODEL || (provider === 'gemini' ? 'text-embedding-004' : 'text-embedding-3-small')

  const dimRaw = get('dimensions')
  const dimensions = dimRaw !== undefined ? Number(dimRaw) : undefined
  const kRaw = get('k')
  const k = Math.max(1, Number.isFinite(Number(kRaw)) ? Number(kRaw) : 4)

  return { provider, model, dimensions, k }
}

/**
 * 余弦相似度计算。
 *
 * @param {number[]} a 向量 A
 * @param {number[]} b 向量 B
 * @returns {number} 余弦相似度（-1~1）
 */
function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    const va = a[i]
    const vb = b[i]
    dot += va * vb
    na += va * va
    nb += vb * vb
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom > 0 ? dot / denom : 0
}

/**
 * 计时执行异步函数。
 *
 * @template T 返回类型
 * @param {() => Promise<T>} fn 异步执行体
 * @returns {Promise<{ms:number; value:T}>} 耗时与结果
 */
async function timeIt<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = Date.now()
  const value = await fn()
  const ms = Date.now() - start
  return { ms, value }
}

/**
 * 构建 Embeddings 实例（支持 openai / gemini），并处理远程 baseURL 与自定义鉴权头。
 *
 * @param {CliOptions} opts 选项
 * @returns {OpenAIEmbeddings | GoogleGenerativeAIEmbeddings} Embeddings 实例
 */
function buildEmbeddings(opts: CliOptions): OpenAIEmbeddings | GoogleGenerativeAIEmbeddings {
  if (opts.provider === 'gemini') {
    const apiKey = GOOGLE_API_KEY || process.env.GEMINI_API_KEY || ''
    return new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey || undefined,
      model: opts.model || 'text-embedding-004'
    })
  }

  // openai（含兼容端点）
  const defaultHeaders: Record<string, string> = {}
  if (CUSTOM_AUTH_HEADER && CUSTOM_AUTH_VALUE) {
    defaultHeaders[CUSTOM_AUTH_HEADER] = CUSTOM_AUTH_VALUE
  }

  return new OpenAIEmbeddings({
    model: opts.model,
    dimensions: typeof opts.dimensions === 'number' ? opts.dimensions : undefined,
    // 关键：透传自定义 baseURL 与鉴权头，适配代理/网关
    configuration: {
      baseURL: OPENAI_BASE_URL || undefined,
      // 如果未提供自定义头，OpenAIEmbeddings 会默认走 OPENAI_API_KEY → Authorization: Bearer
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined
    }
  })
}

/**
 * 主流程：
 * - 构建 embeddings
 * - 单条/批量嵌入测试
 * - 内存向量检索与相似度
 */
async function main(): Promise<void> {
  const opts = parseCli()
  const embeddings = buildEmbeddings(opts)
  logger.info('配置', {
    provider: opts.provider,
    model: opts.model,
    dimensions: opts.dimensions ?? null,
    baseURL: opts.provider === 'openai' ? OPENAI_BASE_URL || null : null,
    customAuthHeader: opts.provider === 'openai' ? (CUSTOM_AUTH_HEADER || null) : null
  })

  // 1) 单条 embed（连通性与维度）
  const { ms: qMs, value: qVec } = await timeIt(async () => embeddings.embedQuery('hello world'))
  logger.info('embedQuery 成功', { ms: qMs, dim: Array.isArray(qVec) ? qVec.length : null })

  // 2) 批量 embed（小批量）
  const docs = [
    'RAG（检索增强生成）用于将外部知识注入到模型回答中。',
    'MMR（最大边际相关性）在召回阶段平衡相关性与多样性。',
    '向量相似度常用余弦相似度来度量两向量之间的夹角。'
  ]
  const { ms: dMs, value: dVecs } = await timeIt(async () => embeddings.embedDocuments(docs))
  const dimsEqual = dVecs.every((v) => Array.isArray(v) && v.length === dVecs[0].length)
  logger.info('embedDocuments 成功', {
    ms: dMs,
    count: dVecs.length,
    dim: dVecs[0]?.length ?? null,
    dimsEqual
  })

  // 3) 组装内存向量库并检索
  const metas = [{ source: 'kb:intro#rag' }, { source: 'kb:intro#mmr' }, { source: 'kb:intro#cosine' }]
  const store = await MemoryVectorStore.fromTexts(docs, metas, embeddings)
  const retriever = store.asRetriever({ k: opts.k })
  const queryText = '请解释什么是 RAG，并说明与相似度度量的关系？'
  const hits = await retriever.invoke(queryText)
  logger.info('检索结果', {
    k: opts.k,
    hits: hits.length,
    topSources: hits.slice(0, 2).map((d: any) => d?.metadata?.source)
  })

  // 4) 计算 query 与第一命中文档的相似度（再次嵌入该文档文本以估算）
  if (hits[0]) {
    const topText: string = (hits[0] as any).pageContent
    const [qEmbed, topEmbed] = await Promise.all([
      embeddings.embedQuery(queryText),
      embeddings.embedQuery(topText)
    ])
    const sim = cosineSimilarity(qEmbed, topEmbed)
    logger.info('相似度（query vs. top1）', { similarity: Number(sim.toFixed(4)) })
  }

  logger.info('完成。若需查看更多诊断，请启用 LOG_LEVEL=debug')
}

main().catch((err: unknown) => {
  // 尽量输出可诊断信息
  const anyErr = err as any
  const status = anyErr?.status || anyErr?.response?.status
  const data = anyErr?.response?.data || anyErr?.error || anyErr?.message || String(err)
  logger.error('执行失败', { status, data })
  process.exit(1)
})

