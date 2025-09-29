import path from 'node:path'
import * as fs from 'node:fs/promises'
import * as crypto from 'node:crypto'
import { Document } from '@langchain/core/documents'
import { ingestCode } from './codeIngestor.js'
import { splitDocuments, upsertToChroma } from './storage.js'
import { logger } from '../utils/logger.js'
import { METADATA_KEYS } from './metadataSchema.js'

/**
 * AST 优先入库参数。
 */
export interface SourceIngestOptions {
  /** 需要入库的文件绝对路径 */
  filePath: string
  /** 目标 Chroma 集合名称 */
  collection: string
  /** 可选：显式指定文件语言（否则按扩展名推断） */
  languageHint?: string
}

/**
 * 统一的源码入库调度器，优先尝试 AST_Fast 符号切块，失败时回退到常规字符切块。
 *
 * @param {SourceIngestOptions} options - 入库参数
 * @returns {Promise<number>} 成功写入 Chroma 的文档数量
 */
export async function ingestSourceWithFallback(options: SourceIngestOptions): Promise<number> {
  const { filePath, collection, languageHint } = options
  if (!filePath || !collection) {
    throw new Error('ingestSourceWithFallback: filePath 与 collection 不能为空')
  }

  const ext = path.extname(filePath).toLowerCase()
  const astCapable = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.sol', '.java'].includes(ext)

  if (astCapable) {
    try {
      const summary = await ingestCode({ projectPath: filePath, collection })
      if (summary.docs > 0) {
        return summary.docs
      }
    } catch (error) {
      logger.warn('[ingestSourceWithFallback] AST 入库失败，将回退常规路径', {
        filePath,
        collection,
        error: (error as Error).message
      })
    }
  }

  const source = await fs.readFile(filePath, 'utf-8')
  const uniqueMarker = crypto
    .createHash('sha256')
    .update(`${filePath}:${Date.now()}:${Math.random()}`)
    .digest('hex')
    .slice(0, 16)
  const baseDoc = new Document({
    pageContent: source,
    metadata: {
      [METADATA_KEYS.filePath]: filePath,
      [METADATA_KEYS.language]: languageHint ?? (ext.replace('.', '') || 'unknown'),
      [METADATA_KEYS.symbolName]: 'file_content',
      [METADATA_KEYS.symbolType]: 'file',
      [METADATA_KEYS.startLine]: 1,
      [METADATA_KEYS.endLine]: source.split('\n').length,
      originalFile: `fallback:${filePath}:${uniqueMarker}`
    }
  })

  const chunks = await splitDocuments([baseDoc])
  const result = await upsertToChroma(collection, chunks)
  return result.documents
}


