// agent/services/embeddings.ts
/**
 * 文档说明：向量嵌入模型工厂（供知识库入库与检索复用）。
 * - 职责：基于环境变量选择并构建 OpenAI 或 Gemini 的 Embeddings 实例。
 * - 依赖：`agent/config/env.ts`：KB_EMBED_PROVIDER、KB_EMBED_MODEL、GOOGLE_API_KEY。
 */

import { OpenAIEmbeddings } from '@langchain/openai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'
import { KB_EMBED_MODEL, KB_EMBED_PROVIDER, GOOGLE_API_KEY } from '../config/env.js'

/**
 * 构建 Embeddings 实例（支持 openai / gemini）。
 *
 * @returns {OpenAIEmbeddings | GoogleGenerativeAIEmbeddings} Embeddings 实例
 *
 * @example
 * const embeddings = makeKbEmbeddings();
 */
export function makeKbEmbeddings(): OpenAIEmbeddings | GoogleGenerativeAIEmbeddings {
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

