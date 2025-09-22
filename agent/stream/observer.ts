// agent/stream/observer.ts
/**
 * 文档说明：
 * - 将 LangGraph 的两种流式模式（values / events v2）适配为统一的内部事件流（见 types.ts）。
 * - 仅做“提取与归一化”，不承担概括与持久化；概括由 runtime 调用方基于事件自行完成。
 */
import type { StreamEvent, ModelTokenEvent, AssistantMessageEvent, ToolCallEvent, ToolResultEvent, RoundEndEvent } from './types.js';

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
export async function* observeValues(agent: any, inputs: any): AsyncGenerator<StreamEvent> {
  const stream = await agent.stream(inputs, { streamMode: 'values' });
  for await (const chunk of stream as AsyncIterable<any>) {
    const messages = (chunk as any)?.messages;
    if (!Array.isArray(messages) || messages.length === 0) continue;
    const msg = messages[messages.length - 1] as any;

    // 1) 助手自然语言
    if (msg?.content) {
      const text = contentToString(msg.content);
      if (text) {
        const ev: AssistantMessageEvent = {
          type: 'assistant-message',
          ts: Date.now(),
          content: text,
        };
        yield ev;
      }
    }

    // 2) 工具调用提示（若存在）
    const toolCalls = Array.isArray(msg?.tool_calls) ? (msg.tool_calls as any[]) : [];
    for (const t of toolCalls) {
      const name = typeof t?.name === 'string' ? t.name : 'unknown-tool';
      const args = t?.args ?? t?.arguments ?? undefined;
      const ev: ToolCallEvent = {
        type: 'tool-call',
        ts: Date.now(),
        name,
        args,
      };
      yield ev;
    }
  }

  const end: RoundEndEvent = { type: 'round-end', ts: Date.now() };
  yield end;
}

/**
 * events v2 模式：从 `agent.streamEvents(inputs, { version: 'v2' })` 转为统一事件
 */
export async function* observeEvents(agent: any, inputs: any): AsyncGenerator<StreamEvent> {
  const eventStream: AsyncIterable<any> = await agent.streamEvents(inputs, { version: 'v2' });
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
        const ev: ModelTokenEvent = { type: 'model-token', ts: Date.now(), token };
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
          content: finalText,
        };
        yield msgEv;
        accText = '';
      }
      const endEv: RoundEndEvent = { type: 'round-end', ts: Date.now() };
      yield endEv;
      continue;
    }

    // 3) 工具开始
    if (event === 'on_tool_start') {
      const name: string = typeof data?.name === 'string' ? data.name : (data?.tool?.name ?? 'unknown-tool');
      const args = data?.input ?? data?.args ?? undefined;
      const ev: ToolCallEvent = { type: 'tool-call', ts: Date.now(), name, args };
      yield ev;
      continue;
    }

    // 4) 工具结束
    if (event === 'on_tool_end') {
      const name: string = typeof data?.name === 'string' ? data.name : (data?.tool?.name ?? 'unknown-tool');
      const output = data?.output ?? data?.result ?? undefined;
      const ev: ToolResultEvent = { type: 'tool-result', ts: Date.now(), name, output };
      yield ev;
      continue;
    }
  }
}
