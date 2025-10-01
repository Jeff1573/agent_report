// src/config/env.ts
/**
 * 环境变量加载与配置优先级
 * - 优先使用 agent/.env 中的配置，覆盖系统环境变量（override: true）
 * - 可通过 DOTENV_CONFIG_PATH 指定自定义 .env 路径
 */
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import * as fs from 'node:fs';

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH || path.resolve(process.cwd(), '.env'),
  override: true,
});

/**
 * 环境变量配置说明：
 *
 * 递归和工具调用限制配置（重要）：
 * - RECURSION_LIMIT: LangGraph递归深度限制（默认150，复杂任务建议100-200）
 * - TOOL_MAX_CALLS: 总工具调用次数限制（默认100，复杂任务建议100-200）
 * - TOOL_TIMEOUT_MS: 工具调用超时时间（默认45000ms，复杂任务建议45000-90000ms）
 * - TOOL_RETRY_ATTEMPTS: 工具调用失败重试次数（默认5，建议3-8次）
 *
 * 示例 .env 配置：
 * RECURSION_LIMIT=150
 * TOOL_MAX_CALLS=100
 * TOOL_TIMEOUT_MS=45000
 * TOOL_RETRY_ATTEMPTS=5
 */

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

// LangGraph 递归限制配置 - 解决复杂任务递归限制问题
// - RECURSION_LIMIT: 最大递归深度（默认75，复杂任务建议100-200）
export const RECURSION_LIMIT = Number(process.env.RECURSION_LIMIT || 300);

// 工具调用限制配置 - 防止过度调用和无限循环
// - TOOL_MAX_CALLS: 单次会话中所有工具的最大调用次数总和
export const TOOL_MAX_CALLS = Number(process.env.TOOL_MAX_CALLS || 100);
// - TOOL_TIMEOUT_MS: 工具调用的超时时间（毫秒）
export const TOOL_TIMEOUT_MS = Number(process.env.TOOL_TIMEOUT_MS || 45000);
// - TOOL_RETRY_ATTEMPTS: 工具调用失败时的重试次数
export const TOOL_RETRY_ATTEMPTS = Number(process.env.TOOL_RETRY_ATTEMPTS || 5);

// RAG 向量嵌入配置
export const KB_EMBED_PROVIDER = (process.env.KB_EMBED_PROVIDER || 'openai').toLowerCase();
export const KB_EMBED_MODEL = process.env.KB_EMBED_MODEL || '';
export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';

// 强制工具调用配置（仅 demo 脚本支持）
export const FORCE_TOOL_NAME = process.env.FORCE_TOOL_NAME || '';
export const FORCE_TOOL_CHOICE_STYLE = process.env.FORCE_TOOL_CHOICE_STYLE || 'tool';

// 本地 RAG 语料目录（绝对路径），用于 examples/rag-local-ask.ts
export const RAG_DATA_DIR = process.env.RAG_DATA_DIR || '';

// 知识库集合名（可选）。若未配置，部分写入流程可选择生成随机集合名作为兜底；
// 检索流程建议显式配置（避免因随机名而检索不到既有数据）。
export const KB_COLLECTION = (process.env.KB_COLLECTION || '').trim();

// 检索上下文拼接最大字符数（避免提示过长被模型截断）
export const RAG_CTX_CHAR_LIMIT = Math.max(500, Number(process.env.RAG_CTX_CHAR_LIMIT || 4000));

// 知识库文件存储目录（需要显式配置，未设置则视为禁用相关能力）
const KB_ROOT_FROM_ENV = process.env.KB_STORAGE_ROOT; // 知识库根目录（用于存放所有知识库资源）
const KB_RAW_FROM_ENV = process.env.KB_STORAGE_RAW_DIR; // 知识库原始文件目录（存放上传原始文件）

// MCP 配置文件路径
export const MCP_CONFIG_PATH = process.env.MCP_CONFIG_PATH;

/**
 * 确保目录存在并返回绝对路径。
 *
 * @param {string} dir - 需要创建或确认的目录路径
 * @returns {string} 目录的绝对路径
 */
