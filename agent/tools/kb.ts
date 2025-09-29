// agent/tools/kb.ts
/**
 * 文档说明：内部知识库检索工具（单集合）。
 * - 职责：基于 Chroma 已有集合执行相似度/MMR 检索，返回精简上下文与来源。
 * - 依赖：Chroma（HTTP）、与入库一致的 Embeddings；环境变量见 config/env.ts。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { formatDocumentsAsString } from 'langchain/util/document'
import { buildChromaRetriever, resolveCollectionName, retrieveWithClientMMR } from '../services/storage.js'
import { METADATA_KEYS } from '../services/metadataSchema.js'
import { KB_COLLECTION, RAG_CTX_CHAR_LIMIT, KB_COLLECTION_WHITELIST, RERANK_ENABLED, RERANK_FETCHK, RERANK_LAMBDA } from '../config/env.js'
import { logger } from '../utils/logger.js'

/**
 * 截断多段文本到目标总字符限制。
 *
 * @param {string[]} parts 文本段
 * @param {number} limit 限制
 * @returns {string} 截断后的拼接文本
 */
function joinWithLimit(parts: string[], limit: number): string {
  const safe = Math.max(500, Number.isFinite(limit) ? limit : 3500)
  const acc: string[] = []
  let used = 0
  for (const s of parts) {
    const rest = safe - used
    if (rest <= 0) break
    const pick = s.length <= rest ? s : s.slice(0, Math.max(0, rest))
    acc.push(pick)
    used += pick.length
    if (used >= safe) break
  }
  return acc.join('\n\n')
}

/**
 * 导出 kb_search 工具。
 *
 * 入参：
 * - query: 查询字符串（必填）
 * - k: 召回条数（默认 4）
 * - collection: 集合名（默认取 KB_COLLECTION；缺省时生成随机名，若集合不存在将报错）
 * - searchType: similarity | mmr（默认 similarity）
 * - mmrLambda: 当 searchType=mmr 时的折中系数（0~1，默认 0.5）
 */
/**
 * kb_search 工具：支持 similarity / mmr 两种检索；当使用 mmr 时可选传入 fetchK 放大候选集。
 *
 * @param {object} params - 调用参数
 * @param {string} params.query - 查询字符串
 * @param {number=} params.k - 召回条数，默认 4
 * @param {string=} params.collection - 集合名，默认取环境变量 KB_COLLECTION 或生成名
 * @param {('similarity'|'mmr')=} params.searchType - 检索类型，默认 similarity
 * @param {number=} params.mmrLambda - MMR 折中系数（0~1），默认 0.5
 * @param {number=} params.fetchK - 当 searchType=mmr 时的候选规模，默认 max(32, 4*k)
 */
function normalizeWhere(raw?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return raw
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    let finalKey = key
    // 统一 symbol_name → symbolName 等常见写法
    if (key === 'symbol_name') finalKey = METADATA_KEYS.symbolName
    if (key === 'symbol_type') finalKey = METADATA_KEYS.symbolType
    if (key === 'file_path') finalKey = METADATA_KEYS.filePath

    normalized[finalKey] = value
  }
  return normalized
}

