// agent/runtime/index.ts
/**
 * 文档说明：可复用的 ReAct Agent 运行时封装。
 * - 负责：模型/工具装载、两种流式模式桥接、交互片段概括（可选）。
 * - 不负责：持久化、可观测平台接入、UI。
 * 
 * 配置系统：
 * - 启动时：宽松验证（lenient），允许环境变量缺失（依赖界面配置兜底）
 * - 对话时：严格验证（strict），确保合并后配置完整
 * - 配置优先级：界面配置 > 环境变量
 */
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { makeChatModel } from '../llm/factory.js';
import { getDefaultTools } from '../tools/registry.js';
import { getSystemMessage } from '../config/prompts.js';
import { logger } from '../utils/logger.js';
import type { StreamEvent, InteractionSegment, Summarizer, AssistantMessageEvent } from '../stream/types.js';
import { observeValues, observeEvents } from '../stream/observer.js';
import { createCheckpointer, type PersistenceMode } from './persistence.js';
import { CHECKPOINT_MODE, THREAD_ID_FALLBACK, RECURSION_LIMIT, TOOL_MAX_CALLS, TOOL_TIMEOUT_MS, TOOL_RETRY_ATTEMPTS, validateConfig } from '../config/env.js';
import { getMergedConfig, validateRuntimeConfig, getConfigSummary } from '../config/merge.js';
import { defaultSummarizer } from '../stream/summarizers.js';
import { getMCPTools, cleanupMCPClient, type MultiServerMCPClient } from '../tools/mcp.js';
import type { AnyTool, ToolCallArgs, LLMResponse, ToolResult, GraphConfig, KBSearchResult, SourceReference, MessageContentPart } from './types.js';
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { HumanMessage, AIMessage } from '@langchain/core/messages';

export interface RuntimeConfig {
  /** 自定义工具集（默认注册表） */
  tools?: unknown[];
  /** 回合结束自动概括器 */
  summarizer?: Summarizer;
  /** 持久化模式：memory | postgres（默认取环境变量 CHECKPOINT_MODE） */
  persistenceMode?: PersistenceMode;
  /**
   * Agent 实现模式（实验性功能）
   * - 'langgraph': 使用 LangGraph ReAct Agent（默认，原有实现）
   * - 'executor': 使用 LangChain AgentExecutor（新实现，支持精细分类）
   */
  agentMode?: 'langgraph' | 'executor';
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

  /** 获取当前片段（只读访问） */
  getCurrent(): InteractionSegment | null {
    return this.current;
  }

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
  // 启动时使用宽松验证：允许环境变量缺失（依赖界面配置兜底）
  try {
    validateConfig(undefined, 'lenient');
    logger.info('配置验证通过（宽松模式）：环境变量可选，将在对话时合并界面配置');
  } catch (error) {
    logger.error('配置验证失败:', error);
    throw error;
  }
  
  let tools: AnyTool[] = [];
  let mcpClient: MultiServerMCPClient | undefined;
  let toolCallCount = 0; // 总工具调用计数器

  // 工具调用限制检查函数
  function checkToolCallLimit(): boolean {
    if (toolCallCount >= TOOL_MAX_CALLS) {
      logger.warn(`工具调用次数已达到限制: ${toolCallCount}/${TOOL_MAX_CALLS}`);
      return false;
    }
    return true;
  }

  /**
   * MCP 工具调用包装器：添加调用次数限制、超时和重试机制。
   * 
   * 注意：此包装器仅用于 MCP 工具，不应用于内置工具（kb_search等）。
   * 
   * @param tool MCP 工具实例
   * @returns 包装后的工具实例
   */
  function wrapMCPTool(tool: any): any {
    const originalCall = tool.call?.bind(tool);
    if (!originalCall) {
      logger.warn('工具缺少 call 方法，跳过包装:', tool.name);
      return tool;
    }

    tool.call = async (...args: unknown[]) => {
      // 1. 检查调用次数限制
      if (!checkToolCallLimit()) {
        throw new Error(`工具调用次数已达到限制 (${TOOL_MAX_CALLS})，无法执行更多工具调用`);
      }

      // 2. 增加计数并记录日志
      toolCallCount++;
      const toolName = tool.name || 'unknown-tool';
      logger.info(`工具调用 ${toolCallCount}/${TOOL_MAX_CALLS}: ${toolName}`);

      // 3. 创建超时Promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`工具调用超时 (${TOOL_TIMEOUT_MS}ms)`)), TOOL_TIMEOUT_MS);
      });

