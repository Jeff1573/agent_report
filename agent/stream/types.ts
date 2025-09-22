// agent/stream/types.ts
/**
 * 文档说明：流式事件与交互片段的类型定义。
 * 目的：统一 `values` 与 `events(v2)` 两种流式形态的事件，便于后续观察与概括。
 * 注意：为保证兼容性，尽量采用宽松类型；具体字段在 observer 中做适配与填充。
 */

/** 统一的事件类型标识 */
export type StreamEventType =
  | 'model-token' // LLM 增量 token（来自 events 流）
  | 'assistant-message' // 助手完整消息（values 或在 events 的 on_chat_model_end 聚合后）
  | 'tool-call' // 工具调用开始（名称 + 参数）
  | 'tool-result' // 工具返回结果
  | 'round-end' // 一轮 Agent↔LLM 交互结束（用于触发概括）
  | 'error'; // 运行时错误

/** 事件公共元信息 */
export interface StreamEventBase {
  type: StreamEventType;
  ts: number; // 事件时间戳（ms）
  meta?: {
    runId?: string;
    threadId?: string;
    model?: string;
    callId?: string;
  };
}

export interface ModelTokenEvent extends StreamEventBase {
  type: 'model-token';
  token: string; // 文本增量（为空字符串时忽略）
}

export interface AssistantMessageEvent extends StreamEventBase {
  type: 'assistant-message';
  content: string; // 聚合后的助手文本
}

export interface ToolCallEvent extends StreamEventBase {
  type: 'tool-call';
  name: string;
  args: unknown;
}

export interface ToolResultEvent extends StreamEventBase {
  type: 'tool-result';
  name: string;
  output: unknown;
}

export interface RoundEndEvent extends StreamEventBase {
  type: 'round-end';
}

export interface ErrorEvent extends StreamEventBase {
  type: 'error';
  error: unknown;
}

export type StreamEvent =
  | ModelTokenEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | RoundEndEvent
  | ErrorEvent;

/**
 * 一次“交互片段”定义：通常对应一次 LLM 回合，可能包含 0..N 次工具往返。
 */
export interface InteractionSegment {
  id: string; // 片段 ID（内部生成）
  startedAt: number;
  endedAt?: number;
  inputText?: string; // 用户输入（若可获得）
  assistantText?: string; // 助手的最终输出文本
  toolCalls: Array<{
    name: string;
    args: unknown;
    result?: unknown;
  }>;
}

/** 概括器接口：对单个交互片段生成简要描述 */
export interface Summarizer {
  summarize(segment: InteractionSegment): Promise<string> | string;
}

