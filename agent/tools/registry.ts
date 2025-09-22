// agent/tools/registry.ts
/**
 * 文档说明（工具注册器）：
 * - 统一导出默认可用的工具集合，当前仅包含 TavilySearch。
 * - 参考：LangGraph 预构建 ReAct Agent 通过 `createReactAgent({ llm, tools })` 装载工具。
 *   （证据：LangGraph JS How-to "Create a ReAct Agent" 示例）
 */
import { tavilyTool, makeTavily } from './tavily.js';

/** 工具类型占位（LangChain Tool 接口为结构化对象，避免引入不必要耦合） */
export type AnyTool = unknown;

/**
 * 返回默认工具集合（按优先级排序）。
 * 当前仅启用 Tavily。
 */
export function getDefaultTools(): AnyTool[] {
  return [tavilyTool];
}

/**
 * 按需创建工具实例（未来可扩展更多配置）。
 */
export function createTools(): AnyTool[] {
  // 预留：可在此处基于环境变量切换不同搜索供应商
  return [makeTavily()];
}

export { tavilyTool, makeTavily };