      // 4. 执行工具调用（带重试）
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= TOOL_RETRY_ATTEMPTS; attempt++) {
        try {
          const result = await Promise.race([originalCall(...args), timeoutPromise]);
          logger.info(`工具调用成功: ${toolName} (尝试 ${attempt + 1})`);
          return result;
        } catch (error) {
          lastError = error as Error;
          logger.warn(`工具调用失败 ${attempt + 1}/${TOOL_RETRY_ATTEMPTS + 1}: ${toolName}`, error);

          if (attempt < TOOL_RETRY_ATTEMPTS) {
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
      }

      // 所有重试都失败了
      logger.error(`MCP工具调用最终失败: ${toolName}`, lastError);
      throw lastError || new Error(`MCP工具调用失败: ${toolName}`);
    };

    return tool;
  }

  try {
    // 检查是否提供了自定义工具
    if (Array.isArray(config.tools) && config.tools.length > 0) {
      tools = config.tools as AnyTool[];
    } else {
      // 加载非MCP工具
      tools = await getDefaultTools() as AnyTool[];

      // 尝试加载MCP工具
      try {
        const mcpResult = await getMCPTools();
        // 为每个MCP工具应用调用限制、超时和重试包装器
        const wrappedMCPTools = mcpResult.tools.map(wrapMCPTool) as AnyTool[];
        tools.push(...wrappedMCPTools);
        mcpClient = mcpResult.client;
        logger.info(`Loaded ${wrappedMCPTools.length} MCP tools with call limits (${TOOL_MAX_CALLS} max total calls)`);
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
  
  // Agent 模式选择
  const agentMode = config.agentMode ?? 'langgraph'; // 默认使用原有实现
  
  /**
   * 构建 AgentExecutor（新实现，支持精细分类）
   * 返回：{ executor, llm } 用于后续流式输出
   */
  async function buildAgentExecutor() {
    const mergedResult = await getMergedConfig();
    const { config: mergedConfig } = mergedResult;
    
    // 对话前严格验证
    validateRuntimeConfig(mergedConfig);
    
    // 记录配置摘要
    const summary = getConfigSummary(mergedResult);
    logger.debug('使用合并配置构建 AgentExecutor:', summary);
    
    // 创建 LLM
    const llm = makeChatModel({
      streaming: true,
      streamUsage: false,
      ...mergedConfig,
    });
    
    // 创建 Prompt 模板
    const prompt = ChatPromptTemplate.fromMessages([
      ["system", getSystemMessage()],
      ["placeholder", "{chat_history}"],
      ["human", "{input}"],
      ["placeholder", "{agent_scratchpad}"],
    ]);
    
    // 创建 Agent
    const agent = await createToolCallingAgent({
      llm,
      tools: tools as any,
      prompt,
    });
    
    // 创建 AgentExecutor
    const executor = new AgentExecutor({
      agent,
      tools: tools as any,
      verbose: false,
      returnIntermediateSteps: true, // 关键：返回中间步骤
      maxIterations: 15, // 防止无限循环
    });
    
    logger.info(`AgentExecutor configured with ${tools.length} tools`);
    
    return { executor, llm };
  }
  
  // ⭐ 开启模型级 streaming 以支持真正的流式输出体验（LangGraph 模式）
  async function buildAgent() {
    // 动态读取合并配置：优先界面配置，其次环境变量
    // 每次调用前重建 LLM/Agent，确保界面切换即时生效
    const mergedResult = await getMergedConfig();
    const { config: mergedConfig, sources } = mergedResult;
    
    // 对话前严格验证：确保合并后配置完整
    validateRuntimeConfig(mergedConfig);
    
    // 记录配置摘要（调试用）
    const summary = getConfigSummary(mergedResult);
    logger.debug('使用合并配置构建 Agent:', summary);
    
    // 使用合并配置创建 LLM（优先级：合并配置 > 默认值）
    const baseLLM = makeChatModel({
      streaming: true,  // 开启流式输出，提供逐字显示体验
      streamUsage: false,
      ...mergedConfig,
    });
    
    // 智谱 AI 兼容性处理：使用 'auto' 而非 'any'
    // 'auto' 让模型自行决定是否调用工具，避免强制调用导致的错误
    const toolChoice = tools.length > 0 ? 'auto' : undefined;
    const llm = tools.length > 0 ? baseLLM.bindTools(tools as any, { tool_choice: toolChoice }) : baseLLM;
    logger.info(`LLM configured with ${tools.length} tools, tool_choice: ${toolChoice ?? 'none'}`);
    
    const agent = createReactAgent({
      llm: llm as any,
      tools: tools as any,
      checkpointSaver: checkpointer as any,
      version: 'v2',
    });
    
    return agent;
  }
  
  /**
   * 创建 ReAct Agent
   * 
   * 类型断言说明：
   * - llm/tools/checkpointSaver 使用 'as any' 是因为 LangChain 的类型定义与我们的接口不完全匹配
   * - 这些断言是必需的，用于兼容不同工具实现（ServerTool/ClientTool/ToolNode）
   * - 运行时类型安全由 LangChain 内部保证
   */
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
    
    // 读取合并配置并验证
    const mergedResult = await getMergedConfig();
    validateRuntimeConfig(mergedResult.config);
    
    // 使用合并配置构建 LLM
    const baseLLM = makeChatModel({ 
      streaming: false, 
      streamUsage: false, 
      ...mergedResult.config 
    });
    
    const res = await (baseLLM as any).invoke(messagesWithSystem) as LLMResponse;
    const out = res?.content ?? '';
    
    // 处理多种响应格式
    if (typeof out === 'string') {
      return out;
    } else if (Array.isArray(out)) {
      // 处理内容数组（可能是 MessageContentPart[] 或 BaseMessage[]）
      return out.map((c: unknown) => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c !== null) {
          const part = c as Record<string, unknown>;
          return String(part.text ?? part.content ?? '');
        }
        return '';
      }).join('');
    } else {
      return String(out ?? '');
    }
  }

  /**
   * 从 action.log 中提取 LLM 的思考过程
   */
  function extractThinking(log: string | undefined): string | undefined {
    if (!log) return undefined;
    const lines = log.split('\n');
    // 查找不是工具调用指令的那一行（通常是LLM的思考）
    const thinking = lines.find(line => 
      !line.startsWith('Invoking') && 
      line.trim().length > 0 &&
      !line.includes('tool') &&
      !line.includes('{') // 排除JSON参数行
    );
    return thinking?.trim();
  }

  /**
   * 从 intermediateSteps 重建消息历史，用于流式输出最终答案
   */
  function buildMessagesFromSteps(input: string, steps: any[]): any[] {
    const messages = [new HumanMessage(input)];
    
    for (const step of steps) {
      // 添加 AI 的工具调用
      messages.push(new AIMessage({
        content: "",
        tool_calls: [{
          name: step.action.tool,
          args: step.action.toolInput,
          id: step.action.toolCallId,
          type: 'tool_call',
        }],
      }));
      
      // 添加工具执行结果
      messages.push({
        role: 'tool',
        content: typeof step.observation === 'string' 
          ? step.observation 
          : JSON.stringify(step.observation),
        tool_call_id: step.action.toolCallId,
      } as any);
    }
    
    return messages;
  }

  async function* pipeWithSummary(gen: AsyncGenerator<StreamEvent>, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    const showSummary = options?.summary === true;
    const acc = new SegmentAccumulator();
    for await (const ev of gen) {
      if (!acc.getCurrent()) acc.start();
      acc.feed(ev);
      // 在 round-end 前尝试补充引用列表（若答案未包含 [n] 且工具结果有 sources）
      if (ev.type === 'round-end') {
        try {
          const seg = acc.getCurrent();
          const answer = String(seg?.assistantText || '');
          const needCite = !/\[[0-9]+\]/.test(answer) && !/参考来源/.test(answer);
          if (needCite && Array.isArray(seg?.toolCalls) && seg.toolCalls.length > 0) {
            // 找到最近一次 kb_search 的结果
            for (let i = seg.toolCalls.length - 1; i >= 0; i--) {
              const call = seg.toolCalls[i];
              if (!call?.result) continue;
              const out = call.result as ToolResult;
              const raw = typeof out?.content === 'string' ? out.content : undefined;
              if (!raw || raw.length === 0) continue;
              // 优先解析 JSON
              let extra: string | undefined;
              try {
                const j = JSON.parse(raw) as KBSearchResult;
                if (Array.isArray(j?.sources) && j.sources.length > 0) {
                  const refs = j.sources.map((s: SourceReference) => `- [${s?.index}] ${s?.ref ?? ''}`).join('\n');
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

  /**
   * 新实现：基于 AgentExecutor 的精细分类流式输出
   */
  async function* streamValuesWithExecutor(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    try {
      // 1. 构建 AgentExecutor
      const { executor, llm } = await buildAgentExecutor();
      
      // 2. 执行完整流程，获取中间步骤
      logger.info('[AgentExecutor] 开始执行...');
      const result = await executor.invoke({
        input,
        returnIntermediateSteps: true,
      });
      
      logger.info(`[AgentExecutor] 执行完成，共 ${result.intermediateSteps?.length || 0} 个中间步骤`);
      
      // 3. 立即发送工具调用和执行结果事件
      if (result.intermediateSteps && Array.isArray(result.intermediateSteps)) {
        for (const step of result.intermediateSteps) {
          // 3.1 发送工具调用事件（LLM 决策）
          const toolCallEvent: StreamEvent = {
            type: 'tool-call',
            ts: Date.now(),
            role: 'tool',
            stage: 'decision', // 标记为决策阶段
            name: step.action.tool,
            args: step.action.toolInput,
            thinking: extractThinking(step.action.log),
            meta: { callId: step.action.toolCallId },
          };
          emit(toolCallEvent);
          yield toolCallEvent;
          
          // 3.2 发送工具执行结果事件
          const toolResultEvent: StreamEvent = {
            type: 'tool-result',
            ts: Date.now(),
            role: 'tool',
            stage: 'execution', // 标记为执行阶段
            name: step.action.tool,
            output: step.observation,
            meta: { callId: step.action.toolCallId },
          };
          emit(toolResultEvent);
          yield toolResultEvent;
        }
      }
      
      // 4. 流式发送最终答案
      logger.info('[AgentExecutor] 开始流式输出最终答案...');
      const messages = buildMessagesFromSteps(input, result.intermediateSteps || []);
      const stream = await llm.stream(messages);
      
      for await (const chunk of stream) {
        const token = String(chunk.content || '');
        if (token) {
          const tokenEvent: StreamEvent = {
            type: 'model-token',
            ts: Date.now(),
            role: 'assistant',
            stage: 'answer', // 标记为答案阶段
            token,
          };
          emit(tokenEvent);
          yield tokenEvent;
        }
      }
      
      // 5. 发送结束事件
      const endEvent: StreamEvent = {
        type: 'round-end',
        ts: Date.now(),
        meta: { finalRole: 'assistant' },
      };
      emit(endEvent);
      yield endEvent;
      
      logger.info('[AgentExecutor] 流式输出完成');
      
    } catch (error) {
      logger.error('[AgentExecutor] 执行失败:', error);
      const errorEvent: StreamEvent = {
        type: 'error',
        ts: Date.now(),
        error,
      };
      emit(errorEvent);
      yield errorEvent;
    }
  }

  /**
   * 原实现：基于 LangGraph ReAct 的流式输出
   */
  async function* streamValuesWithLangGraph(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    const messagesWithSystem = [
      { role: 'system', content: getSystemMessage() },
      { role: 'user', content: input }
    ];
    const inputs = { messages: messagesWithSystem };
    const threadId = (options?.threadId && typeof options.threadId === 'string' && options.threadId.trim())
      ? options.threadId.trim()
      : (THREAD_ID_FALLBACK || undefined);
    const config = {
      ...(threadId ? { configurable: { thread_id: threadId } } : {}),
      recursionLimit: RECURSION_LIMIT,
    } as GraphConfig;
    const agent = await buildAgent();
    const gen = observeValues(agent, inputs, config);
    yield* pipeWithSummary(gen, options);
  }

  /**
   * 流式输出（根据 agentMode 选择实现）
   */
  async function* streamValues(input: string, options?: StreamOptions): AsyncGenerator<StreamEvent> {
    if (agentMode === 'executor') {
      logger.info('[Runtime] 使用 AgentExecutor 模式');
      yield* streamValuesWithExecutor(input, options);
    } else {
      logger.info('[Runtime] 使用 LangGraph 模式');
      yield* streamValuesWithLangGraph(input, options);
    }
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
    const config = {
      ...(threadId ? { configurable: { thread_id: threadId } } : {}),
      recursionLimit: RECURSION_LIMIT,
    } as GraphConfig;
    const agent = await buildAgent();
    const gen = observeEvents(agent, inputs, config);
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
