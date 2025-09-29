#!/usr/bin/env npx tsx
// agent/scripts/ingest-code-with-ast.ts
/**
 * 文档说明：通过 AST_Fast MCP Server 对代码仓进行“符号级”切片，并写入 Chroma 向量库。
 * - 职责：
 *   1) 连接 MCP（AST_Fast），扫描项目 -> 获取代码文件；
 *   2) 逐文件解析符号；
 *   3) 拉取符号源码；
 *   4) 构造 LangChain Document 并写入 Chroma；
 * - 依赖：
 *   - 环境变量：CHROMA_URL、KB_EMBED_PROVIDER、KB_EMBED_MODEL、OPENAI_API_KEY 或 GOOGLE_API_KEY；
 *   - MCP 配置：MCP_CONFIG_PATH 指向 .cursor/mcp.json，且包含 ast-fast（stdio 方式）；
 *   - 运行时：Node.js >= 22（ESM）。
 *
 * 使用方法（PowerShell）：
 *   npx tsx agent/scripts/ingest-code-with-ast.ts <projectPath> <collectionName> [symbolTypes]
 *   # 例：
 *   npx tsx agent/scripts/ingest-code-with-ast.ts E:\jf\mindForge_re my-code-kb function,class,contract,struct
 */

import path from 'node:path'
import * as fs from 'node:fs/promises'
import { Document } from '@langchain/core/documents'
import { ingestCode, DEFAULT_SYMBOL_TYPES } from '../services/codeIngestor.js'
import { logger } from '../utils/logger.js'

/**
 * 解析 CLI 参数。
 *
 * @returns {{ projectPath: string; collection: string; include: Set<string> }}
 * 解析后的参数对象，其中 include 默认包含函数、类、合约、结构体、变量、常量等通用符号类型。
 */
function parseCli(): { projectPath: string; collection: string; include: Set<string> } {
  const projectPath = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
  const collection = (process.argv[3] || 'code-kb').trim()
  const typesCsv = (process.argv[4] || Array.from(DEFAULT_SYMBOL_TYPES).join(',')).trim()
  const include = new Set(
    typesCsv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  )
  return { projectPath, collection, include }
}

/**
 * 当无法提取任何符号时，生成基于整文件的回退文档。
 *
 * @param {string} filePath - 文件绝对路径
 * @param {any} parsed - AST 解析结果，用于携带语言等元数据
 * @returns {Promise<Document>} 描述整个文件的文档
 */
async function makeFallbackDoc(filePath: string, parsed: any): Promise<Document> {
  const fileContent = await fs.readFile(filePath, 'utf-8')
  return new Document({
    pageContent: fileContent,
    metadata: {
      filePath: filePath,
      language: parsed?.language || 'unknown',
      symbolName: 'file_content',
      symbolType: 'file',
      startLine: 1,
      endLine: fileContent.split('\n').length
    }
  })
}

async function main(): Promise<void> {
  const { projectPath, collection, include } = parseCli()
  await ingestCode({ projectPath, collection, include })
}

main().catch((err) => {
  logger.error('ingest-code-with-ast 失败', err)
  process.exit(1)
})


