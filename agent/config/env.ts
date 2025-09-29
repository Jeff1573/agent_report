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
