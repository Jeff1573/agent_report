// agent/examples/chroma-list-collections.ts
/**
 * 文档说明：列出当前 CHROMA_URL 下的全部集合及文档数，辅助排查“连到了哪个实例/集合是否为空”。
 * 运行：
 *   npm run demo:kb:list -w agent
 */

import '../config/env.js'
import { CHROMA_URL } from '../config/env.js'
import { ChromaClient } from 'chromadb'

async function main() {
  if (!CHROMA_URL) {
    // eslint-disable-next-line no-console
    console.error('未配置 CHROMA_URL')
    process.exit(1)
  }
  const url = CHROMA_URL
  const client = new ChromaClient({ path: url })
  // eslint-disable-next-line no-console
  console.log(`[Chroma] ${url}`)
  const cols = await client.listCollections()
  if (!cols || cols.length === 0) {
    // eslint-disable-next-line no-console
    console.log('无集合')
    return
  }
  for (const c of cols) {
    try {
      const col = await client.getCollection({ name: c.name })
      const n = await col.count()
      // eslint-disable-next-line no-console
      console.log(`- ${c.name}  (count=${n})`)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`- ${c.name}`)
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('执行失败：', e?.message || e)
  process.exit(1)
})

