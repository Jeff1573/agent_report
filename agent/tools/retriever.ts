// agent/tools/retriever.ts
/**
 * 文档说明（内部检索 Tool 工厂）：
 * - 目标：将向量库的 `.asRetriever()` 产物通过 `createRetrieverTool(...)` 一键封装为可被代理调用的 Tool。
 * - 适用：最小可行 PoC，使用 `MemoryVectorStore` + `OpenAIEmbeddings`，零外部存储依赖。
 * - 集成：在运行时通过 `createAgentRuntime({ tools: [...] })` 将本工具注入到代理中。
 *
 * 关键 API 依据（LangChain.js v0.3）：
 * - createRetrieverTool：langchain/tools/retriever → 传入 retriever 与 { name, description }。
 * - VectorStore.asRetriever：支持 { k, searchType, searchKwargs } 等参数。
 * - MemoryVectorStore.fromTexts：将文本与元数据嵌入内存向量库。
 * - OpenAIEmbeddings：需环境变量 OPENAI_API_KEY。
 */

import '../config/env.js'
import { OpenAIEmbeddings } from '@langchain/openai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { createRetrieverTool } from 'langchain/tools/retriever'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'

/** Tool 返回类型占位，避免与不同 Tool 实现产生类型耦合 */
export type AnyTool = unknown

export interface InMemoryRetrieverToolOptions {
  /** 召回条数（默认 4） */
  k?: number
  /** 工具名（默认 'kb_search'） */
  name?: string
  /** 工具描述（强烈建议清晰指引何时使用内部知识库） */
  description?: string
  /** 相似度搜索类型（默认 'similarity'，可选 'mmr'） */
  searchType?: 'similarity' | 'mmr'
  /** 传入底层搜索的额外参数（如 { alpha: 0.5 } for MMR） */
  searchKwargs?: Record<string, unknown>
  /** Embeddings 提供者配置：openai 或 gemini（二选一，默认 openai） */
  embeddings?: {
    provider: 'openai' | 'gemini'
    /** 模型名：OpenAI 示例 'text-embedding-3-small'；Gemini 示例 'embedding-001' */
    model?: string
    /** 可选：覆盖使用的 API Key（否则走环境变量） */
    apiKey?: string
    /** OpenAI 可选维度（text-embedding-3 系列支持） */
    dimensions?: number
  }
}

/**
 * 创建一个基于内存向量库的检索 Tool。
 *
 * @param {string[]} texts - 需要被检索的文本切片（建议已按业务切块）。
 * @param {object[] | undefined} metadatas - 与文本对应的元数据对象数组（可选）。
 * @param {InMemoryRetrieverToolOptions | undefined} options - 检索与工具选项。
 * @returns {Promise<AnyTool>} 可被 LangGraph ReAct 代理调用的 Tool 实例。
 *
 * @example
 * const tool = await makeInMemoryRetrieverTool([
 *   'RAG 是检索增强生成范式，用于…',
 *   '向量检索常见的搜索类型包括相似度与 MMR…'
 * ], [{ source: 'kb.md#rag' }, { source: 'kb.md#mmr' }], { k: 4 });
 */
export async function makeInMemoryRetrieverTool(
  texts: string[],
  metadatas?: object[],
  options: InMemoryRetrieverToolOptions = {}
): Promise<AnyTool> {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('makeInMemoryRetrieverTool: 参数 texts 必须为非空字符串数组')
  }

  const name = (options.name && options.name.trim()) || 'kb_search'
  const description =
    options.description ||
    '检索内部知识库（向量召回）。当问题涉及公司/项目/私有文档信息时优先使用本工具。输入 query（中文/英文均可）。'

  // 1) 构建 Embeddings 与内存向量库（支持 openai / gemini）
  const provider = options.embeddings?.provider ?? 'openai'
  const apiKeyOverride = options.embeddings?.apiKey
  const embeddings =
    provider === 'gemini'
      ? new GoogleGenerativeAIEmbeddings({
        // Google Generative AI（Gemini）API Key：优先 overrides → GOOGLE_API_KEY → GEMINI_API_KEY
        apiKey:
          apiKeyOverride || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
        // 依据官方 v0.3 文档的示例模型名（embedding-001）
        model: options.embeddings?.model ?? options.embeddings?.model ?? undefined,
        modelName: options.embeddings?.model ?? undefined
      })
      : new OpenAIEmbeddings({
        // OpenAI Embeddings 可配置 model/dimensions；鉴权走 env 中的 OPENAI_API_KEY（在 makeChatModel 已加载 dotenv）
        model: options.embeddings?.model,
        dimensions:
          typeof options.embeddings?.dimensions === 'number'
            ? options.embeddings?.dimensions
            : undefined
      })
      
  const safeMetas: object[] = Array.isArray(metadatas)
    ? metadatas
    : Array.from({ length: texts.length }, () => ({}))

  const vectorStore = await MemoryVectorStore.fromTexts(texts, safeMetas, embeddings)

  // 2) 由向量库导出 retriever，并带上检索参数
  const retriever = vectorStore.asRetriever({
    k: typeof options.k === 'number' && options.k > 0 ? options.k : 4,
    searchType: options.searchType ?? 'similarity',
    searchKwargs: options.searchKwargs
  } as any)

  // 3) 使用官方工具工厂包装为可调用 Tool
  const tool = createRetrieverTool(
    retriever as any,
    {
      name,
      description
    } as any
  )

  return tool as AnyTool
}
