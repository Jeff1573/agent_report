// agent/services/rag.ts
/**
 * 文档说明：RAG（Chroma）配置校验与入库服务（供桌面主进程调用）。
 * - 职责：
 *   1) 校验 RAG 配置（HTTP 心跳与集合存在性检查，兼容 v2/v1）
 *   2) 基于传入配置执行文件/目录入库（设置临时环境变量 → 复用 storage.ingestFile）
 * - 设计：主进程仅做 IPC 转发，不承载 AI/RAG 逻辑；本模块负责所有实现。
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ingestSourceWithFallback } from './sourceIngestor.js'
import { logger } from '../utils/logger.js'
import { isOperationTimeoutError, throwIfAborted } from '../utils/asyncControl.js'

/**
 * 嵌入模型基础配置（精简版）。
 */
export interface EmbeddingsConfigLite {
  provider: 'openai' | 'gemini'
  model?: string
  apiKey?: string
}

/**
 * 检索器配置（精简版）。
 */
export interface RetrieverConfigLite {
  k?: number
  searchType?: 'similarity' | 'mmr'
  mmrLambda?: number
  fetchK?: number
}

/**
 * 向量数据库（Chroma）配置（精简版）。
 */
export interface VectorDbConfigLite {
  id?: string
  name?: string
  enabled?: boolean
  isDefault?: boolean
  provider: 'chroma'
  connection: { url: string }
  storage: { rootDir: string; rawDir: string }
  defaultCollection?: string
  embeddings?: EmbeddingsConfigLite
  retriever?: RetrieverConfigLite
  updatedAt?: number
}

/**
 * RAG 配置校验结果（精简版）。
 */
export interface RagValidationResultLite {
  ok: boolean
  errors: string[]
  warnings?: string[]
  info?: {
    heartbeat?: boolean
    /** true=已确认存在；false=已确认不存在；undefined=当前无法确认。 */
    defaultCollectionExists?: boolean
  }
  timestamp: number
}

const DEFAULT_CHROMA_TENANT = 'default_tenant'
const DEFAULT_CHROMA_DATABASE = 'default_database'

/**
 * 构建 Chroma REST API 的完整 URL，支持 v1/v2。
 * - 规范化 base 路径，去除末尾斜杠
 * - 去除末尾已包含的 /api/vN 片段，避免重复
 * - 统一追加 /api/{version}/{endpoint}
 *
 * @param {string} baseUrl - 基础地址，例如 http://localhost:8000 或 http://host/base
 * @param {'v1'|'v2'} version - API 版本
 * @param {string} endpoint - 端点名称，例如 heartbeat 或 collections
 * @returns {string} 完整的请求 URL
 */
function buildApiUrl(baseUrl: string, version: 'v1' | 'v2', endpoint: string): string {
  const safeEndpoint = endpoint.replace(/^\/+/, '')
  try {
    const url = new URL(baseUrl)
    const path = (url.pathname || '').replace(/\/+$/, '')
    const withoutApi = path.replace(/\/(api\/v\d+)(?:\/)?$/, '')
    const joined = `${withoutApi}/api/${version}/${safeEndpoint}`.replace(/\/+$/, '')
    url.pathname = joined
    return url.toString()
  } catch {
    const trimmed = baseUrl.replace(/\/+$/, '')
    return `${trimmed}/api/${version}/${safeEndpoint}`
  }
}

/**
 * 从可能的响应结构中提取集合条目数组。
 * - 兼容 Array 顶层返回，或对象中的 collections/items/data/results/result
 *
 * @param {unknown} json - 原始 JSON 数据
 * @returns {unknown[] | null} 集合条目数组；响应结构不可识别时返回 null
 */
function extractCollectionsArray(json: unknown): unknown[] | null {
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    const tryKeys = ['collections', 'items', 'data', 'results', 'result']
    for (const key of tryKeys) {
      const val = obj[key]
      if (Array.isArray(val)) return val
      if (key === 'data' && val && typeof val === 'object') {
        const nested = extractCollectionsArray(val)
        if (nested !== null) return nested
      }
    }
  }
  return null
}

