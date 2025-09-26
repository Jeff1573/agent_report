// agent/services/storage.ts
/**
 * 文档说明：知识库文件与向量资源的底层持久化服务。
 * - 职责：
 *   1. 提供原始文件保存/列出/读取/删除能力。
 *   2. 提供向量集合（Chroma 集合）的注册、迁移和删除能力。
 * - 依赖：`agent/config/env.ts` 中的 KB_STORAGE_ROOT、KB_STORAGE_RAW_DIR 等目录配置；
 *   Chroma 客户端使用 LangChain.js v0.3 官方集成。
 */

// agent/services/storage.ts
/**
 * 文档说明：知识库文件与向量资源的底层持久化服务。
 * - 职责：
 *   1. 保存与管理原始上传文件。
 *   2. 将文档切块后写入 Chroma 向量数据库。
 * - 依赖：LangChain.js v0.3 官方集成；环境变量配置见 config/env.ts。
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import { Document } from '@langchain/core/documents'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { OpenAIEmbeddings } from '@langchain/openai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import {
  KB_STORAGE_ROOT,
  KB_STORAGE_RAW_DIR,
  KB_EMBED_MODEL,
  KB_EMBED_PROVIDER,
  GOOGLE_API_KEY,
  CHROMA_URL
} from '../config/env.js'
import { Buffer } from 'node:buffer'
import { Stats } from 'node:fs'

export interface StoredFileMeta {
  /** 原始上传文件名 */
  filename: string
  /** 保存后的相对路径（相对 raw 目录） */
  relativePath: string
  /** 文件大小（字节） */
  size: number
  /** 文件 MIME（根据扩展名推断） */
  mime: string
  /** 文件创建时间戳（毫秒） */
  createdAt: number
}

export interface SaveFileResult {
  /** 文件元数据 */
  file: StoredFileMeta
  /** 切块后的文档数量 */
  chunks: number
}

export interface VectorUpsertResult {
  /** 知识库集合名称 */
  collectionName: string
  /** 新增文档数量 */
  documents: number
}

export interface FileDescriptor {
  /** 文件绝对路径 */
  path: string
  /** 文件元数据 */
  meta: StoredFileMeta
}

/**
 * 推断简易 MIME。
 */
function inferMime(filename: string): string {
  const lowered = filename.toLowerCase()
  if (lowered.endsWith('.pdf')) return 'application/pdf'
  if (lowered.endsWith('.md')) return 'text/markdown'
  if (lowered.endsWith('.txt')) return 'text/plain'
  if (lowered.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return 'application/octet-stream'
}

function hashFilename(name: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(`${Date.now()}:${name}:${Math.random()}`)
  return hash.digest('hex').slice(0, 16)
}

function resolveRawPath(relative: string): string {
  return path.resolve(KB_STORAGE_RAW_DIR || '', relative)
}

/**
 * 将文件缓冲保存至原始目录。
 *
 * @param filename  原始文件名
 * @param buffer    文件数据
 * @param collectionName 对应的知识库集合，用于目录隔离
 */
/**
 * 保存原始文件到知识库存储目录。
 *
 * @param {string} filename - 原始文件名
 * @param {Buffer} buffer - 文件内容 Buffer
 * @param {string} collectionName - 目标集合名称
 * @returns {Promise<StoredFileMeta>} 保存后的元数据
 */
export async function saveRawFile(
  filename: string,
  buffer: Buffer,
  collectionName: string
): Promise<StoredFileMeta> {
  if (!KB_STORAGE_RAW_DIR || !KB_STORAGE_ROOT) {
    throw new Error('知识库存储目录未配置，当前环境禁用 RAG 入库功能')
  }
  if (!filename || filename.trim().length === 0) {
    throw new Error('saveRawFile: filename 不能为空')
  }
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('saveRawFile: buffer 必须为 Buffer')
  }
  if (!collectionName || collectionName.trim().length === 0) {
    throw new Error('saveRawFile: collectionName 不能为空')
  }

  const safeCollection = collectionName.replace(/[^a-zA-Z0-9_-]/g, '-')
  const dir = path.resolve(KB_STORAGE_RAW_DIR, safeCollection)
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true })
  }

  const ext = path.extname(filename) || '.bin'
  const base = path.basename(filename, ext)
  const hashed = hashFilename(filename)
  const savedName = `${base}.${hashed}${ext}`
  const abs = path.join(dir, savedName)

  await fs.writeFile(abs, buffer)
  const stat = (await fs.stat(abs)) as Stats
  const relativePath = path.relative(KB_STORAGE_RAW_DIR, abs)
  return {
    filename,
    relativePath,
    size: stat.size,
    mime: inferMime(filename),
    createdAt: stat.birthtimeMs || stat.mtimeMs || Date.now()
  }
}