function ensureDir(dir: string): string {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

let resolvedKbRoot: string | undefined;
let resolvedKbRawDir: string | undefined;

if (typeof KB_ROOT_FROM_ENV === 'string' && KB_ROOT_FROM_ENV.trim().length > 0) {
  const absRoot = path.resolve(KB_ROOT_FROM_ENV);
  resolvedKbRoot = ensureDir(absRoot);
  if (typeof KB_RAW_FROM_ENV === 'string' && KB_RAW_FROM_ENV.trim().length > 0) {
    resolvedKbRawDir = ensureDir(path.resolve(KB_RAW_FROM_ENV));
  } else {
    resolvedKbRawDir = ensureDir(path.join(absRoot, 'raw'));
  }
}

export const KB_STORAGE_ROOT = resolvedKbRoot; // 知识库根目录绝对路径（未配置则为 undefined）
export const KB_STORAGE_RAW_DIR = resolvedKbRawDir; // 知识库原始文件目录绝对路径（未配置则为 undefined）

export const CHROMA_URL = process.env.CHROMA_URL || process.env.CHROMADB_URL || ''; // Chroma 数据库 URL（HTTP 接入地址）

// -------------------------
// RAG（向量检索）可用性探测（可选）
// -------------------------
// 满足以下条件才认为“可用”：
// 1) 配置了 CHROMA_URL
// 2) 配置了 KB_COLLECTION
// 3) 嵌入配置完整：
//    - 当 provider=gemini 时：需要 GOOGLE_API_KEY（模型名可缺省，embeddings 默认）
//    - 当 provider=openai（默认）时：需要 KB_EMBED_MODEL（OPENAI_API_KEY 已作为聊天必需项）
const hasChroma = typeof CHROMA_URL === 'string' && CHROMA_URL.trim().length > 0;
const hasCollection = typeof KB_COLLECTION === 'string' && KB_COLLECTION.trim().length > 0;
const hasEmbeddings = KB_EMBED_PROVIDER === 'gemini'
  ? (typeof GOOGLE_API_KEY === 'string' && GOOGLE_API_KEY.trim().length > 0)
  : (typeof KB_EMBED_MODEL === 'string' && KB_EMBED_MODEL.trim().length > 0);
export const RAG_ENABLED = Boolean(hasChroma && hasCollection && hasEmbeddings);

// -------------------------
// 客户端重排与集合名上锁（测试/可选参数）
// -------------------------
// 是否启用客户端重排（当后端不支持 MMR 时仍可获得多样性/相关性提升）
export const RERANK_ENABLED = (process.env.RERANK_ENABLED ?? 'true').toLowerCase() !== 'false';
// 本地重排候选规模（先用 similarity 取候选，再做本地 MMR 选择）
export const RERANK_FETCHK = Number(process.env.RERANK_FETCHK || 128);
// 本地 MMR 折中系数（0~1）；靠近 1 偏向相关性，靠近 0 偏向多样性
export const RERANK_LAMBDA = Number(process.env.RERANK_LAMBDA || 0.35);
// 集合名白名单：逗号分隔；为空表示仅允许 KB_COLLECTION
export const KB_COLLECTION_WHITELIST = (process.env.KB_COLLECTION_WHITELIST || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/**
 * 生成安全的随机集合名：kb_YYYYMMDD_xxxxxxxx
 *
 * @returns {string} 集合名
 */
export function generateRandomCollectionName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 10);
  return `kb_${y}${m}${d}_${suffix}`;
}

/**
 * 规范化集合名，只保留 [a-zA-Z0-9_-]
 *
 * @param {string} name 原始名称
 * @returns {string} 清洗后的名称
 */
export function sanitizeCollectionName(name: string): string {
  return (name || '').replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * 验证必需的环境配置。
 * 
 * 在应用启动时调用此函数，确保所有必需的环境变量都已正确配置。
 * 如果缺少必需配置，将抛出带有详细说明的错误。
 * 
 * @throws {Error} 当缺少必需的环境变量时抛出
 * 
 * @example
 * // 在应用启动时调用
 * try {
 *   validateConfig();
 *   console.log('配置验证通过');
 * } catch (error) {
 *   console.error('配置错误:', error.message);
 *   process.exit(1);
 * }
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // 1. LLM 基础配置（必需）
  if (!OPENAI_API_KEY || OPENAI_API_KEY.trim().length === 0) {
    errors.push('OPENAI_API_KEY - LLM API 密钥未配置');
  }
  if (!OPENAI_MODEL || OPENAI_MODEL.trim().length === 0) {
    errors.push('OPENAI_MODEL - LLM 模型名称未配置（如: gpt-4, deepseek-chat）');
  }

  // 2. RAG 相关配置改为可选：
  //    若未完成配置，将不会启用 kb_search 工具，不阻断应用启动。
  //    如需启用 RAG，请确保 CHROMA_URL / KB_COLLECTION / 嵌入配置完整。

  // 5. Postgres Checkpointer 配置（可选，但若使用则必需）
  if (CHECKPOINT_MODE === 'postgres') {
    if (!CHECKPOINT_POSTGRES_URL || CHECKPOINT_POSTGRES_URL.trim().length === 0) {
      errors.push('CHECKPOINT_POSTGRES_URL - 使用 Postgres 持久化需要配置数据库连接 URL');
    }
  }

  // 抛出详细的配置错误
  if (errors.length > 0) {
    const errorMessage = [
      '❌ 配置验证失败，缺少以下必需的环境变量：\n',
      ...errors.map((err, i) => `  ${i + 1}. ${err}`),
      '\n💡 请检查 .env 文件或环境变量配置',
      '📝 参考 .env.example 或文档了解配置说明'
    ].join('\n');
    
    throw new Error(errorMessage);
  }
}

/**
 * 获取当前配置摘要（用于调试和日志）。
 * 
 * @returns {object} 配置摘要对象（不包含敏感信息）
 */
export function getConfigSummary(): Record<string, unknown> {
  return {
    llm: {
      provider: OPENAI_BASE_URL ? 'custom' : 'openai',
      model: OPENAI_MODEL,
      hasApiKey: Boolean(OPENAI_API_KEY)
    },
    embeddings: {
      provider: KB_EMBED_PROVIDER,
      model: KB_EMBED_MODEL || 'default',
      hasApiKey: KB_EMBED_PROVIDER === 'gemini' ? Boolean(GOOGLE_API_KEY) : Boolean(OPENAI_API_KEY)
    },
    vectorStore: {
      url: CHROMA_URL,
      collection: KB_COLLECTION || 'not-configured'
    },
    checkpoint: {
      mode: CHECKPOINT_MODE,
      hasPostgresUrl: Boolean(CHECKPOINT_POSTGRES_URL)
    },
    limits: {
      recursionLimit: RECURSION_LIMIT,
      toolMaxCalls: TOOL_MAX_CALLS,
      toolTimeout: TOOL_TIMEOUT_MS
    }
  };
}
