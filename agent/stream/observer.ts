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
 * 从 events v2 的条目中解析工具名称。
 * 优先顺序：
 * 1) 顶层 `item.name`（LangGraph v2 事件标准字段）
 * 2) `data.name`（部分提供商/中间件会下发）
 * 3) `data.tool.name`（少数实现）
 * 4) `data.output.name`（ToolMessage 通常包含 tool 名称，仅在 on_tool_end 可用）
 * 5) `data.input.tool` / `data.input.name`（自定义封送）
 */
function getToolNameFromEvent(item: any): string {
  try {
    const top = typeof item?.name === 'string' && item.name.trim() ? item.name : undefined;
    if (top) return top;
    const data = item?.data ?? {};
    const d1 = typeof data?.name === 'string' && data.name.trim() ? data.name : undefined;
    if (d1) return d1;
    const d2 = typeof data?.tool?.name === 'string' && data.tool.name.trim() ? data.tool.name : undefined;
    if (d2) return d2;
    const d3 = typeof data?.output?.name === 'string' && data.output.name.trim() ? data.output.name : undefined;
    if (d3) return d3;
    const d4 = typeof data?.input?.tool === 'string' && data.input.tool.trim() ? data.input.tool : undefined;
    if (d4) return d4;
    const d5 = typeof data?.input?.name === 'string' && data.input.name.trim() ? data.input.name : undefined;
    if (d5) return d5;
  } catch {
    // ignore
  }
  return 'unknown-tool';
}

/**
 * 解析工具入参，兼容多种封送：
 * - 直接对象：{ query: "..." }
 * - 包裹对象：{ input: {...} }
 * - 字符串化 JSON：{ input: '{"query":"..."}' }
 */
function getToolArgsFromEventData(data: any): unknown {
  const raw = data?.input ?? data?.args ?? undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { input: raw };
    }
  }
  return raw;
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
  const options: any = {
    version: 'v2',
    includeTypes: ["tool", "chat_model", "chain"], // 参考rag-demo.ts的正确配置
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
  let emittedAssistant = false;
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
        emittedAssistant = true;
      }
      // 回合结束：在模型完成后触发；不设顶层 role，采用 meta.finalRole
      const endEv: RoundEndEvent = { type: 'round-end', ts: Date.now(), meta: { finalRole: 'assistant' } };
      yield endEv;
      continue;
    }

    // 3) 工具开始
    if (event === 'on_tool_start') {
      const name: string = getToolNameFromEvent(item);
      const args = getToolArgsFromEventData(data);
      const ev: ToolCallEvent = { type: 'tool-call', ts: Date.now(), role: 'tool', name, args };
      yield ev;
      continue;
    }

    // 4) 工具结束
    if (event === 'on_tool_end') {
      const name: string = getToolNameFromEvent(item);
      const output = data?.output ?? data?.result ?? undefined;
      const ev: ToolResultEvent = { type: 'tool-result', ts: Date.now(), role: 'tool', name, output };
      yield ev;
      continue;
    }

    // 5) 链路结束兜底：某些提供商可能不发 on_chat_model_end，但会在 on_chain_end 提供完整消息
    if (event === 'on_chain_end' && !emittedAssistant) {
      try {
        const messages = (data?.output?.messages || data?.input?.messages) as any[] | undefined;
        const last = Array.isArray(messages) && messages.length > 0 ? messages[messages.length - 1] : undefined;
        const roleHint: string | undefined = (last?.type || last?._getType?.() || last?.role) as any;
        const content = last?.content ?? '';
        const text = contentToString(content);
        // 仅当最后一条看起来是 AI/assistant 时才兜底输出，避免把用户问题误当作助手输出
        if (text && (roleHint === 'ai' || roleHint === 'assistant')) {
          const msgEv: AssistantMessageEvent = {
            type: 'assistant-message',
            ts: Date.now(),
            role: 'assistant',
            content: text,
          };
          yield msgEv;
          emittedAssistant = true;
          const endEv: RoundEndEvent = { type: 'round-end', ts: Date.now(), meta: { finalRole: 'assistant' } };
          yield endEv;
          continue;
        }
      } catch {}
    }

    // 调试：输出未处理的事件名与数据键，辅助定位不同提供商/版本的差异
    if (String(process.env.DEBUG_STREAM_EVENTS || '').toLowerCase() === 'true') {
      try {
        // eslint-disable-next-line no-console
        console.warn('[observeEvents:unhandled]', event, Object.keys(data || {}));
      } catch {}
    }
  }
}
