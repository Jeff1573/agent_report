// agent/runtime/index.ts
/**
 * 文档说明：可复用的 ReAct Agent 运行时封装。
 * - 负责：模型/工具装载、两种流式模式桥接、交互片段概括（可选）。
 * - 不负责：持久化、可观测平台接入、UI。
 */
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { makeChatModel } from '../llm/factory.js';
import { getDefaultTools } from '../tools/registry.js';
import { logger } from '../utils/logger.js';
import type { StreamEvent, InteractionSegment, Summarizer } from '../stream/types.js';
import { observeValues, observeEvents } from '../stream/observer.js';
import { defaultSummarizer } from '../stream/summarizers.js';

export interface RuntimeConfig {
  tools?: unknown[];
  summarizer?: Summarizer;
}

export interface StreamOptions {
  summary?: boolean; // 是否在每个回合结束后打印概括
}

export interface AgentRuntime {
  runOnce(input: string): Promise<string>;
  streamValues(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent>;
  streamEvents(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent>;
  onEvent(handler: (e: StreamEvent) => void): () => void; // 订阅事件，返回取消订阅函数
}

/**
 * 交互片段累加器：根据事件构建 InteractionSegment
 */
class SegmentAccumulator {
  private current: InteractionSegment | null = null;

  start(inputText?: string) {
    this.current = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      inputText,
      toolCalls: [],
    };
  }

  feed(ev: StreamEvent) {
    if (!this.current) this.start();
    const seg = this.current!;
    switch (ev.type) {
      case 'assistant-message':
        seg.assistantText = ev.content;
        break;
      case 'tool-call': {
        seg.toolCalls.push({ name: ev.name, args: ev.args });
        break;
      }
      case 'tool-result': {
        // 将结果匹配到最近一次同名且未填充结果的调用
        for (let i = seg.toolCalls.length - 1; i >= 0; i--) {
          const call = seg.toolCalls[i];
          if (call.name === ev.name && call.result === undefined) {
            call.result = ev.output;
            break;
          }
        }
        break;
      }
      case 'round-end':
        seg.endedAt = Date.now();
        break;
      default:
        break;
    }
  }

  end(): InteractionSegment | null {
    const seg = this.current;
    this.current = null;
    return seg ?? null;
  }
}

/** 创建运行时实例 */
export function createAgentRuntime(config: RuntimeConfig = {}): AgentRuntime {
  const llm = makeChatModel();
  const tools = Array.isArray(config.tools) && config.tools.length > 0 ? config.tools : getDefaultTools();
  // 这里做宽松断言以兼容不同工具实现（ServerTool/ClientTool/ToolNode），避免类型收窄导致的构建失败
  const agent = createReactAgent({ llm: llm as any, tools: tools as any });
  const summarizer: Summarizer = config.summarizer ?? defaultSummarizer;

  const listeners = new Set<(e: StreamEvent) => void>();
  const emit = (e: StreamEvent) => {
    listeners.forEach((fn) => {
      try { fn(e); } catch { /* 忽略订阅方错误 */ }
    });
  };

  async function runOnce(input: string): Promise<string> {
    const res = await llm.invoke([{ role: 'user', content: input }]);
    const out = (res as any)?.content ?? '';
    return typeof out === 'string' ? out : Array.isArray(out) ? out.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : String(out ?? '');
  }

  async function* pipeWithSummary(gen: AsyncGenerator<StreamEvent>, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    const showSummary = options?.summary === true;
    const acc = new SegmentAccumulator();
    for await (const ev of gen) {
      if (!acc['current']) acc.start();
      acc.feed(ev);
      emit(ev);
      yield ev;
      if (ev.type === 'round-end') {
        const seg = acc.end();
        if (showSummary && seg) {
          const brief = await Promise.resolve(summarizer.summarize(seg));
          logger.info(`[summary] ${brief}`);
        }
      }
    }
  }

  async function* streamValues(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    const inputs = { messages: [{ role: 'user', content: input }] };
    const gen = observeValues(agent, inputs);
    yield* pipeWithSummary(gen, options);
  }

  async function* streamEvents(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    const inputs = { messages: [{ role: 'user', content: input }] };
    const gen = observeEvents(agent, inputs);
    yield* pipeWithSummary(gen, options);
  }

  function onEvent(handler: (e: StreamEvent) => void): () => void {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  return { runOnce, streamValues, streamEvents, onEvent };
}