/**
 * 列出指定集合的原始文件。若 collectionName 为空，返回所有集合的文件。
 */
/**
 * 列出指定集合的原始文件。
 *
 * @param {string | undefined} collectionName - 可选集合名称过滤
 * @returns {Promise<FileDescriptor[]>} 文件描述符数组
 */
export async function listRawFiles(collectionName?: string): Promise<FileDescriptor[]> {
  if (!KB_STORAGE_RAW_DIR) {
    return []
  }
  const root = KB_STORAGE_RAW_DIR
  if (!fsSync.existsSync(root)) {
    return []
  }
  const descriptors: FileDescriptor[] = []
  const dirs = await fs.readdir(root, { withFileTypes: true })
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue
    if (collectionName && dirent.name !== collectionName) continue
    const subdir = path.join(root, dirent.name)
    const files = await fs.readdir(subdir)
    for (const file of files) {
      const abs = path.join(subdir, file)
      const stat = await fs.stat(abs)
      const relativePath = path.relative(root, abs)
      descriptors.push({
        path: abs,
        meta: {
          filename: file,
          relativePath,
          size: stat.size,
          mime: inferMime(file),
          createdAt: stat.birthtimeMs || stat.mtimeMs
        }
      })
    }
  }
  return descriptors
}

/**
 * 依据相对路径读取 Buffer。
 */
/**
 * 读取原始文件内容。
 *
 * @param {string} relativePath - 相对 raw 目录的路径
 * @returns {Promise<Buffer>} 文件 Buffer
 */
export async function readRawFile(relativePath: string): Promise<Buffer> {
  if (!KB_STORAGE_RAW_DIR) {
    throw new Error('知识库原始目录未配置，无法读取文件')
  }
  const abs = resolveRawPath(relativePath)
  return fs.readFile(abs)
}

/**
 * 删除原始文件。
 */
/**
 * 删除原始文件。
 *
 * @param {string} relativePath - 相对路径
 * @returns {Promise<void>} Promise 实例
 */
export async function removeRawFile(relativePath: string): Promise<void> {
  if (!KB_STORAGE_RAW_DIR) {
    throw new Error('知识库原始目录未配置，无法删除文件')
  }
  const abs = resolveRawPath(relativePath)
  await fs.unlink(abs)
}

/**
 * 载入原始文件并自动转换为 LangChain Document 数组。
 * 当前支持 txt/md/pdf/docx，根据扩展名选择对应解析器。
 */
/**
 * 加载原始文件并转换为 LangChain Document 数组。
 *
 * @param {string} relativePath - 相对路径
 * @returns {Promise<Document[]>} 文档数组
 */
export async function loadDocumentsFromRaw(relativePath: string): Promise<Document[]> {
  if (!KB_STORAGE_RAW_DIR) {
    throw new Error('知识库原始目录未配置，无法加载文档')
  }
  const abs = resolveRawPath(relativePath)
  const ext = path.extname(abs).toLowerCase()
  let docs: Document[] = []
  if (ext === '.pdf') {
    const { PDFLoader } = await import('@langchain/community/document_loaders/fs/pdf')
    docs = await new PDFLoader(abs).load()
  } else if (ext === '.docx') {
    const { DocxLoader } = await import('@langchain/community/document_loaders/fs/docx')
    docs = await new DocxLoader(abs).load()
  } else if (ext === '.md' || ext === '.txt') {
    const { TextLoader } = await import('langchain/document_loaders/fs/text')
    docs = await new TextLoader(abs).load()
  } else {
    throw new Error(`暂不支持的文件类型：${ext}`)
  }
  return docs.map((doc, index) =>
    new Document({
      pageContent: doc.pageContent,
      metadata: {
        ...(doc.metadata ?? {}),
        source: abs,
        originalFile: relativePath,
        rawIndex: index
      }
    })
  )
}

