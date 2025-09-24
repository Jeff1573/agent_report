// agent/examples/rag-local-ask.ts
/**
 * 文档说明（本地 RAG 一体化演示）：
 * - 功能：从绝对路径目录（RAG_DATA_DIR）加载 .txt/.md 文本 → 切块 → 向量化（Gemini）→ 内存向量库检索 → 问答链 → 返回带引用的答案。
 * - 运行：`npm run rag:ask -w agent -- --q "你的问题"`
 * - 依赖：@langchain/textsplitters、@langchain/google-genai、langchain（MemoryVectorStore, DirectoryLoader/TextLoader）
 * - 环境：
 *   - RAG_DATA_DIR（绝对路径）
 *   - GOOGLE_API_KEY 或 GEMINI_API_KEY（Embedding）
 *   - OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL（对话模型，见 llm/factory.ts）
 */

import '../config/env.ts'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { z } from 'zod'
import { Document } from '@langchain/core/documents'
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { formatDocumentsAsString } from 'langchain/util/document'
import { DirectoryLoader } from 'langchain/document_loaders/fs/directory'
import { TextLoader } from 'langchain/document_loaders/fs/text'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { logger } from '../utils/logger.js'
import { makeChatModel } from '../llm/factory.js'
import { RAG_DATA_DIR, GOOGLE_API_KEY } from '../config/env.js'

/**
 * 解析命令行参数（--q 或直接拼接 argv）。
 * @returns {string} 问题文本
 */
function getCliQuestion(): string {
  const args = process.argv.slice(2)
  const qFlagIndex = args.findIndex((a) => a === '--q')
  if (qFlagIndex >= 0 && typeof args[qFlagIndex + 1] === 'string') {
    return args[qFlagIndex + 1]
  }
  const qEq = args.find((a) => a.startsWith('--q='))
  if (qEq) return qEq.slice('--q='.length)
  return args.join(' ').trim() || '请用内部知识回答：项目里 RAG 是如何工作的？'
}

/**
 * 校验并返回绝对路径的语料目录。
 * @throws 当目录未配置或不是绝对路径/不存在时抛错
 */
function requireAbsoluteDataDir(): string {
  // 原始值（可能含引号/转义序列）
  let raw = String(RAG_DATA_DIR || '').trim()
  if (!raw) throw new Error('未配置 RAG_DATA_DIR 环境变量（需要绝对路径）')
  // 去除首尾引号与控制字符（常见问题：\\r 被 .env 解析为回车）
  raw = raw.replace(/^['"]|['"]$/g, '') // 去掉包裹引号
  raw = raw.replace(/[\r\n\t]/g, '') // 去掉控制字符
  // 兼容使用正斜杠（Node 在 Windows 也可识别）
  const dir = path.isAbsolute(raw) ? raw : raw
  if (!path.isAbsolute(dir)) throw new Error(`RAG_DATA_DIR 必须为绝对路径，当前：${raw}`)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`RAG_DATA_DIR 不存在或不是目录：${dir}`)
  }
  return dir
}

/**
 * 从本地目录加载 .txt/.md 文本为 Document[]。
 * @param {string} root 绝对路径目录
 * @returns {Promise<Document[]>} 文档数组（携带 metadata.source=绝对路径）
 */
async function loadLocalDocuments(root: string): Promise<Document[]> {
  const loader = new DirectoryLoader(root, {
    '.txt': (p: string) => new TextLoader(p),
    '.md': (p: string) => new TextLoader(p)
  })
  const docs = await loader.load()
  // 统一确保 metadata.source 为绝对路径字符串
  docs.forEach((d) => {
    const src = (d.metadata as any)?.source
    if (typeof src === 'string' && !path.isAbsolute(src)) {
      ;(d.metadata as any).source = path.join(root, src)
    }
  })
  return docs
}

/**
 * 使用递归字符切块器进行中文友好分块。
 * @param {Document[]} docs 原始文档
 * @param {number} chunkSize 每块大小（默认 1000）
 * @param {number} chunkOverlap 重叠字数（默认 150）
 */
async function splitIntoChunks(
  docs: Document[],
  chunkSize = 1000,
  chunkOverlap = 150
): Promise<Document[]> {
  const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap })
  return splitter.splitDocuments(docs)
}

/**
 * 构建内存向量库与检索器（Gemini Embeddings）。
 * @param {Document[]} chunks 切块后的文档
 * @param {number} k 召回条数（默认 4）
 */
async function buildRetriever(chunks: Document[], k = 4) {
  const apiKey = GOOGLE_API_KEY || process.env.GEMINI_API_KEY || ''
  const embeddings = new GoogleGenerativeAIEmbeddings({
    apiKey: apiKey || undefined,
    model: 'text-embedding-004'
  })
  const store = await MemoryVectorStore.fromDocuments(chunks, embeddings)
  return store.asRetriever({ k, searchType: 'similarity' })
}

/**
 * 组装标准 RAG 问答链：prompt → llm → parser。
 */
function buildRagChain() {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      'system',
      '你是检索增强助手。依据提供的“上下文”严格回答用户问题；无法从上下文得到的内容请直说不知道。请在答案末尾附带“参考来源”列表。\n\n上下文：\n{context}'
    ],
    ['human', '{question}']
  ])
  const llm = makeChatModel({ streaming: false, streamUsage: false })
  return prompt.pipe(llm).pipe(new StringOutputParser())
}

/**
 * 将检索到的文档列表格式化为去重后的来源列表。
 * @param {Document[]} docs 命中文档
 * @returns {string[]} 绝对路径来源列表（去重）
 */
function collectCitations(docs: Document[]): string[] {
  const set = new Set<string>()
  for (const d of docs) {
    const src = (d.metadata as any)?.source
    if (typeof src === 'string' && src.trim().length > 0) set.add(src)
  }
  return Array.from(set)
}

/** 主流程 */
async function main(): Promise<void> {
  const question = getCliQuestion()
  const root = requireAbsoluteDataDir()
  logger.info('RAG 配置', {
    RAG_DATA_DIR: root,
    provider: 'gemini',
    embedModel: 'text-embedding-004'
  })

  // 1) 加载与切块
  const rawDocs = await loadLocalDocuments(root)
  logger.info('已加载文档', { count: rawDocs.length })
  const chunks = await splitIntoChunks(rawDocs, 1000, 150)
  logger.info('已完成切块', { chunks: chunks.length })

  // 2) 内存向量检索器
  const retriever = await buildRetriever(chunks, 4)

  // 3) 召回命中文档（用于引用与上下文）
  const hits = await retriever.invoke(question)
  const citations = collectCitations(hits)
  const ctx = formatDocumentsAsString(hits)

  // 4) 问答链
  const chain = buildRagChain()
  const answer = await chain.invoke({ context: ctx, question })

  // 5) 输出（附引用）
  const lines = [answer.trim(), '', '参考来源：', ...citations.map((s, i) => `- [${i + 1}] ${s}`)]
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'))
}

main().catch((err: unknown) => {
  const any = err as any
  logger.error('执行失败', { message: any?.message || String(err) })
  process.exit(1)
})