/**
 * 判断集合列表中是否存在目标集合名。
 * - 支持元素为字符串或对象（name/collection_name）
 *
 * @param {unknown[]} entries - 集合条目数组
 * @param {string} targetName - 目标集合名
 * @returns {boolean} 是否存在
 */
function hasCollection(entries: unknown[], targetName: string): boolean {
  for (const entry of entries) {
    if (typeof entry === 'string') {
      if (entry === targetName) return true
    } else if (entry && typeof entry === 'object') {
      const e = entry as { name?: unknown; collection_name?: unknown }
      const name = typeof e.name === 'string' ? e.name : undefined
      const cname = typeof e.collection_name === 'string' ? e.collection_name : undefined
      if (name === targetName || cname === targetName) return true
    }
  }
  return false
}

function assertNonEmpty(text: string, name: string): void {
  if (!text || !text.trim()) throw new Error(`${name} 不能为空`)
}

function normalizeConfig(input: VectorDbConfigLite): VectorDbConfigLite {
  const provider = (input.provider || 'chroma') as 'chroma'
  const connUrl = (input.connection?.url || '').trim()
  const rootDir = (input.storage?.rootDir || '').trim()
  const rawDir = (input.storage?.rawDir || '').trim()
  assertNonEmpty(connUrl, 'Chroma URL')
  assertNonEmpty(rootDir, '知识库根目录')
  assertNonEmpty(rawDir, '原始文件目录')
  return {
    ...input,
    provider,
    connection: { url: connUrl },
    storage: { rootDir, rawDir },
    embeddings: input.embeddings
      ? {
          provider: input.embeddings.provider,
          model: (input.embeddings.model || '').trim() || undefined,
          apiKey: (input.embeddings.apiKey || '').trim() || undefined
        }
      : undefined
  }
}

/**
 * 使用 HTTP 接口校验 Chroma 可用性与集合存在性。
 */
