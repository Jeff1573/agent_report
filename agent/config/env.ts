// src/config/env.ts
/**
 * 环境变量加载与配置优先级
 * - 优先使用 agent/.env 中的配置，覆盖系统环境变量（override: true）
 * - 可通过 DOTENV_CONFIG_PATH 指定自定义 .env 路径
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(process.cwd(), '.env'),
  override: true,
});

// 1) OpenAI 兼容配置（必填项请在 .env 中提供）
export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL; // 你的网关 /v1 即可
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
export const OPENAI_MODEL = process.env.OPENAI_MODEL || '';

// 某些“兼容”端点不支持 stream_options，设为 false 可避免报错
export const OPENAI_STREAM_USAGE =
  (process.env.OPENAI_STREAM_USAGE ?? 'false').toLowerCase() !== 'false';

export const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 60_000);
export const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);

// 如果供应商要求自定义请求头（而非 Authorization: Bearer）
export const CUSTOM_AUTH_HEADER = process.env.CUSTOM_AUTH_HEADER || '';
export const CUSTOM_AUTH_VALUE = process.env.CUSTOM_AUTH_VALUE || '';

// （可选）日志相关配置
export const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
export const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');
export const LOG_COLOR = process.env.LOG_COLOR || 'auto'; // auto | true | false

// LangGraph 持久化（Checkpointer）相关配置
// - CHECKPOINT_MODE: memory | postgres （默认 memory）
// - CHECKPOINT_POSTGRES_URL: Postgres 连接串（postgres 模式必填）
// - THREAD_ID_FALLBACK: 若 CLI 未显式传入 threadId，可用此值兜底
export const CHECKPOINT_MODE = (process.env.CHECKPOINT_MODE || 'memory').toLowerCase();
export const CHECKPOINT_POSTGRES_URL = process.env.CHECKPOINT_POSTGRES_URL || process.env.POSTGRES_URL || '';
export const THREAD_ID_FALLBACK = process.env.THREAD_ID || process.env.LG_THREAD_ID || '';

// Tavily API Key（搜索工具）
export const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

// RAG 向量嵌入配置
export const KB_EMBED_PROVIDER = (process.env.KB_EMBED_PROVIDER || 'openai').toLowerCase();
export const KB_EMBED_MODEL = process.env.KB_EMBED_MODEL || '';
export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';

// 强制工具调用配置（仅 demo 脚本支持）
export const FORCE_TOOL_NAME = process.env.FORCE_TOOL_NAME || '';
export const FORCE_TOOL_CHOICE_STYLE = process.env.FORCE_TOOL_CHOICE_STYLE || 'tool';

// 本地 RAG 语料目录（绝对路径），用于 examples/rag-local-ask.ts
export const RAG_DATA_DIR = process.env.RAG_DATA_DIR || '';