/**
 * 对文档进行递归字符切块。
 */
export interface SplitOptions {
  chunkSize?: number
  chunkOverlap?: number
}

/**
 * 将文档切块并补充 chunk 元数据。
 *
 * @param {Document[]} docs - 原始文档数组
 * @param {SplitOptions} options - 切块参数
 * @returns {Promise<Document[]>} 切块后的文档
 */
export async function splitDocuments(
  docs: Document[],
  options: SplitOptions = {}
): Promise<Document[]> {
  if (!KB_STORAGE_ROOT) {
    throw new Error('知识库根目录未配置，无法执行文档切块')
  }
  const size = typeof options.chunkSize === 'number' && options.chunkSize > 0 ? options.chunkSize : 1000
  const overlap = typeof options.chunkOverlap === 'number' && options.chunkOverlap >= 0 ? options.chunkOverlap : 150
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize: size, chunkOverlap: overlap })
  const splits = await splitter.splitDocuments(docs)
  return splits.map((doc, index) => {
    const original = String((doc.metadata as any)?.originalFile ?? 'unknown')
    const chunkId = crypto
      .createHash('sha256')
      .update(`${original}:${index}:${doc.pageContent.slice(0, 16)}`)
      .digest('hex')
      .slice(0, 16)
    return new Document({
      pageContent: doc.pageContent,
      metadata: {
        ...(doc.metadata ?? {}),
        chunkIndex: index,
        chunkId,
        chunkSize: doc.pageContent.length
      }
    })
  })
}

import { makeKbEmbeddings as makeEmbeddings } from './embeddings.js'
import { sanitizeCollectionName, generateRandomCollectionName } from '../config/env.js'

/**
 * 确保 Chroma 集合存在。
 * @param embeddings Embeddings 实例
 * @param collectionName 集合名
 * @returns Chroma 集合
 */
