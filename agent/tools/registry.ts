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

/** 工具类型占位（LangChain Tool 接口为结构化对象，避免引入不必要耦合） */
export type AnyTool = unknown;

/**
 * 返回默认工具集合（按优先级排序）。
 * 优先级：内部知识库 > MCP工具 > 外部搜索
 */
export async function getDefaultTools(): Promise<AnyTool[]> {
  const tools: AnyTool[] = [];
  const errors: string[] = [];

  try {
    // 1. 内部知识库检索（最高优先级）
    tools.push(kbSearchTool);
    logger.info('Loaded kb_search tool');
  } catch (error) {
    errors.push(`kb_search: ${error}`);
  }

  try {
    // 2. MCP服务器工具（第二优先级）
    const mcpTools = await getMCPTools();
    tools.push(...mcpTools);
    logger.info(`Loaded ${mcpTools.length} MCP tools`);
  } catch (error) {
    errors.push(`MCP tools: ${error}`);
  }

  try {
    // 3. 外部搜索工具（兜底）
    tools.push(tavilyTool);
    logger.info('Loaded tavily tool');
  } catch (error) {
    errors.push(`tavily: ${error}`);
  }

  if (errors.length > 0) {
    logger.warn('Some tools failed to load:', errors);
  }

  logger.info(`Total tools loaded: ${tools.length}`);
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
