// agent/examples/ingest-file-e2e.ts
/**
 * 文档说明：`storage.ts:ingestFile` 端到端可行性测试脚本。
 * - 流程：选择本地文件 → 调用 ingestFile（保存/解析/切块/入库）→ 使用同集合做检索验证。
 * - 配置：依赖 `agent/config/env.ts` 加载的环境变量（.env 或系统环境）。
 * - 用法：
 *   tsx agent/examples/ingest-file-e2e.ts --file <path> --collection <name> --chunkSize 1000 --chunkOverlap 150
 */

import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ingestFile } from '../services/storage.js'
import { makeKbEmbeddings } from '../services/embeddings.js'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import {
  KB_STORAGE_ROOT,
  KB_STORAGE_RAW_DIR,
  KB_EMBED_PROVIDER,
  KB_EMBED_MODEL,
  GOOGLE_API_KEY,
  CHROMA_URL,
  RAG_DATA_DIR
} from '../config/env.js'

/**
 * 解析命令行参数为键值表。
 *
 * @returns {Record<string,string>} 参数字典
 */
function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {}
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i]
    if (cur.startsWith('--')) {
      const key = cur.slice(2)
      const next = argv[i + 1]
      if (typeof next === 'string' && !next.startsWith('--')) {
        out[key] = next
        i++
      } else {
        out[key] = 'true'
      }
    }
  }
  return out
}

/**
 * 根据环境或参数选择一个待入库的测试文件。
 * 优先顺序：`--file` → `RAG_DATA_DIR` 中首个 .md/.txt → 仓库根目录 `AGENTS.md`。
 *
 * @param {Record<string,string>} args - 解析后的参数
 * @returns {Promise<string>} 绝对路径
 */
async function resolveTestFile(args: Record<string, string>): Promise<string> {
  const explicit = args['file']
  if (explicit) {
    const abs = path.resolve(explicit)
    return abs
  }
  if (RAG_DATA_DIR && RAG_DATA_DIR.trim().length > 0) {
    const dir = path.resolve(RAG_DATA_DIR)
    if (fsSync.existsSync(dir)) {
      const files = await fs.readdir(dir)
      const cand = files.find((f) => f.toLowerCase().endsWith('.md') || f.toLowerCase().endsWith('.txt'))
      if (cand) return path.join(dir, cand)
    }
  }
  // 回退到仓库根的 AGENTS.md
  const repoRoot = process.cwd()
  const fallback = path.join(repoRoot, 'AGENTS.md')
  if (fsSync.existsSync(fallback)) return fallback
  throw new Error('未找到可用于测试的文件，请通过 --file 指定，或配置 RAG_DATA_DIR，或确保仓库存在 AGENTS.md')
}

/**
 * 运行前环境自检：校验必要配置项是否存在。
 *
 * @throws Error 当必要配置缺失时抛出
 */
function preflightCheck(): void {
  const problems: string[] = []
  if (!KB_STORAGE_ROOT) problems.push('KB_STORAGE_ROOT 未配置')
  if (!CHROMA_URL) problems.push('CHROMA_URL 未配置或为空')
  const provider = (KB_EMBED_PROVIDER || 'openai').toLowerCase()
  if (!KB_EMBED_MODEL) problems.push('KB_EMBED_MODEL 未配置')
  if (provider === 'gemini') {
    if (!GOOGLE_API_KEY) problems.push('GOOGLE_API_KEY/GEMINI_API_KEY 未配置')
  }
  if (problems.length > 0) {
    const hint = `环境检查失败：\n- ${problems.join('\n- ')}`
    throw new Error(hint)
  }
}

/**
 * 将入库后的集合做一次简单检索验证。
 *
 * @param {string} collectionName - 集合名
 * @param {string} query - 检索查询词
 * @param {number} k - 返回条数
 * @returns {Promise<void>} Promise
 */
async function verifyRetrieval(collectionName: string, query: string, k = 3): Promise<void> {
  const embeddings = makeKbEmbeddings()
  const store = await Chroma.fromExistingCollection(embeddings as any, {
    collectionName,
    url: CHROMA_URL || undefined
  })
  const docs = await store.similaritySearch(query, k)
  // 输出摘要
  console.log(`\n[验证] 相似度检索 Top${k}：`)
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]
    const text = (d.pageContent || '').replace(/\s+/g, ' ').slice(0, 120)
    console.log(`- [${i + 1}] ${text}${text.length === 120 ? '…' : ''}`)
  }
  console.log(`[验证] 返回条目数：${docs.length}`)
}

async function main() {
  // 1) 环境自检
  preflightCheck()

  // 2) 解析参数与选择文件
  const args = parseArgs()
  const filePath = await resolveTestFile(args)
  const filename = path.basename(filePath)
  const collection = args['collection'] || `kb_test_${Date.now()}`
  const chunkSize = args['chunkSize'] ? Number(args['chunkSize']) : undefined
  const chunkOverlap = args['chunkOverlap'] ? Number(args['chunkOverlap']) : undefined

  console.log('[环境] KB_STORAGE_ROOT:', KB_STORAGE_ROOT)
  console.log('[环境] KB_STORAGE_RAW_DIR:', KB_STORAGE_RAW_DIR || '(默认: <KB_STORAGE_ROOT>/raw)')
  console.log('[环境] CHROMA_URL:', CHROMA_URL)
  console.log('[环境] KB_EMBED_PROVIDER:', KB_EMBED_PROVIDER)
  console.log('[环境] KB_EMBED_MODEL:', KB_EMBED_MODEL)
  console.log('[参数] file:', filePath)
  console.log('[参数] collection:', collection)
  if (chunkSize) console.log('[参数] chunkSize:', chunkSize)
  if (chunkOverlap !== undefined) console.log('[参数] chunkOverlap:', chunkOverlap)

  // 3) 读取文件并入库
  const buffer = await fs.readFile(filePath)
  const result = await ingestFile({
    collectionName: collection,
    filename,
    buffer,
    split: { chunkSize, chunkOverlap }
  })
  console.log('\n[结果] 已保存原始文件:', result.file.relativePath)
  console.log('[结果] 切块数量:', result.chunks)

  if (result.chunks > 0) {
    // 4) 简单检索验证：使用文件名的关键词
    const query = path.parse(filename).name.replace(/[-_]/g, ' ').slice(0, 64) || 'test'
    await verifyRetrieval(collection, query, 3)
  } else {
    console.warn('[警告] 切块数量为 0，跳过检索验证。')
  }
}

// 执行入口
main().catch((err) => {
  console.error('[E2E] 执行失败:', err?.message || err)
  process.exitCode = 1
})
