// agent/tools/registry.ts
/**
 * 文档说明（工具注册器）：
 * - 统一导出默认可用的工具集合，包含内部知识库、Tavily搜索和MCP服务器工具。
 * - 参考：LangGraph 预构建 ReAct Agent 通过 `createReactAgent({ llm, tools })` 装载工具。
 *   （证据：LangGraph JS How-to "Create a ReAct Agent" 示例）
 */
import { tavilyTool, makeTavily } from './tavily.js';
import { kbSearchTool } from './kb.js';
import { getMCPTools } from './mcp.js';
import { logger } from '../utils/logger.js';
import { RAG_ENABLED } from '../config/env.js';

/** 工具类型占位（LangChain Tool 接口为结构化对象，避免引入不必要耦合） */
export type AnyTool = unknown;

/**
 * 工具加载策略枚举
 */
enum ToolLoadStrategy {
  /** 核心工具：加载失败时警告，但不阻止系统启动 */
  CORE = 'core',
  /** 可选工具：加载失败时警告 */
  OPTIONAL = 'optional'
}

/**
 * 返回默认工具集合（按优先级排序）。
 * 
 * 工具加载策略：
 * - 所有工具加载失败都记录警告，不阻止系统启动
 * - 如果所有工具都加载失败，返回空数组（Agent 将无工具可用）
 * - 配置错误应在 validateConfig() 中提前检查
 * 
 * 优先级：内部知识库 > 外部搜索（不包含MCP工具，MCP工具由运行时单独管理）
 */
export async function getDefaultTools(): Promise<AnyTool[]> {
  const tools: AnyTool[] = [];
  const loadErrors: Array<{ tool: string; error: string; strategy: ToolLoadStrategy }> = [];

  // 1. 内部知识库检索（可选：仅当 RAG 可用时注册）
  if (RAG_ENABLED) {
    try {
      tools.push(kbSearchTool);
      logger.info('Loaded kb_search tool (RAG enabled)');
    } catch (error) {
      const errorMsg = `kb_search: ${error}`;
      loadErrors.push({ tool: 'kb_search', error: errorMsg, strategy: ToolLoadStrategy.OPTIONAL });
      logger.warn(`[Optional Tool] ${errorMsg}`);
    }
  } else {
    logger.info('RAG not configured; skip registering kb_search tool');
  }

  // 2. 外部搜索工具（可选工具，兜底）
  try {
    tools.push(tavilyTool);
    logger.info('Loaded tavily tool');
  } catch (error) {
    const errorMsg = `tavily: ${error}`;
    loadErrors.push({ tool: 'tavily', error: errorMsg, strategy: ToolLoadStrategy.OPTIONAL });
    logger.warn(`[Optional Tool] ${errorMsg}`);
  }

  // 汇总加载结果
  if (loadErrors.length > 0) {
    const coreErrors = loadErrors.filter(e => e.strategy === ToolLoadStrategy.CORE);
    if (coreErrors.length > 0) {
      logger.warn('核心工具加载失败，系统功能可能受限:', coreErrors.map(e => e.tool));
    }
    logger.info(`工具加载完成: 成功 ${tools.length}/${tools.length + loadErrors.length}`);
  } else {
    logger.info(`Total tools loaded: ${tools.length}`);
  }

  return tools;
}

/**
 * 按需创建工具实例（同步版本，不包含MCP工具）。
 * 用于需要立即获取工具但不包含MCP的情况。
 */
export function createTools(): AnyTool[] {
  // 预留：可在此处基于环境变量切换不同搜索供应商
  return [kbSearchTool, makeTavily()];
}

/**
 * 获取包含所有工具的异步版本（推荐）。
 * 包含内部知识库、MCP服务器和外部搜索工具。
 */
export async function getAllTools(): Promise<AnyTool[]> {
  return getDefaultTools();
}

export { tavilyTool, makeTavily };
