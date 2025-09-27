// agent/runtime/index.ts
/**
 * 文档说明：可复用的 ReAct Agent 运行时封装。
 * - 负责：模型/工具装载、两种流式模式桥接、交互片段概括（可选）。
 * - 不负责：持久化、可观测平台接入、UI。
 */
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { makeChatModel } from '../llm/factory.js';
import { getDefaultTools } from '../tools/registry.js';
import { getSystemMessage } from '../config/prompts.js';
import { logger } from '../utils/logger.js';
import type { StreamEvent, InteractionSegment, Summarizer, AssistantMessageEvent } from '../stream/types.js';
import { observeValues, observeEvents } from '../stream/observer.js';
import { createCheckpointer, type PersistenceMode } from './persistence.js';
import { CHECKPOINT_MODE, THREAD_ID_FALLBACK } from '../config/env.js';
import { defaultSummarizer } from '../stream/summarizers.js';
import { getMCPTools, cleanupMCPClient, type MultiServerMCPClient } from '../tools/mcp.js';

export interface RuntimeConfig {
  /** 自定义工具集（默认注册表） */
  tools?: unknown[];
  /** 回合结束自动概括器 */
  summarizer?: Summarizer;
  /** 持久化模式：memory | postgres（默认取环境变量 CHECKPOINT_MODE） */
  persistenceMode?: PersistenceMode;
}

export interface StreamOptions {
  /** 是否在每回合结束后输出概括 */
  summary?: boolean;
  /** 可选：指定线程 ID 以启用记忆回放 */
  threadId?: string;
}

