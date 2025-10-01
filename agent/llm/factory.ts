// src/llm/factory.ts
import { ChatOpenAI, ChatOpenAIFields } from '@langchain/openai'
import type { ZodTypeAny } from 'zod'
import {
  OPENAI_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_STREAM_USAGE,
  TIMEOUT_MS,
  MAX_RETRIES,
  CUSTOM_AUTH_HEADER,
  CUSTOM_AUTH_VALUE
} from '../config/env.js'

export type ChatModelOverrides = Partial<{
  model: string
  temperature: number
  timeout: number
  maxRetries: number
  streaming: boolean
  streamUsage: boolean
  baseURL: string
  /** 优先级最高：显式 Bearer API Key（覆盖环境变量） */
  apiKey: string
}>

/** 统一创建 ChatOpenAI（OpenAI 协议兼容） */
export function makeChatModel(overrides: ChatOpenAIFields & ChatModelOverrides = {}) {
  // 1) 处理鉴权：优先自定义头；否则走标准 Bearer（OPENAI_API_KEY）
  const defaultHeaders = (() => {
    // 覆盖优先：显式传入 apiKey
    if (typeof (overrides as any).apiKey === 'string' && (overrides as any).apiKey.trim().length > 0) {
      return { Authorization: `Bearer ${(overrides as any).apiKey}` }
    }
    if (CUSTOM_AUTH_HEADER && CUSTOM_AUTH_VALUE) {
      return { [CUSTOM_AUTH_HEADER]: CUSTOM_AUTH_VALUE }
    }
    if (OPENAI_API_KEY) {
      return { Authorization: `Bearer ${OPENAI_API_KEY}` }
    }
    return {}
  })()

  // 2) 处理 baseURL（兼容智谱 AI 等非标准端点）
  //    智谱 AI: https://open.bigmodel.cn/api/paas/v4/
  //    注意：智谱 AI 需要在末尾加斜杠
  let baseURL = overrides.baseURL ?? OPENAI_BASE_URL
  
  // 确保 baseURL 末尾有斜杠（智谱 AI 要求）
  if (baseURL && !baseURL.endsWith('/')) {
    baseURL = baseURL + '/'
  }
  
  // 2) 实例化模型（可随时替换 baseURL / model）
  const llm = new ChatOpenAI({
    model: overrides.model ?? OPENAI_MODEL,
    temperature: overrides.temperature ?? 0,
    timeout: overrides.timeout ?? TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? MAX_RETRIES,
    // 流式相关配置
    streaming: overrides.streaming ?? false, // 显式传递 streaming 参数
    streamUsage: overrides.streamUsage ?? OPENAI_STREAM_USAGE,
    // 关键：自定义 baseURL / headers 走 configuration
    configuration: {
      baseURL,
      defaultHeaders
    }
  })

  return llm
}

/**
 * 创建一个已绑定结构化输出（withStructuredOutput）的可运行体。
 *
 * 用法：在调用处定义 Zod Schema，然后调用本函数获取一个可直接 `invoke()`
 * 的 Runnable，返回值即为按 Schema 解析后的强类型对象。
 *
 * 约束与边界：
 * - 仅适用于支持结构化输出/JSON 模式/函数调用的模型与端点。
 * - 对可空字段请使用 `z.nullable(...)`；Schema 应仅包含可 JSON 表达的类型。
 * - 如目标“兼容”端点不支持某些特性（如 JSON 模式），可通过 `options.method` 调整或在上层做兜底。
 *
 * @template S Zod Schema 类型
 * @param schema Zod Schema（公共 API：请仅使用可 JSON 表达类型）
 * @param options 结构化输出选项（`name`/`strict`/`method`/`includeRaw` 等），默认 `{ strict: true }`
 * @param overrides 覆盖 `makeChatModel` 的基础配置（model/baseURL/timeout 等）
 * @returns 返回一个可 `invoke()` 的 Runnable，其输出类型由 Schema 推断
 */
export function makeStructuredChatModel<S extends ZodTypeAny>(
  schema: S,
  options?: Parameters<ChatOpenAI['withStructuredOutput']>[1],
  overrides: ChatModelOverrides = {}
) {
  // 复用既有工厂，确保 baseURL/headers 等配置一致
  const llm = makeChatModel(overrides)
  const merged = { strict: true, ...(options ?? {}) } as Parameters<
    ChatOpenAI['withStructuredOutput']
  >[1]
  // 直接返回绑定了结构化输出的 Runnable（类型由 schema 推断）
  return llm.withStructuredOutput(schema, merged)
}
