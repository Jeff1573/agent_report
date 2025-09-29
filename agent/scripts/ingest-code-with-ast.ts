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

import { MCP_CONFIG_PATH } from '../config/env.js'
import path from 'node:path'
import * as fs from 'node:fs/promises'
import { Document } from '@langchain/core/documents'
import { createMCPClient } from '../tools/mcp.js'
import { upsertToChroma } from '../services/storage.js'
import { logger } from '../utils/logger.js'

/**
 * 将 MCP 工具返回的结果标准化为字符串。
 *
 * @param {unknown} res - MCP 工具返回值
 * @returns {string} 解析后的文本
 */
function toText(res: unknown): string {
  if (typeof res === 'string') return res
  const r: any = res as any
  if (r?.content && Array.isArray(r.content) && r.content[0]?.text) return r.content[0].text
  try {
    return JSON.stringify(r)
  } catch {
    return String(r ?? '')
  }
}

/**
 * 解析 CLI 参数。
 *
 * @returns {{ projectPath: string; collection: string; include: Set<string> }}
 * 解析后的参数对象，其中 include 默认包含函数、类、合约、结构体、变量、常量等通用符号类型。
 */
function parseCli(): { projectPath: string; collection: string; include: Set<string> } {
  const projectPath = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
  const collection = (process.argv[3] || 'code-kb').trim()
  const typesCsv = (process.argv[4] || 'function,class,contract,struct,variable,constant').trim()
  const include = new Set(
    typesCsv
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  )
  return { projectPath, collection, include }
}

/**
 * 根据统一符号定义判断是否保留当前符号。
 *
 * @param {any} symbol - AST_Fast 返回的统一符号对象
 * @param {Set<string>} allow - 允许保留的符号类型集合
 * @returns {boolean} 是否保留该符号
 */
function shouldKeepSymbol(symbol: any, allow: Set<string>): boolean {
  const t = String(symbol?.type || '').toLowerCase()
  return allow.has(t)
}

/**
 * 从解析结果构造文档。
 */
function makeDoc(parsed: any, sym: any, code: string): Document {
  return new Document({
    pageContent: code,
    metadata: {
      filePath: String(parsed?.filePath || ''),
      language: String(parsed?.language || ''),
      symbolName: String(sym?.name || ''),
      symbolType: String(sym?.type || ''),
      startLine: Number(sym?.range?.start?.line ?? -1),
      endLine: Number(sym?.range?.end?.line ?? -1)
    }
  })
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
  logger.info('[ingest-code-with-ast] start', { projectPath, collection, include: Array.from(include) })

  console.log(MCP_CONFIG_PATH)
  const client = await createMCPClient(MCP_CONFIG_PATH)
  const tools: any[] = await client.getTools()

  const getProj = tools.find((t: any) => t.name === 'get_project_structure_summary')
  const getFile = tools.find((t: any) => t.name === 'get_file_structure_summary')
  const getCode = tools.find((t: any) => t.name === 'get_code_block_for_symbol')
  if (!getFile || !getCode) {
    await client.close()
    throw new Error('未找到 AST_Fast 工具：get_file_structure_summary / get_code_block_for_symbol')
  }

  // 1) 支持：若传入的是单个文件，则直接处理该文件；否则对目录执行 quick 扫描
  let files: string[] = []
  try {
    const st = await fs.stat(projectPath)
    if (st.isFile()) {
      files = [projectPath]
    } else {
      if (!getProj) {
        await client.close()
        throw new Error('未找到 AST_Fast 工具：get_project_structure_summary（目录模式需要）')
      }
      const quickRes = await getProj.invoke({ projectPath, mode: 'quick' })
      const quickText = toText(quickRes)
      let quick: any
      try {
        quick = JSON.parse(quickText)
      } catch (e) {
        await client.close()
        throw new Error(`quick 扫描结果非 JSON：${quickText.slice(0, 200)}...`)
      }
      files = Object.values(quick?.filesByLanguage || {})
        .flat()
        .map((rel: any) => path.join(projectPath, String(rel)))
    }
  } catch (e) {
    await client.close()
    throw new Error(`无法访问路径：${projectPath}`)
  }

  logger.info(`[ingest-code-with-ast] files to analyze: ${files.length}`)

  const docs: Document[] = []
  let fileOk = 0
  let symOk = 0
  let symSkip = 0

  for (const filePath of files) {
    try {
      const fileRes = await getFile.invoke({ filePath })
      const parsed = JSON.parse(toText(fileRes))
      const symbols: any[] = Array.isArray(parsed?.symbols) ? parsed.symbols : []
      fileOk++
      for (const s of symbols) {
        if (!shouldKeepSymbol(s, include)) { symSkip++; continue }
        try {
          const codeRes = await getCode.invoke({ filePath, symbolName: s.name, mode: 'full' })
          const code = toText(codeRes)
          if (!code || !code.trim()) { symSkip++; continue }
          docs.push(makeDoc(parsed, s, code))
          symOk++
        } catch (e) {
          logger.warn('[ingest-code-with-ast] 符号拉取失败', { filePath, symbol: s?.name, error: (e as Error).message })
        }
      }
    } catch (e) {
      logger.warn('[ingest-code-with-ast] 文件解析失败', { filePath, error: (e as Error).message })
    }
  }

  logger.info('[ingest-code-with-ast] summary', { files: files.length, fileOk, symOk, symSkip, docs: docs.length })

  if (docs.length === 0) {
    await client.close()
    logger.warn('无可写入的文档，流程结束')
    return
  }

  await upsertToChroma(collection, docs)
  logger.info('写入 Chroma 完成', { collection, count: docs.length })
  await client.close()
}

main().catch((err) => {
  logger.error('ingest-code-with-ast 失败', err)
  process.exit(1)
})


