// agent/services/codeIngestor.ts
/**
 * 模块说明：封装代码 AST 解析与向量入库流程，供 CLI 与界面复用。
 * - 功能：解析单文件或整目录，提取符号代码块，写入 Chroma。
 * - 特性：默认支持函数、类、合约、结构体、变量、常量，并在无符号时写入整文件回退文档。
 */

import path from 'node:path'
import * as fs from 'node:fs/promises'
import { Document } from '@langchain/core/documents'
import { MCP_CONFIG_PATH } from '../config/env.js'
import { createMCPClient } from '../tools/mcp.js'
import { upsertToChroma } from './storage.js'
import { logger } from '../utils/logger.js'

/**
 * 默认允许的符号类型集合。
 */
export const DEFAULT_SYMBOL_TYPES = new Set<string>([
  'function',
  'class',
  'contract',
  'struct',
  'variable',
  'constant',
  'module'
])

/**
 * 批量入库的摘要信息。
 */
export interface IngestSummary {
  files: number
  fileOk: number
  symOk: number
  symSkip: number
  fallbackDocs: number
  docs: number
}

/**
 * 入库调用参数。
 */
export interface IngestCodeOptions {
  projectPath: string
  collection: string
  include?: Iterable<string>
  mcpConfigPath?: string
}

/**
 * 将 MCP 工具返回值转换为文本。
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
 * 根据统一符号定义判断是否保留当前符号。
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
 */
async function makeFallbackDoc(filePath: string, parsed: any): Promise<Document> {
  const fileContent = await fs.readFile(filePath, 'utf-8')
  const lines = fileContent.split('\n').length
  return new Document({
    pageContent: fileContent,
    metadata: {
      filePath: String(parsed?.filePath || filePath),
      language: String(parsed?.language || 'unknown'),
      symbolName: 'file_content',
      symbolType: 'file',
      startLine: 1,
      endLine: lines
    }
  })
}

/**
 * 解析目录或文件，返回待处理文件列表。
 */
async function resolveInputFiles(projectPath: string, getProjTool: any): Promise<string[]> {
  const stat = await fs.stat(projectPath)
  if (stat.isFile()) {
    return [projectPath]
  }
  if (!getProjTool) {
    throw new Error('未找到 AST_Fast 工具：get_project_structure_summary（目录模式需要）')
  }
  const quickRes = await getProjTool.invoke({ projectPath, mode: 'quick' })
  const quickText = toText(quickRes)
  let quick: any
  try {
    quick = JSON.parse(quickText)
  } catch {
    throw new Error(`quick 扫描结果非 JSON：${quickText.slice(0, 200)}...`)
  }
  return Object.values(quick?.filesByLanguage || {})
    .flat()
    .map((rel: any) => path.join(projectPath, String(rel)))
}

/**
 * 执行 AST 解析并写入向量库。
 */
export async function ingestCode(options: IngestCodeOptions): Promise<IngestSummary> {
  const { projectPath, collection } = options
  const includeSet = new Set(
    Array.from(options.include ?? DEFAULT_SYMBOL_TYPES).map((item) => String(item).toLowerCase())
  )

  logger.info('[ingest-code-with-ast] start', {
    projectPath,
    collection,
    include: Array.from(includeSet)
  })

  const client = await createMCPClient(options.mcpConfigPath ?? MCP_CONFIG_PATH)

  try {
    const tools: any[] = await client.getTools()
    const getProj = tools.find((t: any) => t.name === 'get_project_structure_summary')
    const getFile = tools.find((t: any) => t.name === 'get_file_structure_summary')
    const getCode = tools.find((t: any) => t.name === 'get_code_block_for_symbol')

    if (!getFile || !getCode) {
      throw new Error('未找到 AST_Fast 工具：get_file_structure_summary / get_code_block_for_symbol')
    }

    const files = await resolveInputFiles(projectPath, getProj)
    logger.info(`[ingest-code-with-ast] files to analyze: ${files.length}`)

    const docs: Document[] = []
    let fileOk = 0
    let symOk = 0
    let symSkip = 0
    let fallbackDocs = 0

    for (const filePath of files) {
      try {
        const fileRes = await getFile.invoke({ filePath })
        const parsed = JSON.parse(toText(fileRes))
        const symbols: any[] = Array.isArray(parsed?.symbols) ? parsed.symbols : []
        fileOk++

        let fileHasDoc = false

        for (const s of symbols) {
          if (!shouldKeepSymbol(s, includeSet)) {
            symSkip++
            continue
          }
          try {
            const codeRes = await getCode.invoke({ filePath, symbolName: s.name, mode: 'full' })
            const code = toText(codeRes)
            if (!code || !code.trim()) {
              symSkip++
              continue
            }
            docs.push(makeDoc(parsed, s, code))
            symOk++
            fileHasDoc = true
          } catch (error) {
            logger.warn('[ingest-code-with-ast] 符号拉取失败', {
              filePath,
              symbol: s?.name,
              error: (error as Error).message
            })
          }
        }

        if (!fileHasDoc) {
          const fallbackDoc = await makeFallbackDoc(filePath, parsed)
          docs.push(fallbackDoc)
          fallbackDocs++
        }
      } catch (error) {
        logger.warn('[ingest-code-with-ast] 文件解析失败', {
          filePath,
          error: (error as Error).message
        })
      }
    }

    logger.info('[ingest-code-with-ast] summary', {
      files: files.length,
      fileOk,
      symOk,
      symSkip,
      fallbackDocs,
      docs: docs.length
    })

    if (docs.length === 0) {
      logger.warn('无可写入的文档，流程结束')
      return { files: files.length, fileOk, symOk, symSkip, fallbackDocs, docs: docs.length }
    }

    await upsertToChroma(collection, docs)
    logger.info('写入 Chroma 完成', { collection, count: docs.length })

    return { files: files.length, fileOk, symOk, symSkip, fallbackDocs, docs: docs.length }
  } finally {
    await client.close()
  }
}


