/**
 * 运行时类型定义
 * 
 * 本文件定义了 Agent 运行时使用的核心类型，避免使用 any 类型。
 */

import { StructuredTool } from '@langchain/core/tools'
import { BaseMessage } from '@langchain/core/messages'

/**
 * LangChain 工具类型（兼容多种工具实现）
 */
export type AnyTool = StructuredTool | {
  name: string
  description?: string
  call: (...args: unknown[]) => Promise<unknown>
  invoke?: (...args: unknown[]) => Promise<unknown>
}

/**
 * 工具调用参数类型
 */
export type ToolCallArgs = Record<string, unknown>

/**
 * 消息内容项（可能是字符串或对象）
 */
export interface MessageContentPart {
  type?: string
  text?: string
  [key: string]: unknown
}

/**
 * LLM 响应类型
 */
export interface LLMResponse {
  content?: string | MessageContentPart[] | BaseMessage[]
  tool_calls?: ToolCall[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

/**
 * 工具调用信息
 */
export interface ToolCall {
  name: string
  args: ToolCallArgs
  id?: string
}

/**
 * 工具调用结果
 */
export interface ToolResult {
  content?: string | unknown
  error?: string
  [key: string]: unknown
}

/**
 * LangGraph 配置类型
 */
export interface GraphConfig {
  configurable?: {
    thread_id?: string
    [key: string]: unknown
  }
  recursionLimit?: number
  [key: string]: unknown
}

/**
 * 知识库来源引用
 */
export interface SourceReference {
  index: number
  ref: string
}

/**
 * 知识库搜索结果
 */
export interface KBSearchResult {
  sources?: SourceReference[]
  context?: unknown[]
  [key: string]: unknown
}
