// agent/llm/message-role.ts
/**
 * 文档说明（UTF-8）：
 *
 * 提供 LangChain 消息在运行时的稳定类型判别与角色归一化，优先使用官方类型守卫（做法A）。
 * 适配流式与非流式：支持 `AIMessageChunk` 等分片；保留 `developer` 为独立角色。
 *
 * 依赖版本依据：@langchain/core v0.3.x
 * - isHumanMessage / isSystemMessage / isAIMessage / isAIMessageChunk：
 *   参考 v0.3 API 文档：
 *   https://v03.api.js.langchain.com/modules/_langchain_core.messages.html
 * - isToolMessage / ToolMessageChunk（getType/concat 等）：
 *   参考 v0.3 API 文档：
 *   https://v03.api.js.langchain.com/modules/_langchain_core.messages_tool.html
 */

import {
  isAIMessage,
  isAIMessageChunk,
  isHumanMessage,
  isSystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";

// ToolMessage 相关守卫位于 messages/tool 模块
// 官方 TypeDoc：_langchain_core.messages_tool
import { isToolMessage } from "@langchain/core/messages/tool";

/**
 * 统一的消息角色（包含 developer 独立角色）。
 */
export type UnifiedRole =
  | "user"
  | "assistant"
  | "system"
  | "developer"
  | "tool"
  | "unknown";

/**
 * 判定一个对象是否为“分片（Chunk）”风格的消息。
 *
 * 判定依据（尽量稳健且轻量）：
 * - 运行时类名包含 "Chunk"；或
 * - 存在可连接的 `concat` 方法（AIMessageChunk/ToolMessageChunk 提供）。
 *
 * 注意：这是运行时启发式，不依赖 instanceof，避免多包副本导致失效。
 *
 * @param {unknown} msg - 任意待判定对象
 * @returns {boolean} 是否为分片消息
 */
export function isMessageChunk(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const ctorName = (msg as any)?.constructor?.name as string | undefined;
  if (typeof ctorName === "string" && ctorName.includes("Chunk")) return true;
  const hasConcat = typeof (msg as any)?.concat === "function";
  return !!hasConcat;
}

/**
 * 将 LangChain 消息判定为统一角色。
 *
 * 优先级（做法A：官方类型守卫）：
 * 1) isHumanMessage → user
 * 2) isSystemMessage → system
 * 3) isToolMessage → tool
 * 4) isAIMessage / isAIMessageChunk → assistant
 * 5) 兜底：依据 msg.type 与 msg.role（含 developer）
 * 6) 最后尝试 getType(): MessageType
 *
 * @param {unknown} msg - 任意 LangChain 消息或分片
 * @returns {UnifiedRole} 归一化角色
 *
 * @example
 * // 判定各类消息
 * const role = getUnifiedRole(anyMsg);
 * if (role === 'assistant') {
 *   // LLM 输出（含流式分片）
 * }
 */
export function getUnifiedRole(msg: unknown): UnifiedRole {
  // 1) 官方类型守卫（最稳）
  if (isHumanMessage(msg as any)) return "user";
  if (isSystemMessage(msg as any)) return "system";
  if (isToolMessage(msg as any)) return "tool";
  if (isAIMessage(msg as any) || isAIMessageChunk(msg as any)) return "assistant";

  // 2) 兜底：依据标准化的字段（type / role）
  const typeVal = (msg as any)?.type as
    | "human"
    | "ai"
    | "system"
    | "tool"
    | "generic"
    | string
    | undefined;
  switch (typeVal) {
    case "human":
      return "user";
    case "ai":
      return "assistant";
    case "system":
      return "system";
    case "tool":
      return "tool";
    // generic → 看 role
  }

  const role = (msg as any)?.role as
    | "user"
    | "assistant"
    | "system"
    | "developer"
    | string
    | undefined;
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  if (role === "system") return "system";
  if (role === "developer") return "developer"; // 按你的要求保留独立

  // 3) 最后尝试类方法 getType（MessageType）
  try {
    const getType = (msg as any)?.getType;
    if (typeof getType === "function") {
      const t = getType.call(msg) as string | undefined;
      if (t === "human") return "user";
      if (t === "ai") return "assistant";
      if (t === "system") return "system";
      if (t === "tool") return "tool";
    }
  } catch {
    // 忽略
  }

  return "unknown";
}

/**
 * 窄化：是否用户侧消息（HumanMessage 或 role=user 等）。
 * @param {unknown} msg - 任意消息
 * @returns {msg is BaseMessage} 是否用户消息
 */
export function isUserLikeMessage(msg: unknown): msg is BaseMessage {
  if (isHumanMessage(msg as any)) return true;
  const role = (msg as any)?.role;
  return role === "user";
}

/**
 * 窄化：是否助手侧消息（AIMessage/Chunk 或 role=assistant）。
 * @param {unknown} msg - 任意消息
 * @returns {msg is BaseMessage} 是否助手消息
 */
export function isAssistantLikeMessage(msg: unknown): msg is BaseMessage {
  if (isAIMessage(msg as any) || isAIMessageChunk(msg as any)) return true;
  const role = (msg as any)?.role;
  return role === "assistant";
}

/**
 * 窄化：是否系统/人设消息（SystemMessage 或 role=system）。
 * @param {unknown} msg - 任意消息
 * @returns {msg is BaseMessage} 是否系统消息
 */
export function isSystemLikeMessage(msg: unknown): msg is BaseMessage {
  if (isSystemMessage(msg as any)) return true;
  const role = (msg as any)?.role;
  return role === "system";
}

/**
 * 窄化：是否 developer 角色消息（ChatMessage.role=developer）。
 * @param {unknown} msg - 任意消息
 * @returns {msg is BaseMessage} 是否 developer 消息
 */
export function isDeveloperMessage(msg: unknown): msg is BaseMessage {
  const role = (msg as any)?.role;
  return role === "developer";
}

/**
 * 窄化：是否工具侧消息（ToolMessage 或判定为 tool）。
 * @param {unknown} msg - 任意消息
 * @returns {msg is BaseMessage} 是否工具消息
 */
export function isToolLikeMessage(msg: unknown): msg is BaseMessage {
  if (isToolMessage(msg as any)) return true;
  const role = (msg as any)?.role;
  if (role === "tool") return true;
  try {
    const getType = (msg as any)?.getType;
    if (typeof getType === "function" && getType.call(msg) === "tool") return true;
  } catch {
    // 忽略
  }
  return false;
}