export const kbSearchTool = tool(
  async ({
    query,
    k,
    collection,
    searchType,
    mmrLambda,
    fetchK,
    where
  }: {
    query: string
    k?: number
    collection?: string
    searchType?: 'similarity' | 'mmr'
    mmrLambda?: number
    fetchK?: number
    where?: Partial<Record<keyof typeof METADATA_KEYS, string>>
  }) => {
    const normalizedWhere = normalizeWhere(where)
    // 1) 集合名上锁：默认仅允许 KB_COLLECTION；若配置白名单，则白名单 + KB_COLLECTION
    const base = (KB_COLLECTION || '').trim()
    if (!base) {
      throw new Error('未配置 KB_COLLECTION，无法执行内部检索')
    }
    const whitelist = Array.isArray(KB_COLLECTION_WHITELIST) && KB_COLLECTION_WHITELIST.length > 0
      ? new Set([base, ...KB_COLLECTION_WHITELIST])
      : new Set([base])
    const requested = (collection || '').trim()
    const locked = whitelist.has(requested) && requested ? requested : base
    if (requested && requested !== locked) {
      logger.warn('[kb_search] 收到未授权的 collection，已替换为 KB_COLLECTION', { requested, used: locked })
    }
    const usedCollection = resolveCollectionName(locked)

    // 2) 规范化参数：k 做收敛（4~8），未指定 searchType 时默认 mmr(client)
    const rawTopK = typeof k === 'number' ? k : 4
    const topK = Math.max(6, Math.min(8, rawTopK))
    const wantMMRExplicit = searchType === 'mmr'
    const wantSimilarityExplicit = searchType === 'similarity'
    const defaultToClientMMR = !wantSimilarityExplicit // 未指定或显式要求 mmr → 默认走 mmr(client)
    let usedType: 'similarity' | 'mmr' | 'mmr(client)' = defaultToClientMMR ? 'mmr(client)' : (wantSimilarityExplicit ? 'similarity' : 'mmr')
    let hits: any[] = []
    let fallback = false

    // 3) 当“未指定/显式要求 mmr”且启用客户端重排时，优先走客户端 MMR；否则按后端能力或 similarity 尝试
    if (defaultToClientMMR && RERANK_ENABLED) {
      try {
        const lambda = typeof mmrLambda === 'number' ? mmrLambda : (typeof RERANK_LAMBDA === 'number' ? RERANK_LAMBDA : 0.35)
        const fetchKLocal = typeof fetchK === 'number' && fetchK > 0 ? fetchK : (typeof RERANK_FETCHK === 'number' && RERANK_FETCHK > 0 ? RERANK_FETCHK : Math.max(20, 4 * topK))
        hits = await retrieveWithClientMMR(usedCollection, query, { k: topK, fetchK: fetchKLocal, lambda, where: normalizedWhere })
        usedType = 'mmr(client)'
      } catch (e) {
        logger.warn('[kb_search] 客户端 MMR 失败，回退 similarity', { error: (e as Error)?.message })
        const retriever = await buildChromaRetriever(usedCollection, { k: topK, searchType: 'similarity', where: normalizedWhere })
        hits = await retriever.invoke(query)
        usedType = 'similarity'
      }
    } else {
      const retriever = await buildChromaRetriever(usedCollection, {
        k: topK,
        searchType: wantSimilarityExplicit ? 'similarity' : 'mmr',
        mmrLambda: typeof mmrLambda === 'number' ? mmrLambda : 0.5,
        fetchK: typeof fetchK === 'number' ? fetchK : undefined,
        where: normalizedWhere
      })
      hits = await retriever.invoke(query)
      usedType = wantSimilarityExplicit ? 'similarity' : 'mmr'
    }
    // 命中为空且给了 where → 自动退化（无过滤重试一次）
    if (Array.isArray(hits) && hits.length === 0 && normalizedWhere && Object.keys(normalizedWhere).length > 0) {
      try {
        logger.info('[kb_search] 命中为空，触发无过滤退化重试', { where })
        if (usedType === 'mmr(client)') {
          const lambda = typeof mmrLambda === 'number' ? mmrLambda : (typeof RERANK_LAMBDA === 'number' ? RERANK_LAMBDA : 0.35)
          const fetchKLocal = typeof fetchK === 'number' && fetchK > 0 ? fetchK : (typeof RERANK_FETCHK === 'number' && RERANK_FETCHK > 0 ? RERANK_FETCHK : Math.max(20, 4 * topK))
          hits = await retrieveWithClientMMR(usedCollection, query, { k: topK, fetchK: fetchKLocal, lambda })
        } else {
          const retriever2 = await buildChromaRetriever(usedCollection, {
            k: topK,
            searchType: usedType === 'similarity' ? 'similarity' : 'mmr',
            mmrLambda: typeof mmrLambda === 'number' ? mmrLambda : 0.5
          })
          hits = await retriever2.invoke(query)
        }
        fallback = true
      } catch (e) {
        logger.warn('[kb_search] 退化重试失败', { error: (e as Error)?.message })
      }
    }
    // 4) 结构化 JSON 输出
    const sourceList: string[] = Array.from(new Set(
      hits.map((d: any) => String(d?.metadata?.source || '')).filter((s: string) => s && s.trim().length > 0)
    ))

    const indexOfSource = (s: string) => sourceList.findIndex((x) => x === s) + 1

    // 将上下文裁剪到预算内，并保留与来源的索引映射
    const contextText = joinWithLimit([formatDocumentsAsString(hits)], RAG_CTX_CHAR_LIMIT)
    const ctxItems: Array<{ text: string; sourceIndex: number }> = []
    {
      let used = 0
      const budget = Math.max(500, RAG_CTX_CHAR_LIMIT)
      for (const d of hits) {
        const text: string = String(d?.pageContent || '')
        const src: string = String(d?.metadata?.source || '')
        if (!text) continue
        const rest = budget - used
        if (rest <= 0) break
        const pick = text.length <= rest ? text : text.slice(0, Math.max(0, rest))
        const si = src ? indexOfSource(src) : 0
        ctxItems.push({ text: pick, sourceIndex: si > 0 ? si : 1 })
        used += pick.length
        if (used >= budget) break
      }
    }

    const payload = {
      collection: usedCollection,
      search: {
        type: usedType,
        k: topK,
        ...(defaultToClientMMR ? { fetchK: typeof fetchK === 'number' && fetchK > 0 ? fetchK : (typeof RERANK_FETCHK === 'number' && RERANK_FETCHK > 0 ? RERANK_FETCHK : Math.max(20, 4 * topK)) } : {}),
        ...(defaultToClientMMR ? { lambda: typeof mmrLambda === 'number' ? mmrLambda : (typeof RERANK_LAMBDA === 'number' ? RERANK_LAMBDA : 0.35) } : {}),
        ...(normalizedWhere && !fallback ? { where: normalizedWhere } : {}),
        ...(fallback ? { fallback: true } : {})
      },
      context: ctxItems,
      contextText,
      sources: sourceList.map((ref, i) => ({ index: i + 1, ref })),
    }

    return JSON.stringify(payload)
  },
  {
    name: 'kb_search',
    description: '检索内部知识库（Chroma）。未指定时默认使用 mmr(client)（客户端重排），k 收敛为 6~8；当 searchType=similarity 时按相似度检索。输出为严格 JSON 字符串（见字段：collection/search/context/contextText/sources/citation_guidelines）。使用规范：最终回答必须在关键结论后用 [n] 引用 sources 的 index；证据不足须说明；严禁编造来源或编号；不要原样粘贴 JSON，仅用其中信息组织自然语言回答。where 参数用于按 metadata 过滤，可使用字段：symbolName（符号名称，如 Web3Service）、symbolType（函数/类/常量/模块等）、filePath、language。建议 mmr 搭配较大的 fetchK（如 128 或 4*k）以提升多样性。',
    schema: z.object({
      query: z.string(),
      k: z.number().int().min(1).max(20).optional(),
      collection: z.string().optional(),
      searchType: z.enum(['similarity', 'mmr']).optional(),
      mmrLambda: z.number().min(0).max(1).optional(),
      fetchK: z.number().int().min(8).max(256).optional(),
      where: z.record(z.any()).optional()
    })
  }
)

export default kbSearchTool
