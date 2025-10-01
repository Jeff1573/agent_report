// src/llm/factory.ts
/**
 * LLM 工厂模块
 * 
 * 负责创建 ChatOpenAI 实例，支持配置优先级系统：
 * 1. 函数参数（overrides）- 最高优先级
 * 2. 环境变量 - 兜底配置
 * 
 * 配置来源会记录到日志中，便于调试。
 */
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
import { logger } from '../utils/logger.js'

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

/**
 * 统一创建 ChatOpenAI 实例（支持 OpenAI 协议兼容端点）
 * 
 * 配置优先级：
 * 1. 函数参数 overrides（最高优先级）- 来自合并配置系统
 * 2. 环境变量（兜底配置）- 从 env.ts 读取
 * 
 * @param {ChatModelOverrides} overrides 配置覆盖项
 * @returns {ChatOpenAI} ChatOpenAI 实例
 * 
 * @example
 * // 使用合并配置创建
 * const { config } = await getMergedConfig();
 * const llm = makeChatModel(config);
 * 
 * @example
 * // 使用环境变量创建（向后兼容）
 * const llm = makeChatModel();
 */
export function makeChatModel(overrides: ChatOpenAIFields & ChatModelOverrides = {}) {
  // 1) 处理鉴权：优先显式传入的 apiKey；否则走自定义头或环境变量
  const apiKeySource = (() => {
    if (typeof (overrides as any).apiKey === 'string' && (overrides as any).apiKey.trim().length > 0) {
      return 'param';
    }
    if (CUSTOM_AUTH_HEADER && CUSTOM_AUTH_VALUE) {
      return 'custom-header';
    }
    if (OPENAI_API_KEY) {
      return 'env';
    }
    return 'missing';
  })();

  const defaultHeaders = (() => {
    // 优先级 1: 显式传入 apiKey（来自合并配置）
    if (typeof (overrides as any).apiKey === 'string' && (overrides as any).apiKey.trim().length > 0) {
      return { Authorization: `Bearer ${(overrides as any).apiKey}` }
    }
    // 优先级 2: 自定义认证头（环境变量）
    if (CUSTOM_AUTH_HEADER && CUSTOM_AUTH_VALUE) {
      return { [CUSTOM_AUTH_HEADER]: CUSTOM_AUTH_VALUE }
    }
    // 优先级 3: 标准 Bearer（环境变量）
    if (OPENAI_API_KEY) {
      return { Authorization: `Bearer ${OPENAI_API_KEY}` }
    }
    return {}
  })()

  // 2) 处理 baseURL（兼容智谱 AI 等非标准端点）
  //    智谱 AI: https://open.bigmodel.cn/api/paas/v4/
  //    注意：智谱 AI 需要在末尾加斜杠
  const baseURLSource = overrides.baseURL ? 'param' : (OPENAI_BASE_URL ? 'env' : 'default');
  let baseURL = overrides.baseURL ?? OPENAI_BASE_URL
  
  // 确保 baseURL 末尾有斜杠（智谱 AI 要求）
  if (baseURL && !baseURL.endsWith('/')) {
    baseURL = baseURL + '/'
  }
  
  // 3) 确定最终配置及来源
  const modelSource = overrides.model ? 'param' : (OPENAI_MODEL ? 'env' : 'missing');
  const finalModel = overrides.model ?? OPENAI_MODEL;
  const finalTemperature = overrides.temperature ?? 0;
  const finalTimeout = overrides.timeout ?? TIMEOUT_MS;
  const finalMaxRetries = overrides.maxRetries ?? MAX_RETRIES;
  const finalStreaming = overrides.streaming ?? false;
  const finalStreamUsage = overrides.streamUsage ?? OPENAI_STREAM_USAGE;

  // 4) 确定最终的 API Key（优先级：参数 > 自定义头 > 环境变量）
  const finalApiKey = (() => {
    if (typeof (overrides as any).apiKey === 'string' && (overrides as any).apiKey.trim().length > 0) {
      return (overrides as any).apiKey;
    }
    // 如果使用自定义认证头，不传 apiKey（避免冲突）
    if (CUSTOM_AUTH_HEADER && CUSTOM_AUTH_VALUE) {
      return undefined;
    }
    // 否则使用环境变量
    return OPENAI_API_KEY || undefined;
  })();

  // 记录配置来源（调试用）
  logger.debug('LLM 配置来源:', {
    model: `${finalModel} (${modelSource})`,
    baseURL: `${baseURL || 'default'} (${baseURLSource})`,
    apiKey: `${apiKeySource}`,
    hasApiKey: Boolean(finalApiKey),
    temperature: finalTemperature,
    timeout: finalTimeout,
    streaming: finalStreaming,
  });
  
  // 5) 实例化模型（可随时替换 baseURL / model）
  // 注意：如果使用自定义认证头，apiKey 传 undefined，通过 defaultHeaders 认证
  const llm = new ChatOpenAI({
    model: finalModel,
    temperature: finalTemperature,
    timeout: finalTimeout,
    maxRetries: finalMaxRetries,
    // 流式相关配置
    streaming: finalStreaming,
    streamUsage: finalStreamUsage,
    // 关键：直接传递 apiKey 参数（优先级高于环境变量）
    ...(finalApiKey ? { apiKey: finalApiKey } : {}),
    // 自定义 baseURL / headers 走 configuration
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