export interface AgentRuntime {
  runOnce(input: string): Promise<string>;
  streamValues(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent>;
  streamEvents(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent>;
  /** 订阅内部标准化事件，返回取消订阅函数 */
  onEvent(handler: (e: StreamEvent) => void): () => void;
  /** 关闭运行时，清理资源 */
  close(): Promise<void>;
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
export async function createAgentRuntime(config: RuntimeConfig = {}): Promise<AgentRuntime> {
  let tools: unknown[] = [];
  let mcpClient: MultiServerMCPClient | undefined;

  try {
    // 检查是否提供了自定义工具
    if (Array.isArray(config.tools) && config.tools.length > 0) {
      tools = config.tools;
    } else {
      // 加载非MCP工具
      tools = await getDefaultTools();

      // 尝试加载MCP工具
      try {
        const mcpResult = await getMCPTools();
        tools.push(...mcpResult.tools);
        mcpClient = mcpResult.client;
        logger.info(`Loaded ${mcpResult.tools.length} MCP tools`);
      } catch (mcpError) {
        logger.warn('Failed to load MCP tools:', mcpError);
        // MCP工具失败不应该阻止系统启动
      }
    }
    logger.info(`Loaded ${tools.length} tools successfully`);
  } catch (error) {
    logger.error('Failed to load tools:', error);
    // 不使用空数组，直接抛出错误
  }

  const persistenceMode: PersistenceMode = config.persistenceMode ?? (CHECKPOINT_MODE as PersistenceMode) ?? 'memory';
  // 依据环境动态创建 checkpointer（MemorySaver / PostgresSaver）
  const checkpointer = await createCheckpointer(persistenceMode);
  
  // ⭐ 关键：关闭模型级 streaming（避免不完整的"流式函数调用"片段）
  const baseLLM = makeChatModel({
    streaming: false,     // 重要：不要逐 token 流；函数调用一次性返回，最稳
    streamUsage: false,
  });
  
  // 强制至少使用一个工具，避免模型"凭记忆直接回答"（参考rag-demo.ts）
  const llm = tools.length > 0 ? baseLLM.bindTools(tools as any, { tool_choice: "any" }) : baseLLM;
  logger.info(`LLM configured with ${tools.length} tools, tool_choice: ${tools.length > 0 ? 'any' : 'none'}`);
  
  // 这里做宽松断言以兼容不同工具实现（ServerTool/ClientTool/ToolNode），避免类型收窄导致的构建失败
  const agent = createReactAgent({
    llm: llm as any,
    tools: tools as any,
    checkpointSaver: checkpointer as any,
    version: 'v2',
  });
  const summarizer: Summarizer = config.summarizer ?? defaultSummarizer;

  const listeners = new Set<(e: StreamEvent) => void>();
  const emit = (e: StreamEvent) => {
    listeners.forEach((fn) => {
      try { fn(e); } catch { /* 忽略订阅方错误 */ }
    });
  };

  async function runOnce(input: string): Promise<string> {
    const messagesWithSystem = [
      { role: 'system', content: getSystemMessage() },
      { role: 'user', content: input }
    ];
    const res = await llm.invoke(messagesWithSystem);
    const out = (res as any)?.content ?? '';
    return typeof out === 'string' ? out : Array.isArray(out) ? out.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : String(out ?? '');
  }

  async function* pipeWithSummary(gen: AsyncGenerator<StreamEvent>, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    const showSummary = options?.summary === true;
    const acc = new SegmentAccumulator();
    for await (const ev of gen) {
      if (!acc['current']) acc.start();
      acc.feed(ev);
      // 在 round-end 前尝试补充引用列表（若答案未包含 [n] 且工具结果有 sources）
      if (ev.type === 'round-end') {
        try {
          const seg = (acc as any).current as InteractionSegment;
          const answer = String(seg?.assistantText || '');
          const needCite = !/\[[0-9]+\]/.test(answer) && !/参考来源/.test(answer);
          if (needCite && Array.isArray(seg?.toolCalls) && seg.toolCalls.length > 0) {
            // 找到最近一次 kb_search 的结果
            for (let i = seg.toolCalls.length - 1; i >= 0; i--) {
              const call = seg.toolCalls[i];
              if (!call?.result) continue;
              const out = call.result as any;
              const raw = typeof out?.content === 'string' ? out.content : undefined;
              if (!raw || raw.length === 0) continue;
              // 优先解析 JSON
              let extra: string | undefined;
              try {
                const j = JSON.parse(raw);
                if (Array.isArray(j?.sources) && j.sources.length > 0) {
                  const refs = j.sources.map((s: any) => `- [${s?.index}] ${s?.ref ?? ''}`).join('\n');
                  extra = `\n参考来源\n${refs}`;
                }
              } catch {
                // 若不是 JSON，尝试从文本中提取“参考来源”段
                const m = raw.split(/\r?\n/);
                const idx = m.findIndex((line: string) => /参考来源/.test(line));
                if (idx >= 0) {
                  const tail = m.slice(idx).join('\n');
                  extra = `\n${tail.trim()}`;
                }
              }
              if (extra && extra.trim().length > 0) {
                const ev2: AssistantMessageEvent = { type: 'assistant-message', ts: Date.now(), role: 'assistant', content: extra };
                emit(ev2);
                yield ev2;
                // 不要break，继续处理剩余事件
              }
            }
          }
        } catch { /* 忽略补充失败 */ }
      }
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
    const messagesWithSystem = [
      { role: 'system', content: getSystemMessage() },
      { role: 'user', content: input }
    ];
    const inputs = { messages: messagesWithSystem };
    const threadId = (options?.threadId && typeof options.threadId === 'string' && options.threadId.trim())
      ? options.threadId.trim()
      : (THREAD_ID_FALLBACK || undefined);
    const gen = observeValues(agent, inputs, threadId ? { configurable: { thread_id: threadId } } : undefined);
    yield* pipeWithSummary(gen, options);
  }

  async function* streamEvents(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    const messagesWithSystem = [
      { role: 'system', content: getSystemMessage() },
      { role: 'user', content: input }
    ];
    const inputs = { messages: messagesWithSystem };
    const threadId = (options?.threadId && typeof options.threadId === 'string' && options.threadId.trim())
      ? options.threadId.trim()
      : (THREAD_ID_FALLBACK || undefined);
    const gen = observeEvents(agent, inputs, threadId ? { configurable: { thread_id: threadId } } : undefined);
    yield* pipeWithSummary(gen, options);
  }

  function onEvent(handler: (e: StreamEvent) => void): () => void {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  async function close(): Promise<void> {
    // 清理MCP客户端连接
    if (mcpClient) {
      try {
        await cleanupMCPClient(mcpClient);
        logger.info('MCP client connection closed during runtime cleanup');
      } catch (error) {
        logger.error('Error closing MCP client during runtime cleanup:', error);
      }
    }
  }

  return { runOnce, streamValues, streamEvents, onEvent, close };
}
