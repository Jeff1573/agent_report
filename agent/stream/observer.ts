// agent/stream/observer.ts
/**
 * 文档说明：
 * - 将 LangGraph 的两种流式模式（values / events v2）适配为统一的内部事件流（见 types.ts）。
 * - 仅做“提取与归一化”，不承担概括与持久化；概括由 runtime 调用方基于事件自行完成。
 */
import { getUnifiedRole, isMessageChunk, isToolLikeMessage } from '../llm/message-role.js';
import type { StreamEvent, ModelTokenEvent, AssistantMessageEvent, ToolCallEvent, ToolResultEvent, RoundEndEvent } from './types.js';

/**
 * 运行时配置片段（与 LangGraph RunnableConfig 的交集）
 * 仅保留我们需要的 configurable.thread_id 与流式选项/版本标记。
 */
export interface StreamConfigLike {
  configurable?: { thread_id?: string };
  streamMode?: 'values';
  version?: 'v2';
}

/** 将 content（string 或富文本数组）转为字符串 */
function contentToString(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        const maybeText = (c as any)?.text;
        return typeof maybeText === 'string' ? maybeText : '';
      })
      .join('');
  }
  return '';
}

/**
 * values 模式：从 `agent.stream(inputs, { streamMode: 'values' })` 转为统一事件
 */
export async function* observeValues(agent: any, inputs: any, cfg?: StreamConfigLike): AsyncGenerator<StreamEvent> {
  // 统一合并配置：优先调用方传入的 thread_id / 其他标记
  const options: StreamConfigLike = {
    streamMode: 'values',
    ...(cfg ?? {}),
    configurable: {
      ...(cfg?.configurable ?? {}),
      // 收窄类型：仅当 thread_id 为字符串时才下发
      ...(typeof cfg?.configurable?.thread_id === 'string' && cfg.configurable.thread_id
        ? { thread_id: cfg.configurable.thread_id }
        : {}),
    },
  };
  const stream = await agent.stream(inputs, options as any);
  for await (const chunk of stream as AsyncIterable<any>) {
    const messages = (chunk as any)?.messages;
    if (!Array.isArray(messages) || messages.length === 0) continue;
    const msg = messages[messages.length - 1] as any;
    const role = getUnifiedRole(msg);

    // 1) 工具结果（ToolMessage）：避免被误判为 assistant-message
    if (role === 'tool' || isToolLikeMessage(msg)) {
      const name: string = typeof msg?.name === 'string' ? msg.name : 'unknown-tool';
      const outText = contentToString(msg?.content);
      const ev: ToolResultEvent = {
        type: 'tool-result',
        ts: Date.now(),
        role: 'tool',
        name,
        output: outText || msg?.content,
        meta: msg?.tool_call_id ? { callId: String(msg.tool_call_id) } : undefined,
      };
      yield ev;
      continue;
    }

    // 2) 助手自然语言
    if (msg?.content) {
      const text = contentToString(msg.content);
      if (text) {
        const ev: AssistantMessageEvent = {
          type: 'assistant-message',
          ts: Date.now(),
          role: 'assistant',
          content: text,
        };
        yield ev;
      }
    }

    // 3) 工具调用提示（若存在）
    const toolCalls = Array.isArray(msg?.tool_calls) ? (msg.tool_calls as any[]) : [];
    for (const t of toolCalls) {
      const name = typeof t?.name === 'string' ? t.name : 'unknown-tool';
      const args = t?.args ?? t?.arguments ?? undefined;
      const ev: ToolCallEvent = {
        type: 'tool-call',
        ts: Date.now(),
        role: 'tool',
        name,
        args,
      };
      yield ev;
    }
  }

  // 回合结束：不再设置顶层 role，改用 meta.finalRole 标注来源，避免被误渲染为消息
  const end: RoundEndEvent = { type: 'round-end', ts: Date.now(), meta: { finalRole: 'assistant' } };
  yield end;
}

/**
 * events v2 模式：从 `agent.streamEvents(inputs, { version: 'v2' })` 转为统一事件
 */
export async function* observeEvents(agent: any, inputs: any, cfg?: StreamConfigLike): AsyncGenerator<StreamEvent> {
  // 在 events v2 模式下，同样携带 configurable.thread_id 以启用持久化线程回放
  const options: StreamConfigLike = {
    version: 'v2',
    ...(cfg ?? {}),
    configurable: {
      ...(cfg?.configurable ?? {}),
      ...(typeof cfg?.configurable?.thread_id === 'string' && cfg.configurable.thread_id
        ? { thread_id: cfg.configurable.thread_id }
        : {}),
    },
  };
  const eventStream: AsyncIterable<any> = await agent.streamEvents(inputs, options as any);
  let accText = '';
  for await (const item of eventStream) {
    const event = (item as any)?.event as string | undefined;
    const data = (item as any)?.data as any;
    if (!event) continue;

    // 1) 模型增量
    if (event === 'on_chat_model_stream') {
      const chunk = data?.chunk;
      const token = contentToString(chunk?.content ?? chunk);
      if (token) {
        accText += token;
        const ev: ModelTokenEvent = { type: 'model-token', ts: Date.now(), role: 'assistant', token };
        yield ev;
      }
      continue;
    }

    // 2) 模型结束 → 输出完整助手消息 + 回合结束
    if (event === 'on_chat_model_end') {
      // 优先使用流式增量；若没有增量，尝试从 data.output 中提取最终文本
      let finalText = accText;
      if (!finalText) {
        const output = data?.output ?? data?.result ?? data?.response;
        const content = output?.content ?? output?.message?.content ?? output?.text ?? '';
        const fallback = contentToString(content);
        if (fallback) finalText = fallback;
      }
      if (finalText) {
        const msgEv: AssistantMessageEvent = {
          type: 'assistant-message',
          ts: Date.now(),
          role: 'assistant',
          content: finalText,
        };
        yield msgEv;
        accText = '';
      }
      // 回合结束：在模型完成后触发；不设顶层 role，采用 meta.finalRole
      const endEv: RoundEndEvent = { type: 'round-end', ts: Date.now(), meta: { finalRole: 'assistant' } };
      yield endEv;
      continue;
    }

    // 3) 工具开始
    if (event === 'on_tool_start') {
      const name: string = typeof data?.name === 'string' ? data.name : (data?.tool?.name ?? 'unknown-tool');
      const args = data?.input ?? data?.args ?? undefined;
      const ev: ToolCallEvent = { type: 'tool-call', ts: Date.now(), role: 'tool', name, args };
      yield ev;
      continue;
    }

    // 4) 工具结束
    if (event === 'on_tool_end') {
      const name: string = typeof data?.name === 'string' ? data.name : (data?.tool?.name ?? 'unknown-tool');
      const output = data?.output ?? data?.result ?? undefined;
      const ev: ToolResultEvent = { type: 'tool-result', ts: Date.now(), role: 'tool', name, output };
      yield ev;
      continue;
    }
  }
}