export async function validateRagConfig(cfg: VectorDbConfigLite): Promise<RagValidationResultLite> {
  const norm = normalizeConfig(cfg)
  const errors: string[] = []
  const warnings: string[] = []

  let heartbeat = false
  let defaultCollectionExists: boolean | undefined

  const base = norm.connection.url.replace(/\/$/, '')

  // 心跳
  try {
    // 优先 v2，失败降级 v1
    const hbErrors: string[] = []
    async function tryHeartbeat(version: 'v2' | 'v1'): Promise<boolean> {
      const url = buildApiUrl(base, version, 'heartbeat')
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 5000)
      try {
        const res = await fetch(url, { method: 'GET', signal: controller.signal })
        clearTimeout(t)
        if (res.ok) return true
        hbErrors.push(`/${version}/heartbeat 状态码 ${res.status}`)
        return false
      } catch (err) {
        clearTimeout(t)
        hbErrors.push(`/${version}/heartbeat 异常：${err instanceof Error ? err.message : String(err)}`)
        return false
      }
    }
    heartbeat = (await tryHeartbeat('v2')) || (await tryHeartbeat('v1'))
    if (!heartbeat) errors.push(`心跳检查失败：${hbErrors.join(' | ')}`)
  } catch (e) {
    errors.push(`心跳检查失败：${e instanceof Error ? e.message : String(e)}`)
  }

  // 集合存在性（配置了默认集合时）
  if (heartbeat && norm.defaultCollection) {
    try {
      async function listCollections(version: 'v2' | 'v1'): Promise<unknown | null> {
        // Chroma v2 已将集合接口下沉到 tenant/database 维度，旧的 /api/v2/collections 会返回 404。
        // 当前配置模型尚未暴露 tenant/database，因此最小修复先使用默认租户与默认数据库。
        const endpoint =
          version === 'v2'
            ? `tenants/${DEFAULT_CHROMA_TENANT}/databases/${DEFAULT_CHROMA_DATABASE}/collections`
            : 'collections'
        const url = buildApiUrl(base, version, endpoint)
        const controller = new AbortController()
        const t = setTimeout(() => controller.abort(), 7000)
        try {
          const res = await fetch(url, { method: 'GET', signal: controller.signal })
          clearTimeout(t)
          if (!res.ok) return null
          return (await res.json()) as unknown
        } catch {
          clearTimeout(t)
          return null
        }
      }

      let data: unknown | null = await listCollections('v2')
      if (data == null) data = await listCollections('v1')

      if (data != null) {
        const entries = extractCollectionsArray(data)
        if (entries === null) {
          warnings.push(`集合列表响应结构无法识别，无法确认默认集合状态`)
        } else {
          const exists = hasCollection(entries, norm.defaultCollection)
          defaultCollectionExists = exists
          if (!exists) warnings.push(`默认集合不存在：${norm.defaultCollection}`)
        }
      } else {
        warnings.push(`无法获取集合列表（v2/v1 均失败），跳过集合存在性检查`)
      }
    } catch (e) {
      warnings.push(`集合存在性检查失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    info: { heartbeat, defaultCollectionExists },
    timestamp: Date.now()
  }
}

/**
 * 在执行回调期间设置临时环境变量，结束后恢复。
 */
async function withRagEnv<T>(cfg: VectorDbConfigLite, fn: () => Promise<T>): Promise<T> {
  const norm = normalizeConfig(cfg)
  const prev: Record<string, string | undefined> = {
    CHROMA_URL: process.env.CHROMA_URL,
    KB_STORAGE_ROOT: process.env.KB_STORAGE_ROOT,
    KB_STORAGE_RAW_DIR: process.env.KB_STORAGE_RAW_DIR,
    KB_EMBED_PROVIDER: process.env.KB_EMBED_PROVIDER,
    KB_EMBED_MODEL: process.env.KB_EMBED_MODEL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY
  }
  process.env.CHROMA_URL = norm.connection.url
  process.env.KB_STORAGE_ROOT = norm.storage.rootDir
  process.env.KB_STORAGE_RAW_DIR = norm.storage.rawDir
  process.env.KB_EMBED_PROVIDER = norm.embeddings?.provider || 'openai'
  if ((norm.embeddings?.provider || 'openai') === 'openai') {
    process.env.KB_EMBED_MODEL = norm.embeddings?.model || 'text-embedding-3-small'
    if (norm.embeddings?.apiKey) process.env.OPENAI_API_KEY = norm.embeddings.apiKey
  } else {
    process.env.KB_EMBED_MODEL = norm.embeddings?.model || 'embedding-001'
    if (norm.embeddings?.apiKey) process.env.GOOGLE_API_KEY = norm.embeddings.apiKey
  }
  try {
    return await fn()
  } finally {
    Object.entries(prev).forEach(([k, v]) => {
      if (typeof v === 'string') process.env[k] = v
      else delete process.env[k]
    })
  }
}

/**
 * 基于配置入库单个文件（智能识别代码/文档并选择处理方式）。
 * 
 * @param {VectorDbConfigLite} cfg - RAG 配置
 * @param {string} filePath - 文件路径
 * @param {string} collection - 集合名称
 * @param {object} split - 切块参数
 * @param {object} options - 扩展选项
 * @returns {Promise<{ method: string; chunks: number }>}
 */
export async function ingestFileWithConfig(
  cfg: VectorDbConfigLite,
  filePath: string,
  collection: string,
  split?: { chunkSize?: number; chunkOverlap?: number },
  options?: { forceMethod?: 'auto' | 'ast' | 'text'; signal?: AbortSignal }
): Promise<{ method: string; chunks: number }> {
  const result = { method: 'text', chunks: 0 }
  
  await withRagEnv(cfg, async () => {
    throwIfAborted(options?.signal)
    logger.info('[ingestFile] 开始导入前置检查', {
      filePath,
      collection
    })
    const { assertEmbeddingAvailable, ingestFile } = await import('./storage.js')
    // Embedding 是导入前提，先做轻量预检，避免前提不成立时继续处理文件。
    await assertEmbeddingAvailable({ signal: options?.signal })
    logger.info('[ingestFile] 前置检查通过，开始处理文件', {
      filePath,
      collection
    })
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) throw new Error('选择的路径不是文件')
    
    const strategy = getFileStrategy(filePath)
    if (strategy.skip) {
      throw new Error(`不支持的文件类型: ${path.extname(filePath)}`)
    }
    
    const filename = path.basename(filePath)
    const forceMethod = options?.forceMethod || 'auto'
    
    // 决定使用哪种处理方式
    const shouldUseAst = 
      forceMethod === 'ast' || 
      (forceMethod === 'auto' && strategy.useAst)
    
    if (shouldUseAst && strategy.type === 'code') {
      // 代码文件：尝试 AST 解析
      try {
        const docsCount = await ingestSourceWithFallback({
          filePath,
          collection,
          signal: options?.signal
        })
        
        if (docsCount > 0) {
          result.method = 'AST-Fast'
          result.chunks = docsCount
          logger.info(`[ingestFile] AST 解析成功: ${filename} (${docsCount} 个符号)`)
          return
        }
      } catch (astError) {
        if (options?.signal?.aborted || isOperationTimeoutError(astError)) throw astError
        logger.warn(`[ingestFile] AST 解析失败，回退到文本切块: ${filename}`, {
          error: (astError as Error).message
        })
      }
    }
    
    // 文档文件或 AST 失败的回退：使用传统文本切块
    throwIfAborted(options?.signal)
    const buffer = await fs.readFile(filePath)
    const res = await ingestFile({
      collectionName: collection,
      filename,
      buffer,
      split: split ? { chunkSize: split.chunkSize, chunkOverlap: split.chunkOverlap } : undefined,
      signal: options?.signal
    })
    
    result.method = '文本切块'
    result.chunks = res.chunks
    logger.info(`[ingestFile] 文档处理成功: ${filename} (${res.chunks} 个切块)`)
  })
  
  return result
}

/**
 * 文件类型分类，用于智能处理策略选择。
 */
const FILE_CATEGORIES = {
  // AST-Fast 支持的代码文件
  CODE: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.sol', '.java']),
  // 文档文件
  DOCS: new Set(['.md', '.txt', '.pdf', '.docx']),
  // 配置文件（通常不切块）
  CONFIG: new Set(['.json', '.yaml', '.yml', '.toml', '.ini', '.env', '.xml'])
}

/**
 * 获取文件的处理策略。
 * 
 * @param {string} filePath - 文件路径
 * @returns {{ type: string, useAst: boolean, skip: boolean }}
 */
function getFileStrategy(filePath: string): { type: string; useAst: boolean; skip: boolean } {
  const ext = path.extname(filePath).toLowerCase()
  
  if (FILE_CATEGORIES.CODE.has(ext)) {
    return { type: 'code', useAst: true, skip: false }
  } else if (FILE_CATEGORIES.DOCS.has(ext)) {
    return { type: 'document', useAst: false, skip: false }
  } else if (FILE_CATEGORIES.CONFIG.has(ext)) {
    // 配置文件暂时也作为文档处理，后续可优化为整文件入库
    return { type: 'config', useAst: false, skip: false }
  }
  
  // 不支持的文件类型
  return { type: 'unknown', useAst: false, skip: true }
}

/**
 * 基于配置入库目录（智能识别代码/文档并选择处理方式）。
 * 
 * @param {VectorDbConfigLite} cfg - RAG 配置
 * @param {string} dirPath - 目录路径
 * @param {string} collection - 集合名称
 * @param {object} split - 切块参数
 * @param {object} options - 扩展选项
 * @returns {Promise<{ total: number; processed: number; codeFiles: number; docFiles: number }>}
 */
export async function ingestDirWithConfig(
  cfg: VectorDbConfigLite,
  dirPath: string,
  collection: string,
  split?: { chunkSize?: number; chunkOverlap?: number },
  options?: { 
    forceMethod?: 'auto' | 'ast' | 'text',  // 强制处理方式
    onProgress?: (info: { file: string; type: string; method: string }) => void,  // 进度回调
    signal?: AbortSignal
  }
): Promise<{ total: number; processed: number; codeFiles: number; docFiles: number }> {
  const result = { total: 0, processed: 0, codeFiles: 0, docFiles: 0 }
  
  await withRagEnv(cfg, async () => {
    throwIfAborted(options?.signal)
    logger.info('[ingestDir] 开始导入前置检查', {
      dirPath,
      collection
    })
    const { assertEmbeddingAvailable, ingestFile } = await import('./storage.js')
    // 目录导入只做一次前置探测，通过后再开始扫描和逐文件处理。
    await assertEmbeddingAvailable({ signal: options?.signal })
    logger.info('[ingestDir] 前置检查通过，开始扫描目录', {
      dirPath,
      collection
    })
    const stat = await fs.stat(dirPath)
    if (!stat.isDirectory()) throw new Error('选择的路径不是目录')
    
    // 扫描所有文件
    async function walk(start: string): Promise<string[]> {
      throwIfAborted(options?.signal)
      const out: string[] = []
      const entries = await fs.readdir(start, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(start, entry.name)
        if (entry.isDirectory()) {
          // 跳过 node_modules 等常见的排除目录
          if (!['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
            out.push(...(await walk(full)))
          }
        } else {
          out.push(full)
        }
      }
      return out
    }
    
    const files = await walk(dirPath)
    result.total = files.length
    
    for (const filePath of files) {
      throwIfAborted(options?.signal)
      const strategy = getFileStrategy(filePath)
      
      if (strategy.skip) {
        logger.debug(`[ingestDir] 跳过不支持的文件: ${filePath}`)
        continue
      }
      
      const filename = path.basename(filePath)
      const forceMethod = options?.forceMethod || 'auto'
      
      try {
        // 决定使用哪种处理方式
        const shouldUseAst = 
          forceMethod === 'ast' || 
          (forceMethod === 'auto' && strategy.useAst)
        
        if (shouldUseAst && strategy.type === 'code') {
          // 代码文件：尝试 AST 解析
          options?.onProgress?.({
            file: filename,
            type: strategy.type,
            method: 'AST-Fast'
          })
          
          try {
            const docsCount = await ingestSourceWithFallback({
              filePath,
              collection,
              signal: options?.signal
            })
            
            if (docsCount > 0) {
              result.codeFiles++
              result.processed++
              logger.info(`[ingestDir] AST 解析成功: ${filename} (${docsCount} 个符号)`)
              continue
            }
          } catch (astError) {
            if (options?.signal?.aborted || isOperationTimeoutError(astError)) throw astError
            logger.warn(`[ingestDir] AST 解析失败，回退到文本切块: ${filename}`, {
              error: (astError as Error).message
            })
          }
        }
        
        // 文档文件或 AST 失败的回退：使用传统文本切块
        options?.onProgress?.({
          file: filename,
          type: strategy.type,
          method: '文本切块'
        })
        
        const buffer = await fs.readFile(filePath)
        await ingestFile({
          collectionName: collection,
          filename,
          buffer,
          split: split ? { chunkSize: split.chunkSize, chunkOverlap: split.chunkOverlap } : undefined,
          signal: options?.signal
        })
        
        if (strategy.type === 'code') {
          result.codeFiles++
        } else {
          result.docFiles++
        }
        result.processed++
        
        logger.info(`[ingestDir] 文档处理成功: ${filename}`)
        
      } catch (error) {
        // 目录导入遇到全局依赖超时时立即停止，避免对后续文件重复等待同一故障。
        if (options?.signal?.aborted || isOperationTimeoutError(error)) throw error
        logger.error(`[ingestDir] 文件处理失败: ${filename}`, {
          error: (error as Error).message
        })
      }
    }
  })
  
  return result
}
