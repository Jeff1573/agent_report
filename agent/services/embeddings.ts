// agent/services/embeddings.ts
/**
 * 文档说明：向量嵌入模型工厂（供知识库入库与检索复用）。
 * - 职责：基于环境变量选择并构建 OpenAI 或 Gemini 的 Embeddings 实例。
 * - 依赖：`agent/config/env.ts`：KB_EMBED_PROVIDER、KB_EMBED_MODEL、GOOGLE_API_KEY。
 */

import { OpenAIEmbeddings } from '@langchain/openai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { KB_EMBED_MODEL, KB_EMBED_PROVIDER, GOOGLE_API_KEY, OPENAI_API_KEY } from '../config/env.js'

/**
 * 构建 Embeddings 实例（支持 openai / gemini）。
 *
 * @returns {OpenAIEmbeddings | GoogleGenerativeAIEmbeddings} Embeddings 实例
 * @throws {Error} 当缺少必需的 API Key 或配置时抛出错误
 *
 * @example
 * const embeddings = makeKbEmbeddings();
 */
export function makeKbEmbeddings(): OpenAIEmbeddings | GoogleGenerativeAIEmbeddings {
  const provider = (KB_EMBED_PROVIDER || 'openai').toLowerCase()
  
  if (provider === 'gemini') {
    // Gemini 嵌入模型
    const apiKey = GOOGLE_API_KEY
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        '缺少 Google API Key，无法使用 Gemini 嵌入模型。\n' +
        '请在 .env 文件中设置 GOOGLE_API_KEY 或 GEMINI_API_KEY'
      )
    }
    const model = KB_EMBED_MODEL || 'gemini-embedding-001'
    return new GoogleGenerativeAIEmbeddings({
      apiKey,
      model,
      // 注意：当前LangChain版本不支持 outputDimensionality 参数
      // 如需自定义维度，请升级到更新版本或使用原生 Google GenAI SDK
    })
  }
  
  // OpenAI 嵌入模型（默认）
  if (!OPENAI_API_KEY || OPENAI_API_KEY.trim().length === 0) {
    throw new Error(
      '缺少 OpenAI API Key，无法使用 OpenAI 嵌入模型。\n' +
      '请在 .env 文件中设置 OPENAI_API_KEY，或将 KB_EMBED_PROVIDER 设置为 "gemini"'
    )
  }
  if (!KB_EMBED_MODEL || KB_EMBED_MODEL.trim().length === 0) {
    throw new Error(
      '缺少嵌入模型名称配置。\n' +
      '请在 .env 文件中设置 KB_EMBED_MODEL（例如：text-embedding-3-small）'
    )
  }
  
  return new OpenAIEmbeddings({
    model: KB_EMBED_MODEL,
    openAIApiKey: OPENAI_API_KEY
  })
}
