// agent/tools/kb.ts
/**
 * 文档说明：内部知识库检索工具（单集合）。
 * - 职责：基于 Chroma 已有集合执行相似度/MMR 检索，返回精简上下文与来源。
 * - 依赖：Chroma（HTTP）、与入库一致的 Embeddings；环境变量见 config/env.ts。
 */

import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { formatDocumentsAsString } from 'langchain/util/document'
import { buildChromaRetriever, resolveCollectionName } from '../services/storage.js'
import { KB_COLLECTION, RAG_CTX_CHAR_LIMIT } from '../config/env.js'

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
export const kbSearchTool = tool(
  async ({ query, k, collection, searchType, mmrLambda, fetchK }: { query: string; k?: number; collection?: string; searchType?: 'similarity' | 'mmr'; mmrLambda?: number; fetchK?: number }) => {
    const usedCollection = resolveCollectionName(collection || KB_COLLECTION)
    const retriever = await buildChromaRetriever(usedCollection, {
      k: typeof k === 'number' ? k : 4,
      searchType: searchType === 'mmr' ? 'mmr' : 'similarity',
      mmrLambda: typeof mmrLambda === 'number' ? mmrLambda : 0.5,
      fetchK: typeof fetchK === 'number' ? fetchK : undefined
    })

    const hits = await retriever.invoke(query)
    const sources = Array.from(
      new Set(
        hits
          .map((d: any) => String(d?.metadata?.source || ''))
          .filter((s: string) => s && s.trim().length > 0)
      )
    )
    const context = joinWithLimit([formatDocumentsAsString(hits)], RAG_CTX_CHAR_LIMIT)
    const lines = [
      `【KB集合】${usedCollection}`,
      `【检索类型】${searchType === 'mmr' ? 'mmr' : 'similarity'}，topK=${typeof k === 'number' ? k : 4}`,
      '',
      '【上下文】',
      context,
      '',
      '【参考来源】',
      ...sources.map((s, i) => `- [${i + 1}] ${s}`)
    ]
    return lines.join('\n')
  },
  {
    name: 'kb_search',
    description: '检索内部知识库（Chroma）。支持 similarity 与 mmr；建议 mmr 搭配较大的 fetchK（如 32 或 4*k）以提升多样性。',
    schema: z.object({
      query: z.string(),
      k: z.number().int().min(1).max(20).optional(),
      collection: z.string().optional(),
      searchType: z.enum(['similarity', 'mmr']).optional(),
      mmrLambda: z.number().min(0).max(1).optional(),
      fetchK: z.number().int().min(8).max(256).optional()
    })
  }
)

export default kbSearchTool