async function ensureChromaCollection(embeddings: OpenAIEmbeddings | GoogleGenerativeAIEmbeddings, collectionName: string) {
  try {
    return await Chroma.fromExistingCollection(embeddings as any, {
      collectionName,
      url: CHROMA_URL || undefined
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not exist')) {
      return await Chroma.fromDocuments([], embeddings as any, {
        collectionName,
        url: CHROMA_URL || undefined
      })
    }
    throw error
  }
}

/**
 * 只读方式打开已存在的 Chroma 集合，不存在即抛错（避免误创建空集合）。
 *
 * @param {OpenAIEmbeddings | GoogleGenerativeAIEmbeddings} embeddings - 向量嵌入实例
 * @param {string} collectionName - 目标集合名
 * @returns {Promise<Chroma>} 已存在的集合实例
 */
export async function openChromaReadonly(
  embeddings: OpenAIEmbeddings | GoogleGenerativeAIEmbeddings,
  collectionName: string
): Promise<Chroma> {
  if (!CHROMA_URL || CHROMA_URL.trim().length === 0) {
    throw new Error('未配置 CHROMA_URL，无法连接 Chroma 服务')
  }
  try {
    return await Chroma.fromExistingCollection(embeddings as any, {
      collectionName,
      url: CHROMA_URL || undefined
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('does not exist')) {
      throw new Error(`Chroma 集合不存在：${collectionName}。请确认 KB_COLLECTION 是否正确配置，或先完成入库。`)
    }
    throw error
  }
}

/**
 * 将文档向量化并写入 Chroma 集合。
 */
/**
 * 将文档写入 Chroma 集合。
 *
 * @param {string} collectionName - 集合名
 * @param {Document[]} docs - 待写入文档
 * @returns {Promise<VectorUpsertResult>} 写入结果
 */
export async function upsertToChroma(
  collectionName: string,
  docs: Document[]
): Promise<VectorUpsertResult> {
  if (!KB_STORAGE_ROOT || !KB_STORAGE_RAW_DIR) {
    throw new Error('知识库目录未配置，无法写入向量库')
  }
  if (!collectionName || collectionName.trim().length === 0) {
    throw new Error('upsertToChroma: collectionName 不能为空')
  }
  if (!Array.isArray(docs) || docs.length === 0) {
    throw new Error('upsertToChroma: docs 不能为空')
  }

  const embeddings = makeEmbeddings()
  const store = await ensureChromaCollection(embeddings, collectionName)
  const ids = docs.map((doc) => {
    const fromMeta = (doc.metadata as any)?.chunkId
    if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta
    return crypto
      .createHash('sha256')
      .update(doc.pageContent)
      .digest('hex')
      .slice(0, 16)
  })
  await store.addDocuments(docs, { ids })
  return {
    collectionName,
    documents: docs.length
  }
}

/**
 * 检索器构建选项。
 */
export interface RetrieverOptions {
  /** 返回条数（默认 4） */
  k?: number
  /** 检索类型：similarity | mmr（默认 similarity） */
  searchType?: 'similarity' | 'mmr'
  /** 当 searchType=mmr 时的折中系数（0~1，默认 0.5） */
  mmrLambda?: number
  /**
   * 当 searchType=mmr 时的候选集规模（默认 max(32, 4*k)）。
   * fetchK 越大，MMR 在“多样性”上的效果越明显，但会略增时延。
   */
  fetchK?: number
  /** 元数据过滤（保留占位，初期可不实现） */
  where?: Record<string, unknown>
}

/**
 * 从指定集合构建只读检索器；集合不存在将抛错。
 *
 * @param {string} collectionName - 集合名
 * @param {RetrieverOptions} options - 检索器参数
 * @returns {Promise<ReturnType<Chroma['asRetriever']>>} 检索器
 */
export async function buildChromaRetriever(
  collectionName: string,
  options: RetrieverOptions = {}
) {
  const embeddings = makeEmbeddings()
  const store = await openChromaReadonly(embeddings, sanitizeCollectionName(collectionName))
  const k = typeof options.k === 'number' && options.k > 0 ? options.k : 4
  const searchType = (options.searchType === 'mmr' ? 'mmr' : 'similarity') as 'similarity' | 'mmr'
  // 仅当 mmr 时透传 { lambda, fetchK }；其余保持 similarity 默认行为
  const mmrLambda = typeof options.mmrLambda === 'number' ? options.mmrLambda : 0.5
  const fetchK = typeof options.fetchK === 'number' && options.fetchK > 0 ? options.fetchK : Math.max(32, 4 * k)
  const retriever = store.asRetriever({
    k,
    searchType,
    searchKwargs: searchType === 'mmr' ? ({ lambda: mmrLambda, fetchK } as any) : undefined
  })
  return retriever
}

/**
 * 生成或清洗集合名。
 * - 若传入非空，先清洗后返回；
 * - 否则生成随机名（kb_YYYYMMDD_xxxxxxxx）。
 */
export function resolveCollectionName(input?: string): string {
  const name = (input ?? '').trim()
  if (name) return sanitizeCollectionName(name)
  return generateRandomCollectionName()
}

export interface IngestFileParams {
  collectionName: string
  filename: string
  buffer: Buffer
  split?: SplitOptions
}

/**
 * 一次性完成文件保存、解析、切块与写入向量库。
 *
 * @param {IngestFileParams} params - 入库参数
 * @returns {Promise<SaveFileResult>} 保存结果
 */
export async function ingestFile(params: IngestFileParams): Promise<SaveFileResult> {
  if (!KB_STORAGE_ROOT || !KB_STORAGE_RAW_DIR) {
    throw new Error('知识库目录未配置，无法执行入库流程')
  }
  const { collectionName, filename, buffer, split } = params
  // 保存原始文件
  const meta = await saveRawFile(filename, buffer, collectionName)
  // 加载原始文件
  const docs = await loadDocumentsFromRaw(meta.relativePath)
  // 切块
  const chunks = await splitDocuments(docs, split)
  // 写入向量库
  await upsertToChroma(collectionName, chunks)
  return {
    file: meta,
    chunks: chunks.length
  }
}
