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

import crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as path from 'node:path'
import { Document } from '@langchain/core/documents'
import { Chroma } from '@langchain/community/vectorstores/chroma'
import { OpenAIEmbeddings } from '@langchain/openai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import {
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
  return path.resolve(KB_STORAGE_RAW_DIR, relative)
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

function makeEmbeddings() {
  const provider = (KB_EMBED_PROVIDER || 'openai').toLowerCase()
  if (provider === 'gemini') {
    const apiKey = GOOGLE_API_KEY
    if (!apiKey) {
      throw new Error('缺少 Google API Key，无法使用 Gemini 嵌入模型')
    }
    return new GoogleGenerativeAIEmbeddings({
      apiKey,
      model: KB_EMBED_MODEL
    })
  }
  return new OpenAIEmbeddings({
    model: KB_EMBED_MODEL
  })
}

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
  const { collectionName, filename, buffer, split } = params
  const meta = await saveRawFile(filename, buffer, collectionName)
  const docs = await loadDocumentsFromRaw(meta.relativePath)
  const chunks = await splitDocuments(docs, split)
  await upsertToChroma(collectionName, chunks)
  return {
    file: meta,
    chunks: chunks.length
  }
}

