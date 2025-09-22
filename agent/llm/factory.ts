// src/llm/factory.ts
import { ChatOpenAI } from "@langchain/openai";
import {
  OPENAI_BASE_URL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_STREAM_USAGE,
  TIMEOUT_MS,
  MAX_RETRIES,
  CUSTOM_AUTH_HEADER,
  CUSTOM_AUTH_VALUE,
} from "../config/env.js";

export type ChatModelOverrides = Partial<{
  model: string;
  temperature: number;
  timeout: number;
  maxRetries: number;
  streamUsage: boolean;
  baseURL: string;
}>;

/** 统一创建 ChatOpenAI（OpenAI 协议兼容） */
export function makeChatModel(overrides: ChatModelOverrides = {}) {
  // 1) 处理鉴权：优先自定义头；否则走标准 Bearer（OPENAI_API_KEY）
  const defaultHeaders =
    CUSTOM_AUTH_HEADER && CUSTOM_AUTH_VALUE
      ? { [CUSTOM_AUTH_HEADER]: CUSTOM_AUTH_VALUE }
      : OPENAI_API_KEY
      ? { Authorization: `Bearer ${OPENAI_API_KEY}` }
      : {};


  // 2) 实例化模型（可随时替换 baseURL / model）
  const llm = new ChatOpenAI({
    model: overrides.model ?? OPENAI_MODEL,
    temperature: overrides.temperature ?? 0,
    timeout: overrides.timeout ?? TIMEOUT_MS,
    maxRetries: overrides.maxRetries ?? MAX_RETRIES,
    // 某些“兼容”端点不支持 stream_options → 关掉即可
    streamUsage: overrides.streamUsage ?? OPENAI_STREAM_USAGE,
    // 关键：自定义 baseURL / headers 走 configuration
    configuration: {
      baseURL: overrides.baseURL ?? OPENAI_BASE_URL,
      defaultHeaders,
    },
  });

  return llm;
}
