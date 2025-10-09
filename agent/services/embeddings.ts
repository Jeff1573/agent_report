// agent/services/embeddings.ts
/**
 * 文档说明：向量嵌入模型工厂（供知识库入库与检索复用）。
 * - 职责：基于环境变量选择并构建 OpenAI 或 Gemini 的 Embeddings 实例。
 * - 依赖：`agent/config/env.ts`：KB_EMBED_PROVIDER、KB_EMBED_MODEL、GOOGLE_API_KEY。
 */

import { OpenAIEmbeddings } from '@langchain/openai'
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai'

/**
 * 构建 Embeddings 实例（支持 openai / gemini）。
 * 
 * 关键设计：直接从 process.env 读取环境变量，而不是从 env.ts 导入常量。
 * 这样可以确保读取到运行时动态设置的环境变量（例如 withRagEnv 设置的值）。
 *
 * @returns {OpenAIEmbeddings | GoogleGenerativeAIEmbeddings} Embeddings 实例
 * @throws {Error} 当缺少必需的 API Key 或配置时抛出错误
 *
 * @example
 * const embeddings = makeKbEmbeddings();
 */
export function makeKbEmbeddings(): OpenAIEmbeddings | GoogleGenerativeAIEmbeddings {
  // 直接从 process.env 读取，确保能获取到运行时动态设置的值
  const provider = (process.env.KB_EMBED_PROVIDER || 'openai').toLowerCase()
  
  if (provider === 'gemini') {
    // Gemini 嵌入模型
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || ''
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        '缺少 Google API Key，无法使用 Gemini 嵌入模型。\n' +
        '请在 .env 文件中设置 GOOGLE_API_KEY，或在界面配置中设置 API Key'
      )
    }
    const model = process.env.KB_EMBED_MODEL || 'gemini-embedding-001'
    return new GoogleGenerativeAIEmbeddings({
      apiKey,
      model,
      // 注意：当前LangChain版本不支持 outputDimensionality 参数
      // 如需自定义维度，请升级到更新版本或使用原生 Google GenAI SDK
    })
  }
  
  // OpenAI 嵌入模型（默认）
  const openaiApiKey = process.env.OPENAI_API_KEY || ''
  const embedModel = process.env.KB_EMBED_MODEL || ''
  
  if (!openaiApiKey || openaiApiKey.trim().length === 0) {
    throw new Error(
      '缺少 OpenAI API Key，无法使用 OpenAI 嵌入模型。\n' +
      '请在 .env 文件中设置 OPENAI_API_KEY，或在界面配置中设置 API Key，\n' +
      '或将 KB_EMBED_PROVIDER 设置为 "gemini"'
    )
  }
  if (!embedModel || embedModel.trim().length === 0) {
    throw new Error(
      '缺少嵌入模型名称配置。\n' +
      '请在 .env 文件中设置 KB_EMBED_MODEL（例如：text-embedding-3-small），\n' +
      '或在界面配置中设置嵌入模型'
    )
  }
  
  return new OpenAIEmbeddings({
    model: embedModel,
    openAIApiKey: openaiApiKey
  })
}
