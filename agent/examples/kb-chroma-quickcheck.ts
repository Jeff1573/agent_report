// agent/examples/kb-chroma-quickcheck.ts
/**
 * 文档说明：Chroma 单集合检索 + LLM 问答最小验证脚本。
 * - 功能：基于现有集合进行相似度/MMR 检索，拼接上下文并让对话模型回答，最后输出参考来源。
 * - 运行：
 *   npm run demo:kb:chroma -w agent -- --q "你的问题" --collection your_collection --k 4 --type similarity
 * - 依赖：
 *   - 环境：CHROMA_URL、KB_EMBED_PROVIDER、KB_EMBED_MODEL、OPENAI_BASE_URL/OPENAI_API_KEY/OPENAI_MODEL
 *   - 向量集合：确保入库时使用的集合名存在（或在 .env 的 KB_COLLECTION 指定）。
 */

import '../config/env.js'
import { formatDocumentsAsString } from 'langchain/util/document'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { buildChromaRetriever, resolveCollectionName } from '../services/storage.js'
import { makeChatModel } from '../llm/factory.js'
import { KB_COLLECTION, RAG_CTX_CHAR_LIMIT } from '../config/env.js'

/**
 * 读取 CLI 选项。
 * @returns 解析后的参数
 */
function parseCli() {
  const args = process.argv.slice(2)
  const get = (key: string) => {
    const i = args.findIndex((a) => a === `--${key}`)
    if (i >= 0) return args[i + 1]
    const kv = args.find((a) => a.startsWith(`--${key}=`))
    return kv ? kv.split('=')[1] : undefined
  }
  const q = get('q') || args.join(' ')
  const k = get('k') ? Number(get('k')) : undefined
  const collection = get('collection')
  const type = get('type') === 'mmr' ? 'mmr' : 'similarity'
  const lambda = get('lambda') ? Number(get('lambda')) : undefined
  return { q: q?.trim() || '角色定位是什么？请结合内部知识简要回答。', k, collection, type, lambda }
}

/**
 * 截断文本到最大字符限制。
 */
function limit(text: string, maxChars: number): string {
  const n = Math.max(500, Number.isFinite(maxChars) ? maxChars : 3500)
  return text.length <= n ? text : text.slice(0, n)
}

async function main() {
  const { q, k, collection, type, lambda } = parseCli()
  const usedCollection = resolveCollectionName(collection || KB_COLLECTION)
  const retriever = await buildChromaRetriever(usedCollection, {
    k: typeof k === 'number' ? k : 4,
    searchType: type as 'similarity' | 'mmr',
    mmrLambda: typeof lambda === 'number' ? lambda : 0.5
  })
  const hits = await retriever.invoke(q)
  const ctx = limit(formatDocumentsAsString(hits), RAG_CTX_CHAR_LIMIT)

  const llm = makeChatModel({ streaming: false, streamUsage: false })
  const prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      '你是检索增强助手。仅依据提供的上下文回答；无法从上下文得到的信息请坦诚说明。\n\n上下文：\n{context}'
    ],
    ['human', '{question}']
  ])
  const chain = prompt.pipe(llm).pipe(new StringOutputParser())
  const answer = await chain.invoke({ context: ctx, question: q })

  const sources = Array.from(
    new Set(
      hits
        .map((d: any) => String(d?.metadata?.source || ''))
        .filter((s: string) => s && s.trim().length > 0)
    )
  )
  const lines = [
    `【KB集合】${usedCollection}`,
    `【检索类型】${type}，topK=${typeof k === 'number' ? k : 4}`,
    '',
    answer.trim(),
    '',
    '参考来源：',
    ...sources.map((s, i) => `- [${i + 1}] ${s}`)
  ]
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'))
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('执行失败：', err?.message || err)
  process.exit(1)
})

