// agent/examples/kb-where-check.ts
/**
 * 文档说明：kb_search + where 最小验证脚本。
 * - 功能：直接调用 `kb_search` 工具，传入 query/k/searchType/fetchK/where，打印检索结果摘要（sources 与 search 字段）。
 * - 依赖：已配置可用的 Chroma（CHROMA_URL）、集合（KB_COLLECTION），以及与入库一致的向量嵌入配置。
 * - 用法示例：
 *   npm run demo:kb:where -w ./agent -- --q "支付限流策略" --k 6 --type similarity --where '{"module":"payments","lang":"zh"}'
 *   npm run demo:kb:where -w ./agent -- --q "RAG 是什么" --type mmr --fetchK 32 --k 8
 */

import '../config/env.js'
import { kbSearchTool } from '../tools/kb.js'

interface Args { [k: string]: string }

function parseArgs(argv: string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a) continue
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? a.split('=') : [a, argv[i + 1]]
      const key = k.replace(/^--/, '')
      if (v && !v.startsWith('--')) { out[key] = v; if (!a.includes('=')) i++ } else { out[key] = 'true' }
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const q = args.q || args.query || '测试：请解释 RAG，并标注来源编号'
  const k = args.k ? Number(args.k) : undefined
  const searchType = args.type === 'mmr' ? 'mmr' : args.type === 'similarity' ? 'similarity' : undefined
  const mmrLambda = args.lambda ? Number(args.lambda) : undefined
  const fetchK = args.fetchK ? Number(args.fetchK) : undefined
  const collection = args.collection
  let where: Record<string, unknown> | undefined
  if (args.where) {
    try { where = JSON.parse(args.where) } catch { console.error('[warn] 无法解析 --where JSON，将忽略过滤'); }
  }

  const input: any = { query: q }
  if (k) input.k = k
  if (collection) input.collection = collection
  if (searchType) input.searchType = searchType
  if (mmrLambda !== undefined) input.mmrLambda = mmrLambda
  if (fetchK !== undefined) input.fetchK = fetchK
  if (where) input.where = where

  console.log('[kb_where_check] args =', input)
  const res = await kbSearchTool.invoke(input)
  const text = typeof (res as any)?.content === 'string' ? (res as any).content : String(res)
  try {
    const j = JSON.parse(text)
    console.log('\n=== search ===')
    console.log(j.search)
    console.log('\n=== sources ===')
    console.log(j.sources)
    console.log('\n=== contextText(sample) ===')
    console.log(String(j.contextText || '').slice(0, 300))
  } catch {
    console.log(text)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

